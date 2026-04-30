"""
User and UserBranchRole models.

Tables:
  - app_user: authenticated staff members (app_ prefix: 'user' is reserved in PostgreSQL)
  - user_branch_role: M:N mapping users to branches with roles

Rules:
  - email is globally unique (cross-tenant) — acceptable for MVP
  - UserBranchRole uses composite PK (user_id, branch_id, role)
  - AuditMixin NOT applied to UserBranchRole (join table, no audit needed)
"""
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class User(Base, AuditMixin):
    """
    Staff member belonging to a Tenant.

    email is unique globally (cross-tenant) — one account per email for MVP.
    hashed_password is stored as a plain string; bcrypt integration is in C-03.
    """

    __tablename__ = "app_user"
    __table_args__ = (
        UniqueConstraint("email", name="uq_user_email"),
        Index("ix_user_tenant_id", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    # 2FA (C-03)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    is_2fa_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # Audit (C-03)
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    # C-28: password change audit — updated on every successful change_password
    password_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        back_populates="users",
    )
    branch_roles: Mapped[list["UserBranchRole"]] = relationship(
        "UserBranchRole",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r}>"


class UserBranchRole(Base):
    """
    Maps a User to a Branch with a specific role.

    Composite PK: (user_id, branch_id, role) — allows a user to have multiple roles
    in different branches, and even multiple roles in the same branch.

    No AuditMixin: this is a join/assignment table, not a domain entity.
    """

    __tablename__ = "user_branch_role"

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="CASCADE"),
        primary_key=True,
    )
    branch_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(
        String(50),
        primary_key=True,
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="branch_roles",
    )
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        back_populates="user_roles",
    )

    def __repr__(self) -> str:
        return (
            f"<UserBranchRole user_id={self.user_id} "
            f"branch_id={self.branch_id} role={self.role!r}>"
        )
