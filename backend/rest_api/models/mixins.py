"""
AuditMixin: standard audit fields for all domain models.

All models that include AuditMixin get:
- is_active: soft-delete flag (default True)
- created_at: set automatically on insert (server_default UTC)
- updated_at: set automatically on update (onupdate UTC)
- deleted_at: timestamp of soft delete (nullable)
- deleted_by_id: FK to the user who soft-deleted (nullable)

Usage:
    class MyModel(Base, AuditMixin):
        __tablename__ = "my_table"
        ...
"""
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class AuditMixin:
    """
    SQLAlchemy declarative mixin that provides standard audit fields.

    RULES:
    - NEVER query is_active == True — use is_active.is_(True)
    - NEVER call db.commit() directly — use safe_commit(db)
    - soft_delete sets is_active=False + deleted_at + deleted_by_id
    """

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    deleted_by_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
        default=None,
    )
