"""
Unit/integration tests for AdminBillingService (C-26).

Coverage:
  - test_list_checks_range_too_large: ValidationError when range > 90 days
  - test_list_checks_range_inverted: ValidationError when from > to
  - test_list_checks_tenant_isolation: tenant A cannot see tenant B checks
  - test_list_checks_branch_isolation: branch 42 cannot see branch 99 data
  - test_list_checks_status_filter: status=PAID filters correctly
  - test_list_checks_covered_cents_zero_alloc: 0 allocations → covered_cents = 0
  - test_list_checks_covered_cents_partial: partial allocation tracked correctly
  - test_list_checks_covered_cents_full: full allocation → covered_cents = total_cents
  - test_list_checks_order_desc: results ordered by created_at DESC
  - test_list_checks_pagination: total, total_pages, page, page_size correct
  - test_list_payments_tenant_isolation: tenant isolation on payments
  - test_list_payments_method_filter: method=cash filters correctly
  - test_list_payments_status_filter: status=APPROVED filters correctly
  - test_list_payments_pagination: paginated response shape
  - test_list_payments_excludes_other_branch: branch isolation on payments
"""
from __future__ import annotations

from datetime import date, datetime, timezone, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.billing import Allocation, Charge, Check, Payment
from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import TableSession, Diner
from rest_api.models.tenant import Tenant
from rest_api.services.domain.admin_billing_service import AdminBillingService
from shared.utils.exceptions import ValidationError


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _utc(year: int, month: int, day: int, hour: int = 0) -> datetime:
    return datetime(year, month, day, hour, tzinfo=timezone.utc)


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def basic_env(db: AsyncSession):
    """
    Minimal environment: two tenants, two branches each, one check per branch.

    Layout:
      tenant_a → branch_a (id kept in fixture) → check_a (REQUESTED, 1000 cents)
               → branch_b                       → check_b (PAID, 2000 cents)
      tenant_b → branch_c                       → check_c (REQUESTED, 500 cents)
    """
    tenant_a = Tenant(name="Tenant A")
    tenant_b = Tenant(name="Tenant B")
    db.add_all([tenant_a, tenant_b])
    await db.flush()

    branch_a = Branch(tenant_id=tenant_a.id, name="Branch A", slug="branch-a", address="Addr A")
    branch_b = Branch(tenant_id=tenant_a.id, name="Branch B", slug="branch-b", address="Addr B")
    branch_c = Branch(tenant_id=tenant_b.id, name="Branch C", slug="branch-c", address="Addr C")
    db.add_all([branch_a, branch_b, branch_c])
    await db.flush()

    # Helper: create a minimal session for each branch
    async def _mk_session(branch_id: int) -> TableSession:
        sector = BranchSector(branch_id=branch_id, name="Salon")
        db.add(sector)
        await db.flush()
        table = Table(branch_id=branch_id, sector_id=sector.id, number=1, code="T1", capacity=4, status="AVAILABLE")
        db.add(table)
        await db.flush()
        session = TableSession(table_id=table.id, branch_id=branch_id, status="CLOSED")
        db.add(session)
        await db.flush()
        return session

    session_a = await _mk_session(branch_a.id)
    session_b = await _mk_session(branch_b.id)
    session_c = await _mk_session(branch_c.id)

    # Checks — all on today
    today = datetime.now(tz=timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    check_a = Check(
        session_id=session_a.id,
        branch_id=branch_a.id,
        tenant_id=tenant_a.id,
        total_cents=1000,
        status="REQUESTED",
        created_at=today,
        updated_at=today,
    )
    check_b = Check(
        session_id=session_b.id,
        branch_id=branch_b.id,
        tenant_id=tenant_a.id,
        total_cents=2000,
        status="PAID",
        created_at=today,
        updated_at=today,
    )
    check_c = Check(
        session_id=session_c.id,
        branch_id=branch_c.id,
        tenant_id=tenant_b.id,
        total_cents=500,
        status="REQUESTED",
        created_at=today,
        updated_at=today,
    )
    db.add_all([check_a, check_b, check_c])
    await db.flush()

    # charge_a: 1000 cents, no allocations yet
    charge_a = Charge(check_id=check_a.id, amount_cents=1000, description="Diner 1")
    db.add(charge_a)
    await db.flush()

    return {
        "tenant_a": tenant_a,
        "tenant_b": tenant_b,
        "branch_a": branch_a,
        "branch_b": branch_b,
        "branch_c": branch_c,
        "check_a": check_a,
        "check_b": check_b,
        "check_c": check_c,
        "charge_a": charge_a,
        "today": today.date(),
    }


# ─── Tests — range validation ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_checks_range_too_large(db: AsyncSession) -> None:
    """Range > 90 days raises ValidationError."""
    service = AdminBillingService(db)
    with pytest.raises(ValidationError, match="90"):
        await service.list_checks(
            tenant_id=1,
            branch_id=1,
            from_=date(2026, 1, 1),
            to=date(2026, 4, 5),  # 94 days
            status=None,
            page=1,
            page_size=20,
        )


@pytest.mark.asyncio
async def test_list_checks_range_inverted(db: AsyncSession) -> None:
    """from_ > to raises ValidationError."""
    service = AdminBillingService(db)
    with pytest.raises(ValidationError, match="inicio"):
        await service.list_checks(
            tenant_id=1,
            branch_id=1,
            from_=date(2026, 4, 21),
            to=date(2026, 4, 20),
            status=None,
            page=1,
            page_size=20,
        )


# ─── Tests — tenant isolation ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_checks_tenant_isolation(db: AsyncSession, basic_env: dict) -> None:
    """Tenant A cannot see tenant B checks."""
    env = basic_env
    service = AdminBillingService(db)
    # tenant_a querying branch_c (which belongs to tenant_b) — branch isolation
    result = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_c"].id,
        from_=env["today"],
        to=env["today"],
        status=None,
        page=1,
        page_size=20,
    )
    assert result.total == 0
    assert result.items == []


