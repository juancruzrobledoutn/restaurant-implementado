"""
Router-level integration tests for /api/customer/* (C-19).

Coverage:
  5.5 GET /api/customer/profile:
        200 with linked customer, 404 diner has no customer,
        401 invalid/missing token
  5.6 POST /api/customer/opt-in:
        201 happy path, 400 consent_required when consent_granted=False,
        409 already_opted_in
  5.7 POST /api/public/tables/code/{code}/join with device_id:
        creates customer and links diner; without device_id: customer_id=NULL;
        flag OFF: customer_id=NULL

Notes:
  - Rate limit tests are skipped — conftest fixture `disable_slowapi_for_tests`
    disables the limiter for the whole test suite to avoid Redis dependency.
    The @limiter.limit() decorators are present in the router source (covered
    by static analysis / unit tests).
  - All DB interactions use the in-memory SQLite test engine via db_client fixture.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from rest_api.models.branch import Branch
from rest_api.models.customer import Customer
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import Diner, TableSession
from rest_api.models.tenant import Tenant
from shared.security.table_token import issue_table_token


# ── Shared seed fixture ────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seeded(db: AsyncSession) -> dict:
    """
    Seed a full tenant → branch → sector → table → session → diner → customer chain.

    Returns a dict with all objects plus a valid table_token string.
    """
    tenant = Tenant(name="Test Restaurant", privacy_salt="test-salt-exactly-32-chars-long!!")
    db.add(tenant)
    await db.flush()

    branch = Branch(
        tenant_id=tenant.id,
        name="Main Branch",
        address="Av. Test 123",
        slug="test-main-branch",
    )
    db.add(branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="Salon")
    db.add(sector)
    await db.flush()

    table = Table(
        branch_id=branch.id,
        sector_id=sector.id,
        number=1,
        code="TBL1",
        capacity=4,
        status="AVAILABLE",
    )
    db.add(table)
    await db.flush()

    session = TableSession(table_id=table.id, branch_id=branch.id, status="OPEN")
    db.add(session)
    await db.flush()

    # Customer (device-tracked)
    customer = Customer(device_id="dev-router-test", tenant_id=tenant.id)
    db.add(customer)
    await db.flush()

    # Diner linked to customer
    diner = Diner(session_id=session.id, name="Router Test Diner", customer_id=customer.id)
    db.add(diner)
    await db.flush()
    await db.commit()

    table_token = issue_table_token(
        session_id=session.id,
        table_id=table.id,
        diner_id=diner.id,
        branch_id=branch.id,
        tenant_id=tenant.id,
    )

    return {
        "tenant": tenant,
        "branch": branch,
        "table": table,
        "session": session,
        "customer": customer,
        "diner": diner,
        "table_token": table_token,
    }


@pytest_asyncio.fixture
async def seeded_no_customer(db: AsyncSession) -> dict:
    """
    Seed a chain where the diner has NO linked customer (anonymous diner).
    """
    tenant = Tenant(name="Anon Restaurant", privacy_salt="anon-salt-exactly-32-chars-long!!")
    db.add(tenant)
    await db.flush()

    branch = Branch(
        tenant_id=tenant.id,
        name="Anon Branch",
        address="Street 0",
        slug="anon-branch",
    )
    db.add(branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="Bar")
    db.add(sector)
    await db.flush()

    table = Table(
        branch_id=branch.id,
        sector_id=sector.id,
        number=99,
        code="ANON",
        capacity=2,
        status="AVAILABLE",
    )
    db.add(table)
    await db.flush()

    session = TableSession(table_id=table.id, branch_id=branch.id, status="OPEN")
    db.add(session)
    await db.flush()

    # Diner with NO customer_id
    diner = Diner(session_id=session.id, name="Anonymous Diner", customer_id=None)
    db.add(diner)
    await db.flush()
    await db.commit()

    table_token = issue_table_token(
        session_id=session.id,
        table_id=table.id,
        diner_id=diner.id,
        branch_id=branch.id,
        tenant_id=tenant.id,
    )

    return {
        "tenant": tenant,
        "branch": branch,
        "table": table,
        "session": session,
        "diner": diner,
        "table_token": table_token,
    }


# ── 5.5: GET /api/customer/profile ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_profile_200_with_linked_customer(
    db_client,
    seeded: dict,
) -> None:
    """GET /api/customer/profile returns 200 with profile when diner has customer."""
    response = db_client.get(
        "/api/customer/profile",
        headers={"X-Table-Token": seeded["table_token"]},
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["id"] == str(seeded["customer"].id)
    assert data["opted_in"] is False
    # device_hint must be prefix of device_id, not the full thing
    assert data["device_hint"] == seeded["customer"].device_id[:7]
    assert "device_id" not in data  # raw device_id MUST NOT appear in response


@pytest.mark.asyncio
async def test_profile_404_when_diner_has_no_customer(
    db_client,
    seeded_no_customer: dict,
) -> None:
    """GET /api/customer/profile returns 404 when diner.customer_id is None."""
    response = db_client.get(
        "/api/customer/profile",
        headers={"X-Table-Token": seeded_no_customer["table_token"]},
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "customer_not_found"


@pytest.mark.asyncio
async def test_profile_401_without_token(
    db_client,
    seeded: dict,
) -> None:
    """GET /api/customer/profile without X-Table-Token returns 422 (missing header)."""
    response = db_client.get("/api/customer/profile")
    # FastAPI returns 422 for missing required header
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_profile_401_with_invalid_token(
    db_client,
) -> None:
    """GET /api/customer/profile with invalid token returns 401."""
    response = db_client.get(
        "/api/customer/profile",
        headers={"X-Table-Token": "this.isnotvalid"},
    )
    assert response.status_code == 401


# ── 5.6: POST /api/customer/opt-in ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_opt_in_201_happy_path(
    db_client,
    seeded: dict,
) -> None:
    """POST /api/customer/opt-in with consent_granted=True returns 201."""
    response = db_client.post(
        "/api/customer/opt-in",
        headers={"X-Table-Token": seeded["table_token"]},
        json={
            "name": "Ana Test",
            "email": "ana@example.com",
            "consent_version": "v1",
            "consent_granted": True,
        },
    )

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["opted_in"] is True
    assert data["name"] == "Ana Test"
    assert data["email"] == "ana@example.com"
    assert data["consent_version"] == "v1"
    # device_id must not be exposed
    assert "device_id" not in data


@pytest.mark.asyncio
async def test_opt_in_400_when_consent_not_granted(
    db_client,
    seeded: dict,
) -> None:
    """POST /api/customer/opt-in with consent_granted=False returns 400."""
    response = db_client.post(
        "/api/customer/opt-in",
        headers={"X-Table-Token": seeded["table_token"]},
        json={
            "name": "Ana Test",
            "email": "ana@example.com",
            "consent_version": "v1",
            "consent_granted": False,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "consent_required"


@pytest.mark.asyncio
async def test_opt_in_409_when_already_opted_in(
    db_client,
    seeded: dict,
) -> None:
    """POST /api/customer/opt-in a second time returns 409 already_opted_in."""
    payload = {
        "name": "Ana Test",
        "email": "ana@example.com",
        "consent_version": "v1",
        "consent_granted": True,
    }

    r1 = db_client.post(
        "/api/customer/opt-in",
        headers={"X-Table-Token": seeded["table_token"]},
        json=payload,
    )
    assert r1.status_code == 201

    r2 = db_client.post(
        "/api/customer/opt-in",
        headers={"X-Table-Token": seeded["table_token"]},
        json=payload,
    )
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "already_opted_in"


@pytest.mark.asyncio
async def test_opt_in_404_when_no_customer(
    db_client,
    seeded_no_customer: dict,
) -> None:
    """POST /api/customer/opt-in when diner has no customer returns 404."""
    response = db_client.post(
        "/api/customer/opt-in",
        headers={"X-Table-Token": seeded_no_customer["table_token"]},
        json={
            "name": "Ghost",
            "email": "ghost@example.com",
            "consent_version": "v1",
            "consent_granted": True,
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "customer_not_found"


# ── 5.7: POST /api/public/tables/code/{code}/join ─────────────────────────────

@pytest_asyncio.fixture
async def join_seed(db: AsyncSession) -> dict:
    """Minimal seed for join endpoint tests (device_id tracking)."""
    tenant = Tenant(name="Join Test Restaurant", privacy_salt="join-salt-exactly-32-chars-long!!")
    db.add(tenant)
    await db.flush()

    branch = Branch(
        tenant_id=tenant.id,
        name="Join Branch",
        address="Join Ave",
        slug="join-branch",
    )
    db.add(branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="Patio")
    db.add(sector)
    await db.flush()

    table = Table(
        branch_id=branch.id,
        sector_id=sector.id,
        number=5,
        code="JOIN1",
        capacity=4,
        status="AVAILABLE",
    )
    db.add(table)
    await db.flush()
    await db.commit()

    return {
        "tenant": tenant,
        "branch": branch,
        "table": table,
    }


@pytest.mark.asyncio
async def test_join_with_device_id_creates_and_links_customer(
    db: AsyncSession,
    db_client,
    join_seed: dict,
) -> None:
    """
    5.7: When joining with device_id + ENABLE_CUSTOMER_TRACKING=True,
    a Customer is created and linked to the diner.
    """
    table = join_seed["table"]
    branch = join_seed["branch"]

    with patch("shared.config.settings.settings.ENABLE_CUSTOMER_TRACKING", True):
        response = db_client.post(
            f"/api/public/tables/code/{table.code}/join",
            params={"branch_slug": branch.slug},
            json={"name": "Tracked Diner", "device_id": "dev-tracked-001"},
        )

    assert response.status_code == 201, response.text
    data = response.json()
    diner_id = data["diner_id"]

    # Diner in DB must have customer_id set
    diner = await db.scalar(select(Diner).where(Diner.id == diner_id))
    assert diner is not None
    assert diner.customer_id is not None

    # Customer must exist for this device + tenant
    customer = await db.scalar(
        select(Customer).where(
            Customer.device_id == "dev-tracked-001",
            Customer.tenant_id == join_seed["tenant"].id,
        )
    )
    assert customer is not None
    assert customer.id == diner.customer_id


@pytest.mark.asyncio
async def test_join_without_device_id_leaves_customer_id_null(
    db: AsyncSession,
    db_client,
    join_seed: dict,
) -> None:
    """
    5.7: When joining WITHOUT device_id, customer_id stays NULL.
    """
    table = join_seed["table"]
    branch = join_seed["branch"]

    response = db_client.post(
        f"/api/public/tables/code/{table.code}/join",
        params={"branch_slug": branch.slug},
        json={"name": "Anonymous Diner"},  # no device_id
    )

    assert response.status_code == 201, response.text
    diner_id = response.json()["diner_id"]

    diner = await db.scalar(select(Diner).where(Diner.id == diner_id))
    assert diner is not None
    assert diner.customer_id is None


@pytest.mark.asyncio
async def test_join_with_tracking_flag_off_leaves_customer_id_null(
    db: AsyncSession,
    db_client,
    join_seed: dict,
) -> None:
    """
    5.7: When ENABLE_CUSTOMER_TRACKING=False, device_id is present but
    customer_id is NOT set — tracking is disabled.
    """
    table = join_seed["table"]
    branch = join_seed["branch"]

    with patch("rest_api.routers.public_tables.settings") as mock_settings:
        mock_settings.ENABLE_CUSTOMER_TRACKING = False

        response = db_client.post(
            f"/api/public/tables/code/{table.code}/join",
            params={"branch_slug": branch.slug},
            json={"name": "Flag Off Diner", "device_id": "dev-flag-off"},
        )

    assert response.status_code == 201, response.text
    diner_id = response.json()["diner_id"]

    diner = await db.scalar(select(Diner).where(Diner.id == diner_id))
    assert diner is not None
    assert diner.customer_id is None

    # No Customer row should have been created for this device
    customer = await db.scalar(
        select(Customer).where(
            Customer.device_id == "dev-flag-off",
            Customer.tenant_id == join_seed["tenant"].id,
        )
    )
    assert customer is None


@pytest.mark.asyncio
async def test_join_same_device_twice_is_idempotent(
    db: AsyncSession,
    db_client,
    join_seed: dict,
) -> None:
    """
    5.7 (bonus): Joining twice with the same device_id links to the SAME customer.
    """
    table = join_seed["table"]
    branch = join_seed["branch"]

    with patch("shared.config.settings.settings.ENABLE_CUSTOMER_TRACKING", True):
        r1 = db_client.post(
            f"/api/public/tables/code/{table.code}/join",
            params={"branch_slug": branch.slug},
            json={"name": "First Join", "device_id": "dev-same-device"},
        )
        r2 = db_client.post(
            f"/api/public/tables/code/{table.code}/join",
            params={"branch_slug": branch.slug},
            json={"name": "Second Join", "device_id": "dev-same-device"},
        )

    assert r1.status_code == 201
    assert r2.status_code == 201

    d1 = await db.scalar(select(Diner).where(Diner.id == r1.json()["diner_id"]))
    d2 = await db.scalar(select(Diner).where(Diner.id == r2.json()["diner_id"]))

    assert d1 is not None and d2 is not None
    assert d1.customer_id is not None
    assert d1.customer_id == d2.customer_id  # same customer, different diner rows
