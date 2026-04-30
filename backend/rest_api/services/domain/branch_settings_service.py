"""
BranchSettingsService — domain service for branch settings management (C-28).

Architecture rules (non-negotiable):
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER Model.is_active == True → Model.is_active.is_(True)
  - ALWAYS filter by tenant_id
  - Business logic ONLY here — routers stay thin

Methods:
  get_settings(branch_id, tenant_id)        → BranchSettingsResponse | None
  update_settings(branch_id, tenant_id, patch) → BranchSettingsResponse
  _invalidate_menu_cache(slug)              → None (best-effort, swallows errors)
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from rest_api.models.branch import Branch
from rest_api.schemas.branch_settings import BranchSettingsResponse, BranchSettingsUpdate

logger = get_logger(__name__)


class BranchSettingsService:
    """
    Domain service for reading and updating branch operational settings.

    Not a BaseCRUDService subclass because settings are a projection
    over the existing Branch entity — not a separate aggregate.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Public API ────────────────────────────────────────────────────────────

    async def get_settings(
        self,
        branch_id: int,
        tenant_id: int,
    ) -> Optional[BranchSettingsResponse]:
        """
        Return branch settings for the given branch, scoped to tenant.

        Returns None if the branch does not exist or belongs to a different tenant.
        """
        branch = await self._get_branch(branch_id, tenant_id)
        if branch is None:
            return None
        return BranchSettingsResponse.model_validate(branch)

    async def update_settings(
        self,
        branch_id: int,
        tenant_id: int,
        patch: BranchSettingsUpdate,
    ) -> BranchSettingsResponse:
        """
        Apply a partial update to branch settings.

        Business rules:
          - Branch must exist and belong to tenant_id
          - slug must be unique within the tenant (raises HTTP 409 on conflict)
          - Cache invalidation is best-effort (errors are logged, not propagated)
          - safe_commit() after every successful update

        Raises:
          HTTPException(404) if branch not found / cross-tenant access
          HTTPException(409) if the new slug is already taken by another branch
        """
        branch = await self._get_branch(branch_id, tenant_id)
        if branch is None:
            raise HTTPException(status_code=404, detail="Branch not found")

        slug_old = branch.slug

        # Extract only the fields that were explicitly provided
        update_data = patch.model_dump(exclude_unset=True)

        # Validate slug uniqueness before applying changes
        new_slug = update_data.get("slug")
        if new_slug is not None and new_slug != branch.slug:
            await self._check_slug_unique(new_slug, tenant_id, exclude_branch_id=branch_id)

        # Apply the opening_hours as a plain dict for JSONB storage
        if "opening_hours" in update_data and update_data["opening_hours"] is not None:
            oh = update_data["opening_hours"]
            # BranchSettingsUpdate validates it as OpeningHoursWeek — convert to dict
            if hasattr(oh, "model_dump"):
                update_data["opening_hours"] = oh.model_dump()

        # Apply patch fields to the ORM model
        for field, value in update_data.items():
            setattr(branch, field, value)

        await safe_commit(self.db)
        await self.db.refresh(branch)

        # Cache invalidation — best-effort, never propagates
        try:
            await self._invalidate_menu_cache(slug_old)
            if new_slug and new_slug != slug_old:
                await self._invalidate_menu_cache(new_slug)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "branch_settings_service: cache invalidation failed for slug=%r: %s",
                slug_old,
                exc,
            )

        logger.info(
            "branch_settings: updated branch_id=%s tenant_id=%s fields=%s",
            branch_id,
            tenant_id,
            list(update_data.keys()),
        )

        return BranchSettingsResponse.model_validate(branch)

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _get_branch(self, branch_id: int, tenant_id: int) -> Optional[Branch]:
        """
        Query a Branch by ID, scoped to tenant_id and is_active.
        Returns None if not found or cross-tenant.
        """
        result = await self.db.execute(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def _check_slug_unique(
        self,
        slug: str,
        tenant_id: int,
        exclude_branch_id: int,
    ) -> None:
        """
        Verify slug is unique within the tenant (excluding the branch being updated).

        Raises HTTP 409 if another active branch with the same slug exists.
        """
        result = await self.db.execute(
            select(Branch).where(
                Branch.slug == slug,
                Branch.tenant_id == tenant_id,
                Branch.id != exclude_branch_id,
                Branch.is_active.is_(True),
            )
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Slug '{slug}' is already in use by another branch in this tenant",
            )

    async def _invalidate_menu_cache(self, slug: str) -> None:
        """
        Invalidate the public menu Redis cache for a branch slug.

        Failure is intentionally swallowed — a stale cache is always preferable
        to breaking a branch settings update. The TTL (5 min) will handle eventual expiry.
        """
        from rest_api.services.domain.menu_cache_service import MenuCacheService

        cache = MenuCacheService()
        await cache.invalidate(slug)
