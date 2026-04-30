"""
Tests for C-02 core models: Tenant, Branch, User, UserBranchRole, AuditMixin.

Coverage:
  - AuditMixin default field values
  - Model __repr__ outputs
  - Tenant, Branch, User — creation with required fields
  - UserBranchRole — composite PK behavior
  - Unique constraint on User.email
  - FK constraint: Branch.tenant_id must reference existing Tenant
"""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.tenant import Tenant
from rest_api.models.user import User, UserBranchRole


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _make_tenant(db: AsyncSession, name: str = "Acme") -> Tenant:
    tenant = Tenant(name=name)
    db.add(tenant)
    await db.flush()
    await db.refresh(tenant)
    return tenant


async def _make_branch(
    db: AsyncSession,
    tenant_id: int,
    slug: str = "main",
) -> Branch:
    branch = Branch(
        tenant_id=tenant_id,
        name="Sucursal Principal",
        address="Av. Siempre Viva 742",
        slug=slug,
    )
    db.add(branch)
    await db.flush()
    await db.refresh(branch)
    return branch


async def _make_user(
    db: AsyncSession,
    tenant_id: int,
    email: str = "user@example.com",
) -> User:
    user = User(
        tenant_id=tenant_id,
        email=email,
        full_name="Test User",
        hashed_password="hashed_pw",
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


# ── AuditMixin defaults ────────────────────────────────────────────────────────


async def test_audit_mixin_is_active_defaults_to_true(db: AsyncSession) -> None:
    # Arrange / Act
    tenant = await _make_tenant(db)

    # Assert
    assert tenant.is_active is True


async def test_audit_mixin_deleted_at_defaults_to_none(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)

    assert tenant.deleted_at is None


async def test_audit_mixin_deleted_by_id_defaults_to_none(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)

    assert tenant.deleted_by_id is None


async def test_audit_mixin_created_at_is_set_on_insert(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)

    # server_default populates this; after flush+refresh it must not be None
    assert tenant.created_at is not None


async def test_audit_mixin_updated_at_is_set_on_insert(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)

    assert tenant.updated_at is not None


# ── Model __repr__ ─────────────────────────────────────────────────────────────


async def test_tenant_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db, name="My Resto")

    result = repr(tenant)

    assert "Tenant" in result
    assert "My Resto" in result
    assert str(tenant.id) in result


async def test_branch_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id, slug="downtown")

    result = repr(branch)

    assert "Branch" in result
    assert "downtown" in result
    assert str(branch.id) in result


async def test_user_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    user = await _make_user(db, tenant_id=tenant.id, email="repr@example.com")

    result = repr(user)

    assert "User" in result
    assert "repr@example.com" in result


async def test_user_branch_role_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id)
    user = await _make_user(db, tenant_id=tenant.id)
    ubr = UserBranchRole(user_id=user.id, branch_id=branch.id, role="WAITER")
    db.add(ubr)
    await db.flush()

    result = repr(ubr)

    assert "UserBranchRole" in result
    assert "WAITER" in result


# ── Tenant ─────────────────────────────────────────────────────────────────────


async def test_tenant_creation_with_required_fields(db: AsyncSession) -> None:
    tenant = await _make_tenant(db, name="Buen Sabor")

    assert tenant.id is not None
    assert tenant.name == "Buen Sabor"


async def test_tenant_id_is_auto_assigned(db: AsyncSession) -> None:
    tenant1 = await _make_tenant(db, name="T1")
    tenant2 = await _make_tenant(db, name="T2")

    assert tenant1.id != tenant2.id


# ── Branch ─────────────────────────────────────────────────────────────────────


async def test_branch_creation_with_required_fields(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id, slug="centro")

    assert branch.id is not None
    assert branch.tenant_id == tenant.id
    assert branch.slug == "centro"


async def test_branch_fk_requires_existing_tenant(db: AsyncSession) -> None:
    """Branch.tenant_id must reference an existing Tenant row."""
    orphan_branch = Branch(
        tenant_id=999_999,  # non-existent tenant
        name="Ghost Branch",
        address="Nowhere",
        slug="ghost",
    )
    db.add(orphan_branch)

    with pytest.raises(IntegrityError):
        await db.flush()


async def test_branch_slug_unique_per_tenant(db: AsyncSession) -> None:
    """UNIQUE(tenant_id, slug) constraint must fire on duplicate."""
    tenant = await _make_tenant(db)
    await _make_branch(db, tenant_id=tenant.id, slug="dup")

    duplicate = Branch(
        tenant_id=tenant.id,
        name="Another Branch",
        address="Same Slug Street",
        slug="dup",
    )
    db.add(duplicate)

    with pytest.raises(IntegrityError):
        await db.flush()


