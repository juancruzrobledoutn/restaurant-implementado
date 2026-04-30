"""
Waiter push notification subscription router — thin HTTP adapter.

Clean Architecture rules:
  - ZERO business logic — delegates all to PushNotificationService

Endpoints:
  POST   /api/waiter/notifications/subscribe             → subscribe (WAITER only) — 201
  DELETE /api/waiter/notifications/subscribe?endpoint={} → unsubscribe (WAITER only) — 204

RBAC:
  - WAITER role required explicitly for all endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.constants import Roles
from shared.infrastructure.db import get_db
from rest_api.core.dependencies import current_user
from rest_api.schemas.push_subscription import PushSubscriptionIn, PushSubscriptionOut
from rest_api.services.domain.push_notification_service import PushNotificationService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["waiter-notifications"])


@router.post(
    "/notifications/subscribe",
    response_model=PushSubscriptionOut,
    status_code=201,
    summary="Subscribe to push notifications (WAITER only)",
)
async def subscribe_push(
    body: PushSubscriptionIn,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PushSubscriptionOut:
    """
    Register or update a WebPush subscription for the authenticated waiter.

    Upserts by endpoint (D-04): if the endpoint already exists, updates
    user_id and keys. Returns 201 on new subscription or upsert.
    """
    ctx = PermissionContext(user)
    if Roles.WAITER not in ctx.roles:
        raise HTTPException(status_code=403, detail="WAITER role required")

    service = PushNotificationService(db)
    return await service.subscribe(
        user_id=ctx.user_id,
        endpoint=body.endpoint,
        p256dh_key=body.p256dh_key,
        auth_key=body.auth_key,
    )


@router.delete(
    "/notifications/subscribe",
    status_code=204,
    summary="Unsubscribe from push notifications (WAITER only)",
)
async def unsubscribe_push(
    endpoint: str = Query(..., description="Endpoint URL to unsubscribe"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    """
    Unsubscribe a WebPush endpoint for the authenticated waiter.

    Idempotent: returns 204 even if the endpoint was not registered.
    Scoped to the authenticated user_id to prevent cross-user unsubscription.
    """
    ctx = PermissionContext(user)
    if Roles.WAITER not in ctx.roles:
        raise HTTPException(status_code=403, detail="WAITER role required")

    service = PushNotificationService(db)
    await service.unsubscribe(user_id=ctx.user_id, endpoint=endpoint)
