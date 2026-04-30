"""
Customer model — device-based customer loyalty tracking (C-19).

Table: customer

Architecture:
  - Phase 1: implicit tracking via device_id (pseudo-anonymous, no PII)
  - Phase 2: opt-in GDPR with explicit consent (name, email, consent audit)
  - Phase 3+: reserved for ML recommendations, loyalty points (out of scope)

Multi-tenant:
  - tenant_id is REQUIRED (FK to app_tenant)
  - UNIQUE partial index on (device_id, tenant_id) WHERE is_active = TRUE
  - Same device in two tenants = two distinct Customer rows (blast-radius isolation)

Privacy rules (GDPR):
  - device_id: pseudo-anonymous UUID generated client-side. NOT a real person identifier.
  - name/email: NULL until opt-in. Set only after CustomerService.opt_in().
  - consent_ip_hash: SHA-256(client_ip + tenant.privacy_salt). Never plain-text IP.
  - opted_in: False by default. Only True after explicit consent.

CRITICAL: C-19 apply — human review required before merge.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class Customer(Base, AuditMixin):
    """
    A device-tracked customer for loyalty purposes.

    Created implicitly when a diner joins with a device_id.
    Enriched with PII only after explicit opt-in.
    """

    __tablename__ = "customer"
    __table_args__ = (
        # Unique partial index: one active customer per (device, tenant) pair.
        # device_id alone is NOT unique — the same device can exist in multiple tenants.
        Index(
            "uq_customer_device_tenant_active",
            "device_id",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_active = true"),
        ),
        Index("ix_customer_tenant_id", "tenant_id"),
        Index("ix_customer_device_id", "device_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Pseudo-anonymous device identifier (UUID generated on client, not PII per GDPR)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)

    # Multi-tenant isolation (added in C-19 — backfilled via migration)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # PII fields — NULL until opt-in
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Consent audit fields (GDPR art. 7)
    opted_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    consent_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    consent_granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SHA-256(client_ip + tenant.privacy_salt) — never plain-text IP
    consent_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Relationships
    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        back_populates="customers",
        lazy="select",
    )
    diners: Mapped[list["Diner"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Diner",
        back_populates="customer",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<Customer id={self.id} tenant_id={self.tenant_id} "
            f"opted_in={self.opted_in} is_active={self.is_active}>"
        )
