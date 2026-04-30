"""
HTTP router tests for admin round endpoints (C-10).

Endpoint:
  PATCH /api/admin/rounds/{id}  — submit or cancel a round (MANAGER/ADMIN only)

Covers:
  - No auth → 401
  - WAITER role → 403
  - KITCHEN role → 403
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
        "roles": roles or ["MANAGER"],
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

def test_admin_rounds_route_registered(client):
    """Admin rounds route exists in the app (not 404)."""
    assert client.patch("/api/admin/rounds/1", json={}).status_code != 404


# ── Unauthenticated → 401 ─────────────────────────────────────────────────────

def test_update_round_admin_no_auth_401(client):
    resp = client.patch("/api/admin/rounds/1", json={"status": "SUBMITTED"})
    assert resp.status_code == 401


# ── Role gating — only MANAGER/ADMIN allowed ─────────────────────────────────

def test_update_round_waiter_role_403(client):
    _set_user_override(_make_jwt_user(roles=["WAITER"]))
    try:
        resp = client.patch("/api/admin/rounds/1", json={"status": "SUBMITTED"})
        assert resp.status_code == 403
    finally:
        _clear_user_override()


def test_update_round_kitchen_role_403(client):
    _set_user_override(_make_jwt_user(roles=["KITCHEN"]))
    try:
        resp = client.patch("/api/admin/rounds/1", json={"status": "SUBMITTED"})
        assert resp.status_code == 403
    finally:
        _clear_user_override()
