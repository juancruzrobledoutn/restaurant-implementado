"""
EventRouter — routes incoming events to the correct WebSocket connections.

EventCategory enum defines the 5 routing categories. Each category maps to
a different fan-out strategy:
  - KITCHEN_EVENTS         → connections with KITCHEN/MANAGER/ADMIN role on the branch
  - SESSION_EVENTS         → diner connections for the specific session_id
  - ADMIN_ONLY_EVENTS      → connections with ADMIN/MANAGER role on the branch
  - BRANCH_WIDE_WAITER_EVENTS → all WAITER/MANAGER/ADMIN connections on the branch
  - SECTOR_EVENTS          → WAITER connections in the specific sector + ADMIN/MANAGER

Registry:
  In C-09 the registry is EMPTY. No real event types are registered here.
  Real event types are added in C-10 (rounds), C-11 (kitchen), C-12 (billing),
  C-13 (service calls). Only synthetic test events use register_event() in tests.

  ╔═══════════════════════════════════════════════════════════════════╗
  ║  DO NOT ADD real event types (ROUND_*, CHECK_*, etc.) here.       ║
  ║  That is intentional scope control for C-09. Add them in the      ║
  ║  change that introduces the domain feature.                        ║
  ╚═══════════════════════════════════════════════════════════════════╝

Catch-up integration:
  route() calls CatchupPublisher.publish_for_catchup() BEFORE broadcast,
  so events are stored even if the broadcast fails.
"""
from __future__ import annotations

import json
from enum import Enum
from typing import TYPE_CHECKING

from ws_gateway.core.logger import get_logger

if TYPE_CHECKING:
    from ws_gateway.components.connection.manager import ConnectionManager
    from ws_gateway.components.events.catchup_publisher import CatchupPublisher

logger = get_logger(__name__)


class EventCategory(str, Enum):
    KITCHEN_EVENTS = "KITCHEN_EVENTS"
    SESSION_EVENTS = "SESSION_EVENTS"
    ADMIN_ONLY_EVENTS = "ADMIN_ONLY_EVENTS"
    BRANCH_WIDE_WAITER_EVENTS = "BRANCH_WIDE_WAITER_EVENTS"
    SECTOR_EVENTS = "SECTOR_EVENTS"


class EventRouter:
    """
    Routes events to the correct connections based on category and tenant isolation.

    Args:
        conn_manager: ConnectionManager facade for fan-out.
        catchup_publisher: CatchupPublisher for event persistence (may be None in tests).
    """

    def __init__(
        self,
        conn_manager: "ConnectionManager",
        catchup_publisher: "CatchupPublisher | None" = None,
    ) -> None:
        self._conn_manager = conn_manager
        self._catchup = catchup_publisher
        # In C-09 this registry STARTS EMPTY.
        # Use register_event() in C-10+ changes to populate it.
        self._registry: dict[str, EventCategory] = {}

    def register_event(self, event_type: str, category: EventCategory) -> None:
        """
        Register an event type → routing category mapping.

        Called during application startup (or in change-specific init code).
        In C-09 this is called ONLY from test fixtures with synthetic event types.
        Real event types (ROUND_*, CHECK_*, etc.) are registered in C-10+.

        Example (from C-10):
            router.register_event("ROUND_SUBMITTED", EventCategory.KITCHEN_EVENTS)
            router.register_event("ROUND_CONFIRMED", EventCategory.KITCHEN_EVENTS)
        """
        self._registry[event_type] = category
        logger.debug("EventRouter: registered %s → %s", event_type, category)

    async def route(self, event: dict) -> None:
        """
        Route an event to the appropriate connections.

        Flow:
          1. Persist to catchup sorted sets (BEFORE broadcast — survivability first).
          2. Validate required fields.
          3. Look up category from registry.
          4. Fan-out to connections based on category + _allowed_to_receive filter.

        Unknown event_type → warn + drop (expected in C-09 since registry is empty).
        """
        # Step 1: catchup persistence
        if self._catchup:
            try:
                await self._catchup.publish_for_catchup(event)
            except Exception as exc:
                logger.error("EventRouter: catchup persistence failed: %s", exc)

        # Step 2: validate minimum schema
        event_type = event.get("event_type")
        tenant_id = event.get("tenant_id")
        branch_id = event.get("branch_id")

        if not event_type or tenant_id is None or branch_id is None:
            logger.warning(
                "EventRouter: malformed event (missing event_type/tenant_id/branch_id): %s",
                str(event)[:200],
            )
            return

        # Step 3: category lookup
        category = self._registry.get(event_type)
        if category is None:
            logger.warning(
                "EventRouter: unknown event_type=%s — dropping. "
                "(If this is a C-10+ event, register it in the appropriate change.)",
                event_type,
            )
            return

        # Step 4: fan-out
        await self._dispatch(event, category, tenant_id, branch_id)

    async def _dispatch(
        self,
        event: dict,
        category: EventCategory,
        tenant_id: int,
        branch_id: int,
    ) -> None:
        """Select connections and broadcast based on category."""
        index = self._conn_manager.index
        session_id = event.get("session_id")
        sector_id = event.get("sector_id")

        if category == EventCategory.KITCHEN_EVENTS:
            await self._conn_manager.broadcast_to_kitchen(tenant_id, branch_id, event)

        elif category == EventCategory.ADMIN_ONLY_EVENTS:
            await self._conn_manager.broadcast_to_admin_only(tenant_id, branch_id, event)

        elif category == EventCategory.BRANCH_WIDE_WAITER_EVENTS:
            # All WAITER/MANAGER/ADMIN on the branch
            waiter_roles = {"WAITER", "MANAGER", "ADMIN"}
            conns = frozenset(
                c for c in index.get_by_branch(tenant_id, branch_id)
                if set(c.auth.roles) & waiter_roles
            )
            await self._conn_manager._broadcaster.broadcast(conns, event)

        elif category == EventCategory.SESSION_EVENTS:
            if session_id is None:
                logger.warning("EventRouter: SESSION_EVENTS missing session_id — dropping")
                return
            await self._conn_manager.broadcast_to_session(session_id, event)

        elif category == EventCategory.SECTOR_EVENTS:
            if sector_id is None:
                logger.warning("EventRouter: SECTOR_EVENTS missing sector_id — dropping")
                return
            conns = frozenset(
                c for c in index.get_by_branch(tenant_id, branch_id)
                if self._allowed_to_receive_sector(c, sector_id)
            )
            await self._conn_manager._broadcaster.broadcast(conns, event)

    @staticmethod
    def _allowed_to_receive_sector(conn, sector_id: int) -> bool:
        """
        Sector event permission check:
          - WAITER: must have sector_id in their sector_ids
          - ADMIN/MANAGER: always allowed
        """
        roles = set(conn.auth.roles)
        if roles & {"ADMIN", "MANAGER"}:
            return True
        if "WAITER" in roles and sector_id in conn.auth.sector_ids:
            return True
        return False
