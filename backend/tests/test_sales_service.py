"""
Unit/integration tests for SalesService (C-16).

Coverage:
  - test_daily_kpis_aggregates_only_paid_checks
  - test_daily_kpis_zero_when_no_sales
  - test_daily_kpis_excludes_other_tenants
  - test_daily_kpis_excludes_other_branches
  - test_daily_kpis_date_bounds_respected
  - test_top_products_ordered_by_revenue_desc
  - test_top_products_excludes_voided_items
  - test_top_products_respects_limit
  - test_top_products_empty_when_no_sales
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.billing import Allocation, Charge, Check, Payment
from rest_api.models.branch import Branch
from rest_api.models.menu import Category, Product, Subcategory, BranchProduct
from rest_api.models.round import Round, RoundItem
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import Diner, TableSession
from rest_api.models.tenant import Tenant
from rest_api.services.domain.sales_service import SalesService


# ── Helpers ──────────────────────────────────────────────────────────────────

def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seed(db: AsyncSession):
    """
    Seed base scenario: 2 tenants, 2 branches (one per tenant),
    a sector, a table, a product, a session with 2 diners.
    Returns dict with all entities.
    """
    tenant_a = Tenant(name="Tenant A")
    tenant_b = Tenant(name="Tenant B")
    db.add_all([tenant_a, tenant_b])
    await db.flush()

    branch_a = Branch(tenant_id=tenant_a.id, name="Branch A", slug="branch-a", address="Addr A")
    branch_b = Branch(tenant_id=tenant_b.id, name="Branch B", slug="branch-b", address="Addr B")
    db.add_all([branch_a, branch_b])
    await db.flush()

    sector_a = BranchSector(branch_id=branch_a.id, name="Salon")
    db.add(sector_a)
    await db.flush()

    table_a = Table(branch_id=branch_a.id, sector_id=sector_a.id, number=1, code="T1", capacity=4, status="AVAILABLE")
    db.add(table_a)
    await db.flush()

    cat = Category(branch_id=branch_a.id, name="Comidas", order=1)
    db.add(cat)
    await db.flush()
    sub = Subcategory(category_id=cat.id, name="Platos", order=1)
    db.add(sub)
    await db.flush()
    prod_a = Product(subcategory_id=sub.id, name="Milanesa", description="", price=1000)
    prod_b = Product(subcategory_id=sub.id, name="Ensalada", description="", price=500)
    db.add_all([prod_a, prod_b])
    await db.flush()

    return {
        "tenant_a": tenant_a,
        "tenant_b": tenant_b,
        "branch_a": branch_a,
        "branch_b": branch_b,
        "table_a": table_a,
        "prod_a": prod_a,
        "prod_b": prod_b,
    }


async def _create_paid_check(
    db: AsyncSession,
    *,
    branch,
    table,
    prod,
    quantity: int = 1,
    price_cents: int = 1000,
    total_cents: int = 1000,
    check_created_at: datetime | None = None,
    num_diners: int = 1,
) -> Check:
    """Helper: build session → diner(s) → round → round_item → check → payment (APPROVED)."""
    session = TableSession(table_id=table.id, branch_id=branch.id, status="OPEN")
    db.add(session)
    await db.flush()

    for _ in range(num_diners):
        diner = Diner(session_id=session.id, name="Diner")
        db.add(diner)
    await db.flush()

    rnd = Round(
        session_id=session.id,
        branch_id=branch.id,
        round_number=1,
        status="SERVED",
        created_by_role="WAITER",
    )
    db.add(rnd)
    await db.flush()

    item = RoundItem(
        round_id=rnd.id,
        product_id=prod.id,
        quantity=quantity,
        price_cents_snapshot=price_cents,
        is_voided=False,
    )
    db.add(item)
    await db.flush()

    check = Check(
        session_id=session.id,
        branch_id=branch.id,
        tenant_id=branch.tenant_id,
        total_cents=total_cents,
        status="PAID",
    )
    db.add(check)
    await db.flush()

    if check_created_at is not None:
        # Override created_at for temporal bound tests
        from sqlalchemy import update
        from rest_api.models.billing import Check as CheckModel
        await db.execute(
            update(CheckModel).where(CheckModel.id == check.id).values(created_at=check_created_at)
        )
        await db.flush()

    payment = Payment(
        check_id=check.id,
        amount_cents=total_cents,
        method="cash",
        status="APPROVED",
    )
    db.add(payment)
    await db.flush()

    # Close session so subsequent calls for the same table don't violate the
    # single-active-session unique index (partial on PG, full on SQLite).
    session.status = "CLOSED"
    await db.flush()

    return check


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_daily_kpis_aggregates_only_paid_checks(db: AsyncSession, seed):
    """Only PAID checks contribute to revenue; REQUESTED checks are excluded."""
    branch_a = seed["branch_a"]
    table_a = seed["table_a"]
    prod_a = seed["prod_a"]
    tenant_a = seed["tenant_a"]

    target = date(2025, 1, 15)
    ts = datetime(2025, 1, 15, 12, 0, 0, tzinfo=timezone.utc)

    # PAID check
    await _create_paid_check(db, branch=branch_a, table=table_a, prod=prod_a,
                              quantity=1, price_cents=1000, total_cents=1000,
                              check_created_at=ts)

    # REQUESTED (not PAID) check — create manually
    session2 = TableSession(table_id=table_a.id, branch_id=branch_a.id, status="PAYING")
    db.add(session2)
    await db.flush()
    check_req = Check(
        session_id=session2.id,
        branch_id=branch_a.id,
        tenant_id=tenant_a.id,
        total_cents=500,
        status="REQUESTED",
    )
    db.add(check_req)
    await db.flush()
    from sqlalchemy import update
    from rest_api.models.billing import Check as CheckModel
    await db.execute(update(CheckModel).where(CheckModel.id == check_req.id).values(created_at=ts))

    service = SalesService(db)
    result = await service.get_daily_kpis(branch_a.id, target, tenant_a.id)

    assert result.orders == 1
    assert result.revenue_cents == 1000


@pytest.mark.asyncio
async def test_daily_kpis_zero_when_no_sales(db: AsyncSession, seed):
    """Returns all-zero KPIs when there are no PAID checks on the date."""
    branch_a = seed["branch_a"]
    tenant_a = seed["tenant_a"]

    service = SalesService(db)
    result = await service.get_daily_kpis(branch_a.id, date(2025, 1, 15), tenant_a.id)

    assert result.orders == 0
    assert result.revenue_cents == 0
    assert result.average_ticket_cents == 0
    assert result.diners == 0


@pytest.mark.asyncio
async def test_daily_kpis_excludes_other_tenants(db: AsyncSession, seed):
    """A check in branch_b (tenant_b) must not appear in branch_a's KPIs."""
    branch_a = seed["branch_a"]
    branch_b = seed["branch_b"]
    tenant_a = seed["tenant_a"]
    prod_a = seed["prod_a"]
    table_a = seed["table_a"]

    # Create a sector+table for branch_b
    sector_b = BranchSector(branch_id=branch_b.id, name="Bar")
    db.add(sector_b)
    await db.flush()
    table_b = Table(branch_id=branch_b.id, sector_id=sector_b.id, number=1, code="B1", capacity=4, status="AVAILABLE")
    db.add(table_b)

    # Need a product for branch_b
    cat_b = Category(branch_id=branch_b.id, name="Menu", order=1)
    db.add(cat_b)
    await db.flush()
    sub_b = Subcategory(category_id=cat_b.id, name="Platos", order=1)
    db.add(sub_b)
    await db.flush()
    prod_b_entity = Product(subcategory_id=sub_b.id, name="Pizza", description="", price=2000)
    db.add(prod_b_entity)
    await db.flush()

    target = date(2025, 1, 15)
    ts = datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc)

    # Paid check in branch_a
    await _create_paid_check(db, branch=branch_a, table=table_a, prod=prod_a,
                              total_cents=1000, check_created_at=ts)
    # Paid check in branch_b (different tenant)
    await _create_paid_check(db, branch=branch_b, table=table_b, prod=prod_b_entity,
                              total_cents=2000, check_created_at=ts)

    service = SalesService(db)
    result = await service.get_daily_kpis(branch_a.id, target, tenant_a.id)

    assert result.orders == 1
    assert result.revenue_cents == 1000


