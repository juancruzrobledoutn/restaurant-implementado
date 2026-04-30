"""
TicketService — domain service for kitchen tickets (C-11).

State machine (see knowledge-base/01-negocio/04_reglas_de_negocio.md §6
and design.md §D-02):
  IN_PROGRESS → READY → DELIVERED
  Cancellation of the parent round from SUBMITTED+ sets the ticket
  is_active=False (not a status transition).

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id — via branch join for tickets
  - Routers stay thin — all state-machine logic lives here
  - NEVER lógica de negocio en routers

Hook pattern (D-02 from design.md):
  - TicketService.create_from_round()/mark_started()/mark_ready()/mark_delivered()
    and cancel_for_round() are called by RoundService within the SAME DB session
    and BEFORE safe_commit. They only mutate; they never commit.
  - TicketService.set_status() is the PUBLIC entry point for the kitchen
    PATCH endpoint — it delegates to RoundService.mark_ready or
    RoundService.serve to keep the cascade consistent.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.constants import KitchenTicketStatus
from shared.config.logging import get_logger
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from rest_api.models.branch import Branch
from rest_api.models.kitchen_ticket import KitchenTicket, KitchenTicketItem
from rest_api.models.menu import Product
from rest_api.models.round import Round, RoundItem
from rest_api.models.sector import BranchSector, Table
from rest_api.models.table_session import TableSession
from rest_api.schemas.kitchen_ticket import (
    KitchenTicketItemOutput,
    KitchenTicketOutput,
)

logger = get_logger(__name__)


def _now() -> datetime:
    """Return a timezone-aware UTC now."""
    return datetime.now(UTC)


class TicketService:
    """
    Domain service for the KitchenTicket state machine.

    All ticket mutations go through this class. RoundService calls the
    `create_from_round`, `mark_started`, `mark_ready`, `mark_delivered`,
    and `cancel_for_round` helpers inside its own transactions — no commits
    here, caller always owns them.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ═══════════════════════════════════════════════════════════════════════
    # Hooks called by RoundService (never commit)
    # ═══════════════════════════════════════════════════════════════════════

    async def create_from_round(self, round_: Round) -> KitchenTicket:
        """
        Create a KitchenTicket + KitchenTicketItem rows for a round just
        transitioned to SUBMITTED. Adds to session but does NOT commit.

        Skips voided round items — voids known at this moment don't get a
        ticket row. Voids that happen AFTER submit keep their existing
        ticket item for forensic "stop cooking" signal.

        Returns the newly-added ticket with `id` populated after flush.
        """
        if not round_.items:
            # RoundService should always flush items before submit — if we
            # get here with empty items it's a bug, not a business rule.
            logger.warning(
                "ticket_service.create_from_round: round %s has no items",
                round_.id,
            )

        ticket = KitchenTicket(
            round_id=round_.id,
            branch_id=round_.branch_id,
            status=KitchenTicketStatus.IN_PROGRESS,
        )
        self._db.add(ticket)
        await self._db.flush()  # need ticket.id for items

        non_voided = [item for item in round_.items if not item.is_voided]
        for ri in non_voided:
            self._db.add(
                KitchenTicketItem(
                    ticket_id=ticket.id,
                    round_item_id=ri.id,
                )
            )
        await self._db.flush()
        return ticket

    async def mark_started(self, round_id: int) -> KitchenTicket | None:
        """
        On SUBMITTED → IN_KITCHEN, stamp the ticket's started_at but keep
        status IN_PROGRESS.

        Returns the ticket (or None if no ticket exists — should not
        happen in practice because submit creates it, but the method is
        defensive).
        """
        ticket = await self._load_ticket_by_round(round_id)
        if ticket is None:
            return None
        ticket.started_at = _now()
        await self._db.flush()
        return ticket

    async def mark_ready(self, round_id: int) -> KitchenTicket | None:
        """On IN_KITCHEN → READY, transition the ticket to READY."""
        ticket = await self._load_ticket_by_round(round_id)
        if ticket is None:
            return None
        ticket.status = KitchenTicketStatus.READY
        ticket.ready_at = _now()
        await self._db.flush()
        return ticket

    async def mark_delivered(self, round_id: int) -> KitchenTicket | None:
        """On READY → SERVED, transition the ticket to DELIVERED."""
        ticket = await self._load_ticket_by_round(round_id)
        if ticket is None:
            return None
        ticket.status = KitchenTicketStatus.DELIVERED
        ticket.delivered_at = _now()
        await self._db.flush()
        return ticket

    async def cancel_for_round(self, round_id: int) -> KitchenTicket | None:
        """
        Soft-delete the ticket for a round being canceled from SUBMITTED+.

        Idempotent — if no ticket exists (cancel from PENDING/CONFIRMED),
        returns None without error.
        """
        ticket = await self._load_ticket_by_round(round_id)
        if ticket is None:
            return None
        ticket.is_active = False
        ticket.deleted_at = _now()
        await self._db.flush()
        return ticket

    # ═══════════════════════════════════════════════════════════════════════
    # Public API — list
    # ═══════════════════════════════════════════════════════════════════════

    async def list_for_kitchen(
        self,
        *,
        branch_id: int,
        tenant_id: int,
        branch_ids: list[int] | None = None,
        status_filter: str | None = None,
    ) -> list[KitchenTicketOutput]:
        """
        List active tickets for the kitchen board.

        Filters:
          - is_active = True (soft-deleted tickets excluded)
          - branch_id match
          - branch.tenant_id match
          - optional status_filter (IN_PROGRESS | READY | DELIVERED)

        Branch scope: raises ForbiddenError if branch_ids is non-None and
        the requested branch is not in it (delegates to router-level check
        when called from the router with the JWT scope).
        """
        if branch_ids is not None and branch_id not in branch_ids:
            raise ForbiddenError(f"No tenés acceso a la sucursal {branch_id}")

        stmt = (
            select(KitchenTicket)
            .join(Branch, Branch.id == KitchenTicket.branch_id)
            .where(
                KitchenTicket.branch_id == branch_id,
                KitchenTicket.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
            .options(
                selectinload(KitchenTicket.items).selectinload(
                    KitchenTicketItem.round_item
                ).selectinload(RoundItem.product),
                selectinload(KitchenTicket.round).selectinload(
                    Round.session
                ).selectinload(TableSession.table).selectinload(Table.sector),
            )
            .order_by(KitchenTicket.created_at.asc())
        )
        if status_filter is not None:
            stmt = stmt.where(KitchenTicket.status == status_filter)

        tickets = list(
            (await self._db.execute(stmt)).scalars().unique().all()
        )
        return [self._to_output(t) for t in tickets]

    # ═══════════════════════════════════════════════════════════════════════
    # Public API — set status (drives round cascade)
    # ═══════════════════════════════════════════════════════════════════════

    async def set_status(
        self,
        *,
        ticket_id: int,
        target_status: str,
        tenant_id: int,
        branch_ids: list[int] | None,
        user_id: int,
        user_role: str,
    ) -> KitchenTicketOutput:
        """
        Move a ticket through its state machine by driving the parent round.

        target=READY: requires round IN_KITCHEN → READY (delegates to
                      RoundService.mark_ready).
        target=DELIVERED: requires round READY → SERVED (delegates to
                          RoundService.serve).

        IN_PROGRESS target is rejected as 400 — tickets are born in
        IN_PROGRESS and only leave via READY or DELIVERED.
        """
        # Import here to avoid a circular import (RoundService imports
        # TicketService at module load time).
        from rest_api.services.domain.round_service import RoundService

        if target_status not in ("READY", "DELIVERED"):
            raise ValidationError(
                f"Estado de ticket inválido: {target_status!r}. "
                f"Los valores permitidos son READY o DELIVERED.",
                field="status",
            )

        ticket = await self._load_ticket_scoped(
            ticket_id=ticket_id,
            tenant_id=tenant_id,
            branch_ids=branch_ids,
        )

        round_service = RoundService(self._db)
        if target_status == "READY":
            await round_service.mark_ready(
                round_id=ticket.round_id,
                tenant_id=tenant_id,
                branch_ids=branch_ids,
                user_id=user_id,
                user_role=user_role,
            )
        else:
            await round_service.serve(
                round_id=ticket.round_id,
                tenant_id=tenant_id,
                branch_ids=branch_ids,
                user_id=user_id,
                user_role=user_role,
            )

        # RoundService committed — reload ticket with eager loads so the
        # response has the full shape.
        refreshed = await self._load_ticket_for_output(ticket_id)
        if refreshed is None:
            # Shouldn't happen — round transitioned successfully so the
            # ticket still exists.
            raise NotFoundError("KitchenTicket", ticket_id)
        return self._to_output(refreshed)

    # ═══════════════════════════════════════════════════════════════════════
    # Private helpers
    # ═══════════════════════════════════════════════════════════════════════

    async def _load_ticket_by_round(self, round_id: int) -> KitchenTicket | None:
        """Load a ticket by its round_id (no tenant check — caller already loaded round)."""
        stmt = select(KitchenTicket).where(
            KitchenTicket.round_id == round_id,
            KitchenTicket.is_active.is_(True),
        )
        return (await self._db.execute(stmt)).scalar_one_or_none()

    async def _load_ticket_scoped(
        self,
        *,
        ticket_id: int,
        tenant_id: int,
        branch_ids: list[int] | None,
    ) -> KitchenTicket:
        """Load a ticket with tenant + branch scope enforcement."""
        stmt = (
            select(KitchenTicket)
            .join(Branch, Branch.id == KitchenTicket.branch_id)
            .where(
                KitchenTicket.id == ticket_id,
                KitchenTicket.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        ticket = (await self._db.execute(stmt)).scalar_one_or_none()
        if ticket is None:
            raise NotFoundError("KitchenTicket", ticket_id)
        if branch_ids is not None and ticket.branch_id not in branch_ids:
            raise ForbiddenError("No tenés acceso a esta sucursal")
        return ticket

    async def _load_ticket_for_output(self, ticket_id: int) -> KitchenTicket | None:
        """Reload ticket with all relations needed for the output schema."""
        stmt = (
            select(KitchenTicket)
            .where(KitchenTicket.id == ticket_id)
            .options(
                selectinload(KitchenTicket.items).selectinload(
                    KitchenTicketItem.round_item
                ).selectinload(RoundItem.product),
                selectinload(KitchenTicket.round).selectinload(
                    Round.session
                ).selectinload(TableSession.table).selectinload(Table.sector),
            )
        )
        return (await self._db.execute(stmt)).scalar_one_or_none()

    # ═══════════════════════════════════════════════════════════════════════
    # Output building
    # ═══════════════════════════════════════════════════════════════════════

    def _to_output(self, ticket: KitchenTicket) -> KitchenTicketOutput:
        """Build KitchenTicketOutput from a ticket with eager-loaded relations."""
        round_ = ticket.round
        session = round_.session if round_ else None
        table = session.table if session else None
        sector: BranchSector | None = None
        try:
            sector = getattr(table, "sector", None)
        except Exception:
            sector = None

        items_out: list[KitchenTicketItemOutput] = []
        for it in ticket.items:
            ri = it.round_item
            product: Product | None = ri.product if ri else None
            items_out.append(
                KitchenTicketItemOutput(
                    id=it.id,
                    round_item_id=it.round_item_id,
                    product_id=ri.product_id if ri else 0,
                    product_name=product.name if product else "",
                    quantity=ri.quantity if ri else 0,
                    notes=ri.notes if ri else None,
                    is_voided=ri.is_voided if ri else False,
                )
            )

        return KitchenTicketOutput(
            id=ticket.id,
            round_id=ticket.round_id,
            round_number=round_.round_number if round_ else 0,
            session_id=round_.session_id if round_ else 0,
            table_id=table.id if table else 0,
            table_number=(
                str(table.number) if table and table.number is not None else None
            ),
            sector_name=sector.name if sector else None,
            branch_id=ticket.branch_id,
            status=ticket.status,
            priority=ticket.priority,
            started_at=ticket.started_at,
            ready_at=ticket.ready_at,
            delivered_at=ticket.delivered_at,
            is_active=ticket.is_active,
            created_at=ticket.created_at,
            updated_at=ticket.updated_at,
            items=items_out,
        )
