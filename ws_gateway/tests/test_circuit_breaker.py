"""
Tests for CircuitBreaker (ws_gateway/components/resilience/circuit_breaker.py).

Covered scenarios:
  - 5 consecutive failures → OPEN
  - During OPEN: can_execute() returns False
  - After recovery_timeout: HALF_OPEN on next can_execute()
  - Success in HALF_OPEN → CLOSED + reset counter
  - Failure in HALF_OPEN → OPEN again
  - Thread-safety: multiple threads calling record_failure() concurrently
"""
import threading
import time

import pytest

from ws_gateway.components.resilience.circuit_breaker import BreakerState, CircuitBreaker


@pytest.fixture
def breaker() -> CircuitBreaker:
    """Fresh CircuitBreaker with threshold=5, recovery=30s."""
    return CircuitBreaker(name="test", failure_threshold=5, recovery_timeout=30.0)


@pytest.fixture
def fast_breaker() -> CircuitBreaker:
    """CircuitBreaker with very short recovery for timing tests."""
    return CircuitBreaker(name="fast", failure_threshold=5, recovery_timeout=0.05)


# ── State transitions ─────────────────────────────────────────────────────────

def test_initial_state_is_closed(breaker):
    assert breaker.state == BreakerState.CLOSED


def test_five_failures_open_breaker(breaker):
    for _ in range(5):
        breaker.record_failure()
    assert breaker.state == BreakerState.OPEN


def test_four_failures_stay_closed(breaker):
    for _ in range(4):
        breaker.record_failure()
    assert breaker.state == BreakerState.CLOSED


def test_open_breaker_rejects_can_execute(breaker):
    for _ in range(5):
        breaker.record_failure()
    assert not breaker.can_execute()


def test_closed_breaker_allows_can_execute(breaker):
    assert breaker.can_execute()


def test_after_recovery_timeout_transitions_to_half_open(fast_breaker):
    for _ in range(5):
        fast_breaker.record_failure()
    assert fast_breaker.state == BreakerState.OPEN

    # Wait longer than recovery_timeout (0.05s)
    time.sleep(0.1)
    # can_execute triggers the OPEN → HALF_OPEN transition
    result = fast_breaker.can_execute()
    assert result is True
    assert fast_breaker.state == BreakerState.HALF_OPEN


def test_success_in_half_open_closes_breaker(fast_breaker):
    for _ in range(5):
        fast_breaker.record_failure()
    time.sleep(0.1)
    fast_breaker.can_execute()  # triggers HALF_OPEN
    assert fast_breaker.state == BreakerState.HALF_OPEN

    fast_breaker.record_success()
    assert fast_breaker.state == BreakerState.CLOSED
    assert fast_breaker._failure_count == 0


def test_failure_in_half_open_reopens_breaker(fast_breaker):
    for _ in range(5):
        fast_breaker.record_failure()
    time.sleep(0.1)
    fast_breaker.can_execute()  # HALF_OPEN
    fast_breaker.record_failure()
    assert fast_breaker.state == BreakerState.OPEN


def test_success_in_closed_resets_counter(breaker):
    for _ in range(3):
        breaker.record_failure()
    breaker.record_success()
    assert breaker._failure_count == 0
    assert breaker.state == BreakerState.CLOSED


# ── Metrics ───────────────────────────────────────────────────────────────────

def test_state_changes_counter(fast_breaker):
    initial = fast_breaker.state_changes
    for _ in range(5):
        fast_breaker.record_failure()
    assert fast_breaker.state_changes == initial + 1  # CLOSED → OPEN

    time.sleep(0.1)
    fast_breaker.can_execute()  # OPEN → HALF_OPEN
    assert fast_breaker.state_changes == initial + 2

    fast_breaker.record_success()  # HALF_OPEN → CLOSED
    assert fast_breaker.state_changes == initial + 3


def test_rejected_calls_counter(breaker):
    for _ in range(5):
        breaker.record_failure()
    for _ in range(3):
        breaker.can_execute()
    assert breaker.rejected_calls == 3


def test_get_metrics_structure(breaker):
    metrics = breaker.get_metrics()
    assert metrics["name"] == "test"
    assert metrics["state"] == "CLOSED"
    assert "failure_count" in metrics
    assert "state_changes" in metrics
    assert "rejected_calls" in metrics


# ── Thread-safety ─────────────────────────────────────────────────────────────

def test_concurrent_record_failure_thread_safety():
    """
    Multiple threads calling record_failure() concurrently must not lose counts
    or cause race conditions. The breaker must end in OPEN state.
    """
    breaker = CircuitBreaker(name="threaded", failure_threshold=50, recovery_timeout=30.0)
    errors: list[Exception] = []

    def fail_10():
        try:
            for _ in range(10):
                breaker.record_failure()
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=fail_10) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    assert not errors, f"Thread errors: {errors}"
    # 5 threads × 10 failures = 50 ≥ threshold(50) → OPEN
    assert breaker.state == BreakerState.OPEN
    assert breaker._failure_count >= 50
