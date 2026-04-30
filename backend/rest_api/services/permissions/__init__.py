"""
PermissionContext — the single authorization mechanism for all future changes.

Usage in a router (thin — only HTTP, no logic):

    from rest_api.services.permissions import PermissionContext

    @router.post("/categories")
    async def create_category(
        body: CategoryCreate,
        user: dict = Depends(current_user),
    ):
        ctx = PermissionContext(user)
        ctx.require_management()
        ctx.require_branch_access(body.branch_id)
        # delegate to domain service...

Rules:
  - NEVER inline role checks in routers — always use PermissionContext
  - NEVER bypass require_management for sensitive operations
  - ALWAYS call require_branch_access when the operation is branch-scoped
"""
from typing import Any

from fastapi import HTTPException

from shared.config.constants import MANAGEMENT_ROLES, Roles
from rest_api.services.permissions.strategies import (
    AdminStrategy,
    KitchenStrategy,
    ManagerStrategy,
    WaiterStrategy,
)

# Maps Roles enum values → strategy class instances (singletons — stateless)
STRATEGY_REGISTRY = {
    Roles.ADMIN: AdminStrategy(),
    Roles.MANAGER: ManagerStrategy(),
    Roles.KITCHEN: KitchenStrategy(),
    Roles.WAITER: WaiterStrategy(),
}

_ROLE_PRIORITY = {
    Roles.ADMIN: 0,
    Roles.MANAGER: 1,
    Roles.KITCHEN: 2,
    Roles.WAITER: 3,
}


def _highest_privilege_role(roles: list[str]) -> str | None:
    """Return the role with the highest privilege from a list of role strings."""
    valid = [r for r in roles if r in _ROLE_PRIORITY]
    if not valid:
        return None
    return min(valid, key=lambda r: _ROLE_PRIORITY[r])


class PermissionContext:
    """
    Wraps the authenticated user dict and exposes authorization methods.

    Instantiate from the user dict returned by the `current_user` dependency:
        ctx = PermissionContext(user)

    Internally selects the appropriate strategy based on the user's
    highest-privilege role.
    """

    def __init__(self, user: dict[str, Any]) -> None:
        self._user = user
        self._roles: list[str] = user.get("roles", [])
        self._branch_ids: list[int] = user.get("branch_ids", [])

        self._top_role: str | None = _highest_privilege_role(self._roles)
        self._strategy = STRATEGY_REGISTRY.get(self._top_role) if self._top_role else None  # type: ignore[arg-type]

    # ── Authorization methods ─────────────────────────────────────────────────

    def require_management(self) -> None:
        """
        Require the user to have ADMIN or MANAGER role.

        Raises HTTP 403 if the user has neither role.
        """
        has_management = any(r in MANAGEMENT_ROLES for r in self._roles)
        if not has_management:
            raise HTTPException(status_code=403, detail="Management role required")

    def require_management_or_waiter(self) -> None:
        """
        Require the user to have ADMIN, MANAGER, or WAITER role.

        KITCHEN is explicitly rejected — kitchen staff cannot activate tables
        or manage session state. WAITER can activate tables and request check.

        Raises HTTP 403 if the user has only KITCHEN role or no valid role.
        """
        _WAITER_OR_MANAGEMENT = frozenset(
            {Roles.ADMIN, Roles.MANAGER, Roles.WAITER}
        )
        has_access = any(r in _WAITER_OR_MANAGEMENT for r in self._roles)
        if not has_access:
            raise HTTPException(
                status_code=403,
                detail="WAITER, MANAGER, or ADMIN role required",
            )

    def require_admin(self) -> None:
        """
        Require the user to have ADMIN role (not just MANAGER).

        Used for destructive operations such as delete.
        Raises HTTP 403 if the user is not ADMIN.
        """
        if Roles.ADMIN not in self._roles:
            raise HTTPException(status_code=403, detail="Admin role required")

    def require_branch_access(self, branch_id: int) -> None:
        """
        Require the user to have access to the specified branch.

        ADMIN users bypass this check (access all branches in their tenant).
        All other roles must have the branch_id in their branch_ids list.

        Raises HTTP 403 if the user cannot access the branch.
        """
        if self._strategy is None:
            raise HTTPException(status_code=403, detail="Branch access denied")

        if not self._strategy.can_access_branch(branch_id, self._branch_ids):
            raise HTTPException(status_code=403, detail="Branch access denied")

    # ── Resource permission helpers ────────────────────────────────────────────

    def can_create(self, resource: str) -> bool:
        """Check if the user can create the given resource type."""
        return self._strategy.can_create(resource) if self._strategy else False

    def can_edit(self, resource: str) -> bool:
        """Check if the user can edit the given resource type."""
        return self._strategy.can_edit(resource) if self._strategy else False

    def can_delete(self, resource: str) -> bool:
        """Check if the user can delete the given resource type."""
        return self._strategy.can_delete(resource) if self._strategy else False

    # ── Convenience properties ─────────────────────────────────────────────────

    @property
    def is_admin(self) -> bool:
        """True if the user has the ADMIN role."""
        return Roles.ADMIN in self._roles

    @property
    def user_id(self) -> int:
        return self._user["user_id"]

    @property
    def user_email(self) -> str:
        return self._user["email"]

    @property
    def tenant_id(self) -> int:
        return self._user["tenant_id"]

    @property
    def branch_ids(self) -> list[int]:
        return self._branch_ids

    @property
    def roles(self) -> list[str]:
        return self._roles

    @property
    def top_role(self) -> str | None:
        """
        The highest-privilege role of the user (ADMIN > MANAGER > KITCHEN > WAITER).
        Used by domain services to decide role-gated state-machine transitions.
        """
        return self._top_role

    # ── Role-set guards (C-10 rounds) ──────────────────────────────────────────

    def require_kitchen_or_management(self) -> None:
        """
        Require KITCHEN, MANAGER, or ADMIN. WAITER explicitly rejected.
        Used by kitchen-side endpoints (round status updates, kitchen listings).
        """
        _KITCHEN_OR_MGMT = frozenset({Roles.KITCHEN, Roles.MANAGER, Roles.ADMIN})
        if not any(r in _KITCHEN_OR_MGMT for r in self._roles):
            raise HTTPException(
                status_code=403,
                detail="KITCHEN, MANAGER, or ADMIN role required",
            )

    def require_serve_allowed(self) -> None:
        """
        Require WAITER, KITCHEN, MANAGER, or ADMIN for READY → SERVED transitions.
        All staff roles are allowed — only diners are rejected.
        """
        _SERVE_ALLOWED = frozenset(
            {Roles.WAITER, Roles.KITCHEN, Roles.MANAGER, Roles.ADMIN}
        )
        if not any(r in _SERVE_ALLOWED for r in self._roles):
            raise HTTPException(
                status_code=403,
                detail="Staff role required to serve a round",
            )