@pytest.mark.asyncio
async def test_list_checks_branch_isolation(db: AsyncSession, basic_env: dict) -> None:
    """branch_a data is not visible when querying branch_b."""
    env = basic_env
    service = AdminBillingService(db)
    result_a = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=env["today"],
        to=env["today"],
        status=None,
        page=1,
        page_size=20,
    )
    assert result_a.total == 1
    assert result_a.items[0].id == env["check_a"].id

    result_b = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_b"].id,
        from_=env["today"],
        to=env["today"],
        status=None,
        page=1,
        page_size=20,
    )
    assert result_b.total == 1
    assert result_b.items[0].id == env["check_b"].id


# ─── Tests — status filter ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_checks_status_filter(db: AsyncSession, basic_env: dict) -> None:
    """status=PAID filters out REQUESTED checks."""
    env = basic_env
    service = AdminBillingService(db)

    # branch_b has one PAID check
    result = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_b"].id,
        from_=env["today"],
        to=env["today"],
        status="PAID",
        page=1,
        page_size=20,
    )
    assert result.total == 1
    assert result.items[0].status == "PAID"

    # filter by REQUESTED returns nothing for branch_b
    result_r = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_b"].id,
        from_=env["today"],
        to=env["today"],
        status="REQUESTED",
        page=1,
        page_size=20,
    )
    assert result_r.total == 0


# ─── Tests — covered_cents ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_checks_covered_cents_zero_alloc(db: AsyncSession, basic_env: dict) -> None:
    """No allocations → covered_cents = 0."""
    env = basic_env
    service = AdminBillingService(db)
    result = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=env["today"],
        to=env["today"],
        status=None,
        page=1,
        page_size=20,
    )
    assert result.items[0].covered_cents == 0


@pytest.mark.asyncio
async def test_list_checks_covered_cents_partial(db: AsyncSession, basic_env: dict) -> None:
    """Partial allocation → covered_cents = sum of allocations."""
    env = basic_env

    # Add a payment and a partial allocation (400 out of 1000)
    payment = Payment(check_id=env["check_a"].id, amount_cents=400, method="cash", status="APPROVED")
    db.add(payment)
    await db.flush()

    alloc = Allocation(charge_id=env["charge_a"].id, payment_id=payment.id, amount_cents=400)
    db.add(alloc)
    await db.flush()

    service = AdminBillingService(db)
    result = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=env["today"],
        to=env["today"],
        status=None,
        page=1,
        page_size=20,
    )
    assert result.items[0].covered_cents == 400
    assert result.items[0].total_cents == 1000


@pytest.mark.asyncio
async def test_list_checks_covered_cents_full(db: AsyncSession, basic_env: dict) -> None:
    """Full allocation → covered_cents == total_cents."""
    env = basic_env

    payment = Payment(check_id=env["check_a"].id, amount_cents=1000, method="card", status="APPROVED")
    db.add(payment)
    await db.flush()

    alloc = Allocation(charge_id=env["charge_a"].id, payment_id=payment.id, amount_cents=1000)
    db.add(alloc)
    await db.flush()

    service = AdminBillingService(db)
    result = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=env["today"],
        to=env["today"],
        status=None,
        page=1,
        page_size=20,
    )
    assert result.items[0].covered_cents == result.items[0].total_cents == 1000


