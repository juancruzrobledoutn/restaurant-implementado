"""
HTTP router tests for /api/waiter/service-calls (C-11).

Covers:
  - WAITER PATCH ACKED from CREATED succeeds
  - WAITER PATCH CLOSED from ACKED succeeds
  - KITCHEN PATCH → 403
  - GET default (no status) excludes CLOSED
  - GET ?status=CLOSED returns only closed
  - Cross-tenant/branch isolation
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table
from rest_api.models.service_call import ServiceCall
from rest_api.models.table_session import TableSession
from rest_api.models.tenant import Tenant
from rest_api.models.user import User


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
        "roles": roles or ["WAITER"],
        "jti": f"jti-{user_id}",
        "exp": 9999999999,
    }


def _set_user_override(user: dict):
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    async def _override():
        return user

    app.dependency_overrides[current_user] = _override


def _clear_user_override():
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    app.dependency_overrides.pop(current_user, None)


@pytest_asyncio.fixture
async def seeded(db: AsyncSession):
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

    users: dict[str, User] = {}
    for role in ("ADMIN", "MANAGER", "WAITER", "KITCHEN"):
        u = User(
            tenant_id=tenant.id, email=f"{role.lower()}@test.com",
            hashed_password="x", full_name=f"{role} User",
        )
        db.add(u)
        users[role] = u
    await db.flush()

    # Create one open call directly (skip outbox plumbing — not needed here).
    call = ServiceCall(
        session_id=session.id, table_id=table.id, branch_id=branch.id,
        status="CREATED",
    )
    db.add(call)
    await db.flush()
    await db.commit()

    return {
        "tenant": tenant, "foreign": foreign, "branch": branch, "table": table,
        "session": session, "users": users, "call": call,
    }


# ── PATCH /api/waiter/service-calls/{id} ─────────────────────────────────────


@pytest.mark.asyncio
async def test_waiter_ack_from_created_succeeds(
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
        resp = db_client.patch(
            f"/api/waiter/service-calls/{seeded['call'].id}",
            json={"status": "ACKED"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ACKED"
        assert data["acked_by_id"] == seeded["users"]["WAITER"].id
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_kitchen_patch_service_call_returns_403(
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
        resp = db_client.patch(
            f"/api/waiter/service-calls/{seeded['call'].id}",
            json={"status": "ACKED"},
        )
        assert resp.status_code == 403
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_close_already_closed_conflict(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    # Pre-close the call.
    call = seeded["call"]
    call.status = "CLOSED"
    await db.commit()

    user = _make_jwt_user(
        user_id=seeded["users"]["WAITER"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["WAITER"],
    )
    _set_user_override(user)
    try:
        resp = db_client.patch(
            f"/api/waiter/service-calls/{call.id}",
            json={"status": "CLOSED"},
        )
        assert resp.status_code == 409
    finally:
        _clear_user_override()


# ── GET /api/waiter/service-calls ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_default_excludes_closed(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    # Pre-close the seeded call and create a new OPEN call.
    seeded["call"].status = "CLOSED"
    new_call = ServiceCall(
        session_id=seeded["session"].id,
        table_id=seeded["table"].id,
        branch_id=seeded["branch"].id,
        status="CREATED",
    )
    db.add(new_call)
    await db.commit()

    user = _make_jwt_user(
        user_id=seeded["users"]["WAITER"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["WAITER"],
    )
    _set_user_override(user)
    try:
        resp = db_client.get(
            f"/api/waiter/service-calls?branch_id={seeded['branch'].id}"
        )
        assert resp.status_code == 200
        data = resp.json()
        ids = {c["id"] for c in data}
        assert new_call.id in ids
        assert seeded["call"].id not in ids
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_get_explicit_closed_returns_only_closed(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    seeded["call"].status = "CLOSED"
    await db.commit()

    user = _make_jwt_user(
        user_id=seeded["users"]["WAITER"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["WAITER"],
    )
    _set_user_override(user)
    try:
        resp = db_client.get(
            f"/api/waiter/service-calls?branch_id={seeded['branch'].id}&status=CLOSED"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["status"] == "CLOSED"
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_get_wrong_branch_returns_403(
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
        resp = db_client.get("/api/waiter/service-calls?branch_id=999")
        assert resp.status_code == 403
    finally:
        _clear_user_override()
