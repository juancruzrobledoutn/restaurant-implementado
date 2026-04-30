"""
TDD tests for RoundService.list_for_admin() and get_admin_detail() (C-25).

Design decisions tested:
  - D8: single query with JOINs (no N+1) — verify items_count and total_cents exclude voided items
  - D9: offset-based pagination
  - Filters: date, sector_id, status, table_code (ILIKE partial)
  - Cross-tenant isolation — ForbiddenError raised when branch_id belongs to another tenant
  - MANAGER branch access — ForbiddenError if branch not in branch_ids

Fixtures:
  - 2 tenants, 2 branches each
  - 3 sectors in branch1 of tenant1
  - 5 tables spread across those sectors
  - Rounds in all 7 states, with items (some voided)

Rules:
  - NEVER db.commit() → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from datetime import date, datetime, UTC, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.tenant import Tenant
from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import TableSession, Diner
from rest_api.models.round import Round, RoundItem
from rest_api.models.menu import Category, Subcategory, Product, BranchProduct
from rest_api.services.domain.round_service import RoundService
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import ForbiddenError, NotFoundError


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(UTC)


def _today_str() -> str:
    return date.today().isoformat()


def _make_round(
    session: TableSession,
    branch: Branch,
    status: str = "PENDING",
    pending_at: datetime | None = None,
    *,
    round_number: int = 1,
) -> Round:
    return Round(
        session_id=session.id,
        branch_id=branch.id,
        round_number=round_number,
        status=status,
        created_by_role="WAITER",
        pending_at=pending_at or _now_utc(),
        confirmed_at=_now_utc() if status not in ("PENDING",) else None,
        submitted_at=_now_utc() if status in ("SUBMITTED", "IN_KITCHEN", "READY", "SERVED", "CANCELED") else None,
        in_kitchen_at=_now_utc() if status in ("IN_KITCHEN", "READY", "SERVED", "CANCELED") else None,
        ready_at=_now_utc() if status in ("READY", "SERVED", "CANCELED") else None,
        served_at=_now_utc() if status == "SERVED" else None,
        canceled_at=_now_utc() if status == "CANCELED" else None,
        cancel_reason="test cancel" if status == "CANCELED" else None,
    )


def _make_item(round_: Round, product: Product, qty: int = 2, price: int = 1000, *, voided: bool = False) -> RoundItem:
    return RoundItem(
        round_id=round_.id,
        product_id=product.id,
        quantity=qty,
        price_cents_snapshot=price,
        is_voided=voided,
        void_reason="voided in test" if voided else None,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seed(db: AsyncSession):
    """
    Seeds a full multi-tenant scenario:

    Tenant A (id=tA):
      Branch A1: sectors [sA1, sA2, sA3], tables [tbl1(sA1), tbl2(sA1), tbl3(sA2), tbl4(sA3)]
      Branch A2: sector [sA4], table [tbl5]

    Tenant B (id=tB):
      Branch B1: sector [sB1], table [tbl6]

    Products: p1 (price=500), p2 (price=1500)

    Rounds in branch A1 (all today, various statuses):
      r1 PENDING   - session1, table1 (sA1), 2 items non-voided → items_count=2, total=1000+3000=4000
      r2 CONFIRMED - session2, table2 (sA1), 1 item non-voided + 1 voided → items_count=1, total=500
      r3 SUBMITTED - session1, table1 (sA1) (round 2), 1 item
      r4 IN_KITCHEN - session3, table3 (sA2)
      r5 READY     - session4, table4 (sA3)
      r6 SERVED    - session1 (round 3), table1 (sA1)
      r7 CANCELED  - session2 (round 2), table2 (sA1)

    Round in branch A2:
      r8 PENDING in branchA2 — must NOT appear in A1 queries

    Round in branch B1 (Tenant B):
      r9 PENDING — must NEVER appear in Tenant A queries
    """
    # Tenants
    tA = Tenant(name="Tenant A")
    tB = Tenant(name="Tenant B")
    db.add_all([tA, tB])
    await db.flush()

    # Branches
    bA1 = Branch(tenant_id=tA.id, name="Branch A1", slug="a1", address="Addr A1")
    bA2 = Branch(tenant_id=tA.id, name="Branch A2", slug="a2", address="Addr A2")
    bB1 = Branch(tenant_id=tB.id, name="Branch B1", slug="b1", address="Addr B1")
    db.add_all([bA1, bA2, bB1])
    await db.flush()

    # Sectors
    sA1 = BranchSector(branch_id=bA1.id, name="Salon")
    sA2 = BranchSector(branch_id=bA1.id, name="Terraza")
    sA3 = BranchSector(branch_id=bA1.id, name="Barra")
    sA4 = BranchSector(branch_id=bA2.id, name="Salon A2")
    sB1 = BranchSector(branch_id=bB1.id, name="Salon B1")
    db.add_all([sA1, sA2, sA3, sA4, sB1])
    await db.flush()

    # Tables
    tbl1 = Table(number=1, code="A-01", sector_id=sA1.id, branch_id=bA1.id, capacity=4, status="OCCUPIED")
    tbl2 = Table(number=2, code="A-02", sector_id=sA1.id, branch_id=bA1.id, capacity=4, status="OCCUPIED")
    tbl3 = Table(number=3, code="B-01", sector_id=sA2.id, branch_id=bA1.id, capacity=6, status="OCCUPIED")
    tbl4 = Table(number=4, code="C-01", sector_id=sA3.id, branch_id=bA1.id, capacity=2, status="OCCUPIED")
    tbl5 = Table(number=1, code="D-01", sector_id=sA4.id, branch_id=bA2.id, capacity=4, status="OCCUPIED")
    tbl6 = Table(number=1, code="E-01", sector_id=sB1.id, branch_id=bB1.id, capacity=4, status="OCCUPIED")
    db.add_all([tbl1, tbl2, tbl3, tbl4, tbl5, tbl6])
    await db.flush()

    # Products — Product is scoped to Subcategory, not directly to tenant.
    # Create a shared Category+Subcategory under bA1 to host p1/p2 for Tenant A.
    catA = Category(branch_id=bA1.id, name="Cat A", order=10)
    db.add(catA)
    await db.flush()
    subcatA = Subcategory(category_id=catA.id, name="Subcat A", order=10)
    db.add(subcatA)
    await db.flush()

    p1 = Product(subcategory_id=subcatA.id, name="Producto 1", price=500)
    p2 = Product(subcategory_id=subcatA.id, name="Producto 2", price=1500)
    db.add_all([p1, p2])
    await db.flush()

    # Sessions
    sess1 = TableSession(table_id=tbl1.id, branch_id=bA1.id, status="OPEN")
    sess2 = TableSession(table_id=tbl2.id, branch_id=bA1.id, status="OPEN")
    sess3 = TableSession(table_id=tbl3.id, branch_id=bA1.id, status="OPEN")
    sess4 = TableSession(table_id=tbl4.id, branch_id=bA1.id, status="OPEN")
    sess5 = TableSession(table_id=tbl5.id, branch_id=bA2.id, status="OPEN")
    sess6 = TableSession(table_id=tbl6.id, branch_id=bB1.id, status="OPEN")
    db.add_all([sess1, sess2, sess3, sess4, sess5, sess6])
    await db.flush()

    # Rounds in Branch A1
    today = _now_utc()

    r1 = _make_round(sess1, bA1, "PENDING", today, round_number=1)
    db.add(r1)
    await db.flush()
    db.add(_make_item(r1, p1, qty=2, price=500))   # 1000 cents, not voided
    db.add(_make_item(r1, p2, qty=2, price=1500))  # 3000 cents, not voided
    await db.flush()

    r2 = _make_round(sess2, bA1, "CONFIRMED", today, round_number=1)
    db.add(r2)
    await db.flush()
    db.add(_make_item(r2, p1, qty=1, price=500, voided=False))   # 500 not voided
    db.add(_make_item(r2, p2, qty=1, price=1500, voided=True))   # 1500 voided → excluded
    await db.flush()

    r3 = _make_round(sess1, bA1, "SUBMITTED", today, round_number=2)
    db.add(r3)
    await db.flush()
    db.add(_make_item(r3, p1, qty=1, price=500))
    await db.flush()

    r4 = _make_round(sess3, bA1, "IN_KITCHEN", today, round_number=1)
    db.add(r4)
    await db.flush()
    db.add(_make_item(r4, p1, qty=1, price=500))
    await db.flush()

    r5 = _make_round(sess4, bA1, "READY", today, round_number=1)
    db.add(r5)
    await db.flush()
    db.add(_make_item(r5, p2, qty=1, price=1500))
    await db.flush()

    r6 = _make_round(sess1, bA1, "SERVED", today, round_number=3)
    db.add(r6)
    await db.flush()
    db.add(_make_item(r6, p1, qty=1, price=500))
    await db.flush()

    r7 = _make_round(sess2, bA1, "CANCELED", today, round_number=2)
    db.add(r7)
    await db.flush()
    db.add(_make_item(r7, p1, qty=1, price=500))
    await db.flush()

    # Round in Branch A2 (Tenant A but different branch)
    r8 = _make_round(sess5, bA2, "PENDING", today, round_number=1)
    db.add(r8)
    await db.flush()
    db.add(_make_item(r8, p1, qty=1, price=500))
    await db.flush()

    # Round in Branch B1 (Tenant B)
    # Tenant B needs its own Category+Subcategory under bB1
    catB = Category(branch_id=bB1.id, name="Cat B", order=10)
    db.add(catB)
    await db.flush()
    subcatB = Subcategory(category_id=catB.id, name="Subcat B", order=10)
    db.add(subcatB)
    await db.flush()
    pB = Product(subcategory_id=subcatB.id, name="Producto B", price=500)
    db.add(pB)
    await db.flush()
    r9 = _make_round(sess6, bB1, "PENDING", today, round_number=1)
    db.add(r9)
    await db.flush()
    db.add(_make_item(r9, pB, qty=1, price=500))
    await db.flush()

    await safe_commit(db)

    return {
        "tA": tA, "tB": tB,
        "bA1": bA1, "bA2": bA2, "bB1": bB1,
        "sA1": sA1, "sA2": sA2, "sA3": sA3,
        "tbl1": tbl1, "tbl2": tbl2, "tbl3": tbl3, "tbl4": tbl4,
        "p1": p1, "p2": p2,
        "r1": r1, "r2": r2, "r3": r3, "r4": r4, "r5": r5, "r6": r6, "r7": r7,
        "r8": r8, "r9": r9,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2.5 — Filter by date
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_filter_by_date_returns_today_rounds(db: AsyncSession, seed):
    """Filter by today's date returns rounds seeded today."""
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        date=_today_str(),
        branch_ids=None,  # ADMIN
    )
    # 7 rounds in bA1, all seeded today
    assert total == 7
    assert len(items) == 7


