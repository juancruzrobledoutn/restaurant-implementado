"""
Project-wide constants: roles, round statuses, and role sets.

Usage:
    from shared.config.constants import UserRole, RoundStatus, MANAGEMENT_ROLES
"""
from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    KITCHEN = "KITCHEN"
    WAITER = "WAITER"


class RoundStatus(StrEnum):
    """
    Canonical state machine for rounds (C-10).

    Flow: PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED
    CANCELED is reachable from any non-terminal state.
    SERVED and CANCELED are terminal (no further transitions).
    """

    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    SUBMITTED = "SUBMITTED"
    IN_KITCHEN = "IN_KITCHEN"
    READY = "READY"
    SERVED = "SERVED"
    CANCELED = "CANCELED"


# Roles that have management access (used in RBAC checks throughout the codebase)
MANAGEMENT_ROLES: frozenset[str] = frozenset({UserRole.ADMIN, UserRole.MANAGER})

# All roles — useful for validation
ALL_ROLES: frozenset[str] = frozenset(UserRole)

# Alias for convenience — seed and services can use Roles.ADMIN, Roles.MANAGER, etc.
Roles = UserRole

# Round statuses that the kitchen can see (spec: never PENDING or CONFIRMED)
KITCHEN_VISIBLE_STATUSES: frozenset[str] = frozenset(
    {RoundStatus.SUBMITTED, RoundStatus.IN_KITCHEN, RoundStatus.READY}
)

# Round statuses from which void-item is allowed
VOID_ITEM_ALLOWED_STATUSES: frozenset[str] = frozenset(
    {RoundStatus.SUBMITTED, RoundStatus.IN_KITCHEN, RoundStatus.READY}
)

# Terminal round states (no further transitions from these)
ROUND_TERMINAL_STATUSES: frozenset[str] = frozenset(
    {RoundStatus.SERVED, RoundStatus.CANCELED}
)


class KitchenTicketStatus(StrEnum):
    """
    Kitchen ticket state machine (C-11).

    Flow: IN_PROGRESS → READY → DELIVERED
    Tickets are created when a round transitions CONFIRMED → SUBMITTED,
    and they shadow the kitchen-visible slice of the round's state. A
    round canceled from SUBMITTED+ soft-deletes its ticket instead of
    adding a CANCELED state to this FSM.
    """

    IN_PROGRESS = "IN_PROGRESS"
    READY = "READY"
    DELIVERED = "DELIVERED"


class ServiceCallStatus(StrEnum):
    """
    Service call state machine (C-11).

    Flow: CREATED → ACKED → CLOSED (ACKED is optional — CREATED can go
    directly to CLOSED if the waiter closes without an intermediate ack).
    """

    CREATED = "CREATED"
    ACKED = "ACKED"
    CLOSED = "CLOSED"


# Open (non-CLOSED) service-call statuses — used by the duplicate-guard
# query in ServiceCallService.create().
SERVICE_CALL_OPEN_STATUSES: frozenset[str] = frozenset(
    {ServiceCallStatus.CREATED, ServiceCallStatus.ACKED}
)


class CheckStatus(StrEnum):
    """
    Billing check state machine (C-12).

    Flow: REQUESTED → PAID
    """

    REQUESTED = "REQUESTED"
    PAID = "PAID"


class PaymentStatus(StrEnum):
    """
    Payment state machine (C-12).

    Flow: PENDING → APPROVED | REJECTED
    """

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class SessionStatus(StrEnum):
    """
    Table session state machine (C-08, extended in C-12).

    Flow: OPEN → PAYING → CLOSED
    """

    OPEN = "OPEN"
    PAYING = "PAYING"
    CLOSED = "CLOSED"


class BillingEventType(StrEnum):
    """
    Outbox event types for financial operations (C-12).

    All financial events use the Outbox pattern (at-least-once).
    """

    CHECK_REQUESTED = "CHECK_REQUESTED"
    CHECK_PAID = "CHECK_PAID"
    PAYMENT_APPROVED = "PAYMENT_APPROVED"
    PAYMENT_REJECTED = "PAYMENT_REJECTED"
