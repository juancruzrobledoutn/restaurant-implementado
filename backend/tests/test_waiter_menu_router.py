"""
HTTP router tests for GET /api/waiter/branches/{branch_id}/menu (C-11).

Covers:
  - WAITER GET returns compact shape (no images, no allergens)
  - Unavailable BranchProduct excluded
  - Inactive category excluded
  - Wrong-branch GET → 403
  - KITCHEN → 403
  - Unauthenticated → 401
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.models.tenant import Tenant
from rest_api.models.user import User


def _make_jwt_user(
    user_id: int = 1,
    tenant_id: int = 1,
    branch_ids: list[int] | None = None,
    roles: list[str] | None = None,
) -> dict:
    return {
        "user_id": user_id,
        "email": f"user{user_id}@test.com",
        "tenant_id": tenant_id,
        "branch_ids": branch_ids or [1],
        "roles": roles or ["WAITER"],
        "jti": f"jti-{user_id}",
        "exp": 9999999999,
    }


def _set_user_override(user: dict):
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    async def _override():
        return user

    app.dependency_overrides[current_user] = _override


def _clear_user_override():
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    app.dependency_overrides.pop(current_user, None)


@pytest_asyncio.fixture
async def seeded(db: AsyncSession):
    tenant = Tenant(name="Tenant A")
    db.add(tenant)
    await db.flush()

    branch = Branch(tenant_id=tenant.id, name="Main", address="X", slug="main")
    db.add(branch)
    await db.flush()

    # Category 1 — active with an available product.
    cat1 = Category(branch_id=branch.id, name="Burgers", order=10)
    db.add(cat1)
    await db.flush()
    subcat1 = Subcategory(category_id=cat1.id, name="Classic", order=10)
    db.add(subcat1)
    await db.flush()
    prod_available = Product(
        subcategory_id=subcat1.id, name="Available Burger", price=15000,
        description="desc", image="img.png",
    )
    db.add(prod_available)
    await db.flush()
    bp_available = BranchProduct(
        product_id=prod_available.id, branch_id=branch.id,
        price_cents=18000, is_available=True,
    )
    db.add(bp_available)

    # Category 1 — also has a product that is UNAVAILABLE at this branch.
    prod_unavailable = Product(
        subcategory_id=subcat1.id, name="Out Of Stock", price=12000,
    )
    db.add(prod_unavailable)
    await db.flush()
    bp_unavailable = BranchProduct(
        product_id=prod_unavailable.id, branch_id=branch.id,
        price_cents=12000, is_available=False,  # 86'd
    )
    db.add(bp_unavailable)

    # Category 2 — INACTIVE (soft-deleted). Should be excluded.
    cat2 = Category(branch_id=branch.id, name="Hidden", order=20)
    db.add(cat2)
    await db.flush()
    cat2.is_active = False

    users: dict[str, User] = {}
    for role in ("ADMIN", "MANAGER", "WAITER", "KITCHEN"):
        u = User(
            tenant_id=tenant.id, email=f"{role.lower()}@test.com",
            hashed_password="x", full_name=f"{role} User",
        )
        db.add(u)
        users[role] = u
    await db.flush()
    await db.commit()

    return {
        "tenant": tenant, "branch": branch, "users": users,
        "cat1": cat1, "cat2_hidden": cat2,
        "prod_available": prod_available,
        "prod_unavailable": prod_unavailable,
    }


@pytest.mark.asyncio
async def test_waiter_get_returns_compact_shape(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    user = _make_jwt_user(
        user_id=seeded["users"]["WAITER"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["WAITER"],
    )
    _set_user_override(user)
    try:
        resp = db_client.get(f"/api/waiter/branches/{seeded['branch'].id}/menu")
        assert resp.status_code == 200
        data = resp.json()

        # Exactly one category (hidden cat2 excluded).
        assert len(data["categories"]) == 1
        cat_out = data["categories"][0]
        assert cat_out["id"] == seeded["cat1"].id
        assert cat_out["name"] == "Burgers"

        # Inside, exactly ONE product — available only.
        assert len(cat_out["subcategories"]) == 1
        products = cat_out["subcategories"][0]["products"]
        assert len(products) == 1
        p = products[0]
        assert p["id"] == seeded["prod_available"].id
        assert p["name"] == "Available Burger"
        assert p["price_cents"] == 18000
        assert p["is_available"] is True

        # No heavy fields
        assert "image" not in p
        assert "description" not in p
        assert "allergens" not in p
        # No branch metadata at top level.
        assert "branch" not in data
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_wrong_branch_returns_403(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    user = _make_jwt_user(
        user_id=seeded["users"]["WAITER"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["WAITER"],
    )
    _set_user_override(user)
    try:
        resp = db_client.get("/api/waiter/branches/999/menu")
        assert resp.status_code == 403
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_kitchen_gets_403(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    user = _make_jwt_user(
        user_id=seeded["users"]["KITCHEN"].id,
        tenant_id=seeded["tenant"].id,
        branch_ids=[seeded["branch"].id],
        roles=["KITCHEN"],
    )
    _set_user_override(user)
    try:
        resp = db_client.get(f"/api/waiter/branches/{seeded['branch'].id}/menu")
        assert resp.status_code == 403
    finally:
        _clear_user_override()


@pytest.mark.asyncio
async def test_unauthenticated_returns_401(
    db: AsyncSession, seeded: dict, db_client
) -> None:
    resp = db_client.get(f"/api/waiter/branches/{seeded['branch'].id}/menu")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_admin_cross_tenant_branch_returns_404(
    db: AsyncSession, db_client
) -> None:
    """An ADMIN from tenant A requesting a branch that doesn't exist in their tenant gets 404."""
    # Seed a tenant with one branch
    tenant_a = Tenant(name="A")
    db.add(tenant_a)
    await db.flush()
    tenant_b = Tenant(name="B")
    db.add(tenant_b)
    await db.flush()
    branch_b = Branch(tenant_id=tenant_b.id, name="B Main", address="Y", slug="b")
    db.add(branch_b)
    await db.flush()
    await db.commit()

    user = _make_jwt_user(
        user_id=1,
        tenant_id=tenant_a.id,  # tenant A
        branch_ids=[],
        roles=["ADMIN"],
    )
    _set_user_override(user)
    try:
        resp = db_client.get(f"/api/waiter/branches/{branch_b.id}/menu")
        assert resp.status_code == 404
    finally:
        _clear_user_override()
