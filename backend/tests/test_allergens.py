"""
Tests for allergen management — C-05.

Covers:
  8.1 Allergen CRUD (create, read, update, soft-delete with cascade)
  8.2 Product-allergen linking (create link, 409 duplicate, unlink, list, cross-tenant)
  8.3 Cross-reaction tests (bidirectional, 409 duplicate, 400 self-reference, delete, list)
  8.4 Multi-tenant isolation
  8.5 RBAC (MANAGER can create/edit but not delete; KITCHEN/WAITER get 403)
  8.6 Public endpoint tests (GET /allergens, counts, inactive products excluded, 404)

Architecture:
  - Tests use AllergenService directly (unit/integration) and TestClient (HTTP/RBAC)
  - All tests use in-memory SQLite via db fixture from conftest.py
  - Redis is NOT used in tests (MenuCacheService fails silently — fail-open)
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import AsyncMock, patch

from rest_api.models.allergen import Allergen, AllergenCrossReaction, ProductAllergen
from rest_api.models.branch import Branch
from rest_api.models.menu import Category, Product, Subcategory, BranchProduct
from rest_api.models.tenant import Tenant
from rest_api.models.user import User, UserBranchRole
from rest_api.schemas.allergen import (
    AllergenCreate,
    AllergenUpdate,
    CrossReactionCreate,
    ProductAllergenCreate,
)
from rest_api.services.domain.allergen_service import AllergenService
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _make_jwt_user(
    user_id: int = 1,
    tenant_id: int = 1,
    branch_ids: list[int] | None = None,
    roles: list[str] | None = None,
) -> dict:
    """Build a user dict mimicking what current_user dependency returns."""
    return {
        "user_id": user_id,
        "email": f"user{user_id}@test.com",
        "tenant_id": tenant_id,
        "branch_ids": branch_ids or [1],
        "roles": roles or ["ADMIN"],
        "jti": f"jti-{user_id}",
        "exp": 9999999999,
    }


# ── Fixtures ─────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="Test Tenant")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def tenant_b(db: AsyncSession) -> Tenant:
    """Second tenant for isolation tests."""
    t = Tenant(name="Tenant B")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def branch(db: AsyncSession, tenant: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant.id,
        name="Main Branch",
        slug="main-branch",
        address="Street 1",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def product(db: AsyncSession, branch: Branch) -> Product:
    """Create category → subcategory → product → branch_product chain."""
    cat = Category(branch_id=branch.id, name="Food", order=10)
    db.add(cat)
    await db.flush()

    subcat = Subcategory(category_id=cat.id, name="Starters", order=10)
    db.add(subcat)
    await db.flush()

    prod = Product(subcategory_id=subcat.id, name="Peanut Dish", price=1000)
    db.add(prod)
    await db.flush()

    bp = BranchProduct(
        product_id=prod.id,
        branch_id=branch.id,
        price_cents=1000,
        is_available=True,
    )
    db.add(bp)
    await db.flush()
    return prod


@pytest_asyncio.fixture
async def allergen(db: AsyncSession, tenant: Tenant) -> Allergen:
    a = Allergen(
        tenant_id=tenant.id,
        name="Peanuts",
        severity="severe",
        is_mandatory=True,
    )
    db.add(a)
    await db.flush()
    return a


@pytest_asyncio.fixture
async def allergen_b(db: AsyncSession, tenant: Tenant) -> Allergen:
    a = Allergen(
        tenant_id=tenant.id,
        name="Tree Nuts",
        severity="severe",
        is_mandatory=True,
    )
    db.add(a)
    await db.flush()
    return a


def _service(db: AsyncSession) -> AllergenService:
    return AllergenService(db)


# ── 8.1 Allergen CRUD ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_allergen(db: AsyncSession, tenant: Tenant) -> None:
    """Create an allergen and verify it appears in list_all."""
    svc = _service(db)
    data = AllergenCreate(name="Gluten", is_mandatory=True, severity="moderate")
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        response = await svc.create(data=data, tenant_id=tenant.id, user_id=1)

    assert response.id is not None
    assert response.name == "Gluten"
    assert response.is_mandatory is True
    assert response.severity == "moderate"
    assert response.tenant_id == tenant.id
    assert response.is_active is True


@pytest.mark.asyncio
async def test_list_allergens_tenant_scoped(
    db: AsyncSession, tenant: Tenant, tenant_b: Tenant
) -> None:
    """list_all only returns allergens for the given tenant."""
    # Create allergen for tenant_b
    other = Allergen(tenant_id=tenant_b.id, name="Soy", severity="mild")
    db.add(other)
    mine = Allergen(tenant_id=tenant.id, name="Eggs", severity="moderate")
    db.add(mine)
    await db.flush()

    svc = _service(db)
    results = await svc.list_all(tenant_id=tenant.id)
    names = [r.name for r in results]
    assert "Eggs" in names
    assert "Soy" not in names


@pytest.mark.asyncio
async def test_get_allergen_by_id(db: AsyncSession, tenant: Tenant, allergen: Allergen) -> None:
    """get_by_id returns the allergen when it belongs to the tenant."""
    svc = _service(db)
    response = await svc.get_by_id(allergen_id=allergen.id, tenant_id=tenant.id)
    assert response.name == "Peanuts"


@pytest.mark.asyncio
async def test_get_allergen_wrong_tenant_raises_not_found(
    db: AsyncSession, tenant_b: Tenant, allergen: Allergen
) -> None:
    """get_by_id raises NotFoundError when allergen belongs to a different tenant."""
    svc = _service(db)
    with pytest.raises(NotFoundError):
        await svc.get_by_id(allergen_id=allergen.id, tenant_id=tenant_b.id)


@pytest.mark.asyncio
async def test_update_allergen(db: AsyncSession, tenant: Tenant, allergen: Allergen) -> None:
    """update modifies the allergen and returns updated response."""
    svc = _service(db)
    data = AllergenUpdate(name="Peanut Allergy", severity="life_threatening")
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        response = await svc.update(
            allergen_id=allergen.id, data=data, tenant_id=tenant.id, user_id=1
        )
    assert response.name == "Peanut Allergy"
    assert response.severity == "life_threatening"


@pytest.mark.asyncio
async def test_soft_delete_allergen(
    db: AsyncSession, tenant: Tenant, allergen: Allergen
) -> None:
    """delete soft-deletes the allergen — it no longer appears in list_all."""
    svc = _service(db)
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        result = await svc.delete(
            allergen_id=allergen.id, tenant_id=tenant.id, user_id=1
        )

    assert result["affected"]["Allergen"] == 1

    # Should not appear in list anymore
    all_allergens = await svc.list_all(tenant_id=tenant.id)
    assert not any(a.id == allergen.id for a in all_allergens)


@pytest.mark.asyncio
async def test_delete_allergen_cascades_product_links(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, product: Product
) -> None:
    """Soft-deleting an allergen hard-deletes linked ProductAllergen records."""
    # Create a ProductAllergen link
    pa = ProductAllergen(
        product_id=product.id,
        allergen_id=allergen.id,
        presence_type="contains",
        risk_level="severe",
    )
    db.add(pa)
    await db.flush()

    svc = _service(db)
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        result = await svc.delete(allergen_id=allergen.id, tenant_id=tenant.id, user_id=1)

    assert result["affected"]["ProductAllergen"] == 1

    # Verify the ProductAllergen record was hard-deleted
    remaining = await db.scalar(
        select(ProductAllergen).where(ProductAllergen.allergen_id == allergen.id)
    )
    assert remaining is None


@pytest.mark.asyncio
async def test_delete_allergen_cascades_cross_reactions(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, allergen_b: Allergen
) -> None:
    """Soft-deleting an allergen removes its cross-reaction records."""
    cr1 = AllergenCrossReaction(
        allergen_id=allergen.id, related_allergen_id=allergen_b.id
    )
    cr2 = AllergenCrossReaction(
        allergen_id=allergen_b.id, related_allergen_id=allergen.id
    )
    db.add(cr1)
    db.add(cr2)
    await db.flush()

    svc = _service(db)
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        result = await svc.delete(allergen_id=allergen.id, tenant_id=tenant.id, user_id=1)

    assert result["affected"]["AllergenCrossReaction"] == 2


# ── 8.2 Product-allergen linking ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_link_product_allergen(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, product: Product
) -> None:
    """link_product creates a ProductAllergen record and returns response."""
    svc = _service(db)
    data = ProductAllergenCreate(
        allergen_id=allergen.id, presence_type="contains", risk_level="severe"
    )
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        response = await svc.link_product(
            product_id=product.id, data=data, tenant_id=tenant.id
        )

    assert response.product_id == product.id
    assert response.allergen_id == allergen.id
    assert response.presence_type == "contains"
    assert response.allergen_name == "Peanuts"


@pytest.mark.asyncio
async def test_link_product_allergen_duplicate_returns_409(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, product: Product
) -> None:
    """Linking same allergen twice raises ValidationError (→ 409)."""
    svc = _service(db)
    data = ProductAllergenCreate(
        allergen_id=allergen.id, presence_type="contains", risk_level="severe"
    )
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        await svc.link_product(product_id=product.id, data=data, tenant_id=tenant.id)

    with pytest.raises(ValidationError) as exc_info:
        with patch.object(svc._cache, "invalidate", AsyncMock()):
            await svc.link_product(product_id=product.id, data=data, tenant_id=tenant.id)
    assert "already linked" in str(exc_info.value)


@pytest.mark.asyncio
async def test_unlink_product_allergen(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, product: Product
) -> None:
    """unlink_product hard-deletes the link — record is gone after unlinking."""
    svc = _service(db)
    data = ProductAllergenCreate(
        allergen_id=allergen.id, presence_type="may_contain", risk_level="mild"
    )
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        await svc.link_product(product_id=product.id, data=data, tenant_id=tenant.id)
        await svc.unlink_product(
            product_id=product.id, allergen_id=allergen.id, tenant_id=tenant.id
        )

    remaining = await db.scalar(
        select(ProductAllergen).where(
            ProductAllergen.product_id == product.id,
            ProductAllergen.allergen_id == allergen.id,
        )
    )
    assert remaining is None


@pytest.mark.asyncio
async def test_list_product_allergens(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, allergen_b: Allergen, product: Product
) -> None:
    """list_product_allergens returns all allergens linked to the product."""
    svc = _service(db)
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        await svc.link_product(
            product_id=product.id,
            data=ProductAllergenCreate(
                allergen_id=allergen.id, presence_type="contains", risk_level="severe"
            ),
            tenant_id=tenant.id,
        )
        await svc.link_product(
            product_id=product.id,
            data=ProductAllergenCreate(
                allergen_id=allergen_b.id, presence_type="may_contain", risk_level="moderate"
            ),
            tenant_id=tenant.id,
        )

    results = await svc.list_product_allergens(product_id=product.id, tenant_id=tenant.id)
    assert len(results) == 2
    names = {r.allergen_name for r in results}
    assert "Peanuts" in names
    assert "Tree Nuts" in names


@pytest.mark.asyncio
async def test_link_cross_tenant_prevented(
    db: AsyncSession,
    tenant: Tenant,
    tenant_b: Tenant,
    product: Product,
) -> None:
    """Linking an allergen from tenant_b to a product from tenant raises NotFoundError."""
    # Create allergen for tenant_b
    other_allergen = Allergen(tenant_id=tenant_b.id, name="Sesame", severity="moderate")
    db.add(other_allergen)
    await db.flush()

    svc = _service(db)
    data = ProductAllergenCreate(
        allergen_id=other_allergen.id, presence_type="contains", risk_level="mild"
    )
    with pytest.raises(NotFoundError):
        await svc.link_product(product_id=product.id, data=data, tenant_id=tenant.id)


# ── 8.3 Cross-reaction tests ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_cross_reaction_bidirectional(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, allergen_b: Allergen
) -> None:
    """create_cross_reaction creates two records — both directions."""
    svc = _service(db)
    response = await svc.create_cross_reaction(
        allergen_id=allergen.id,
        data=CrossReactionCreate(related_allergen_id=allergen_b.id),
        tenant_id=tenant.id,
    )
    assert response.allergen_id == allergen.id
    assert response.related_allergen_id == allergen_b.id

    # Verify both directions exist in DB
    forward = await db.scalar(
        select(AllergenCrossReaction).where(
            AllergenCrossReaction.allergen_id == allergen.id,
            AllergenCrossReaction.related_allergen_id == allergen_b.id,
        )
    )
    reverse = await db.scalar(
        select(AllergenCrossReaction).where(
            AllergenCrossReaction.allergen_id == allergen_b.id,
            AllergenCrossReaction.related_allergen_id == allergen.id,
        )
    )
    assert forward is not None
    assert reverse is not None


@pytest.mark.asyncio
async def test_create_cross_reaction_duplicate_returns_409(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, allergen_b: Allergen
) -> None:
    """Creating the same cross-reaction twice raises ValidationError (→ 409)."""
    svc = _service(db)
    await svc.create_cross_reaction(
        allergen_id=allergen.id,
        data=CrossReactionCreate(related_allergen_id=allergen_b.id),
        tenant_id=tenant.id,
    )
    with pytest.raises(ValidationError) as exc_info:
        await svc.create_cross_reaction(
            allergen_id=allergen.id,
            data=CrossReactionCreate(related_allergen_id=allergen_b.id),
            tenant_id=tenant.id,
        )
    assert "already exists" in str(exc_info.value)


@pytest.mark.asyncio
async def test_create_cross_reaction_self_reference_returns_400(
    db: AsyncSession, tenant: Tenant, allergen: Allergen
) -> None:
    """Self-reference in cross-reaction raises ValidationError (→ 400)."""
    svc = _service(db)
    with pytest.raises(ValidationError) as exc_info:
        await svc.create_cross_reaction(
            allergen_id=allergen.id,
            data=CrossReactionCreate(related_allergen_id=allergen.id),
            tenant_id=tenant.id,
        )
    assert "itself" in str(exc_info.value)


@pytest.mark.asyncio
async def test_delete_cross_reaction_removes_both_directions(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, allergen_b: Allergen
) -> None:
    """delete_cross_reaction removes both direction records from DB."""
    svc = _service(db)
    await svc.create_cross_reaction(
        allergen_id=allergen.id,
        data=CrossReactionCreate(related_allergen_id=allergen_b.id),
        tenant_id=tenant.id,
    )
    await svc.delete_cross_reaction(
        allergen_id=allergen.id,
        related_allergen_id=allergen_b.id,
        tenant_id=tenant.id,
    )

    # Both directions should be gone
    count_result = await db.execute(
        select(AllergenCrossReaction).where(
            (AllergenCrossReaction.allergen_id == allergen.id)
            | (AllergenCrossReaction.allergen_id == allergen_b.id)
        )
    )
    assert len(count_result.scalars().all()) == 0


@pytest.mark.asyncio
async def test_list_cross_reactions(
    db: AsyncSession, tenant: Tenant, allergen: Allergen, allergen_b: Allergen
) -> None:
    """list_cross_reactions returns related allergens for the given allergen."""
    svc = _service(db)
    await svc.create_cross_reaction(
        allergen_id=allergen.id,
        data=CrossReactionCreate(related_allergen_id=allergen_b.id),
        tenant_id=tenant.id,
    )
    results = await svc.list_cross_reactions(allergen_id=allergen.id, tenant_id=tenant.id)
    assert len(results) == 1
    assert results[0].related_allergen_name == "Tree Nuts"


# ── 8.4 Multi-tenant isolation ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tenant_isolation_list(
    db: AsyncSession, tenant: Tenant, tenant_b: Tenant, allergen: Allergen
) -> None:
    """Tenant B cannot see tenant A's allergens in list_all."""
    svc = _service(db)
    results = await svc.list_all(tenant_id=tenant_b.id)
    assert not any(r.id == allergen.id for r in results)


