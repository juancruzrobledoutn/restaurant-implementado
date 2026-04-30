"""
Repository layer — data access objects scoped to tenant and branch.

Each repository wraps an AsyncSession and applies automatic filters:
  - TenantRepository: filters by tenant_id + is_active.is_(True)
  - BranchRepository: extends TenantRepository + filters by branch_id
"""
from rest_api.repositories.base import BranchRepository, TenantRepository

__all__ = ["TenantRepository", "BranchRepository"]
