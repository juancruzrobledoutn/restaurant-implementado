"""
Service layer — domain services with CRUD logic and validation hooks.

BaseCRUDService: generic CRUD with Template Method hooks
BranchScopedService: extends BaseCRUDService with branch-scoped queries
"""
from rest_api.services.base import BaseCRUDService, BranchScopedService

__all__ = ["BaseCRUDService", "BranchScopedService"]
