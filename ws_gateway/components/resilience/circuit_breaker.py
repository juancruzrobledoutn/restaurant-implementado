"""
Circuit Breaker — thread-safe state machine for protecting Redis calls.

States:
  CLOSED    → normal operation; failures are counted.
  OPEN      → fast-fail; no calls attempted for recovery_timeout seconds.
  HALF_OPEN → probe mode after recovery; single success closes, single failure re-opens.

Usage:
    breaker = CircuitBreaker(name="redis_pubsub")
    if breaker.can_execute():
        try:
            result = await redis_call()
            breaker.record_success()
        except Exception:
            breaker.record_failure()
    else:
        # skip or degrade gracefully
        pass

One instance per logical resource is recommended:
  - redis_pubsub_breaker
  - redis_stream_breaker
  - redis_catchup_breaker
"""
from __future__ import annotations

import threading
import time
from enum import Enum

from ws_gateway.core.logger import get_logger

logger = get_logger(__name__)


class BreakerState(str, Enum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


class CircuitBreaker:
    """
    Thread-safe circuit breaker.

    Args:
        name: Human-readable identifier for logs and metrics.
        failure_threshold: Consecutive failures before tripping OPEN.
        recovery_timeout: Seconds to wait in OPEN before probing (HALF_OPEN).
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout

        self._lock = threading.Lock()
        self._state: BreakerState = BreakerState.CLOSED
        self._failure_count: int = 0
        self._last_failure_time: float = 0.0

        # Metrics
        self.state_changes: int = 0
        self.rejected_calls: int = 0

    # ── Public API ────────────────────────────────────────────────────────────

    @property
    def state(self) -> BreakerState:
        """Return the current state (may trigger OPEN → HALF_OPEN transition)."""
        with self._lock:
            return self._get_state_locked()

    def can_execute(self) -> bool:
        """
        Return True if the caller may attempt the protected operation.

        Side-effect: transitions OPEN → HALF_OPEN when recovery_timeout elapses.
        """
        with self._lock:
            state = self._get_state_locked()
            if state == BreakerState.OPEN:
                self.rejected_calls += 1
                return False
            return True  # CLOSED or HALF_OPEN

    def record_success(self) -> None:
        """Record a successful call. Resets counter; closes from HALF_OPEN."""
        with self._lock:
            state = self._get_state_locked()
            if state == BreakerState.HALF_OPEN:
                logger.info("CircuitBreaker[%s]: probe succeeded → CLOSED", self.name)
                self._transition(BreakerState.CLOSED)
            self._failure_count = 0

    def record_failure(self) -> None:
        """
        Record a failed call.
        - In CLOSED: increment counter; trip to OPEN at threshold.
        - In HALF_OPEN: immediately revert to OPEN.
        """
        with self._lock:
            state = self._get_state_locked()
            self._last_failure_time = time.monotonic()

            if state == BreakerState.HALF_OPEN:
                logger.warning("CircuitBreaker[%s]: probe failed → OPEN", self.name)
                self._transition(BreakerState.OPEN)
                self._failure_count = self.failure_threshold
                return

            # CLOSED path
            self._failure_count += 1
            if self._failure_count >= self.failure_threshold:
                logger.warning(
                    "CircuitBreaker[%s]: %d consecutive failures → OPEN",
                    self.name,
                    self._failure_count,
                )
                self._transition(BreakerState.OPEN)

    def get_metrics(self) -> dict:
        """Return a snapshot of current metrics for health/metrics endpoints."""
        with self._lock:
            return {
                "name": self.name,
                "state": self._get_state_locked().value,
                "failure_count": self._failure_count,
                "state_changes": self.state_changes,
                "rejected_calls": self.rejected_calls,
            }

    # ── Internal ──────────────────────────────────────────────────────────────

    def _get_state_locked(self) -> BreakerState:
        """Must be called with self._lock held. Auto-transitions OPEN → HALF_OPEN."""
        if self._state == BreakerState.OPEN:
            elapsed = time.monotonic() - self._last_failure_time
            if elapsed >= self.recovery_timeout:
                logger.info(
                    "CircuitBreaker[%s]: recovery timeout elapsed (%.1fs) → HALF_OPEN",
                    self.name,
                    elapsed,
                )
                self._transition(BreakerState.HALF_OPEN)
        return self._state

    def _transition(self, new_state: BreakerState) -> None:
        """Must be called with self._lock held."""
        if self._state != new_state:
            self._state = new_state
            self.state_changes += 1
