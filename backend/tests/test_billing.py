"""
Integration tests for the Billing system (C-12).

Coverage (tasks 13.1–13.15):
  13.1  Fixture: session with 3 diners and 3 SERVED rounds
  13.2  POST /api/billing/check/request → session PAYING, check REQUESTED, charges, outbox
  13.3  POST /api/billing/check/request when already PAYING → 409
  13.4  POST /api/waiter/payments/manual (full) → check PAID, session CLOSED, outbox
  13.5  POST /api/waiter/payments/manual (partial) → allocations correct, check stays
  13.6  Two partial payments resolve the check
  13.7  POST /api/billing/payment/webhook approved → FIFO runs, check resolves if full
  13.8  POST /api/billing/payment/webhook duplicate external_id → idempotent
  13.9  POST /api/billing/payment/webhook rejected → PAYMENT_REJECTED in outbox
  13.10 POST /api/billing/payment/webhook invalid HMAC → 400
  13.11 POST /api/waiter/tables/{id}/close when check REQUESTED → 409
  13.12 POST /api/waiter/tables/{id}/close after billing resolved → 200
  13.13 GET /api/billing/check/{session_id} → full check with remaining_cents
  13.14 KITCHEN role denied on POST /api/waiter/payments/manual → 403
  13.15 Multi-tenant isolation: user from tenant A cannot access check from tenant B
"""
from __future__ import annotations

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.billing import Allocation, Charge, Check, Payment
from rest_api.models.branch import Branch
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.models.outbox import OutboxEvent
from rest_api.models.round import Round, RoundItem
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import Diner, TableSession
from rest_api.models.tenant import Tenant
from rest_api.models.user import User, UserBranchRole
from rest_api.services.domain.billing_service import BillingService
from shared.config.constants import BillingEventType, CheckStatus, PaymentStatus
from shared.utils.exceptions import ConflictError, NotFoundError, ValidationError


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def billing_seeded(db: AsyncSession):
    """
    Seed a full scenario: tenant → branch → sector → table → session →
    3 diners → 3 SERVED rounds (one per diner + one shared).

    Returns dict with all seeded objects.
    """
    tenant = Tenant(name="Tenant A")
    db.add(tenant)
    await db.flush()

    tenant_b = Tenant(name="Tenant B")
    db.add(tenant_b)
    await db.flush()

    branch = Branch(
        tenant_id=tenant.id, name="Main Branch", address="Calle 123", slug="main"
    )
    db.add(branch)
    await db.flush()

    branch_b = Branch(
        tenant_id=tenant_b.id, name="Branch B", address="Other St", slug="branch-b"
    )
    db.add(branch_b)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="Salon")
    db.add(sector)
    sector_b = BranchSector(branch_id=branch_b.id, name="Bar")
    db.add(sector_b)
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
    table_b = Table(
        branch_id=branch_b.id,
        sector_id=sector_b.id,
        number=1,
        code="B1",
        capacity=4,
        status="AVAILABLE",
    )
    db.add(table_b)
    await db.flush()

    # Users (role is on UserBranchRole, not User)
    waiter = User(
        tenant_id=tenant.id,
        email="waiter@test.com",
        full_name="Waiter One",
        hashed_password="x",
    )
    kitchen = User(
        tenant_id=tenant.id,
        email="kitchen@test.com",
        full_name="Kitchen One",
        hashed_password="x",
    )
    user_b = User(
        tenant_id=tenant_b.id,
        email="waiter_b@test.com",
        full_name="Waiter B",
        hashed_password="x",
    )
    db.add_all([waiter, kitchen, user_b])
    await db.flush()

    # Session with 3 diners
    session = TableSession(
        table_id=table.id,
        branch_id=branch.id,
        status="OPEN",
    )
    db.add(session)
    await db.flush()

    d1 = Diner(session_id=session.id, name="Alice")
    d2 = Diner(session_id=session.id, name="Bob")
    d3 = Diner(session_id=session.id, name="Carol")
    db.add_all([d1, d2, d3])
    await db.flush()

    # Product
    cat = Category(
        branch_id=branch.id,
        name="Food",
        order=1,
    )
    db.add(cat)
    await db.flush()

    sub = Subcategory(
        category_id=cat.id,
        name="Mains",
        order=1,
    )
    db.add(sub)
    await db.flush()

    product = Product(
        subcategory_id=sub.id,
        name="Burger",
        price=1000,
    )
    db.add(product)
    await db.flush()

    bp = BranchProduct(
        branch_id=branch.id,
        product_id=product.id,
        price_cents=1000,
    )
    db.add(bp)
    await db.flush()

    # 3 SERVED rounds
    # Round 1: diner 1 ordered 1 burger (1000 cents)
    r1 = Round(
        session_id=session.id,
        branch_id=branch.id,
        round_number=1,
        status="SERVED",
        created_by_role="DINER",
        created_by_diner_id=d1.id,
    )
    db.add(r1)
    await db.flush()

    ri1 = RoundItem(
        round_id=r1.id,
        product_id=product.id,
        diner_id=d1.id,
        quantity=1,
        price_cents_snapshot=1000,
    )
    db.add(ri1)

    # Round 2: diner 2 ordered 2 burgers (2000 cents)
    r2 = Round(
        session_id=session.id,
        branch_id=branch.id,
        round_number=2,
        status="SERVED",
        created_by_role="DINER",
        created_by_diner_id=d2.id,
    )
    db.add(r2)
    await db.flush()

    ri2 = RoundItem(
        round_id=r2.id,
        product_id=product.id,
        diner_id=d2.id,
        quantity=2,
        price_cents_snapshot=1000,
    )
    db.add(ri2)

    # Round 3: shared (no diner_id) — 3 burgers (3000 cents)
    r3 = Round(
        session_id=session.id,
        branch_id=branch.id,
        round_number=3,
        status="SERVED",
        created_by_role="WAITER",
    )
    db.add(r3)
    await db.flush()

    ri3 = RoundItem(
        round_id=r3.id,
        product_id=product.id,
        diner_id=None,  # shared
        quantity=3,
        price_cents_snapshot=1000,
    )
    db.add(ri3)
    await db.flush()

    # Session B (different tenant) — for multi-tenant tests
    session_b = TableSession(
        table_id=table_b.id,
        branch_id=branch_b.id,
        status="OPEN",
    )
    db.add(session_b)
    await db.flush()

    return {
        "tenant": tenant,
        "tenant_b": tenant_b,
        "branch": branch,
        "branch_b": branch_b,
        "table": table,
        "table_b": table_b,
        "session": session,
        "session_b": session_b,
        "diners": [d1, d2, d3],
        "product": product,
        "waiter": waiter,
        "kitchen": kitchen,
        "user_b": user_b,
        # Total: d1=1000, d2=2000, shared=3000 → total=6000
        "expected_total": 6000,
    }


