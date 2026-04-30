"""
DinerService — domain service for diner registration (C-08).

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - Diner can only be added to an OPEN session (not PAYING or CLOSED)

A diner belongs to a session which belongs to a branch which belongs to a tenant.
Tenant isolation is therefore enforced via the FK chain, not a direct tenant_id column.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.table_session import Diner, TableSession
from rest_api.schemas.table_session import DinerOutput

logger = get_logger(__name__)


class DinerService:
    """
    Domain service for diner registration within a table session.

    A diner can only join a session in OPEN status.
    Multiple diners can join the same session.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    def _to_output(self, diner: Diner) -> DinerOutput:
        return DinerOutput.model_validate(diner)

    async def _get_session(self, session_id: int) -> TableSession:
        """Load a session by ID. Raises NotFoundError if missing or soft-deleted."""
        result = await self._db.execute(
            select(TableSession).where(
                TableSession.id == session_id,
                TableSession.is_active.is_(True),
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            raise NotFoundError("TableSession", session_id)
        return session

    async def register(
        self,
        *,
        session_id: int,
        name: str,
        device_id: str | None = None,
    ) -> Diner:
        """
        Register a new diner in a table session.

        Validation:
          - Session must exist and be soft-active
          - Session status must be OPEN (not PAYING or CLOSED)

        Returns the raw Diner ORM instance (callers need it for token issuance).
        """
        session = await self._get_session(session_id)

        if session.status != "OPEN":
            raise ValidationError(
                f"No se puede registrar un comensal en una sesión con status={session.status!r}. "
                "La sesión debe estar en estado OPEN.",
                field="session_id",
            )

        diner = Diner(
            session_id=session_id,
            name=name,
            device_id=device_id,
        )
        self._db.add(diner)
        await self._db.flush()
        await self._db.refresh(diner)
        await safe_commit(self._db)

        logger.debug(
            "diner.register: diner_id=%s session_id=%s name=%r",
            diner.id, session_id, name,
        )
        return diner
