"""
ReceiptService — generates printable HTML receipts for thermal printers (C-16).

Architecture:
  - Read-only service — never calls safe_commit.
  - Raises NotFoundError if check doesn't exist or tenant_id mismatch.
  - Returns raw HTML string; the router wraps it in HTMLResponse.

Template notes:
  - @media print @page { size: 80mm auto; margin: 2mm } — 80mm thermal paper
  - font-family: monospace — universal printer driver rendering
  - ASCII-safe characters only — no emojis, no accented letters that may break
    ESC/POS encoding. Accented characters are replaced in _safe_str().
  - Format: qty x name .......... $subtotal (dot-leader alignment)

Rules (NON-NEGOTIABLE):
  - NEVER db.commit() — read-only.
  - NEVER is_active == True — use .is_(True).
  - ALWAYS filter by tenant_id.
  - ALWAYS use _safe_str() for any user-supplied text in the template.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.utils.exceptions import NotFoundError
from rest_api.models.billing import Check
from rest_api.models.branch import Branch
from rest_api.models.menu import Product
from rest_api.models.round import Round, RoundItem
from rest_api.models.table_session import TableSession

logger = get_logger(__name__)

# Width of the thermal receipt line in characters (80mm ≈ 32 chars @ 12px mono)
_LINE_WIDTH = 32


def _safe_str(text: str | None) -> str:
    """
    Return ASCII-safe representation of a string for thermal printers.

    Replaces accented vowels and common Spanish characters with their ASCII
    equivalents to avoid ESC/POS encoding issues. Returns empty string for None.
    """
    if not text:
        return ""
    replacements = {
        "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u",
        "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U",
        "ñ": "n", "Ñ": "N", "ü": "u", "Ü": "U",
        "\u2019": "'", "\u2018": "'", "\u201c": '"', "\u201d": '"',
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    # Strip remaining non-ASCII characters
    return text.encode("ascii", errors="replace").decode("ascii")


def _format_cents(cents: int) -> str:
    """Format integer cents as '$XX.XX' string."""
    return f"${cents / 100:.2f}"


def _dot_leader_line(left: str, right: str, width: int = _LINE_WIDTH) -> str:
    """
    Build a dot-leader line: 'left .......... right'

    If the content is wider than width, it wraps crudely at width.
    """
    available = width - len(left) - len(right)
    dots = "." * max(available, 1)
    return f"{left} {dots} {right}"


class ReceiptService:
    """
    Read-only service that renders a billing check as printable HTML.

    Usage:
        service = ReceiptService(db)
        html = await service.render(check_id=42, tenant_id=1)
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def render(self, check_id: int, tenant_id: int) -> str:
        """
        Render a billing check as a printable HTML receipt string.

        Raises:
            NotFoundError: if the check does not exist, is soft-deleted,
                           or belongs to a different tenant.
        """
        # Load check with payments and charges (selectinload for N+1 safety)
        q = (
            select(Check)
            .options(
                selectinload(Check.payments),
                selectinload(Check.charges),
                selectinload(Check.session).selectinload(TableSession.table),
            )
            .join(Branch, Check.branch_id == Branch.id)
            .where(
                Check.id == check_id,
                Check.is_active.is_(True),
                Branch.tenant_id == tenant_id,
            )
        )
        result = await self._db.execute(q)
        check = result.scalar_one_or_none()

        if check is None:
            raise NotFoundError("Cuenta", check_id)

        # Load branch name for the header
        branch_q = select(Branch).where(Branch.id == check.branch_id)
        branch_result = await self._db.execute(branch_q)
        branch = branch_result.scalar_one()

        # Load round items for this session to build receipt lines
        # Check → session_id → Round → RoundItem (non-voided)
        items_q = (
            select(
                RoundItem.quantity,
                Product.name.label("product_name"),
                RoundItem.price_cents_snapshot,
                RoundItem.notes,
            )
            .join(Product, RoundItem.product_id == Product.id)
            .join(Round, RoundItem.round_id == Round.id)
            .where(
                Round.session_id == check.session_id,
                RoundItem.is_voided.is_(False),
                RoundItem.is_active.is_(True),
            )
            .order_by(Round.round_number, RoundItem.id)
        )
        items_result = await self._db.execute(items_q)
        item_rows = items_result.all()

        # Table number from session
        table_number = ""
        if check.session and check.session.table:
            table_number = str(check.session.table.number)

        html = self._build_html(
            branch_name=_safe_str(branch.name),
            branch_address=_safe_str(getattr(branch, "address", "") or ""),
            table_number=table_number,
            check_id=check.id,
            item_rows=list(item_rows),
            payments=check.payments,
            total_cents=check.total_cents,
        )
        return html

    def _build_html(
        self,
        branch_name: str,
        branch_address: str,
        table_number: str,
        check_id: int,
        item_rows: list,
        payments: list,
        total_cents: int,
    ) -> str:
        """Build the receipt HTML string using f-string template."""
        # Build items section
        items_html_parts = []
        for row in item_rows:
            name = _safe_str(row.product_name)
            subtotal = row.quantity * row.price_cents_snapshot
            left = f"{row.quantity}x {name}"
            right = _format_cents(subtotal)
            line = _dot_leader_line(left, right)
            items_html_parts.append(f"<div>{line}</div>")
            if row.notes:
                items_html_parts.append(
                    f"<div style='font-style:italic;font-size:10px;'>  {_safe_str(row.notes)}</div>"
                )

        items_html = "\n".join(items_html_parts) if items_html_parts else "<div>Sin items</div>"

        # Build payments section
        payments_html_parts = []
        approved = [p for p in payments if p.status == "APPROVED"]
        for pmt in approved:
            method_label = {
                "cash": "Efectivo",
                "card": "Tarjeta",
                "transfer": "Transferencia",
                "mercadopago": "MercadoPago",
            }.get(pmt.method, _safe_str(pmt.method))
            left = method_label
            right = _format_cents(pmt.amount_cents)
            payments_html_parts.append(f"<div>{_dot_leader_line(left, right)}</div>")

        payments_html = "\n".join(payments_html_parts) if payments_html_parts else "<div>Sin pagos</div>"

        table_line = f"Mesa: {table_number}" if table_number else ""
        check_line = f"Cuenta #: {check_id}"

        return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Recibo #{check_id}</title>
