"""
Tests for the demo_full seed module (C-31).

Tests:
  - test_seed_demo_full_runs_without_error: happy path, no exception
  - test_seed_demo_full_is_idempotent: running twice produces the same counts
  - test_seed_demo_full_covers_all_state_machines: all expected statuses are present
  - test_seed_demo_full_historical_uses_relative_dates: CLOSED sessions are recent

These tests use the in-memory SQLite fixture from conftest.py. Because they
set up an entire demo dataset (tenant + branch + users + sector + tables + menu
+ full demo_full), they run the base seed modules first as setup.

NOTE: SQLite does not enforce CHECK constraints by default, and BigInteger PKs
are patched to Integer in conftest.py. The tests exercise count and state
invariants only — not DB-level constraints.
"""
import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

# Base seed modules (run as setup for each test)
from rest_api.seeds.tenants import seed_tenants
from rest_api.seeds.users import seed_users
from rest_api.seeds.demo_data import seed_demo_data
from rest_api.seeds.staff_management import seed_staff_management

# The module under test — this MUST fail with ImportError until demo_full.py exists
from rest_api.seeds.demo_full import seed_demo_full

# Models needed for assertions
from rest_api.models.table_session import TableSession, Diner
from rest_api.models.round import Round, RoundItem
from rest_api.models.kitchen_ticket import KitchenTicket
from rest_api.models.service_call import ServiceCall
from rest_api.models.billing import Check, Charge, Payment, Allocation
from rest_api.models.allergen import Allergen, ProductAllergen


# ---------------------------------------------------------------------------
# Shared async fixture: full base setup (tenant + branch + users + demo_data
#   + staff_management + demo_full)
# ---------------------------------------------------------------------------


async def _run_full_seed(db: AsyncSession) -> tuple[int, int]:
    """Run the complete seed chain and return (tenant_id, branch_id)."""
    tenant, branch = await seed_tenants(db)
    await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)
    await seed_demo_data(db, branch_id=branch.id)
    await seed_staff_management(db, tenant_id=tenant.id, branch_id=branch.id)
    await seed_demo_full(db, tenant_id=tenant.id, branch_id=branch.id)
    await db.flush()
    return tenant.id, branch.id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seed_demo_full_runs_without_error(db: AsyncSession) -> None:
    """seed_demo_full must complete without raising any exception."""
    tenant_id, branch_id = await _run_full_seed(db)
    # If we get here, no exception was raised — success.
    assert tenant_id == 1
    assert branch_id == 1


@pytest.mark.asyncio
async def test_seed_demo_full_is_idempotent(db: AsyncSession) -> None:
    """Running seed_demo_full twice must not duplicate rows."""

    async def _counts(db: AsyncSession) -> dict:
        return {
            "sessions": (await db.execute(select(func.count()).select_from(TableSession))).scalar_one(),
            "diners": (await db.execute(select(func.count()).select_from(Diner))).scalar_one(),
            "rounds": (await db.execute(select(func.count()).select_from(Round))).scalar_one(),
            "round_items": (await db.execute(select(func.count()).select_from(RoundItem))).scalar_one(),
            "tickets": (await db.execute(select(func.count()).select_from(KitchenTicket))).scalar_one(),
            "service_calls": (await db.execute(select(func.count()).select_from(ServiceCall))).scalar_one(),
            "checks": (await db.execute(select(func.count()).select_from(Check))).scalar_one(),
            "charges": (await db.execute(select(func.count()).select_from(Charge))).scalar_one(),
            "payments": (await db.execute(select(func.count()).select_from(Payment))).scalar_one(),
            "allocations": (await db.execute(select(func.count()).select_from(Allocation))).scalar_one(),
        }

    tenant_id, branch_id = await _run_full_seed(db)
    counts_after_first = await _counts(db)

    # Run demo_full a second time
    await seed_demo_full(db, tenant_id=tenant_id, branch_id=branch_id)
    await db.flush()
    counts_after_second = await _counts(db)

    assert counts_after_first == counts_after_second, (
        f"Idempotency violated:\n"
        f"  first run:  {counts_after_first}\n"
        f"  second run: {counts_after_second}"
    )


