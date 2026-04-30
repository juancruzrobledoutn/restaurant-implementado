"""
Seed: creates the base tenant and branch for development.

Data created:
  - Tenant id=1, name="Demo Restaurant"
  - Branch id=1, tenant_id=1, name="Sucursal Central",
    address="Av. Corrientes 1234, Buenos Aires", slug="demo"

Idempotency:
  - Checks for existing tenant by name before inserting
  - Checks for existing branch by (tenant_id, slug) before inserting
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from rest_api.models.branch import Branch
from rest_api.models.tenant import Tenant

logger = get_logger(__name__)

# Seed data constants
TENANT_NAME = "Demo Restaurant"
BRANCH_SLUG = "demo"


async def seed_tenants(db: AsyncSession) -> tuple[Tenant, Branch]:
    """
    Create seed tenant and branch if they don't already exist.

    Returns:
        Tuple of (tenant, branch) — existing or newly created.
    """
    # ── Tenant ─────────────────────────────────────────────────────────────────
    result = await db.execute(
        select(Tenant).where(
            Tenant.name == TENANT_NAME,
            Tenant.is_active.is_(True),
        )
    )
    tenant = result.scalar_one_or_none()

    if tenant is None:
        tenant = Tenant(name=TENANT_NAME)
        db.add(tenant)
        await db.flush()  # get the ID without committing
        logger.info("seed: created tenant id=%s name=%r", tenant.id, tenant.name)
    else:
        logger.info("seed: tenant already exists id=%s", tenant.id)

    # ── Branch ─────────────────────────────────────────────────────────────────
    result = await db.execute(
        select(Branch).where(
            Branch.tenant_id == tenant.id,
            Branch.slug == BRANCH_SLUG,
            Branch.is_active.is_(True),
        )
    )
    branch = result.scalar_one_or_none()

    if branch is None:
        branch = Branch(
            tenant_id=tenant.id,
            name="Sucursal Central",
            address="Av. Corrientes 1234, Buenos Aires",
            slug=BRANCH_SLUG,
        )
        db.add(branch)
        await db.flush()
        logger.info("seed: created branch id=%s slug=%r", branch.id, branch.slug)
    else:
        logger.info("seed: branch already exists id=%s", branch.id)

    return tenant, branch
