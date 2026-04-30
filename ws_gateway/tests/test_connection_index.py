"""
Tests for ConnectionIndex (ws_gateway/components/connection/index.py).

Covered scenarios:
  - register + get_by_branch returns the connection
  - Multi-tenant isolation: tenant_id=1,branch_id=1 ≠ tenant_id=2,branch_id=1
  - unregister removes from ALL indexes
  - count_by_user correct
  - get_by_sector filters correctly
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from ws_gateway.components.auth.strategies import AuthResult
from ws_gateway.components.connection.index import ConnectionIndex


def make_conn(
    tenant_id: int = 1,
    user_id: int | None = 1,
    branch_ids: list[int] | None = None,
    sector_ids: list[int] | None = None,
    session_id: int | None = None,
    diner_id: int | None = None,
) -> MagicMock:
    conn = MagicMock()
    conn.auth = AuthResult(
        tenant_id=tenant_id,
        user_id=user_id,
        diner_id=diner_id,
        session_id=session_id,
        branch_ids=branch_ids or [1],
        sector_ids=sector_ids or [],
        roles=["ADMIN"],
        token_type="null",
    )
    conn.is_dead = False
    return conn


@pytest.fixture
def index() -> ConnectionIndex:
    return ConnectionIndex()


# ── Registration ──────────────────────────────────────────────────────────────

def test_register_and_get_by_branch(index):
    conn = make_conn(tenant_id=1, branch_ids=[1])
    index.register(conn)
    result = index.get_by_branch(1, 1)
    assert conn in result


def test_register_adds_to_all(index):
    conn = make_conn()
    index.register(conn)
    assert conn in index._all


def test_register_adds_to_user_index(index):
    conn = make_conn(user_id=42)
    index.register(conn)
    assert conn in index._by_user.get(42, set())


def test_register_session_adds_to_session_index(index):
    conn = make_conn(user_id=None, diner_id=10, session_id=5)
    index.register(conn)
    result = index.get_by_session(5)
    assert conn in result


# ── Multi-tenant isolation ────────────────────────────────────────────────────

def test_multi_tenant_isolation(index):
    """tenant_id=1, branch_id=1 must NOT return tenant_id=2's connections."""
    conn_t1 = make_conn(tenant_id=1, branch_ids=[1])
    conn_t2 = make_conn(tenant_id=2, branch_ids=[1])

    index.register(conn_t1)
    index.register(conn_t2)

    result_t1 = index.get_by_branch(1, 1)
    result_t2 = index.get_by_branch(2, 1)

    assert conn_t1 in result_t1
    assert conn_t2 not in result_t1
    assert conn_t2 in result_t2
    assert conn_t1 not in result_t2


# ── Unregister ────────────────────────────────────────────────────────────────

def test_unregister_removes_from_all_indexes(index):
    conn = make_conn(tenant_id=1, user_id=10, branch_ids=[1], sector_ids=[2], session_id=None)
    index.register(conn)
    index.unregister(conn)

    assert conn not in index._all
    assert conn not in index.get_by_branch(1, 1)
    assert conn not in index.get_by_user(10)
    assert conn not in index.get_by_sector(1, 1, 2)


def test_unregister_cleans_empty_sets(index):
    conn = make_conn(user_id=99, branch_ids=[7])
    index.register(conn)
    index.unregister(conn)

    assert 99 not in index._by_user
    assert (1, 7) not in index._by_branch


# ── Counts ────────────────────────────────────────────────────────────────────

def test_count_by_user(index):
    c1 = make_conn(user_id=5, branch_ids=[1])
    c2 = make_conn(user_id=5, branch_ids=[2])
    c3 = make_conn(user_id=6, branch_ids=[1])

    for c in [c1, c2, c3]:
        index.register(c)

    assert index.count_by_user(5) == 2
    assert index.count_by_user(6) == 1
    assert index.count_total() == 3


# ── Sector filter ─────────────────────────────────────────────────────────────

def test_get_by_sector_filters_correctly(index):
    conn_sector1 = make_conn(tenant_id=1, branch_ids=[1], sector_ids=[1])
    conn_sector2 = make_conn(tenant_id=1, branch_ids=[1], sector_ids=[2])

    index.register(conn_sector1)
    index.register(conn_sector2)

    result = index.get_by_sector(1, 1, 1)
    assert conn_sector1 in result
    assert conn_sector2 not in result
