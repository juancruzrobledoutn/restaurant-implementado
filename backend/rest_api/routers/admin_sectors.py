"""
Admin sectors and tables router — thin HTTP adapter.

Clean Architecture rules:
  - ZERO business logic here — everything delegates to domain services
  - Only: parse request, build PermissionContext, call service, return response
  - NEVER query DB directly from a router

Endpoints:

  Sectors:
    POST   /sectors                                 → create sector (ADMIN/MANAGER)
    GET    /sectors                                 → list by branch_id (ADMIN/MANAGER)
    GET    /sectors/{sector_id}                     → get single (ADMIN/MANAGER)
    PUT    /sectors/{sector_id}                     → update (ADMIN/MANAGER)
    DELETE /sectors/{sector_id}                     → soft-delete + cascade (ADMIN only)

  Tables:
    POST   /tables                                  → create table (ADMIN/MANAGER)
    GET    /tables                                  → list by branch_id + optional sector_id
    GET    /tables/{table_id}                       → get single (ADMIN/MANAGER)
    PUT    /tables/{table_id}                       → update (ADMIN/MANAGER)
    DELETE /tables/{table_id}                       → soft-delete (ADMIN only)

  Waiter Assignments:
    POST   /sectors/{sector_id}/assignments         → create assignment (ADMIN/MANAGER)
    GET    /sectors/{sector_id}/assignments?date=   → list by date (ADMIN/MANAGER)
    DELETE /sectors/{sector_id}/assignments/{id}    → hard-delete (ADMIN/MANAGER)

RBAC:
  - Create/Update: require_management() → ADMIN or MANAGER
  - Delete: require_admin() → ADMIN only (except assignments: ADMIN/MANAGER)
  - Read (list/get): require_management() for admin access
"""
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.schemas.sector import (
    AssignmentCreate,
    AssignmentResponse,
    SectorCreate,
    SectorResponse,
    SectorUpdate,
    TableCreate,
    TableResponse,
    TableUpdate,
)
from rest_api.services.domain.sector_service import SectorService
from rest_api.services.domain.table_service import TableService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-sectors"])


