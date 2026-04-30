"""
HTTP router tests for kitchen round endpoints (C-10).

Endpoints:
  GET   /api/kitchen/rounds?branch_id={id}  — list SUBMITTED/IN_KITCHEN/READY rounds
  PATCH /api/kitchen/rounds/{id}             — move SUBMITTED→IN_KITCHEN or IN_KITCHEN→READY

Covers:
  - No auth → 401
  - WAITER role → 403 (only KITCHEN/MANAGER/ADMIN allowed)
  - Route registration (not 404)
"""
import pytest
from unittest.mock import patch


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
        "roles": roles or ["KITCHEN"],
        "jti": f"jti-{user_id}",
        "exp": 9999999999,
    }


def _set_user_override(user: dict) -> None:
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    async def _override():
        return user

    app.dependency_overrides[current_user] = _override


def _clear_user_override() -> None:
    from rest_api.core.dependencies import current_user
    from rest_api.main import app

    app.dependency_overrides.pop(current_user, None)


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

def test_kitchen_rounds_routes_registered(client):
    """Both kitchen-rounds routes exist in the app (not 404)."""
    assert client.get("/api/kitchen/rounds?branch_id=1").status_code != 404
    assert client.patch("/api/kitchen/rounds/1", json={}).status_code != 404


# ── Unauthenticated → 401 ─────────────────────────────────────────────────────

def test_list_kitchen_rounds_no_auth_401(client):
    resp = client.get("/api/kitchen/rounds?branch_id=1")
    assert resp.status_code == 401


def test_update_kitchen_round_no_auth_401(client):
    resp = client.patch("/api/kitchen/rounds/1", json={"status": "IN_KITCHEN"})
    assert resp.status_code == 401


# ── WAITER role → 403 ────────────────────────────────────────────────────────

def test_list_kitchen_rounds_waiter_role_403(client):
    _set_user_override(_make_jwt_user(roles=["WAITER"]))
    try:
        resp = client.get("/api/kitchen/rounds?branch_id=1")
        assert resp.status_code == 403
    finally:
        _clear_user_override()


def test_update_kitchen_round_waiter_role_403(client):
    _set_user_override(_make_jwt_user(roles=["WAITER"]))
    try:
        resp = client.patch("/api/kitchen/rounds/1", json={"status": "IN_KITCHEN"})
        assert resp.status_code == 403
    finally:
        _clear_user_override()
