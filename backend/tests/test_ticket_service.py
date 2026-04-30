"""
Tests for TicketService and the RoundService integration (C-11).

Covers:
  - Ticket auto-creation on submit with non-voided items only
  - Ticket state sync on start_kitchen / mark_ready / serve transitions
  - Ticket soft-delete cascade on round cancellation from SUBMITTED+
  - Listing filters (tenant + branch + is_active + status)
  - set_status driving the round cascade
  - TICKET_CREATED / TICKET_IN_PROGRESS / TICKET_DELIVERED direct events
  - TICKET_READY outbox event
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.kitchen_ticket import KitchenTicket, KitchenTicketItem
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.models.outbox import OutboxEvent
from rest_api.models.round import Round, RoundItem
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import Diner, TableSession
from rest_api.models.tenant import Tenant
from rest_api.models.user import User
from rest_api.services.domain.round_service import RoundService
from rest_api.services.domain.ticket_service import TicketService
from shared.config.constants import KitchenTicketStatus, RoundStatus, UserRole
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)


# ── Shared fixture (mirrors test_round_service for isolation) ──────────────────


@pytest_asyncio.fixture
async def seeded(db: AsyncSession):
    """Minimal tenant→branch→sector→table→session→products hierarchy."""
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
        branch_id=branch.id, sector_id=sector.id, number=1, code="T1",
        capacity=4, status="AVAILABLE",
    )
    db.add(table)
    foreign_table = Table(
        branch_id=foreign_branch.id, sector_id=foreign_sector.id, number=1,
        code="F1", capacity=4, status="AVAILABLE",
    )
    db.add(foreign_table)
    await db.flush()

    session = TableSession(table_id=table.id, branch_id=branch.id, status="OPEN")
    db.add(session)
    foreign_session = TableSession(
        table_id=foreign_table.id, branch_id=foreign_branch.id, status="OPEN"
    )
    db.add(foreign_session)
    await db.flush()

    diner = Diner(session_id=session.id, name="Alice")
    db.add(diner)
    foreign_diner = Diner(session_id=foreign_session.id, name="Foreigner")
    db.add(foreign_diner)
    await db.flush()

    cat = Category(branch_id=branch.id, name="Main", order=10)
    db.add(cat)
    await db.flush()
    subcat = Subcategory(category_id=cat.id, name="Burgers", order=10)
    db.add(subcat)
    await db.flush()

    product_a = Product(subcategory_id=subcat.id, name="Classic Burger", price=15000)
    product_b = Product(subcategory_id=subcat.id, name="Fries", price=5000)
    db.add_all([product_a, product_b])
    await db.flush()

    bp_a = BranchProduct(
        product_id=product_a.id, branch_id=branch.id,
        price_cents=18000, is_available=True,
    )
    db.add(bp_a)
    await db.flush()

    users: dict[str, User] = {}
    for role in ("ADMIN", "MANAGER", "WAITER", "KITCHEN"):
        u = User(
            tenant_id=tenant.id, email=f"{role.lower()}@test.com",
            hashed_password="x", full_name=f"{role} User",
        )
        db.add(u)
        users[role] = u
    await db.flush()
    await db.commit()

    return {
        "tenant": tenant, "foreign": foreign,
        "branch": branch, "foreign_branch": foreign_branch,
        "session": session, "foreign_session": foreign_session,
        "diner": diner, "foreign_diner": foreign_diner,
        "product_a": product_a, "product_b": product_b,
        "users": users,
    }


@pytest_asyncio.fixture
async def mock_publisher() -> AsyncMock:
    return AsyncMock()


async def _make_submitted_round(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> Round:
    """Helper: walk a round from PENDING → CONFIRMED → SUBMITTED."""
    service = RoundService(db, publisher=mock_publisher)
    await service.create_from_waiter(
        session_id=seeded["session"].id,
        items_input=[
            {"product_id": seeded["product_a"].id, "quantity": 2, "notes": None, "diner_id": None},
            {"product_id": seeded["product_b"].id, "quantity": 1, "notes": None, "diner_id": None},
        ],
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    r = (await db.execute(select(Round))).scalars().first()
    await service.confirm(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    mock_publisher.reset_mock()
    await service.submit(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER,
    )
    return (await db.execute(select(Round).where(Round.id == r.id))).scalar_one()


# ── Ticket auto-creation on submit ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_submit_auto_creates_ticket_with_all_items(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    """Submit creates one ticket with IN_PROGRESS and one item per non-voided round item."""
    r = await _make_submitted_round(db, seeded, mock_publisher)

    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one_or_none()
    assert ticket is not None
    assert ticket.status == KitchenTicketStatus.IN_PROGRESS
    assert ticket.branch_id == seeded["branch"].id
    assert ticket.is_active is True
    assert ticket.started_at is None
    assert ticket.ready_at is None
    assert ticket.delivered_at is None

    items = (
        await db.execute(
            select(KitchenTicketItem).where(KitchenTicketItem.ticket_id == ticket.id)
        )
    ).scalars().all()
    assert len(items) == 2  # both round items, no voids


@pytest.mark.asyncio
async def test_submit_excludes_voided_items_from_ticket(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    """If a round item is voided BEFORE submit, the ticket has one fewer item."""
    service = RoundService(db, publisher=mock_publisher)
    await service.create_from_waiter(
        session_id=seeded["session"].id,
        items_input=[
            {"product_id": seeded["product_a"].id, "quantity": 2, "notes": None, "diner_id": None},
            {"product_id": seeded["product_b"].id, "quantity": 1, "notes": None, "diner_id": None},
        ],
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    r = (await db.execute(select(Round))).scalars().first()
    # Pre-void one item before confirm — mutate directly in DB.
    item_a = (
        await db.execute(
            select(RoundItem).where(
                RoundItem.round_id == r.id, RoundItem.product_id == seeded["product_a"].id,
            )
        )
    ).scalar_one()
    item_a.is_voided = True
    await db.commit()

    await service.confirm(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    await service.submit(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER,
    )

    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    items = (
        await db.execute(
            select(KitchenTicketItem).where(KitchenTicketItem.ticket_id == ticket.id)
        )
    ).scalars().all()
    assert len(items) == 1  # only the non-voided item


@pytest.mark.asyncio
async def test_submit_emits_ticket_created_direct(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    """Submit publishes TICKET_CREATED direct-Redis after commit."""
    r = await _make_submitted_round(db, seeded, mock_publisher)
    events_called = [c.args[0] for c in mock_publisher.call_args_list]
    assert "TICKET_CREATED" in events_called
    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    call_payload = next(
        c.args[1] for c in mock_publisher.call_args_list if c.args[0] == "TICKET_CREATED"
    )
    assert call_payload["ticket_id"] == ticket.id
    assert call_payload["round_id"] == r.id
    assert call_payload["branch_id"] == seeded["branch"].id


@pytest.mark.asyncio
async def test_round_submitted_outbox_payload_includes_ticket_id(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    event = (
        await db.execute(
            select(OutboxEvent).where(OutboxEvent.event_type == "ROUND_SUBMITTED")
        )
    ).scalar_one()
    assert event.payload["round_id"] == r.id
    assert event.payload.get("ticket_id") is not None


# ── start_kitchen / mark_ready / serve cascade ────────────────────────────────


@pytest.mark.asyncio
async def test_start_kitchen_stamps_ticket_started_at(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    service = RoundService(db, publisher=mock_publisher)
    await service.start_kitchen(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    assert ticket.status == KitchenTicketStatus.IN_PROGRESS  # status unchanged
    assert ticket.started_at is not None

    events_called = [c.args[0] for c in mock_publisher.call_args_list]
    assert "TICKET_IN_PROGRESS" in events_called


@pytest.mark.asyncio
async def test_mark_ready_transitions_ticket_to_ready(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    service = RoundService(db, publisher=mock_publisher)
    await service.start_kitchen(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    await service.mark_ready(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    assert ticket.status == KitchenTicketStatus.READY
    assert ticket.ready_at is not None

    # TICKET_READY should be in the outbox.
    ticket_events = (
        await db.execute(select(OutboxEvent).where(OutboxEvent.event_type == "TICKET_READY"))
    ).scalars().all()
    assert len(ticket_events) == 1


@pytest.mark.asyncio
async def test_serve_transitions_ticket_to_delivered(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    service = RoundService(db, publisher=mock_publisher)
    await service.start_kitchen(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    await service.mark_ready(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    await service.serve(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    assert ticket.status == KitchenTicketStatus.DELIVERED
    assert ticket.delivered_at is not None

    events_called = [c.args[0] for c in mock_publisher.call_args_list]
    assert "TICKET_DELIVERED" in events_called


# ── Cancellation cascade ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cancel_from_submitted_soft_deletes_ticket(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    service = RoundService(db, publisher=mock_publisher)
    await service.cancel(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER,
        cancel_reason="test",
    )
    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    assert ticket.is_active is False
    # Status does NOT change — there is no CANCELED status in the ticket FSM.
    assert ticket.status == KitchenTicketStatus.IN_PROGRESS


@pytest.mark.asyncio
async def test_cancel_from_pending_no_ticket_no_error(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    """Cancel of a PENDING round has no ticket to touch — idempotent no-op."""
    service = RoundService(db, publisher=mock_publisher)
    await service.create_from_waiter(
        session_id=seeded["session"].id,
        items_input=[
            {"product_id": seeded["product_a"].id, "quantity": 1, "notes": None, "diner_id": None},
        ],
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    r = (await db.execute(select(Round))).scalars().first()
    # Directly cancel PENDING (MANAGER can cancel from any non-terminal state)
    await service.cancel(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER,
        cancel_reason="mistake",
    )
    # No ticket row existed for a never-submitted round.
    tickets = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalars().all()
    assert tickets == []


# ── list_for_kitchen ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_for_kitchen_returns_active_branch_tenant_only(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    ticket_service = TicketService(db)
    rows = await ticket_service.list_for_kitchen(
        branch_id=seeded["branch"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
    )
    assert len(rows) == 1
    assert rows[0].round_id == r.id
    assert rows[0].branch_id == seeded["branch"].id
    assert rows[0].status == KitchenTicketStatus.IN_PROGRESS
    assert len(rows[0].items) == 2


@pytest.mark.asyncio
async def test_list_for_kitchen_excludes_canceled_ticket(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    service = RoundService(db, publisher=mock_publisher)
    await service.cancel(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["MANAGER"].id,
        user_role=UserRole.MANAGER,
        cancel_reason="test",
    )
    ticket_service = TicketService(db)
    rows = await ticket_service.list_for_kitchen(
        branch_id=seeded["branch"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
    )
    assert rows == []


@pytest.mark.asyncio
async def test_list_for_kitchen_rejects_other_branch(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    ticket_service = TicketService(db)
    with pytest.raises(ForbiddenError):
        await ticket_service.list_for_kitchen(
            branch_id=seeded["branch"].id,
            tenant_id=seeded["tenant"].id,
            branch_ids=[999],  # caller has no access
        )


@pytest.mark.asyncio
async def test_list_for_kitchen_status_filter(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    service = RoundService(db, publisher=mock_publisher)
    await service.start_kitchen(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    await service.mark_ready(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )

    ticket_service = TicketService(db)
    in_progress = await ticket_service.list_for_kitchen(
        branch_id=seeded["branch"].id,
        tenant_id=seeded["tenant"].id,
        status_filter=KitchenTicketStatus.IN_PROGRESS,
    )
    assert in_progress == []

    ready = await ticket_service.list_for_kitchen(
        branch_id=seeded["branch"].id,
        tenant_id=seeded["tenant"].id,
        status_filter=KitchenTicketStatus.READY,
    )
    assert len(ready) == 1


# ── set_status delegation ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_status_ready_cascades_to_round(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    service = RoundService(db, publisher=mock_publisher)
    await service.start_kitchen(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    ticket_service = TicketService(db)
    out = await ticket_service.set_status(
        ticket_id=ticket.id,
        target_status="READY",
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    assert out.status == KitchenTicketStatus.READY

    reloaded_round = (await db.execute(select(Round).where(Round.id == r.id))).scalar_one()
    assert reloaded_round.status == RoundStatus.READY


@pytest.mark.asyncio
async def test_set_status_delivered_from_wrong_state_conflicts(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    """Cannot set DELIVERED while round is still IN_KITCHEN — ConflictError from RoundService."""
    r = await _make_submitted_round(db, seeded, mock_publisher)
    service = RoundService(db, publisher=mock_publisher)
    await service.start_kitchen(
        round_id=r.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["KITCHEN"].id,
        user_role=UserRole.KITCHEN,
    )
    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    ticket_service = TicketService(db)
    with pytest.raises(ConflictError):
        await ticket_service.set_status(
            ticket_id=ticket.id,
            target_status="DELIVERED",  # invalid — round is not READY
            tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id],
            user_id=seeded["users"]["KITCHEN"].id,
            user_role=UserRole.KITCHEN,
        )


@pytest.mark.asyncio
async def test_set_status_in_progress_rejected_as_validation(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    ticket_service = TicketService(db)
    with pytest.raises(ValidationError):
        await ticket_service.set_status(
            ticket_id=ticket.id,
            target_status="IN_PROGRESS",  # invalid
            tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id],
            user_id=seeded["users"]["KITCHEN"].id,
            user_role=UserRole.KITCHEN,
        )


@pytest.mark.asyncio
async def test_set_status_cross_tenant_not_found(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    r = await _make_submitted_round(db, seeded, mock_publisher)
    ticket = (
        await db.execute(select(KitchenTicket).where(KitchenTicket.round_id == r.id))
    ).scalar_one()
    ticket_service = TicketService(db)
    with pytest.raises(NotFoundError):
        await ticket_service.set_status(
            ticket_id=ticket.id,
            target_status="READY",
            tenant_id=seeded["foreign"].id,  # wrong tenant
            branch_ids=None,
            user_id=seeded["users"]["KITCHEN"].id,
            user_role=UserRole.KITCHEN,
        )