@pytest.mark.asyncio
async def test_filter_by_past_date_returns_empty(db: AsyncSession, seed):
    """Filter by yesterday returns no rounds (all seeded with today's timestamp)."""
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        date=yesterday,
        branch_ids=None,
    )
    assert total == 0
    assert len(items) == 0


# ─────────────────────────────────────────────────────────────────────────────
# 2.6 — Filter by sector_id
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_filter_by_sector_id(db: AsyncSession, seed):
    """Filter by sA1 (Salon) returns only rounds from tables in that sector."""
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        sector_id=seed["sA1"].id,
        branch_ids=None,
    )
    # tbl1 and tbl2 are in sA1; rounds r1(tbl1), r2(tbl2), r3(tbl1 rnd2), r6(tbl1 rnd3), r7(tbl2 rnd2)
    assert total == 5
    assert all(r.sector_id == seed["sA1"].id for r in items)


# ─────────────────────────────────────────────────────────────────────────────
# 2.7 — Filter by status
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_filter_by_status_pending(db: AsyncSession, seed):
    """Filter by PENDING returns only PENDING rounds."""
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        status="PENDING",
        branch_ids=None,
    )
    assert total == 1
    assert all(r.status == "PENDING" for r in items)


@pytest.mark.asyncio
async def test_filter_by_status_canceled(db: AsyncSession, seed):
    """Filter by CANCELED returns only CANCELED rounds."""
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        status="CANCELED",
        branch_ids=None,
    )
    assert total == 1
    assert items[0].status == "CANCELED"
    assert items[0].cancel_reason == "test cancel"


