"""
Tests for rest_api/services/permissions/

Tests:
  - PermissionContext.require_management passes for ADMIN and MANAGER
  - require_management raises 403 for KITCHEN and WAITER
  - require_branch_access passes for ADMIN on any branch
  - require_branch_access passes for assigned branch
  - require_branch_access raises 403 for unassigned branch
  - Strategy CRUD permissions per role
"""
import pytest
from fastapi import HTTPException

from rest_api.services.permissions import PermissionContext, STRATEGY_REGISTRY
from rest_api.services.permissions.strategies import (
    AdminStrategy,
    KitchenStrategy,
    ManagerStrategy,
    WaiterStrategy,
)
from shared.config.constants import Roles

# ── Helper ─────────────────────────────────────────────────────────────────────


def _make_user(roles: list[str], branch_ids: list[int] | None = None) -> dict:
    return {
        "user_id": 1,
        "tenant_id": 1,
        "branch_ids": branch_ids or [1],
        "roles": roles,
        "email": "test@example.com",
        "jti": "test-jti",
    }


# ── require_management ─────────────────────────────────────────────────────────


def test_admin_passes_management_check():
    ctx = PermissionContext(_make_user(["ADMIN"]))
    ctx.require_management()  # Should not raise


def test_manager_passes_management_check():
    ctx = PermissionContext(_make_user(["MANAGER"]))
    ctx.require_management()  # Should not raise


def test_kitchen_fails_management_check():
    ctx = PermissionContext(_make_user(["KITCHEN"]))
    with pytest.raises(HTTPException) as exc_info:
        ctx.require_management()
    assert exc_info.value.status_code == 403
    assert "Management role required" in exc_info.value.detail


def test_waiter_fails_management_check():
    ctx = PermissionContext(_make_user(["WAITER"]))
    with pytest.raises(HTTPException) as exc_info:
        ctx.require_management()
    assert exc_info.value.status_code == 403


def test_no_roles_fails_management_check():
    ctx = PermissionContext(_make_user([]))
    with pytest.raises(HTTPException) as exc_info:
        ctx.require_management()
    assert exc_info.value.status_code == 403


# ── require_branch_access ──────────────────────────────────────────────────────


def test_admin_can_access_any_branch():
    """ADMIN bypasses branch check — can access any branch_id."""
    ctx = PermissionContext(_make_user(["ADMIN"], branch_ids=[1]))
    ctx.require_branch_access(99)  # branch 99 not in branch_ids, but ADMIN bypasses
    ctx.require_branch_access(1)
    ctx.require_branch_access(999)


def test_manager_can_access_assigned_branch():
    ctx = PermissionContext(_make_user(["MANAGER"], branch_ids=[1, 2]))
    ctx.require_branch_access(1)  # Should not raise
    ctx.require_branch_access(2)  # Should not raise


def test_manager_cannot_access_unassigned_branch():
    ctx = PermissionContext(_make_user(["MANAGER"], branch_ids=[1, 2]))
    with pytest.raises(HTTPException) as exc_info:
        ctx.require_branch_access(99)
    assert exc_info.value.status_code == 403
    assert "Branch access denied" in exc_info.value.detail


def test_waiter_can_access_assigned_branch():
    ctx = PermissionContext(_make_user(["WAITER"], branch_ids=[3]))
    ctx.require_branch_access(3)  # Should not raise


def test_waiter_cannot_access_unassigned_branch():
    ctx = PermissionContext(_make_user(["WAITER"], branch_ids=[3]))
    with pytest.raises(HTTPException) as exc_info:
        ctx.require_branch_access(5)
    assert exc_info.value.status_code == 403


def test_kitchen_cannot_access_unassigned_branch():
    ctx = PermissionContext(_make_user(["KITCHEN"], branch_ids=[1]))
    with pytest.raises(HTTPException) as exc_info:
        ctx.require_branch_access(2)
    assert exc_info.value.status_code == 403


# ── Strategy CRUD permissions ──────────────────────────────────────────────────


def test_admin_strategy_permits_all():
    strategy = AdminStrategy()
    assert strategy.can_create("anything") is True
    assert strategy.can_edit("anything") is True
    assert strategy.can_delete("anything") is True
    assert strategy.can_access_branch(99, []) is True


def test_manager_strategy_permits_manageable_resources():
    strategy = ManagerStrategy()
    for resource in ["staff", "table", "allergen", "promotion"]:
        assert strategy.can_create(resource) is True
        assert strategy.can_edit(resource) is True


def test_manager_strategy_denies_delete():
    strategy = ManagerStrategy()
    for resource in ["staff", "table", "allergen", "promotion", "anything"]:
        assert strategy.can_delete(resource) is False


def test_manager_strategy_denies_unmanageable_resources():
    strategy = ManagerStrategy()
    assert strategy.can_create("category") is False
    assert strategy.can_edit("category") is False


def test_kitchen_strategy_denies_all_cud():
    strategy = KitchenStrategy()
    assert strategy.can_create("anything") is False
    assert strategy.can_edit("anything") is False
    assert strategy.can_delete("anything") is False


def test_waiter_strategy_denies_all_cud():
    strategy = WaiterStrategy()
    assert strategy.can_create("anything") is False
    assert strategy.can_edit("anything") is False
    assert strategy.can_delete("anything") is False


def test_strategy_registry_contains_all_roles():
    """STRATEGY_REGISTRY must have an entry for each role."""
    for role in [Roles.ADMIN, Roles.MANAGER, Roles.KITCHEN, Roles.WAITER]:
        assert role in STRATEGY_REGISTRY, f"Missing strategy for role: {role}"


# ── Multi-role users ───────────────────────────────────────────────────────────


def test_user_with_admin_and_manager_roles_uses_highest_privilege():
    """If user has both ADMIN and MANAGER, AdminStrategy should be selected."""
    ctx = PermissionContext(_make_user(["ADMIN", "MANAGER"], branch_ids=[]))
    ctx.require_branch_access(99)  # ADMIN bypasses — should not raise


def test_context_exposes_user_id():
    ctx = PermissionContext(_make_user(["ADMIN"], branch_ids=[1, 2]))
    assert ctx.user_id == 1


def test_context_exposes_tenant_id():
    ctx = PermissionContext(_make_user(["ADMIN"]))
    assert ctx.tenant_id == 1


def test_context_exposes_branch_ids():
    ctx = PermissionContext(_make_user(["MANAGER"], branch_ids=[5, 6]))
    assert 5 in ctx.branch_ids
    assert 6 in ctx.branch_ids


# ── require_management_or_waiter (C-08) ───────────────────────────────────────


def test_admin_passes_management_or_waiter():
    ctx = PermissionContext(_make_user(["ADMIN"]))
    ctx.require_management_or_waiter()  # Should not raise


def test_manager_passes_management_or_waiter():
    ctx = PermissionContext(_make_user(["MANAGER"]))
    ctx.require_management_or_waiter()  # Should not raise


def test_waiter_passes_management_or_waiter():
    ctx = PermissionContext(_make_user(["WAITER"]))
    ctx.require_management_or_waiter()  # Should not raise


def test_kitchen_fails_management_or_waiter():
    """KITCHEN is explicitly excluded from table activation operations."""
    ctx = PermissionContext(_make_user(["KITCHEN"]))
    with pytest.raises(HTTPException) as exc_info:
        ctx.require_management_or_waiter()
    assert exc_info.value.status_code == 403


def test_no_roles_fails_management_or_waiter():
    ctx = PermissionContext(_make_user([]))
    with pytest.raises(HTTPException) as exc_info:
        ctx.require_management_or_waiter()
    assert exc_info.value.status_code == 403
