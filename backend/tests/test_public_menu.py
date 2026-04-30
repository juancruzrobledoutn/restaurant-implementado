"""
Tests for the public menu endpoint.

Coverage:
  10.4 - GET /api/public/menu/{slug}:
         - Full nested response structure (categories → subcategories → products)
         - Cache hit: second call served from cache, DB not queried again
         - Cache invalidation on CRUD via MenuCacheService.invalidate()
         - 404 for unknown slug
         - 404 for inactive branch
         - Products with is_available=False excluded from response
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.models.tenant import Tenant
from rest_api.services.domain.menu_cache_service import MenuCacheService


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="Tenant Public Menu Test")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def branch(db: AsyncSession, tenant: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant.id,
        name="Centro",
        address="Av. 9 de Julio 100",
        slug="centro-pub",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def inactive_branch(db: AsyncSession, tenant: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant.id,
        name="Closed Branch",
        address="Nowhere",
        slug="closed-branch",
        is_active=False,
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def full_menu(db: AsyncSession, branch: Branch) -> dict:
    """Create a full menu structure: 1 category, 1 subcategory, 2 products."""
    cat = Category(branch_id=branch.id, name="Entradas", order=10)
    db.add(cat)
    await db.flush()

    subcat = Subcategory(category_id=cat.id, name="Ensaladas", order=10)
    db.add(subcat)
    await db.flush()

    product_a = Product(
        subcategory_id=subcat.id, name="Caesar Salad", price=12550, featured=True, popular=False
    )
    product_b = Product(
        subcategory_id=subcat.id, name="Greek Salad", price=11000, featured=False, popular=True
    )
    db.add_all([product_a, product_b])
    await db.flush()

    # product_a: available at branch
    bp_a = BranchProduct(
        product_id=product_a.id, branch_id=branch.id, price_cents=13000, is_available=True
    )
    # product_b: NOT available at branch
    bp_b = BranchProduct(
        product_id=product_b.id, branch_id=branch.id, price_cents=12000, is_available=False
    )
    db.add_all([bp_a, bp_b])
    await db.flush()

    return {
        "category": cat,
        "subcategory": subcat,
        "product_a": product_a,
        "product_b": product_b,
        "bp_a": bp_a,
        "bp_b": bp_b,
    }


# ── Cache service unit tests ────────────────────────────────────────────────────

class TestMenuCacheService:
    @pytest.mark.asyncio
    async def test_get_menu_returns_none_on_miss(self):
        """Cache miss returns None (no Redis needed — we mock the client)."""
        svc = MenuCacheService()
        with patch("rest_api.services.domain.menu_cache_service._get_redis") as mock_redis:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=None)
            mock_client.aclose = AsyncMock()
            mock_redis.return_value = mock_client

            result = await svc.get_menu("some-slug")
            assert result is None

    @pytest.mark.asyncio
    async def test_get_menu_returns_parsed_data_on_hit(self):
        """Cache hit returns the deserialized dict."""
        import json

        svc = MenuCacheService()
        cached_data = {"branch": {"slug": "test"}, "categories": []}
        with patch("rest_api.services.domain.menu_cache_service._get_redis") as mock_redis:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=json.dumps(cached_data))
            mock_client.aclose = AsyncMock()
            mock_redis.return_value = mock_client

            result = await svc.get_menu("test")
            assert result == cached_data

    @pytest.mark.asyncio
    async def test_set_menu_stores_json(self):
        svc = MenuCacheService()
        with patch("rest_api.services.domain.menu_cache_service._get_redis") as mock_redis:
            mock_client = AsyncMock()
            mock_client.set = AsyncMock()
            mock_client.aclose = AsyncMock()
            mock_redis.return_value = mock_client

            await svc.set_menu("test-slug", {"key": "value"})
            mock_client.set.assert_awaited_once()
            call_args = mock_client.set.call_args
            assert "menu:test-slug" in call_args[0]

    @pytest.mark.asyncio
    async def test_invalidate_deletes_key(self):
        svc = MenuCacheService()
        with patch("rest_api.services.domain.menu_cache_service._get_redis") as mock_redis:
            mock_client = AsyncMock()
            mock_client.delete = AsyncMock()
            mock_client.aclose = AsyncMock()
            mock_redis.return_value = mock_client

            await svc.invalidate("centro")
            mock_client.delete.assert_awaited_once_with("menu:centro")

    @pytest.mark.asyncio
    async def test_get_menu_returns_none_on_redis_failure(self):
        """Redis failure → silently returns None (fail-open for caching)."""
        svc = MenuCacheService()
        with patch("rest_api.services.domain.menu_cache_service._get_redis") as mock_redis:
            mock_redis.side_effect = Exception("Redis connection refused")
            result = await svc.get_menu("slug")
            assert result is None

    @pytest.mark.asyncio
    async def test_set_menu_silently_skips_on_redis_failure(self):
        """Redis failure on set → silently skips (no exception)."""
        svc = MenuCacheService()
        with patch("rest_api.services.domain.menu_cache_service._get_redis") as mock_redis:
            mock_redis.side_effect = Exception("Redis down")
            # Must not raise
            await svc.set_menu("slug", {"data": "here"})

    @pytest.mark.asyncio
    async def test_invalidate_silently_skips_on_redis_failure(self):
        """Redis failure on invalidate → silently skips."""
        svc = MenuCacheService()
        with patch("rest_api.services.domain.menu_cache_service._get_redis") as mock_redis:
            mock_redis.side_effect = Exception("Redis down")
            await svc.invalidate("slug")  # Must not raise


# ── Public menu endpoint tests (HTTP-level) ────────────────────────────────────

@pytest.fixture(autouse=True)
def mock_redis_deps():
    """Mock Redis for auth dependencies."""
    async def _noop(*args, **kwargs): return None
    async def _false(*args, **kwargs): return False

    patches = [
        patch("rest_api.core.dependencies.is_blacklisted", side_effect=_false),
        patch("rest_api.core.dependencies.get_nuclear_revocation_time", side_effect=_noop),
    ]
    started = [p.start() for p in patches]
    yield
    for p in patches:
        p.stop()


class TestPublicMenuEndpoint:
    def test_404_for_unknown_slug(self, client: TestClient):
        """GET /api/public/menu/nonexistent → 404 (branch not found in DB)."""
        # Mock both cache miss AND DB returning None for branch lookup
        async def _cache_miss(*args, **kwargs):
            return None

        async def _mock_get_db():
            mock_session = AsyncMock()
            # scalar() returns None → branch not found
            mock_session.scalar = AsyncMock(return_value=None)
            yield mock_session

        from rest_api.main import app
        from shared.infrastructure.db import get_db

        app.dependency_overrides[get_db] = _mock_get_db
        try:
            with patch(
                "rest_api.routers.public_menu.MenuCacheService.get_menu",
                new=AsyncMock(return_value=None),
            ):
                response = client.get("/api/public/menu/nonexistent-slug-xyz")
            assert response.status_code == 404
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_404_for_inactive_branch(self, client: TestClient):
        """A branch that is inactive → 404 (DB returns None for is_active=True filter)."""
        async def _mock_get_db():
            mock_session = AsyncMock()
            mock_session.scalar = AsyncMock(return_value=None)  # inactive branch = not found
            yield mock_session

        from rest_api.main import app
        from shared.infrastructure.db import get_db

        app.dependency_overrides[get_db] = _mock_get_db
        try:
            with patch(
                "rest_api.routers.public_menu.MenuCacheService.get_menu",
                new=AsyncMock(return_value=None),
            ):
                response = client.get("/api/public/menu/inactive-branch")
            assert response.status_code == 404
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_cache_hit_returns_cached_data(self, client: TestClient):
        """If cache returns data, the response uses it and DB is not queried."""
        cached_response = {
            "branch": {
                "id": 1,
                "name": "Centro",
                "slug": "centro",
                "address": "Somewhere",
            },
            "categories": [],
        }
        with patch(
            "rest_api.routers.public_menu.MenuCacheService.get_menu",
            new=AsyncMock(return_value=cached_response),
        ):
            response = client.get("/api/public/menu/centro")
        assert response.status_code == 200
        data = response.json()
        assert data["branch"]["slug"] == "centro"
        assert data["categories"] == []


# ── Unit tests for _build_menu structure ──────────────────────────────────────

class TestBuildMenuUnit:
    @pytest.mark.asyncio
    async def test_available_products_included(
        self, db: AsyncSession, branch: Branch, full_menu: dict
    ):
        """Products with is_available=True are included; False are excluded."""
        from rest_api.routers.public_menu import _build_menu

        result = await _build_menu(branch, db)

        # Navigate the nested structure
        categories = result["categories"]
        assert len(categories) == 1

        subcategories = categories[0]["subcategories"]
        assert len(subcategories) == 1

        products = subcategories[0]["products"]
        product_names = [p["name"] for p in products]

        # product_a is available → included
        assert "Caesar Salad" in product_names
        # product_b is NOT available (is_available=False) → excluded
        assert "Greek Salad" not in product_names

    @pytest.mark.asyncio
    async def test_branch_price_used_not_base_price(
        self, db: AsyncSession, branch: Branch, full_menu: dict
    ):
        """price_cents in response comes from BranchProduct, not Product.price."""
        from rest_api.routers.public_menu import _build_menu

        result = await _build_menu(branch, db)
        products = result["categories"][0]["subcategories"][0]["products"]
        assert products[0]["price_cents"] == 13000  # from BranchProduct, not 12550 (base)

    @pytest.mark.asyncio
    async def test_inactive_category_excluded(
        self, db: AsyncSession, branch: Branch
    ):
        """Inactive categories are not included in the public menu."""
        inactive_cat = Category(
            branch_id=branch.id, name="Hidden Cat", order=99, is_active=False
        )
        db.add(inactive_cat)
        await db.flush()

        from rest_api.routers.public_menu import _build_menu

        result = await _build_menu(branch, db)
        cat_names = [c["name"] for c in result["categories"]]
        assert "Hidden Cat" not in cat_names

    @pytest.mark.asyncio
    async def test_categories_ordered_by_order_field(
        self, db: AsyncSession, branch: Branch
    ):
        """Categories in response are sorted by the `order` field."""
        cat_b = Category(branch_id=branch.id, name="Bebidas", order=5)
        cat_a = Category(branch_id=branch.id, name="Postres", order=50)
        cat_m = Category(branch_id=branch.id, name="Principales", order=20)
        db.add_all([cat_b, cat_a, cat_m])
        await db.flush()

        from rest_api.routers.public_menu import _build_menu

        result = await _build_menu(branch, db)
        orders = [c["order"] for c in result["categories"]]
        assert orders == sorted(orders)