async def test_branch_same_slug_allowed_in_different_tenants(db: AsyncSession) -> None:
    """The UNIQUE constraint is (tenant_id, slug) — same slug in a different tenant is fine."""
    tenant_a = await _make_tenant(db, name="Tenant A")
    tenant_b = await _make_tenant(db, name="Tenant B")

    branch_a = await _make_branch(db, tenant_id=tenant_a.id, slug="shared")
    branch_b = await _make_branch(db, tenant_id=tenant_b.id, slug="shared")

    assert branch_a.id != branch_b.id


# ── User ───────────────────────────────────────────────────────────────────────


async def test_user_creation_with_required_fields(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    user = await _make_user(db, tenant_id=tenant.id, email="create@example.com")

    assert user.id is not None
    assert user.email == "create@example.com"
    assert user.tenant_id == tenant.id


async def test_user_email_unique_constraint_raises_integrity_error(
    db: AsyncSession,
) -> None:
    """UniqueConstraint on User.email must reject duplicates."""
    tenant = await _make_tenant(db)
    await _make_user(db, tenant_id=tenant.id, email="dup@example.com")

    duplicate = User(
        tenant_id=tenant.id,
        email="dup@example.com",
        full_name="Clone",
        hashed_password="pw",
    )
    db.add(duplicate)

    with pytest.raises(IntegrityError):
        await db.flush()


async def test_user_email_unique_is_global_across_tenants(db: AsyncSession) -> None:
    """Email uniqueness is cross-tenant — two tenants cannot share an email."""
    tenant_a = await _make_tenant(db, name="Tenant A")
    tenant_b = await _make_tenant(db, name="Tenant B")
    await _make_user(db, tenant_id=tenant_a.id, email="shared@example.com")

    cross_tenant_user = User(
        tenant_id=tenant_b.id,
        email="shared@example.com",
        full_name="Other",
        hashed_password="pw",
    )
    db.add(cross_tenant_user)

    with pytest.raises(IntegrityError):
        await db.flush()


# ── UserBranchRole ─────────────────────────────────────────────────────────────


async def test_user_branch_role_composite_pk(db: AsyncSession) -> None:
    """(user_id, branch_id, role) is the PK — each combination must be unique."""
    tenant = await _make_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id)
    user = await _make_user(db, tenant_id=tenant.id)

    ubr = UserBranchRole(user_id=user.id, branch_id=branch.id, role="WAITER")
    db.add(ubr)
    await db.flush()

    assert ubr.user_id == user.id
    assert ubr.branch_id == branch.id
    assert ubr.role == "WAITER"


async def test_user_branch_role_same_user_multiple_branches(db: AsyncSession) -> None:
    """A user can hold roles in multiple branches — distinct (user, branch, role) combos."""
    tenant = await _make_tenant(db)
    branch_a = await _make_branch(db, tenant_id=tenant.id, slug="branch-a")
    branch_b = await _make_branch(db, tenant_id=tenant.id, slug="branch-b")
    user = await _make_user(db, tenant_id=tenant.id)

    ubr_a = UserBranchRole(user_id=user.id, branch_id=branch_a.id, role="WAITER")
    ubr_b = UserBranchRole(user_id=user.id, branch_id=branch_b.id, role="WAITER")
    db.add(ubr_a)
    db.add(ubr_b)
    await db.flush()

    # Both rows persisted without constraint violation
    assert ubr_a.branch_id != ubr_b.branch_id


async def test_user_branch_role_duplicate_pk_raises_integrity_error(
    db: AsyncSession,
) -> None:
    """Duplicate (user_id, branch_id, role) must raise IntegrityError."""
    tenant = await _make_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id)
    user = await _make_user(db, tenant_id=tenant.id)

    ubr1 = UserBranchRole(user_id=user.id, branch_id=branch.id, role="ADMIN")
    db.add(ubr1)
    await db.flush()

    ubr2 = UserBranchRole(user_id=user.id, branch_id=branch.id, role="ADMIN")
    db.add(ubr2)

    with pytest.raises(IntegrityError):
        await db.flush()


async def test_user_branch_role_has_no_audit_mixin(db: AsyncSession) -> None:
    """UserBranchRole must NOT have is_active / created_at — it's a join table."""
    assert not hasattr(UserBranchRole, "is_active")
    assert not hasattr(UserBranchRole, "created_at")
    assert not hasattr(UserBranchRole, "deleted_at")
