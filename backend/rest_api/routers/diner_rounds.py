"""
Diner-facing round endpoints (C-10).

CLEAN-ARCH: Thin router — delegates ALL state-machine logic to RoundService.
Auth: X-Table-Token via current_table_context. No JWT / staff auth here.

Endpoints:
  POST /api/diner/rounds       — create a round from the diner's cart
  GET  /api/diner/rounds       — list rounds for the diner's session
"""
from fastapi import APIRouter, Depends, HTTPException

from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from shared.security.table_token import TableContext, current_table_context
from shared.infrastructure.db import get_db
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.schemas.round import (
    DinerCreateRoundInput,
    RoundWithItemsOutput,
)
from rest_api.services.domain import RoundService

router = APIRouter(tags=["diner-rounds"])


@router.post(
    "/diner/rounds",
    response_model=RoundWithItemsOutput,
    status_code=201,
    summary="Create a round from the diner's cart (Table Token)",
)
async def create_round_from_cart(
    body: DinerCreateRoundInput = DinerCreateRoundInput(),
    ctx: TableContext = Depends(current_table_context),
    db: AsyncSession = Depends(get_db),
) -> RoundWithItemsOutput:
    """
    Turn the calling diner's CartItem rows into a PENDING Round.
    Hard-deletes the consumed cart items atomically.
    """
    del body  # accepted for future fields (notes); not stored yet
    service = RoundService(db)
    try:
        return await service.create_from_cart(
            session_id=ctx.session.id,
            diner_id=ctx.diner_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get(
    "/diner/rounds",
    response_model=list[RoundWithItemsOutput],
    summary="List rounds for the diner's session (Table Token)",
)
async def list_my_rounds(
    ctx: TableContext = Depends(current_table_context),
    db: AsyncSession = Depends(get_db),
) -> list[RoundWithItemsOutput]:
    """Return every round (PENDING through SERVED/CANCELED) for the caller's session."""
    service = RoundService(db)
    try:
        return await service.list_for_diner(
            session_id=ctx.session.id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
