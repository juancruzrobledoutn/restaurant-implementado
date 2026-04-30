"""
Tests for shared/security/auth.py — JWT creation and verification.

Tests:
  - create_access_token contains all required claims
  - verify_jwt accepts a valid token
  - verify_jwt rejects an expired token
  - verify_jwt rejects a wrong signature
  - verify_jwt rejects the wrong token type
  - create_refresh_token has correct type and longer TTL
"""
import time
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from shared.security.auth import create_access_token, create_refresh_token, verify_jwt
from shared.config.settings import settings

_SAMPLE_USER = {
    "id": 42,
    "email": "test@example.com",
    "tenant_id": 1,
    "branch_ids": [1, 2],
    "roles": ["ADMIN"],
}


def test_create_access_token_returns_string():
    token = create_access_token(_SAMPLE_USER)
    assert isinstance(token, str)
    assert len(token) > 0


def test_access_token_contains_required_claims():
    """All required claims must be present in the access token."""
    token = create_access_token(_SAMPLE_USER)
    payload = jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALGORITHM],
        audience="integrador-api",
        issuer="integrador",
    )
    required = {"sub", "tenant_id", "branch_ids", "roles", "email", "jti", "type", "iss", "aud", "iat", "exp"}
    for claim in required:
        assert claim in payload, f"Missing claim: {claim}"

    assert payload["sub"] == str(_SAMPLE_USER["id"])
    assert payload["tenant_id"] == _SAMPLE_USER["tenant_id"]
    assert payload["branch_ids"] == _SAMPLE_USER["branch_ids"]
    assert payload["roles"] == _SAMPLE_USER["roles"]
    assert payload["email"] == _SAMPLE_USER["email"]
    assert payload["type"] == "access"
    assert payload["iss"] == "integrador"
    assert payload["aud"] == "integrador-api"


def test_access_token_expires_in_15_min():
    """Access token exp should be ~15 minutes (900s) in the future."""
    before = datetime.now(UTC)
    token = create_access_token(_SAMPLE_USER)
    after = datetime.now(UTC)

    payload = jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALGORITHM],
        audience="integrador-api",
        issuer="integrador",
    )
    exp = datetime.fromtimestamp(payload["exp"], tz=UTC)
    iat = datetime.fromtimestamp(payload["iat"], tz=UTC)

    assert timedelta(seconds=890) <= (exp - iat) <= timedelta(seconds=910)


def test_refresh_token_type_is_refresh():
    token = create_refresh_token(_SAMPLE_USER)
    payload = jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALGORITHM],
        audience="integrador-api",
        issuer="integrador",
    )
    assert payload["type"] == "refresh"


def test_refresh_token_expires_in_7_days():
    """Refresh token exp should be ~7 days (604800s) in the future."""
    token = create_refresh_token(_SAMPLE_USER)
    payload = jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALGORITHM],
        audience="integrador-api",
        issuer="integrador",
    )
    exp = datetime.fromtimestamp(payload["exp"], tz=UTC)
    iat = datetime.fromtimestamp(payload["iat"], tz=UTC)
    assert timedelta(days=6, hours=23) <= (exp - iat) <= timedelta(days=7, hours=1)


def test_verify_jwt_accepts_valid_access_token():
    token = create_access_token(_SAMPLE_USER)
    payload = verify_jwt(token, expected_type="access")
    assert payload["type"] == "access"
    assert payload["sub"] == str(_SAMPLE_USER["id"])


def test_verify_jwt_accepts_valid_refresh_token():
    token = create_refresh_token(_SAMPLE_USER)
    payload = verify_jwt(token, expected_type="refresh")
    assert payload["type"] == "refresh"


def test_verify_jwt_rejects_wrong_type():
    """Access token should be rejected when expected_type='refresh'."""
    token = create_access_token(_SAMPLE_USER)
    with pytest.raises(jwt.InvalidTokenError):
        verify_jwt(token, expected_type="refresh")


def test_verify_jwt_rejects_refresh_as_access():
    """Refresh token should be rejected when expected_type='access'."""
    token = create_refresh_token(_SAMPLE_USER)
    with pytest.raises(jwt.InvalidTokenError):
        verify_jwt(token, expected_type="access")


def test_verify_jwt_rejects_wrong_signature():
    """Token signed with a different secret should raise InvalidTokenError."""
    token = jwt.encode(
        {
            "sub": "1",
            "tenant_id": 1,
            "branch_ids": [],
            "roles": [],
            "email": "x@x.com",
            "jti": "test-jti",
            "type": "access",
            "iss": "integrador",
            "aud": "integrador-api",
            "iat": datetime.now(UTC),
            "exp": datetime.now(UTC) + timedelta(minutes=15),
        },
        "wrong-secret-completely-different",
        algorithm="HS256",
    )
    with pytest.raises(jwt.InvalidTokenError):
        verify_jwt(token, expected_type="access")


def test_verify_jwt_rejects_expired_token():
    """Expired token should raise ExpiredSignatureError."""
    token = jwt.encode(
        {
            "sub": "1",
            "tenant_id": 1,
            "branch_ids": [],
            "roles": [],
            "email": "x@x.com",
            "jti": "test-jti",
            "type": "access",
            "iss": "integrador",
            "aud": "integrador-api",
            "iat": datetime.now(UTC) - timedelta(hours=2),
            "exp": datetime.now(UTC) - timedelta(hours=1),  # already expired
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(jwt.ExpiredSignatureError):
        verify_jwt(token, expected_type="access")


def test_access_tokens_have_unique_jti():
    """Each token must have a unique jti (uuid4)."""
    t1 = create_access_token(_SAMPLE_USER)
    t2 = create_access_token(_SAMPLE_USER)

    p1 = jwt.decode(t1, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM], audience="integrador-api", issuer="integrador")
    p2 = jwt.decode(t2, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM], audience="integrador-api", issuer="integrador")

    assert p1["jti"] != p2["jti"]
