"""
Diner session endpoint (C-08).

CLEAN-ARCH: Thin router — zero business logic here.
Uses X-Table-Token for authentication (diner identity, not staff JWT).

Endpoint:
  GET /api/diner/session  → full session view for the authenticated diner

Authentication: current_table_context dependency (X-Table-Token header).
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.infrastructure.db import get_db
from shared.security.table_token import TableContext, current_table_context
from rest_api.models.branch import Branch
from rest_api.models.sector import Table
from rest_api.models.table_session import CartItem, Diner, TableSession
from rest_api.schemas.table_session import (
    BranchPublicOutput,
    CartItemOutput,
    DinerOutput,
    DinerSessionView,
    TableForDinerOutput,
    TableSessionOutput,
)

router = APIRouter(prefix="/api/diner", tags=["diner"])


@router.get(
    "/session",
    response_model=DinerSessionView,
    summary="Get full session view for the authenticated diner",
)
async def get_diner_session(
    ctx: TableContext = Depends(current_table_context),
    db: AsyncSession = Depends(get_db),
) -> DinerSessionView:
    """
    Return everything pwaMenu needs to render the session:
    - The session itself
    - The physical table info
    - The branch slug (for WS routing)
    - All diners at the table
    - This diner's current cart items
    """
    session_id = ctx.session.id
    diner_id = ctx.diner_id

    # Load session with diners (eager load to avoid N+1)
    result = await db.execute(
        select(TableSession)
        .options(selectinload(TableSession.diners))
        .where(TableSession.id == session_id)
    )
    session_with_diners = result.scalar_one()

    # Load this diner's cart items for this session
    cart_result = await db.execute(
        select(CartItem).where(
            CartItem.session_id == session_id,
            CartItem.diner_id == diner_id,
        )
    )
    my_cart_items = cart_result.scalars().all()

    return DinerSessionView(
        session=TableSessionOutput.model_validate(session_with_diners),
        table=TableForDinerOutput.model_validate(ctx.table),
        branch_slug=ctx.branch.slug,
        diners=[DinerOutput.model_validate(d) for d in session_with_diners.diners],
        my_cart_items=[CartItemOutput.model_validate(ci) for ci in my_cart_items],
    )
