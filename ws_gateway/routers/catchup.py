"""
HTTP endpoints for event catch-up.

Endpoints:
  GET /ws/catchup?branch_id=&since=
    - JWT auth via Authorization: Bearer header (staff: waiter, manager, admin)
    - Returns events for branch since timestamp_ms
    - 403 if branch_id not in user's branch_ids
    - 410 if since is older than TTL window

  GET /ws/catchup/session?session_id=&since=&table_token=
    - Table Token auth (diners)
    - Returns events for session since timestamp_ms (diner-safe whitelist)
    - 403 if session_id != token.session_id
    - 401 if token invalid

These endpoints live in the ws_gateway service (port 8001) because the Gateway
owns the catchup:* keyspace. Clients use VITE_WS_URL (with http scheme) for these.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ws_gateway.core.constants import CATCHUP_BRANCH_KEY, CATCHUP_SESSION_KEY, DINER_EVENT_WHITELIST_PREFIXES
from ws_gateway.core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/ws")


@router.get("/catchup")
async def get_catchup_branch(
    request: Request,
    branch_id: int = Query(...),
    since: int = Query(..., description="timestamp_ms — return events after this"),
):
    """
    Staff catch-up: return branch events since `since` timestamp_ms.

    Auth: JWT Bearer via Authorization header.
    Authorization: branch_id must be in user's branch_ids.
    """
    from ws_gateway.core.dependencies import get_redis_pool, get_settings
    from shared.security.auth import verify_jwt

    settings = get_settings()
    redis = get_redis_pool()

    # Step 1: extract and verify JWT from Authorization header
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or malformed Authorization header. Expected: 'Bearer <token>'",
        )
    token = auth_header[len("Bearer "):]

    try:
        payload = verify_jwt(token, expected_type="access")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")

    # Step 2: branch authorization
    user_branch_ids: list[int] = payload.get("branch_ids", [])
    if branch_id not in user_branch_ids:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied to branch {branch_id}",
        )

    # Step 3: fetch events from sorted set
    key = CATCHUP_BRANCH_KEY.format(branch_id)
    raw_events = await redis.zrangebyscore(key, min=since, max="+inf")

    # Step 4: check if `since` is too old (410 Gone)
    if not raw_events:
        # Check if the key has any events at all
        min_score_items = await redis.zrange(key, 0, 0, withscores=True)
        if min_score_items:
            min_score = min_score_items[0][1]
            if since < min_score:
                raise HTTPException(
                    status_code=410,
                    detail="Requested `since` is older than available catch-up window. "
                    "Perform a full reload.",
                )

    events = _parse_events(raw_events)
    return {"events": events, "count": len(events)}


@router.get("/catchup/session")
async def get_catchup_session(
    session_id: int = Query(...),
    since: int = Query(..., description="timestamp_ms — return events after this"),
    table_token: str = Query(...),
):
    """
    Diner catch-up: return session events since `since` timestamp_ms.

    Auth: Table Token HMAC.
    Authorization: session_id must match token.session_id.
    Filtering: only DINER_EVENT_WHITELIST_PREFIXES events are returned.
    """
    from ws_gateway.core.dependencies import get_redis_pool
    from shared.security.table_token import verify_table_token, AuthenticationError

    redis = get_redis_pool()

    # Step 1: verify Table Token
    try:
        token_payload = verify_table_token(table_token)
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    # Step 2: session authorization
    token_session_id: int = token_payload["session_id"]
    if session_id != token_session_id:
        raise HTTPException(
            status_code=403,
            detail="session_id does not match your token",
        )

    # Step 3: fetch events
    key = CATCHUP_SESSION_KEY.format(session_id)
    raw_events = await redis.zrangebyscore(key, min=since, max="+inf")

    # Step 4: 410 check
    if not raw_events:
        min_score_items = await redis.zrange(key, 0, 0, withscores=True)
        if min_score_items:
            min_score = min_score_items[0][1]
            if since < min_score:
                raise HTTPException(
                    status_code=410,
                    detail="Requested `since` is older than available catch-up window.",
                )

    # Step 5: whitelist filter for diners
    all_events = _parse_events(raw_events)
    filtered = [
        e for e in all_events
        if _is_diner_visible(e.get("event_type", ""))
    ]

    return {"events": filtered, "count": len(filtered)}


def _parse_events(raw: list[str]) -> list[dict]:
    """Parse a list of JSON strings into dicts, skipping malformed entries."""
    events = []
    for item in raw:
        try:
            events.append(json.loads(item))
        except (json.JSONDecodeError, TypeError):
            logger.warning("Catchup: skipping malformed event item")
    return events


def _is_diner_visible(event_type: str) -> bool:
    """Check if an event type is in the diner whitelist."""
    return any(event_type.startswith(prefix) for prefix in DINER_EVENT_WHITELIST_PREFIXES)