# ─── Tests — ordering ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_checks_order_desc(db: AsyncSession, basic_env: dict) -> None:
    """Checks are returned ordered by created_at DESC."""
    env = basic_env
    today = env["today"]

    # Add a second check in branch_a with an earlier created_at
    sector = BranchSector(branch_id=env["branch_a"].id, name="Bar")
    db.add(sector)
    await db.flush()
    table2 = Table(
        branch_id=env["branch_a"].id, sector_id=sector.id,
        number=2, code="T2", capacity=2, status="AVAILABLE",
    )
    db.add(table2)
    await db.flush()
    session2 = TableSession(table_id=table2.id, branch_id=env["branch_a"].id, status="CLOSED")
    db.add(session2)
    await db.flush()

    older_dt = datetime(today.year, today.month, today.day, 8, 0, 0, tzinfo=timezone.utc)
    check_old = Check(
        session_id=session2.id,
        branch_id=env["branch_a"].id,
        tenant_id=env["tenant_a"].id,
        total_cents=500,
        status="REQUESTED",
        created_at=older_dt,
        updated_at=older_dt,
    )
    db.add(check_old)
    await db.flush()

    service = AdminBillingService(db)
    result = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=today,
        to=today,
        status=None,
        page=1,
        page_size=20,
    )
    assert result.total == 2
    # Latest check (check_a at 12:00) should come first
    assert result.items[0].id == env["check_a"].id
    assert result.items[1].id == check_old.id


# ─── Tests — pagination ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_checks_pagination(db: AsyncSession, basic_env: dict) -> None:
    """Pagination returns correct total, total_pages, page, page_size."""
    env = basic_env
    today = env["today"]

    # Add 4 more checks to branch_a → total 5
    sector = BranchSector(branch_id=env["branch_a"].id, name="Patio")
    db.add(sector)
    await db.flush()

    for i in range(4):
        t = Table(
            branch_id=env["branch_a"].id, sector_id=sector.id,
            number=10 + i, code=f"T{10+i}", capacity=2, status="AVAILABLE",
        )
        db.add(t)
        await db.flush()
        s = TableSession(table_id=t.id, branch_id=env["branch_a"].id, status="CLOSED")
        db.add(s)
        await db.flush()
        dt = datetime(today.year, today.month, today.day, 10 + i, 0, 0, tzinfo=timezone.utc)
        c = Check(
            session_id=s.id,
            branch_id=env["branch_a"].id,
            tenant_id=env["tenant_a"].id,
            total_cents=100 * (i + 1),
            status="REQUESTED",
            created_at=dt,
            updated_at=dt,
        )
        db.add(c)
        await db.flush()

    service = AdminBillingService(db)
    result_p1 = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=today,
        to=today,
        status=None,
        page=1,
        page_size=2,
    )
    assert result_p1.total == 5
    assert result_p1.total_pages == 3
    assert result_p1.page == 1
    assert result_p1.page_size == 2
    assert len(result_p1.items) == 2

    result_p3 = await service.list_checks(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=today,
        to=today,
        status=None,
        page=3,
        page_size=2,
    )
    assert len(result_p3.items) == 1  # last page has only 1 item


# ─── Tests — payments ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_payments_tenant_isolation(db: AsyncSession, basic_env: dict) -> None:
    """tenant_a cannot see payments from tenant_b branch."""
    env = basic_env

    payment_c = Payment(
        check_id=env["check_c"].id, amount_cents=500, method="cash", status="APPROVED",
    )
    db.add(payment_c)
    await db.flush()

    service = AdminBillingService(db)
    # Query tenant_a on branch_c → 0 results
    result = await service.list_payments(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_c"].id,
        from_=env["today"],
        to=env["today"],
        method=None,
        status=None,
        page=1,
        page_size=20,
    )
    assert result.total == 0


@pytest.mark.asyncio
async def test_list_payments_method_filter(db: AsyncSession, basic_env: dict) -> None:
    """method=cash filters out card payments."""
    env = basic_env

    payment_cash = Payment(check_id=env["check_a"].id, amount_cents=400, method="cash", status="APPROVED")
    payment_card = Payment(check_id=env["check_a"].id, amount_cents=600, method="card", status="APPROVED")
    db.add_all([payment_cash, payment_card])
    await db.flush()

    service = AdminBillingService(db)
    result = await service.list_payments(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=env["today"],
        to=env["today"],
        method="cash",
        status=None,
        page=1,
        page_size=20,
    )
    assert result.total == 1
    assert result.items[0].method == "cash"


