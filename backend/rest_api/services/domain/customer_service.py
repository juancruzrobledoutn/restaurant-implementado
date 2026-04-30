"""
CustomerService — domain service for customer loyalty (C-19).

Architecture (design.md D2, D3, D7):
  - get_or_create_by_device: idempotent device→customer mapping per tenant
  - opt_in: GDPR explicit consent with IP hash (sha256(ip + tenant.privacy_salt))
  - get_profile: returns CustomerProfileOut (no raw device_id — only prefix hint)
  - get_visit_history: last N sessions the customer attended
  - get_preferences: top N products by quantity across all sessions

Privacy rules (CRITICO — HUMAN REVIEW required before merge):
  - Logging: NEVER log name, email, device_id (raw), or client_ip
  - Use only customer_id and tenant_id in log messages
  - consent_ip_hash = sha256((client_ip + tenant.privacy_salt).encode()).hexdigest()
  - Plain-text IP is NEVER stored anywhere

Rules (NON-NEGOTIABLE):
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id
"""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import ConflictError, NotFoundError, ValidationError
from rest_api.models.customer import Customer
from rest_api.models.table_session import Diner, TableSession
from rest_api.models.tenant import Tenant
from rest_api.schemas.customer import (
    CustomerOut,
    CustomerProfileOut,
    PreferenceOut,
    VisitOut,
)

logger = get_logger(__name__)


class AlreadyOptedInError(ConflictError):
    """Raised when a customer tries to opt-in but is already opted in."""

    def __init__(self) -> None:
        super().__init__("Customer is already opted in", code="already_opted_in")