@pytest.mark.asyncio
async def test_tenant_isolation_get(
    db: AsyncSession, tenant: Tenant, tenant_b: Tenant, allergen: Allergen
) -> None:
    """Tenant B cannot get tenant A's allergen by ID."""
    svc = _service(db)
    with pytest.raises(NotFoundError):
        await svc.get_by_id(allergen_id=allergen.id, tenant_id=tenant_b.id)


@pytest.mark.asyncio
async def test_tenant_isolation_update(
    db: AsyncSession, tenant: Tenant, tenant_b: Tenant, allergen: Allergen
) -> None:
    """Tenant B cannot update tenant A's allergen."""
    svc = _service(db)
    with pytest.raises(NotFoundError):
        await svc.update(
            allergen_id=allergen.id,
            data=AllergenUpdate(name="Hacked"),
            tenant_id=tenant_b.id,
            user_id=99,
        )


@pytest.mark.asyncio
async def test_tenant_isolation_delete(
    db: AsyncSession, tenant: Tenant, tenant_b: Tenant, allergen: Allergen
) -> None:
    """Tenant B cannot delete tenant A's allergen."""
    svc = _service(db)
    with patch.object(svc._cache, "invalidate", AsyncMock()):
        with pytest.raises(NotFoundError):
            await svc.delete(allergen_id=allergen.id, tenant_id=tenant_b.id, user_id=99)


