"""
BranchSector, Table, and WaiterSectorAssignment models.

Tables:
  - branch_sector: physical zones/areas within a branch (e.g., salon, terraza)
  - app_table: individual tables inside a sector (app_ prefix: 'table' is reserved)
  - waiter_sector_assignment: daily assignment of a waiter to a sector

Rules:
  - branch_sector and app_table use AuditMixin (soft-delete, audit trail)
  - waiter_sector_assignment has NO AuditMixin — ephemeral daily record, hard-deleted
  - All FK ondelete=RESTRICT to prevent accidental cascades at DB level
  - Table status is a string enum: AVAILABLE | OCCUPIED | RESERVED | OUT_OF_SERVICE
"""
from datetime import date

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class BranchSector(Base, AuditMixin):
    """
    A physical sector/zone within a Branch (e.g., 'Salón', 'Terraza', 'Bar').

    Multi-tenant isolation: enforced via branch.tenant_id join — no direct
    tenant_id column needed here, tenant ownership is resolved through branch.
    """

    __tablename__ = "branch_sector"
    __table_args__ = (
        Index("ix_branch_sector_branch_id", "branch_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Relationships
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        back_populates="sectors",
    )
    tables: Mapped[list["Table"]] = relationship(
        "Table",
        back_populates="sector",
        cascade="all, delete-orphan",
        lazy="select",
    )
    assignments: Mapped[list["WaiterSectorAssignment"]] = relationship(
        "WaiterSectorAssignment",
        back_populates="sector",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<BranchSector id={self.id} branch_id={self.branch_id} name={self.name!r}>"


class Table(Base, AuditMixin):
    """
    An individual table within a BranchSector.

    Table name 'app_table' — 'table' is an SQL reserved word.
    code must be unique within a branch (e.g., 'T01', 'BAR-3').
    status is a runtime toggle: AVAILABLE | OCCUPIED | RESERVED | OUT_OF_SERVICE
    """

    __tablename__ = "app_table"
    __table_args__ = (
        UniqueConstraint("branch_id", "code", name="uq_table_branch_code"),
        Index("ix_table_branch_id", "branch_id"),
        Index("ix_table_sector_id", "sector_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch.id", ondelete="RESTRICT"),
        nullable=False,
    )
    sector_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch_sector.id", ondelete="RESTRICT"),
        nullable=False,
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="AVAILABLE",
        server_default="AVAILABLE",
    )

    # Relationships
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        back_populates="tables",
    )
    sector: Mapped["BranchSector"] = relationship(
        "BranchSector",
        back_populates="tables",
    )
    # C-08: back-populated from TableSession — ORM-only, no schema change
    sessions: Mapped[list["TableSession"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "TableSession",
        back_populates="table",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<Table id={self.id} code={self.code!r} "
            f"sector_id={self.sector_id} status={self.status!r}>"
        )


class WaiterSectorAssignment(Base):
    """
    Daily assignment of a waiter to a sector.

    No AuditMixin — this is an ephemeral operational record that gets
    hard-deleted, not soft-deleted. One waiter per sector per date
    (UniqueConstraint). Indexed by (sector_id, date) for fast daily lookups.
    """

    __tablename__ = "waiter_sector_assignment"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "sector_id", "date",
            name="uq_waiter_sector_date",
        ),
        Index("ix_waiter_sector_assignment_sector_date", "sector_id", "date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    sector_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch_sector.id", ondelete="RESTRICT"),
        nullable=False,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)

    # Relationships
    user: Mapped["User"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "User",
        lazy="select",
    )
    sector: Mapped["BranchSector"] = relationship(
        "BranchSector",
        back_populates="assignments",
    )

    def __repr__(self) -> str:
        return (
            f"<WaiterSectorAssignment id={self.id} "
            f"user_id={self.user_id} sector_id={self.sector_id} date={self.date}>"
        )
