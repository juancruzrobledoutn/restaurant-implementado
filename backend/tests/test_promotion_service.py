"""
Tests for PromotionService.

Coverage:
  - Create with branches + products (transactional)
  - Temporal validation (start > end → 422 from Pydantic schema)
  - Price negative rejected (Pydantic schema)
  - Cross-tenant link raises ForbiddenError
  - list_for_branch includes expired
  - Soft-delete does not cascade junctions
  - MANAGER cannot delete (ForbiddenError)
"""
from __future__ import annotations

from datetime import date, time

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.menu import Category, Product, Subcategory
from rest_api.models.promotion import Promotion, PromotionBranch, PromotionItem
from rest_api.models.tenant import Tenant
from rest_api.schemas.promotion import PromotionCreate, PromotionUpdate
from rest_api.services.domain.promotion_service import PromotionService
from shared.config.constants import Roles
from shared.utils.exceptions import ForbiddenError, NotFoundError, ValidationError


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="Promo Test Tenant")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def tenant2(db: AsyncSession) -> Tenant:
    t = Tenant(name="Promo Test Tenant 2")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def branch(db: AsyncSession, tenant: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant.id,
        name="Promo Branch",
        address="Calle Promo",
        slug="promo-branch",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def branch2(db: AsyncSession, tenant2: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant2.id,
        name="Other Tenant Branch",
        address="Calle Otro",
        slug="other-branch",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def product(db: AsyncSession, branch: Branch) -> Product:
    """Create a product through the full hierarchy: category → subcategory → product."""
    cat = Category(branch_id=branch.id, name="Cat", order=1)
    db.add(cat)
    await db.flush()

    subcat = Subcategory(category_id=cat.id, name="Subcat", order=1)
    db.add(subcat)
    await db.flush()

    p = Product(subcategory_id=subcat.id, name="Test Product", price=1000)
    db.add(p)
    await db.flush()
    return p


# ── Create ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_promotion_with_branches_and_products(
    db: AsyncSession,
    tenant: Tenant,
    branch: Branch,
    product: Product,
) -> None:
    """Create promotion atomically with branch and product junctions."""
    svc = PromotionService(db)
    result = await svc.create(
        data=PromotionCreate(
            name="Summer Sale",
            description="50% off",
            price=500,
            start_date=date(2026, 6, 1),
            start_time=time(9, 0),
            end_date=date(2026, 8, 31),
            end_time=time(23, 59),
            branch_ids=[branch.id],
            product_ids=[product.id],
        ),
        tenant_id=tenant.id,
        actor_user_id=1,
    )
    assert result.id is not None
    assert result.name == "Summer Sale"
    assert result.price == 500
    assert result.tenant_id == tenant.id
    assert len(result.branches) == 1
    assert result.branches[0].branch_id == branch.id
    assert len(result.items) == 1
    assert result.items[0].product_id == product.id


@pytest.mark.asyncio
async def test_create_promotion_cross_tenant_branch_raises_validation_error(
    db: AsyncSession,
    tenant: Tenant,
    branch2: Branch,
    product: Product,
) -> None:
    """Creating a promotion with a branch from another tenant raises ValidationError."""
    svc = PromotionService(db)
    with pytest.raises(ValidationError, match="does not belong to this tenant"):
        await svc.create(
            data=PromotionCreate(
                name="Bad Promo",
                price=100,
                start_date=date(2026, 1, 1),
                start_time=time(0, 0),
                end_date=date(2026, 12, 31),
                end_time=time(23, 59),
                branch_ids=[branch2.id],  # belongs to tenant2, not tenant
                product_ids=[],
            ),
            tenant_id=tenant.id,
            actor_user_id=1,
        )


# ── Temporal validation (Pydantic level) ──────────────────────────────────────

def test_create_promotion_start_after_end_raises_validation_error() -> None:
    """PromotionCreate Pydantic schema rejects start > end."""
    import pytest
    with pytest.raises(Exception):  # Pydantic ValidationError
        PromotionCreate(
            name="Bad Dates",
            price=100,
            start_date=date(2026, 12, 31),
            start_time=time(23, 59),
            end_date=date(2026, 1, 1),
            end_time=time(0, 0),
            branch_ids=[],
            product_ids=[],
        )


def test_create_promotion_negative_price_raises_validation_error() -> None:
    """PromotionCreate Pydantic schema rejects negative prices."""
    with pytest.raises(Exception):  # Pydantic ValidationError
        PromotionCreate(
            name="Negative Price",
            price=-100,
            start_date=date(2026, 1, 1),
            start_time=time(0, 0),
            end_date=date(2026, 12, 31),
            end_time=time(23, 59),
            branch_ids=[],
            product_ids=[],
        )


# ── List for branch (includes expired) ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_for_branch_includes_expired(
    db: AsyncSession,
    tenant: Tenant,
    branch: Branch,
) -> None:
    """list_for_branch returns expired promotions (design D-07)."""
    svc = PromotionService(db)
    await svc.create(
        data=PromotionCreate(
            name="Expired Promo",
            price=100,
            start_date=date(2025, 1, 1),
            start_time=time(0, 0),
            end_date=date(2025, 6, 30),
            end_time=time(23, 59),
            branch_ids=[branch.id],
            product_ids=[],
        ),
        tenant_id=tenant.id,
        actor_user_id=1,
    )

    results = await svc.list_for_branch(
        tenant_id=tenant.id, branch_id=branch.id
    )
    assert len(results) == 1
    assert results[0].name == "Expired Promo"


