"""
Tests for public branches endpoint.

Coverage:
  9.6 - GET /api/public/branches returns active branches only
      - Inactive branches are excluded
      - Response shape: id, name, address, slug only
      - Empty list when no active branches
      - No authentication required
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.tenant import Tenant
from shared.infrastructure.db import safe_commit


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="Public Branch Test Tenant")
    db.add(t)
    await db.flush()
    return t


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_public_branches_requires_no_auth(db_client: TestClient) -> None:
    """GET /api/public/branches is accessible without Authorization header."""
    resp = db_client.get("/api/public/branches")
    assert resp.status_code == 200


def test_public_branches_returns_empty_list_when_no_branches(db_client: TestClient) -> None:
    """Returns 200 with empty list when there are no active branches."""
    resp = db_client.get("/api/public/branches")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert data == []


@pytest.mark.asyncio
async def test_public_branches_returns_active_branches(
    db: AsyncSession, db_client: TestClient, tenant: Tenant
) -> None:
    """Active branches appear in the public listing."""
    b = Branch(
        tenant_id=tenant.id,
        name="Active Branch",
        address="Av. Principal 100",
        slug="active-branch",
    )
    db.add(b)
    await safe_commit(db)

    resp = db_client.get("/api/public/branches")

    assert resp.status_code == 200
    data = resp.json()
    names = [item["name"] for item in data]
    assert "Active Branch" in names


@pytest.mark.asyncio
async def test_public_branches_excludes_inactive_branches(
    db: AsyncSession, db_client: TestClient, tenant: Tenant
) -> None:
    """Inactive branches (is_active=False) are excluded from the public listing."""
    active = Branch(
        tenant_id=tenant.id,
        name="Active One",
        address="Calle A",
        slug="active-one",
    )
    inactive = Branch(
        tenant_id=tenant.id,
        name="Inactive One",
        address="Calle B",
        slug="inactive-one",
        is_active=False,
    )
    db.add_all([active, inactive])
    await safe_commit(db)

    resp = db_client.get("/api/public/branches")

    assert resp.status_code == 200
    data = resp.json()
    names = [item["name"] for item in data]
    assert "Active One" in names
    assert "Inactive One" not in names


@pytest.mark.asyncio
async def test_public_branches_response_shape(
    db: AsyncSession, db_client: TestClient, tenant: Tenant
) -> None:
    """
    Response items contain exactly: id, name, address, slug.
    Internal fields like tenant_id must NOT be exposed.
    """
    b = Branch(
        tenant_id=tenant.id,
        name="Shape Branch",
        address="Calle Shape",
        slug="shape-branch",
    )
    db.add(b)
    await safe_commit(db)

    resp = db_client.get("/api/public/branches")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1

    item = data[0]
    assert "id" in item
    assert "name" in item
    assert "address" in item
    assert "slug" in item
    # Internal fields must NOT leak
    assert "tenant_id" not in item
    assert "is_active" not in item
    assert "created_at" not in item


@pytest.mark.asyncio
async def test_public_branches_multiple_tenants(
    db: AsyncSession, db_client: TestClient,
) -> None:
    """Branches from different tenants both appear in public listing if active."""
    tenant_a = Tenant(name="Tenant A PB")
    tenant_b = Tenant(name="Tenant B PB")
    db.add_all([tenant_a, tenant_b])
    await db.flush()

    b_a = Branch(
        tenant_id=tenant_a.id,
        name="Branch Tenant A",
        address="Calle A",
        slug="branch-tenant-a-pb",
    )
    b_b = Branch(
        tenant_id=tenant_b.id,
        name="Branch Tenant B",
        address="Calle B",
        slug="branch-tenant-b-pb",
    )
    db.add_all([b_a, b_b])
    await safe_commit(db)

    resp = db_client.get("/api/public/branches")

    assert resp.status_code == 200
    data = resp.json()
    names = [item["name"] for item in data]
    assert "Branch Tenant A" in names
    assert "Branch Tenant B" in names
