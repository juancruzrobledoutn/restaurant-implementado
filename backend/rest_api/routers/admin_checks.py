"""
Admin-facing check receipt endpoint (C-16).

CLEAN-ARCH: Thin router — zero business logic here.
All logic is delegated to ReceiptService.

Endpoints:
  GET /api/admin/checks/{check_id}/receipt → HTML receipt for thermal printing

Auth:
  - ADMIN or MANAGER only (require_management).
  - ReceiptService validates tenant_id; raises NotFoundError on cross-tenant.

Rate limit:
  - 20/minute per user (receipt printing is not a bulk operation).
  - Follows slowapi pattern from billing.py.

Note on JWT in query param:
  The browser opens this URL in a new window via window.open() and calls
  window.print(). Because the JWT lives in memory (not in cookies), the
  backend accepts the token via Authorization header when fetched via JS,
  or the frontend uses fetch+blob+URL.createObjectURL for the new tab approach.
  See receiptAPI.ts and OQ-1 in design.md.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import get_db
from shared.utils.exceptions import NotFoundError
from rest_api.core.dependencies import current_user
from rest_api.core.limiter import limiter
from rest_api.services.domain.receipt_service import ReceiptService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-checks"])

logger = get_logger(__name__)


@router.get(
    "/checks/{check_id}/receipt",
    response_class=HTMLResponse,
    summary="Get printable HTML receipt for a billing check (ADMIN/MANAGER, 20/min)",
)
@limiter.limit("20/minute")
async def get_check_receipt(
    check_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> HTMLResponse:
    ctx = PermissionContext(user)
    ctx.require_management()

    service = ReceiptService(db)
    try:
        html = await service.render(check_id=check_id, tenant_id=ctx.tenant_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return HTMLResponse(content=html, status_code=200)
