"""
Tests for the public join endpoint (C-08).

POST /api/public/tables/code/{code}/join?branch_slug={slug}

Coverage:
  16.2  first diner join → activates table + returns token
  16.3  second diner join → reuses existing session
  16.4  join on PAYING session → 409
  16.5  join unknown code → uniform 404
  16.6  join unknown branch_slug → same 404 (no info leak)
  16.7  returned token verifies + grants diner session access
"""
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import Diner, TableSession
from rest_api.models.tenant import Tenant


@pytest_asyncio.fixture
async def seeded_branch_with_table(db: AsyncSession) -> dict:
    """Seed tenant → branch → sector → table for public join tests."""
    tenant = Tenant(name="Restaurant")
    db.add(tenant)
    await db.flush()

    branch = Branch(
        tenant_id=tenant.id,
        name="Main Branch",
        address="Calle 1",
        slug="main-branch",
    )
    db.add(branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="Terraza")
    db.add(sector)
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
    await db.flush()
    await db.commit()

    return {
        "tenant": tenant,
        "branch": branch,
        "sector": sector,
        "table": table,
    }


# ── 16.2 First diner join ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_first_diner_join_activates_table_and_returns_token(
    db_client: TestClient,
    seeded_branch_with_table: dict,
) -> None:
    """First diner joining an inactive table creates a session and returns a token."""
    table = seeded_branch_with_table["table"]
    branch = seeded_branch_with_table["branch"]

    response = db_client.post(
        f"/api/public/tables/code/{table.code}/join",
        params={"branch_slug": branch.slug},
        json={"name": "Maria", "device_id": "dev-123"},
    )

    assert response.status_code == 201, response.text
    data = response.json()
    assert "table_token" in data
    assert data["session_id"] > 0
    assert data["diner_id"] > 0
    assert data["table"]["code"] == table.code
    # Token must be non-empty
    assert len(data["table_token"]) > 10


# ── 16.3 Second diner reuses existing session ─────────────────────────────────

@pytest.mark.asyncio
async def test_second_diner_join_reuses_existing_session(
    db_client: TestClient,
    seeded_branch_with_table: dict,
) -> None:
    """A second diner joining an active table gets the same session_id."""
    table = seeded_branch_with_table["table"]
    branch = seeded_branch_with_table["branch"]

    r1 = db_client.post(
        f"/api/public/tables/code/{table.code}/join",
        params={"branch_slug": branch.slug},
        json={"name": "Ana"},
    )
    r2 = db_client.post(
        f"/api/public/tables/code/{table.code}/join",
        params={"branch_slug": branch.slug},
        json={"name": "Luis"},
    )

    assert r1.status_code == 201
    assert r2.status_code == 201

    data1 = r1.json()
    data2 = r2.json()

    # Same session but different diner IDs
    assert data1["session_id"] == data2["session_id"]
    assert data1["diner_id"] != data2["diner_id"]
    # Different tokens (different diner_id in payload)
    assert data1["table_token"] != data2["table_token"]


# ── 16.4 Join PAYING session → 409 ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_join_on_paying_session_returns_409(
    db: AsyncSession,
    db_client: TestClient,
    seeded_branch_with_table: dict,
) -> None:
    """Joining a PAYING session returns 409."""
    table = seeded_branch_with_table["table"]
    branch = seeded_branch_with_table["branch"]

    # Manually create a PAYING session
    session = TableSession(
        table_id=table.id,
        branch_id=branch.id,
        status="PAYING",
    )
    db.add(session)
    await db.flush()
    await db.commit()

    response = db_client.post(
        f"/api/public/tables/code/{table.code}/join",
        params={"branch_slug": branch.slug},
        json={"name": "Pedro"},
    )

    assert response.status_code == 409


# ── 16.5 Unknown code → uniform 404 ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_join_unknown_code_returns_uniform_404(
    db_client: TestClient,
    seeded_branch_with_table: dict,
) -> None:
    """An unknown table code returns 404 with the standard message."""
    branch = seeded_branch_with_table["branch"]

    response = db_client.post(
        "/api/public/tables/code/NOTEXIST/join",
        params={"branch_slug": branch.slug},
        json={"name": "Ghost"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Mesa no encontrada"


# ── 16.6 Unknown branch_slug → same 404 (no info leak) ────────────────────────

@pytest.mark.asyncio
async def test_join_unknown_branch_slug_returns_uniform_404(
    db_client: TestClient,
    seeded_branch_with_table: dict,
) -> None:
    """An unknown branch_slug returns the exact same 404 body as an unknown code."""
    table = seeded_branch_with_table["table"]

    response = db_client.post(
        f"/api/public/tables/code/{table.code}/join",
        params={"branch_slug": "not-a-real-slug"},
        json={"name": "Ghost"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Mesa no encontrada"


# ── 16.7 Token from join grants diner session access ─────────────────────────

@pytest.mark.asyncio
async def test_returned_token_verifies_and_grants_diner_session_access(
    db_client: TestClient,
    seeded_branch_with_table: dict,
) -> None:
    """Integration: join → use returned token on GET /api/diner/session."""
    table = seeded_branch_with_table["table"]
    branch = seeded_branch_with_table["branch"]

    join_response = db_client.post(
        f"/api/public/tables/code/{table.code}/join",
        params={"branch_slug": branch.slug},
        json={"name": "Integration Tester"},
    )
    assert join_response.status_code == 201
    token = join_response.json()["table_token"]

    session_response = db_client.get(
        "/api/diner/session",
        headers={"X-Table-Token": token},
    )
    assert session_response.status_code == 200, session_response.text
    session_data = session_response.json()
    assert session_data["session"]["status"] == "OPEN"
    assert len(session_data["diners"]) == 1
    assert session_data["diners"][0]["name"] == "Integration Tester"
