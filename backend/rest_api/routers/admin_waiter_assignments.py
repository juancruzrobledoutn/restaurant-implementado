"""
Admin waiter assignments router — thin HTTP adapter.

Clean Architecture rules:
  - ZERO business logic — delegates all to WaiterAssignmentService
  - Only: parse request, build PermissionContext, call service, return response

Endpoints:
  GET    /api/admin/waiter-assignments        → list (filters: date, branch_id, sector_id)
  POST   /api/admin/waiter-assignments        → create (ADMIN/MANAGER) — 201
  DELETE /api/admin/waiter-assignments/{id}   → hard-delete (ADMIN/MANAGER) — 204

RBAC:
  - All endpoints: require_management() → ADMIN or MANAGER
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.schemas.waiter_assignment import WaiterAssignmentCreate, WaiterAssignmentOut
from rest_api.services.domain.waiter_assignment_service import WaiterAssignmentService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-waiter-assignments"])


def _handle_not_found(exc: NotFoundError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


def _handle_validation(exc: ValidationError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


def _handle_conflict(exc: ValidationError) -> HTTPException:
    return HTTPException(status_code=409, detail=str(exc))


@router.get(
    "/waiter-assignments",
    response_model=list[WaiterAssignmentOut],
    summary="List waiter assignments (ADMIN/MANAGER)",
)
async def list_waiter_assignments(
    target_date: Optional[date] = Query(
        default=None, alias="date", description="Filter by date (YYYY-MM-DD)"
    ),
    branch_id: Optional[int] = Query(default=None, description="Filter by branch ID"),
    sector_id: Optional[int] = Query(default=None, description="Filter by sector ID"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[WaiterAssignmentOut]:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = WaiterAssignmentService(db)

    if target_date is None:
        target_date = date.today()

    return await service.list_by_date(
        tenant_id=ctx.tenant_id,
        target_date=target_date,
        branch_id=branch_id,
        sector_id=sector_id,
    )


@router.post(
    "/waiter-assignments",
    response_model=WaiterAssignmentOut,
    status_code=201,
    summary="Create waiter assignment (ADMIN/MANAGER)",
)
async def create_waiter_assignment(
    body: WaiterAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> WaiterAssignmentOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = WaiterAssignmentService(db)
    try:
        return await service.create(data=body, tenant_id=ctx.tenant_id)
    except ValidationError as exc:
        if "Ya existe" in str(exc):
            raise _handle_conflict(exc)
        raise _handle_validation(exc)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.delete(
    "/waiter-assignments/{assignment_id}",
    status_code=204,
    summary="Delete waiter assignment (ADMIN/MANAGER)",
)
async def delete_waiter_assignment(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = WaiterAssignmentService(db)
    try:
        await service.delete(assignment_id=assignment_id, tenant_id=ctx.tenant_id)
    except NotFoundError as exc:
        raise _handle_not_found(exc)
