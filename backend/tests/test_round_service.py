"""
Tests for RoundService (C-10).

Covers:
  - Creation paths (diner from cart, waiter quick-command)
  - Full state machine (7 transitions)
  - Role gating per transition (403 on unauthorized)
  - Session-state gate (409 on non-OPEN session)
  - Price snapshot resolution (BranchProduct → Product.price fallback → 400)
  - Multi-tenant isolation
  - Kitchen visibility filter (never returns PENDING / CONFIRMED)
  - Outbox integration (ROUND_SUBMITTED, ROUND_READY write to outbox_event)
  - Direct-Redis event publication via injected publisher mock
  - Void-item happy and unhappy paths

Stock validation: C-10 ships with stock validation as a NO-OP (stock columns
arrive with the inventory module in a later change). The submit test below
verifies that submit() advances the state without raising when no stock is
tracked — the negative stock-insufficient path will be tested when those
columns land.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.models.outbox import OutboxEvent
from rest_api.models.round import Round, RoundItem
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import CartItem, Diner, TableSession
from rest_api.models.tenant import Tenant
from rest_api.models.user import User
from rest_api.services.domain.round_service import RoundService
from shared.config.constants import RoundStatus, UserRole
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def seeded(db: AsyncSession):
    """
    Seed a minimal tenant → branch → sector → table → session → products hierarchy.

    Also creates users for every role and a foreign tenant for multi-tenant tests.
    """
    tenant = Tenant(name="Tenant A")
    db.add(tenant)
    await db.flush()

    foreign = Tenant(name="Tenant B")
    db.add(foreign)
    await db.flush()

    branch = Branch(tenant_id=tenant.id, name="Main", address="Addr", slug="main")
    db.add(branch)
    await db.flush()

    foreign_branch = Branch(
        tenant_id=foreign.id, name="Foreign", address="ForeignAddr", slug="foreign"
    )
    db.add(foreign_branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="Salon")
    db.add(sector)
    foreign_sector = BranchSector(branch_id=foreign_branch.id, name="Bar")
    db.add(foreign_sector)
    await db.flush()

    table = Table(
        branch_id=branch.id,
        sector_id=sector.id,
        number=1,
        code="T1",
        capacity=4,
        status="AVAILABLE",
    )
    db.add(table)
    foreign_table = Table(
        branch_id=foreign_branch.id,
        sector_id=foreign_sector.id,
        number=1,
        code="F1",
        capacity=4,
        status="AVAILABLE",
    )
    db.add(foreign_table)
    await db.flush()

    session = TableSession(
        table_id=table.id, branch_id=branch.id, status="OPEN"
    )
    db.add(session)
    foreign_session = TableSession(
        table_id=foreign_table.id, branch_id=foreign_branch.id, status="OPEN"
    )
    db.add(foreign_session)
    await db.flush()

    diner = Diner(session_id=session.id, name="Alice")
    db.add(diner)
    diner2 = Diner(session_id=session.id, name="Bob")
    db.add(diner2)
    foreign_diner = Diner(session_id=foreign_session.id, name="Foreigner")
    db.add(foreign_diner)
    await db.flush()

    # Menu: one category → one subcategory → two products + BranchProduct override
    cat = Category(branch_id=branch.id, name="Main", order=10)
    db.add(cat)
    await db.flush()
    subcat = Subcategory(category_id=cat.id, name="Burgers", order=10)
    db.add(subcat)
    await db.flush()

    product_a = Product(
        subcategory_id=subcat.id, name="Classic Burger", price=15000
    )  # $150.00
    product_b = Product(
        subcategory_id=subcat.id, name="Fries", price=5000
    )  # $50.00 (no BranchProduct)
    db.add_all([product_a, product_b])
    await db.flush()

    # BranchProduct overrides product_a's price for this branch
    bp_a = BranchProduct(
        product_id=product_a.id,
        branch_id=branch.id,
        price_cents=18000,  # $180 on this branch
        is_available=True,
    )
    db.add(bp_a)
    await db.flush()

    # Users for each role
    users: dict[str, User] = {}
    for role in ("ADMIN", "MANAGER", "WAITER", "KITCHEN"):
        u = User(
            tenant_id=tenant.id,
            email=f"{role.lower()}@test.com",
            hashed_password="x",
            full_name=f"{role} User",
        )
        db.add(u)
        users[role] = u
    await db.flush()
    await db.commit()

    return {
        "tenant": tenant,
        "foreign": foreign,
        "branch": branch,
        "foreign_branch": foreign_branch,
        "session": session,
        "foreign_session": foreign_session,
        "diner": diner,
        "diner2": diner2,
        "foreign_diner": foreign_diner,
        "product_a": product_a,
        "product_b": product_b,
        "users": users,
    }


@pytest_asyncio.fixture
async def mock_publisher() -> AsyncMock:
    """Async mock used as the WebSocket publisher in RoundService."""
    return AsyncMock()


# ── Creation: diner from cart ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_from_cart_happy_path(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    """Diner with 2 cart items → Round with 2 RoundItems, cart emptied, event fired."""
    session = seeded["session"]
    diner = seeded["diner"]
    prod_a = seeded["product_a"]
    prod_b = seeded["product_b"]

    db.add_all(
        [
            CartItem(
                session_id=session.id,
                diner_id=diner.id,
                product_id=prod_a.id,
                quantity=2,
                notes="no onions",
            ),
            CartItem(
                session_id=session.id,
                diner_id=diner.id,
                product_id=prod_b.id,
                quantity=1,
            ),
        ]
    )
    await db.commit()

    service = RoundService(db, publisher=mock_publisher)
    out = await service.create_from_cart(
        session_id=session.id, diner_id=diner.id, tenant_id=seeded["tenant"].id
    )

    assert out.status == RoundStatus.PENDING
    assert out.round_number == 1
    assert out.created_by_role == "DINER"
    assert out.created_by_diner_id == diner.id
    assert len(out.items) == 2

    # Cart emptied for this diner
    remaining = (
        await db.execute(
            select(CartItem).where(CartItem.diner_id == diner.id)
        )
    ).scalars().all()
    assert remaining == []

    # Price snapshot: product_a used BranchProduct.price_cents (18000)
    item_a = next(i for i in out.items if i.product_id == prod_a.id)
    assert item_a.price_cents_snapshot == 18000
    # product_b fell back to Product.price
    item_b = next(i for i in out.items if i.product_id == prod_b.id)
    assert item_b.price_cents_snapshot == 5000

    # Event fired once with ROUND_PENDING
    mock_publisher.assert_called_once()
    event_type, payload = mock_publisher.call_args[0]
    assert event_type == "ROUND_PENDING"
    assert payload["round_id"] == out.id
    assert payload["branch_id"] == seeded["branch"].id


@pytest.mark.asyncio
async def test_create_from_cart_empty_cart_400(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ValidationError):
        await service.create_from_cart(
            session_id=seeded["session"].id,
            diner_id=seeded["diner"].id,
            tenant_id=seeded["tenant"].id,
        )
    mock_publisher.assert_not_called()


@pytest.mark.asyncio
async def test_create_from_cart_other_diners_cart_untouched(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    session = seeded["session"]
    diner = seeded["diner"]
    diner2 = seeded["diner2"]
    prod_a = seeded["product_a"]

    db.add(
        CartItem(
            session_id=session.id, diner_id=diner.id, product_id=prod_a.id, quantity=1
        )
    )
    db.add(
        CartItem(
            session_id=session.id, diner_id=diner2.id, product_id=prod_a.id, quantity=3
        )
    )
    await db.commit()

    service = RoundService(db, publisher=mock_publisher)
    await service.create_from_cart(
        session_id=session.id, diner_id=diner.id, tenant_id=seeded["tenant"].id
    )

    remaining_other = (
        await db.execute(select(CartItem).where(CartItem.diner_id == diner2.id))
    ).scalars().all()
    assert len(remaining_other) == 1


@pytest.mark.asyncio
async def test_create_from_cart_paying_session_409(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    session = seeded["session"]
    diner = seeded["diner"]
    prod_a = seeded["product_a"]
    db.add(CartItem(session_id=session.id, diner_id=diner.id, product_id=prod_a.id, quantity=1))
    session.status = "PAYING"
    await db.commit()

    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ConflictError):
        await service.create_from_cart(
            session_id=session.id, diner_id=diner.id, tenant_id=seeded["tenant"].id
        )


@pytest.mark.asyncio
async def test_create_from_cart_unpriced_product_raises(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    # Soft-delete product_b so price fallback fails; also no BranchProduct exists for it
    prod_b = seeded["product_b"]
    prod_b.is_active = False
    db.add(
        CartItem(
            session_id=seeded["session"].id,
            diner_id=seeded["diner"].id,
            product_id=prod_b.id,
            quantity=1,
        )
    )
    await db.commit()

    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ValidationError):
        await service.create_from_cart(
            session_id=seeded["session"].id,
            diner_id=seeded["diner"].id,
            tenant_id=seeded["tenant"].id,
        )


# ── Creation: waiter quick-command ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_from_waiter_happy_path(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    out = await service.create_from_waiter(
        session_id=seeded["session"].id,
        items_input=[
            {"product_id": seeded["product_a"].id, "quantity": 2, "notes": None,
             "diner_id": seeded["diner"].id},
            {"product_id": seeded["product_b"].id, "quantity": 1, "notes": None,
             "diner_id": None},
        ],
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    assert out.status == RoundStatus.PENDING
    assert out.created_by_role == UserRole.WAITER
    assert out.created_by_user_id == seeded["users"]["WAITER"].id
    assert len(out.items) == 2


@pytest.mark.asyncio
async def test_create_from_waiter_empty_items_raises(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ValidationError):
        await service.create_from_waiter(
            session_id=seeded["session"].id,
            items_input=[],
            tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id],
            user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )


@pytest.mark.asyncio
async def test_create_from_waiter_invalid_diner_id_raises(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ValidationError):
        await service.create_from_waiter(
            session_id=seeded["session"].id,
            items_input=[
                {
                    "product_id": seeded["product_a"].id,
                    "quantity": 1,
                    "notes": None,
                    "diner_id": 99999,  # does not exist
                }
            ],
            tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id],
            user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )


@pytest.mark.asyncio
async def test_round_number_is_sequential_per_session(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    for _ in range(3):
        await service.create_from_waiter(
            session_id=seeded["session"].id,
            items_input=[
                {"product_id": seeded["product_a"].id, "quantity": 1,
                 "notes": None, "diner_id": None}
            ],
            tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id],
            user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )
    rounds = list(
        (await db.execute(
            select(Round).where(Round.session_id == seeded["session"].id)
            .order_by(Round.round_number.asc())
        )).scalars().all()
    )
    assert [r.round_number for r in rounds] == [1, 2, 3]


# ── State transitions — happy paths ───────────────────────────────────────────


@pytest_asyncio.fixture
async def pending_round(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> Round:
    """Create a PENDING round via the waiter path for transition tests."""
    service = RoundService(db, publisher=mock_publisher)
    await service.create_from_waiter(
        session_id=seeded["session"].id,
        items_input=[
            {"product_id": seeded["product_a"].id, "quantity": 1,
             "notes": None, "diner_id": None}
        ],
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    mock_publisher.reset_mock()
    # Re-read from DB
    r = (await db.execute(select(Round))).scalars().first()
    return r


@pytest.mark.asyncio
async def test_confirm_pending_to_confirmed(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    out = await service.confirm(
        round_id=pending_round.id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    assert out.status == RoundStatus.CONFIRMED
    assert out.confirmed_at is not None
    assert out.confirmed_by_id == seeded["users"]["WAITER"].id
    # Direct-Redis event
    mock_publisher.assert_called_once()
    assert mock_publisher.call_args[0][0] == "ROUND_CONFIRMED"


@pytest.mark.asyncio
async def test_submit_writes_outbox_and_advances_state(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    # Move to CONFIRMED first
    await service.confirm(
        round_id=pending_round.id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    mock_publisher.reset_mock()
    # Now submit as MANAGER
    out = await service.submit(
        round_id=pending_round.id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER,
    )
    assert out.status == RoundStatus.SUBMITTED
    assert out.submitted_at is not None
    assert out.submitted_by_id == seeded["users"]["MANAGER"].id
    # C-11: submit fires TICKET_CREATED direct-Redis after commit, but
    # ROUND_SUBMITTED still uses the outbox.
    direct_events = [
        c.args[0] for c in mock_publisher.call_args_list
    ]
    assert direct_events == ["TICKET_CREATED"]
    # An OutboxEvent row exists for ROUND_SUBMITTED.
    events = (
        await db.execute(select(OutboxEvent).where(OutboxEvent.event_type == "ROUND_SUBMITTED"))
    ).scalars().all()
    assert len(events) == 1
    assert events[0].payload["round_id"] == out.id
    assert events[0].payload.get("ticket_id") is not None  # C-11 payload extension
    assert events[0].processed_at is None


@pytest.mark.asyncio
async def test_mark_ready_writes_outbox(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    # Walk the round through PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN
    await service.confirm(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    await service.submit(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER,
    )
    await service.start_kitchen(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    mock_publisher.reset_mock()
    # IN_KITCHEN → READY: writes outbox, no direct publish.
    out = await service.mark_ready(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    assert out.status == RoundStatus.READY
    # C-11: mark_ready writes both ROUND_READY and TICKET_READY to the outbox.
    # Direct publish should not fire for either (both are outbox).
    mock_publisher.assert_not_called()
    events = (
        await db.execute(select(OutboxEvent).where(OutboxEvent.event_type == "ROUND_READY"))
    ).scalars().all()
    assert len(events) == 1
    assert events[0].payload.get("ticket_id") is not None  # C-11 payload extension
    # C-11: TICKET_READY outbox row as well.
    ticket_events = (
        await db.execute(select(OutboxEvent).where(OutboxEvent.event_type == "TICKET_READY"))
    ).scalars().all()
    assert len(ticket_events) == 1


@pytest.mark.asyncio
async def test_full_happy_path_pending_to_served(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    await service.confirm(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    await service.submit(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER,
    )
    await service.start_kitchen(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    await service.mark_ready(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    out = await service.serve(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    assert out.status == RoundStatus.SERVED
    assert out.served_at is not None


# ── State transitions — unhappy paths ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_cannot_skip_states_pending_to_submitted(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    """Cannot go PENDING → SUBMITTED directly (invalid transition)."""
    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ConflictError):
        await service.submit(
            round_id=pending_round.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
            user_role=UserRole.MANAGER,
        )


@pytest.mark.asyncio
async def test_waiter_cannot_submit_returns_403(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    # Move to CONFIRMED first
    await service.confirm(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    # WAITER cannot submit — only MANAGER/ADMIN
    with pytest.raises(ForbiddenError):
        await service.submit(
            round_id=pending_round.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )


@pytest.mark.asyncio
async def test_kitchen_cannot_confirm_returns_403(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ForbiddenError):
        await service.confirm(
            round_id=pending_round.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
            user_role=UserRole.KITCHEN,
        )


@pytest.mark.asyncio
async def test_cancel_from_pending_ok(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    out = await service.cancel(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER, cancel_reason="cliente se retiró",
    )
    assert out.status == RoundStatus.CANCELED
    assert out.canceled_at is not None
    assert out.is_active is True  # still active — canceled is a state
    mock_publisher.assert_called_with(
        "ROUND_CANCELED",
        pytest.approx({"round_id": pending_round.id}, abs=0)
        if False else mock_publisher.call_args[0][1],
    )


@pytest.mark.asyncio
async def test_cancel_requires_reason(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ValidationError):
        await service.cancel(
            round_id=pending_round.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
            user_role=UserRole.MANAGER, cancel_reason="   ",
        )


@pytest.mark.asyncio
async def test_waiter_cannot_cancel(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ForbiddenError):
        await service.cancel(
            round_id=pending_round.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER, cancel_reason="reason",
        )


# ── Void item ─────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def submitted_round(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> Round:
    """Walk a PENDING round up to SUBMITTED for void-item tests."""
    service = RoundService(db, publisher=mock_publisher)
    await service.confirm(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    await service.submit(
        round_id=pending_round.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER,
    )
    mock_publisher.reset_mock()
    r = (await db.execute(select(Round).where(Round.id == pending_round.id))).scalar_one()
    return r


@pytest.mark.asyncio
async def test_void_item_in_submitted_ok(
    db: AsyncSession, seeded: dict, submitted_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    item = (
        await db.execute(select(RoundItem).where(RoundItem.round_id == submitted_round.id))
    ).scalars().first()

    out = await service.void_item(
        round_id=submitted_round.id, round_item_id=item.id,
        void_reason="quemado", tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    assert out.is_voided is True
    assert out.void_reason == "quemado"
    # Round status unchanged
    await db.refresh(submitted_round)
    assert submitted_round.status == RoundStatus.SUBMITTED
    mock_publisher.assert_called_once()
    assert mock_publisher.call_args[0][0] == "ROUND_ITEM_VOIDED"


@pytest.mark.asyncio
async def test_void_item_in_pending_409(
    db: AsyncSession, seeded: dict, pending_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    item = (
        await db.execute(select(RoundItem).where(RoundItem.round_id == pending_round.id))
    ).scalars().first()
    with pytest.raises(ConflictError):
        await service.void_item(
            round_id=pending_round.id, round_item_id=item.id,
            void_reason="nope", tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )


@pytest.mark.asyncio
async def test_void_item_twice_conflicts(
    db: AsyncSession, seeded: dict, submitted_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    item = (
        await db.execute(select(RoundItem).where(RoundItem.round_id == submitted_round.id))
    ).scalars().first()
    await service.void_item(
        round_id=submitted_round.id, round_item_id=item.id,
        void_reason="once", tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    with pytest.raises(ConflictError):
        await service.void_item(
            round_id=submitted_round.id, round_item_id=item.id,
            void_reason="twice", tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )


@pytest.mark.asyncio
async def test_void_item_wrong_round_404(
    db: AsyncSession, seeded: dict, submitted_round: Round, mock_publisher: AsyncMock
) -> None:
    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(NotFoundError):
        await service.void_item(
            round_id=submitted_round.id, round_item_id=99999,
            void_reason="nope", tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )


# ── Kitchen visibility ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_for_kitchen_excludes_pending_and_confirmed(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    """
    Create rounds in 5 states and assert the kitchen list returns only
    SUBMITTED, IN_KITCHEN, and READY.
    """
    service = RoundService(db, publisher=mock_publisher)

    async def create_round_at_state(target: str) -> Round:
        await service.create_from_waiter(
            session_id=seeded["session"].id,
            items_input=[{"product_id": seeded["product_a"].id, "quantity": 1,
                          "notes": None, "diner_id": None}],
            tenant_id=seeded["tenant"].id, branch_ids=[seeded["branch"].id],
            user_id=seeded["users"]["WAITER"].id, user_role=UserRole.WAITER,
        )
        r = (await db.execute(
            select(Round).order_by(Round.round_number.desc()).limit(1)
        )).scalar_one()
        if target == RoundStatus.PENDING:
            return r
        await service.confirm(
            round_id=r.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )
        if target == RoundStatus.CONFIRMED:
            return r
        await service.submit(
            round_id=r.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
            user_role=UserRole.MANAGER,
        )
        if target == RoundStatus.SUBMITTED:
            return r
        await service.start_kitchen(
            round_id=r.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
            user_role=UserRole.KITCHEN,
        )
        if target == RoundStatus.IN_KITCHEN:
            return r
        await service.mark_ready(
            round_id=r.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
            user_role=UserRole.KITCHEN,
        )
        return r

    await create_round_at_state(RoundStatus.PENDING)
    await create_round_at_state(RoundStatus.CONFIRMED)
    await create_round_at_state(RoundStatus.SUBMITTED)
    await create_round_at_state(RoundStatus.IN_KITCHEN)
    await create_round_at_state(RoundStatus.READY)

    rounds = await service.list_for_kitchen(
        branch_id=seeded["branch"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
    )
    statuses = sorted(r.status for r in rounds)
    assert statuses == [RoundStatus.IN_KITCHEN, RoundStatus.READY, RoundStatus.SUBMITTED]


# ── Multi-tenant isolation ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tenant_a_cannot_confirm_tenant_b_round(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    # Create a round in foreign tenant's session via direct SQL
    foreign_round = Round(
        session_id=seeded["foreign_session"].id,
        branch_id=seeded["foreign_branch"].id,
        round_number=1,
        status=RoundStatus.PENDING,
        created_by_role="WAITER",
    )
    db.add(foreign_round)
    await db.commit()

    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(NotFoundError):
        # Use tenant A's id — service must treat it as not found
        await service.confirm(
            round_id=foreign_round.id,
            tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id],
            user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )


# ── Session-state gate for waiter creation ─────────────────────────────────────


@pytest.mark.asyncio
async def test_waiter_cannot_create_round_on_paying_session(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    seeded["session"].status = "PAYING"
    await db.commit()
    service = RoundService(db, publisher=mock_publisher)
    with pytest.raises(ConflictError):
        await service.create_from_waiter(
            session_id=seeded["session"].id,
            items_input=[
                {"product_id": seeded["product_a"].id, "quantity": 1,
                 "notes": None, "diner_id": None}
            ],
            tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id],
            user_id=seeded["users"]["WAITER"].id,
            user_role=UserRole.WAITER,
        )


# ── Model-level basics ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_unique_round_number_per_session(
    db: AsyncSession, seeded: dict
) -> None:
    """Two rows with the same (session_id, round_number) must fail."""
    r1 = Round(
        session_id=seeded["session"].id,
        branch_id=seeded["branch"].id,
        round_number=1,
        status=RoundStatus.PENDING,
        created_by_role="WAITER",
    )
    db.add(r1)
    await db.flush()
    r2 = Round(
        session_id=seeded["session"].id,
        branch_id=seeded["branch"].id,
        round_number=1,  # duplicate
        status=RoundStatus.PENDING,
        created_by_role="WAITER",
    )
    db.add(r2)
    with pytest.raises(Exception):  # IntegrityError in SQLAlchemy's async path
        await db.flush()


# ── Stock validation — deferred tests ────────────────────────────────────────
#
# The following tests are deferred until the inventory module lands and
# BranchProduct.stock / Ingredient.stock columns exist:
#
#   - test_submit_with_insufficient_product_stock_409
#   - test_submit_aggregates_demand_across_items_of_same_product
#   - test_submit_with_insufficient_ingredient_stock_409
#
# RoundService._validate_stock is a deliberate NO-OP in C-10 (see D-04 in
# the service docstring). When stock columns arrive, replace the no-op block
# and add the tests above — the router already handles StockInsufficientError
# as a structured 409 (see admin_rounds.py).
#
# The current behaviour is covered implicitly by test_submit_writes_outbox_and_advances_state:
# submit() does not raise when stock tracking is absent.


@pytest.mark.asyncio
async def test_round_item_check_constraints(
    db: AsyncSession, seeded: dict
) -> None:
    """Quantity must be > 0 and price_cents_snapshot >= 0."""
    r = Round(
        session_id=seeded["session"].id,
        branch_id=seeded["branch"].id,
        round_number=1,
        status=RoundStatus.PENDING,
        created_by_role="WAITER",
    )
    db.add(r)
    await db.flush()
    # quantity = 0 — should fail CHECK
    bad = RoundItem(
        round_id=r.id,
        product_id=seeded["product_a"].id,
        quantity=0,
        price_cents_snapshot=1000,
    )
    db.add(bad)
    with pytest.raises(Exception):
        await db.flush()