# ── Soft delete ────────────────────────────────────────────────────────────────

def _make_promo_create(branch_id: int | None = None, product_id: int | None = None) -> PromotionCreate:
    """Helper to create a PromotionCreate with optional branch and product IDs."""
    return PromotionCreate(
        name="Summer Sale",
        description="50% off",
        price=500,
        start_date=date(2026, 6, 1),
        start_time=time(9, 0),
        end_date=date(2026, 8, 31),
        end_time=time(23, 59),
        branch_ids=[branch_id] if branch_id else [],
        product_ids=[product_id] if product_id else [],
    )


@pytest.mark.asyncio
async def test_soft_delete_admin_only(
    db: AsyncSession,
    tenant: Tenant,
) -> None:
    """ADMIN can soft-delete a promotion."""
    svc = PromotionService(db)
    created = await svc.create(
        data=_make_promo_create(),
        tenant_id=tenant.id,
        actor_user_id=1,
    )

    await svc.soft_delete(
        promotion_id=created.id,
        tenant_id=tenant.id,
        actor_user_id=1,
        actor_roles=[Roles.ADMIN],
    )

    # Should be gone from list
    results = await svc.list_for_tenant(tenant_id=tenant.id)
    ids = [p.id for p in results]
    assert created.id not in ids


@pytest.mark.asyncio
async def test_soft_delete_manager_raises_forbidden(
    db: AsyncSession,
    tenant: Tenant,
) -> None:
    """MANAGER cannot delete promotions — raises ForbiddenError."""
    svc = PromotionService(db)
    created = await svc.create(
        data=_make_promo_create(),
        tenant_id=tenant.id,
        actor_user_id=1,
    )

    with pytest.raises(ForbiddenError):
        await svc.soft_delete(
            promotion_id=created.id,
            tenant_id=tenant.id,
            actor_user_id=2,
            actor_roles=[Roles.MANAGER],
        )


@pytest.mark.asyncio
async def test_soft_delete_does_not_cascade_junctions(
    db: AsyncSession,
    tenant: Tenant,
    branch: Branch,
    product: Product,
) -> None:
    """Soft-deleting a promotion marks it inactive but junction rows remain (audit trail)."""
    from sqlalchemy import select

    svc = PromotionService(db)
    created = await svc.create(
        data=_make_promo_create(branch_id=branch.id, product_id=product.id),
        tenant_id=tenant.id,
        actor_user_id=1,
    )
    promo_id = created.id

    await svc.soft_delete(
        promotion_id=promo_id,
        tenant_id=tenant.id,
        actor_user_id=1,
        actor_roles=[Roles.ADMIN],
    )

    # Junction rows should still exist (no cascade on soft delete)
    branch_links = await db.execute(
        select(PromotionBranch).where(PromotionBranch.promotion_id == promo_id)
    )
    assert len(branch_links.scalars().all()) == 1

    item_links = await db.execute(
        select(PromotionItem).where(PromotionItem.promotion_id == promo_id)
    )
    assert len(item_links.scalars().all()) == 1


# ── Tenant isolation ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_for_tenant_isolation(
    db: AsyncSession,
    tenant: Tenant,
    tenant2: Tenant,
) -> None:
    """list_for_tenant returns only tenant's promotions."""
    svc = PromotionService(db)

    # Create for tenant1
    await svc.create(
        data=PromotionCreate(
            name="Tenant1 Promo",
            price=100,
            start_date=date(2026, 1, 1),
            start_time=time(0, 0),
            end_date=date(2026, 12, 31),
            end_time=time(23, 59),
            branch_ids=[],
            product_ids=[],
        ),
        tenant_id=tenant.id,
        actor_user_id=1,
    )

    # Create for tenant2
    await svc.create(
        data=PromotionCreate(
            name="Tenant2 Promo",
            price=200,
            start_date=date(2026, 1, 1),
            start_time=time(0, 0),
            end_date=date(2026, 12, 31),
            end_time=time(23, 59),
            branch_ids=[],
            product_ids=[],
        ),
        tenant_id=tenant2.id,
        actor_user_id=1,
    )

    t1_promos = await svc.list_for_tenant(tenant_id=tenant.id)
    names = [p.name for p in t1_promos]
    assert "Tenant1 Promo" in names
    assert "Tenant2 Promo" not in names
