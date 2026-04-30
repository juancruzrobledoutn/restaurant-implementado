"""
Tests for seed idempotency (seeds/tenants.py, seeds/users.py).

Coverage:
  - seed_tenants: creates Tenant + Branch on first run
  - seed_tenants: second run returns the same objects (idempotent)
  - seed_users: creates 4 users with UserBranchRole entries
  - seed_users: second run returns same users (idempotent, no duplicates)
"""
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.tenant import Tenant
from rest_api.models.user import User, UserBranchRole
from rest_api.seeds.tenants import BRANCH_SLUG, TENANT_NAME, seed_tenants
from rest_api.seeds.users import seed_users


# ── seed_tenants ───────────────────────────────────────────────────────────────


async def test_seed_tenants_creates_tenant_on_first_run(db: AsyncSession) -> None:
    # Act
    tenant, _ = await seed_tenants(db)

    # Assert
    assert tenant.id is not None
    assert tenant.name == TENANT_NAME
    assert tenant.is_active is True


async def test_seed_tenants_creates_branch_on_first_run(db: AsyncSession) -> None:
    _, branch = await seed_tenants(db)

    assert branch.id is not None
    assert branch.slug == BRANCH_SLUG
    assert branch.is_active is True


async def test_seed_tenants_branch_belongs_to_tenant(db: AsyncSession) -> None:
    tenant, branch = await seed_tenants(db)

    assert branch.tenant_id == tenant.id


async def test_seed_tenants_is_idempotent_tenant(db: AsyncSession) -> None:
    """Calling seed_tenants twice must not create a duplicate tenant."""
    tenant_first, _ = await seed_tenants(db)
    tenant_second, _ = await seed_tenants(db)

    # Same object — same id
    assert tenant_first.id == tenant_second.id

    # Only one row in the DB
    result = await db.execute(
        select(func.count()).select_from(Tenant).where(
            Tenant.name == TENANT_NAME,
            Tenant.is_active.is_(True),
        )
    )
    count = result.scalar_one()
    assert count == 1


async def test_seed_tenants_is_idempotent_branch(db: AsyncSession) -> None:
    """Calling seed_tenants twice must not create a duplicate branch."""
    _, branch_first = await seed_tenants(db)
    _, branch_second = await seed_tenants(db)

    assert branch_first.id == branch_second.id

    result = await db.execute(
        select(func.count()).select_from(Branch).where(
            Branch.slug == BRANCH_SLUG,
            Branch.is_active.is_(True),
        )
    )
    count = result.scalar_one()
    assert count == 1


# ── seed_users ─────────────────────────────────────────────────────────────────


async def test_seed_users_creates_four_users(db: AsyncSession) -> None:
    # Arrange — need a valid tenant + branch for FKs
    tenant, branch = await seed_tenants(db)

    # Act
    users = await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)

    # Assert
    assert len(users) == 4


async def test_seed_users_creates_expected_emails(db: AsyncSession) -> None:
    tenant, branch = await seed_tenants(db)
    users = await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)

    emails = {u.email for u in users}
    expected = {
        "admin@demo.com",
        "manager@demo.com",
        "waiter@demo.com",
        "kitchen@demo.com",
    }
    assert emails == expected


async def test_seed_users_assigns_roles_to_branch(db: AsyncSession) -> None:
    """Each user must have one UserBranchRole for the seeded branch."""
    tenant, branch = await seed_tenants(db)
    users = await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)

    for user in users:
        result = await db.execute(
            select(UserBranchRole).where(
                UserBranchRole.user_id == user.id,
                UserBranchRole.branch_id == branch.id,
            )
        )
        role = result.scalar_one_or_none()
        assert role is not None, f"User {user.email} has no role assigned"


async def test_seed_users_users_belong_to_correct_tenant(db: AsyncSession) -> None:
    tenant, branch = await seed_tenants(db)
    users = await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)

    for user in users:
        assert user.tenant_id == tenant.id


async def test_seed_users_is_idempotent_no_duplicate_users(db: AsyncSession) -> None:
    """Running seed_users twice must not double the user count."""
    tenant, branch = await seed_tenants(db)

    users_first = await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)
    users_second = await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)

    # Same ids returned
    ids_first = {u.id for u in users_first}
    ids_second = {u.id for u in users_second}
    assert ids_first == ids_second

    # Exactly 4 active users in the DB
    result = await db.execute(
        select(func.count()).select_from(User).where(
            User.tenant_id == tenant.id,
            User.is_active.is_(True),
        )
    )
    count = result.scalar_one()
    assert count == 4


async def test_seed_users_is_idempotent_no_duplicate_roles(db: AsyncSession) -> None:
    """Running seed_users twice must not create duplicate UserBranchRole rows."""
    tenant, branch = await seed_tenants(db)

    await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)
    await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)

    result = await db.execute(
        select(func.count()).select_from(UserBranchRole).where(
            UserBranchRole.branch_id == branch.id,
        )
    )
    count = result.scalar_one()
    # 4 users × 1 role each = exactly 4 rows
    assert count == 4


async def test_seed_users_all_users_are_active(db: AsyncSession) -> None:
    tenant, branch = await seed_tenants(db)
    users = await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)

    for user in users:
        assert user.is_active is True
