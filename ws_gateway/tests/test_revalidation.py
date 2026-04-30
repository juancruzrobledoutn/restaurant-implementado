"""
Tests for AuthRevalidator (ws_gateway/components/auth/revalidation.py).

Covered scenarios:
  - Revalidation successful → connection stays open
  - Revalidation fails → connection closed with 4001
  - Interval respected (mock time.monotonic)
"""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ws_gateway.components.auth.revalidation import AuthRevalidator
from ws_gateway.components.auth.strategies import AuthError, AuthResult, NullAuthStrategy


def make_mock_connection(
    strategy=None,
    last_revalidated_offset: float = -400.0,
) -> MagicMock:
    """Build a mock Connection whose revalidation is due."""
    conn = MagicMock()
    conn.is_dead = False
    conn.connection_id = "test-conn-001"
    conn.auth = AuthResult(tenant_id=1, user_id=1, token_type="null")
    conn.last_revalidated_at = time.monotonic() + last_revalidated_offset
    conn.websocket = AsyncMock()
    conn.mark_dead = MagicMock()
    conn._strategy = strategy or NullAuthStrategy()
    return conn


class MockConnectionIndex:
    def __init__(self, connections):
        self._all = set(connections)


@pytest.mark.asyncio
async def test_successful_revalidation_keeps_connection_open():
    strategy = NullAuthStrategy()
    conn = make_mock_connection(strategy=strategy, last_revalidated_offset=-9999.0)

    index = MockConnectionIndex([conn])
    revalidator = AuthRevalidator(conn_index=index, sweep_interval=0.05)

    await revalidator.start()
    await asyncio.sleep(0.1)
    await revalidator.stop()

    conn.mark_dead.assert_not_called()
    conn.websocket.close.assert_not_called()


@pytest.mark.asyncio
async def test_failed_revalidation_closes_connection():
    """When revalidation raises AuthError, connection must be marked dead and closed."""
    failing_strategy = NullAuthStrategy()

    async def fail_revalidate(auth_result):
        raise AuthError("Token expired", close_code=4001)

    failing_strategy.revalidate = fail_revalidate  # type: ignore

    conn = make_mock_connection(strategy=failing_strategy, last_revalidated_offset=-9999.0)
    index = MockConnectionIndex([conn])
    revalidator = AuthRevalidator(conn_index=index, sweep_interval=0.05)

    await revalidator.start()
    await asyncio.sleep(0.15)
    await revalidator.stop()

    conn.mark_dead.assert_called()
    conn.websocket.close.assert_awaited()


@pytest.mark.asyncio
async def test_connection_not_revalidated_before_interval():
    """Connection whose last_revalidated_at is recent should NOT be revalidated."""
    strategy = NullAuthStrategy()
    strategy.revalidate = AsyncMock(return_value=AuthResult(tenant_id=1, token_type="null"))

    # last_revalidated_at is 1 second ago; interval is 9999 → skip
    conn = make_mock_connection(strategy=strategy, last_revalidated_offset=-1.0)
    index = MockConnectionIndex([conn])
    revalidator = AuthRevalidator(conn_index=index, sweep_interval=0.05)

    await revalidator.start()
    await asyncio.sleep(0.15)
    await revalidator.stop()

    # revalidate should NOT have been called
    strategy.revalidate.assert_not_awaited()


@pytest.mark.asyncio
async def test_dead_connection_skipped():
    """Dead connections must not be revalidated."""
    strategy = NullAuthStrategy()
    strategy.revalidate = AsyncMock(return_value=AuthResult(tenant_id=1, token_type="null"))

    conn = make_mock_connection(strategy=strategy, last_revalidated_offset=-9999.0)
    conn.is_dead = True

    index = MockConnectionIndex([conn])
    revalidator = AuthRevalidator(conn_index=index, sweep_interval=0.05)

    await revalidator.start()
    await asyncio.sleep(0.15)
    await revalidator.stop()

    strategy.revalidate.assert_not_awaited()