# ── 8.5 RBAC tests (HTTP level) ──────────────────────────────────────────────────

@pytest.fixture
def admin_user() -> dict:
    return _make_jwt_user(roles=["ADMIN"])


@pytest.fixture
def manager_user() -> dict:
    return _make_jwt_user(roles=["MANAGER"])


@pytest.fixture
def kitchen_user() -> dict:
    return _make_jwt_user(roles=["KITCHEN"])


@pytest.fixture
def waiter_user() -> dict:
    return _make_jwt_user(roles=["WAITER"])


def _patch_current_user(user_dict: dict):
    """Patch the current_user dependency to return a fixed user dict."""
    from rest_api.core.dependencies import current_user
    from rest_api.main import app
    from fastapi import Depends

    async def _override():
        return user_dict

    return patch.dict(app.dependency_overrides, {current_user: _override})


@pytest.mark.asyncio
async def test_rbac_kitchen_get_allergens_returns_403(client) -> None:
    """KITCHEN role gets 403 on GET /api/admin/allergens."""
    kitchen = _make_jwt_user(roles=["KITCHEN"])
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    async def _override():
        return kitchen

    app.dependency_overrides[current_user] = _override
    try:
        response = client.get("/api/admin/allergens")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_rbac_waiter_post_allergens_returns_403(client) -> None:
    """WAITER role gets 403 on POST /api/admin/allergens."""
    waiter = _make_jwt_user(roles=["WAITER"])
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    async def _override():
        return waiter

    app.dependency_overrides[current_user] = _override
    try:
        response = client.post("/api/admin/allergens", json={"name": "Hack", "severity": "mild"})
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_rbac_manager_cannot_delete_allergen(client) -> None:
    """MANAGER gets 403 on DELETE /api/admin/allergens/{id}."""
    manager = _make_jwt_user(roles=["MANAGER"])
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    async def _override():
        return manager

    app.dependency_overrides[current_user] = _override
    try:
        response = client.delete("/api/admin/allergens/1")
        # 403 because MANAGER is not ADMIN
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


