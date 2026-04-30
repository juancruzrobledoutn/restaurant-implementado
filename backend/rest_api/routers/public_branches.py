"""
Public branches router — no authentication required.

Exposes a minimal read-only listing of active branches for public-facing clients
(e.g., pwaMenu diner QR scan, kiosk selection screen).

Endpoints:
  GET /branches → list all active branches (id, name, address, slug)

Security:
  - No auth required — data is intentionally public
  - Only exposes safe fields (no tenant_id, no internal config)
  - Filters strictly by is_active.is_(True) to exclude soft-deleted records

Clean Architecture:
  - Direct query is acceptable here — this is a simple read with no business logic
  - No domain service needed for a single filtered SELECT
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from rest_api.models.branch import Branch
from rest_api.schemas.sector import PublicBranchResponse

router = APIRouter(tags=["public-branches"])


@router.get(
    "/branches",
    response_model=list[PublicBranchResponse],
    summary="List all active branches (public — no auth required)",
)
async def list_public_branches(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[PublicBranchResponse]:
    """
    Return all active branches.

    Used by pwaMenu and other public-facing clients to let diners select
    a branch before scanning a table QR code.
    Returns 200 with empty list if no active branches exist.
    """
    result = await db.execute(
        select(Branch)
        .where(Branch.is_active.is_(True))
        .order_by(Branch.name)
    )
    branches = result.scalars().all()
    return [PublicBranchResponse.model_validate(b) for b in branches]