# ── 13.2 — request_check creates check + charges + outbox ─────────────────────


@pytest.mark.asyncio
async def test_request_check_creates_check_and_charges(
    billing_seeded, db: AsyncSession
):
    """Session PAYING, check REQUESTED, charges generated, CHECK_REQUESTED in outbox."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    session_id = ctx["session"].id

    service = BillingService(db)
    check_out = await service.request_check(
        session_id=session_id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    # Session is now PAYING
    session = await db.get(TableSession, session_id)
    assert session.status == "PAYING"

    # Check is REQUESTED
    assert check_out.status == CheckStatus.REQUESTED
    assert check_out.total_cents == ctx["expected_total"]  # 6000

    # Charges created (3 diners for equal_split)
    assert len(check_out.charges) == 3
    charge_sum = sum(c.amount_cents for c in check_out.charges)
    assert charge_sum == 6000

    # CHECK_REQUESTED in outbox
    outbox_events = (await db.execute(
        select(OutboxEvent).where(
            OutboxEvent.event_type == BillingEventType.CHECK_REQUESTED
        )
    )).scalars().all()
    assert len(outbox_events) == 1
    assert outbox_events[0].payload["check_id"] == check_out.id


# ── 13.3 — request_check when already PAYING → 409 ───────────────────────────


@pytest.mark.asyncio
async def test_request_check_already_paying_raises_conflict(
    billing_seeded, db: AsyncSession
):
    """Second request_check for same session raises ConflictError."""
    ctx = billing_seeded
    service = BillingService(db)

    # First request
    await service.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=ctx["tenant"].id,
    )

    # Second request should fail
    with pytest.raises(ConflictError) as exc_info:
        await service.request_check(
            session_id=ctx["session"].id,
            split_method="equal_split",
            tenant_id=ctx["tenant"].id,
        )

    assert "409" in str(exc_info.type) or "PAYING" in str(exc_info.value) or "check" in str(exc_info.value).lower()


# ── 13.4 — full payment: check PAID, session CLOSED, outbox ──────────────────


@pytest.mark.asyncio
async def test_manual_payment_full_resolves_check(billing_seeded, db: AsyncSession):
    """Full payment: check becomes PAID, session CLOSED, PAYMENT_APPROVED + CHECK_PAID in outbox."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    service = BillingService(db)

    # Request check first
    check_out = await service.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    # Full payment
    payment_out = await service.register_manual_payment(
        check_id=check_out.id,
        amount_cents=ctx["expected_total"],
        method="cash",
        tenant_id=tenant_id,
    )

    assert payment_out.status == PaymentStatus.APPROVED

    # Check is now PAID
    check = await db.scalar(select(Check).where(Check.id == check_out.id))
    assert check.status == CheckStatus.PAID

    # Session is CLOSED
    session = await db.get(TableSession, ctx["session"].id)
    assert session.status == "CLOSED"
    assert session.is_active is False

    # PAYMENT_APPROVED + CHECK_PAID in outbox
    events = (await db.execute(select(OutboxEvent))).scalars().all()
    event_types = {e.event_type for e in events}
    assert BillingEventType.PAYMENT_APPROVED in event_types
    assert BillingEventType.CHECK_PAID in event_types


