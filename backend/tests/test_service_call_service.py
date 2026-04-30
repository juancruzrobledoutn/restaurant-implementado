"""
Tests for ServiceCallService (C-11).

Covers:
  - Create inserts row + writes outbox event in same transaction
  - Duplicate-guard: CREATED or ACKED existing call returns ConflictError with
    a code that the router translates to 409
  - New call allowed after previous is CLOSED
  - ACK transition from CREATED only
  - CLOSE from CREATED or ACKED
  - Invalid transitions (re-ACK, re-CLOSE) return ConflictError
  - list_open default filter excludes CLOSED
  - Multi-tenant isolation
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.outbox import OutboxEvent
from rest_api.models.sector import BranchSector, Table
from rest_api.models.service_call import ServiceCall
from rest_api.models.table_session import TableSession
from rest_api.models.tenant import Tenant
from rest_api.models.user import User
from rest_api.services.domain.service_call_service import ServiceCallService
from shared.config.constants import ServiceCallStatus
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
)


@pytest_asyncio.fixture
async def seeded(db: AsyncSession):
    """Minimal tenant → branch → table → session hierarchy."""
    tenant = Tenant(name="Tenant A")
    db.add(tenant)
    await db.flush()

    foreign = Tenant(name="Tenant B")
    db.add(foreign)
    await db.flush()

    branch = Branch(tenant_id=tenant.id, name="Main", address="X", slug="main")
    db.add(branch)
    foreign_branch = Branch(
        tenant_id=foreign.id, name="Foreign", address="Y", slug="foreign"
    )
    db.add(foreign_branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="Salon")
    foreign_sector = BranchSector(branch_id=foreign_branch.id, name="Bar")
    db.add_all([sector, foreign_sector])
    await db.flush()

    table = Table(
        branch_id=branch.id, sector_id=sector.id, number=1, code="T1",
        capacity=4, status="AVAILABLE",
    )
    foreign_table = Table(
        branch_id=foreign_branch.id, sector_id=foreign_sector.id, number=1,
        code="F1", capacity=4, status="AVAILABLE",
    )
    db.add_all([table, foreign_table])
    await db.flush()

    session = TableSession(table_id=table.id, branch_id=branch.id, status="OPEN")
    foreign_session = TableSession(
        table_id=foreign_table.id, branch_id=foreign_branch.id, status="OPEN"
    )
    db.add_all([session, foreign_session])
    await db.flush()

    users: dict[str, User] = {}
    for role in ("ADMIN", "MANAGER", "WAITER"):
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
        "table": table,
        "session": session, "foreign_session": foreign_session,
        "users": users,
    }


@pytest_asyncio.fixture
async def mock_publisher() -> AsyncMock:
    return AsyncMock()


# ── create ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_inserts_row_and_writes_outbox(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    call = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    assert call.status == ServiceCallStatus.CREATED
    assert call.session_id == seeded["session"].id
    assert call.table_id == seeded["table"].id
    assert call.branch_id == seeded["branch"].id
    assert call.is_active is True

    # Outbox event written in same transaction.
    event = (
        await db.execute(
            select(OutboxEvent).where(OutboxEvent.event_type == "SERVICE_CALL_CREATED")
        )
    ).scalar_one()
    assert event.payload["service_call_id"] == call.id
    assert event.payload["session_id"] == seeded["session"].id

    # No direct publisher call for create (outbox-handled).
    mock_publisher.assert_not_called()


@pytest.mark.asyncio
async def test_duplicate_created_returns_conflict(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    first = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    with pytest.raises(ConflictError) as exc_info:
        await service.create(
            session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
        )
    assert exc_info.value.code == "service_call_already_open"
    assert f"id={first.id}" in str(exc_info.value)


@pytest.mark.asyncio
async def test_duplicate_acked_returns_conflict(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    first = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    await service.ack(
        call_id=first.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    with pytest.raises(ConflictError):
        await service.create(
            session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
        )


@pytest.mark.asyncio
async def test_new_after_closed_succeeds(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    first = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    await service.close(
        call_id=first.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    # Now a new call should be allowed.
    second = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    assert second.id != first.id
    assert second.status == ServiceCallStatus.CREATED


@pytest.mark.asyncio
async def test_create_invalid_session_raises_not_found(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    with pytest.raises(NotFoundError):
        await service.create(session_id=99999, tenant_id=seeded["tenant"].id)


# ── ack ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ack_from_created_succeeds(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    call = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    mock_publisher.reset_mock()
    out = await service.ack(
        call_id=call.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    assert out.status == ServiceCallStatus.ACKED
    assert out.acked_by_id == seeded["users"]["WAITER"].id
    assert out.acked_at is not None
    mock_publisher.assert_called_once()
    assert mock_publisher.call_args[0][0] == "SERVICE_CALL_ACKED"


@pytest.mark.asyncio
async def test_ack_already_acked_conflicts(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    call = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    await service.ack(
        call_id=call.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    with pytest.raises(ConflictError):
        await service.ack(
            call_id=call.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        )


# ── close ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_close_from_created_skips_ack(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    call = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    mock_publisher.reset_mock()
    out = await service.close(
        call_id=call.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    assert out.status == ServiceCallStatus.CLOSED
    assert out.closed_by_id == seeded["users"]["WAITER"].id
    assert out.closed_at is not None
    mock_publisher.assert_called_once()
    assert mock_publisher.call_args[0][0] == "SERVICE_CALL_CLOSED"


@pytest.mark.asyncio
async def test_close_from_acked_succeeds(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    call = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    await service.ack(
        call_id=call.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    out = await service.close(
        call_id=call.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    assert out.status == ServiceCallStatus.CLOSED


@pytest.mark.asyncio
async def test_close_already_closed_conflicts(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    call = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    await service.close(
        call_id=call.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    with pytest.raises(ConflictError):
        await service.close(
            call_id=call.id, tenant_id=seeded["tenant"].id,
            branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
        )


# ── list_open ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_open_default_excludes_closed(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    # Create → close one call
    first = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    await service.close(
        call_id=first.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    # Create another — open
    second = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )

    rows = await service.list_open(
        branch_id=seeded["branch"].id, tenant_id=seeded["tenant"].id,
    )
    assert [c.id for c in rows] == [second.id]


@pytest.mark.asyncio
async def test_list_open_explicit_closed_filter(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    first = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    await service.close(
        call_id=first.id, tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id], user_id=seeded["users"]["WAITER"].id,
    )
    rows = await service.list_open(
        branch_id=seeded["branch"].id,
        tenant_id=seeded["tenant"].id,
        status_filter=[ServiceCallStatus.CLOSED],
    )
    assert len(rows) == 1
    assert rows[0].id == first.id


# ── Multi-tenant isolation ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ack_cross_tenant_not_found(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    call = await service.create(
        session_id=seeded["session"].id, tenant_id=seeded["tenant"].id
    )
    with pytest.raises(NotFoundError):
        await service.ack(
            call_id=call.id, tenant_id=seeded["foreign"].id,  # wrong tenant
            branch_ids=None, user_id=seeded["users"]["WAITER"].id,
        )


@pytest.mark.asyncio
async def test_list_open_rejects_other_branch(
    db: AsyncSession, seeded: dict, mock_publisher: AsyncMock
) -> None:
    service = ServiceCallService(db, publisher=mock_publisher)
    with pytest.raises(ForbiddenError):
        await service.list_open(
            branch_id=seeded["branch"].id,
            tenant_id=seeded["tenant"].id,
            branch_ids=[999],  # no access to this branch
        )
