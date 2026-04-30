"""
Waiter verify-branch-assignment router — thin HTTP adapter.

Clean Architecture rules:
  - ZERO business logic — delegates all to WaiterAssignmentService

Endpoint:
  GET /api/waiter/verify-branch-assignment?branch_id={id}
    → WAITER only (explicit role check)
    → ALWAYS returns 200 with VerifyBranchAssignmentOut (design D-03)
    → Uses date.today() in UTC

RBAC:
  - WAITER role required explicitly (ADMIN/MANAGER/KITCHEN get 403)
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.constants import Roles
from shared.infrastructure.db import get_db
from rest_api.core.dependencies import current_user
from rest_api.schemas.waiter_assignment import VerifyBranchAssignmentOut
from rest_api.services.domain.waiter_assignment_service import WaiterAssignmentService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["waiter-assignments"])


@router.get(
    "/verify-branch-assignment",
    response_model=VerifyBranchAssignmentOut,
    summary="Verify waiter-branch assignment for today (WAITER only)",
)
async def verify_branch_assignment(
    branch_id: int = Query(..., description="Branch ID to verify assignment for"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> VerifyBranchAssignmentOut:
    """
    Verify if the authenticated waiter is assigned to the given branch today.

    Decision D-03: ALWAYS returns HTTP 200. Never 403/404.
    Returns {assigned: false} if not assigned — prevents tenant data leakage.
    The UI (pwaWaiter) is responsible for showing "Access Denied" when assigned=false.

    Only WAITER role is allowed — ADMIN/MANAGER/KITCHEN get 403.
    """
    ctx = PermissionContext(user)

    # Explicit WAITER role check — ADMIN/MANAGER/KITCHEN not allowed here
    if Roles.WAITER not in ctx.roles:
        raise HTTPException(status_code=403, detail="WAITER role required")

    service = WaiterAssignmentService(db)
    return await service.verify_for_branch(
        user_id=ctx.user_id,
        branch_id=branch_id,
        tenant_id=ctx.tenant_id,
        target_date=date.today(),
    )