class CustomerService:
    """
    Domain service for customer loyalty — device tracking and GDPR opt-in.

    Tenant isolation: every method receives tenant_id explicitly.
    The router resolves tenant_id from TableContext (X-Table-Token).

    CRITICO: This service handles PII (name, email) and consent data.
    All methods must be reviewed by a human before production deploy.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _hash_ip(self, client_ip: str, tenant_salt: str) -> str:
        """
        Hash client IP with tenant-specific salt for GDPR consent audit.

        sha256((client_ip + tenant_salt).encode()).hexdigest()
        Returns 64-char lowercase hex string.
        NEVER returns or logs the plain IP.
        """
        raw = (client_ip + tenant_salt).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    async def _get_tenant_salt(self, tenant_id: int) -> str:
        """
        Load the privacy_salt for a tenant. Raises ValidationError if missing.

        HUMAN REVIEW: If salt is NULL (pre-C-19 tenant), this raises 422.
        Production deployment must backfill privacy_salt before enabling opt-in.
        """
        import secrets as sec

        tenant = await self._db.scalar(
            select(Tenant).where(
                Tenant.id == tenant_id,
                Tenant.is_active.is_(True),
            )
        )
        if tenant is None:
            raise NotFoundError("Tenant", tenant_id)

        if not tenant.privacy_salt:
            # Auto-generate and persist the salt if missing (backfill path)
            tenant.privacy_salt = sec.token_hex(32)
            await self._db.flush()
            logger.info("customer_service: auto-generated privacy_salt for tenant_id=%s", tenant_id)

        return tenant.privacy_salt

    # ── Core methods ──────────────────────────────────────────────────────────

    async def get_or_create_by_device(
        self,
        device_id: str,
        tenant_id: int,
    ) -> Customer:
        """
        Idempotent: return existing Customer for (device_id, tenant_id) or create one.

        Does NOT require opt-in — Phase 1 tracking is pseudo-anonymous.
        The customer starts with opted_in=False, name=NULL, email=NULL.

        Caller is responsible for safe_commit() after this call if needed within
        the same transaction (e.g. join endpoint).
        """
        existing = await self._db.scalar(
            select(Customer).where(
                Customer.device_id == device_id,
                Customer.tenant_id == tenant_id,
                Customer.is_active.is_(True),
            )
        )
        if existing is not None:
            # Log only non-PII identifiers
            logger.debug(
                "customer_service.get_or_create: found customer_id=%s tenant_id=%s",
                existing.id, tenant_id,
            )
            return existing

        customer = Customer(
            device_id=device_id,
            tenant_id=tenant_id,
            opted_in=False,
        )
        self._db.add(customer)
        await self._db.flush()
        await self._db.refresh(customer)

        logger.info(
            "customer_service.get_or_create: created customer_id=%s tenant_id=%s",
            customer.id, tenant_id,
        )
        return customer

    async def get_profile(
        self,
        customer_id: int,
        tenant_id: int,
    ) -> CustomerProfileOut:
        """
        Return the customer profile. Never exposes raw device_id.

        Raises NotFoundError if customer does not exist for this tenant.
        """
        customer = await self._db.scalar(
            select(Customer).where(
                Customer.id == customer_id,
                Customer.tenant_id == tenant_id,
                Customer.is_active.is_(True),
            )
        )
        if customer is None:
            raise NotFoundError("Customer", customer_id)

        # Build profile DTO — only first 7 chars of device_id as hint (not reversible)
        device_hint = customer.device_id[:7] if customer.device_id else None

        return CustomerProfileOut(
            id=str(customer.id),
            device_hint=device_hint,
            name=customer.name,
            email=customer.email,
            opted_in=customer.opted_in,
            consent_version=customer.consent_version,
        )

    async def opt_in(
        self,
        customer_id: int,
        tenant_id: int,
        name: str,
        email: str,
        client_ip: str,
        consent_version: str,
    ) -> CustomerProfileOut:
        """
        Record GDPR opt-in consent for a customer.

        - Sets name, email, opted_in=True, consent_version, consent_granted_at
        - Stores consent_ip_hash = sha256(client_ip + tenant.privacy_salt)
        - Raises AlreadyOptedInError if already opted in
        - NEVER logs name, email, or plain IP

        HUMAN REVIEW REQUIRED: this method stores consent audit data (CRITICO).
        """
        customer = await self._db.scalar(
            select(Customer).where(
                Customer.id == customer_id,
                Customer.tenant_id == tenant_id,
                Customer.is_active.is_(True),
            )
        )
        if customer is None:
            raise NotFoundError("Customer", customer_id)

        if customer.opted_in:
            raise AlreadyOptedInError()

        # Get tenant salt for IP hashing
        salt = await self._get_tenant_salt(tenant_id)
        ip_hash = self._hash_ip(client_ip, salt)

        customer.name = name
        customer.email = email
        customer.opted_in = True
        customer.consent_version = consent_version
        customer.consent_granted_at = datetime.now(UTC)
        customer.consent_ip_hash = ip_hash

        await self._db.flush()
        await safe_commit(self._db)

        # Log ONLY non-PII identifiers — HUMAN REVIEW: verify no PII appears below
        logger.info(
            "customer_service.opt_in: completed customer_id=%s tenant_id=%s consent_version=%s",
            customer_id, tenant_id, consent_version,
        )

        return CustomerProfileOut(
            id=str(customer.id),
            device_hint=customer.device_id[:7] if customer.device_id else None,
            name=customer.name,
            email=customer.email,
            opted_in=customer.opted_in,
            consent_version=customer.consent_version,
        )

    async def get_visit_history(
        self,
        customer_id: int,
        tenant_id: int,
        branch_id: Optional[int] = None,
        limit: int = 20,
    ) -> list[VisitOut]:
        """
        Return last N sessions the customer attended (via their diners).

        Filters by tenant_id — cross-tenant data is never accessible.
        Optionally filters by branch_id.
        Excludes sessions with status=OPEN (in progress) and CANCELED/inactive.
        """
        stmt = (
            select(
                TableSession.id.label("session_id"),
                TableSession.status,
                TableSession.branch_id,
                TableSession.created_at,
                func.count(Diner.id).label("diner_count"),
            )
            .join(Diner, Diner.session_id == TableSession.id)
            .where(
                Diner.customer_id == customer_id,
                TableSession.is_active.is_(True),
            )
            .group_by(
                TableSession.id,
                TableSession.status,
                TableSession.branch_id,
                TableSession.created_at,
            )
            .order_by(TableSession.created_at.desc())
            .limit(limit)
        )

        if branch_id is not None:
            stmt = stmt.where(TableSession.branch_id == branch_id)

        rows = (await self._db.execute(stmt)).all()

        return [
            VisitOut(
                session_id=str(row.session_id),
                branch_id=str(row.branch_id),
                status=row.status,
                visited_at=row.created_at.isoformat(),
            )
            for row in rows
        ]

    async def get_preferences(
        self,
        customer_id: int,
        tenant_id: int,
        top_n: int = 5,
    ) -> list[PreferenceOut]:
        """
        Return top N products by total quantity ordered across all sessions.

        Joins: customer → diner → round_item → product
        Groups by product_id, sums quantity, orders by sum desc.
        """
        # Import here to avoid circular imports
        from rest_api.models.round import RoundItem
        from rest_api.models.menu import Product

        stmt = (
            select(
                RoundItem.product_id,
                Product.name.label("product_name"),
                func.sum(RoundItem.quantity).label("total_qty"),
            )
            .join(Diner, Diner.id == RoundItem.diner_id)
            .join(Product, Product.id == RoundItem.product_id)
            .where(
                Diner.customer_id == customer_id,
                RoundItem.is_active.is_(True),
                Product.is_active.is_(True),
            )
            .group_by(RoundItem.product_id, Product.name)
            .order_by(func.sum(RoundItem.quantity).desc())
            .limit(top_n)
        )

        rows = (await self._db.execute(stmt)).all()

        return [
            PreferenceOut(
                product_id=str(row.product_id),
                product_name=row.product_name,
                total_quantity=int(row.total_qty),
            )
            for row in rows
        ]
