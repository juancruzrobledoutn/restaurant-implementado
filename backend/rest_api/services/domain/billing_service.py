"""
BillingService — domain service for billing (C-12).

State machines:
  - TableSession: OPEN → PAYING → CLOSED
  - Check (app_check): REQUESTED → PAID
  - Payment: PENDING → APPROVED | REJECTED

Architecture (design.md):
  - BillingService is the ONLY orchestrator of TableSession billing transitions.
    No router or other service may set session.status = 'PAYING' or 'CLOSED'.
  - FIFO allocation uses SELECT FOR UPDATE on charges to serialize concurrent payments.
  - Outbox events for all financial operations (at-least-once guarantee):
      CHECK_REQUESTED, CHECK_PAID, PAYMENT_APPROVED, PAYMENT_REJECTED
  - MercadoPago abstraction: BillingService depends on PaymentGateway ABC,
    never on MercadoPagoGateway directly.
  - Multi-tenant guard enforced on every public method.

Split methods:
  - equal_split: total // n per diner, last diner absorbs residual.
  - by_consumption: sum of each diner's round_items (price_cents_snapshot × qty).
    Shared items (diner_id=None) split equally across all diners.
  - custom: caller provides dict[diner_id, amount_cents]. Sum must equal total_cents.

Rules (NON-NEGOTIABLE):
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id
  - Prices in integer cents, never float
  - NEVER bypass tenant isolation check
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.constants import (
    BillingEventType,
    CheckStatus,
    PaymentStatus,
    SessionStatus,
)
from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import ConflictError, NotFoundError, ValidationError
from rest_api.models.billing import Allocation, Charge, Check, Payment
from rest_api.models.branch import Branch
from rest_api.models.round import Round, RoundItem
from rest_api.models.table_session import Diner, TableSession
from rest_api.schemas.billing import (
    AllocationOut,
    ChargeOut,
    CheckOut,
    MPPreferenceOut,
    PaymentOut,
    PaymentStatusOut,
)
from rest_api.services.domain.outbox_service import OutboxService
from rest_api.services.payment_gateway import PaymentGateway

logger = get_logger(__name__)


class BillingService:
    """
    Domain service for the complete billing lifecycle.

    Responsibilities:
      - request_check(): create app_check + charges, transition session to PAYING
      - register_manual_payment(): process cash/card/transfer payments
      - process_mp_webhook(): handle MercadoPago IPN with idempotency
      - create_mp_preference(): create MP preference, return init_point
      - get_check(): return full check with charges (remaining_cents) + payments
      - _allocate(): FIFO allocation engine
      - _resolve_check(): check if all charges paid, transition to PAID + CLOSED
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ─── Public API ────────────────────────────────────────────────────────────

    async def request_check(
        self,
        *,
        session_id: int,
        split_method: str,
        tenant_id: int,
        custom_split: dict[int, int] | None = None,
    ) -> CheckOut:
        """
        Transition session from OPEN → PAYING and create app_check with charges.

        Flow:
          1. Load session with FOR UPDATE lock, validate OPEN.
          2. Verify no existing check for this session.
          3. Compute total from SERVED (non-voided) round items.
          4. Calculate charges by split method.
          5. Create app_check + Charge rows.
          6. Set session.status = PAYING.
          7. Write CHECK_REQUESTED outbox event.
          8. safe_commit(db).

        Raises:
            NotFoundError: session not found or not in tenant.
            ConflictError: session not OPEN, or check already exists.
            ValidationError: custom_split sum mismatch.
        """
        # Load session with lock — prevents concurrent check requests
        session = await self._get_session_for_update(session_id, tenant_id)

        if session.status != SessionStatus.OPEN:
            raise ConflictError(
                f"La sesión id={session_id} está en status={session.status!r}. "
                "Solo se puede solicitar cuenta en status OPEN.",
            )

        # Guard: one check per session
        existing_check = await self._db.scalar(
            select(Check).where(Check.session_id == session_id)
        )
        if existing_check:
            raise ConflictError(
                f"La sesión id={session_id} ya tiene un check (id={existing_check.id}, "
                f"status={existing_check.status!r})."
            )

        # Get all active diners for this session
        diners_result = await self._db.execute(
            select(Diner).where(
                Diner.session_id == session_id,
                Diner.is_active.is_(True),
            )
        )
        diners = diners_result.scalars().all()

        if not diners:
            raise ValidationError(
                "La sesión no tiene comensales activos. No se puede crear un check.",
                field="session_id",
            )

        # Compute total from non-voided, SERVED round items
        total_cents = await self._compute_session_total(session_id)

        if total_cents == 0:
            raise ValidationError(
                "El total de la sesión es 0 centavos. No hay nada que cobrar.",
                field="session_id",
            )

        # Calculate charges by split method
        diner_amounts = await self._calculate_charges(
            session_id=session_id,
            split_method=split_method,
            total_cents=total_cents,
            diners=list(diners),
            custom_split=custom_split,
        )

        # Create app_check
        check = Check(
            session_id=session_id,
            branch_id=session.branch_id,
            tenant_id=tenant_id,
            total_cents=total_cents,
            status=CheckStatus.REQUESTED,
        )
        self._db.add(check)
        await self._db.flush()  # get check.id

        # Create charge rows
        charges = []
        for diner_id, amount in diner_amounts:
            description = f"Diner {diner_id}" if diner_id else "Consumo compartido"
            charge = Charge(
                check_id=check.id,
                diner_id=diner_id,
                amount_cents=amount,
                description=description,
            )
            self._db.add(charge)
            charges.append(charge)

        # Transition session to PAYING (BillingService owns this transition)
        session.status = SessionStatus.PAYING

        await self._db.flush()

        # Write outbox event atomically
        await OutboxService.write_event(
            db=self._db,
            event_type=BillingEventType.CHECK_REQUESTED,
            payload={
                "check_id": check.id,
                "session_id": session_id,
                "branch_id": session.branch_id,
                "tenant_id": tenant_id,
                "total_cents": total_cents,
                "split_method": split_method,
            },
        )

        await safe_commit(self._db)
        await self._db.refresh(check)
        for charge in charges:
            await self._db.refresh(charge)

        logger.info(
            "billing.request_check: check_id=%s session_id=%s total_cents=%s split=%s",
            check.id, session_id, total_cents, split_method,
        )

        return await self.get_check(session_id=session_id, tenant_id=tenant_id)

    async def register_manual_payment(
        self,
        *,
        check_id: int,
        amount_cents: int,
        method: str,
        tenant_id: int,
        reference: str | None = None,
    ) -> PaymentOut:
        """
        Register a cash/card/transfer payment (waiter-initiated).

        Flow:
          1. Load check with FOR UPDATE lock, validate REQUESTED.
          2. Verify tenant isolation.
          3. Create Payment(status=APPROVED).
          4. Run FIFO allocation.
          5. Write PAYMENT_APPROVED outbox event.
          6. If all charges covered: write CHECK_PAID event + _resolve_check().
          7. safe_commit(db).

        Raises:
            NotFoundError: check not found.
            ConflictError: check not in REQUESTED status.
            ValidationError: amount_cents <= 0.
        """
        if amount_cents <= 0:
            raise ValidationError("amount_cents debe ser mayor que 0", field="amount_cents")

        check, session = await self._get_check_and_session_for_update(check_id, tenant_id)

        if check.status != CheckStatus.REQUESTED:
            raise ConflictError(
                f"El check id={check_id} está en status={check.status!r}. "
                "Solo se pueden registrar pagos en checks con status REQUESTED.",
            )

        # Create payment
        payment = Payment(
            check_id=check_id,
            amount_cents=amount_cents,
            method=method,
            status=PaymentStatus.APPROVED,
            external_id=reference,
        )
        self._db.add(payment)
        await self._db.flush()  # get payment.id

        # FIFO allocation
        await self._allocate(payment=payment, check_id=check_id)

        # Write PAYMENT_APPROVED outbox event
        await OutboxService.write_event(
            db=self._db,
            event_type=BillingEventType.PAYMENT_APPROVED,
            payload={
                "payment_id": payment.id,
                "check_id": check_id,
                "amount_cents": amount_cents,
                "method": method,
                "branch_id": check.branch_id,
                "tenant_id": tenant_id,
            },
        )

        # Resolve check if fully paid
        await self._resolve_check(check=check, session=session, tenant_id=tenant_id)

        await safe_commit(self._db)
        await self._db.refresh(payment)

        logger.info(
            "billing.register_manual_payment: payment_id=%s check_id=%s amount_cents=%s",
            payment.id, check_id, amount_cents,
        )

        # Load allocations for response
        alloc_result = await self._db.execute(
            select(Allocation).where(Allocation.payment_id == payment.id)
        )
        allocations = alloc_result.scalars().all()

        return PaymentOut(
            id=payment.id,
            check_id=payment.check_id,
            amount_cents=payment.amount_cents,
            method=payment.method,
            status=payment.status,
            external_id=payment.external_id,
            created_at=payment.created_at,
            allocations=[AllocationOut.model_validate(a) for a in allocations],
        )

    async def process_mp_webhook(
        self,
        *,
        external_id: str,
        mp_status: str,
        amount_cents: int,
        tenant_id: int,
        check_id: int | None = None,
    ) -> None:
        """
        Process a MercadoPago IPN webhook.

        Idempotent: if payment with external_id already exists and is in a
        terminal state (APPROVED or REJECTED), returns without reprocessing.

        Flow:
          1. Check for existing payment by external_id.
          2. If already terminal: return (idempotent).
          3. If PENDING payment exists: update status.
          4. If APPROVED: run FIFO allocation + possibly resolve check.
          5. If REJECTED: write PAYMENT_REJECTED outbox event.
          6. safe_commit(db).

        Raises:
            NotFoundError: If external_id not found and check_id not provided.
        """
        # Idempotency check: look up by external_id
        existing_payment = await self._db.scalar(
            select(Payment).where(Payment.external_id == external_id)
        )

        if existing_payment and existing_payment.status in (
            PaymentStatus.APPROVED, PaymentStatus.REJECTED
        ):
            logger.info(
                "billing.process_mp_webhook: duplicate external_id=%s already %s — skip",
                external_id, existing_payment.status,
            )
            return

        if existing_payment:
            # Update the PENDING payment to terminal status
            payment = existing_payment
            check = await self._get_check_by_id(payment.check_id, tenant_id)
            session = await self._get_session(check.session_id)
        else:
            # Payment created by create_mp_preference, find via check_id
            if not check_id:
                raise NotFoundError("Payment with external_id", external_id)

            check, session = await self._get_check_and_session_for_update(check_id, tenant_id)

            # Find the PENDING payment for this check with no external_id
            payment = await self._db.scalar(
                select(Payment).where(
                    Payment.check_id == check_id,
                    Payment.status == PaymentStatus.PENDING,
                    Payment.external_id.is_(None),
                )
            )
            if not payment:
                raise NotFoundError("Pending payment for check", check_id)

        # Update payment external_id and status
        payment.external_id = external_id
        payment.status = PaymentStatus.APPROVED if mp_status == "approved" else PaymentStatus.REJECTED

        await self._db.flush()

        if payment.status == PaymentStatus.APPROVED:
            if amount_cents > 0:
                payment.amount_cents = amount_cents
            await self._allocate(payment=payment, check_id=payment.check_id)
            await OutboxService.write_event(
                db=self._db,
                event_type=BillingEventType.PAYMENT_APPROVED,
                payload={
                    "payment_id": payment.id,
                    "check_id": payment.check_id,
                    "amount_cents": payment.amount_cents,
                    "method": payment.method,
                    "external_id": external_id,
                    "branch_id": check.branch_id,
                    "tenant_id": tenant_id,
                },
            )
            await self._resolve_check(check=check, session=session, tenant_id=tenant_id)
        else:
            await OutboxService.write_event(
                db=self._db,
                event_type=BillingEventType.PAYMENT_REJECTED,
                payload={
                    "payment_id": payment.id,
                    "check_id": payment.check_id,
                    "external_id": external_id,
                    "branch_id": check.branch_id,
                    "tenant_id": tenant_id,
                },
            )

        await safe_commit(self._db)

        logger.info(
            "billing.process_mp_webhook: external_id=%s status=%s payment_id=%s",
            external_id, payment.status, payment.id,
        )

    async def create_mp_preference(
        self,
        *,
        check_id: int,
        tenant_id: int,
        gateway: PaymentGateway,
    ) -> MPPreferenceOut:
        """
        Create a MercadoPago payment preference.

        Creates a PENDING payment record before calling the gateway.
        The preference_id is stored for idempotency when the IPN arrives.

        Flow:
          1. Load check, validate REQUESTED + tenant.
          2. Create Payment(status=PENDING, method=mercadopago).
          3. Call gateway.create_preference().
          4. safe_commit(db).
          5. Return MPPreferenceOut.

        Raises:
            NotFoundError: check not found.
            ConflictError: check not in REQUESTED status.
        """
        check, _ = await self._get_check_and_session_for_update(check_id, tenant_id)

        if check.status != CheckStatus.REQUESTED:
            raise ConflictError(
                f"El check id={check_id} está en status={check.status!r}. "
                "Solo se puede crear una preferencia para checks en REQUESTED.",
            )

        # Create PENDING payment record
        payment = Payment(
            check_id=check_id,
            amount_cents=check.total_cents,
            method="mercadopago",
            status=PaymentStatus.PENDING,
        )
        self._db.add(payment)
        await self._db.flush()

        # Build items list for MP
        charges_result = await self._db.execute(
            select(Charge).where(
                Charge.check_id == check_id,
                Charge.is_active.is_(True),
            )
        )
        charges = charges_result.scalars().all()

        items = [
            {
                "title": c.description or f"Cargo {c.id}",
                "unit_price_cents": c.amount_cents,
                "quantity": 1,
            }
            for c in charges
        ]

        # Call gateway (MP API)
        preference_id, init_point = await gateway.create_preference(
            check_id=check_id,
            total_cents=check.total_cents,
            items=items,
        )

        # Store preference_id as external_id on the payment for lookup
        payment.external_id = preference_id

        await safe_commit(self._db)

        logger.info(
            "billing.create_mp_preference: check_id=%s payment_id=%s preference_id=%s",
            check_id, payment.id, preference_id,
        )

        return MPPreferenceOut(preference_id=preference_id, init_point=init_point)

    async def get_check(self, *, session_id: int, tenant_id: int) -> CheckOut:
        """
        Return the full check for a session, including charges with remaining_cents
        and payments with their allocations.

        Raises:
            NotFoundError: no check found for this session.
            ConflictError: check belongs to a different tenant (isolation).
        """
        check = await self._db.scalar(
            select(Check).where(Check.session_id == session_id)
        )
        if not check:
            raise NotFoundError("Check for session", session_id)

        if check.tenant_id != tenant_id:
            raise ConflictError(
                f"El check id={check.id} no pertenece al tenant id={tenant_id}."
            )

        return await self._build_check_out(check)

    async def get_payment_status(self, *, payment_id: int, tenant_id: int) -> PaymentStatusOut:
        """
        Return lightweight payment status.

        Raises:
            NotFoundError: payment not found.
            ConflictError: payment belongs to different tenant.
        """
        payment = await self._db.scalar(
            select(Payment).where(Payment.id == payment_id)
        )
        if not payment:
            raise NotFoundError("Payment", payment_id)

        check = await self._db.scalar(
            select(Check).where(Check.id == payment.check_id)
        )
        if not check or check.tenant_id != tenant_id:
            raise ConflictError(
                f"El pago id={payment_id} no pertenece al tenant id={tenant_id}."
            )

        return PaymentStatusOut(
            id=payment.id,
            status=payment.status,
            amount_cents=payment.amount_cents,
            method=payment.method,
        )

    # ─── Private helpers ────────────────────────────────────────────────────────

    async def _get_session_for_update(
        self, session_id: int, tenant_id: int
    ) -> TableSession:
        """Load session with FOR UPDATE lock, validate tenant ownership via branch join."""
        result = await self._db.execute(
            select(TableSession)
            .join(Branch, Branch.id == TableSession.branch_id)
            .where(
                TableSession.id == session_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
            .with_for_update()
        )
        session = result.scalar_one_or_none()
        if not session:
            raise NotFoundError("TableSession", session_id)
        return session

    async def _get_session(self, session_id: int) -> TableSession:
        """Load session without lock (for read-only access)."""
        result = await self._db.execute(
            select(TableSession).where(TableSession.id == session_id)
        )
        session = result.scalar_one_or_none()
        if not session:
            raise NotFoundError("TableSession", session_id)
        return session

    async def _get_check_by_id(self, check_id: int, tenant_id: int) -> Check:
        """Load check by id, validate tenant ownership."""
        check = await self._db.scalar(
            select(Check).where(Check.id == check_id)
        )
        if not check:
            raise NotFoundError("Check", check_id)
        if check.tenant_id != tenant_id:
            raise ConflictError(
                f"El check id={check_id} no pertenece al tenant id={tenant_id}."
            )
        return check

    async def _get_check_and_session_for_update(
        self, check_id: int, tenant_id: int
    ) -> tuple[Check, TableSession]:
        """Load check + session with FOR UPDATE lock on session."""
        check = await self._db.scalar(
            select(Check).where(Check.id == check_id)
        )
        if not check:
            raise NotFoundError("Check", check_id)

        # Tenant guard
        if check.tenant_id != tenant_id:
            raise ConflictError(
                f"El check id={check_id} no pertenece al tenant id={tenant_id}."
            )

        session = await self._get_session_for_update(check.session_id, tenant_id)
        return check, session

    async def _compute_session_total(self, session_id: int) -> int:
        """
        Compute total from non-voided SERVED round items for a session.

        Uses price_cents_snapshot × quantity — the price at order time.
        """
        result = await self._db.execute(
            select(func.coalesce(
                func.sum(RoundItem.price_cents_snapshot * RoundItem.quantity),
                0
            ))
            .join(Round, Round.id == RoundItem.round_id)
            .where(
                Round.session_id == session_id,
                Round.status == "SERVED",
                Round.is_active.is_(True),
                RoundItem.is_voided.is_(False),
                RoundItem.is_active.is_(True),
            )
        )
        total = result.scalar_one()
        return int(total)

    async def _calculate_charges(
        self,
        *,
        session_id: int,
        split_method: str,
        total_cents: int,
        diners: list[Diner],
        custom_split: dict[int, int] | None,
    ) -> list[tuple[int | None, int]]:
        """
        Calculate charge amounts per diner based on split method.

        Returns list of (diner_id, amount_cents) tuples.
        diner_id may be None for shared charges.
        """
        if split_method == "equal_split":
            return self._split_equal(total_cents, diners)
        elif split_method == "by_consumption":
            return await self._split_by_consumption(session_id, diners, total_cents)
        elif split_method == "custom":
            if not custom_split:
                raise ValidationError(
                    "custom_split es requerido cuando split_method='custom'",
                    field="custom_split",
                )
            return self._split_custom(total_cents, custom_split)
        else:
            raise ValidationError(
                f"split_method inválido: {split_method!r}. "
                "Valores válidos: equal_split, by_consumption, custom.",
                field="split_method",
            )

    def _split_equal(
        self,
        total_cents: int,
        diners: list[Diner],
    ) -> list[tuple[int | None, int]]:
        """
        Distribute total equally. Last diner absorbs rounding residual.

        Example: total=1001, 3 diners → [333, 333, 335]
        """
        n = len(diners)
        if n == 0:
            return []

        base = total_cents // n
        residual = total_cents - (base * n)

        result = []
        for i, diner in enumerate(diners):
            amount = base + (residual if i == n - 1 else 0)
            result.append((diner.id, amount))
        return result

    async def _split_by_consumption(
        self,
        session_id: int,
        diners: list[Diner],
        total_cents: int,
    ) -> list[tuple[int | None, int]]:
        """
        Charge each diner their own consumption. Shared items split equally.

        Groups SERVED, non-voided round items by diner_id. Items with
        diner_id=None (shared) are split equally across all diners.
        """
        # Fetch all relevant round items
        result = await self._db.execute(
            select(RoundItem.diner_id,
                   func.sum(RoundItem.price_cents_snapshot * RoundItem.quantity).label("subtotal"))
            .join(Round, Round.id == RoundItem.round_id)
            .where(
                Round.session_id == session_id,
                Round.status == "SERVED",
                Round.is_active.is_(True),
                RoundItem.is_voided.is_(False),
                RoundItem.is_active.is_(True),
            )
            .group_by(RoundItem.diner_id)
        )
        rows = result.all()

        # Build diner_id → amount map
        per_diner: dict[int, int] = {}
        shared_total = 0

        diner_ids = {d.id for d in diners}

        for row in rows:
            diner_id, subtotal = row.diner_id, int(row.subtotal or 0)
            if diner_id is None:
                shared_total += subtotal
            elif diner_id in diner_ids:
                per_diner[diner_id] = per_diner.get(diner_id, 0) + subtotal

        # Distribute shared items equally
        if shared_total > 0 and diners:
            n = len(diners)
            shared_base = shared_total // n
            shared_residual = shared_total - (shared_base * n)
            for i, diner in enumerate(diners):
                share = shared_base + (shared_residual if i == n - 1 else 0)
                per_diner[diner.id] = per_diner.get(diner.id, 0) + share

        # Ensure all diners are represented
        charges = []
        for diner in diners:
            amount = per_diner.get(diner.id, 0)
            if amount > 0:
                charges.append((diner.id, amount))

        # If no charges found, fall back to equal split
        if not charges:
            return self._split_equal(total_cents, diners)

        return charges

    def _split_custom(
        self,
        total_cents: int,
        custom_split: dict[int, int],
    ) -> list[tuple[int | None, int]]:
        """
        Use caller-provided per-diner amounts.

        Raises:
            ValidationError: if sum of amounts != total_cents.
        """
        total_provided = sum(custom_split.values())
        if total_provided != total_cents:
            raise ValidationError(
                f"La suma de custom_split ({total_provided}) no coincide con "
                f"el total del check ({total_cents}). Diferencia: {total_cents - total_provided}.",
                field="custom_split",
            )

        return [(diner_id, amount) for diner_id, amount in custom_split.items() if amount > 0]

    async def _remaining_cents(self, charge_id: int) -> int:
        """
        Compute remaining cents for a charge.

        remaining = charge.amount_cents - SUM(allocation.amount_cents WHERE charge_id)
        """
        charge = await self._db.scalar(
            select(Charge).where(Charge.id == charge_id)
        )
        if not charge:
            return 0

        allocated = await self._db.scalar(
            select(func.coalesce(func.sum(Allocation.amount_cents), 0))
            .where(Allocation.charge_id == charge_id)
        )
        return charge.amount_cents - int(allocated or 0)

    async def _allocate(self, *, payment: Payment, check_id: int) -> None:
        """
        FIFO allocation: apply payment amount to charges ordered by created_at ASC.

        Uses SELECT FOR UPDATE on charges to serialize concurrent payments.
        Creates Allocation rows until payment.amount_cents is exhausted.
        """
        # SELECT FOR UPDATE on charges with remaining > 0
        result = await self._db.execute(
            select(Charge)
            .where(
                Charge.check_id == check_id,
                Charge.is_active.is_(True),
            )
            .order_by(Charge.created_at.asc())
            .with_for_update()
        )
        charges = result.scalars().all()

        remaining_payment = payment.amount_cents

        for charge in charges:
            if remaining_payment <= 0:
                break

            remaining_charge = await self._remaining_cents(charge.id)
            if remaining_charge <= 0:
                continue

            # Allocate min(remaining_payment, remaining_charge)
            allocate_amount = min(remaining_payment, remaining_charge)

            allocation = Allocation(
                charge_id=charge.id,
                payment_id=payment.id,
                amount_cents=allocate_amount,
            )
            self._db.add(allocation)
            remaining_payment -= allocate_amount

        await self._db.flush()

    async def _resolve_check(
        self,
        *,
        check: Check,
        session: TableSession,
        tenant_id: int,
    ) -> bool:
        """
        Check if all charges are fully covered. If so, transition to PAID + CLOSED.

        Returns True if check was resolved, False otherwise.
        """
        # Sum all charges
        total_charged = await self._db.scalar(
            select(func.coalesce(func.sum(Charge.amount_cents), 0))
            .where(
                Charge.check_id == check.id,
                Charge.is_active.is_(True),
            )
        )
        total_charged = int(total_charged or 0)

        # Sum all allocations
        total_allocated = await self._db.scalar(
            select(func.coalesce(func.sum(Allocation.amount_cents), 0))
            .join(Charge, Charge.id == Allocation.charge_id)
            .where(Charge.check_id == check.id)
        )
        total_allocated = int(total_allocated or 0)

        if total_allocated < total_charged:
            return False  # Not fully paid yet

        # Transition check to PAID
        check.status = CheckStatus.PAID

        # Transition session to CLOSED
        session.status = SessionStatus.CLOSED
        session.is_active = False

        await self._db.flush()

        # Write CHECK_PAID outbox event
        await OutboxService.write_event(
            db=self._db,
            event_type=BillingEventType.CHECK_PAID,
            payload={
                "check_id": check.id,
                "session_id": check.session_id,
                "branch_id": check.branch_id,
                "tenant_id": tenant_id,
                "total_cents": check.total_cents,
            },
        )

        logger.info(
            "billing.resolve_check: check_id=%s session_id=%s → PAID/CLOSED",
            check.id, check.session_id,
        )
        return True

    async def _build_check_out(self, check: Check) -> CheckOut:
        """Build a full CheckOut with charges (+ remaining_cents) and payments."""
        # Load charges with their allocations
        charges_result = await self._db.execute(
            select(Charge)
            .where(Charge.check_id == check.id, Charge.is_active.is_(True))
            .options(selectinload(Charge.allocations))
            .order_by(Charge.created_at.asc())
        )
        charges = charges_result.scalars().all()

        charge_outs = []
        for charge in charges:
            remaining = await self._remaining_cents(charge.id)
            charge_outs.append(
                ChargeOut(
                    id=charge.id,
                    check_id=charge.check_id,
                    diner_id=charge.diner_id,
                    amount_cents=charge.amount_cents,
                    description=charge.description,
                    remaining_cents=remaining,
                    allocations=[AllocationOut.model_validate(a) for a in charge.allocations],
                )
            )

        # Load payments with their allocations
        payments_result = await self._db.execute(
            select(Payment)
            .where(Payment.check_id == check.id, Payment.is_active.is_(True))
            .options(selectinload(Payment.allocations))
            .order_by(Payment.created_at.asc())
        )
        payments = payments_result.scalars().all()

        payment_outs = [
            PaymentOut(
                id=p.id,
                check_id=p.check_id,
                amount_cents=p.amount_cents,
                method=p.method,
                status=p.status,
                external_id=p.external_id,
                created_at=p.created_at,
                allocations=[AllocationOut.model_validate(a) for a in p.allocations],
            )
            for p in payments
        ]

        return CheckOut(
            id=check.id,
            session_id=check.session_id,
            branch_id=check.branch_id,
            tenant_id=check.tenant_id,
            total_cents=check.total_cents,
            status=check.status,
            created_at=check.created_at,
            charges=charge_outs,
            payments=payment_outs,
        )