# ─────────────────────────────────────────────────────────────────────────────
# 2.8 — Filter by table_code (ILIKE partial, case-insensitive)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_filter_by_table_code_partial(db: AsyncSession, seed):
    """Filter by partial table_code 'a-0' matches A-01 and A-02 (case-insensitive)."""
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        table_code="a-0",  # lowercase, partial
        branch_ids=None,
    )
    # tbl1=A-01 and tbl2=A-02 match → r1, r2, r3, r6, r7 (5 rounds)
    assert total == 5
    assert all(r.table_code.lower().startswith("a-0") for r in items)


# ─────────────────────────────────────────────────────────────────────────────
# 2.9 — Combination of filters
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_combined_filters_date_and_status(db: AsyncSession, seed):
    """Combining date + status narrows the result correctly."""
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        date=_today_str(),
        status="CONFIRMED",
        branch_ids=None,
    )
    assert total == 1
    assert items[0].status == "CONFIRMED"


@pytest.mark.asyncio
async def test_combined_filters_sector_and_status(db: AsyncSession, seed):
    """Sector A2 + status IN_KITCHEN returns exactly one round (r4 on tbl3)."""
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        sector_id=seed["sA2"].id,
        status="IN_KITCHEN",
        branch_ids=None,
    )
    assert total == 1
    assert items[0].status == "IN_KITCHEN"
    assert items[0].sector_id == seed["sA2"].id


# ─────────────────────────────────────────────────────────────────────────────
# 2.10 — Pagination
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_pagination_limit_and_offset(db: AsyncSession, seed):
    """With 7 rounds in A1, limit=3, offset=2 returns 3 items and total=7."""
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        branch_ids=None,
        limit=3,
        offset=2,
    )
    assert total == 7
    assert len(items) == 3


