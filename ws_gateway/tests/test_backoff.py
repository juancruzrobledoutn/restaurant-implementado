"""
Tests for DecorrelatedJitter (ws_gateway/components/resilience/backoff.py).

Covered scenarios:
  - Delay stays within [base, cap] bounds
  - Monotonic increase on average (not strictly — it's randomized)
  - Reset brings back to initial behavior
  - cap is respected even when prev * 3 exceeds it
"""
import pytest

from ws_gateway.components.resilience.backoff import DecorrelatedJitter


@pytest.fixture
def jitter() -> DecorrelatedJitter:
    return DecorrelatedJitter(base=1.0, cap=30.0)


# ── Basic bounds ──────────────────────────────────────────────────────────────

def test_first_delay_within_bounds(jitter):
    delay = jitter.next_delay()
    assert 1.0 <= delay <= 30.0


def test_delays_always_respect_cap(jitter):
    """Run many iterations — every delay must stay <= cap."""
    for _ in range(100):
        delay = jitter.next_delay()
        assert delay <= jitter.cap, f"Delay {delay} exceeds cap {jitter.cap}"


def test_delays_always_respect_base(jitter):
    """Every delay must be >= base."""
    for _ in range(100):
        delay = jitter.next_delay()
        assert delay >= jitter.base, f"Delay {delay} below base {jitter.base}"


# ── Cap enforcement ───────────────────────────────────────────────────────────

def test_cap_is_hard_limit():
    """When prev gets large, the cap must still be the upper bound."""
    j = DecorrelatedJitter(base=1.0, cap=5.0)
    # Manually set _prev to a large value
    j._prev = 1000.0
    for _ in range(50):
        delay = j.next_delay()
        assert delay <= 5.0, f"Cap exceeded: {delay}"


# ── Reset behavior ────────────────────────────────────────────────────────────

def test_reset_returns_to_base_range():
    """After reset, the first delay should be close to base (random_uniform(base, base*3))."""
    j = DecorrelatedJitter(base=1.0, cap=30.0)
    # Exhaust a few delays to inflate _prev
    for _ in range(10):
        j.next_delay()
    j.reset()
    # After reset, _prev == base, so next delay in [base, min(cap, base*3)]
    delay = j.next_delay()
    assert delay <= 3.0 + 0.001, f"After reset, delay {delay} should be <= base*3 = 3.0"


# ── Error handling ────────────────────────────────────────────────────────────

def test_invalid_base_raises():
    with pytest.raises(ValueError, match="base must be positive"):
        DecorrelatedJitter(base=0, cap=10.0)


def test_cap_less_than_base_raises():
    with pytest.raises(ValueError, match="cap"):
        DecorrelatedJitter(base=5.0, cap=2.0)


# ── Statistical property: average grows over attempts ─────────────────────────

def test_average_delay_grows_from_base():
    """
    The decorrelated jitter algorithm should produce delays that on average
    grow beyond base for the first few calls.
    """
    j = DecorrelatedJitter(base=1.0, cap=30.0)
    first_5 = [j.next_delay() for _ in range(5)]
    last_5_after_20 = [j.next_delay() for _ in range(20)][-5:]
    # Average of later delays should be >= average of earlier delays (probabilistic)
    assert sum(last_5_after_20) / 5 >= sum(first_5) / 5 - 1.0  # loose bound
