"""
ServiceCallService — domain service for diner "llamar al mozo" (C-11).

State machine (see knowledge-base/01-negocio/04_reglas_de_negocio.md and
design.md §D-04, D-05):
  CREATED → ACKED → CLOSED
  CREATED → CLOSED (skipping ACK is valid)

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id — via branch join
  - Routers stay thin — all state-machine logic lives here

Event publication:
  - SERVICE_CALL_CREATED goes through the outbox (at-least-once) —
    OutboxService.write_event is called INSIDE the same transaction as
    the insert (D-04). The background outbox_worker publishes it later.
  - SERVICE_CALL_ACKED and SERVICE_CALL_CLOSED are published via
    publish_event (direct Redis) AFTER commit (best-effort).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from shared.config.constants import (
    SERVICE_CALL_OPEN_STATUSES,
    ServiceCallStatus,
)
from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.infrastructure.events import publish_event
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from rest_api.models.branch import Branch
from rest_api.models.service_call import ServiceCall
from rest_api.models.sector import Table
from rest_api.models.table_session import TableSession
from rest_api.services.domain.outbox_service import OutboxService

logger = get_logger(__name__)


# Publisher type — async (event_type, payload) → None
Publisher = Callable[[str, dict[str, Any]], Awaitable[None]]


def _now() -> datetime:
    return datetime.now(UTC)


class ServiceCallService:
    """
    Domain service for service call lifecycle.

    Tests inject a mock `publisher` to assert direct-Redis calls without
    hitting Redis.
    """

    def __init__(
        self,
        db: AsyncSession,
        publisher: Publisher | None = None,
    ) -> None:
        self._db = db
        self._publisher: Publisher = publisher or publish_event

    # ═══════════════════════════════════════════════════════════════════════
    # Public API — create
    # ═══════════════════════════════════════════════════════════════════════

    async def create(
        self,
        *,
        session_id: int,
        tenant_id: int,
    ) -> ServiceCall:
        """
        Create a new service call for a session.

        Flow:
          1. Load and lock TableSession (validates tenant).
          2. Check for open service call (CREATED or ACKED). Raise
             ConflictError with existing id if found.
          3. Insert new ServiceCall with status=CREATED.
          4. Write SERVICE_CALL_CREATED to the outbox (same transaction).
          5. safe_commit — atomicity.

        Raises:
          NotFoundError: session not found in tenant.
          ConflictError: existing open service call (code: service_call_already_open).
        """
        session = await self._load_session_for_create(
            session_id=session_id, tenant_id=tenant_id
        )

        # Duplicate-guard — same transaction, same session lock.
        existing = await self._find_open_service_call(session_id)
        if existing is not None:
            raise ConflictError(
                f"Ya existe una llamada al mozo abierta (id={existing.id})",
                code="service_call_already_open",
            )

        call = ServiceCall(
            session_id=session.id,
            table_id=session.table_id,
            branch_id=session.branch_id,
            status=ServiceCallStatus.CREATED,
        )
        self._db.add(call)
        await self._db.flush()

        # Write SERVICE_CALL_CREATED to the outbox inside the transaction.
        await OutboxService.write_event(
            db=self._db,
            event_type="SERVICE_CALL_CREATED",
            payload={
                "service_call_id": call.id,
                "session_id": call.session_id,
                "table_id": call.table_id,
                "branch_id": call.branch_id,
                "tenant_id": tenant_id,
                "timestamp": _now().isoformat(),
            },
        )

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(call)
        return call

    # ═══════════════════════════════════════════════════════════════════════
    # Public API — transitions
    # ═══════════════════════════════════════════════════════════════════════

    async def ack(
        self,
        *,
        call_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
    ) -> ServiceCall:
        """
        Transition CREATED → ACKED.

        Sets acked_by_id and acked_at. Emits SERVICE_CALL_ACKED (direct Redis)
        after commit.

        Raises:
          NotFoundError: call not found in tenant.
          ForbiddenError: user cannot access the call's branch.
          ConflictError: call is not in CREATED state.
        """
        call = await self._load_call_scoped(
            call_id=call_id, tenant_id=tenant_id, branch_ids=branch_ids
        )
        if call.status != ServiceCallStatus.CREATED:
            raise ConflictError(
                f"No se puede ACKear una llamada en estado {call.status!r}. "
                f"Solo CREATED puede pasar a ACKED.",
                code="invalid_transition",
            )
        call.status = ServiceCallStatus.ACKED
        call.acked_by_id = user_id
        call.acked_at = _now()

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(call)

        await self._publish(
            "SERVICE_CALL_ACKED",
            self._build_event_payload(call, tenant_id, actor_user_id=user_id),
        )
        return call

    async def close(
        self,
        *,
        call_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
    ) -> ServiceCall:
        """
        Transition CREATED or ACKED → CLOSED.

        Sets closed_by_id and closed_at. Emits SERVICE_CALL_CLOSED (direct
        Redis) after commit.

        Raises:
          NotFoundError: call not found in tenant.
          ForbiddenError: user cannot access the call's branch.
          ConflictError: call is already CLOSED.
        """
        call = await self._load_call_scoped(
            call_id=call_id, tenant_id=tenant_id, branch_ids=branch_ids
        )
        if call.status == ServiceCallStatus.CLOSED:
            raise ConflictError(
                "La llamada ya está cerrada",
                code="invalid_transition",
            )
        if call.status not in SERVICE_CALL_OPEN_STATUSES:
            raise ConflictError(
                f"No se puede cerrar una llamada en estado {call.status!r}",
                code="invalid_transition",
            )
        call.status = ServiceCallStatus.CLOSED
        call.closed_by_id = user_id
        call.closed_at = _now()

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(call)

        await self._publish(
            "SERVICE_CALL_CLOSED",
            self._build_event_payload(call, tenant_id, actor_user_id=user_id),
        )
        return call

    # ═══════════════════════════════════════════════════════════════════════
    # Public API — list
    # ═══════════════════════════════════════════════════════════════════════

    async def list_open(
        self,
        *,
        branch_id: int,
        tenant_id: int,
        branch_ids: list[int] | None = None,
        status_filter: list[str] | None = None,
    ) -> list[ServiceCall]:
        """
        List service calls for a branch.

        Default status_filter is CREATED + ACKED (open calls only). Explicit
        status_filter=[CLOSED] returns only closed calls.

        Raises ForbiddenError if branch_ids is non-None and branch_id is not
        in it.
        """
        if branch_ids is not None and branch_id not in branch_ids:
            raise ForbiddenError(f"No tenés acceso a la sucursal {branch_id}")

        effective_filter = (
            status_filter
            if status_filter is not None
            else list(SERVICE_CALL_OPEN_STATUSES)
        )

        stmt = (
            select(ServiceCall)
            .join(Branch, Branch.id == ServiceCall.branch_id)
            .where(
                ServiceCall.branch_id == branch_id,
                ServiceCall.is_active.is_(True),
                ServiceCall.status.in_(effective_filter),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
            .order_by(ServiceCall.created_at.asc())
        )
        return list((await self._db.execute(stmt)).scalars().all())

    # ═══════════════════════════════════════════════════════════════════════
    # Private helpers
    # ═══════════════════════════════════════════════════════════════════════

    async def _load_session_for_create(
        self,
        *,
        session_id: int,
        tenant_id: int,
    ) -> TableSession:
        """Load and lock the session for creating a service call on it."""
        stmt = (
            select(TableSession)
            .join(Branch, Branch.id == TableSession.branch_id)
            .where(
                TableSession.id == session_id,
                TableSession.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        try:
            stmt = stmt.with_for_update()
        except Exception:
            pass
        session = (await self._db.execute(stmt)).scalar_one_or_none()
        if session is None:
            raise NotFoundError("TableSession", session_id)
        return session

    async def _find_open_service_call(
        self, session_id: int
    ) -> ServiceCall | None:
        """Check for an existing open (CREATED or ACKED) call in this session."""
        stmt = select(ServiceCall).where(
            ServiceCall.session_id == session_id,
            ServiceCall.is_active.is_(True),
            ServiceCall.status.in_(list(SERVICE_CALL_OPEN_STATUSES)),
        )
        return (await self._db.execute(stmt)).scalar_one_or_none()

    async def _load_call_scoped(
        self,
        *,
        call_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
    ) -> ServiceCall:
        """Load a service call with tenant + branch scope enforcement."""
        stmt = (
            select(ServiceCall)
            .join(Branch, Branch.id == ServiceCall.branch_id)
            .where(
                ServiceCall.id == call_id,
                ServiceCall.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        call = (await self._db.execute(stmt)).scalar_one_or_none()
        if call is None:
            raise NotFoundError("ServiceCall", call_id)
        if branch_ids is not None and call.branch_id not in branch_ids:
            raise ForbiddenError("No tenés acceso a esta sucursal")
        return call

    def _build_event_payload(
        self,
        call: ServiceCall,
        tenant_id: int,
        *,
        actor_user_id: int | None = None,
    ) -> dict[str, Any]:
        """Minimum routing payload for SERVICE_CALL_* events."""
        return {
            "service_call_id": call.id,
            "session_id": call.session_id,
            "table_id": call.table_id,
            "branch_id": call.branch_id,
            "tenant_id": tenant_id,
            "status": call.status,
            "acted_by_user_id": actor_user_id,
            "timestamp": _now().isoformat(),
        }

    async def _publish(self, event_type: str, payload: dict[str, Any]) -> None:
        """Publish via the injected publisher — never raises."""
        try:
            await self._publisher(event_type, payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "service_call_service.publish_failed: event_type=%s error=%r",
                event_type,
                exc,
            )
