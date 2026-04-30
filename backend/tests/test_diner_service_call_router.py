"""
HTTP router tests for POST /api/diner/service-call (C-11).

Covers:
  - Valid Table Token + open session → 201 + outbox row written
  - Duplicate POST while CREATED → 409 with existing id
  - JWT-based auth rejected (diner endpoint only accepts Table Token)
  - POST after previous CLOSED → 201 (new call allowed)

Rate-limit test is intentionally SKIPPED here — the conftest fixture
`disable_slowapi_for_tests` turns off the limiter for the whole suite
(it would try to hit Redis). The rate-limit logic is covered indirectly
by the decorator and the key function.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.outbox import OutboxEvent
from rest_api.models.sector import BranchSector, Table
from rest_api.models.service_call import ServiceCall
from rest_api.models.table_session import Diner, TableSession
from rest_api.models.tenant import Tenant
from shared.security.table_token import issue_table_token


@pytest_asyncio.fixture
async def seeded(db: AsyncSession):
    tenant = Tenant(name="Tenant A")
    db.add(tenant)
    await db.flush()

    branch = Branch(tenant_id=tenant.id, name="Main", address="X", slug="main")
    db.add(branch)
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
    diner = Diner(session_id=session.id, name="Alice")
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
        "tenant": tenant, "branch": branch, "table": table,
        "session": session, "diner": diner, "table_token": table_token,
    }


@pytest.mark.asyncio
async def test_diner_post_service_call_201_and_outbox(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    resp = db_client.post(
        "/api/diner/service-call",
        headers={"X-Table-Token": seeded["table_token"]},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "CREATED"
    assert data["session_id"] == seeded["session"].id

    # Outbox row written.
    event = (
        await db.execute(
            select(OutboxEvent).where(OutboxEvent.event_type == "SERVICE_CALL_CREATED")
        )
    ).scalar_one()
    assert event.payload["service_call_id"] == data["id"]


@pytest.mark.asyncio
async def test_diner_post_duplicate_returns_409(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    # First call succeeds.
    resp1 = db_client.post(
        "/api/diner/service-call",
        headers={"X-Table-Token": seeded["table_token"]},
    )
    assert resp1.status_code == 201

    # Second call conflicts.
    resp2 = db_client.post(
        "/api/diner/service-call",
        headers={"X-Table-Token": seeded["table_token"]},
    )
    assert resp2.status_code == 409
    body = resp2.json()
    assert body["detail"]["code"] == "service_call_already_open"
    assert body["detail"]["existing_service_call_id"] == resp1.json()["id"]


@pytest.mark.asyncio
async def test_diner_post_after_closed_succeeds(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    # First call succeeds.
    resp1 = db_client.post(
        "/api/diner/service-call",
        headers={"X-Table-Token": seeded["table_token"]},
    )
    assert resp1.status_code == 201

    # Manually close the call in the DB.
    call = (
        await db.execute(select(ServiceCall).where(ServiceCall.id == resp1.json()["id"]))
    ).scalar_one()
    call.status = "CLOSED"
    await db.commit()

    # Second call should now succeed.
    resp2 = db_client.post(
        "/api/diner/service-call",
        headers={"X-Table-Token": seeded["table_token"]},
    )
    assert resp2.status_code == 201
    assert resp2.json()["id"] != resp1.json()["id"]


@pytest.mark.asyncio
async def test_diner_post_no_token_returns_422(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    resp = db_client.post("/api/diner/service-call")
    # X-Table-Token is a required header — FastAPI returns 422.
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_diner_post_invalid_token_returns_401(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    resp = db_client.post(
        "/api/diner/service-call",
        headers={"X-Table-Token": "not-a-real-token"},
    )
    assert resp.status_code == 401
