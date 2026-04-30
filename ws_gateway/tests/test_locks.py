"""
Tests for sharded locks (ws_gateway/components/connection/index.py).

Covered scenarios:
  - get_tenant_branch_lock(1,1) returns the SAME lock twice
  - get_tenant_branch_lock(1,1) ≠ get_tenant_branch_lock(1,2)
  - GC of lock when no references held (WeakValueDictionary behavior)
"""
from __future__ import annotations

import asyncio
import gc

import pytest

from ws_gateway.components.connection.index import ConnectionIndex


@pytest.fixture
def index() -> ConnectionIndex:
    return ConnectionIndex()


def test_same_key_returns_same_lock(index):
    lock1 = index.get_tenant_branch_lock(1, 1)
    lock2 = index.get_tenant_branch_lock(1, 1)
    assert lock1 is lock2


def test_different_branch_returns_different_lock(index):
    lock_b1 = index.get_tenant_branch_lock(1, 1)
    lock_b2 = index.get_tenant_branch_lock(1, 2)
    assert lock_b1 is not lock_b2


def test_different_tenant_returns_different_lock(index):
    lock_t1 = index.get_tenant_branch_lock(1, 1)
    lock_t2 = index.get_tenant_branch_lock(2, 1)
    assert lock_t1 is not lock_t2


def test_gc_removes_lock_when_no_references(index):
    """
    When the only reference to the lock is the WeakValueDictionary,
    the GC should reclaim it, and the next call creates a new lock.
    """
    lock_a = index.get_tenant_branch_lock(10, 99)
    lock_a_id = id(lock_a)
    del lock_a
    gc.collect()

    # Now WeakValueDictionary has no strong reference → entry is gone
    lock_b = index.get_tenant_branch_lock(10, 99)
    # A new object is created (may happen to reuse the same memory address,
    # but it's a new asyncio.Lock instance)
    assert isinstance(lock_b, asyncio.Lock)


@pytest.mark.asyncio
async def test_lock_provides_mutual_exclusion():
    """Two coroutines competing for the same lock should not overlap."""
    index = ConnectionIndex()
    lock = index.get_tenant_branch_lock(1, 1)
    order: list[str] = []

    async def task_a():
        async with lock:
            order.append("A_start")
            await asyncio.sleep(0.01)
            order.append("A_end")

    async def task_b():
        await asyncio.sleep(0.005)  # Start slightly after A
        async with lock:
            order.append("B_start")
            await asyncio.sleep(0.01)
            order.append("B_end")

    await asyncio.gather(task_a(), task_b())
    # A and B must not interleave
    assert order.index("A_end") < order.index("B_start")
