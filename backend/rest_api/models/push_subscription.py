"""
PushSubscription model — WebPush subscription records for VAPID notifications.

Table: push_subscription

Architecture (D-04): endpoint is UNIQUE global because VAPID endpoints (FCM,
Mozilla autopush) are globally unique per browser registration. The subscribe()
method uses INSERT ... ON CONFLICT (endpoint) DO UPDATE to handle device
re-registrations transparently.

Rules:
  - endpoint UNIQUE global — not per user_id
  - AuditMixin for soft-delete support (is_active=False on 410 Gone)
  - user_id FK ondelete=CASCADE — unsubscribes when user is deleted
"""
from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class PushSubscription(Base, AuditMixin):
    """
    WebPush subscription for a specific browser+device+user combination.

    Lifecycle:
      - Subscribe: upsert by endpoint (updates user_id + is_active=true)
      - Unsubscribe: hard delete scoped to user_id (idempotent)
      - Stale detection: background 410 response → is_active=False (fail-open)

    VAPID keys needed to actually send:
      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL in settings.
    """

    __tablename__ = "push_subscription"
    __table_args__ = (
        Index("ix_push_subscription_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="CASCADE"),
        nullable=False,
    )
    endpoint: Mapped[str] = mapped_column(String(2048), nullable=False, unique=True)
    p256dh_key: Mapped[str] = mapped_column(String(255), nullable=False)
    auth_key: Mapped[str] = mapped_column(String(255), nullable=False)

    # Relationships
    user: Mapped["User"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "User",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<PushSubscription id={self.id} user_id={self.user_id} "
            f"endpoint={self.endpoint[:40]!r}...>"
        )
