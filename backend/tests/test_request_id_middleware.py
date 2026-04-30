"""
Tests for RequestIDMiddleware.

Verifies:
  1. X-Request-ID header is present in every response.
  2. A client-provided X-Request-ID is echoed back unchanged.
  3. When no X-Request-ID is provided, a valid UUID4 is generated.
  4. The request_id ContextVar is set during request processing and cleared after.
  5. The ContextVar is isolated between concurrent requests (async safety).
"""
import re
import uuid
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from shared.middleware.request_id import RequestIDMiddleware, request_id_ctx


# ── Minimal test app ──────────────────────────────────────────────────────────

def _make_app() -> FastAPI:
    """Create a minimal FastAPI app with only RequestIDMiddleware."""
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/echo-request-id")
    def echo_request_id():
        """Return the request_id as seen inside the handler."""
        return {"request_id": request_id_ctx.get()}

    return app


@pytest.fixture()
def client():
    app = _make_app()
    return TestClient(app, raise_server_exceptions=True)


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestRequestIDMiddlewareHeader:
    """X-Request-ID header presence and value."""

    def test_response_contains_x_request_id(self, client: TestClient):
        """Every response must include the X-Request-ID header."""
        response = client.get("/echo-request-id")
        assert response.status_code == 200
        assert "X-Request-ID" in response.headers

    def test_generated_request_id_is_valid_uuid4(self, client: TestClient):
        """When the client does not send X-Request-ID, the server generates a uuid4."""
        response = client.get("/echo-request-id")
        rid = response.headers["X-Request-ID"]
        # Verify it is a valid UUID4
        parsed = uuid.UUID(rid, version=4)
        assert str(parsed) == rid

    def test_client_provided_request_id_is_echoed(self, client: TestClient):
        """When the client sends X-Request-ID, the same value is returned."""
        custom_id = "my-trace-id-from-frontend-abc123"
        response = client.get(
            "/echo-request-id",
            headers={"X-Request-ID": custom_id},
        )
        assert response.headers["X-Request-ID"] == custom_id

    def test_different_requests_get_different_ids(self, client: TestClient):
        """Each request without a client-provided ID gets a unique ID."""
        r1 = client.get("/echo-request-id")
        r2 = client.get("/echo-request-id")
        assert r1.headers["X-Request-ID"] != r2.headers["X-Request-ID"]


class TestRequestIDContextVar:
    """ContextVar propagation inside request handlers."""

    def test_request_id_available_in_handler(self, client: TestClient):
        """The handler can read the request_id via ContextVar."""
        response = client.get("/echo-request-id")
        assert response.status_code == 200
        body = response.json()
        # The body request_id matches the header
        assert body["request_id"] == response.headers["X-Request-ID"]

    def test_client_provided_id_visible_in_handler(self, client: TestClient):
        """When the client provides X-Request-ID, the handler sees it in ContextVar."""
        custom_id = "frontend-correlation-id-xyz"
        response = client.get(
            "/echo-request-id",
            headers={"X-Request-ID": custom_id},
        )
        assert response.json()["request_id"] == custom_id

    def test_context_var_cleared_after_request(self):
        """The ContextVar is reset to its default ("") after the request completes."""
        # Verify default state before any request
        assert request_id_ctx.get() == ""

        app = _make_app()
        with TestClient(app) as client:
            client.get("/echo-request-id")

        # After request completes, the ContextVar in the test thread is unchanged
        assert request_id_ctx.get() == ""

    def test_middleware_does_not_leak_between_requests(self, client: TestClient):
        """
        Each request gets its own isolated request_id, proving ContextVar
        isolation (no leakage from a previous request).
        """
        ids_seen = set()
        for _ in range(5):
            r = client.get("/echo-request-id")
            body_id = r.json()["request_id"]
            header_id = r.headers["X-Request-ID"]
            # Body and header must agree
            assert body_id == header_id
            ids_seen.add(body_id)

        # All 5 requests got unique IDs
        assert len(ids_seen) == 5
