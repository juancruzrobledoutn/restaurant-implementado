"""
Public table join endpoint (C-08).

CLEAN-ARCH: Thin router — zero business logic here.
This is the ONLY unauthenticated write endpoint in the system (D-08).

Endpoint:
  POST /api/public/tables/code/{code}/join   → join a table session

Flow (atomic — see D-08):
  1. Resolve branch_slug + code to a Table (uniform 404 if either is invalid)
  2. If table has an active OPEN session → join it (register new diner)
  3. If table has no active session → activate one, then register diner
  4. If table has a PAYING session → 409 (cannot join, payment in progress)
  5. Issue a Table Token for the new diner
  6. Return PublicJoinResponse (201)

Security:
  - No auth dependency — any client can call this (QR scan flow)
  - Uniform 404 for slug-miss and code-miss — no information leakage (D-07, 9.3)
  - Rate limiting deferred to C-09 (Redis + gateway)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.config.settings import settings
from shared.infrastructure.db import get_db, safe_commit
from shared.security.table_token import issue_table_token
from shared.utils.exceptions import ValidationError
from rest_api.models.branch import Branch
from rest_api.models.sector import Table
from rest_api.schemas.table_session import (
    DinerRegisterInput,
    PublicJoinResponse,
    TablePublicOutput,
)
from rest_api.services.domain.customer_service import CustomerService
from rest_api.services.domain.diner_service import DinerService
from rest_api.services.domain.table_session_service import TableSessionService

router = APIRouter(tags=["public-tables"])
logger = get_logger(__name__)

# Uniform 404 message — same whether slug or code is wrong (no info leak)
_NOT_FOUND_DETAIL = "Mesa no encontrada"


@router.post(
    "/tables/code/{code}/join",
    response_model=PublicJoinResponse,
    status_code=201,
    summary="Join a table session (unauthenticated — diner QR scan)",
)
async def join_table(
    code: str,
    branch_slug: str = Query(..., description="Branch slug — required to disambiguate table codes"),
    body: DinerRegisterInput = ...,
    db: AsyncSession = Depends(get_db),
) -> PublicJoinResponse:
    """
    Atomically join a table session as a diner.

    - If the table has an OPEN session: registers diner to it.
    - If the table has no active session: activates a new one, then registers diner.
    - If the table has a PAYING session: returns 409.

    Uniform 404 for unknown branch_slug or table code — no information leakage.
    """
    session_service = TableSessionService(db)
    diner_service = DinerService(db)

    # Step 1: Resolve branch by slug (no tenant scoping — public endpoint)
    branch = await db.scalar(
        select(Branch).where(
            Branch.slug == branch_slug,
            Branch.is_active.is_(True),
        )
    )
    if not branch:
        raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL)

    # Step 1b: Resolve table by code within the branch
    table = await db.scalar(
        select(Table).where(
            Table.branch_id == branch.id,
            Table.code == code,
            Table.is_active.is_(True),
        )
    )
    if not table:
        raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL)

    tenant_id = branch.tenant_id

    # Step 2: Check for an existing active session
    existing_session = await session_service.get_active_by_table_id(
        table_id=table.id,
        tenant_id=tenant_id,
    )

    if existing_session and existing_session.status == "PAYING":
        raise HTTPException(
            status_code=409,
            detail="La sesión está en proceso de pago y no acepta nuevos comensales",
        )

    # Step 3: Activate a new session if none is active
    if existing_session is None:
        try:
            session_output = await session_service.activate(
                table_id=table.id,
                tenant_id=tenant_id,
                user_id=0,
                user_email="system:diner-join",
                bypass_branch_check=True,
            )
            session_id = session_output.id
        except ValidationError as exc:
            # Race condition: another request activated the session concurrently
            raise HTTPException(status_code=409, detail=str(exc))
    else:
        session_id = existing_session.id

    # Step 4: Register the diner in the session
    diner = await diner_service.register(
        session_id=session_id,
        name=body.name,
        device_id=body.device_id,
    )

    # Step 4b: C-19 — link customer_id if device_id provided and tracking enabled
    # [HUMAN REVIEW — CRITICO: activates customer tracking per join]
    if body.device_id and settings.ENABLE_CUSTOMER_TRACKING:
        try:
            customer_service = CustomerService(db)
            customer = await customer_service.get_or_create_by_device(
                device_id=body.device_id,
                tenant_id=tenant_id,
            )
            diner.customer_id = customer.id
            await db.flush()
            # safe_commit will be called after token issuance — flush is enough here
            logger.debug(
                "public_tables.join: linked customer_id=%s to diner_id=%s",
                customer.id, diner.id,
            )
        except Exception as exc:  # noqa: BLE001
            # Non-fatal: if customer linking fails, diner still joins successfully
            logger.warning(
                "public_tables.join: customer_id linking failed, diner proceeds anonymously — %r",
                exc,
            )

    # Step 5: Issue a Table Token for this diner
    token = issue_table_token(
        session_id=session_id,
        table_id=table.id,
        diner_id=diner.id,
        branch_id=branch.id,
        tenant_id=tenant_id,
    )

    return PublicJoinResponse(
        table_token=token,
        session_id=session_id,
        diner_id=diner.id,
        table=TablePublicOutput.model_validate(table),
    )