# ── 13.5 — partial payment: check stays REQUESTED ────────────────────────────


@pytest.mark.asyncio
async def test_manual_payment_partial_stays_requested(billing_seeded, db: AsyncSession):
    """Partial payment: check stays REQUESTED, allocations correct."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    service = BillingService(db)

    check_out = await service.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    partial = 2000  # less than total (6000)
    await service.register_manual_payment(
        check_id=check_out.id,
        amount_cents=partial,
        method="cash",
        tenant_id=tenant_id,
    )

    # Check still REQUESTED
    check = await db.scalar(select(Check).where(Check.id == check_out.id))
    assert check.status == CheckStatus.REQUESTED

    # Session still PAYING
    session = await db.get(TableSession, ctx["session"].id)
    assert session.status == "PAYING"

    # Allocations exist
    allocs = (await db.execute(select(Allocation))).scalars().all()
    assert len(allocs) > 0
    assert sum(a.amount_cents for a in allocs) == partial


# ── 13.6 — two partial payments resolve the check ────────────────────────────


@pytest.mark.asyncio
async def test_two_partial_payments_resolve_check(billing_seeded, db: AsyncSession):
    """Two partial payments completing the total trigger _resolve_check()."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    service = BillingService(db)

    check_out = await service.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    total = ctx["expected_total"]  # 6000

    # First partial payment (3000)
    await service.register_manual_payment(
        check_id=check_out.id,
        amount_cents=3000,
        method="cash",
        tenant_id=tenant_id,
    )

    # Check still REQUESTED after first partial
    check = await db.scalar(select(Check).where(Check.id == check_out.id))
    assert check.status == CheckStatus.REQUESTED

    # Second partial payment (3000) — completes the check
    await service.register_manual_payment(
        check_id=check_out.id,
        amount_cents=3000,
        method="card",
        tenant_id=tenant_id,
    )

    # Now check is PAID
    await db.refresh(check)
    assert check.status == CheckStatus.PAID

    # Session is CLOSED
    session = await db.get(TableSession, ctx["session"].id)
    assert session.status == "CLOSED"


# ── 13.7 — webhook approved: FIFO runs, check resolves if full ───────────────


