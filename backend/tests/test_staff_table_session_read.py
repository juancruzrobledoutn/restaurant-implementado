"""
Tests for staff table session read endpoints (C-08).

Coverage:
  17.2  get session by table_id → 200 for authorized user
  17.3  get session by table_id → 404 when no active session
  17.4  get session by code → 400 without branch_slug
  17.5  get session by code disambiguates by branch_slug
  17.6  get session from foreign tenant → 403 or 404
"""
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import TableSession
from rest_api.models.tenant import Tenant


def _make_user(tenant_id: int, branch_ids: list[int], role: str = "MANAGER") -> dict:
    return {
        "user_id": 1,
        "email": "staff@test.com",
        "tenant_id": tenant_id,
        "branch_ids": branch_ids,
        "roles": [role],
        "jti": "test-jti",
        "exp": 9999999999,
    }


@pytest_asyncio.fixture
async def seeded(db: AsyncSession) -> dict:
    """Seed two tenants/branches/tables for isolation tests."""
    tenant1 = Tenant(name="Tenant1")
    tenant2 = Tenant(name="Tenant2")
    db.add(tenant1)
    db.add(tenant2)
    await db.flush()

    branch1 = Branch(tenant_id=tenant1.id, name="B1", address="A1", slug="b1")
    branch2 = Branch(tenant_id=tenant2.id, name="B2", address="A2", slug="b2")
    db.add(branch1)
    db.add(branch2)
    await db.flush()

    # Two branches in tenant1 with same table code to test disambiguation
    branch1b = Branch(tenant_id=tenant1.id, name="B1b", address="A1b", slug="b1b")
    db.add(branch1b)
    await db.flush()

    sector1 = BranchSector(branch_id=branch1.id, name="S1")
    sector2 = BranchSector(branch_id=branch2.id, name="S2")
    sector1b = BranchSector(branch_id=branch1b.id, name="S1b")
    for s in (sector1, sector2, sector1b):
        db.add(s)
    await db.flush()

    table1 = Table(
        branch_id=branch1.id, sector_id=sector1.id,
        number=1, code="T1", capacity=4, status="OCCUPIED",
    )
    table2 = Table(
        branch_id=branch2.id, sector_id=sector2.id,
        number=1, code="T1", capacity=4, status="OCCUPIED",
    )
    # Same code "T1" in a different branch of tenant1
    table1b = Table(
        branch_id=branch1b.id, sector_id=sector1b.id,
        number=1, code="T1", capacity=4, status="OCCUPIED",
    )
    for t in (table1, table2, table1b):
        db.add(t)
    await db.flush()

    session1 = TableSession(table_id=table1.id, branch_id=branch1.id, status="OPEN")
    session1b = TableSession(table_id=table1b.id, branch_id=branch1b.id, status="OPEN")
    db.add(session1)
    db.add(session1b)
    await db.flush()
    await db.commit()

    return {
        "tenant1": tenant1,
        "tenant2": tenant2,
        "branch1": branch1,
        "branch2": branch2,
        "branch1b": branch1b,
        "table1": table1,
        "table2": table2,
        "table1b": table1b,
        "session1": session1,
        "session1b": session1b,
    }


# ── 17.2 Get session by table_id → 200 ───────────────────────────────────────

def test_get_session_by_table_id_returns_200_for_authorized_user(
    db_client: TestClient,
    seeded: dict,
) -> None:
    """Authorized staff can fetch the active session for a table."""
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    table = seeded["table1"]
    branch = seeded["branch1"]
    tenant = seeded["tenant1"]

    user = _make_user(tenant_id=tenant.id, branch_ids=[branch.id])
    app.dependency_overrides[current_user] = lambda: user

    try:
        response = db_client.get(f"/api/tables/{table.id}/session")
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["table_id"] == table.id
        assert data["status"] == "OPEN"
    finally:
        app.dependency_overrides.pop(current_user, None)


# ── 17.3 Get session by table_id → 404 when no active session ────────────────

def test_get_session_by_table_id_returns_404_when_no_active_session(
    db_client: TestClient,
    seeded: dict,
) -> None:
    """A table with no active session returns 404."""
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    table2 = seeded["table2"]
    branch2 = seeded["branch2"]
    tenant2 = seeded["tenant2"]

    user = _make_user(tenant_id=tenant2.id, branch_ids=[branch2.id])
    app.dependency_overrides[current_user] = lambda: user

    try:
        # table2 has no session
        response = db_client.get(f"/api/tables/{table2.id}/session")
        assert response.status_code == 404
    finally:
        app.dependency_overrides.pop(current_user, None)


# ── 17.4 Missing branch_slug → 400 ───────────────────────────────────────────

def test_get_session_by_code_requires_branch_slug_returns_400_without_it(
    db_client: TestClient,
    seeded: dict,
) -> None:
    """GET /api/tables/code/{code}/session without branch_slug returns 422 (required param)."""
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    tenant = seeded["tenant1"]
    branch = seeded["branch1"]

    user = _make_user(tenant_id=tenant.id, branch_ids=[branch.id])
    app.dependency_overrides[current_user] = lambda: user

    try:
        response = db_client.get("/api/tables/code/T1/session")
        # FastAPI returns 422 when a required Query parameter is missing
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(current_user, None)


# ── 17.5 Code with branch_slug disambiguates ──────────────────────────────────

def test_get_session_by_code_disambiguates_by_branch_slug(
    db_client: TestClient,
    seeded: dict,
) -> None:
    """Two branches with the same code return different sessions based on slug."""
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    tenant = seeded["tenant1"]
    branch1 = seeded["branch1"]
    branch1b = seeded["branch1b"]
    session1 = seeded["session1"]
    session1b = seeded["session1b"]

    # Admin user sees all branches
    user = _make_user(tenant_id=tenant.id, branch_ids=[branch1.id, branch1b.id], role="ADMIN")
    app.dependency_overrides[current_user] = lambda: user

    try:
        r1 = db_client.get(
            "/api/tables/code/T1/session",
            params={"branch_slug": branch1.slug},
        )
        r2 = db_client.get(
            "/api/tables/code/T1/session",
            params={"branch_slug": branch1b.slug},
        )

        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["id"] == session1.id
        assert r2.json()["id"] == session1b.id
        assert r1.json()["id"] != r2.json()["id"]
    finally:
        app.dependency_overrides.pop(current_user, None)


# ── 17.6 Foreign tenant → 403 or 404 ─────────────────────────────────────────

def test_get_session_foreign_tenant_returns_403_or_404(
    db_client: TestClient,
    seeded: dict,
) -> None:
    """A user from tenant1 cannot access tenant2's table session."""
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    tenant1 = seeded["tenant1"]
    branch1 = seeded["branch1"]
    table2 = seeded["table2"]  # belongs to tenant2

    # User is tenant1, trying to access tenant2's table
    user = _make_user(tenant_id=tenant1.id, branch_ids=[branch1.id])
    app.dependency_overrides[current_user] = lambda: user

    try:
        response = db_client.get(f"/api/tables/{table2.id}/session")
        # Should get 404 (not found for this tenant) — no 200 with cross-tenant data
        assert response.status_code in (403, 404)
    finally:
        app.dependency_overrides.pop(current_user, None)