@pytest.mark.asyncio
async def test_list_payments_status_filter(db: AsyncSession, basic_env: dict) -> None:
    """status=APPROVED filters out REJECTED payments."""
    env = basic_env

    payment_ok = Payment(check_id=env["check_a"].id, amount_cents=400, method="cash", status="APPROVED")
    payment_ko = Payment(check_id=env["check_a"].id, amount_cents=600, method="mercadopago", status="REJECTED")
    db.add_all([payment_ok, payment_ko])
    await db.flush()

    service = AdminBillingService(db)
    result = await service.list_payments(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=env["today"],
        to=env["today"],
        method=None,
        status="APPROVED",
        page=1,
        page_size=20,
    )
    assert result.total == 1
    assert result.items[0].status == "APPROVED"


@pytest.mark.asyncio
async def test_list_payments_pagination(db: AsyncSession, basic_env: dict) -> None:
    """Paginated payments response has correct shape."""
    env = basic_env

    for i in range(5):
        p = Payment(check_id=env["check_a"].id, amount_cents=100, method="cash", status="APPROVED")
        db.add(p)
    await db.flush()

    service = AdminBillingService(db)
    result = await service.list_payments(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=env["today"],
        to=env["today"],
        method=None,
        status=None,
        page=1,
        page_size=3,
    )
    assert result.total == 5
    assert result.total_pages == 2
    assert len(result.items) == 3


@pytest.mark.asyncio
async def test_list_payments_excludes_other_branch(db: AsyncSession, basic_env: dict) -> None:
    """Payments from branch_b are not visible when querying branch_a."""
    env = basic_env

    payment_b = Payment(check_id=env["check_b"].id, amount_cents=2000, method="card", status="APPROVED")
    db.add(payment_b)
    await db.flush()

    service = AdminBillingService(db)
    result_a = await service.list_payments(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_a"].id,
        from_=env["today"],
        to=env["today"],
        method=None,
        status=None,
        page=1,
        page_size=20,
    )
    # branch_a has no payments
    assert result_a.total == 0

    result_b = await service.list_payments(
        tenant_id=env["tenant_a"].id,
        branch_id=env["branch_b"].id,
        from_=env["today"],
        to=env["today"],
        method=None,
        status=None,
        page=1,
        page_size=20,
    )
    assert result_b.total == 1
    assert result_b.items[0].check_id == env["check_b"].id


# ─── Test N+1 — task 3.5 ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_checks_no_n_plus_1(db: AsyncSession, basic_env: dict) -> None:
    """
    list_checks for 20 checks executes at most 3 SQL queries:
      1. COUNT query
      2. SELECT rows with covered_cents correlated subquery
      (SQLite may split the correlated subquery into a separate statement,
       but the service should not issue one query per row.)

    Strategy: register a synchronous SQLAlchemy event listener on the
    underlying sync engine to count executed statements, then call the service
    and assert the count is <= 3.
    """
    env = basic_env
    today = env["today"]
    branch_id = env["branch_a"].id
    tenant_id = env["tenant_a"].id

    # Create 19 more checks in branch_a (total 20 including the one from basic_env)
    sector = BranchSector(branch_id=branch_id, name="N+1 sector")
    db.add(sector)
    await db.flush()

    for i in range(19):
        t = Table(
            branch_id=branch_id, sector_id=sector.id,
            number=100 + i, code=f"N{100+i}", capacity=2, status="AVAILABLE",
        )
        db.add(t)
        await db.flush()
        s = TableSession(table_id=t.id, branch_id=branch_id, status="CLOSED")
        db.add(s)
        await db.flush()
        dt = datetime(today.year, today.month, today.day, 6, i % 60, 0, tzinfo=timezone.utc)
        c = Check(
            session_id=s.id,
            branch_id=branch_id,
            tenant_id=tenant_id,
            total_cents=100 * (i + 1),
            status="REQUESTED",
            created_at=dt,
            updated_at=dt,
        )
        db.add(c)
        await db.flush()

    # Count SQL statements issued by the service (excluding setup queries above)
    query_count = 0

    def _count_query(conn, cursor, statement, parameters, context, executemany):  # noqa: ARG001
        nonlocal query_count
        query_count += 1

    from sqlalchemy import event as sa_event

    sync_engine = db.get_bind()
    sa_event.listen(sync_engine, "before_cursor_execute", _count_query)

    try:
        service = AdminBillingService(db)
        result = await service.list_checks(
            tenant_id=tenant_id,
            branch_id=branch_id,
            from_=today,
            to=today,
            status=None,
            page=1,
            page_size=20,
        )
    finally:
        sa_event.remove(sync_engine, "before_cursor_execute", _count_query)

    # 20 checks were created (1 from basic_env + 19 above)
    assert result.total == 20
    assert len(result.items) == 20

    # At most 3 queries: 1 COUNT + 1 SELECT with correlated subquery
    # (SQLite may add 1 extra for the correlated scalar, total ≤ 3)
    assert query_count <= 3, (
        f"Expected ≤3 queries for list_checks with 20 rows, got {query_count}. "
        "Possible N+1 regression."
    )