<style>
  @media print {{
    @page {{ size: 80mm auto; margin: 2mm; }}
    body {{ margin: 0; }}
    .no-print {{ display: none !important; }}
  }}
  body {{
    font-family: monospace;
    font-size: 12px;
    width: {_LINE_WIDTH}ch;
    margin: 0 auto;
    padding: 4px;
  }}
  .center {{ text-align: center; }}
  .divider {{ border-top: 1px dashed #000; margin: 4px 0; }}
  .total {{ font-size: 14px; font-weight: bold; }}
  .footer {{ margin-top: 8px; text-align: center; font-size: 10px; }}
  .btn-print {{
    display: block;
    margin: 8px auto;
    padding: 6px 16px;
    font-size: 14px;
    cursor: pointer;
  }}
</style>
</head>
<body>
  <div class="center no-print">
    <button class="btn-print" onclick="window.print()">Imprimir</button>
  </div>

  <div class="center">
    <strong>{branch_name}</strong>
  </div>
  {f'<div class="center">{branch_address}</div>' if branch_address else ''}
  <div class="divider"></div>

  {f'<div>{table_line}</div>' if table_line else ''}
  <div>{check_line}</div>
  <div class="divider"></div>

  <div><strong>DETALLE</strong></div>
  {items_html}
  <div class="divider"></div>

  <div class="total">{_dot_leader_line("TOTAL", _format_cents(total_cents))}</div>
  <div class="divider"></div>

  <div><strong>PAGOS</strong></div>
  {payments_html}
  <div class="divider"></div>

  <div class="footer">Gracias por su visita</div>
</body>
</html>"""