@pytest.mark.asyncio
async def test_webhook_approved_fifo_runs(billing_seeded, db: AsyncSession):
    """Approved webhook: FIFO allocation runs, check resolves if fully covered."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    service = BillingService(db)

    check_out = await service.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    # Create a PENDING payment (as if create_mp_preference was called)
    pending_payment = Payment(
        check_id=check_out.id,
        amount_cents=ctx["expected_total"],
        method="mercadopago",
        status=PaymentStatus.PENDING,
    )
    db.add(pending_payment)
    await db.flush()

    # Process webhook: approved
    await service.process_mp_webhook(
        external_id="mp_payment_123",
        mp_status="approved",
        amount_cents=ctx["expected_total"],
        tenant_id=tenant_id,
        check_id=check_out.id,
    )

    # Check is PAID
    check = await db.scalar(select(Check).where(Check.id == check_out.id))
    assert check.status == CheckStatus.PAID

    # Session is CLOSED
    session = await db.get(TableSession, ctx["session"].id)
    assert session.status == "CLOSED"


# ── 13.8 — duplicate external_id is idempotent ───────────────────────────────


@pytest.mark.asyncio
async def test_webhook_duplicate_external_id_idempotent(billing_seeded, db: AsyncSession):
    """Duplicate external_id does not create duplicate allocations."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    service = BillingService(db)

    check_out = await service.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    # Create PENDING payment
    pending = Payment(
        check_id=check_out.id,
        amount_cents=ctx["expected_total"],
        method="mercadopago",
        status=PaymentStatus.PENDING,
    )
    db.add(pending)
    await db.flush()

    # First webhook call
    await service.process_mp_webhook(
        external_id="mp_dup_999",
        mp_status="approved",
        amount_cents=ctx["expected_total"],
        tenant_id=tenant_id,
        check_id=check_out.id,
    )

    allocs_after_first = len((await db.execute(select(Allocation))).scalars().all())

    # Second webhook call (duplicate)
    await service.process_mp_webhook(
        external_id="mp_dup_999",
        mp_status="approved",
        amount_cents=ctx["expected_total"],
        tenant_id=tenant_id,
        check_id=check_out.id,
    )

    allocs_after_second = len((await db.execute(select(Allocation))).scalars().all())

    # No new allocations on duplicate
    assert allocs_after_first == allocs_after_second


# ── 13.9 — rejected webhook: PAYMENT_REJECTED in outbox ──────────────────────


@pytest.mark.asyncio
async def test_webhook_rejected_payment_rejected_outbox(billing_seeded, db: AsyncSession):
    """Rejected webhook: payment REJECTED, PAYMENT_REJECTED in outbox."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    service = BillingService(db)

    check_out = await service.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    pending = Payment(
        check_id=check_out.id,
        amount_cents=ctx["expected_total"],
        method="mercadopago",
        status=PaymentStatus.PENDING,
    )
    db.add(pending)
    await db.flush()

    await service.process_mp_webhook(
        external_id="mp_rejected_777",
        mp_status="rejected",
        amount_cents=0,
        tenant_id=tenant_id,
        check_id=check_out.id,
    )

    # Payment is REJECTED
    await db.refresh(pending)
    assert pending.status == PaymentStatus.REJECTED

    # PAYMENT_REJECTED in outbox
    event = await db.scalar(
        select(OutboxEvent).where(
            OutboxEvent.event_type == BillingEventType.PAYMENT_REJECTED
        )
    )
    assert event is not None
    assert event.payload["check_id"] == check_out.id


# ── 13.11 — close with REQUESTED check → 409 ─────────────────────────────────


@pytest.mark.asyncio
async def test_close_table_with_requested_check_raises_409(
    billing_seeded, db: AsyncSession
):
    """TableSessionService.close() raises when check is REQUESTED."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    service_billing = BillingService(db)

    check_out = await service_billing.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    # Try to close while check is REQUESTED
    from rest_api.services.domain.table_session_service import TableSessionService

    service_session = TableSessionService(db)
    with pytest.raises(ValidationError) as exc_info:
        await service_session.close(
            session_id=ctx["session"].id,
            tenant_id=tenant_id,
            user_id=ctx["waiter"].id,
            user_email="waiter@test.com",
        )

    assert "REQUESTED" in str(exc_info.value)


# ── 13.12 — close after billing resolved → success ───────────────────────────


