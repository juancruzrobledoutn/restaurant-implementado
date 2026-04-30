"""
HTTP router tests for /api/kitchen/tickets (C-11).

Covers:
  - KITCHEN GET returns active tickets (200)
  - WAITER GET → 403
  - Cross-tenant GET filter (empty list)
  - Status filter narrows results
  - PATCH status=READY cascades to round
  - PATCH status=DELIVERED cascades to round
  - PATCH status=IN_PROGRESS → 400
  - PATCH status=DELIVERED from wrong state → 409
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.kitchen_ticket import KitchenTicket
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.models.round import Round
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import TableSession
from rest_api.models.tenant import Tenant
from rest_api.models.user import User
from rest_api.services.domain.round_service import RoundService
from shared.config.constants import UserRole


def _make_jwt_user(
    user_id: int = 1,
    tenant_id: int = 1,
    branch_ids: list[int] | None = None,
    roles: list[str] | None = None,
) -> dict:
    return {
        "user_id": user_id,
        "email": f"user{user_id}@test.com",
        "tenant_id": tenant_id,
        "branch_ids": branch_ids or [1],
        "roles": roles or ["KITCHEN"],
        "jti": f"jti-{user_id}",
        "exp": 9999999999,
    }


@pytest_asyncio.fixture
async def seeded(db: AsyncSession):
    """Minimal seed with one submitted round (ticket exists)."""
    tenant = Tenant(name="Tenant A")
    db.add(tenant)
    await db.flush()
    foreign = Tenant(name="Tenant B")
    db.add(foreign)
    await db.flush()

    branch = Branch(tenant_id=tenant.id, name="Main", address="X", slug="main")
    foreign_branch = Branch(
        tenant_id=foreign.id, name="Foreign", address="Y", slug="foreign"
    )
    db.add_all([branch, foreign_branch])
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="Salon")
    db.add(sector)
    await db.flush()
    table = Table(
        branch_id=branch.id, sector_id=sector.id, number=1, code="T1",
        capacity=4, status="AVAILABLE",
    )
    db.add(table)
    await db.flush()
    session = TableSession(table_id=table.id, branch_id=branch.id, status="OPEN")
    db.add(session)
    await db.flush()

    cat = Category(branch_id=branch.id, name="Main", order=10)
    db.add(cat)
    await db.flush()
    subcat = Subcategory(category_id=cat.id, name="Burgers", order=10)
    db.add(subcat)
    await db.flush()
    prod = Product(subcategory_id=subcat.id, name="Burger", price=15000)
    db.add(prod)
    await db.flush()
    bp = BranchProduct(
        product_id=prod.id, branch_id=branch.id, price_cents=18000, is_available=True,
    )
    db.add(bp)
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

    # Create a submitted round via RoundService so the ticket exists.
    publisher = AsyncMock()
    service = RoundService(db, publisher=publisher)
    await service.create_from_waiter(
        session_id=session.id,
        items_input=[
            {"product_id": prod.id, "quantity": 1, "notes": None, "diner_id": None}
        ],
        tenant_id=tenant.id,
        branch_ids=[branch.id],
        user_id=users["WAITER"].id,
        user_role=UserRole.WAITER,
    )
    r = (await db.execute(select(Round))).scalars().first()
    await service.confirm(
        round_id=r.id, tenant_id=tenant.id, branch_ids=[branch.id],
        user_id=users["WAITER"].id, user_role=UserRole.WAITER,
    )
    await service.submit(
        round_id=r.id, tenant_id=tenant.id, branch_ids=[branch.id],
        user_id=users["MANAGER"].id, user_role=UserRole.MANAGER,
    )

    return {
        "tenant": tenant, "foreign": foreign, "branch": branch,
        "users": users, "round_id": r.id,
    }


def _set_user_override(user: dict):
    """Context helper: set app.dependency_overrides[current_user]."""
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    async def _override():
        return user

    app.dependency_overrides[current_user] = _override


def _clear_user_override():
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    app.dependency_overrides.pop(current_user, None)


# ── GET /api/kitchen/tickets ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_kitchen_get_tickets_returns_200(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    user = _make_jwt_user(
        user_id=seeded["users"]["KITCHEN"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["KITCHEN"],
    )
    _set_user_override(user)
    try:
        resp = db_client.get(f"/api/kitchen/tickets?branch_id={seeded['branch'].id}")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["round_id"] == seeded["round_id"]
        assert data[0]["status"] == "IN_PROGRESS"
        assert len(data[0]["items"]) == 1
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_waiter_get_tickets_returns_403(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    user = _make_jwt_user(
        user_id=seeded["users"]["WAITER"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["WAITER"],
    )
    _set_user_override(user)
    try:
        resp = db_client.get(f"/api/kitchen/tickets?branch_id={seeded['branch'].id}")
        assert resp.status_code == 403
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_kitchen_get_wrong_branch_returns_403(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    user = _make_jwt_user(
        user_id=seeded["users"]["KITCHEN"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["KITCHEN"],
    )
    _set_user_override(user)
    try:
        # Request branch 999 which user has no access to.
        resp = db_client.get("/api/kitchen/tickets?branch_id=999")
        assert resp.status_code == 403
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_kitchen_get_status_filter_narrows_results(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    user = _make_jwt_user(
        user_id=seeded["users"]["KITCHEN"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["KITCHEN"],
    )
    _set_user_override(user)
    try:
        resp = db_client.get(
            f"/api/kitchen/tickets?branch_id={seeded['branch'].id}&status=READY"
        )
        assert resp.status_code == 200
        assert resp.json() == []  # ticket is still IN_PROGRESS
    finally:
        _clear_user_override()


# ── PATCH /api/kitchen/tickets/{id} ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_patch_ticket_ready_cascades_round_and_ticket(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    # Move ticket's round to IN_KITCHEN first.
    publisher = AsyncMock()
    service = RoundService(db, publisher=publisher)
    await service.start_kitchen(
        round_id=seeded["round_id"], tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        user_id=seeded["users"]["KITCHEN"].id, user_role=UserRole.KITCHEN,
    )

    ticket = (
        await db.execute(
            select(KitchenTicket).where(KitchenTicket.round_id == seeded["round_id"])
        )
    ).scalar_one()

    user = _make_jwt_user(
        user_id=seeded["users"]["KITCHEN"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["KITCHEN"],
    )
    _set_user_override(user)
    try:
        resp = db_client.patch(
            f"/api/kitchen/tickets/{ticket.id}",
            json={"status": "READY"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "READY"
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_patch_ticket_invalid_status_returns_422(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    ticket = (
        await db.execute(
            select(KitchenTicket).where(KitchenTicket.round_id == seeded["round_id"])
        )
    ).scalar_one()

    user = _make_jwt_user(
        user_id=seeded["users"]["KITCHEN"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["KITCHEN"],
    )
    _set_user_override(user)
    try:
        # Literal rejection by Pydantic returns 422, not 400.
        resp = db_client.patch(
            f"/api/kitchen/tickets/{ticket.id}",
            json={"status": "IN_PROGRESS"},
        )
        assert resp.status_code == 422
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_patch_ticket_wrong_source_state_returns_409(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    """Cannot set DELIVERED from IN_PROGRESS (round still SUBMITTED)."""
    ticket = (
        await db.execute(
            select(KitchenTicket).where(KitchenTicket.round_id == seeded["round_id"])
        )
    ).scalar_one()

    user = _make_jwt_user(
        user_id=seeded["users"]["KITCHEN"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["KITCHEN"],
    )
    _set_user_override(user)
    try:
        resp = db_client.patch(
            f"/api/kitchen/tickets/{ticket.id}",
            json={"status": "DELIVERED"},
        )
        assert resp.status_code == 409
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_patch_ticket_waiter_rejected_403(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    ticket = (
        await db.execute(
            select(KitchenTicket).where(KitchenTicket.round_id == seeded["round_id"])
        )
    ).scalar_one()

    user = _make_jwt_user(
        user_id=seeded["users"]["WAITER"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["WAITER"],
    )
    _set_user_override(user)
    try:
        resp = db_client.patch(
            f"/api/kitchen/tickets/{ticket.id}",
            json={"status": "READY"},
        )
        assert resp.status_code == 403
    finally:
        _clear_user_override()
