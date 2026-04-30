"""
Tests for HeartbeatTracker (ws_gateway/components/connection/heartbeat.py).

Covered scenarios:
  - update() sets last_seen
  - is_stale() returns True after timeout
  - is_stale() returns False when recent
  - cleanup_stale() returns only stale connections
  - Any message (not just ping) resets the timer
  - Unregistered connection is stale by default
"""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from ws_gateway.components.connection.heartbeat import HeartbeatTracker


@pytest.fixture
def tracker() -> HeartbeatTracker:
    return HeartbeatTracker()


# ── Basic operations ──────────────────────────────────────────────────────────

def test_register_marks_connection_as_active(tracker):
    tracker.register("conn-1")
    assert not tracker.is_stale("conn-1", timeout=60)


def test_update_resets_last_seen(tracker):
    tracker.register("conn-1")
    # Move time forward 50s then update
    with patch("ws_gateway.components.connection.heartbeat.time") as mock_time:
        mock_time.monotonic.return_value = 1000.0
        tracker.update("conn-1")
        mock_time.monotonic.return_value = 1055.0  # 55s later
        assert not tracker.is_stale("conn-1", timeout=60)


def test_is_stale_returns_true_after_timeout(tracker):
    tracker.register("conn-stale")
    with patch("ws_gateway.components.connection.heartbeat.time") as mock_time:
        mock_time.monotonic.return_value = 0.0
        tracker._last_seen["conn-stale"] = 0.0
        mock_time.monotonic.return_value = 61.0  # 61s later
        assert tracker.is_stale("conn-stale", timeout=60)


def test_is_stale_returns_false_when_recent(tracker):
    with patch("ws_gateway.components.connection.heartbeat.time") as mock_time:
        mock_time.monotonic.return_value = 100.0
        tracker.register("conn-fresh")
        mock_time.monotonic.return_value = 130.0  # 30s later (within 60s timeout)
        assert not tracker.is_stale("conn-fresh", timeout=60)


def test_unregistered_connection_is_stale(tracker):
    assert tracker.is_stale("conn-never-seen", timeout=60)


# ── cleanup_stale ─────────────────────────────────────────────────────────────

def test_cleanup_stale_returns_only_stale(tracker):
    with patch("ws_gateway.components.connection.heartbeat.time") as mock_time:
        mock_time.monotonic.return_value = 0.0
        tracker.register("stale-1")
        tracker.register("stale-2")
        tracker.register("fresh-1")

        mock_time.monotonic.return_value = 65.0
        tracker._last_seen["fresh-1"] = 65.0  # fresh

        stale = tracker.cleanup_stale(timeout=60)

    assert "stale-1" in stale
    assert "stale-2" in stale
    assert "fresh-1" not in stale


def test_cleanup_stale_returns_empty_when_all_fresh(tracker):
    tracker.register("conn-1")
    stale = tracker.cleanup_stale(timeout=60)
    assert stale == []


def test_unregister_removes_from_tracking(tracker):
    tracker.register("conn-1")
    tracker.unregister("conn-1")
    assert "conn-1" not in tracker._last_seen


# ── Any message resets timer ──────────────────────────────────────────────────

def test_any_message_resets_heartbeat_timer(tracker):
    """Sending ANY message (not just ping) resets the stale timer."""
    with patch("ws_gateway.components.connection.heartbeat.time") as mock_time:
        mock_time.monotonic.return_value = 0.0
        tracker.register("conn-1")

        # Move time to 55s (still within 60s timeout)
        mock_time.monotonic.return_value = 55.0
        tracker.update("conn-1")  # non-ping message updates heartbeat

        # Now at 110s from start, but only 55s since update
        mock_time.monotonic.return_value = 110.0
        assert not tracker.is_stale("conn-1", timeout=60)
