"""
Table Token — stateless HMAC-SHA256 JSON envelope for diner authentication.

Architecture (D-03):
  table_token = base64url(json_payload) + "." + base64url(hmac_sha256(secret, b64_payload))

Token payload fields:
  session_id, table_id, diner_id, branch_id, tenant_id, iat, exp

Rules:
  - NEVER reuse JWT_SECRET — TABLE_TOKEN_SECRET is a separate env var
  - Stdlib only: hmac + hashlib.sha256 + base64 — no PyJWT dependency
  - Fail-closed: any decode/verify error → AuthenticationError
  - The dependency current_table_context loads the live session from DB,
    so a closed session's token is rejected without needing a blacklist

Transport: X-Table-Token header
TTL: TABLE_TOKEN_TTL_SECONDS (default 10800 = 3 hours)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Depends, Header, HTTPException

from shared.config.logging import get_logger
from shared.config.settings import settings

if TYPE_CHECKING:
    from rest_api.models.sector import Table
    from rest_api.models.branch import Branch
    from rest_api.models.table_session import TableSession

logger = get_logger(__name__)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _b64url_encode(raw: bytes) -> str:
    """Base64url-encode bytes without padding."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    """Base64url-decode a string, re-adding padding as needed."""
    # Add padding: len must be multiple of 4
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)


def _get_secret() -> bytes:
    """Return TABLE_TOKEN_SECRET as bytes. Fails loudly if unconfigured."""
    secret = settings.TABLE_TOKEN_SECRET
    if not secret or len(secret) < 32:
        raise RuntimeError(
            "TABLE_TOKEN_SECRET must be set to at least 32 characters. "
            "Set TABLE_TOKEN_SECRET in your environment before starting the server."
        )
    return secret.encode("utf-8")


# ── Public API ────────────────────────────────────────────────────────────────

def issue_table_token(
    *,
    session_id: int,
    table_id: int,
    diner_id: int,
    branch_id: int,
    tenant_id: int,
) -> str:
    """
    Issue a stateless HMAC-SHA256 table token for a diner.

    Format: "{b64_payload}.{b64_signature}"

    The payload is a JSON object with sort_keys=True (canonical form).
    The signature is HMAC-SHA256 over the b64_payload string (not the raw JSON).
    """
    iat = int(time.time())
    exp = iat + settings.TABLE_TOKEN_TTL_SECONDS

    payload = {
        "branch_id": branch_id,
        "diner_id": diner_id,
        "exp": exp,
        "iat": iat,
        "session_id": session_id,
        "table_id": table_id,
        "tenant_id": tenant_id,
    }

    # Canonical JSON — sort_keys ensures deterministic output
    payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    b64_payload = _b64url_encode(payload_json)

    # HMAC over the b64_payload string (as bytes)
    secret = _get_secret()
    signature = hmac.new(secret, b64_payload.encode("ascii"), hashlib.sha256).digest()
    b64_signature = _b64url_encode(signature)

    return f"{b64_payload}.{b64_signature}"


class AuthenticationError(Exception):
    """Raised when token verification fails — includes an error code string."""

    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


def verify_table_token(token: str) -> dict:
    """
    Verify a table token and return the decoded payload dict.

    Raises:
      AuthenticationError("invalid_table_token") — malformed or signature mismatch
      AuthenticationError("expired_token")         — token has passed its exp claim
    """
    try:
        parts = token.split(".")
        if len(parts) != 2:
            raise AuthenticationError("invalid_table_token", "Token must have exactly two parts")

        b64_payload, b64_signature = parts

        # Re-compute expected signature
        secret = _get_secret()
        expected_sig = hmac.new(
            secret, b64_payload.encode("ascii"), hashlib.sha256
        ).digest()
        expected_b64_sig = _b64url_encode(expected_sig)

        # Constant-time comparison — prevents timing attacks
        if not hmac.compare_digest(expected_b64_sig, b64_signature):
            raise AuthenticationError("invalid_table_token", "Signature mismatch")

        # Decode payload
        payload_bytes = _b64url_decode(b64_payload)
        payload = json.loads(payload_bytes.decode("utf-8"))

    except AuthenticationError:
        raise
    except Exception as exc:
        logger.debug("table_token decode error: %s", exc)
        raise AuthenticationError("invalid_table_token", f"Malformed token: {exc}")

    # Check expiry
    exp = payload.get("exp")
    if exp is None or int(time.time()) > exp:
        raise AuthenticationError("expired_token", "Token has expired")

    return payload


# ── TableContext dataclass ────────────────────────────────────────────────────

@dataclass
class TableContext:
    """
    Analogous to PermissionContext for staff — holds the verified diner session.

    Populated by current_table_context dependency after token verification
    and live DB lookup. Ensures every diner endpoint starts from an active session.
    """
    session: "TableSession"
    table: "Table"
    branch: "Branch"
    diner_id: int
    tenant_id: int
    branch_id: int


# ── FastAPI dependency ────────────────────────────────────────────────────────

async def _get_db_lazy():
    """Lazy DB dependency so importing this module doesn't require sqlalchemy."""
    from shared.infrastructure.db import get_db
    async for db in get_db():
        yield db


async def current_table_context(
    x_table_token: str = Header(..., alias="X-Table-Token"),
    db=Depends(_get_db_lazy),
) -> "TableContext":
    """
    FastAPI dependency — verify the X-Table-Token header and load the live session.

    Flow:
      1. Verify HMAC signature (raises 401 on failure)
      2. Check expiry (raises 401 with expired_token code)
      3. Load TableSession from DB with Table + Branch eagerly joined
      4. Reject if session missing, soft-deleted, or status=CLOSED
      5. Return TableContext

    Raises HTTP 401 on any verification failure.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import joinedload
    from rest_api.models.table_session import TableSession
    from rest_api.models.sector import Table
    from rest_api.models.branch import Branch

    # Step 1 & 2 — verify token
    try:
        payload = verify_table_token(x_table_token)
    except AuthenticationError as exc:
        logger.debug("current_table_context: token rejected code=%s", exc.code)
        raise HTTPException(
            status_code=401,
            detail=exc.code,
            headers={"WWW-Authenticate": f'Bearer realm="table", error="{exc.code}"'},
        )

    session_id: int = payload["session_id"]
    diner_id: int = payload["diner_id"]
    tenant_id: int = payload["tenant_id"]
    branch_id: int = payload["branch_id"]

    # Step 3 — load session with eager-loaded table and branch
    result = await db.execute(
        select(TableSession)
        .options(
            joinedload(TableSession.table).joinedload(Table.branch)
        )
        .where(TableSession.id == session_id)
    )
    session = result.scalar_one_or_none()

    # Step 4 — validate session is live
    if session is None or not session.is_active:
        raise HTTPException(
            status_code=401,
            detail="invalid_table_token",
            headers={"WWW-Authenticate": 'Bearer realm="table", error="invalid_table_token"'},
        )

    if session.status == "CLOSED":
        raise HTTPException(
            status_code=401,
            detail="session_closed",
            headers={"WWW-Authenticate": 'Bearer realm="table", error="session_closed"'},
        )

    table = session.table
    branch = table.branch

    return TableContext(
        session=session,
        table=table,
        branch=branch,
        diner_id=diner_id,
        tenant_id=tenant_id,
        branch_id=branch_id,
    )
