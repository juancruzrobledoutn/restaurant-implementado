"""
HTTP router tests for waiter round endpoints (C-10).

Endpoints:
  POST  /api/waiter/sessions/{id}/rounds    — quick-command round (WAITER/MANAGER/ADMIN)
  PATCH /api/waiter/rounds/{id}             — confirm PENDING → CONFIRMED
  PATCH /api/waiter/rounds/{id}/serve       — serve READY → SERVED
  POST  /api/waiter/rounds/{id}/void-item   — void a single item
  GET   /api/waiter/rounds?session_id={id}  — list rounds for a session

Covers:
  - No auth → 401
  - KITCHEN role → 403 on endpoints gated to WAITER/MANAGER/ADMIN
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
        "roles": roles or ["WAITER"],
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

def test_waiter_rounds_routes_registered(client):
    """All waiter-rounds routes exist in the app (not 404)."""
    assert client.post("/api/waiter/sessions/1/rounds", json={}).status_code != 404
    assert client.patch("/api/waiter/rounds/1", json={}).status_code != 404
    assert client.patch("/api/waiter/rounds/1/serve").status_code != 404
    assert client.post("/api/waiter/rounds/1/void-item", json={}).status_code != 404
    assert client.get("/api/waiter/rounds?session_id=1").status_code != 404


# ── Unauthenticated → 401 ─────────────────────────────────────────────────────

def test_create_round_no_auth_401(client):
    resp = client.post("/api/waiter/sessions/1/rounds", json={"items": []})
    assert resp.status_code == 401


def test_confirm_round_no_auth_401(client):
    resp = client.patch("/api/waiter/rounds/1", json={"status": "CONFIRMED"})
    assert resp.status_code == 401


def test_serve_round_no_auth_401(client):
    resp = client.patch("/api/waiter/rounds/1/serve")
    assert resp.status_code == 401


def test_void_item_no_auth_401(client):
    resp = client.post(
        "/api/waiter/rounds/1/void-item",
        json={"round_item_id": 1, "void_reason": "burnt"},
    )
    assert resp.status_code == 401


def test_list_rounds_no_auth_401(client):
    resp = client.get("/api/waiter/rounds?session_id=1")
    assert resp.status_code == 401


# ── KITCHEN role → 403 ────────────────────────────────────────────────────────

def test_create_round_kitchen_role_403(client):
    _set_user_override(_make_jwt_user(roles=["KITCHEN"]))
    try:
        # Valid body required — Pydantic validates before role check fires.
        resp = client.post(
            "/api/waiter/sessions/1/rounds",
            json={"items": [{"product_id": 1, "quantity": 1}]},
        )
        assert resp.status_code == 403
    finally:
        _clear_user_override()


def test_confirm_round_kitchen_role_403(client):
    _set_user_override(_make_jwt_user(roles=["KITCHEN"]))
    try:
        resp = client.patch("/api/waiter/rounds/1", json={"status": "CONFIRMED"})
        assert resp.status_code == 403
    finally:
        _clear_user_override()


def test_void_item_kitchen_role_403(client):
    _set_user_override(_make_jwt_user(roles=["KITCHEN"]))
    try:
        resp = client.post(
            "/api/waiter/rounds/1/void-item",
            json={"round_item_id": 1, "void_reason": "burnt"},
        )
        assert resp.status_code == 403
    finally:
        _clear_user_override()


def test_list_rounds_kitchen_role_403(client):
    _set_user_override(_make_jwt_user(roles=["KITCHEN"]))
    try:
        resp = client.get("/api/waiter/rounds?session_id=1")
        assert resp.status_code == 403
    finally:
        _clear_user_override()
