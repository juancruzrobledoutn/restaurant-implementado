"""
Customer loyalty router (C-19).

CLEAN-ARCH: Thin router — zero business logic. All logic in CustomerService.

Endpoints:
  GET  /api/customer/profile      → customer profile for current diner (20/min)
  POST /api/customer/opt-in       → GDPR opt-in with consent (3/min — GDPR sensitive)
  GET  /api/customer/history      → last 20 visits (20/min)
  GET  /api/customer/preferences  → top 5 products (20/min)

Auth: X-Table-Token (via current_table_context dependency)
  - All endpoints require a valid Table Token
  - tenant_id and diner_id are resolved from the token, not from query params

CRITICO (governance) — HUMAN REVIEW REQUIRED before merge:
  - opt-in stores PII (name, email, consent_ip_hash)
  - rate limits enforced to prevent scraping/abuse
  - responses NEVER expose raw device_id
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import get_db
from shared.security.table_token import TableContext, current_table_context
from shared.utils.exceptions import ConflictError, NotFoundError, ValidationError
from rest_api.core.limiter import limiter
from rest_api.models.table_session import Diner
from rest_api.schemas.customer import CustomerProfileOut, OptInIn, PreferenceOut, VisitOut
from rest_api.services.domain.customer_service import AlreadyOptedInError, CustomerService

from sqlalchemy import select

router = APIRouter(tags=["customer"])

logger = get_logger(__name__)


async def _get_customer_id(ctx: TableContext, db: AsyncSession) -> int:
    """
    Resolve the customer_id for the current diner.
    Raises 404 with code='customer_not_found' if diner has no customer record.
    """
    diner = await db.scalar(
        select(Diner).where(
            Diner.id == ctx.diner_id,
            Diner.is_active.is_(True),
        )
    )
    if diner is None or diner.customer_id is None:
        raise HTTPException(status_code=404, detail={"code": "customer_not_found"})
    return diner.customer_id


@router.get(
    "/profile",
    response_model=CustomerProfileOut,
    summary="Get customer profile for current diner (20/min)",
)
@limiter.limit("20/minute")
async def get_customer_profile(
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: TableContext = Depends(current_table_context),
) -> CustomerProfileOut:
    """
    Return the customer profile linked to the current diner's device_id.

    Returns 404 if the diner has no associated customer (anonymous diner or
    ENABLE_CUSTOMER_TRACKING was off when they joined).
    Response NEVER includes raw device_id.
    """
    customer_id = await _get_customer_id(ctx, db)
    service = CustomerService(db)
    try:
        return await service.get_profile(customer_id, ctx.tenant_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail={"code": "customer_not_found"})


@router.post(
    "/opt-in",
    response_model=CustomerProfileOut,
    status_code=201,
    summary="GDPR opt-in — record explicit consent (3/min per IP — CRITICO)",
)
@limiter.limit("3/minute")
async def opt_in(
    request: Request,
    body: OptInIn,
    db: AsyncSession = Depends(get_db),
    ctx: TableContext = Depends(current_table_context),
) -> CustomerProfileOut:
    """
    Record GDPR opt-in consent for the current diner's customer.

    - consent_granted MUST be True (server-side check)
    - Rate limit: 3/minute per IP (stricter than other endpoints — prevents abuse)
    - Returns 400 if consent_granted=False
    - Returns 409 if already opted in
    - Returns 201 with updated CustomerProfileOut on success

    HUMAN REVIEW REQUIRED: this endpoint stores PII and consent audit data.
    """
    if not body.consent_granted:
        raise HTTPException(
            status_code=400,
            detail={"code": "consent_required", "message": "consent_granted must be true"},
        )

    customer_id = await _get_customer_id(ctx, db)

    # Extract client IP for hashing (never stored plain-text)
    client_ip = request.client.host if request.client else "unknown"

    service = CustomerService(db)
    try:
        return await service.opt_in(
            customer_id=customer_id,
            tenant_id=ctx.tenant_id,
            name=body.name,
            email=body.email,
            client_ip=client_ip,
            consent_version=body.consent_version,
        )
    except AlreadyOptedInError:
        raise HTTPException(
            status_code=409,
            detail={"code": "already_opted_in"},
        )
    except NotFoundError:
        raise HTTPException(status_code=404, detail={"code": "customer_not_found"})
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": str(exc)})


@router.get(
    "/history",
    response_model=list[VisitOut],
    summary="Get last 20 visits for the current customer (20/min)",
)
@limiter.limit("20/minute")
async def get_visit_history(
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: TableContext = Depends(current_table_context),
) -> list[VisitOut]:
    """
    Return last 20 sessions the current customer attended.

    Returns empty list if no visits found (diner was never linked to a customer).
    """
    customer_id = await _get_customer_id(ctx, db)
    service = CustomerService(db)
    return await service.get_visit_history(
        customer_id=customer_id,
        tenant_id=ctx.tenant_id,
        limit=20,
    )


@router.get(
    "/preferences",
    response_model=list[PreferenceOut],
    summary="Get top 5 products for the current customer (20/min)",
)
@limiter.limit("20/minute")
async def get_preferences(
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: TableContext = Depends(current_table_context),
) -> list[PreferenceOut]:
    """
    Return top 5 products by quantity across all sessions for the current customer.

    Returns empty list if no order history found.
    """
    customer_id = await _get_customer_id(ctx, db)
    service = CustomerService(db)
    return await service.get_preferences(
        customer_id=customer_id,
        tenant_id=ctx.tenant_id,
        top_n=5,
    )