@pytest.mark.asyncio
async def test_seed_demo_full_covers_all_state_machines(db: AsyncSession) -> None:
    """
    All state machine states that the design spec requires must be present:
      - TableSession: OPEN, PAYING (CLOSED comes from historical sessions)
      - Round: IN_KITCHEN, SERVED
      - KitchenTicket: IN_PROGRESS, DELIVERED
      - ServiceCall: CREATED, ACKED
      - Check: REQUESTED (PAID comes from historical sessions)
      - Payment: APPROVED
    """
    await _run_full_seed(db)

    # TableSession statuses
    session_statuses_result = await db.execute(select(TableSession.status).distinct())
    session_statuses = {row[0] for row in session_statuses_result.fetchall()}
    assert "OPEN" in session_statuses, "Expected at least one OPEN session"
    assert "PAYING" in session_statuses, "Expected at least one PAYING session"
    assert "CLOSED" in session_statuses, "Expected at least one CLOSED session"

    # Round statuses
    round_statuses_result = await db.execute(select(Round.status).distinct())
    round_statuses = {row[0] for row in round_statuses_result.fetchall()}
    assert "IN_KITCHEN" in round_statuses, "Expected at least one IN_KITCHEN round"
    assert "SERVED" in round_statuses, "Expected at least one SERVED round"

    # KitchenTicket statuses
    ticket_statuses_result = await db.execute(select(KitchenTicket.status).distinct())
    ticket_statuses = {row[0] for row in ticket_statuses_result.fetchall()}
    assert "IN_PROGRESS" in ticket_statuses, "Expected at least one IN_PROGRESS ticket"
    assert "DELIVERED" in ticket_statuses, "Expected at least one DELIVERED ticket"

    # ServiceCall statuses
    sc_statuses_result = await db.execute(select(ServiceCall.status).distinct())
    sc_statuses = {row[0] for row in sc_statuses_result.fetchall()}
    assert "CREATED" in sc_statuses, "Expected at least one CREATED service call"
    assert "ACKED" in sc_statuses, "Expected at least one ACKED service call"

    # Check statuses
    check_statuses_result = await db.execute(select(Check.status).distinct())
    check_statuses = {row[0] for row in check_statuses_result.fetchall()}
    assert "REQUESTED" in check_statuses, "Expected at least one REQUESTED check"
    assert "PAID" in check_statuses, "Expected at least one PAID check"

    # Payment statuses
    payment_statuses_result = await db.execute(select(Payment.status).distinct())
    payment_statuses = {row[0] for row in payment_statuses_result.fetchall()}
    assert "APPROVED" in payment_statuses, "Expected at least one APPROVED payment"

    # ProductAllergen presence_types
    pa_types_result = await db.execute(select(ProductAllergen.presence_type).distinct())
    pa_types = {row[0] for row in pa_types_result.fetchall()}
    assert "contains" in pa_types, "Expected at least one 'contains' product allergen"
    assert "may_contain" in pa_types, "Expected at least one 'may_contain' product allergen"


@pytest.mark.asyncio
async def test_seed_demo_full_historical_uses_relative_dates(db: AsyncSession) -> None:
    """
    The 3 historical sessions must have created_at within [now()-4d, now()].
    This ensures the seed is always useful without being expired.
    """
    await _run_full_seed(db)

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=4)

    closed_sessions_result = await db.execute(
        select(TableSession).where(TableSession.status == "CLOSED")
    )
    closed_sessions = closed_sessions_result.scalars().all()

    assert len(closed_sessions) >= 3, (
        f"Expected at least 3 CLOSED sessions, got {len(closed_sessions)}"
    )

    for session in closed_sessions:
        created_at = session.created_at
        # Normalize to UTC if naive (SQLite returns naive datetimes)
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        assert created_at >= cutoff, (
            f"CLOSED session id={session.id} has created_at={created_at} "
            f"which is older than {cutoff} (more than 4 days ago)"
        )
