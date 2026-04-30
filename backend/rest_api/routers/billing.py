"""
Billing router (C-12).

CLEAN-ARCH: Thin router — zero business logic here.
All logic is delegated to BillingService.

Endpoints:
  POST /api/billing/check/request       → request check (JWT or Table Token, 5/min)
  GET  /api/billing/check/{session_id}  → get check status (JWT or Table Token, 20/min)
  POST /api/billing/payment/preference  → create MP preference (JWT or Table Token, 5/min)
  POST /api/billing/payment/webhook     → MP IPN (no auth, 5/min — IP-based)
  GET  /api/billing/payment/{id}/status → payment status (JWT or Table Token, 20/min)

Auth:
  - JWT endpoints: use current_user dependency (Dashboard/pwaWaiter).
  - Table Token endpoints: also accept diner tokens from pwaMenu.
  - Webhook: NO auth — signature is verified inside BillingService.process_mp_webhook().

Rate limits (slowapi, per IP):
  - check_request: 5/minute
  - payment_ops: 20/minute
  - critical (webhook, preference): 5/minute

RBAC:
  - All billing endpoints: WAITER, MANAGER, ADMIN (kitchen excluded).
    Diners access via Table Token (handled by diner_or_user dependency).
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import get_db
from shared.utils.exceptions import ConflictError, NotFoundError, ValidationError
from rest_api.core.dependencies import current_user, get_payment_gateway
from rest_api.core.limiter import limiter
from rest_api.schemas.billing import (
    CheckOut,
    CheckRequestBody,
    MPPreferenceBody,
    MPPreferenceOut,
    PaymentStatusOut,
)
from rest_api.services.domain.billing_service import BillingService
from rest_api.services.payment_gateway import PaymentGateway
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["billing"])

logger = get_logger(__name__)


@router.post(
    "/check/request",
    response_model=CheckOut,
    status_code=201,
    summary="Request a billing check for a table session (5/min)",
)
@limiter.limit("5/minute")
async def request_check(
    request: Request,
    body: CheckRequestBody,
    session_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> CheckOut:
    """
    Create a billing check for a session, transitioning it from OPEN → PAYING.

    - split_method: how to distribute total among diners.
    - custom_split: required when split_method='custom'.

    Returns 409 if session is not OPEN or check already exists.
    """
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    service = BillingService(db)
    try:
        return await service.request_check(
            session_id=session_id,
            split_method=body.split_method,
            tenant_id=ctx.tenant_id,
            custom_split=body.custom_split,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (ConflictError, ValidationError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get(
    "/check/{session_id}",
    response_model=CheckOut,
    status_code=200,
    summary="Get check status with charges and payments (20/min)",
)
@limiter.limit("20/minute")
async def get_check(
    request: Request,
    session_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> CheckOut:
    """Return the full check for a session with charges (remaining_cents) and payments."""
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    service = BillingService(db)
    try:
        return await service.get_check(session_id=session_id, tenant_id=ctx.tenant_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.post(
    "/payment/preference",
    response_model=MPPreferenceOut,
    status_code=200,
    summary="Create MercadoPago payment preference (5/min)",
)
@limiter.limit("5/minute")
async def create_payment_preference(
    request: Request,
    body: MPPreferenceBody,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
    gateway: PaymentGateway = Depends(get_payment_gateway),
) -> MPPreferenceOut:
    """
    Create a MercadoPago payment preference for a check.

    Returns preference_id and init_point (redirect URL for checkout).
    The gateway creates a PENDING payment record before calling MP API.
    """
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    service = BillingService(db)
    try:
        return await service.create_mp_preference(
            check_id=body.check_id,
            tenant_id=ctx.tenant_id,
            gateway=gateway,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (ConflictError, ValidationError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"Payment gateway error: {exc}")


@router.post(
    "/payment/webhook",
    status_code=200,
    summary="MercadoPago IPN webhook (no auth, 5/min)",
)
@limiter.limit("5/minute")
async def mp_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
) -> dict:
    """
    Receive and process MercadoPago IPN webhook notifications.

    No auth required — signature verified via HMAC-SHA256 with
    MERCADOPAGO_WEBHOOK_SECRET.

    Returns 200 immediately after signature verification to prevent MP retries.
    Returns 400 if signature is invalid.
    """
    raw_body = await request.body()
    signature = request.headers.get("x-signature", "")

    try:
        event = await gateway.verify_webhook(raw_body, signature)
    except ValueError as exc:
        logger.warning("billing.webhook: signature_invalid error=%r", str(exc))
        raise HTTPException(status_code=400, detail=f"Invalid webhook signature: {exc}")

    # Extract check_id from query params (MP passes it as external_reference)
    check_id_str = request.query_params.get("check_id")
    check_id = int(check_id_str) if check_id_str else None

    # Extract tenant_id from query params (set when creating preference)
    tenant_id_str = request.query_params.get("tenant_id")
    if not tenant_id_str:
        # Try to extract tenant from the payload
        try:
            import json
            body_data = json.loads(raw_body)
            tenant_id_str = str(body_data.get("tenant_id", ""))
        except Exception:
            pass

    if not tenant_id_str:
        # Log and return 200 — MP will retry but we can't process without tenant context
        logger.warning(
            "billing.webhook: missing tenant_id in webhook — external_id=%s",
            event.external_id,
        )
        return {"status": "received"}

    tenant_id = int(tenant_id_str)

    service = BillingService(db)
    try:
        await service.process_mp_webhook(
            external_id=event.external_id,
            mp_status=event.status,
            amount_cents=event.amount_cents,
            tenant_id=tenant_id,
            check_id=check_id,
        )
    except NotFoundError as exc:
        # Payment not found — MP will retry; log and return 200 to stop retry storm
        logger.warning("billing.webhook: not_found external_id=%s error=%r", event.external_id, str(exc))
    except Exception as exc:
        logger.error("billing.webhook: unexpected error external_id=%s error=%r", event.external_id, exc)
        raise HTTPException(status_code=500, detail="Internal error processing webhook")

    return {"status": "ok"}


@router.get(
    "/payment/{payment_id}/status",
    response_model=PaymentStatusOut,
    status_code=200,
    summary="Get payment status (20/min)",
)
@limiter.limit("20/minute")
async def get_payment_status(
    request: Request,
    payment_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PaymentStatusOut:
    """Return lightweight payment status for polling."""
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    service = BillingService(db)
    try:
        return await service.get_payment_status(
            payment_id=payment_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
