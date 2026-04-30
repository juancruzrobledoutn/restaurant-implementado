"""
Seed runner — entry point for development data seeding.

Usage:
    cd backend/
    python -m rest_api.seeds.runner           # base seed (tenant, users, menu)
    python -m rest_api.seeds.runner --full    # base + rich demo dataset (DEV ONLY)

What it does (base):
    1. Connects to the database using the configured DATABASE_URL
    2. Runs seed_tenants() — creates tenant + branch (idempotent)
    3. Runs seed_users()   — creates 4 users with roles (idempotent)
    4. Runs seed_demo_data() — sector, tables, menu (idempotent)
    5. Runs seed_staff_management() — promotion + waiter assignment (idempotent)
    6. Commits the transaction

With --full (DEV ONLY — never run against staging or production):
    After step 5, also runs seed_demo_full() which adds:
    - Extra allergens and menu items with allergen links
    - T01 OPEN session (2 diners, rounds in SERVED + IN_KITCHEN)
    - T02 PAYING session with partial payment
    - 2 service calls (ACKED + CREATED)
    - 3 historical CLOSED sessions for the Sales dashboard

Safe to run multiple times — all seeds check for existence before inserting.
"""
import argparse
import asyncio
import sys

from shared.config.logging import get_logger
from shared.infrastructure.db import SessionLocal, safe_commit
from rest_api.seeds.tenants import seed_tenants
from rest_api.seeds.users import seed_users
from rest_api.seeds.demo_data import seed_demo_data
from rest_api.seeds.staff_management import seed_staff_management

logger = get_logger(__name__)


async def run(full: bool = False) -> None:
    """Execute all seed functions in a single database session.

    Args:
        full: When True, also run the rich demo seed (DEV ONLY).
    """
    logger.info("=== Starting seed runner (full=%s) ===", full)

    async with SessionLocal() as db:
        try:
            # Step 1: create tenant and branch
            tenant, branch = await seed_tenants(db)

            # Step 2: create users and roles
            users = await seed_users(db, tenant_id=tenant.id, branch_id=branch.id)

            # Step 3: operational demo data — sector, tables, menu
            # Must run BEFORE staff_management so the waiter gets assigned to the sector
            await seed_demo_data(db, branch_id=branch.id)

            # Step 4: C-13 demo data — promotion + waiter assignment
            await seed_staff_management(db, tenant_id=tenant.id, branch_id=branch.id)

            # Step 5 (optional): C-31 rich demo dataset
            if full:
                from rest_api.seeds.demo_full import seed_demo_full  # noqa: PLC0415

                logger.info("=== Running demo_full (--full flag) ===")
                await seed_demo_full(db, tenant_id=tenant.id, branch_id=branch.id)

            # Commit all changes in a single transaction
            await safe_commit(db)

            logger.info(
                "=== Seed complete: tenant_id=%s, branch_id=%s, users=%d full=%s ===",
                tenant.id,
                branch.id,
                len(users),
                full,
            )

        except Exception as exc:
            logger.error("Seed failed: %s", exc)
            await db.rollback()
            raise


def main() -> None:
    """Synchronous entry point for python -m rest_api.seeds.runner."""
    parser = argparse.ArgumentParser(
        description="Integrador seed runner",
        prog="rest_api.seeds.runner",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        default=False,
        help="Also run the rich demo seed — DEV ONLY, never against staging/production",
    )
    args = parser.parse_args()

    try:
        asyncio.run(run(full=args.full))
    except Exception as exc:
        logger.error("Seed runner failed: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
