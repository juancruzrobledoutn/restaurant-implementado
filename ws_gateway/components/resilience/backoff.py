"""
Decorrelated Jitter backoff for reconnection retries.

Algorithm (from Marc Brooker's "Exponential Backoff And Jitter"):
  sleep = random_between(base, min(cap, prev_sleep * 3))

This produces decorrelated intervals that avoid the "thundering herd"
problem better than simple jitter on exponential backoff.

Usage:
    jitter = DecorrelatedJitter()
    for attempt in range(max_retries):
        delay = jitter.next_delay()
        await asyncio.sleep(delay)
        # ... try operation
    jitter.reset()  # after success
"""
from __future__ import annotations

import random


class DecorrelatedJitter:
    """
    Decorrelated Jitter backoff calculator.

    Args:
        base: Minimum delay in seconds (floor for first call).
        cap:  Maximum delay in seconds.
    """

    def __init__(self, base: float = 1.0, cap: float = 30.0) -> None:
        if base <= 0:
            raise ValueError(f"base must be positive, got {base}")
        if cap < base:
            raise ValueError(f"cap ({cap}) must be >= base ({base})")
        self.base = base
        self.cap = cap
        self._prev: float = base

    def next_delay(self) -> float:
        """
        Compute the next delay.

        Formula: random_uniform(base, min(cap, prev * 3))
        Jitter is inherent — each call returns a different value even for
        the same attempt number.
        """
        upper = min(self.cap, self._prev * 3)
        delay = random.uniform(self.base, upper)
        self._prev = delay
        return delay

    def reset(self) -> None:
        """Reset state after a successful connection. Call after success."""
        self._prev = self.base
