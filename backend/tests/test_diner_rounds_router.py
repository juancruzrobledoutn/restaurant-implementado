"""
HTTP router tests for diner round endpoints (C-10).

Endpoints:
  POST /api/diner/rounds  — create round from cart (X-Table-Token auth)
  GET  /api/diner/rounds  — list diner's rounds (X-Table-Token auth)

Covers:
  - Missing X-Table-Token → 422 (required header)
  - Invalid X-Table-Token → 401
  - Route registration (not 404)
"""
import pytest
from unittest.mock import patch


@pytest.fixture(autouse=True)
def mock_redis():
    async def _false(*a, **kw):
        return False

    async def _none(*a, **kw):
        return None

    patches = [
        patch("rest_api.core.dependencies.is_blacklisted", side_effect=_false),
        patch("rest_api.core.dependencies.get_nuclear_revocation_time", side_effect=_none),
    ]
    for p in patches:
        p.start()
    yield
    for p in patches:
        p.stop()


# ── Route registration ────────────────────────────────────────────────────────

def test_diner_rounds_routes_registered(client):
    """Both diner-rounds routes exist in the app (not 404)."""
    assert client.post("/api/diner/rounds", json={}).status_code != 404
    assert client.get("/api/diner/rounds").status_code != 404


# ── Missing header → 422 ──────────────────────────────────────────────────────

def test_create_round_missing_table_token_422(client):
    """POST without X-Table-Token returns 422 — header is required."""
    resp = client.post("/api/diner/rounds", json={})
    assert resp.status_code == 422


def test_list_rounds_missing_table_token_422(client):
    """GET without X-Table-Token returns 422 — header is required."""
    resp = client.get("/api/diner/rounds")
    assert resp.status_code == 422


# ── Invalid token → 401 ───────────────────────────────────────────────────────

def test_create_round_invalid_table_token_401(client):
    """POST with a malformed X-Table-Token returns 401."""
    resp = client.post(
        "/api/diner/rounds",
        json={},
        headers={"X-Table-Token": "this-is-not-a-valid-hmac-token"},
    )
    assert resp.status_code == 401


def test_list_rounds_invalid_table_token_401(client):
    """GET with a malformed X-Table-Token returns 401."""
    resp = client.get(
        "/api/diner/rounds",
        headers={"X-Table-Token": "this-is-not-a-valid-hmac-token"},
    )
    assert resp.status_code == 401