@pytest.mark.asyncio
async def test_daily_kpis_excludes_other_branches(db: AsyncSession, seed):
    """Checks from a different branch within the same tenant are excluded."""
    branch_a = seed["branch_a"]
    tenant_a = seed["tenant_a"]
    prod_a = seed["prod_a"]
    table_a = seed["table_a"]

    # Create a second branch in same tenant
    branch_a2 = Branch(tenant_id=tenant_a.id, name="Branch A2", slug="branch-a2", address="Addr A2")
    db.add(branch_a2)
    await db.flush()
    sector_a2 = BranchSector(branch_id=branch_a2.id, name="Salon")
    db.add(sector_a2)
    await db.flush()
    table_a2 = Table(branch_id=branch_a2.id, sector_id=sector_a2.id, number=1, code="X1", capacity=4, status="AVAILABLE")
    db.add(table_a2)
    await db.flush()

    cat_a2 = Category(branch_id=branch_a2.id, name="Menu", order=1)
    db.add(cat_a2)
    await db.flush()
    sub_a2 = Subcategory(category_id=cat_a2.id, name="Platos", order=1)
    db.add(sub_a2)
    await db.flush()
    prod_a2 = Product(subcategory_id=sub_a2.id, name="Sopa", description="", price=800)
    db.add(prod_a2)
    await db.flush()

    target = date(2025, 2, 1)
    ts = datetime(2025, 2, 1, 12, 0, 0, tzinfo=timezone.utc)

    await _create_paid_check(db, branch=branch_a, table=table_a, prod=prod_a,
                              total_cents=1000, check_created_at=ts)
    await _create_paid_check(db, branch=branch_a2, table=table_a2, prod=prod_a2,
                              total_cents=800, check_created_at=ts)

    service = SalesService(db)
    result = await service.get_daily_kpis(branch_a.id, target, tenant_a.id)

    assert result.orders == 1
    assert result.revenue_cents == 1000


