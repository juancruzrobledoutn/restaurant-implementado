"""
Unit tests for BillingService internal logic (C-12).

Tests isolated logic that does NOT require a running DB or network:
  - _split_equal: equal distribution with rounding residual
  - _split_custom: valid sum passes, invalid raises 400
  - MercadoPagoGateway.verify_webhook: valid/invalid HMAC

Tests requiring DB (in-memory SQLite):
  - _remaining_cents: computes correctly from allocation rows
  - _allocate: FIFO allocation scenarios

All monetary values in cents (int). No floats.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import sys
from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from shared.utils.exceptions import ValidationError
from rest_api.services.domain.billing_service import BillingService

# Stub out the mercadopago package if not installed (it's a runtime dep, not a test dep)
if "mercadopago" not in sys.modules:
    mercadopago_stub = MagicMock()
    mercadopago_stub.SDK = MagicMock
    sys.modules["mercadopago"] = mercadopago_stub


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures & helpers
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class FakeDiner:
    id: int


def _make_service(db: AsyncSession) -> BillingService:
    return BillingService(db)


# ──────────────────────────────────────────────────────────────────────────────
# 12.2 — _split_equal
# ──────────────────────────────────────────────────────────────────────────────


def test_split_equal_three_diners_with_residual():
    """3 diners, total=1001 → [333, 333, 335]. Last diner absorbs residual."""
    service = BillingService.__new__(BillingService)
    diners = [FakeDiner(1), FakeDiner(2), FakeDiner(3)]

    result = service._split_equal(1001, diners)

    assert result == [(1, 333), (2, 333), (3, 335)]
    assert sum(r[1] for r in result) == 1001


def test_split_equal_even_division():
    """3 diners, total=900 → [300, 300, 300]. No residual."""
    service = BillingService.__new__(BillingService)
    diners = [FakeDiner(1), FakeDiner(2), FakeDiner(3)]

    result = service._split_equal(900, diners)

    assert result == [(1, 300), (2, 300), (3, 300)]
    assert sum(r[1] for r in result) == 900


def test_split_equal_one_diner():
    """1 diner, total=500 → [(1, 500)]."""
    service = BillingService.__new__(BillingService)
    diners = [FakeDiner(42)]

    result = service._split_equal(500, diners)

    assert result == [(42, 500)]


def test_split_equal_two_diners_odd_total():
    """2 diners, total=101 → [50, 51]."""
    service = BillingService.__new__(BillingService)
    diners = [FakeDiner(1), FakeDiner(2)]

    result = service._split_equal(101, diners)

    assert result == [(1, 50), (2, 51)]
    assert sum(r[1] for r in result) == 101


def test_split_equal_zero_diners():
    """No diners → empty list."""
    service = BillingService.__new__(BillingService)

    result = service._split_equal(1000, [])

    assert result == []


# ──────────────────────────────────────────────────────────────────────────────
# 12.3 — _split_custom
# ──────────────────────────────────────────────────────────────────────────────


def test_split_custom_valid_sum_passes():
    """Valid custom_split matching total_cents passes without error."""
    service = BillingService.__new__(BillingService)
    custom_split = {1: 300, 2: 400, 3: 300}

    result = service._split_custom(1000, custom_split)

    assert sum(r[1] for r in result) == 1000
    assert len(result) == 3


def test_split_custom_invalid_sum_raises_400():
    """Invalid sum → ValidationError."""
    service = BillingService.__new__(BillingService)
    custom_split = {1: 300, 2: 200}  # sum=500, total=1000

    with pytest.raises(ValidationError) as exc_info:
        service._split_custom(1000, custom_split)

    assert "500" in str(exc_info.value)
    assert "1000" in str(exc_info.value)


def test_split_custom_zero_amount_filtered():
    """Zero amounts are filtered out."""
    service = BillingService.__new__(BillingService)
    custom_split = {1: 1000, 2: 0}  # only diner 1 has an amount

    result = service._split_custom(1000, custom_split)

    assert len(result) == 1
    assert result[0] == (1, 1000)


def test_split_custom_single_diner():
    """Single diner takes the full amount."""
    service = BillingService.__new__(BillingService)

    result = service._split_custom(750, {5: 750})

    assert result == [(5, 750)]


# ──────────────────────────────────────────────────────────────────────────────
# 12.4 — _remaining_cents (requires DB)
# ──────────────────────────────────────────────────────────────────────────────


async def _seed_minimal_check(db: AsyncSession):
    """
    Insert minimal FK parents for billing rows:
    app_tenant → branch → table_session → app_check
    Returns the seeded Check id.
    """
    from rest_api.models.billing import Check
    from rest_api.models.branch import Branch
    from rest_api.models.sector import BranchSector, Table
    from rest_api.models.table_session import TableSession
    from rest_api.models.tenant import Tenant

    tenant = Tenant(name="FIFO Test Tenant")
    db.add(tenant)
    await db.flush()

    branch = Branch(tenant_id=tenant.id, name="FIFO Branch", address="Addr", slug="fifo")
    db.add(branch)
    await db.flush()

    sector = BranchSector(branch_id=branch.id, name="S")
    db.add(sector)
    await db.flush()

    table = Table(
        branch_id=branch.id, sector_id=sector.id,
        number=1, code="T1", capacity=4, status="AVAILABLE"
    )
    db.add(table)
    await db.flush()

    session = TableSession(table_id=table.id, branch_id=branch.id, status="PAYING")
    db.add(session)
    await db.flush()

    check = Check(
        session_id=session.id,
        branch_id=branch.id,
        tenant_id=tenant.id,
        total_cents=5000,
        status="REQUESTED",
    )
    db.add(check)
    await db.flush()

    return check


@pytest.mark.asyncio
async def test_remaining_cents_no_allocations(db: AsyncSession):
    """remaining_cents = charge.amount_cents when no allocations exist."""
    from rest_api.models.billing import Charge

    check = await _seed_minimal_check(db)

    charge = Charge(check_id=check.id, amount_cents=500, description="Test")
    db.add(charge)
    await db.flush()

    service = BillingService(db)
    remaining = await service._remaining_cents(charge.id)

    assert remaining == 500


@pytest.mark.asyncio
async def test_remaining_cents_partial_allocation(db: AsyncSession):
    """remaining_cents = charge.amount_cents - SUM(allocations)."""
    from rest_api.models.billing import Allocation, Charge, Payment

    check = await _seed_minimal_check(db)

    charge = Charge(check_id=check.id, amount_cents=1000, description="Test")
    db.add(charge)
    await db.flush()

    payment = Payment(check_id=check.id, amount_cents=300, method="cash", status="APPROVED")
    db.add(payment)
    await db.flush()

    alloc = Allocation(charge_id=charge.id, payment_id=payment.id, amount_cents=300)
    db.add(alloc)
    await db.flush()

    service = BillingService(db)
    remaining = await service._remaining_cents(charge.id)

    assert remaining == 700


@pytest.mark.asyncio
async def test_remaining_cents_fully_allocated(db: AsyncSession):
    """remaining_cents = 0 when fully allocated."""
    from rest_api.models.billing import Allocation, Charge, Payment

    check = await _seed_minimal_check(db)

    charge = Charge(check_id=check.id, amount_cents=500, description="Test")
    db.add(charge)
    await db.flush()

    payment = Payment(check_id=check.id, amount_cents=500, method="cash", status="APPROVED")
    db.add(payment)
    await db.flush()

    alloc = Allocation(charge_id=charge.id, payment_id=payment.id, amount_cents=500)
    db.add(alloc)
    await db.flush()

    service = BillingService(db)
    remaining = await service._remaining_cents(charge.id)

    assert remaining == 0


@pytest.mark.asyncio
async def test_remaining_cents_multiple_allocations(db: AsyncSession):
    """remaining_cents computed correctly with multiple allocation rows."""
    from rest_api.models.billing import Allocation, Charge, Payment

    check = await _seed_minimal_check(db)

    charge = Charge(check_id=check.id, amount_cents=1000, description="Test")
    db.add(charge)
    await db.flush()

    p1 = Payment(check_id=check.id, amount_cents=300, method="cash", status="APPROVED")
    p2 = Payment(check_id=check.id, amount_cents=200, method="card", status="APPROVED")
    db.add(p1)
    db.add(p2)
    await db.flush()

    db.add(Allocation(charge_id=charge.id, payment_id=p1.id, amount_cents=300))
    db.add(Allocation(charge_id=charge.id, payment_id=p2.id, amount_cents=200))
    await db.flush()

    service = BillingService(db)
    remaining = await service._remaining_cents(charge.id)

    assert remaining == 500


# ──────────────────────────────────────────────────────────────────────────────
# 12.5 — MercadoPagoGateway.verify_webhook HMAC
# ──────────────────────────────────────────────────────────────────────────────


def _make_signature(body: bytes, secret: str, ts: str) -> str:
    """Build a valid MP x-signature header value."""
    signed_string = f"{ts}.{body.decode('utf-8')}"
    sig = hmac.new(
        secret.encode("utf-8"),
        signed_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"ts={ts},v1={sig}"


@pytest.mark.asyncio
async def test_verify_webhook_valid_signature():
    """Valid HMAC signature passes verification."""
    from rest_api.services.mercadopago_gateway import MercadoPagoGateway

    secret = "test-webhook-secret-32-characters!"
    body = json.dumps({
        "action": "payment.updated",
        "data": {"id": "123456", "status": "approved", "transaction_amount": 10.0},
    }).encode("utf-8")
    ts = "1712345678"
    signature = _make_signature(body, secret, ts)

    with patch("rest_api.services.mercadopago_gateway.settings") as mock_settings:
        mock_settings.MERCADOPAGO_ACCESS_TOKEN = "TEST-token"
        mock_settings.MERCADOPAGO_WEBHOOK_SECRET = secret

        gateway = MercadoPagoGateway.__new__(MercadoPagoGateway)
        gateway._sdk = MagicMock()

        event = await gateway.verify_webhook(body, signature)

    assert event.external_id == "123456"
    assert event.status == "approved"


@pytest.mark.asyncio
async def test_verify_webhook_invalid_signature_raises():
    """Invalid HMAC raises ValueError."""
    from rest_api.services.mercadopago_gateway import MercadoPagoGateway

    body = json.dumps({"action": "payment.updated", "data": {"id": "99"}}).encode()
    bad_signature = "ts=111,v1=deadbeef"

    with patch("rest_api.services.mercadopago_gateway.settings") as mock_settings:
        mock_settings.MERCADOPAGO_ACCESS_TOKEN = "TEST-token"
        mock_settings.MERCADOPAGO_WEBHOOK_SECRET = "some-secret"

        gateway = MercadoPagoGateway.__new__(MercadoPagoGateway)
        gateway._sdk = MagicMock()

        with pytest.raises(ValueError, match="Invalid webhook signature"):
            await gateway.verify_webhook(body, bad_signature)


@pytest.mark.asyncio
async def test_verify_webhook_missing_signature_raises():
    """Empty x-signature header raises ValueError."""
    from rest_api.services.mercadopago_gateway import MercadoPagoGateway

    body = b'{"action": "payment.updated"}'

    with patch("rest_api.services.mercadopago_gateway.settings") as mock_settings:
        mock_settings.MERCADOPAGO_ACCESS_TOKEN = "TEST-token"
        mock_settings.MERCADOPAGO_WEBHOOK_SECRET = "some-secret"

        gateway = MercadoPagoGateway.__new__(MercadoPagoGateway)
        gateway._sdk = MagicMock()

        with pytest.raises(ValueError, match="Missing"):
            await gateway.verify_webhook(body, "")


@pytest.mark.asyncio
async def test_verify_webhook_malformed_signature_raises():
    """Malformed x-signature without ts= or v1= raises ValueError."""
    from rest_api.services.mercadopago_gateway import MercadoPagoGateway

    body = b'{"action": "payment.updated"}'
    bad_sig = "malformed-no-equals-signs"

    with patch("rest_api.services.mercadopago_gateway.settings") as mock_settings:
        mock_settings.MERCADOPAGO_ACCESS_TOKEN = "TEST-token"
        mock_settings.MERCADOPAGO_WEBHOOK_SECRET = "some-secret"

        gateway = MercadoPagoGateway.__new__(MercadoPagoGateway)
        gateway._sdk = MagicMock()

        with pytest.raises(ValueError, match="Malformed"):
            await gateway.verify_webhook(body, bad_sig)
