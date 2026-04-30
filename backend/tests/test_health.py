"""
Tests for the health check endpoint.

Validates that the FastAPI app starts correctly and the health endpoint
returns the expected response shape and status code.
"""
from fastapi.testclient import TestClient


def test_health_returns_200(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200


def test_health_returns_ok_status(client: TestClient) -> None:
    response = client.get("/api/health")
    data = response.json()
    assert data["status"] == "ok"


def test_health_returns_version(client: TestClient) -> None:
    response = client.get("/api/health")
    data = response.json()
    assert "version" in data
    assert data["version"] == "0.1.0"