@pytest.mark.asyncio
async def test_daily_kpis_date_bounds_respected(db: AsyncSession, seed):
    """
    Check at 23:59:59 on target_date IS included.
    Check at 00:00:00 of target_date+1 is NOT included.
    """
    branch_a = seed["branch_a"]
    tenant_a = seed["tenant_a"]
    prod_a = seed["prod_a"]
    table_a = seed["table_a"]

    target = date(2025, 3, 10)

    # 23:59:59 on target_date — must be included
    ts_in = datetime(2025, 3, 10, 23, 59, 59, tzinfo=timezone.utc)
    # 00:00:00 on target_date+1 — must NOT be included
    ts_out = datetime(2025, 3, 11, 0, 0, 0, tzinfo=timezone.utc)

    await _create_paid_check(db, branch=branch_a, table=table_a, prod=prod_a,
                              total_cents=1000, check_created_at=ts_in)
    await _create_paid_check(db, branch=branch_a, table=table_a, prod=prod_a,
                              total_cents=500, check_created_at=ts_out)

    service = SalesService(db)
    result = await service.get_daily_kpis(branch_a.id, target, tenant_a.id)

    assert result.orders == 1
    assert result.revenue_cents == 1000


@pytest.mark.asyncio
async def test_top_products_ordered_by_revenue_desc(db: AsyncSession, seed):
    """Products are returned ordered by revenue descending."""
    branch_a = seed["branch_a"]
    tenant_a = seed["tenant_a"]
    prod_a = seed["prod_a"]  # Milanesa 1000 cents
    prod_b = seed["prod_b"]  # Ensalada 500 cents
    table_a = seed["table_a"]

    target = date(2025, 4, 1)
    ts = datetime(2025, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

    # prod_b has higher quantity but lower revenue per unit
    # Milanesa: 3 * 1000 = 3000, Ensalada: 10 * 500 = 5000 → ensalada has more revenue
    session = TableSession(table_id=table_a.id, branch_id=branch_a.id, status="OPEN")
    db.add(session)
    await db.flush()
    rnd = Round(session_id=session.id, branch_id=branch_a.id, round_number=1, status="SERVED", created_by_role="WAITER")
    db.add(rnd)
    await db.flush()

    item_a = RoundItem(round_id=rnd.id, product_id=prod_a.id, quantity=3, price_cents_snapshot=1000, is_voided=False)
    item_b = RoundItem(round_id=rnd.id, product_id=prod_b.id, quantity=10, price_cents_snapshot=500, is_voided=False)
    db.add_all([item_a, item_b])
    await db.flush()

    total = 3 * 1000 + 10 * 500
    check = Check(session_id=session.id, branch_id=branch_a.id, tenant_id=tenant_a.id, total_cents=total, status="PAID")
    db.add(check)
    await db.flush()
    from sqlalchemy import update
    from rest_api.models.billing import Check as CheckModel
    await db.execute(update(CheckModel).where(CheckModel.id == check.id).values(created_at=ts))
    payment = Payment(check_id=check.id, amount_cents=total, method="cash", status="APPROVED")
    db.add(payment)
    await db.flush()

    service = SalesService(db)
    result = await service.get_top_products(branch_a.id, target, tenant_a.id)

    assert len(result) == 2
    assert result[0].revenue_cents == 5000   # Ensalada
    assert result[1].revenue_cents == 3000   # Milanesa
    assert result[0].revenue_cents >= result[1].revenue_cents


@pytest.mark.asyncio
async def test_top_products_excludes_voided_items(db: AsyncSession, seed):
    """Voided round items must not be counted in top products."""
    branch_a = seed["branch_a"]
    tenant_a = seed["tenant_a"]
    prod_a = seed["prod_a"]
    table_a = seed["table_a"]

    target = date(2025, 5, 1)
    ts = datetime(2025, 5, 1, 12, 0, 0, tzinfo=timezone.utc)

    session = TableSession(table_id=table_a.id, branch_id=branch_a.id, status="OPEN")
    db.add(session)
    await db.flush()
    rnd = Round(session_id=session.id, branch_id=branch_a.id, round_number=1, status="SERVED", created_by_role="WAITER")
    db.add(rnd)
    await db.flush()

    # Normal item
    item_ok = RoundItem(round_id=rnd.id, product_id=prod_a.id, quantity=1, price_cents_snapshot=1000, is_voided=False)
    # Voided item — same product, should NOT be counted
    item_void = RoundItem(round_id=rnd.id, product_id=prod_a.id, quantity=5, price_cents_snapshot=1000, is_voided=True)
    db.add_all([item_ok, item_void])
    await db.flush()

    total = 1000
    check = Check(session_id=session.id, branch_id=branch_a.id, tenant_id=tenant_a.id, total_cents=total, status="PAID")
    db.add(check)
    await db.flush()
    from sqlalchemy import update
    from rest_api.models.billing import Check as CheckModel
    await db.execute(update(CheckModel).where(CheckModel.id == check.id).values(created_at=ts))
    payment = Payment(check_id=check.id, amount_cents=total, method="cash", status="APPROVED")
    db.add(payment)
    await db.flush()

    service = SalesService(db)
    result = await service.get_top_products(branch_a.id, target, tenant_a.id)

    assert len(result) == 1
    assert result[0].quantity_sold == 1      # only non-voided counted
    assert result[0].revenue_cents == 1000


@pytest.mark.asyncio
async def test_top_products_respects_limit(db: AsyncSession, seed):
    """Limit parameter caps the number of results returned."""
    branch_a = seed["branch_a"]
    tenant_a = seed["tenant_a"]
    table_a = seed["table_a"]

    # Need more products — create 5 extra
    cat = await db.get(Category, 1) or None
    # Use prod_a and prod_b from seed plus create extras
    sub_id = seed["prod_a"].subcategory_id

    extra_prods = [
        Product(subcategory_id=sub_id, name=f"Prod{i}", description="", price=100 * (i + 1))
        for i in range(5)
    ]
    db.add_all(extra_prods)
    await db.flush()

    target = date(2025, 6, 1)
    ts = datetime(2025, 6, 1, 12, 0, 0, tzinfo=timezone.utc)

    all_prods = [seed["prod_a"], seed["prod_b"]] + extra_prods
    session = TableSession(table_id=table_a.id, branch_id=branch_a.id, status="OPEN")
    db.add(session)
    await db.flush()
    rnd = Round(session_id=session.id, branch_id=branch_a.id, round_number=1, status="SERVED", created_by_role="WAITER")
    db.add(rnd)
    await db.flush()

    total = 0
    for p in all_prods:
        item = RoundItem(round_id=rnd.id, product_id=p.id, quantity=1, price_cents_snapshot=p.price, is_voided=False)
        db.add(item)
        total += p.price
    await db.flush()

    check = Check(session_id=session.id, branch_id=branch_a.id, tenant_id=tenant_a.id, total_cents=total, status="PAID")
    db.add(check)
    await db.flush()
    from sqlalchemy import update
    from rest_api.models.billing import Check as CheckModel
    await db.execute(update(CheckModel).where(CheckModel.id == check.id).values(created_at=ts))
    payment = Payment(check_id=check.id, amount_cents=total, method="cash", status="APPROVED")
    db.add(payment)
    await db.flush()

    service = SalesService(db)
    result = await service.get_top_products(branch_a.id, target, tenant_a.id, limit=3)

    assert len(result) == 3


@pytest.mark.asyncio
async def test_top_products_empty_when_no_sales(db: AsyncSession, seed):
    """Returns empty list when no PAID checks exist for the date."""
    branch_a = seed["branch_a"]
    tenant_a = seed["tenant_a"]

    service = SalesService(db)
    result = await service.get_top_products(branch_a.id, date(2025, 7, 1), tenant_a.id)

    assert result == []
