"""
TenantSettingsService — domain service for tenant settings management (C-28).

Architecture rules (non-negotiable):
  - NEVER db.commit() directly → safe_commit(db)
  - ALWAYS filter by tenant_id (the service never trusts input for tenant identity)
  - privacy_salt NEVER appears in any response
  - Only ADMIN can call update (enforced in the router)

Methods:
  get(tenant_id)           → TenantSettingsResponse | None
  update(tenant_id, patch) → TenantSettingsResponse | None
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from rest_api.models.tenant import Tenant
from rest_api.schemas.tenant import TenantSettingsResponse, TenantSettingsUpdate

logger = get_logger(__name__)


class TenantSettingsService:
    """
    Domain service for reading and updating tenant-level settings.

    The tenant_id is ALWAYS sourced from the JWT context (via PermissionContext),
    never from user-supplied input — this prevents IDOR attacks.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, tenant_id: int) -> Optional[TenantSettingsResponse]:
        """
        Return tenant settings for the given tenant_id.

        Returns None if the tenant does not exist or is inactive.
        Privacy_salt is excluded by the response schema — never accessible.
        """
        tenant = await self._get_tenant(tenant_id)
        if tenant is None:
            return None
        return TenantSettingsResponse.model_validate(tenant)

    async def update(
        self,
        tenant_id: int,
        patch: TenantSettingsUpdate,
    ) -> Optional[TenantSettingsResponse]:
        """
        Apply a partial update to tenant settings.

        Business rules:
          - name cannot be blank (validated by Pydantic schema)
          - safe_commit() after every successful update
          - Returns None if tenant does not exist

        Raises:
          Nothing — all validation is in the schema; not-found → return None.
        """
        tenant = await self._get_tenant(tenant_id)
        if tenant is None:
            return None

        update_data = patch.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(tenant, field, value)

        await safe_commit(self.db)
        await self.db.refresh(tenant)

        logger.info(
            "tenant_settings: updated tenant_id=%s fields=%s",
            tenant_id,
            list(update_data.keys()),
        )

        return TenantSettingsResponse.model_validate(tenant)

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _get_tenant(self, tenant_id: int) -> Optional[Tenant]:
        """
        Query a Tenant by ID, checking is_active.
        Returns None if not found.
        """
        result = await self.db.execute(
            select(Tenant).where(
                Tenant.id == tenant_id,
                Tenant.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()