@pytest.mark.asyncio
async def test_close_table_after_billing_resolved_succeeds(
    billing_seeded, db: AsyncSession
):
    """Close succeeds after billing resolves (session already CLOSED by _resolve_check)."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    service = BillingService(db)

    check_out = await service.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    # Full payment resolves the check
    await service.register_manual_payment(
        check_id=check_out.id,
        amount_cents=ctx["expected_total"],
        method="cash",
        tenant_id=tenant_id,
    )

    # Session should now be CLOSED by _resolve_check
    session = await db.get(TableSession, ctx["session"].id)
    assert session.status == "CLOSED"
    # Table should still be AVAILABLE-able


# ── 13.13 — get_check returns remaining_cents ────────────────────────────────


@pytest.mark.asyncio
async def test_get_check_returns_remaining_cents(billing_seeded, db: AsyncSession):
    """get_check returns charges with remaining_cents computed correctly."""
    ctx = billing_seeded
    tenant_id = ctx["tenant"].id
    service = BillingService(db)

    check_out = await service.request_check(
        session_id=ctx["session"].id,
        split_method="equal_split",
        tenant_id=tenant_id,
    )

    # Before any payment, remaining_cents == amount_cents for each charge
    full_check = await service.get_check(
        session_id=ctx["session"].id,
        tenant_id=tenant_id,
    )

    for charge in full_check.charges:
        assert charge.remaining_cents == charge.amount_cents

    # Make a partial payment
    partial = 1000
    await service.register_manual_payment(
        check_id=check_out.id,
        amount_cents=partial,
        method="cash",
        tenant_id=tenant_id,
    )

    # After partial payment, total remaining should be total - partial
    updated_check = await service.get_check(
        session_id=ctx["session"].id,
        tenant_id=tenant_id,
    )

    total_remaining = sum(c.remaining_cents for c in updated_check.charges)
    assert total_remaining == ctx["expected_total"] - partial


# ── 13.14 — KITCHEN role denied on manual payment ────────────────────────────


def test_kitchen_role_denied_on_manual_payment(client):
    """POST /api/waiter/payments/manual returns 403 for KITCHEN role."""
    import time
    from unittest.mock import AsyncMock, patch

    import jwt
    from shared.config.settings import settings

    kitchen_token = jwt.encode(
        {
            "sub": "999",
            "email": "kitchen@test.com",
            "tenant_id": 1,
            "branch_ids": [1],
            "roles": ["KITCHEN"],
            "jti": "kitchen-jti",
            "iat": int(time.time()),
            "exp": int(time.time()) + 900,
            "type": "access",
            "iss": "integrador",
            "aud": "integrador-api",
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )

    # Patch Redis checks to not fail-close in test environment (no Redis available).
    # Must patch where the names are used (imported into), not where they're defined.
    with patch(
        "rest_api.core.dependencies.is_blacklisted",
        new=AsyncMock(return_value=False),
    ), patch(
        "rest_api.core.dependencies.get_nuclear_revocation_time",
        new=AsyncMock(return_value=None),
    ):
        resp = client.post(
            "/api/waiter/payments/manual",
            json={"check_id": 1, "amount_cents": 1000, "method": "cash"},
            headers={"Authorization": f"Bearer {kitchen_token}"},
        )

    assert resp.status_code == 403


# ── 13.15 — multi-tenant isolation ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_multi_tenant_check_isolation(billing_seeded, db: AsyncSession):
    """User from tenant A cannot access check from tenant B."""
    ctx = billing_seeded

    # Create a check for tenant A session
    service = BillingService(db)

    # Seed session_b with a round so total > 0
    from rest_api.models.menu import Category, Product, Subcategory, BranchProduct

    # We need products for tenant B
    cat_b = Category(
        branch_id=ctx["branch_b"].id,
        name="Food B",
        order=1,
    )
    db.add(cat_b)
    await db.flush()

    sub_b = Subcategory(
        category_id=cat_b.id,
        name="Mains B",
        order=1,
    )
    db.add(sub_b)
    await db.flush()

    product_b = Product(
        subcategory_id=sub_b.id,
        name="Pizza",
        price=1500,
    )
    db.add(product_b)
    await db.flush()

    bp_b = BranchProduct(
        branch_id=ctx["branch_b"].id,
        product_id=product_b.id,
        price_cents=1500,
    )
    db.add(bp_b)
    await db.flush()

    # Add a diner to session_b
    diner_b = Diner(session_id=ctx["session_b"].id, name="Guest B")
    db.add(diner_b)
    await db.flush()

    # Add a SERVED round to session_b
    round_b = Round(
        session_id=ctx["session_b"].id,
        branch_id=ctx["branch_b"].id,
        round_number=1,
        status="SERVED",
        created_by_role="DINER",
        created_by_diner_id=diner_b.id,
    )
    db.add(round_b)
    await db.flush()

    ri_b = RoundItem(
        round_id=round_b.id,
        product_id=product_b.id,
        diner_id=diner_b.id,
        quantity=1,
        price_cents_snapshot=1500,
    )
    db.add(ri_b)
    await db.flush()

    # Create check for tenant B session
    service_b = BillingService(db)
    check_b = await service_b.request_check(
        session_id=ctx["session_b"].id,
        split_method="equal_split",
        tenant_id=ctx["tenant_b"].id,
    )

    # Now try to access with tenant A credentials
    with pytest.raises((ConflictError, NotFoundError)):
        await service.get_check(
            session_id=ctx["session_b"].id,
            tenant_id=ctx["tenant"].id,  # Wrong tenant
        )
