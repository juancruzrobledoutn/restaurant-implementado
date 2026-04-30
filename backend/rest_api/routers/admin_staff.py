"""
Admin staff management router — thin HTTP adapter.

Clean Architecture rules:
  - ZERO business logic — delegates all to StaffService
  - Only: parse request, build PermissionContext, call service, return response
  - NEVER query DB directly from a router
  - Password NEVER in any response

Endpoints:
  GET    /api/admin/staff                     → list (ADMIN/MANAGER)
  GET    /api/admin/staff/{id}                → get single (ADMIN/MANAGER)
  POST   /api/admin/staff                     → create (ADMIN/MANAGER) — 201
  PATCH  /api/admin/staff/{id}                → update (ADMIN/MANAGER)
  DELETE /api/admin/staff/{id}                → soft-delete (ADMIN only) — 204
  POST   /api/admin/staff/{id}/branches       → assign role to branch (ADMIN/MANAGER)
  DELETE /api/admin/staff/{id}/branches/{bid} → revoke role from branch (ADMIN/MANAGER)

RBAC:
  - List/Get/Create/Update: require_management() → ADMIN or MANAGER
  - Delete user: require_admin() → ADMIN only
"""
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import ForbiddenError, NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.schemas.staff import RoleAssignmentIn, StaffCreate, StaffOut, StaffUpdate
from rest_api.services.domain.staff_service import StaffService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-staff"])


def _handle_not_found(exc: NotFoundError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


def _handle_validation(exc: ValidationError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


def _handle_conflict(exc: ValidationError) -> HTTPException:
    return HTTPException(status_code=409, detail=str(exc))


def _handle_forbidden(exc: ForbiddenError) -> HTTPException:
    return HTTPException(status_code=403, detail=str(exc))


@router.get("/staff", response_model=list[StaffOut], summary="List staff (ADMIN/MANAGER)")
async def list_staff(
    branch_id: Optional[int] = Query(default=None, description="Filter by branch ID"),
    role: Optional[str] = Query(default=None, description="Filter by role"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Annotated[AsyncSession, Depends(get_db)] = ...,
    user: Annotated[dict, Depends(current_user)] = ...,
) -> list[StaffOut]:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = StaffService(db)
    try:
        return await service.list_users(
            tenant_id=ctx.tenant_id,
            branch_id=branch_id,
            role=role,
            limit=limit,
            offset=offset,
        )
    except (NotFoundError, ValidationError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/staff/{staff_id}",
    response_model=StaffOut,
    summary="Get staff user by ID (ADMIN/MANAGER)",
)
async def get_staff(
    staff_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> StaffOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = StaffService(db)
    try:
        return await service.get_by_id(user_id=staff_id, tenant_id=ctx.tenant_id)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.post(
    "/staff",
    response_model=StaffOut,
    status_code=201,
    summary="Create staff user (ADMIN/MANAGER)",
)
async def create_staff(
    body: StaffCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> StaffOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = StaffService(db)
    try:
        return await service.create_user(
            data=body,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except ValidationError as exc:
        if "already exists" in str(exc):
            raise _handle_conflict(exc)
        raise _handle_validation(exc)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.patch(
    "/staff/{staff_id}",
    response_model=StaffOut,
    summary="Update staff user (ADMIN/MANAGER)",
)
async def update_staff(
    staff_id: int,
    body: StaffUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> StaffOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = StaffService(db)
    try:
        return await service.update_user(
            user_id=staff_id,
            data=body,
            tenant_id=ctx.tenant_id,
            actor_user_id=ctx.user_id,
        )
    except ValidationError as exc:
        if "already exists" in str(exc):
            raise _handle_conflict(exc)
        raise _handle_validation(exc)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.delete(
    "/staff/{staff_id}",
    status_code=204,
    summary="Soft-delete staff user (ADMIN only)",
)
async def delete_staff(
    staff_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_admin()  # ADMIN only — MANAGER cannot delete users
    service = StaffService(db)
    try:
        await service.soft_delete_user(
            user_id=staff_id,
            tenant_id=ctx.tenant_id,
            actor_user_id=ctx.user_id,
            actor_roles=ctx.roles,
        )
    except ForbiddenError as exc:
        raise _handle_forbidden(exc)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.post(
    "/staff/{staff_id}/branches",
    response_model=StaffOut,
    summary="Assign role to branch (ADMIN/MANAGER)",
)
async def assign_branch_role(
    staff_id: int,
    body: RoleAssignmentIn,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> StaffOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = StaffService(db)
    try:
        return await service.assign_role_to_branch(
            user_id=staff_id,
            tenant_id=ctx.tenant_id,
            assignment=body,
        )
    except ValidationError as exc:
        raise _handle_validation(exc)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.delete(
    "/staff/{staff_id}/branches/{branch_id}",
    status_code=204,
    summary="Revoke all roles from branch (ADMIN/MANAGER)",
)
async def revoke_branch_roles(
    staff_id: int,
    branch_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = StaffService(db)
    try:
        await service.revoke_role_from_branch(
            user_id=staff_id,
            tenant_id=ctx.tenant_id,
            branch_id=branch_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