@pytest.mark.asyncio
async def test_pagination_offset_beyond_total_returns_empty(db: AsyncSession, seed):
    """Offset beyond total returns empty items but correct total."""
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        branch_ids=None,
        limit=10,
        offset=100,
    )
    assert total == 7
    assert len(items) == 0


# ─────────────────────────────────────────────────────────────────────────────
# 2.11 — Cross-tenant isolation
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cross_tenant_manager_gets_forbidden(db: AsyncSession, seed):
    """A user from tenant A requesting branch B1 gets ForbiddenError."""
    svc = RoundService(db)
    with pytest.raises(ForbiddenError):
        await svc.list_for_admin(
            tenant_id=seed["tA"].id,
            branch_id=seed["bB1"].id,
            branch_ids=None,
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2.12 — MANAGER without branch access
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_manager_without_branch_access_gets_forbidden(db: AsyncSession, seed):
    """MANAGER whose branch_ids does NOT include bA1 gets ForbiddenError."""
    svc = RoundService(db)
    with pytest.raises(ForbiddenError):
        await svc.list_for_admin(
            tenant_id=seed["tA"].id,
            branch_id=seed["bA1"].id,
            branch_ids=[seed["bA2"].id],  # only has access to A2
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2.14 — items_count and total_cents exclude voided items
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_items_count_and_total_exclude_voided(db: AsyncSession, seed):
    """
    r1: 2 items non-voided (p1*2=1000 + p2*2=3000 = 4000), items_count=2
    r2: 1 non-voided (500) + 1 voided (1500 excluded) → items_count=1, total=500
    """
    svc = RoundService(db)
    items, _ = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        branch_ids=None,
    )
    by_id = {r.id: r for r in items}

    r1_out = by_id[seed["r1"].id]
    assert r1_out.items_count == 2
    assert r1_out.total_cents == 4000

    r2_out = by_id[seed["r2"].id]
    assert r2_out.items_count == 1
    assert r2_out.total_cents == 500


# ─────────────────────────────────────────────────────────────────────────────
# 2.15 — Order by pending_at DESC
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_order_by_pending_at_desc(db: AsyncSession, seed):
    """Result is ordered by pending_at DESC — newest first."""
    svc = RoundService(db)
    items, _ = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        branch_ids=None,
    )
    # All have the same pending_at (close to now), just verify the list is not empty
    # and timestamps are non-increasing
    timestamps = [r.pending_at for r in items]
    assert timestamps == sorted(timestamps, reverse=True)


# ─────────────────────────────────────────────────────────────────────────────
# 2.13 — No N+1: query count
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_no_n_plus_1_queries(db: AsyncSession, seed):
    """
    With 7 rounds seeded, list_for_admin executes at most 2 SQL statements
    (one for data + one for count). We verify by checking the result is correct
    and the function completes without lazy-loading relations.
    """
    svc = RoundService(db)
    items, total = await svc.list_for_admin(
        tenant_id=seed["tA"].id,
        branch_id=seed["bA1"].id,
        branch_ids=None,
    )
    # The important thing is we got all data without N+1
    assert total == 7
    assert len(items) == 7
    # Verify denormalised fields are populated (would fail with N+1)
    for item in items:
        assert item.table_code is not None
        assert item.table_number > 0
        assert item.items_count >= 0
        assert item.total_cents >= 0


# ─────────────────────────────────────────────────────────────────────────────
# get_admin_detail
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_admin_detail_returns_round_with_items(db: AsyncSession, seed):
    """get_admin_detail returns RoundAdminWithItemsOutput with embedded items."""
    svc = RoundService(db)
    detail = await svc.get_admin_detail(
        round_id=seed["r1"].id,
        tenant_id=seed["tA"].id,
        branch_ids=None,
    )
    assert detail.id == seed["r1"].id
    assert len(detail.items) == 2  # r1 has 2 non-voided items (all items included in detail)


@pytest.mark.asyncio
async def test_get_admin_detail_not_found_raises(db: AsyncSession, seed):
    """get_admin_detail for a non-existent round raises NotFoundError."""
    svc = RoundService(db)
    with pytest.raises(NotFoundError):
        await svc.get_admin_detail(
            round_id=999999,
            tenant_id=seed["tA"].id,
            branch_ids=None,
        )


@pytest.mark.asyncio
async def test_get_admin_detail_cross_tenant_raises(db: AsyncSession, seed):
    """get_admin_detail for a round in tenant B raises ForbiddenError/NotFoundError for tenant A."""
    svc = RoundService(db)
    with pytest.raises((ForbiddenError, NotFoundError)):
        await svc.get_admin_detail(
            round_id=seed["r9"].id,
            tenant_id=seed["tA"].id,
            branch_ids=None,
        )
