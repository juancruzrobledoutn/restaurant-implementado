"""
PushNotificationService — WebPush VAPID notification delivery.

Architecture:
  - subscribe(): upsert by endpoint (INSERT ON CONFLICT UPDATE)
  - unsubscribe(): hard delete scoped to user_id (idempotent)
  - send_to_user(): loads VAPID keys from settings, iterates subscriptions,
    calls pywebpush.webpush(). On 410 Gone → marks is_active=False.
    On missing VAPID config → logs WARNING and returns (fail-open).

Rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER store raw VAPID private key in logs
  - Fail-open on missing VAPID config (no crash, just warning)
  - mock pywebpush.webpush in tests to avoid real network calls

Design (D-04): endpoint is UNIQUE global — upsert by endpoint, not user.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from rest_api.models.push_subscription import PushSubscription
from rest_api.schemas.push_subscription import PushSubscriptionOut

logger = get_logger(__name__)


class PushNotificationService:
    """
    Domain service for WebPush subscription management and notification sending.

    Fail-open by design: missing VAPID keys → log WARNING, return early,
    never raise — ensures push notifications don't break business flows.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Subscription management ────────────────────────────────────────────────

    async def subscribe(
        self,
        user_id: int,
        endpoint: str,
        p256dh_key: str,
        auth_key: str,
    ) -> PushSubscriptionOut:
        """
        Upsert a push subscription by endpoint (D-04).

        INSERT ... ON CONFLICT (endpoint) DO UPDATE SET user_id, is_active, keys.
        This handles device re-registrations transparently.

        Returns the upserted subscription.
        """
        # SQLAlchemy PostgreSQL dialect upsert
        stmt = (
            pg_insert(PushSubscription)
            .values(
                user_id=user_id,
                endpoint=endpoint,
                p256dh_key=p256dh_key,
                auth_key=auth_key,
                is_active=True,
            )
            .on_conflict_do_update(
                index_elements=["endpoint"],
                set_={
                    "user_id": user_id,
                    "p256dh_key": p256dh_key,
                    "auth_key": auth_key,
                    "is_active": True,
                },
            )
            .returning(PushSubscription)
        )

        result = await self._db.execute(stmt)
        subscription = result.scalar_one()
        await safe_commit(self._db)

        logger.debug(
            "push.subscribe: user_id=%s endpoint=%s...",
            user_id, endpoint[:40],
        )
        return PushSubscriptionOut(
            id=subscription.id,
            endpoint=subscription.endpoint,
            is_active=subscription.is_active,
        )

    async def unsubscribe(self, user_id: int, endpoint: str) -> None:
        """
        Hard-delete a push subscription for the user+endpoint combination.

        Idempotent: returns normally even if the subscription doesn't exist.
        Scoped to user_id to prevent cross-user unsubscription.
        """
        sub = await self._db.scalar(
            select(PushSubscription).where(
                PushSubscription.user_id == user_id,
                PushSubscription.endpoint == endpoint,
            )
        )
        if sub:
            await self._db.delete(sub)
            await safe_commit(self._db)

    # ── Notification sending ───────────────────────────────────────────────────

    async def send_to_user(
        self,
        user_id: int,
        title: str,
        body: str,
        url: Optional[str] = None,
    ) -> None:
        """
        Send a WebPush notification to all active subscriptions for a user.

        Fail-open behaviors:
          - Missing VAPID config → log WARNING and return (no crash)
          - 410 Gone from push service → mark subscription is_active=False

        Args:
            user_id: Target user ID.
            title: Notification title.
            body: Notification body text.
            url: Optional URL to open on click.
        """
        from shared.config.settings import settings

        # Fail-open: check VAPID config
        if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
            logger.warning(
                "push.send_to_user: VAPID keys not configured — "
                "skipping notification for user_id=%s (set VAPID_PRIVATE_KEY, "
                "VAPID_PUBLIC_KEY, VAPID_CONTACT_EMAIL in .env)",
                user_id,
            )
            return

        # Load active subscriptions
        result = await self._db.execute(
            select(PushSubscription).where(
                PushSubscription.user_id == user_id,
                PushSubscription.is_active.is_(True),
            )
        )
        subscriptions = result.scalars().all()

        if not subscriptions:
            logger.debug(
                "push.send_to_user: no active subscriptions for user_id=%s", user_id
            )
            return

        notification_data = {"title": title, "body": body}
        if url:
            notification_data["url"] = url

        try:
            from pywebpush import webpush, WebPushException
        except ImportError:
            logger.warning(
                "push.send_to_user: pywebpush not installed — "
                "skipping notification for user_id=%s", user_id
            )
            return

        for sub in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {
                            "p256dh": sub.p256dh_key,
                            "auth": sub.auth_key,
                        },
                    },
                    data=str(notification_data),
                    vapid_private_key=settings.VAPID_PRIVATE_KEY,
                    vapid_claims={
                        "sub": f"mailto:{settings.VAPID_CONTACT_EMAIL}",
                    },
                )
                logger.debug(
                    "push.send_to_user: sent to subscription id=%s user_id=%s",
                    sub.id, user_id,
                )
            except WebPushException as exc:
                # 410 Gone: endpoint is no longer valid — mark inactive
                if hasattr(exc, "response") and exc.response is not None:
                    status_code = getattr(exc.response, "status_code", None)
                    if status_code == 410:
                        logger.info(
                            "push.send_to_user: subscription id=%s returned 410 — "
                            "marking is_active=False", sub.id
                        )
                        sub.is_active = False
                        await self._db.flush()
                        continue
                # Other errors: log and continue (fail-open per subscription)
                logger.error(
                    "push.send_to_user: WebPushException for subscription id=%s: %s",
                    sub.id, exc,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "push.send_to_user: unexpected error for subscription id=%s: %s",
                    sub.id, exc,
                )

        # Commit any is_active=False updates
        await safe_commit(self._db)
