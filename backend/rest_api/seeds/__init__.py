"""
Seed data for development and testing.

Modules:
  - tenants.py: seed_tenants(db) — creates 1 tenant + 1 branch
  - users.py:   seed_users(db)   — creates 4 users with roles
  - runner.py:  entry point — python -m rest_api.seeds.runner

All seeds are IDEMPOTENT — safe to run multiple times.
"""
