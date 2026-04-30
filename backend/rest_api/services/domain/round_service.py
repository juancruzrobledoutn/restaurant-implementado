"""
RoundService — domain service for the round lifecycle (C-10).

State machine (see knowledge-base/01-negocio/04_reglas_de_negocio.md §2):
  PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED
  CANCELED reachable from any non-terminal state.
  SERVED and CANCELED are terminal.

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id — via branch join for rounds
  - Routers stay thin — all state-machine logic lives here

Event publication:
  - ROUND_SUBMITTED and ROUND_READY go through the outbox (at-least-once).
    OutboxService.write_event(...) is called INSIDE the same transaction as
    the status flip. The background outbox_worker publishes them later.
  - All other ROUND_* events go via publish_event (direct Redis) AFTER commit.
  - Every transition publishes exactly one event. On failure, no event fires.

Design decisions (design.md):
  - D-01: Single _VALID_TRANSITIONS table + _assert_transition helper.
  - D-02: _create_round is the shared private path for diner + waiter creation.
  - D-03: Price snapshot happens at round creation.
  - D-04: Stock validation ONLY on submit.
  - D-05: Only ROUND_SUBMITTED and ROUND_READY use outbox.
  - D-08: CANCELED is a status, not a soft-delete.
  - D-09: round_number assigned server-side under session row lock.
  - D-10: Kitchen filter lives in list_for_kitchen, not in routers.
  - D-11: Void-item mutates ONE item; does not change round status.
  - D-12: Publisher is injectable for tests.

Stock validation (C-10 forward-looking):
  Stock columns on BranchProduct and Ingredient do NOT yet exist (stock
  tracking lives in a future inventory module). _validate_stock is therefore
  a NO-OP pass in C-10 that iterates the items and returns no shortages.
  When stock columns land, this method fills in the aggregate-and-compare
  logic without changing the public API.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Awaitable, Callable

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from shared.config.constants import (
    KITCHEN_VISIBLE_STATUSES,
    VOID_ITEM_ALLOWED_STATUSES,
    RoundStatus,
    UserRole,
)
from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.infrastructure.events import publish_event
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    StockInsufficientError,
    ValidationError,
)
from rest_api.models.branch import Branch
from rest_api.models.menu import BranchProduct, Product
from rest_api.models.round import Round, RoundItem
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import CartItem, Diner, TableSession
from rest_api.schemas.round import (
    KitchenRoundItemOutput,
    KitchenRoundOutput,
    RoundItemOutput,
    RoundOutput,
    RoundWithItemsOutput,
    StockShortage,
)
from rest_api.services.domain.outbox_service import OutboxService

logger = get_logger(__name__)


# ── State-machine tables ──────────────────────────────────────────────────────

# (from_status, to_status) → frozenset of roles allowed to make the transition.
# The "creation" transition (from nothing to PENDING) is NOT in this table —
# it's gated at the router layer by the endpoint's auth dependency.
_VALID_TRANSITIONS: dict[tuple[str, str], frozenset[str]] = {
    (RoundStatus.PENDING, RoundStatus.CONFIRMED): frozenset(
        {UserRole.WAITER, UserRole.MANAGER, UserRole.ADMIN}
    ),
    (RoundStatus.CONFIRMED, RoundStatus.SUBMITTED): frozenset(
        {UserRole.MANAGER, UserRole.ADMIN}
    ),
    (RoundStatus.SUBMITTED, RoundStatus.IN_KITCHEN): frozenset(
        {UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN}
    ),
    (RoundStatus.IN_KITCHEN, RoundStatus.READY): frozenset(
        {UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN}
    ),
    (RoundStatus.READY, RoundStatus.SERVED): frozenset(
        {UserRole.WAITER, UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN}
    ),
}

# CANCEL is reachable from any non-terminal state, but only by MANAGER/ADMIN.
_CANCELABLE_FROM: frozenset[str] = frozenset(
    {
        RoundStatus.PENDING,
        RoundStatus.CONFIRMED,
        RoundStatus.SUBMITTED,
        RoundStatus.IN_KITCHEN,
        RoundStatus.READY,
    }
)
_CANCEL_ROLES: frozenset[str] = frozenset({UserRole.MANAGER, UserRole.ADMIN})

# Status → event type + delivery pattern.
# direct = publish_event after commit.  outbox = write_event inside transaction.
_STATUS_TO_EVENT: dict[str, tuple[str, str]] = {
    RoundStatus.PENDING: ("ROUND_PENDING", "direct"),
    RoundStatus.CONFIRMED: ("ROUND_CONFIRMED", "direct"),
    RoundStatus.SUBMITTED: ("ROUND_SUBMITTED", "outbox"),
    RoundStatus.IN_KITCHEN: ("ROUND_IN_KITCHEN", "direct"),
    RoundStatus.READY: ("ROUND_READY", "outbox"),
    RoundStatus.SERVED: ("ROUND_SERVED", "direct"),
    RoundStatus.CANCELED: ("ROUND_CANCELED", "direct"),
}


# Publisher type — async (event_type, payload) → None
Publisher = Callable[[str, dict[str, Any]], Awaitable[None]]


class RoundService:
    """
    Domain service for the Round state machine.

    All transitions go through this class. Routers call a public method and
    delegate every rule check, lock, and event emission here.

    Tests inject a mock `publisher` to assert calls without hitting Redis.
    """

    def __init__(
        self,
        db: AsyncSession,
        publisher: Publisher | None = None,
    ) -> None:
        self._db = db
        self._publisher: Publisher = publisher or publish_event

    # ═══════════════════════════════════════════════════════════════════════════
    # Public API — creation
    # ═══════════════════════════════════════════════════════════════════════════

    async def create_from_cart(
        self,
        *,
        session_id: int,
        diner_id: int,
        tenant_id: int,
    ) -> RoundWithItemsOutput:
        """
        Create a PENDING round from the calling diner's CartItem rows.

        Flow:
          1. Lock the session row (also validates it's OPEN and in tenant).
          2. Load the diner's cart items; reject if empty.
          3. Snapshot prices per item (BranchProduct → fallback Product.price).
          4. Insert Round + RoundItem rows.
          5. Hard-delete the diner's CartItem rows in the SAME transaction.
          6. safe_commit — atomic all-or-nothing.
          7. Publish ROUND_PENDING (direct Redis) AFTER commit.
        """
        session = await self._load_session_for_create(
            session_id=session_id, tenant_id=tenant_id, branch_ids=None
        )

        # Load the caller's cart items with a row lock to avoid races
        cart_stmt = (
            select(CartItem)
            .where(
                CartItem.session_id == session_id,
                CartItem.diner_id == diner_id,
            )
            .order_by(CartItem.id.asc())
        )
        try:
            cart_stmt = cart_stmt.with_for_update()
        except Exception:
            pass
        cart_items = list((await self._db.execute(cart_stmt)).scalars().all())
        if not cart_items:
            raise ValidationError(
                "Tu carrito está vacío. Agregá productos antes de enviar la ronda.",
                field="cart",
            )

        items_plan = [
            {
                "product_id": ci.product_id,
                "quantity": ci.quantity,
                "notes": ci.notes,
                "diner_id": diner_id,
            }
            for ci in cart_items
        ]

        round_ = await self._create_round(
            session=session,
            items_plan=items_plan,
            created_by_role="DINER",
            created_by_user_id=None,
            created_by_diner_id=diner_id,
        )

        # Hard-delete this diner's cart items in the same transaction
        await self._db.execute(
            delete(CartItem).where(
                CartItem.session_id == session_id,
                CartItem.diner_id == diner_id,
            )
        )

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(round_)

        await self._publish_transition(round_, RoundStatus.PENDING)
        return await self._to_with_items_output(round_)

    async def create_from_waiter(
        self,
        *,
        session_id: int,
        items_input: list[dict[str, Any]],
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
    ) -> RoundWithItemsOutput:
        """
        Create a PENDING round from a waiter's quick-command body.

        items_input: list of dicts with keys product_id, quantity, notes, diner_id.
        Validates that any diner_id belongs to the session.
        """
        if not items_input:
            raise ValidationError(
                "La ronda debe contener al menos un item",
                field="items",
            )

        session = await self._load_session_for_create(
            session_id=session_id, tenant_id=tenant_id, branch_ids=branch_ids
        )

        # Validate any referenced diner_id belongs to this session
        diner_ids = {i.get("diner_id") for i in items_input if i.get("diner_id")}
        if diner_ids:
            rows = await self._db.execute(
                select(Diner.id).where(
                    Diner.session_id == session_id,
                    Diner.id.in_(diner_ids),
                    Diner.is_active.is_(True),
                )
            )
            valid_ids = {r for (r,) in rows.all()}
            missing = diner_ids - valid_ids
            if missing:
                raise ValidationError(
                    f"Los siguientes diner_id no pertenecen a esta sesión: {sorted(missing)}",
                    field="items.diner_id",
                )

        round_ = await self._create_round(
            session=session,
            items_plan=items_input,
            created_by_role=str(user_role),
            created_by_user_id=user_id,
            created_by_diner_id=None,
        )

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(round_)

        await self._publish_transition(round_, RoundStatus.PENDING)
        return await self._to_with_items_output(round_)

    # ═══════════════════════════════════════════════════════════════════════════
    # Public API — state transitions
    # ═══════════════════════════════════════════════════════════════════════════

    async def confirm(
        self,
        *,
        round_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
    ) -> RoundOutput:
        """PENDING → CONFIRMED (WAITER, MANAGER, ADMIN)."""
        return await self._simple_transition(
            round_id=round_id,
            tenant_id=tenant_id,
            branch_ids=branch_ids,
            user_id=user_id,
            user_role=user_role,
            target=RoundStatus.CONFIRMED,
            actor_fields={"confirmed_by_id": user_id, "confirmed_at": _now()},
        )

    async def submit(
        self,
        *,
        round_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
    ) -> RoundOutput:
        """
        CONFIRMED → SUBMITTED (MANAGER, ADMIN).

        Runs _validate_stock() — raises StockInsufficientError (409) on shortage.
        Writes ROUND_SUBMITTED to the outbox inside the same transaction as the
        status flip (at-least-once event guarantee for kitchen dispatch).

        C-11: Creates the KitchenTicket + KitchenTicketItem rows inside the
        SAME transaction (D-01). The ROUND_SUBMITTED outbox payload gains a
        `ticket_id` field. After commit, emits TICKET_CREATED (direct Redis).
        """
        # Local import to avoid circular dependency with TicketService.
        from rest_api.services.domain.ticket_service import TicketService

        round_ = await self._load_round_for_update(
            round_id=round_id,
            tenant_id=tenant_id,
            branch_ids=branch_ids,
            eager_items=True,
        )
        self._assert_transition(round_.status, RoundStatus.SUBMITTED, user_role)

        # Stock validation — raises StockInsufficientError if short.
        await self._validate_stock(round_)

        round_.status = RoundStatus.SUBMITTED
        round_.submitted_at = _now()
        round_.submitted_by_id = user_id

        # C-11: create the kitchen ticket inside the same transaction.
        ticket_service = TicketService(self._db)
        ticket = await ticket_service.create_from_round(round_)

        # Write outbox row INSIDE the transaction — atomicity guarantee.
        payload = self._build_event_payload(round_)
        payload["ticket_id"] = ticket.id
        await OutboxService.write_event(
            db=self._db,
            event_type=_STATUS_TO_EVENT[RoundStatus.SUBMITTED][0],
            payload=payload,
        )

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(round_)
        await self._db.refresh(ticket)

        # C-11: direct-Redis TICKET_CREATED for ticket-aware subscribers.
        await self._publish(
            "TICKET_CREATED",
            {
                "ticket_id": ticket.id,
                "round_id": round_.id,
                "branch_id": round_.branch_id,
                "tenant_id": tenant_id,
                "timestamp": _now().isoformat(),
            },
        )

        # No inline publish of ROUND_SUBMITTED — the outbox worker handles it.
        return RoundOutput.model_validate(round_)

    async def start_kitchen(
        self,
        *,
        round_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
    ) -> RoundOutput:
        """
        SUBMITTED → IN_KITCHEN (KITCHEN, MANAGER, ADMIN).

        C-11: Also stamps the ticket's started_at and emits TICKET_IN_PROGRESS.
        """
        from rest_api.services.domain.ticket_service import TicketService

        round_ = await self._load_round_for_update(
            round_id=round_id,
            tenant_id=tenant_id,
            branch_ids=branch_ids,
        )
        self._assert_transition(round_.status, RoundStatus.IN_KITCHEN, user_role)

        round_.status = RoundStatus.IN_KITCHEN
        round_.in_kitchen_at = _now()

        # C-11: stamp the ticket's started_at in the same transaction.
        ticket_service = TicketService(self._db)
        ticket = await ticket_service.mark_started(round_.id)

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(round_)

        await self._publish_transition(round_, RoundStatus.IN_KITCHEN)
        if ticket is not None:
            await self._publish(
                "TICKET_IN_PROGRESS",
                {
                    "ticket_id": ticket.id,
                    "round_id": round_.id,
                    "branch_id": round_.branch_id,
                    "tenant_id": tenant_id,
                    "timestamp": _now().isoformat(),
                },
            )
        return RoundOutput.model_validate(round_)

    async def mark_ready(
        self,
        *,
        round_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
    ) -> RoundOutput:
        """
        IN_KITCHEN → READY (KITCHEN, MANAGER, ADMIN).

        Writes ROUND_READY to the outbox (at-least-once for diner notification).

        C-11: Transitions the ticket to READY in the same transaction and
        writes TICKET_READY to the outbox (both are at-least-once).
        """
        from rest_api.services.domain.ticket_service import TicketService

        round_ = await self._load_round_for_update(
            round_id=round_id,
            tenant_id=tenant_id,
            branch_ids=branch_ids,
        )
        self._assert_transition(round_.status, RoundStatus.READY, user_role)

        round_.status = RoundStatus.READY
        round_.ready_at = _now()

        # C-11: transition the ticket in the same transaction.
        ticket_service = TicketService(self._db)
        ticket = await ticket_service.mark_ready(round_.id)

        round_payload = self._build_event_payload(round_)
        if ticket is not None:
            round_payload["ticket_id"] = ticket.id
        await OutboxService.write_event(
            db=self._db,
            event_type=_STATUS_TO_EVENT[RoundStatus.READY][0],
            payload=round_payload,
        )

        # C-11: TICKET_READY event for ticket-aware subscribers (outbox).
        if ticket is not None:
            await OutboxService.write_event(
                db=self._db,
                event_type="TICKET_READY",
                payload={
                    "ticket_id": ticket.id,
                    "round_id": round_.id,
                    "branch_id": round_.branch_id,
                    "tenant_id": tenant_id,
                    "timestamp": _now().isoformat(),
                },
            )

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(round_)

        return RoundOutput.model_validate(round_)

    async def serve(
        self,
        *,
        round_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
    ) -> RoundOutput:
        """
        READY → SERVED (WAITER, KITCHEN, MANAGER, ADMIN).

        C-11: Transitions the ticket to DELIVERED and emits TICKET_DELIVERED.
        """
        from rest_api.services.domain.ticket_service import TicketService

        round_ = await self._load_round_for_update(
            round_id=round_id,
            tenant_id=tenant_id,
            branch_ids=branch_ids,
        )
        self._assert_transition(round_.status, RoundStatus.SERVED, user_role)

        round_.status = RoundStatus.SERVED
        round_.served_at = _now()

        # C-11: transition ticket to DELIVERED in the same transaction.
        ticket_service = TicketService(self._db)
        ticket = await ticket_service.mark_delivered(round_.id)

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(round_)

        await self._publish_transition(round_, RoundStatus.SERVED)
        if ticket is not None:
            await self._publish(
                "TICKET_DELIVERED",
                {
                    "ticket_id": ticket.id,
                    "round_id": round_.id,
                    "branch_id": round_.branch_id,
                    "tenant_id": tenant_id,
                    "timestamp": _now().isoformat(),
                },
            )
        return RoundOutput.model_validate(round_)

    async def cancel(
        self,
        *,
        round_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
        cancel_reason: str,
    ) -> RoundOutput:
        """
        Any non-terminal → CANCELED (MANAGER, ADMIN).

        C-11: If the round was in SUBMITTED, IN_KITCHEN, or READY, its ticket
        is soft-deleted (is_active=False). Cancel from PENDING or CONFIRMED
        has no ticket to touch (idempotent no-op).
        """
        from rest_api.services.domain.ticket_service import TicketService

        if user_role not in _CANCEL_ROLES:
            raise ForbiddenError(
                f"El rol {user_role!r} no puede cancelar rondas"
            )
        if not cancel_reason or not cancel_reason.strip():
            raise ValidationError(
                "cancel_reason es requerido para cancelar una ronda",
                field="cancel_reason",
            )

        round_ = await self._load_round_for_update(
            round_id=round_id,
            tenant_id=tenant_id,
            branch_ids=branch_ids,
        )

        if round_.status not in _CANCELABLE_FROM:
            raise ConflictError(
                f"No se puede cancelar una ronda en estado {round_.status!r}"
            )

        round_.status = RoundStatus.CANCELED
        round_.canceled_at = _now()
        round_.canceled_by_id = user_id
        round_.cancel_reason = cancel_reason.strip()

        # C-11: cascade soft-delete to the ticket (idempotent no-op if none).
        ticket_service = TicketService(self._db)
        await ticket_service.cancel_for_round(round_.id)

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(round_)

        await self._publish_transition(round_, RoundStatus.CANCELED)
        return RoundOutput.model_validate(round_)

    # ═══════════════════════════════════════════════════════════════════════════
    # Public API — void item
    # ═══════════════════════════════════════════════════════════════════════════

    async def void_item(
        self,
        *,
        round_id: int,
        round_item_id: int,
        void_reason: str,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
    ) -> RoundItemOutput:
        """
        Mark a single RoundItem as voided. Does NOT change the parent round's
        status. Allowed only in SUBMITTED, IN_KITCHEN, or READY.
        """
        if user_role not in (UserRole.WAITER, UserRole.MANAGER, UserRole.ADMIN):
            raise ForbiddenError(
                f"El rol {user_role!r} no puede anular items de una ronda"
            )
        if not void_reason or not void_reason.strip():
            raise ValidationError(
                "void_reason es requerido",
                field="void_reason",
            )

        round_ = await self._load_round_for_update(
            round_id=round_id,
            tenant_id=tenant_id,
            branch_ids=branch_ids,
        )
        if round_.status not in VOID_ITEM_ALLOWED_STATUSES:
            raise ConflictError(
                f"No se puede anular items en una ronda con status {round_.status!r}. "
                f"Estados permitidos: SUBMITTED, IN_KITCHEN, READY."
            )

        # Load the item with a row lock
        item_stmt = select(RoundItem).where(
            RoundItem.id == round_item_id,
            RoundItem.round_id == round_id,
        )
        try:
            item_stmt = item_stmt.with_for_update()
        except Exception:
            pass
        item = (await self._db.execute(item_stmt)).scalar_one_or_none()
        if item is None:
            raise NotFoundError("RoundItem", round_item_id)

        if item.is_voided:
            raise ConflictError(
                f"El item {round_item_id} ya estaba anulado",
                code="already_voided",
            )

        item.is_voided = True
        item.void_reason = void_reason.strip()
        item.voided_at = _now()
        item.voided_by_id = user_id

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(item)

        # Direct Redis informational event — no outbox.
        await self._publish(
            "ROUND_ITEM_VOIDED",
            {
                "round_id": round_.id,
                "round_item_id": item.id,
                "branch_id": round_.branch_id,
                "tenant_id": tenant_id,
                "status": round_.status,
                "void_reason": item.void_reason,
                "timestamp": _now().isoformat(),
            },
        )
        return RoundItemOutput.model_validate(item)

    # ═══════════════════════════════════════════════════════════════════════════
    # Public API — list / read
    # ═══════════════════════════════════════════════════════════════════════════

    async def list_for_session(
        self,
        *,
        session_id: int,
        tenant_id: int,
        branch_ids: list[int] | None = None,
    ) -> list[RoundWithItemsOutput]:
        """List rounds for a session — eager-loads items."""
        # Validate session exists in tenant (returns None → empty list)
        session = await self._load_session_readonly(session_id, tenant_id, branch_ids)
        if session is None:
            raise NotFoundError("TableSession", session_id)

        stmt = (
            select(Round)
            .join(Branch, Branch.id == Round.branch_id)
            .where(
                Round.session_id == session_id,
                Round.is_active.is_(True),
                Branch.tenant_id == tenant_id,
            )
            .options(selectinload(Round.items))
            .order_by(Round.round_number.asc())
        )
        rounds = list((await self._db.execute(stmt)).scalars().unique().all())
        return [await self._to_with_items_output(r) for r in rounds]

    async def list_for_kitchen(
        self,
        *,
        branch_id: int,
        tenant_id: int,
        branch_ids: list[int] | None = None,
    ) -> list[KitchenRoundOutput]:
        """
        List rounds for kitchen consumption. NEVER returns PENDING or CONFIRMED
        (enforced here, not in the router — per design D-10).

        Returns enriched KitchenRoundOutput with product names, table number,
        sector name, and active diner count — all eager-loaded in one pass.
        """
        if branch_ids is not None and branch_id not in branch_ids:
            raise ForbiddenError(
                f"No tenés acceso a la sucursal {branch_id}"
            )

        stmt = (
            select(Round)
            .join(Branch, Branch.id == Round.branch_id)
            .where(
                Round.branch_id == branch_id,
                Round.is_active.is_(True),
                Round.status.in_(KITCHEN_VISIBLE_STATUSES),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
            .options(
                selectinload(Round.items).selectinload(RoundItem.product),
                selectinload(Round.session).selectinload(TableSession.table).selectinload(Table.sector),
                selectinload(Round.session).selectinload(TableSession.diners),
            )
            .order_by(Round.submitted_at.asc().nulls_last())
        )
        rounds = list((await self._db.execute(stmt)).scalars().unique().all())
        return [self._to_kitchen_round_output(r) for r in rounds]

    def _to_kitchen_round_output(self, round_: Round) -> KitchenRoundOutput:
        """Build KitchenRoundOutput from an eagerly-loaded Round."""
        session = round_.session
        table = session.table if session else None
        sector = table.sector if table else None
        diners = session.diners if session else []
        active_diner_count = sum(1 for d in diners if d.is_active)

        return KitchenRoundOutput(
            id=round_.id,
            session_id=round_.session_id,
            branch_id=round_.branch_id,
            status=round_.status,
            submitted_at=round_.submitted_at,
            table_number=table.number if table else 0,
            sector_name=sector.name if sector else None,
            diner_count=active_diner_count,
            items=[
                KitchenRoundItemOutput(
                    product_name=item.product.name if item.product else f"#{item.product_id}",
                    quantity=item.quantity,
                    notes=item.notes,
                    is_voided=item.is_voided,
                )
                for item in round_.items
            ],
        )

    async def list_for_diner(
        self,
        *,
        session_id: int,
        tenant_id: int,
    ) -> list[RoundWithItemsOutput]:
        """Diner-facing list — all rounds of the calling diner's session."""
        return await self.list_for_session(
            session_id=session_id, tenant_id=tenant_id, branch_ids=None
        )

    async def list_for_admin(
        self,
        *,
        tenant_id: int,
        branch_id: int,
        date: str | None = None,
        sector_id: int | None = None,
        status: str | None = None,
        table_code: str | None = None,
        limit: int = 50,
        offset: int = 0,
        branch_ids: list[int] | None = None,
    ) -> tuple[list, int]:
        """
        List rounds for admin/manager view with filters and pagination.

        Design (design.md D8): single query with JOINs — no N+1.
        Returns (items: list[RoundAdminOutput], total: int).

        Rules:
          - ALWAYS filter by tenant_id via branch.tenant_id join
          - branch_ids is None for ADMIN (bypass), list for MANAGER (restrict)
          - date filter is inclusive of the full UTC day derived from branch timezone
        """
        from datetime import date as date_type, timedelta
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        from sqlalchemy import case, and_

        # Import here to avoid circular imports at module level
        from rest_api.schemas.round import RoundAdminOutput
        from rest_api.models.table_session import TableSession

        # — Branch access check —
        # First verify the branch belongs to tenant_id
        branch_check = await self._db.scalar(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if branch_check is None:
            raise ForbiddenError(
                f"La sucursal {branch_id} no existe o no pertenece a este tenant"
            )

        # MANAGER: verify branch is within their allowed branch_ids
        if branch_ids is not None and branch_id not in branch_ids:
            raise ForbiddenError(
                f"No tenés acceso a la sucursal {branch_id}"
            )

        # — Resolve timezone for date filtering —
        tz_str = getattr(branch_check, "timezone", None) or "UTC"
        try:
            tz = ZoneInfo(tz_str)
        except (ZoneInfoNotFoundError, Exception):
            tz = ZoneInfo("UTC")

        # — Build base WHERE conditions (used by both data and count queries) —
        # Conditions on Round (direct columns)
        base_conditions = [
            Round.branch_id == branch_id,
            Round.is_active.is_(True),
            Branch.tenant_id == tenant_id,
            Branch.is_active.is_(True),
        ]

        if date is not None:
            # Parse date string and convert to UTC range for pending_at
            from datetime import datetime
            try:
                local_date = date_type.fromisoformat(date)
            except ValueError:
                local_date = date_type.today()

            # Start of day and end of day in local timezone, then to UTC
            start_local = datetime(
                local_date.year, local_date.month, local_date.day,
                0, 0, 0, tzinfo=tz
            )
            end_local = start_local + timedelta(days=1)
            start_utc = start_local.astimezone(ZoneInfo("UTC"))
            end_utc = end_local.astimezone(ZoneInfo("UTC"))
            base_conditions.append(Round.pending_at >= start_utc)
            base_conditions.append(Round.pending_at < end_utc)

        if status is not None:
            base_conditions.append(Round.status == status)

        # Table-join conditions
        table_join_conditions = [TableSession.id == Round.session_id]
        table2_conditions = [Table.id == TableSession.table_id]

        if table_code is not None:
            # ILIKE '%code%' case-insensitive partial match
            base_conditions.append(Table.code.ilike(f"%{table_code}%"))

        if sector_id is not None:
            base_conditions.append(BranchSector.id == sector_id)

        # — Data query: single JOIN with GROUP BY —
        # Using labeled columns from joins for the output
        data_stmt = (
            select(
                Round.id,
                Round.round_number,
                Round.session_id,
                Round.branch_id,
                Round.status,
                Round.created_by_role,
                Round.cancel_reason,
                Round.pending_at,
                Round.confirmed_at,
                Round.submitted_at,
                Round.in_kitchen_at,
                Round.ready_at,
                Round.served_at,
                Round.canceled_at,
                Round.created_at,
                Round.updated_at,
                Table.id.label("table_id"),
                Table.code.label("table_code"),
                Table.number.label("table_number"),
                BranchSector.id.label("sector_id"),
                BranchSector.name.label("sector_name"),
                Diner.id.label("diner_id"),
                Diner.name.label("diner_name"),
                func.count(
                    case((RoundItem.is_voided.is_(False), RoundItem.id))
                ).label("items_count"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                RoundItem.is_voided.is_(False),
                                RoundItem.price_cents_snapshot * RoundItem.quantity,
                            )
                        )
                    ),
                    0,
                ).label("total_cents"),
            )
            .select_from(Round)
            .join(Branch, Branch.id == Round.branch_id)
            .join(TableSession, TableSession.id == Round.session_id)
            .join(Table, Table.id == TableSession.table_id)
            .outerjoin(BranchSector, BranchSector.id == Table.sector_id)
            .outerjoin(Diner, Diner.id == Round.created_by_diner_id)
            .outerjoin(
                RoundItem,
                and_(RoundItem.round_id == Round.id, RoundItem.is_active.is_(True)),
            )
            .where(*base_conditions)
            .group_by(
                Round.id,
                Table.id,
                Table.code,
                Table.number,
                BranchSector.id,
                BranchSector.name,
                Diner.id,
                Diner.name,
            )
            .order_by(Round.pending_at.desc())
            .limit(limit)
            .offset(offset)
        )

        rows = (await self._db.execute(data_stmt)).all()

        # Map raw rows to RoundAdminOutput
        items: list[RoundAdminOutput] = []
        for row in rows:
            items.append(
                RoundAdminOutput(
                    id=row.id,
                    round_number=row.round_number,
                    session_id=row.session_id,
                    branch_id=row.branch_id,
                    status=row.status,
                    created_by_role=row.created_by_role,
                    cancel_reason=row.cancel_reason,
                    pending_at=row.pending_at,
                    confirmed_at=row.confirmed_at,
                    submitted_at=row.submitted_at,
                    in_kitchen_at=row.in_kitchen_at,
                    ready_at=row.ready_at,
                    served_at=row.served_at,
                    canceled_at=row.canceled_at,
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                    table_id=row.table_id,
                    table_code=row.table_code,
                    table_number=row.table_number,
                    sector_id=row.sector_id,
                    sector_name=row.sector_name,
                    diner_id=row.diner_id,
                    diner_name=row.diner_name,
                    items_count=row.items_count,
                    total_cents=row.total_cents,
                )
            )

        # — Count query: separate SELECT COUNT DISTINCT —
        from sqlalchemy import distinct

        count_stmt = (
            select(func.count(distinct(Round.id)))
            .select_from(Round)
            .join(Branch, Branch.id == Round.branch_id)
            .join(TableSession, TableSession.id == Round.session_id)
            .join(Table, Table.id == TableSession.table_id)
            .outerjoin(BranchSector, BranchSector.id == Table.sector_id)
            .where(*base_conditions)
        )
        total: int = (await self._db.execute(count_stmt)).scalar_one()

        return items, total

    async def get_admin_detail(
        self,
        *,
        round_id: int,
        tenant_id: int,
        branch_ids: list[int] | None = None,
    ):
        """
        Fetch a single round with all items embedded for the admin detail modal.

        Returns RoundAdminWithItemsOutput.
        Raises NotFoundError if not found, ForbiddenError if branch access denied.
        """
        from rest_api.schemas.round import RoundAdminWithItemsOutput, RoundAdminOutput
        from rest_api.models.table_session import TableSession
        from sqlalchemy import and_, case

        # Single query: round + denorm context
        stmt = (
            select(
                Round.id,
                Round.round_number,
                Round.session_id,
                Round.branch_id,
                Round.status,
                Round.created_by_role,
                Round.cancel_reason,
                Round.pending_at,
                Round.confirmed_at,
                Round.submitted_at,
                Round.in_kitchen_at,
                Round.ready_at,
                Round.served_at,
                Round.canceled_at,
                Round.created_at,
                Round.updated_at,
                Table.id.label("table_id"),
                Table.code.label("table_code"),
                Table.number.label("table_number"),
                BranchSector.id.label("sector_id"),
                BranchSector.name.label("sector_name"),
                Diner.id.label("diner_id"),
                Diner.name.label("diner_name"),
                func.count(
                    case((RoundItem.is_voided.is_(False), RoundItem.id))
                ).label("items_count"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                RoundItem.is_voided.is_(False),
                                RoundItem.price_cents_snapshot * RoundItem.quantity,
                            )
                        )
                    ),
                    0,
                ).label("total_cents"),
            )
            .select_from(Round)
            .join(Branch, Branch.id == Round.branch_id)
            .join(TableSession, TableSession.id == Round.session_id)
            .join(Table, Table.id == TableSession.table_id)
            .outerjoin(BranchSector, BranchSector.id == Table.sector_id)
            .outerjoin(Diner, Diner.id == Round.created_by_diner_id)
            .outerjoin(
                RoundItem,
                and_(RoundItem.round_id == Round.id, RoundItem.is_active.is_(True)),
            )
            .where(
                Round.id == round_id,
                Round.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
            .group_by(
                Round.id,
                Table.id,
                Table.code,
                Table.number,
                BranchSector.id,
                BranchSector.name,
                Diner.id,
                Diner.name,
            )
        )

        row = (await self._db.execute(stmt)).one_or_none()
        if row is None:
            raise NotFoundError("Round", round_id)

        if branch_ids is not None and row.branch_id not in branch_ids:
            raise ForbiddenError(
                f"No tenés acceso a la sucursal de esta ronda"
            )

        # Load all items (including voided — detail shows everything)
        items_stmt = (
            select(RoundItem)
            .where(
                RoundItem.round_id == round_id,
                RoundItem.is_active.is_(True),
            )
            .order_by(RoundItem.id.asc())
        )
        round_items = list((await self._db.execute(items_stmt)).scalars().all())

        admin_output = RoundAdminOutput(
            id=row.id,
            round_number=row.round_number,
            session_id=row.session_id,
            branch_id=row.branch_id,
            status=row.status,
            created_by_role=row.created_by_role,
            cancel_reason=row.cancel_reason,
            pending_at=row.pending_at,
            confirmed_at=row.confirmed_at,
            submitted_at=row.submitted_at,
            in_kitchen_at=row.in_kitchen_at,
            ready_at=row.ready_at,
            served_at=row.served_at,
            canceled_at=row.canceled_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
            table_id=row.table_id,
            table_code=row.table_code,
            table_number=row.table_number,
            sector_id=row.sector_id,
            sector_name=row.sector_name,
            diner_id=row.diner_id,
            diner_name=row.diner_name,
            items_count=row.items_count,
            total_cents=row.total_cents,
        )

        return RoundAdminWithItemsOutput(
            **admin_output.model_dump(),
            items=[RoundItemOutput.model_validate(i) for i in round_items],
        )

    # ═══════════════════════════════════════════════════════════════════════════
    # Private helpers
    # ═══════════════════════════════════════════════════════════════════════════

    def _assert_transition(
        self,
        current: str,
        target: str,
        actor_role: str,
    ) -> None:
        """
        Validate a transition is legal and the actor has permission.

        Raises ConflictError (409) if the transition is invalid,
        or ForbiddenError (403) if the actor lacks the role.
        """
        allowed_roles = _VALID_TRANSITIONS.get((current, target))
        if allowed_roles is None:
            raise ConflictError(
                f"Transición inválida: {current!r} → {target!r}",
                code="invalid_transition",
            )
        if actor_role not in allowed_roles:
            raise ForbiddenError(
                f"El rol {actor_role!r} no puede transicionar de {current} a {target}"
            )

    async def _load_session_for_create(
        self,
        *,
        session_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
    ) -> TableSession:
        """
        Load and lock a session for creating a round on it.

        - 404 if missing or is_active=False.
        - 409 if status != OPEN.
        - 403 if branch_ids is not None and session.branch_id is not in the list.
        - Validates tenant via branch join.
        """
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
        if branch_ids is not None and session.branch_id not in branch_ids:
            raise ForbiddenError(
                f"No tenés acceso a la sucursal de esta sesión"
            )
        if session.status != "OPEN":
            raise ConflictError(
                f"No se pueden crear rondas en una sesión con status {session.status!r}. "
                f"Solo OPEN admite nuevos pedidos."
            )
        return session

    async def _load_session_readonly(
        self,
        session_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
    ) -> TableSession | None:
        """Non-locking load, validates tenant + branch access. Returns None if missing."""
        stmt = (
            select(TableSession)
            .join(Branch, Branch.id == TableSession.branch_id)
            .where(
                TableSession.id == session_id,
                TableSession.is_active.is_(True),
                Branch.tenant_id == tenant_id,
            )
        )
        session = (await self._db.execute(stmt)).scalar_one_or_none()
        if session is None:
            return None
        if branch_ids is not None and session.branch_id not in branch_ids:
            # Treat as not-found to avoid leaking tenant/branch boundaries
            return None
        return session

    async def _load_round_for_update(
        self,
        *,
        round_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        eager_items: bool = False,
    ) -> Round:
        """
        Load a round with a row lock, validate tenant + branch access.

        - 404 if missing, soft-deleted, or not in tenant.
        - 403 if branch_ids is provided and the round's branch is not in the list.
        """
        stmt = (
            select(Round)
            .join(Branch, Branch.id == Round.branch_id)
            .where(
                Round.id == round_id,
                Round.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if eager_items:
            stmt = stmt.options(
                selectinload(Round.items).joinedload(RoundItem.product)
            )
        try:
            stmt = stmt.with_for_update(of=Round)
        except Exception:
            pass
        round_ = (await self._db.execute(stmt)).scalar_one_or_none()
        if round_ is None:
            raise NotFoundError("Round", round_id)
        if branch_ids is not None and round_.branch_id not in branch_ids:
            raise ForbiddenError(
                f"No tenés acceso a la sucursal de esta ronda"
            )
        return round_

    async def _create_round(
        self,
        *,
        session: TableSession,
        items_plan: list[dict[str, Any]],
        created_by_role: str,
        created_by_user_id: int | None,
        created_by_diner_id: int | None,
    ) -> Round:
        """
        Shared creation path for diner + waiter flows.

        Assigns round_number = (MAX existing for session) + 1 under the
        session row lock that the caller already holds.
        Snapshots prices per item.
        """
        # Next round_number for this session
        max_stmt = (
            select(func.max(Round.round_number))
            .where(Round.session_id == session.id)
        )
        current_max = (await self._db.execute(max_stmt)).scalar()
        next_number = (current_max or 0) + 1

        round_ = Round(
            session_id=session.id,
            branch_id=session.branch_id,
            round_number=next_number,
            status=RoundStatus.PENDING,
            created_by_role=created_by_role,
            created_by_user_id=created_by_user_id,
            created_by_diner_id=created_by_diner_id,
            pending_at=_now(),
        )
        self._db.add(round_)
        await self._db.flush()  # need round_.id for items

        # Resolve prices and create items
        for item_in in items_plan:
            product_id = int(item_in["product_id"])
            quantity = int(item_in["quantity"])
            notes = item_in.get("notes")
            diner_id = item_in.get("diner_id")
            price = await self._resolve_price(
                branch_id=session.branch_id, product_id=product_id
            )
            self._db.add(
                RoundItem(
                    round_id=round_.id,
                    product_id=product_id,
                    diner_id=diner_id,
                    quantity=quantity,
                    notes=notes,
                    price_cents_snapshot=price,
                )
            )
        await self._db.flush()
        return round_

    async def _resolve_price(self, *, branch_id: int, product_id: int) -> int:
        """
        Look up the price for a product at a branch.

        1. BranchProduct.price_cents (if row exists and is_active).
        2. Product.price (the base price — existing column in C-04).
        3. Raise ValidationError('product_unpriced') if neither resolves.
        """
        bp_price = await self._db.scalar(
            select(BranchProduct.price_cents).where(
                BranchProduct.branch_id == branch_id,
                BranchProduct.product_id == product_id,
                BranchProduct.is_active.is_(True),
            )
        )
        if bp_price is not None:
            return int(bp_price)

        base_price = await self._db.scalar(
            select(Product.price).where(
                Product.id == product_id,
                Product.is_active.is_(True),
            )
        )
        if base_price is not None:
            return int(base_price)

        raise ValidationError(
            f"El producto {product_id} no tiene precio configurado (product_unpriced)",
            field="items.product_id",
        )

    async def _validate_stock(self, round_: Round) -> None:
        """
        Validate that the round's non-voided items have enough stock.

        C-10 NOTE: Stock columns on BranchProduct / Ingredient do not yet exist
        (they will arrive with the inventory module in a later change). This
        method is a forward-looking NO-OP: it iterates the items and returns
        no shortages. When stock columns land, replace the no-op block below
        with the aggregate-and-compare logic (see design D-04 and §Risks).

        The signature stays stable so RoundService.submit() keeps working.
        """
        # Aggregate demand per product (excluding voided items) — ready for the
        # future stock check, no-op for now.
        demand: dict[int, int] = {}
        for item in round_.items:
            if item.is_voided:
                continue
            demand[item.product_id] = demand.get(item.product_id, 0) + item.quantity

        # Placeholder — when BranchProduct.stock / Ingredient.stock exist:
        #   rows = await self._db.execute(
        #       select(BranchProduct).where(
        #           BranchProduct.branch_id == round_.branch_id,
        #           BranchProduct.product_id.in_(demand.keys()),
        #       ).with_for_update()
        #   )
        #   shortages = [...]
        #   if shortages:
        #       raise StockInsufficientError(shortages=shortages)

        shortages: list[StockShortage] = []
        if shortages:
            raise StockInsufficientError(
                shortages=[s.model_dump() for s in shortages]
            )

    async def _simple_transition(
        self,
        *,
        round_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
        target: str,
        actor_fields: dict[str, Any],
    ) -> RoundOutput:
        """
        Shared implementation for transitions that use Direct Redis events.

        Used for confirm, start_kitchen, serve. DOES NOT use outbox.
        The caller decides what extra fields to stamp (confirmed_at/by, etc.).
        """
        round_ = await self._load_round_for_update(
            round_id=round_id,
            tenant_id=tenant_id,
            branch_ids=branch_ids,
        )
        self._assert_transition(round_.status, target, user_role)

        round_.status = target
        for field, value in actor_fields.items():
            setattr(round_, field, value)

        await self._db.flush()
        await safe_commit(self._db)
        await self._db.refresh(round_)

        await self._publish_transition(round_, target)
        return RoundOutput.model_validate(round_)

    async def _publish_transition(self, round_: Round, target: str) -> None:
        """
        Publish the WebSocket event for a successful transition.

        Respects the direct/outbox split: this helper only emits DIRECT events.
        Outbox events (ROUND_SUBMITTED, ROUND_READY) are written inside the
        transaction by submit()/mark_ready() — the worker publishes them later.
        """
        event_type, mode = _STATUS_TO_EVENT[target]
        if mode != "direct":
            return  # outbox-handled — nothing to do here
        await self._publish(event_type, self._build_event_payload(round_))

    async def _publish(self, event_type: str, payload: dict[str, Any]) -> None:
        """
        Send via the injected publisher. Never raises — publish failures are
        logged so the business transaction (already committed) stays atomic.
        """
        try:
            await self._publisher(event_type, payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "round_service.publish_failed: event_type=%s error=%r",
                event_type,
                exc,
            )

    def _build_event_payload(self, round_: Round) -> dict[str, Any]:
        """
        Construct the minimum routing payload for any ROUND_* event.
        ws-gateway routes by tenant_id + branch_id + status.
        """
        return {
            "round_id": round_.id,
            "session_id": round_.session_id,
            "branch_id": round_.branch_id,
            "status": round_.status,
            "round_number": round_.round_number,
            "timestamp": _now().isoformat(),
        }

    async def _to_with_items_output(self, round_: Round) -> RoundWithItemsOutput:
        """Convert a Round (with items) to the embedded output schema.

        Explicitly loads items via a query — avoids the async-lazy-load pitfall
        where `round_.items` would trigger implicit I/O inside pydantic.
        """
        items = list(
            (
                await self._db.execute(
                    select(RoundItem).where(RoundItem.round_id == round_.id)
                )
            ).scalars().all()
        )
        payload = RoundOutput.model_validate(round_).model_dump()
        payload["items"] = [RoundItemOutput.model_validate(i) for i in items]
        return RoundWithItemsOutput.model_validate(payload)


# ── Module-level helpers ──────────────────────────────────────────────────────


def _now() -> datetime:
    """Return a timezone-aware UTC now — never datetime.now() without UTC."""
    return datetime.now(UTC)
