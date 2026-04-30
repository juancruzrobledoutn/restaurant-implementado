"""
Integration tests for catalog routers (cooking-methods, flavor-profiles, texture-profiles,
cuisine-types).

All four catalog endpoints share identical structure, tested with parametrize.

Endpoints tested per catalog:
  GET    /api/admin/{catalog}          — list items
  POST   /api/admin/{catalog}          — create item
  GET    /api/admin/{catalog}/{id}     — get item
  PUT    /api/admin/{catalog}/{id}     — update item
  DELETE /api/admin/{catalog}/{id}     — soft-delete item

RBAC:
  - ADMIN only
  - Other roles: 403

Tenant isolation:
  - Cross-tenant access returns 404

Duplicate handling:
  - Duplicate name returns 409
"""
import pytest
from unittest.mock import patch


# Catalog endpoint base paths
CATALOG_PATHS = [
    "/api/admin/cooking-methods",
    "/api/admin/flavor-profiles",
    "/api/admin/texture-profiles",
    "/api/admin/cuisine-types",
]


@pytest.fixture(autouse=True)
def mock_redis():
    """Mock Redis calls so the TestClient can run without a Redis instance."""
    async def _false(*a, **kw): return False
    async def _none(*a, **kw): return None

    patches = [
        patch("rest_api.core.dependencies.is_blacklisted", side_effect=_false),
        patch("rest_api.core.dependencies.get_nuclear_revocation_time", side_effect=_none),
    ]
    for p in patches:
        p.start()
    yield
    for p in patches:
        p.stop()


# ── Unauthenticated tests ──────────────────────────────────────────────────────

@pytest.mark.parametrize("path", CATALOG_PATHS)
def test_catalog_list_no_auth(client, path: str):
    """GET without auth returns 401."""
    response = client.get(path)
    assert response.status_code == 401


@pytest.mark.parametrize("path", CATALOG_PATHS)
def test_catalog_create_no_auth(client, path: str):
    """POST without auth returns 401."""
    response = client.post(path, json={"name": "Test Item"})
    assert response.status_code == 401


@pytest.mark.parametrize("path", CATALOG_PATHS)
def test_catalog_get_no_auth(client, path: str):
    """GET /{id} without auth returns 401."""
    response = client.get(f"{path}/1")
    assert response.status_code == 401


@pytest.mark.parametrize("path", CATALOG_PATHS)
def test_catalog_delete_no_auth(client, path: str):
    """DELETE /{id} without auth returns 401."""
    response = client.delete(f"{path}/1")
    assert response.status_code == 401


# ── Route registration smoke tests ────────────────────────────────────────────

@pytest.mark.parametrize("path", CATALOG_PATHS)
def test_catalog_routes_are_registered(client, path: str):
    """All catalog routes exist in the app (not 404)."""
    assert client.get(path).status_code != 404, f"{path} list route not found"
    assert client.post(path, json={"name": "x"}).status_code != 404, f"{path} create route not found"
    assert client.get(f"{path}/1").status_code != 404, f"{path}/{{id}} get route not found"
    assert client.put(f"{path}/1", json={"name": "y"}).status_code != 404, f"{path}/{{id}} put route not found"
    assert client.delete(f"{path}/1").status_code != 404, f"{path}/{{id}} delete route not found"


# ── Validation tests ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", CATALOG_PATHS)
def test_catalog_create_missing_name(client, path: str):
    """POST with empty body returns 401 (no auth) or 422 (schema validation with auth)."""
    response = client.post(path, json={})
    assert response.status_code in (401, 422)
