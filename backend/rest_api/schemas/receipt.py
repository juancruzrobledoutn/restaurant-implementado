"""
Receipt schema (C-16) — internal type hints only.

The receipt endpoint returns raw HTML (HTMLResponse), not JSON.
This module exists for internal type annotations if needed by tests or
future extensions (e.g., PDF generation).
"""
from __future__ import annotations


# No Pydantic models needed — endpoint returns HTMLResponse.
# This file is a placeholder for future receipt-related schemas.
# If PDF generation is added in a future change, ReceiptRequest/ReceiptOut
# would live here.

__all__: list[str] = []
