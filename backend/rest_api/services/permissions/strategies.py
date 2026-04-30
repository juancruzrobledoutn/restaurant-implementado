"""
Permission strategy classes — Strategy pattern for role-based access control.

Each strategy encapsulates the permission rules for a specific role.
Adding a new role = adding one new strategy class here.

Resources (for can_create/can_edit/can_delete):
  - "staff"      → User management
  - "table"      → Table management
  - "allergen"   → Allergen management
  - "promotion"  → Promotion management
  - "*"          → Wildcard (any resource)

Architecture: PermissionContext selects the appropriate strategy based on the
user's highest-privilege role, then delegates all checks to it.
"""
from typing import Protocol


class PermissionStrategy(Protocol):
    """Protocol defining the interface all role strategies must implement."""

    def can_create(self, resource: str) -> bool: ...
    def can_edit(self, resource: str) -> bool: ...
    def can_delete(self, resource: str) -> bool: ...
    def can_access_branch(self, branch_id: int, user_branch_ids: list[int]) -> bool: ...


class AdminStrategy:
    """
    ADMIN: full permissions on all resources and all branches within their tenant.

    ADMIN can create, edit, and delete any resource.
    ADMIN bypasses branch access checks (can access all branches in their tenant).
    """

    def can_create(self, resource: str) -> bool:
        return True

    def can_edit(self, resource: str) -> bool:
        return True

    def can_delete(self, resource: str) -> bool:
        return True

    def can_access_branch(self, branch_id: int, user_branch_ids: list[int]) -> bool:
        return True  # ADMIN has access to all branches


class ManagerStrategy:
    """
    MANAGER: can create and edit staff, tables, allergens, and promotions
    within their assigned branches. Cannot delete anything.

    MANAGER can only access branches explicitly assigned to them.
    """

    _MANAGEABLE_RESOURCES = frozenset({"staff", "table", "allergen", "promotion"})

    def can_create(self, resource: str) -> bool:
        return resource in self._MANAGEABLE_RESOURCES

    def can_edit(self, resource: str) -> bool:
        return resource in self._MANAGEABLE_RESOURCES

    def can_delete(self, resource: str) -> bool:
        return False  # MANAGER cannot delete anything

    def can_access_branch(self, branch_id: int, user_branch_ids: list[int]) -> bool:
        return branch_id in user_branch_ids


class KitchenStrategy:
    """
    KITCHEN: read-only. Cannot create, edit, or delete any resource.

    KITCHEN staff can only access their assigned branches.
    """

    def can_create(self, resource: str) -> bool:
        return False

    def can_edit(self, resource: str) -> bool:
        return False

    def can_delete(self, resource: str) -> bool:
        return False

    def can_access_branch(self, branch_id: int, user_branch_ids: list[int]) -> bool:
        return branch_id in user_branch_ids


class WaiterStrategy:
    """
    WAITER: read-only. Cannot create, edit, or delete any resource.

    WAITER staff can only access their assigned branches.
    """

    def can_create(self, resource: str) -> bool:
        return False

    def can_edit(self, resource: str) -> bool:
        return False

    def can_delete(self, resource: str) -> bool:
        return False

    def can_access_branch(self, branch_id: int, user_branch_ids: list[int]) -> bool:
        return branch_id in user_branch_ids