def _handle_not_found(exc: NotFoundError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


def _handle_validation(exc: ValidationError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


def _handle_conflict(exc: ValidationError) -> HTTPException:
    """ValidationError that represents a uniqueness conflict → 409."""
    return HTTPException(status_code=409, detail=str(exc))


# ── Sectors ───────────────────────────────────────────────────────────────────

@router.post(
    "/sectors",
    response_model=SectorResponse,
    status_code=201,
    summary="Create a branch sector (ADMIN/MANAGER)",
)
async def create_sector(
    body: SectorCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[dict, Depends(current_user)],
) -> SectorResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(body.branch_id)
    service = SectorService(db)
    try:
        return await service.create(data=body, tenant_id=ctx.tenant_id, user_id=ctx.user_id)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.get(
    "/sectors",
    response_model=list[SectorResponse],
    summary="List sectors by branch (ADMIN/MANAGER)",
)
async def list_sectors(
    branch_id: int = Query(..., description="Filter by branch ID"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[SectorResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)
    service = SectorService(db)
    try:
        return await service.list_by_branch(
            tenant_id=ctx.tenant_id,
            branch_id=branch_id,
            limit=limit,
            offset=offset,
        )
    except (NotFoundError, ValidationError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/sectors/{sector_id}",
    response_model=SectorResponse,
    summary="Get a sector by ID (ADMIN/MANAGER)",
)
async def get_sector(
    sector_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> SectorResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = SectorService(db)
    try:
        result = await service.get_by_id(sector_id=sector_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(result.branch_id)
        return result
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.put(
    "/sectors/{sector_id}",
    response_model=SectorResponse,
    summary="Update a sector (ADMIN/MANAGER)",
)
async def update_sector(
    sector_id: int,
    body: SectorUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> SectorResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = SectorService(db)
    try:
        existing = await service.get_by_id(sector_id=sector_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(existing.branch_id)
        return await service.update(
            sector_id=sector_id,
            data=body,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.delete(
    "/sectors/{sector_id}",
    summary="Delete a sector + cascade tables (ADMIN only)",
)
async def delete_sector(
    sector_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict[str, Any]:
    ctx = PermissionContext(user)
    ctx.require_admin()
    service = SectorService(db)
    try:
        existing = await service.get_by_id(sector_id=sector_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(existing.branch_id)
        return await service.delete(
            sector_id=sector_id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


# ── Tables ────────────────────────────────────────────────────────────────────

@router.post(
    "/tables",
    response_model=TableResponse,
    status_code=201,
    summary="Create a table (ADMIN/MANAGER)",
)
async def create_table(
    body: TableCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[dict, Depends(current_user)],
) -> TableResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(body.branch_id)
    service = TableService(db)
    try:
        return await service.create(data=body, tenant_id=ctx.tenant_id, user_id=ctx.user_id)
    except ValidationError as exc:
        if "Ya existe" in str(exc):
            raise _handle_conflict(exc)
        raise _handle_validation(exc)


@router.get(
    "/tables",
    response_model=list[TableResponse],
    summary="List tables by branch (ADMIN/MANAGER)",
)
async def list_tables(
    branch_id: int = Query(..., description="Filter by branch ID"),
    sector_id: int | None = Query(default=None, description="Optional filter by sector ID"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[TableResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)
    service = TableService(db)
    try:
        return await service.list_by_branch(
            tenant_id=ctx.tenant_id,
            branch_id=branch_id,
            sector_id=sector_id,
            limit=limit,
            offset=offset,
        )
    except (NotFoundError, ValidationError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/tables/{table_id}",
    response_model=TableResponse,
    summary="Get a table by ID (ADMIN/MANAGER)",
)
async def get_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> TableResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = TableService(db)
    try:
        result = await service.get_by_id(table_id=table_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(result.branch_id)
        return result
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.put(
    "/tables/{table_id}",
    response_model=TableResponse,
    summary="Update a table (ADMIN/MANAGER)",
)
async def update_table(
    table_id: int,
    body: TableUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> TableResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = TableService(db)
    try:
        existing = await service.get_by_id(table_id=table_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(existing.branch_id)
        return await service.update(
            table_id=table_id,
            data=body,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        if "Ya existe" in str(exc):
            raise _handle_conflict(exc)
        raise _handle_validation(exc)


@router.delete(
    "/tables/{table_id}",
    status_code=204,
    summary="Delete a table (ADMIN only)",
)
async def delete_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_admin()
    service = TableService(db)
    try:
        existing = await service.get_by_id(table_id=table_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(existing.branch_id)
        await service.delete(
            table_id=table_id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


# ── Waiter Assignments ────────────────────────────────────────────────────────

@router.post(
    "/sectors/{sector_id}/assignments",
    response_model=AssignmentResponse,
    status_code=201,
    summary="Assign a waiter to a sector for a date (ADMIN/MANAGER)",
)
async def create_assignment(
    sector_id: int,
    body: AssignmentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[dict, Depends(current_user)],
) -> AssignmentResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = SectorService(db)
    try:
        # Validate sector belongs to a branch the user can access
        sector = await service.get_by_id(sector_id=sector_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(sector.branch_id)
        return await service.create_assignment(
            sector_id=sector_id,
            data=body,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        if "Ya existe" in str(exc):
            raise _handle_conflict(exc)
        raise _handle_validation(exc)


@router.get(
    "/sectors/{sector_id}/assignments",
    response_model=list[AssignmentResponse],
    summary="List waiter assignments for a sector on a date (ADMIN/MANAGER)",
)
async def list_assignments(
    sector_id: int,
    assignment_date: date = Query(..., alias="date", description="Date in YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[AssignmentResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = SectorService(db)
    try:
        sector = await service.get_by_id(sector_id=sector_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(sector.branch_id)
        return await service.list_assignments(
            sector_id=sector_id,
            assignment_date=assignment_date,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.delete(
    "/sectors/{sector_id}/assignments/{assignment_id}",
    status_code=204,
    summary="Remove a waiter assignment (ADMIN/MANAGER)",
)
async def delete_assignment(
    sector_id: int,
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = SectorService(db)
    try:
        # Verify sector belongs to tenant and user can access its branch
        sector = await service.get_by_id(sector_id=sector_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(sector.branch_id)
        await service.delete_assignment(
            assignment_id=assignment_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
