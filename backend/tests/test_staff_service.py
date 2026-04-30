"""
Tests for StaffService.

Coverage:
  - ADMIN creates/updates/soft-deletes user
  - MANAGER cannot delete (ForbiddenError)
  - Email uniqueness → ValidationError (409-worthy)
  - Password is hashed (never plaintext in DB)
  - Multi-tenant isolation (tenant 2 users invisible to tenant 1 ADMIN)
  - assign_role_to_branch upserts
  - revoke_role_from_branch hard-deletes
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.tenant import Tenant
from rest_api.models.user import User, UserBranchRole
from rest_api.schemas.staff import RoleAssignmentIn, StaffCreate, StaffUpdate
from rest_api.services.domain.staff_service import StaffService
from shared.config.constants import Roles
from shared.security.password import verify_password
from shared.utils.exceptions import ForbiddenError, NotFoundError, ValidationError


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant1(db: AsyncSession) -> Tenant:
    t = Tenant(name="Staff Test Tenant 1")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def tenant2(db: AsyncSession) -> Tenant:
    t = Tenant(name="Staff Test Tenant 2")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def branch1(db: AsyncSession, tenant1: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant1.id,
        name="Branch A",
        address="Calle 1",
        slug="branch-a",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def branch2(db: AsyncSession, tenant2: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant2.id,
        name="Branch B",
        address="Calle 2",
        slug="branch-b",
    )
    db.add(b)
    await db.flush()
    return b


# ── Create user ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_user_success(
    db: AsyncSession, tenant1: Tenant, branch1: Branch
) -> None:
    """ADMIN creates a user with role assignments."""
    svc = StaffService(db)
    result = await svc.create_user(
        data=StaffCreate(
            email="newuser@test.com",
            password="password123",
            first_name="John",
            last_name="Doe",
            assignments=[RoleAssignmentIn(branch_id=branch1.id, role=Roles.WAITER)],
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )
    assert result.id is not None
    assert result.email == "newuser@test.com"
    assert result.first_name == "John"
    assert result.last_name == "Doe"
    assert result.is_active is True
    assert len(result.assignments) == 1
    assert result.assignments[0].role == Roles.WAITER


@pytest.mark.asyncio
async def test_create_user_password_is_hashed(
    db: AsyncSession, tenant1: Tenant
) -> None:
    """Password stored in DB must be hashed — never plaintext."""
    svc = StaffService(db)
    plain_password = "mySuperSecret123"
    result = await svc.create_user(
        data=StaffCreate(
            email="hashed@test.com",
            password=plain_password,
            first_name="Jane",
            last_name="Smith",
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )

    # Load user directly from DB and check hash
    user = await db.scalar(
        select(User).where(User.id == result.id)
    )
    assert user is not None
    assert user.hashed_password != plain_password
    assert verify_password(plain_password, user.hashed_password)


@pytest.mark.asyncio
async def test_create_user_email_uniqueness_raises_validation_error(
    db: AsyncSession, tenant1: Tenant
) -> None:
    """Creating a user with a duplicate email raises ValidationError."""
    svc = StaffService(db)
    await svc.create_user(
        data=StaffCreate(
            email="dup@test.com",
            password="password123",
            first_name="User",
            last_name="One",
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )

    with pytest.raises(ValidationError, match="already exists"):
        await svc.create_user(
            data=StaffCreate(
                email="dup@test.com",
                password="other123",
                first_name="User",
                last_name="Two",
            ),
            tenant_id=tenant1.id,
            user_id=1,
        )


# ── Update user ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_user_changes_name(
    db: AsyncSession, tenant1: Tenant
) -> None:
    """Update user first_name and last_name."""
    svc = StaffService(db)
    created = await svc.create_user(
        data=StaffCreate(
            email="update@test.com",
            password="password123",
            first_name="Old",
            last_name="Name",
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )

    updated = await svc.update_user(
        user_id=created.id,
        data=StaffUpdate(first_name="New", last_name="Name"),
        tenant_id=tenant1.id,
        actor_user_id=1,
    )
    assert updated.first_name == "New"
    assert updated.last_name == "Name"


@pytest.mark.asyncio
async def test_update_user_password_rehashed(
    db: AsyncSession, tenant1: Tenant
) -> None:
    """Updating password re-hashes it."""
    svc = StaffService(db)
    created = await svc.create_user(
        data=StaffCreate(
            email="pwupdate@test.com",
            password="oldpassword",
            first_name="Test",
            last_name="User",
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )

    await svc.update_user(
        user_id=created.id,
        data=StaffUpdate(password="newpassword123"),
        tenant_id=tenant1.id,
        actor_user_id=1,
    )

    user = await db.scalar(select(User).where(User.id == created.id))
    assert verify_password("newpassword123", user.hashed_password)
    assert not verify_password("oldpassword", user.hashed_password)


# ── Soft delete ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_can_soft_delete_user(
    db: AsyncSession, tenant1: Tenant
) -> None:
    """ADMIN role can soft-delete a user."""
    svc = StaffService(db)
    created = await svc.create_user(
        data=StaffCreate(
            email="todelete@test.com",
            password="password123",
            first_name="Delete",
            last_name="Me",
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )

    await svc.soft_delete_user(
        user_id=created.id,
        tenant_id=tenant1.id,
        actor_user_id=1,
        actor_roles=[Roles.ADMIN],
    )

    # User should now be inactive
    user = await db.scalar(select(User).where(User.id == created.id))
    assert user.is_active is False
    assert user.deleted_at is not None
    assert user.deleted_by_id == 1


@pytest.mark.asyncio
async def test_manager_cannot_soft_delete_user(
    db: AsyncSession, tenant1: Tenant
) -> None:
    """MANAGER role cannot delete users — raises ForbiddenError."""
    svc = StaffService(db)
    created = await svc.create_user(
        data=StaffCreate(
            email="nodeletion@test.com",
            password="password123",
            first_name="No",
            last_name="Delete",
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )

    with pytest.raises(ForbiddenError):
        await svc.soft_delete_user(
            user_id=created.id,
            tenant_id=tenant1.id,
            actor_user_id=2,
            actor_roles=[Roles.MANAGER],
        )


# ── Multi-tenant isolation ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tenant_isolation_get_by_id(
    db: AsyncSession, tenant1: Tenant, tenant2: Tenant
) -> None:
    """User from tenant2 is invisible when querying with tenant1 context."""
    svc = StaffService(db)
    # Create user in tenant2
    created = await svc.create_user(
        data=StaffCreate(
            email="tenant2user@test.com",
            password="password123",
            first_name="Tenant2",
            last_name="User",
        ),
        tenant_id=tenant2.id,
        user_id=1,
    )

    # Querying with tenant1 should raise NotFoundError
    with pytest.raises(NotFoundError):
        await svc.get_by_id(user_id=created.id, tenant_id=tenant1.id)


@pytest.mark.asyncio
async def test_tenant_isolation_list_users(
    db: AsyncSession, tenant1: Tenant, tenant2: Tenant
) -> None:
    """List users scoped to tenant1 does not return tenant2 users."""
    svc = StaffService(db)

    await svc.create_user(
        data=StaffCreate(
            email="t1user@test.com",
            password="password123",
            first_name="T1",
            last_name="User",
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )
    await svc.create_user(
        data=StaffCreate(
            email="t2user@test.com",
            password="password123",
            first_name="T2",
            last_name="User",
        ),
        tenant_id=tenant2.id,
        user_id=1,
    )

    t1_users = await svc.list_users(tenant_id=tenant1.id)
    emails = [u.email for u in t1_users]
    assert "t1user@test.com" in emails
    assert "t2user@test.com" not in emails


# ── Role assignment management ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_assign_role_to_branch_upserts(
    db: AsyncSession, tenant1: Tenant, branch1: Branch
) -> None:
    """assign_role_to_branch is idempotent — does not duplicate."""
    svc = StaffService(db)
    created = await svc.create_user(
        data=StaffCreate(
            email="upsert@test.com",
            password="password123",
            first_name="Upsert",
            last_name="User",
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )

    # Assign same role twice
    await svc.assign_role_to_branch(
        user_id=created.id,
        tenant_id=tenant1.id,
        assignment=RoleAssignmentIn(branch_id=branch1.id, role=Roles.WAITER),
    )
    result = await svc.assign_role_to_branch(
        user_id=created.id,
        tenant_id=tenant1.id,
        assignment=RoleAssignmentIn(branch_id=branch1.id, role=Roles.WAITER),
    )

    # Should only have one assignment for this branch+role combo
    waiter_assignments = [
        a for a in result.assignments
        if a.branch_id == branch1.id and a.role == Roles.WAITER
    ]
    assert len(waiter_assignments) == 1


@pytest.mark.asyncio
async def test_revoke_role_from_branch_hard_deletes(
    db: AsyncSession, tenant1: Tenant, branch1: Branch
) -> None:
    """revoke_role_from_branch hard-deletes the UserBranchRole records."""
    svc = StaffService(db)
    created = await svc.create_user(
        data=StaffCreate(
            email="revoke@test.com",
            password="password123",
            first_name="Revoke",
            last_name="User",
            assignments=[RoleAssignmentIn(branch_id=branch1.id, role=Roles.WAITER)],
        ),
        tenant_id=tenant1.id,
        user_id=1,
    )

    await svc.revoke_role_from_branch(
        user_id=created.id,
        tenant_id=tenant1.id,
        branch_id=branch1.id,
    )

    # Verify no UserBranchRole records remain for this user+branch
    result = await db.execute(
        select(UserBranchRole).where(
            UserBranchRole.user_id == created.id,
            UserBranchRole.branch_id == branch1.id,
        )
    )
    assert result.scalars().all() == []
