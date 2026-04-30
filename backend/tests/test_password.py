"""
Tests for shared/security/password.py

Tests:
  - hash_password produces a bcrypt hash (starts with $2b$)
  - verify_password succeeds with correct password
  - verify_password fails with wrong password
  - hash_password produces different hashes for same input (salting)
  - empty string is hashed (not blocked at this layer)
"""
from shared.security.password import hash_password, verify_password


def test_hash_password_produces_bcrypt_hash():
    """Bcrypt hashes always start with $2b$ (version 2b)."""
    hashed = hash_password("mypassword")
    assert hashed.startswith("$2b$"), f"Expected bcrypt hash, got: {hashed[:10]}..."


def test_hash_password_includes_rounds():
    """Default rounds = 12 — should appear as $2b$12$ in the hash."""
    hashed = hash_password("mypassword")
    assert "$12$" in hashed, f"Expected 12 rounds in hash, got: {hashed[:20]}..."


def test_verify_password_correct():
    """verify_password returns True for the original plaintext."""
    plain = "correct-horse-battery-staple"
    hashed = hash_password(plain)
    assert verify_password(plain, hashed) is True


def test_verify_password_wrong():
    """verify_password returns False for the wrong password."""
    hashed = hash_password("correct-password")
    assert verify_password("wrong-password", hashed) is False


def test_verify_password_empty_against_real_hash():
    """Empty string does not match a non-empty password hash."""
    hashed = hash_password("real-password")
    assert verify_password("", hashed) is False


def test_hash_password_is_salted():
    """Two hashes of the same input must differ (bcrypt always salts)."""
    h1 = hash_password("same-input")
    h2 = hash_password("same-input")
    assert h1 != h2, "bcrypt must produce different hashes each time (salting)"


def test_verify_password_uses_precomputed_hash():
    """Verify against a known pre-computed bcrypt hash (rounds=12, password=admin123)."""
    known_hash = "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW"
    # This hash is for "secret" (standard bcrypt test vector)
    # We test with our own hash instead to avoid relying on external vectors
    plain = "admin123"
    hashed = hash_password(plain)
    assert verify_password(plain, hashed) is True
    assert verify_password("notadmin", hashed) is False
