"""
Tests for ConnectionBroadcaster (ws_gateway/components/connection/broadcaster.py).

Covered scenarios:
  - Broadcast to 100 connections → all receive
  - Slow consumer (>5.5s) → marked dead, others delivered
  - Queue full → fallback activated, all delivered
  - stop_workers() drains queue and terminates
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

from ws_gateway.components.connection.broadcaster import (
    BroadcastObserver,
    ConnectionBroadcaster,
)


def make_conn(delay: float = 0.0, fail: bool = False) -> MagicMock:
    """Build a mock connection whose websocket.send_text has a configurable delay."""
    conn = MagicMock()
    conn.is_dead = False

    async def send(msg):
        if delay > 0:
            await asyncio.sleep(delay)
        if fail:
            raise ConnectionError("broken pipe")

    conn.websocket.send_text = AsyncMock(side_effect=send)
    conn.mark_dead = MagicMock(side_effect=lambda: setattr(conn, "is_dead", True))
    return conn


# ── Basic broadcast ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_broadcast_to_100_connections():
    """All 100 connections receive the message."""
    broadcaster = ConnectionBroadcaster(n_workers=5, queue_size=500)
    await broadcaster.start_workers()

    conns = [make_conn() for _ in range(100)]
    msg = {"type": "test", "data": "hello"}
    await broadcaster.broadcast(frozenset(conns), msg)

    # Wait for workers to process
    await asyncio.sleep(0.5)
    await broadcaster.stop_workers(timeout=2.0)

    for conn in conns:
        conn.websocket.send_text.assert_awaited_once()


@pytest.mark.asyncio
async def test_slow_consumer_marked_dead_others_delivered():
    """
    A connection that takes >5.5s is marked dead.
    Other connections still receive the message.
    """
    broadcaster = ConnectionBroadcaster(n_workers=5, queue_size=200)
    await broadcaster.start_workers()

    fast_conns = [make_conn(delay=0.0) for _ in range(5)]
    slow_conn = make_conn(delay=6.0)  # exceeds BROADCAST_SEND_TIMEOUT=5s

    all_conns = frozenset(fast_conns + [slow_conn])
    await broadcaster.broadcast(all_conns, {"type": "test"})

    # Wait enough for fast conns to complete, slow to timeout
    await asyncio.sleep(6.5)
    await broadcaster.stop_workers(timeout=2.0)

    for conn in fast_conns:
        conn.websocket.send_text.assert_awaited()

    assert slow_conn.is_dead


@pytest.mark.asyncio
async def test_queue_full_activates_fallback():
    """When queue is full, fallback batch mode must deliver messages."""
    # Use tiny queue to force overflow
    broadcaster = ConnectionBroadcaster(n_workers=1, queue_size=1)
    # Don't start workers (so queue fills immediately)

    conns = [make_conn() for _ in range(5)]
    # Override to avoid infinite block — use very small queue
    broadcaster._running = True  # fake running to allow enqueue attempt

    # Fill the queue first
    broadcaster._queue.put_nowait((conns[0], {"type": "pre"}))

    # Now broadcast — queue is full, fallback should activate
    await broadcaster.broadcast(frozenset(conns[1:]), {"type": "fallback"})

    # All should have received via fallback
    for conn in conns[1:]:
        conn.websocket.send_text.assert_awaited()

    broadcaster._running = False


@pytest.mark.asyncio
async def test_stop_workers_drains_queue():
    """stop_workers must complete processing before returning."""
    broadcaster = ConnectionBroadcaster(n_workers=3, queue_size=100)
    await broadcaster.start_workers()

    conns = [make_conn() for _ in range(20)]
    await broadcaster.broadcast(frozenset(conns), {"type": "drain_test"})
    await broadcaster.stop_workers(timeout=3.0)

    # After stop, all enqueued items should have been processed
    assert broadcaster._queue.empty()
