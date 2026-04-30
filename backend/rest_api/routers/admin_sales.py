"""
Admin-facing sales reporting endpoints (C-16).

CLEAN-ARCH: Thin router — zero business logic here.
All logic is delegated to SalesService.

Endpoints:
  GET /api/admin/sales/daily       → daily KPIs (revenue, orders, avg ticket, diners)
  GET /api/admin/sales/top-products → top products by revenue

Auth:
  - Both endpoints: ADMIN or MANAGER only (require_management).
  - Branch-scoped: require_branch_access(branch_id).

RBAC:
  - KITCHEN, WAITER: 403 Forbidden.
"""
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import get_db
from rest_api.core.dependencies import current_user
from rest_api.schemas.sales import DailyKPIsOutput, TopProductOutput
from rest_api.services.domain.sales_service import SalesService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-sales"])

logger = get_logger(__name__)


@router.get(
    "/sales/daily",
    response_model=DailyKPIsOutput,
    summary="Daily sales KPIs for a branch (ADMIN/MANAGER)",
)
async def get_daily_kpis(
    branch_id: int = Query(..., description="Branch ID to aggregate"),
    target_date: date = Query(..., alias="date", description="Date in YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> DailyKPIsOutput:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)

    service = SalesService(db)
    return await service.get_daily_kpis(
        branch_id=branch_id,
        target_date=target_date,
        tenant_id=ctx.tenant_id,
    )


@router.get(
    "/sales/top-products",
    response_model=list[TopProductOutput],
    summary="Top products by revenue for a branch on a given date (ADMIN/MANAGER)",
)
async def get_top_products(
    branch_id: int = Query(..., description="Branch ID to aggregate"),
    target_date: date = Query(..., alias="date", description="Date in YYYY-MM-DD format"),
    limit: int = Query(10, ge=1, le=50, description="Max products to return (1–50)"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[TopProductOutput]:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)

    service = SalesService(db)
    return await service.get_top_products(
        branch_id=branch_id,
        target_date=target_date,
        tenant_id=ctx.tenant_id,
        limit=limit,
    )
