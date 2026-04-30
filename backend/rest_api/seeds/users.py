"""
Seed: creates 4 development users with roles.

Users created:
  | id | email             | full_name      | role    | password    |
  |----|-------------------|----------------|---------|-------------|
  | 1  | admin@demo.com    | Admin Demo     | ADMIN   | admin123    |
  | 2  | manager@demo.com  | Manager Demo   | MANAGER | manager123  |
  | 3  | waiter@demo.com   | Waiter Demo    | WAITER  | waiter123   |
  | 4  | kitchen@demo.com  | Kitchen Demo   | KITCHEN | kitchen123  |

All users belong to tenant_id=1, branch_id=1.

C-03: Passwords are now hashed at runtime via shared.security.password.hash_password()
using bcrypt (12 rounds). This ensures the seed always generates valid, verifiable hashes
compatible with the auth endpoints.

Idempotency: checks for existing user by email before inserting.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.constants import Roles
from shared.config.logging import get_logger
from shared.security.password import hash_password
from rest_api.models.user import User, UserBranchRole

logger = get_logger(__name__)

# Plaintext passwords — hashed at runtime via hash_password()
# These users can log in via POST /api/auth/login with these credentials
_SEED_USERS = [
    {
        "email": "admin@demo.com",
        "full_name": "Admin Demo",
        "role": Roles.ADMIN,
        "plain_password": "admin123",
    },
    {
        "email": "manager@demo.com",
        "full_name": "Manager Demo",
        "role": Roles.MANAGER,
        "plain_password": "manager123",
    },
    {
        "email": "waiter@demo.com",
        "full_name": "Waiter Demo",
        "role": Roles.WAITER,
        "plain_password": "waiter123",
    },
    {
        "email": "kitchen@demo.com",
        "full_name": "Kitchen Demo",
        "role": Roles.KITCHEN,
        "plain_password": "kitchen123",
    },
]


async def seed_users(
    db: AsyncSession,
    tenant_id: int = 1,
    branch_id: int = 1,
) -> list[User]:
    """
    Create seed users with UserBranchRole entries if they don't already exist.

    Args:
        db: AsyncSession
        tenant_id: the tenant to assign users to (default: 1)
        branch_id: the branch to assign roles in (default: 1)

    Returns:
        List of User instances (existing or newly created).
    """
    created_users: list[User] = []

    for user_data in _SEED_USERS:
        # Check if user already exists by email (globally unique)
        result = await db.execute(
            select(User).where(
                User.email == user_data["email"],
                User.is_active.is_(True),
            )
        )
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                tenant_id=tenant_id,
                email=user_data["email"],
                full_name=user_data["full_name"],
                hashed_password=hash_password(user_data["plain_password"]),
            )
            db.add(user)
            await db.flush()  # get the ID
            logger.info(
                "seed: created user id=%s email=%r",
                user.id,
                user.email,
            )
        else:
            logger.info("seed: user already exists id=%s email=%r", user.id, user.email)

        # Check if role assignment already exists
        result = await db.execute(
            select(UserBranchRole).where(
                UserBranchRole.user_id == user.id,
                UserBranchRole.branch_id == branch_id,
                UserBranchRole.role == user_data["role"],
            )
        )
        role_entry = result.scalar_one_or_none()

        if role_entry is None:
            role_entry = UserBranchRole(
                user_id=user.id,
                branch_id=branch_id,
                role=user_data["role"],
            )
            db.add(role_entry)
            await db.flush()
            logger.info(
                "seed: assigned role %r to user_id=%s branch_id=%s",
                user_data["role"],
                user.id,
                branch_id,
            )
        else:
            logger.info(
                "seed: role %r already assigned to user_id=%s",
                user_data["role"],
                user.id,
            )

        created_users.append(user)

    return created_users
