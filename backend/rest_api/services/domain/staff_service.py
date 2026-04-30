"""
StaffService — domain service for staff user management.

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id
  - Soft delete only for users (never physical delete)
  - Password hashing via hash_password() from shared.security.password

Design decisions (from design.md):
  - D-05: StaffService handles User+UserBranchRole; WaiterAssignmentService handles assignments
  - D-06: Users filtered by branch via UserBranchRole join (User has no branch_id column)
  - ADMIN only can soft-delete users; MANAGER cannot
  - email unique validation (409-worthy via ValidationError)
  - full_name in DB is 'first_name last_name'; split on read for StaffOut
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.constants import Roles
from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.security.password import hash_password
from shared.utils.exceptions import ForbiddenError, NotFoundError, ValidationError
from rest_api.models.branch import Branch
from rest_api.models.user import User, UserBranchRole
from rest_api.schemas.staff import RoleAssignmentIn, RoleAssignmentOut, StaffCreate, StaffOut, StaffUpdate

logger = get_logger(__name__)


def _user_to_out(user: User) -> StaffOut:
    """Convert User ORM instance to StaffOut schema."""
    # full_name is stored as 'first_name last_name' — split for API response
    parts = (user.full_name or "").split(" ", 1)
    first_name = parts[0] if parts else ""
    last_name = parts[1] if len(parts) > 1 else ""

    # Build assignments from loaded branch_roles
    assignments: list[RoleAssignmentOut] = []
    for role_record in (user.branch_roles or []):
        branch_name = ""
        if role_record.branch:
            branch_name = role_record.branch.name
        assignments.append(
            RoleAssignmentOut(
                branch_id=role_record.branch_id,
                branch_name=branch_name,
                role=role_record.role,
            )
        )

    return StaffOut(
        id=user.id,
        email=user.email,
        first_name=first_name,
        last_name=last_name,
        is_active=user.is_active,
        created_at=user.created_at,
        assignments=assignments,
    )


class StaffService:
    """
    Domain service for staff user CRUD and role assignment management.

    Multi-tenant isolation: all queries filter by tenant_id.
    Branch-scoped listing: joins with UserBranchRole to filter users by branch.
    Soft delete: is_active=False + deleted_at + deleted_by_id.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_user(self, user_id: int, tenant_id: int) -> User:
        """Return active user belonging to tenant, else raise NotFoundError."""
        result = await self._db.execute(
            select(User)
            .where(
                User.id == user_id,
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
            )
            .options(
                selectinload(User.branch_roles).selectinload(UserBranchRole.branch)
            )
        )
        user = result.scalar_one_or_none()
        if not user:
            raise NotFoundError("User", user_id)
        return user

    async def _get_branch(self, branch_id: int, tenant_id: int) -> Branch:
        """Return branch belonging to tenant, else raise ValidationError."""
        branch = await self._db.scalar(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if not branch:
            raise ValidationError(
                f"branch_id={branch_id} does not belong to this tenant",
                field="branch_id",
            )
        return branch

    # ── CRUD ───────────────────────────────────────────────────────────────────

    async def list_users(
        self,
        tenant_id: int,
        branch_id: Optional[int] = None,
        role: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[StaffOut]:
        """
        List active staff users for the tenant.

        Filters:
          branch_id: only users assigned to this branch
          role: only users with this role (in any branch)
        """
        stmt = (
            select(User)
            .where(
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
            )
            .options(
                selectinload(User.branch_roles).selectinload(UserBranchRole.branch)
            )
            .order_by(User.id)
            .limit(min(limit, 100))
            .offset(offset)
        )

        if branch_id is not None:
            stmt = stmt.join(
                UserBranchRole,
                (UserBranchRole.user_id == User.id)
                & (UserBranchRole.branch_id == branch_id),
            )

        if role is not None:
            # If already joined by branch_id, filter on the existing join
            # else join again (distinct)
            if branch_id is None:
                stmt = stmt.join(
                    UserBranchRole,
                    UserBranchRole.user_id == User.id,
                )
            stmt = stmt.where(UserBranchRole.role == role)

        result = await self._db.execute(stmt)
        users = result.scalars().unique().all()
        return [_user_to_out(u) for u in users]

    async def get_by_id(self, user_id: int, tenant_id: int) -> StaffOut:
        """Return a single staff user by ID, scoped to tenant."""
        user = await self._get_user(user_id, tenant_id)
        return _user_to_out(user)

    async def create_user(
        self,
        data: StaffCreate,
        tenant_id: int,
        user_id: int,
    ) -> StaffOut:
        """
        Create a new staff user with optional role assignments.

        Validates email uniqueness (409-worthy ValidationError).
        Hashes password before storing.
        """
        # Check email uniqueness
        existing = await self._db.scalar(
            select(User).where(User.email == data.email)
        )
        if existing:
            raise ValidationError(
                f"A user with email '{data.email}' already exists",
                field="email",
            )

        full_name = f"{data.first_name} {data.last_name}"
        user = User(
            tenant_id=tenant_id,
            email=data.email,
            full_name=full_name,
            hashed_password=hash_password(data.password),
        )
        self._db.add(user)
        await self._db.flush()

        # Create role assignments
        for assignment in data.assignments:
            await self._get_branch(assignment.branch_id, tenant_id)
            role_record = UserBranchRole(
                user_id=user.id,
                branch_id=assignment.branch_id,
                role=assignment.role,
            )
            self._db.add(role_record)

        await self._db.flush()

        # Reload with relationships
        user = await self._get_user(user.id, tenant_id)
        await safe_commit(self._db)

        logger.debug(
            "staff.create_user: id=%s email=%s tenant=%s",
            user.id, user.email, tenant_id,
        )
        return _user_to_out(user)

    async def update_user(
        self,
        user_id: int,
        data: StaffUpdate,
        tenant_id: int,
        actor_user_id: int,
    ) -> StaffOut:
        """
        Update staff user metadata (email, name, password).

        Password is re-hashed if provided. Email uniqueness re-validated.
        """
        user = await self._get_user(user_id, tenant_id)

        update_data = data.model_dump(exclude_unset=True)

        if "email" in update_data and update_data["email"] != user.email:
            existing = await self._db.scalar(
                select(User).where(
                    User.email == update_data["email"],
                    User.id != user_id,
                )
            )
            if existing:
                raise ValidationError(
                    f"A user with email '{update_data['email']}' already exists",
                    field="email",
                )
            user.email = update_data["email"]

        if "password" in update_data:
            user.hashed_password = hash_password(update_data["password"])

        if "first_name" in update_data or "last_name" in update_data:
            parts = (user.full_name or "").split(" ", 1)
            first = update_data.get("first_name", parts[0] if parts else "")
            last = update_data.get("last_name", parts[1] if len(parts) > 1 else "")
            user.full_name = f"{first} {last}"

        await self._db.flush()
        user = await self._get_user(user_id, tenant_id)
        await safe_commit(self._db)

        return _user_to_out(user)

    async def soft_delete_user(
        self,
        user_id: int,
        tenant_id: int,
        actor_user_id: int,
        actor_roles: list[str],
    ) -> None:
        """
        Soft-delete a staff user. ADMIN only — raises ForbiddenError for MANAGER.

        Sets is_active=False, deleted_at=now, deleted_by_id=actor_user_id.
        """
        if Roles.ADMIN not in actor_roles:
            raise ForbiddenError("Only ADMIN can delete staff users")

        user = await self._get_user(user_id, tenant_id)
        now = datetime.now(UTC)
        user.is_active = False
        user.deleted_at = now
        user.deleted_by_id = actor_user_id

        await safe_commit(self._db)
        logger.debug(
            "staff.soft_delete_user: id=%s deleted_by=%s tenant=%s",
            user_id, actor_user_id, tenant_id,
        )

    # ── Role assignment management ─────────────────────────────────────────────

    async def assign_role_to_branch(
        self,
        user_id: int,
        tenant_id: int,
        assignment: RoleAssignmentIn,
    ) -> StaffOut:
        """
        Assign or update a role for a user on a specific branch (upsert).

        If (user_id, branch_id, role) already exists — returns current state.
        If user has a different role on the branch — adds the new role record.
        """
        user = await self._get_user(user_id, tenant_id)
        await self._get_branch(assignment.branch_id, tenant_id)

        # Check if this exact combination already exists
        existing = await self._db.scalar(
            select(UserBranchRole).where(
                UserBranchRole.user_id == user_id,
                UserBranchRole.branch_id == assignment.branch_id,
                UserBranchRole.role == assignment.role,
            )
        )
        if not existing:
            role_record = UserBranchRole(
                user_id=user_id,
                branch_id=assignment.branch_id,
                role=assignment.role,
            )
            self._db.add(role_record)
            await self._db.flush()

        user = await self._get_user(user_id, tenant_id)
        await safe_commit(self._db)
        return _user_to_out(user)

    async def revoke_role_from_branch(
        self,
        user_id: int,
        tenant_id: int,
        branch_id: int,
    ) -> None:
        """
        Hard-delete all UserBranchRole records for this user+branch combination.

        Hard delete (not soft) — UserBranchRole is a join table, no AuditMixin.
        """
        await self._get_user(user_id, tenant_id)  # Validates user belongs to tenant

        records = await self._db.execute(
            select(UserBranchRole).where(
                UserBranchRole.user_id == user_id,
                UserBranchRole.branch_id == branch_id,
            )
        )
        role_records = records.scalars().all()
        for record in role_records:
            await self._db.delete(record)

        await safe_commit(self._db)
        logger.debug(
            "staff.revoke_role_from_branch: user_id=%s branch_id=%s",
            user_id, branch_id,
        )
