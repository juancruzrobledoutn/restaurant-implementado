"""
Password hashing utilities using passlib with bcrypt backend.

Rules:
- ALWAYS use hash_password() when storing passwords
- ALWAYS use verify_password() for constant-time comparison
- NEVER compare raw passwords directly
- bcrypt rounds=12 is the security baseline; increase in future if hardware allows

The CryptContext with deprecated="auto" supports transparent algorithm migration:
if we later switch to argon2id, passlib will re-hash on the next successful login.
"""
from passlib.context import CryptContext

_pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,
)


def hash_password(plain: str) -> str:
    """
    Hash a plaintext password using bcrypt (12 rounds).

    Returns a bcrypt hash string starting with $2b$.
    """
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """
    Verify a plaintext password against a stored hash.

    Uses constant-time comparison internally — safe against timing attacks.
    Returns True if the password matches, False otherwise.
    """
    return _pwd_context.verify(plain, hashed)
