"""
Waiter-facing round endpoints (C-10).

CLEAN-ARCH: Thin router — delegates ALL state-machine logic to RoundService.
Auth: JWT with WAITER / MANAGER / ADMIN role (require_management_or_waiter).

Endpoints:
  POST  /api/waiter/sessions/{session_id}/rounds    — quick-command round creation
  PATCH /api/waiter/rounds/{round_id}               — confirm PENDING → CONFIRMED
  PATCH /api/waiter/rounds/{round_id}/serve         — serve READY → SERVED
  POST  /api/waiter/rounds/{round_id}/void-item     — void a single round item
  GET   /api/waiter/rounds?session_id={id}          — list rounds for a session
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from rest_api.core.dependencies import current_user
from rest_api.schemas.round import (
    RoundItemOutput,
    RoundOutput,
    RoundWithItemsOutput,
    VoidItemInput,
    WaiterCreateRoundInput,
    WaiterRoundStatusUpdateInput,
)
from rest_api.services.domain import RoundService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["waiter-rounds"])


def _raise_domain_error(exc: Exception) -> None:
    """Map a domain exception to the right HTTPException — used everywhere in this router."""
    if isinstance(exc, NotFoundError):
        raise HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ForbiddenError):
        raise HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, ConflictError):
        raise HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValidationError):
        raise HTTPException(status_code=400, detail=str(exc))
    raise exc  # pragma: no cover


@router.post(
    "/sessions/{session_id}/rounds",
    response_model=RoundWithItemsOutput,
    status_code=201,
    summary="Waiter creates a quick-command round for a session",
)
async def create_round_waiter(
    session_id: int,
    body: WaiterCreateRoundInput,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> RoundWithItemsOutput:
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()
    service = RoundService(db)
    try:
        return await service.create_from_waiter(
            session_id=session_id,
            items_input=[i.model_dump() for i in body.items],
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
            user_id=ctx.user_id,
            user_role=ctx.top_role or "",
        )
    except (NotFoundError, ForbiddenError, ConflictError, ValidationError) as exc:
        _raise_domain_error(exc)


@router.patch(
    "/rounds/{round_id}",
    response_model=RoundOutput,
    summary="Waiter confirms a PENDING round (PENDING → CONFIRMED)",
)
async def confirm_round(
    round_id: int,
    body: WaiterRoundStatusUpdateInput,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> RoundOutput:
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()
    # body.status is Literal["CONFIRMED"] — validated by Pydantic
    del body
    service = RoundService(db)
    try:
        return await service.confirm(
            round_id=round_id,
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
            user_id=ctx.user_id,
            user_role=ctx.top_role or "",
        )
    except (NotFoundError, ForbiddenError, ConflictError, ValidationError) as exc:
        _raise_domain_error(exc)


@router.patch(
    "/rounds/{round_id}/serve",
    response_model=RoundOutput,
    summary="Serve a READY round (READY → SERVED)",
)
async def serve_round(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> RoundOutput:
    ctx = PermissionContext(user)
    ctx.require_serve_allowed()
    service = RoundService(db)
    try:
        return await service.serve(
            round_id=round_id,
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
            user_id=ctx.user_id,
            user_role=ctx.top_role or "",
        )
    except (NotFoundError, ForbiddenError, ConflictError, ValidationError) as exc:
        _raise_domain_error(exc)


@router.post(
    "/rounds/{round_id}/void-item",
    response_model=RoundItemOutput,
    summary="Void a single item within a round (SUBMITTED/IN_KITCHEN/READY only)",
)
async def void_round_item(
    round_id: int,
    body: VoidItemInput,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> RoundItemOutput:
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()
    service = RoundService(db)
    try:
        return await service.void_item(
            round_id=round_id,
            round_item_id=body.round_item_id,
            void_reason=body.void_reason,
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
            user_id=ctx.user_id,
            user_role=ctx.top_role or "",
        )
    except (NotFoundError, ForbiddenError, ConflictError, ValidationError) as exc:
        _raise_domain_error(exc)


@router.get(
    "/rounds",
    response_model=list[RoundWithItemsOutput],
    summary="List rounds for a session",
)
async def list_rounds_for_session(
    session_id: int = Query(..., gt=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[RoundWithItemsOutput]:
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()
    service = RoundService(db)
    try:
        return await service.list_for_session(
            session_id=session_id,
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
        )
    except (NotFoundError, ForbiddenError) as exc:
        _raise_domain_error(exc)
