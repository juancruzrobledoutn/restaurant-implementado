"""
Database session factory and utilities.

Rules:
- NEVER call db.commit() directly — always use safe_commit(db)
- NEVER use Model.is_active == True — use Model.is_active.is_(True)
- get_db() is an async generator for FastAPI dependency injection

Engine and SessionLocal are created lazily on first access so that
test code can import Base / safe_commit without requiring asyncpg.
"""
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from shared.config.logging import get_logger

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

logger = get_logger(__name__)

# All models must inherit from Base so Alembic can detect them
Base = declarative_base()

# ── Lazy engine / session factory ─────────────────────────────────────────────

_engine: "AsyncEngine | None" = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _get_engine() -> "AsyncEngine":
    global _engine
    if _engine is None:
        from shared.config.settings import settings

        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=settings.DEBUG,
            pool_pre_ping=True,
        )
    return _engine


def _get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=_get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
    return _session_factory


# Public aliases for backward compatibility
def get_engine() -> "AsyncEngine":
    return _get_engine()


def SessionLocal() -> AsyncSession:
    """Return a new session from the lazy factory."""
    return _get_session_factory()()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: provides a database session per request."""
    factory = _get_session_factory()
    async with factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def safe_commit(db: AsyncSession) -> None:
    """
    Commit the current transaction safely.

    Rolls back automatically on failure and re-raises the exception.
    ALWAYS use this instead of db.commit() directly.
    """
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.error("safe_commit failed, rolled back: %s", exc)
        raise
