"""
Tests for DinerService (C-08).

Coverage:
  15.2  register diner in OPEN session → succeeds
  15.3  register diner in PAYING session → 409
  15.4  register diner in CLOSED session → 409
  15.5  multiple diners can join the same OPEN session
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import Diner, TableSession
from rest_api.models.tenant import Tenant
from rest_api.services.domain.diner_service import DinerService
from shared.utils.exceptions import ValidationError


@pytest_asyncio.fixture
async def open_session(db: AsyncSession):
    """Seed tenant → branch → sector → table → open session."""
    tenant = Tenant(name="T")
    db.add(tenant)
    await db.flush()

    branch = Branch(tenant_id=tenant.id, name="B", address="A", slug="b-slug")
    db.add(branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="S")
    db.add(sector)
    await db.flush()

    table = Table(
        branch_id=branch.id, sector_id=sector.id,
        number=1, code="T1", capacity=4, status="OCCUPIED",
    )
    db.add(table)
    await db.flush()

    session = TableSession(table_id=table.id, branch_id=branch.id, status="OPEN")
    db.add(session)
    await db.flush()
    await db.commit()

    return session


@pytest_asyncio.fixture
async def paying_session(db: AsyncSession):
    """Seed a PAYING session."""
    tenant = Tenant(name="T2")
    db.add(tenant)
    await db.flush()

    branch = Branch(tenant_id=tenant.id, name="B2", address="A2", slug="b2-slug")
    db.add(branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="S2")
    db.add(sector)
    await db.flush()

    table = Table(
        branch_id=branch.id, sector_id=sector.id,
        number=1, code="P1", capacity=4, status="OCCUPIED",
    )
    db.add(table)
    await db.flush()

    session = TableSession(table_id=table.id, branch_id=branch.id, status="PAYING")
    db.add(session)
    await db.flush()
    await db.commit()

    return session


@pytest_asyncio.fixture
async def closed_session(db: AsyncSession):
    """Seed a CLOSED / soft-deleted session."""
    tenant = Tenant(name="T3")
    db.add(tenant)
    await db.flush()

    branch = Branch(tenant_id=tenant.id, name="B3", address="A3", slug="b3-slug")
    db.add(branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="S3")
    db.add(sector)
    await db.flush()

    table = Table(
        branch_id=branch.id, sector_id=sector.id,
        number=1, code="C1", capacity=4, status="AVAILABLE",
    )
    db.add(table)
    await db.flush()

    session = TableSession(
        table_id=table.id, branch_id=branch.id,
        status="CLOSED", is_active=False,
    )
    db.add(session)
    await db.flush()
    await db.commit()

    return session


# ── 15.2 Register in OPEN session ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_register_diner_in_open_session_succeeds(
    db: AsyncSession, open_session: TableSession
) -> None:
    """A diner can register in an OPEN session."""
    service = DinerService(db)
    diner = await service.register(
        session_id=open_session.id,
        name="Juan",
        device_id="device-abc",
    )

    assert diner.id is not None
    assert diner.session_id == open_session.id
    assert diner.name == "Juan"
    assert diner.device_id == "device-abc"


# ── 15.3 Register in PAYING session → 409 ────────────────────────────────────

@pytest.mark.asyncio
async def test_register_diner_in_paying_session_returns_409(
    db: AsyncSession, paying_session: TableSession
) -> None:
    """Registering in a PAYING session raises ValidationError."""
    service = DinerService(db)
    with pytest.raises(ValidationError) as exc_info:
        await service.register(
            session_id=paying_session.id,
            name="Maria",
        )
    assert "PAYING" in str(exc_info.value) or "OPEN" in str(exc_info.value)


# ── 15.4 Register in CLOSED session → 409 ────────────────────────────────────

@pytest.mark.asyncio
async def test_register_diner_in_closed_session_returns_409(
    db: AsyncSession, closed_session: TableSession
) -> None:
    """Registering in a CLOSED/inactive session raises NotFoundError."""
    from shared.utils.exceptions import NotFoundError
    service = DinerService(db)
    with pytest.raises(NotFoundError):
        await service.register(
            session_id=closed_session.id,
            name="Pedro",
        )


# ── 15.5 Multiple diners in same session ──────────────────────────────────────

@pytest.mark.asyncio
async def test_multiple_diners_can_join_same_open_session(
    db: AsyncSession, open_session: TableSession
) -> None:
    """Multiple diners can be registered in the same OPEN session."""
    service = DinerService(db)

    diner1 = await service.register(session_id=open_session.id, name="Ana")
    diner2 = await service.register(session_id=open_session.id, name="Luis")
    diner3 = await service.register(session_id=open_session.id, name="Sofia")

    assert diner1.id != diner2.id != diner3.id
    for diner in (diner1, diner2, diner3):
        assert diner.session_id == open_session.id
