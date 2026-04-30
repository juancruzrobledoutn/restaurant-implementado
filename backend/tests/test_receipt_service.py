"""
Unit/integration tests for ReceiptService (C-16).

Coverage:
  - test_render_returns_html_string
  - test_render_includes_all_items
  - test_render_includes_payments_and_total
  - test_render_html_has_print_styles
  - test_render_cross_tenant_raises_not_found
  - test_render_nonexistent_raises_not_found
  - test_render_uses_ascii_safe_characters
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.billing import Check, Charge, Payment
from rest_api.models.branch import Branch
from rest_api.models.menu import Category, Product, Subcategory
from rest_api.models.round import Round, RoundItem
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import Diner, TableSession
from rest_api.models.tenant import Tenant
from rest_api.services.domain.receipt_service import ReceiptService
from shared.utils.exceptions import NotFoundError


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def receipt_seeded(db: AsyncSession):
    """
    Full scenario: tenant → branch → sector → table → session → diner →
    round → 2 round items → check (PAID) → 1 APPROVED payment.
    """
    tenant_a = Tenant(name="Tenant A")
    tenant_b = Tenant(name="Tenant B")
    db.add_all([tenant_a, tenant_b])
    await db.flush()

    branch_a = Branch(tenant_id=tenant_a.id, name="La Trattoria", slug="la-trattoria", address="Via Roma 1")
    branch_b = Branch(tenant_id=tenant_b.id, name="Other", slug="other", address="Addr B")
    db.add_all([branch_a, branch_b])
    await db.flush()

    sector = BranchSector(branch_id=branch_a.id, name="Salon")
    db.add(sector)
    await db.flush()

    table = Table(branch_id=branch_a.id, sector_id=sector.id, number=5, code="T5", capacity=4, status="AVAILABLE")
    db.add(table)
    await db.flush()

    cat = Category(branch_id=branch_a.id, name="Menu", order=1)
    db.add(cat)
    await db.flush()
    sub = Subcategory(category_id=cat.id, name="Platos", order=1)
    db.add(sub)
    await db.flush()

    prod_pizza = Product(subcategory_id=sub.id, name="Pizza Margherita", description="", price=1500)
    prod_bebida = Product(subcategory_id=sub.id, name="Agua Mineral", description="", price=300)
    db.add_all([prod_pizza, prod_bebida])
    await db.flush()

    session = TableSession(table_id=table.id, branch_id=branch_a.id, status="CLOSED")
    db.add(session)
    await db.flush()

    diner = Diner(session_id=session.id, name="Mesa 5")
    db.add(diner)
    await db.flush()

    rnd = Round(
        session_id=session.id, branch_id=branch_a.id,
        round_number=1, status="SERVED", created_by_role="WAITER",
    )
    db.add(rnd)
    await db.flush()

    item1 = RoundItem(round_id=rnd.id, product_id=prod_pizza.id, quantity=2, price_cents_snapshot=1500, is_voided=False)
    item2 = RoundItem(round_id=rnd.id, product_id=prod_bebida.id, quantity=3, price_cents_snapshot=300, is_voided=False)
    db.add_all([item1, item2])
    await db.flush()

    # total = 2*1500 + 3*300 = 3000 + 900 = 3900
    check = Check(
        session_id=session.id,
        branch_id=branch_a.id,
        tenant_id=tenant_a.id,
        total_cents=3900,
        status="PAID",
    )
    db.add(check)
    await db.flush()

    payment = Payment(check_id=check.id, amount_cents=3900, method="card", status="APPROVED")
    db.add(payment)
    await db.flush()

    return {
        "tenant_a": tenant_a,
        "tenant_b": tenant_b,
        "branch_a": branch_a,
        "check": check,
        "prod_pizza": prod_pizza,
        "prod_bebida": prod_bebida,
    }


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_render_returns_html_string(db: AsyncSession, receipt_seeded):
    """render() returns a non-empty string starting with '<!DOCTYPE html>'."""
    check = receipt_seeded["check"]
    tenant_a = receipt_seeded["tenant_a"]

    service = ReceiptService(db)
    html = await service.render(check.id, tenant_a.id)

    assert isinstance(html, str)
    assert len(html) > 100
    assert "<!DOCTYPE html>" in html


@pytest.mark.asyncio
async def test_render_includes_all_items(db: AsyncSession, receipt_seeded):
    """All non-voided round items appear in the rendered HTML."""
    check = receipt_seeded["check"]
    tenant_a = receipt_seeded["tenant_a"]

    service = ReceiptService(db)
    html = await service.render(check.id, tenant_a.id)

    assert "Pizza Margherita" in html
    assert "Agua Mineral" in html


@pytest.mark.asyncio
async def test_render_includes_payments_and_total(db: AsyncSession, receipt_seeded):
    """Receipt HTML includes payment method and total amount."""
    check = receipt_seeded["check"]
    tenant_a = receipt_seeded["tenant_a"]

    service = ReceiptService(db)
    html = await service.render(check.id, tenant_a.id)

    # Total 3900 cents = $39.00
    assert "39.00" in html
    # Payment method
    assert "Tarjeta" in html or "card" in html.lower()


@pytest.mark.asyncio
async def test_render_html_has_print_styles(db: AsyncSession, receipt_seeded):
    """Receipt HTML contains @media print and thermal printer styles."""
    check = receipt_seeded["check"]
    tenant_a = receipt_seeded["tenant_a"]

    service = ReceiptService(db)
    html = await service.render(check.id, tenant_a.id)

    assert "@media print" in html
    assert "80mm" in html
    assert "monospace" in html


@pytest.mark.asyncio
async def test_render_cross_tenant_raises_not_found(db: AsyncSession, receipt_seeded):
    """Accessing a check from a different tenant raises NotFoundError."""
    check = receipt_seeded["check"]
    tenant_b = receipt_seeded["tenant_b"]

    service = ReceiptService(db)
    with pytest.raises(NotFoundError):
        await service.render(check.id, tenant_b.id)


@pytest.mark.asyncio
async def test_render_nonexistent_raises_not_found(db: AsyncSession, receipt_seeded):
    """Accessing a non-existent check raises NotFoundError."""
    tenant_a = receipt_seeded["tenant_a"]

    service = ReceiptService(db)
    with pytest.raises(NotFoundError):
        await service.render(999999, tenant_a.id)


@pytest.mark.asyncio
async def test_render_uses_ascii_safe_characters(db: AsyncSession, receipt_seeded):
    """All characters in the rendered HTML output are ASCII-safe."""
    check = receipt_seeded["check"]
    tenant_a = receipt_seeded["tenant_a"]

    service = ReceiptService(db)
    html = await service.render(check.id, tenant_a.id)

    # Scan for non-ASCII characters in the body text (outside <style> block)
    # We allow the full HTML structure but verify no problematic high-byte chars
    # from the receipt content sections escape into the monospace receipt text.
    # Check the key content areas for ASCII safety.
    body_start = html.find("<body>")
    body_content = html[body_start:] if body_start > -1 else html

    # Branch name, product names, etc. should be ASCII
    for char in body_content:
        code = ord(char)
        # Allow standard printable ASCII (32-126) + newline/tab/CR + common HTML chars
        assert code < 128 or char in ('\n', '\r', '\t'), (
            f"Non-ASCII char {char!r} (U+{code:04X}) found in receipt body"
        )