# ── 8.6 Public endpoint tests ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_public_allergens_404_unknown_slug(db_client) -> None:
    """GET /api/public/menu/unknown-slug/allergens returns 404."""
    response = db_client.get("/api/public/menu/this-slug-does-not-exist/allergens")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_public_allergens_empty_for_no_products(db: AsyncSession, db_client) -> None:
    """
    Public allergens endpoint returns empty list when no products are linked
    to any allergens at the branch.
    """
    from rest_api.models.branch import Branch
    from rest_api.models.tenant import Tenant

    tenant_obj = Tenant(name="Public Tenant")
    db.add(tenant_obj)
    await db.flush()

    branch_obj = Branch(
        tenant_id=tenant_obj.id,
        name="Empty Branch",
        slug="empty-branch-no-allergens",
        address="Nowhere",
    )
    db.add(branch_obj)
    await safe_commit(db)

    response = db_client.get("/api/public/menu/empty-branch-no-allergens/allergens")
    # Branch exists but no products → empty allergen list
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_public_menu_includes_allergens_per_product(
    db: AsyncSession, db_client, tenant: Tenant, branch: Branch, product: Product, allergen: Allergen
) -> None:
    """Public menu GET /api/public/menu/{slug} includes allergens per product."""
    # Link allergen to product
    pa = ProductAllergen(
        product_id=product.id,
        allergen_id=allergen.id,
        presence_type="contains",
        risk_level="severe",
    )
    db.add(pa)
    await safe_commit(db)

    with patch("rest_api.services.domain.menu_cache_service.MenuCacheService.get_menu",
               AsyncMock(return_value=None)), \
         patch("rest_api.services.domain.menu_cache_service.MenuCacheService.set_menu",
               AsyncMock()):
        response = db_client.get(f"/api/public/menu/{branch.slug}")

    assert response.status_code == 200
    data = response.json()

    # Navigate to the first available product
    for cat in data.get("categories", []):
        for subcat in cat.get("subcategories", []):
            for prod in subcat.get("products", []):
                if prod["id"] == product.id:
                    assert len(prod["allergens"]) == 1
                    a_data = prod["allergens"][0]
                    assert a_data["name"] == "Peanuts"
                    assert a_data["presence_type"] == "contains"
                    return

    pytest.fail("Product not found in public menu response")
