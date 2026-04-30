"""
Seed: Rich demo dataset — activated by `python -m rest_api.seeds.runner --full`.

WARNING: This seed is for DEV ONLY. Never run against staging or production.

What this module creates (all under tenant_id=1, branch_id=1):

  Extra allergens:
    - Gluten (moderate), Lácteos (moderate), Mariscos (severe / mandatory)

  Extra menu:
    - Category "Entradas": subcategory "Entradas frías"
        * Tostadas bruschetta  (800 cents)   — Gluten (contains), Lácteos (may_contain)
        * Provoleta            (1200 cents)  — Lácteos (contains)
    - Category "Pescados y Mariscos": subcategory "Mariscos"
        * Langostinos al ajillo (2200 cents) — Mariscos (contains / severe)
    - Under existing "Platos Principales" > "Carnes":
        * Empanadas de carne    (900 cents)  — Gluten (contains)
    - Under existing "Platos Principales" > new subcategory "Postres":
        * Flan mixto            (700 cents)  — Lácteos (contains)

  T01 (OPEN):
    - 2 Diners: "Juan", "María"
    - Round #1: SERVED — 2 items — KitchenTicket DELIVERED
    - Round #2: IN_KITCHEN — 3 items — KitchenTicket IN_PROGRESS

  T02 (PAYING):
    - 1 Diner: "Pedro"
    - Round #1: SERVED — 2 items (total 4500 cents)
    - Check REQUESTED (total_cents=4500)
    - Charge 4500 cents for Pedro
    - Payment APPROVED 2000 cents (partial)
    - Allocation 2000 cents → remaining 2500 unpaid

  Service calls on T01 session:
    - 1 ACKED (resolved)
    - 1 CREATED (unresolved — shows red badge in pwaWaiter)

  Historical sessions (3 × CLOSED, T01, relative dates):
    - Session -1d: 1 Diner, Round SERVED, Check PAID, Payment APPROVED (card)
    - Session -2d: 1 Diner, Round SERVED, Check PAID, Payment APPROVED (cash)
    - Session -3d: 1 Diner, Round SERVED, Check PAID, Payment APPROVED (card)

Idempotency:
  - All blocks use get-or-create with natural keys (see design §D-02).
  - Running this function N times always leaves the same counts.

RULES (non-negotiable):
  - NEVER db.commit() — caller owns the commit via safe_commit(db)
  - NEVER use == True — use .is_(True)
  - ALWAYS filter by tenant_id
  - Prices in INTEGER cents only
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from rest_api.models.allergen import Allergen, ProductAllergen
from rest_api.models.billing import Allocation, Charge, Check, Payment
from rest_api.models.kitchen_ticket import KitchenTicket, KitchenTicketItem
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.models.round import Round, RoundItem
from rest_api.models.sector import Table
from rest_api.models.service_call import ServiceCall
from rest_api.models.table_session import Diner, TableSession

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Dataset constants
# ---------------------------------------------------------------------------

_ADMIN_USER_ID = 1  # admin@demo.com — used for all staff actor columns

_ALLERGENS = [
    {"name": "Gluten", "severity": "moderate", "is_mandatory": True},
    {"name": "Lácteos", "severity": "moderate", "is_mandatory": True},
    {"name": "Mariscos", "severity": "severe", "is_mandatory": True},
]

# New categories and their new subcategories + products
_EXTRA_MENU: list[dict] = [
    {
        "category": "Entradas",
        "subcategory": "Entradas frías",
        "products": [
            {
                "name": "Tostadas bruschetta",
                "price_cents": 800,
                "description": "Pan tostado con tomate y albahaca",
                "allergens": [
                    {"name": "Gluten", "presence_type": "contains", "risk_level": "moderate"},
                    {"name": "Lácteos", "presence_type": "may_contain", "risk_level": "mild"},
                ],
            },
            {
                "name": "Provoleta",
                "price_cents": 1200,
                "description": "Queso provolone gratinado con orégano",
                "allergens": [
                    {"name": "Lácteos", "presence_type": "contains", "risk_level": "moderate"},
                ],
            },
        ],
    },
    {
        "category": "Pescados y Mariscos",
        "subcategory": "Mariscos",
        "products": [
            {
                "name": "Langostinos al ajillo",
                "price_cents": 2200,
                "description": "Langostinos salteados con ajo y limón",
                "allergens": [
                    {"name": "Mariscos", "presence_type": "contains", "risk_level": "severe"},
                ],
            },
        ],
    },
]

# Products to add to EXISTING categories/subcategories
_EXTRA_PRODUCTS_IN_EXISTING: list[dict] = [
    {
        "category": "Platos Principales",
        "subcategory": "Carnes",
        "products": [
            {
                "name": "Empanadas de carne",
                "price_cents": 900,
                "description": "6 unidades, horno",
                "allergens": [
                    {"name": "Gluten", "presence_type": "contains", "risk_level": "moderate"},
                ],
            },
        ],
    },
    {
        "category": "Platos Principales",
        "subcategory": "Postres",
        "products": [
            {
                "name": "Flan mixto",
                "price_cents": 700,
                "description": "Con dulce de leche y crema",
                "allergens": [
                    {"name": "Lácteos", "presence_type": "contains", "risk_level": "moderate"},
                ],
            },
        ],
    },
]

# T01 Round #1 (SERVED): items → product_name, qty, price_cents_snapshot
_T01_R1_ITEMS = [
    {"product": "Coca Cola", "qty": 2, "price_cents": 300},
    {"product": "Milanesa", "qty": 1, "price_cents": 1800},
]

# T01 Round #2 (IN_KITCHEN): items → product_name, qty, price_cents_snapshot
_T01_R2_ITEMS = [
    {"product": "Quilmes", "qty": 2, "price_cents": 400},
    {"product": "Bife de Chorizo", "qty": 1, "price_cents": 2500},
    {"product": "Tostadas bruschetta", "qty": 1, "price_cents": 800},
]

# T02 Round #1 (SERVED): 2 items, total 4500 cents
_T02_R1_ITEMS = [
    {"product": "Milanesa", "qty": 1, "price_cents": 1800},
    {"product": "Bife de Chorizo", "qty": 1, "price_cents": 2500},
]
_T02_R1_TOTAL = 4500  # sum of items above

# Historical sessions
_HISTORICAL = [
    {
        "days_ago": 1,
        "diner_name": "Histórico 1",
        "items": [{"product": "Milanesa", "qty": 1, "price_cents": 1800}],
        "total_cents": 1800,
        "payment_method": "card",
    },
    {
        "days_ago": 2,
        "diner_name": "Histórico 2",
        "items": [
            {"product": "Bife de Chorizo", "qty": 1, "price_cents": 2500},
            {"product": "Quilmes", "qty": 2, "price_cents": 400},
        ],
        "total_cents": 3300,
        "payment_method": "cash",
    },
    {
        "days_ago": 3,
        "diner_name": "Histórico 3",
        "items": [
            {"product": "Coca Cola", "qty": 1, "price_cents": 300},
            {"product": "Milanesa", "qty": 1, "price_cents": 1800},
            {"product": "Provoleta", "qty": 1, "price_cents": 1200},
        ],
        "total_cents": 3300,
        "payment_method": "card",
    },
]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def seed_demo_full(db: AsyncSession, tenant_id: int, branch_id: int) -> None:
    """
    Seed the rich demo dataset.

    All inserts are idempotent — safe to call multiple times.
    The caller is responsible for calling safe_commit(db).
    """
    logger.info("seed: starting demo_full (tenant_id=%s branch_id=%s)", tenant_id, branch_id)

    # Build a lookup map for allergens (needed by menu seeding)
    allergen_map = await _seed_extra_allergens(db, tenant_id=tenant_id)

    await _seed_extra_menu(
        db,
        branch_id=branch_id,
        tenant_id=tenant_id,
        allergen_map=allergen_map,
    )

    # Product lookup (needed by session seeding)
    product_map = await _build_product_map(db, branch_id=branch_id)

    # T01: OPEN session with two rounds in different states
    session_open, diner_juan, diner_maria = await _seed_table_session_open(
        db, branch_id=branch_id, product_map=product_map
    )

    # T02: PAYING session with partial payment
    await _seed_table_session_paying(
        db, branch_id=branch_id, tenant_id=tenant_id, product_map=product_map
    )

    # Service calls on T01
    if session_open is not None:
        await _seed_service_calls(db, session_open=session_open)

    # 3 historical CLOSED sessions
    await _seed_historical_sessions(
        db, branch_id=branch_id, tenant_id=tenant_id, product_map=product_map
    )

    # Count summary for logs
    sessions_count = (
        await db.execute(select(func.count()).select_from(TableSession))
    ).scalar_one()
    rounds_count = (
        await db.execute(select(func.count()).select_from(Round))
    ).scalar_one()
    checks_count = (
        await db.execute(select(func.count()).select_from(Check))
    ).scalar_one()
    payments_count = (
        await db.execute(select(func.count()).select_from(Payment))
    ).scalar_one()
    sc_count = (
        await db.execute(select(func.count()).select_from(ServiceCall))
    ).scalar_one()

    logger.info(
        "seed: demo_full complete — sessions=%d rounds=%d checks=%d payments=%d service_calls=%d",
        sessions_count,
        rounds_count,
        checks_count,
        payments_count,
        sc_count,
    )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


async def _seed_extra_allergens(
    db: AsyncSession, tenant_id: int
) -> dict[str, Allergen]:
    """
    Create the 3 demo allergens (Gluten, Lácteos, Mariscos).
    Returns a dict {name: Allergen} for downstream product linking.
    """
    allergen_map: dict[str, Allergen] = {}

    for data in _ALLERGENS:
        result = await db.execute(
            select(Allergen).where(
                Allergen.tenant_id == tenant_id,
                Allergen.name == data["name"],
                Allergen.is_active.is_(True),
            )
        )
        allergen = result.scalar_one_or_none()
        if allergen is not None:
            logger.info("seed: allergen %r already exists id=%s", data["name"], allergen.id)
            allergen_map[data["name"]] = allergen
            continue

        allergen = Allergen(
            tenant_id=tenant_id,
            name=data["name"],
            severity=data["severity"],
            is_mandatory=data["is_mandatory"],
        )
        db.add(allergen)
        await db.flush()
        logger.info("seed: created allergen id=%s name=%r", allergen.id, allergen.name)
        allergen_map[data["name"]] = allergen

    return allergen_map


async def _seed_extra_menu(
    db: AsyncSession,
    branch_id: int,
    tenant_id: int,
    allergen_map: dict[str, Allergen],
) -> None:
    """
    Create new categories + subcategories + products, then add extra products
    to existing categories/subcategories. Link ProductAllergen rows.
    """
    # 1. New categories (and their subcategories + products)
    for block in _EXTRA_MENU:
        category = await _upsert_category(db, branch_id=branch_id, name=block["category"])
        subcategory = await _upsert_subcategory(db, category_id=category.id, name=block["subcategory"])
        for prod_data in block["products"]:
            product = await _upsert_product(
                db,
                branch_id=branch_id,
                subcategory_id=subcategory.id,
                prod_data=prod_data,
            )
            for pa_data in prod_data.get("allergens", []):
                await _upsert_product_allergen(
                    db,
                    product_id=product.id,
                    allergen=allergen_map[pa_data["name"]],
                    presence_type=pa_data["presence_type"],
                    risk_level=pa_data["risk_level"],
                )

    # 2. Extra products in existing categories
    for block in _EXTRA_PRODUCTS_IN_EXISTING:
        category = await _find_category(db, branch_id=branch_id, name=block["category"])
        if category is None:
            logger.warning(
                "seed: category %r not found for branch_id=%s — skipping extra products",
                block["category"],
                branch_id,
            )
            continue

        subcategory = await _upsert_subcategory(db, category_id=category.id, name=block["subcategory"])
        for prod_data in block["products"]:
            product = await _upsert_product(
                db,
                branch_id=branch_id,
                subcategory_id=subcategory.id,
                prod_data=prod_data,
            )
            for pa_data in prod_data.get("allergens", []):
                await _upsert_product_allergen(
                    db,
                    product_id=product.id,
                    allergen=allergen_map[pa_data["name"]],
                    presence_type=pa_data["presence_type"],
                    risk_level=pa_data["risk_level"],
                )


async def _build_product_map(db: AsyncSession, branch_id: int) -> dict[str, Product]:
    """
    Build a {product_name: Product} lookup for all active products in the branch.
    Used by session/round seeding so we don't re-query per item.
    """
    result = await db.execute(
        select(Product)
        .join(Subcategory, Product.subcategory_id == Subcategory.id)
        .join(Category, Subcategory.category_id == Category.id)
        .where(
            Category.branch_id == branch_id,
            Category.is_active.is_(True),
            Subcategory.is_active.is_(True),
            Product.is_active.is_(True),
        )
    )
    return {p.name: p for p in result.scalars().all()}


async def _seed_table_session_open(
    db: AsyncSession,
    branch_id: int,
    product_map: dict[str, Product],
) -> tuple[TableSession | None, Diner | None, Diner | None]:
    """
    Seed T01 as OPEN with 2 Diners and 2 Rounds in different states.

    Returns (session, diner_juan, diner_maria) — or (None, None, None) if T01
    is missing (should never happen after seed_demo_data runs first).
    """
    now = datetime.now(timezone.utc)

    table = await _find_table(db, branch_id=branch_id, code="T01")
    if table is None:
        logger.warning("seed: T01 not found for branch_id=%s — skipping open session", branch_id)
        return None, None, None

    # Idempotency: if an OPEN or PAYING session already exists for T01, skip
    existing_result = await db.execute(
        select(TableSession).where(
            TableSession.table_id == table.id,
            TableSession.status.in_(["OPEN", "PAYING"]),
            TableSession.is_active.is_(True),
        )
    )
    existing_session = existing_result.scalar_one_or_none()
    if existing_session is not None:
        logger.info(
            "seed: active session for T01 already exists id=%s status=%r",
            existing_session.id,
            existing_session.status,
        )
        # Return existing session + diners (for service_calls seeding)
        juan = await _find_diner(db, session_id=existing_session.id, name="Juan")
        maria = await _find_diner(db, session_id=existing_session.id, name="María")
        return existing_session, juan, maria

    # Create T01 OPEN session
    session = TableSession(
        table_id=table.id,
        branch_id=branch_id,
        status="OPEN",
    )
    db.add(session)
    await db.flush()
    logger.info("seed: created T01 OPEN session id=%s", session.id)

    # Diners
    diner_juan = Diner(session_id=session.id, name="Juan")
    diner_maria = Diner(session_id=session.id, name="María")
    db.add(diner_juan)
    db.add(diner_maria)
    await db.flush()
    logger.info(
        "seed: created diners Juan id=%s María id=%s for session id=%s",
        diner_juan.id, diner_maria.id, session.id,
    )

    # Round #1 — SERVED
    round1 = Round(
        session_id=session.id,
        branch_id=branch_id,
        round_number=1,
        status="SERVED",
        created_by_role="DINER",
        created_by_diner_id=diner_juan.id,
        created_by_user_id=None,
        confirmed_by_id=_ADMIN_USER_ID,
        submitted_by_id=_ADMIN_USER_ID,
        pending_at=now - timedelta(hours=2),
        confirmed_at=now - timedelta(hours=2, minutes=-2),
        submitted_at=now - timedelta(hours=1, minutes=55),
        in_kitchen_at=now - timedelta(hours=1, minutes=50),
        ready_at=now - timedelta(hours=1, minutes=30),
        served_at=now - timedelta(hours=1, minutes=25),
    )
    db.add(round1)
    await db.flush()
    logger.info("seed: created T01 Round#1 id=%s status=SERVED", round1.id)

    # Round #1 items
    r1_items = []
    for item_data in _T01_R1_ITEMS:
        product = product_map.get(item_data["product"])
        if product is None:
            logger.warning("seed: product %r not found — skipping round1 item", item_data["product"])
            continue
        ri = RoundItem(
            round_id=round1.id,
            product_id=product.id,
            diner_id=diner_juan.id,
            quantity=item_data["qty"],
            price_cents_snapshot=item_data["price_cents"],
        )
        db.add(ri)
        r1_items.append(ri)
    await db.flush()

    # KitchenTicket for Round #1 — DELIVERED
    ticket1 = KitchenTicket(
        round_id=round1.id,
        branch_id=branch_id,
        status="DELIVERED",
        started_at=now - timedelta(hours=1, minutes=50),
        ready_at=now - timedelta(hours=1, minutes=30),
        delivered_at=now - timedelta(hours=1, minutes=25),
    )
    db.add(ticket1)
    await db.flush()
    logger.info("seed: created T01 KitchenTicket#1 id=%s status=DELIVERED", ticket1.id)

    for ri in r1_items:
        kti = KitchenTicketItem(ticket_id=ticket1.id, round_item_id=ri.id)
        db.add(kti)
    await db.flush()

    # Round #2 — IN_KITCHEN
    round2 = Round(
        session_id=session.id,
        branch_id=branch_id,
        round_number=2,
        status="IN_KITCHEN",
        created_by_role="DINER",
        created_by_diner_id=diner_maria.id,
        created_by_user_id=None,
        confirmed_by_id=_ADMIN_USER_ID,
        submitted_by_id=_ADMIN_USER_ID,
        pending_at=now - timedelta(minutes=20),
        confirmed_at=now - timedelta(minutes=18),
        submitted_at=now - timedelta(minutes=15),
        in_kitchen_at=now - timedelta(minutes=14),
        ready_at=None,
        served_at=None,
    )
    db.add(round2)
    await db.flush()
    logger.info("seed: created T01 Round#2 id=%s status=IN_KITCHEN", round2.id)

    # Round #2 items
    r2_items = []
    for item_data in _T01_R2_ITEMS:
        product = product_map.get(item_data["product"])
        if product is None:
            logger.warning("seed: product %r not found — skipping round2 item", item_data["product"])
            continue
        ri = RoundItem(
            round_id=round2.id,
            product_id=product.id,
            diner_id=diner_maria.id,
            quantity=item_data["qty"],
            price_cents_snapshot=item_data["price_cents"],
        )
        db.add(ri)
        r2_items.append(ri)
    await db.flush()

    # KitchenTicket for Round #2 — IN_PROGRESS
    ticket2 = KitchenTicket(
        round_id=round2.id,
        branch_id=branch_id,
        status="IN_PROGRESS",
        started_at=now - timedelta(minutes=14),
        ready_at=None,
        delivered_at=None,
    )
    db.add(ticket2)
    await db.flush()
    logger.info("seed: created T01 KitchenTicket#2 id=%s status=IN_PROGRESS", ticket2.id)

    for ri in r2_items:
        kti = KitchenTicketItem(ticket_id=ticket2.id, round_item_id=ri.id)
        db.add(kti)
    await db.flush()

    return session, diner_juan, diner_maria


async def _seed_table_session_paying(
    db: AsyncSession,
    branch_id: int,
    tenant_id: int,
    product_map: dict[str, Product],
) -> None:
    """
    Seed T02 as PAYING with 1 Diner, 1 Round SERVED, a Check REQUESTED,
    and a partial Payment (2000/4500 cents).
    """
    now = datetime.now(timezone.utc)

    table = await _find_table(db, branch_id=branch_id, code="T02")
    if table is None:
        logger.warning("seed: T02 not found for branch_id=%s — skipping paying session", branch_id)
        return

    # Idempotency: active session for T02
    existing_result = await db.execute(
        select(TableSession).where(
            TableSession.table_id == table.id,
            TableSession.status.in_(["OPEN", "PAYING"]),
            TableSession.is_active.is_(True),
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        logger.info("seed: active session for T02 already exists — skipping")
        return

    # Create T02 PAYING session
    session = TableSession(
        table_id=table.id,
        branch_id=branch_id,
        status="PAYING",
    )
    db.add(session)
    await db.flush()
    logger.info("seed: created T02 PAYING session id=%s", session.id)

    # Diner: Pedro
    diner_pedro = Diner(session_id=session.id, name="Pedro")
    db.add(diner_pedro)
    await db.flush()
    logger.info("seed: created diner Pedro id=%s for session id=%s", diner_pedro.id, session.id)

    # Round #1 — SERVED
    round1 = Round(
        session_id=session.id,
        branch_id=branch_id,
        round_number=1,
        status="SERVED",
        created_by_role="DINER",
        created_by_diner_id=diner_pedro.id,
        created_by_user_id=None,
        confirmed_by_id=_ADMIN_USER_ID,
        submitted_by_id=_ADMIN_USER_ID,
        pending_at=now - timedelta(hours=1, minutes=30),
        confirmed_at=now - timedelta(hours=1, minutes=28),
        submitted_at=now - timedelta(hours=1, minutes=25),
        in_kitchen_at=now - timedelta(hours=1, minutes=24),
        ready_at=now - timedelta(hours=1, minutes=10),
        served_at=now - timedelta(hours=1, minutes=5),
    )
    db.add(round1)
    await db.flush()
    logger.info("seed: created T02 Round#1 id=%s status=SERVED", round1.id)

    # Round items
    r1_items = []
    for item_data in _T02_R1_ITEMS:
        product = product_map.get(item_data["product"])
        if product is None:
            logger.warning("seed: product %r not found — skipping T02 round1 item", item_data["product"])
            continue
        ri = RoundItem(
            round_id=round1.id,
            product_id=product.id,
            diner_id=diner_pedro.id,
            quantity=item_data["qty"],
            price_cents_snapshot=item_data["price_cents"],
        )
        db.add(ri)
        r1_items.append(ri)
    await db.flush()

    # KitchenTicket — DELIVERED
    ticket = KitchenTicket(
        round_id=round1.id,
        branch_id=branch_id,
        status="DELIVERED",
        started_at=now - timedelta(hours=1, minutes=24),
        ready_at=now - timedelta(hours=1, minutes=10),
        delivered_at=now - timedelta(hours=1, minutes=5),
    )
    db.add(ticket)
    await db.flush()
    for ri in r1_items:
        db.add(KitchenTicketItem(ticket_id=ticket.id, round_item_id=ri.id))
    await db.flush()

    # Check REQUESTED — total 4500 cents
    check = Check(
        session_id=session.id,
        branch_id=branch_id,
        tenant_id=tenant_id,
        total_cents=_T02_R1_TOTAL,
        status="REQUESTED",
    )
    db.add(check)
    await db.flush()
    logger.info(
        "seed: created Check id=%s total_cents=%d status=REQUESTED",
        check.id,
        check.total_cents,
    )

    # Charge — full amount for Pedro
    charge = Charge(
        check_id=check.id,
        diner_id=diner_pedro.id,
        amount_cents=_T02_R1_TOTAL,
        description="Total mesa",
    )
    db.add(charge)
    await db.flush()
    logger.info("seed: created Charge id=%s amount_cents=%d", charge.id, charge.amount_cents)

    # Payment APPROVED — partial (2000 / 4500)
    payment = Payment(
        check_id=check.id,
        amount_cents=2000,
        method="cash",
        status="APPROVED",
    )
    db.add(payment)
    await db.flush()
    logger.info(
        "seed: created Payment id=%s amount_cents=2000 status=APPROVED",
        payment.id,
    )

    # Allocation: 2000 cents of the 4500 charge covered
    allocation = Allocation(
        charge_id=charge.id,
        payment_id=payment.id,
        amount_cents=2000,
    )
    db.add(allocation)
    await db.flush()
    logger.info(
        "seed: created Allocation id=%s charge_id=%s payment_id=%s amount_cents=2000",
        allocation.id, charge.id, payment.id,
    )
    # Remaining: 4500 - 2000 = 2500 cents unpaid → check stays REQUESTED


async def _seed_service_calls(
    db: AsyncSession,
    session_open: TableSession,
) -> None:
    """
    Create 2 service calls on the T01 OPEN session:
      - 1 ACKED (already seen by a waiter)
      - 1 CREATED (unresolved — shows red badge in pwaWaiter)

    Idempotency: if the session already has any service calls, skip.
    """
    # Idempotency: if there are already service calls for this session, skip
    existing_count_result = await db.execute(
        select(func.count())
        .select_from(ServiceCall)
        .where(ServiceCall.session_id == session_open.id)
    )
    if existing_count_result.scalar_one() > 0:
        logger.info(
            "seed: service calls already exist for session id=%s — skipping",
            session_open.id,
        )
        return

    now = datetime.now(timezone.utc)

    # ACKED call (already resolved by waiter)
    call_acked = ServiceCall(
        session_id=session_open.id,
        table_id=session_open.table_id,
        branch_id=session_open.branch_id,
        status="ACKED",
        acked_by_id=_ADMIN_USER_ID,
        acked_at=now - timedelta(minutes=45),
        closed_by_id=None,
        closed_at=None,
    )
    db.add(call_acked)
    await db.flush()
    logger.info("seed: created ServiceCall ACKED id=%s session_id=%s", call_acked.id, session_open.id)

    # CREATED call (unresolved — shows as red badge)
    call_created = ServiceCall(
        session_id=session_open.id,
        table_id=session_open.table_id,
        branch_id=session_open.branch_id,
        status="CREATED",
        acked_by_id=None,
        acked_at=None,
        closed_by_id=None,
        closed_at=None,
    )
    db.add(call_created)
    await db.flush()
    logger.info("seed: created ServiceCall CREATED id=%s session_id=%s", call_created.id, session_open.id)


async def _seed_historical_sessions(
    db: AsyncSession,
    branch_id: int,
    tenant_id: int,
    product_map: dict[str, Product],
) -> None:
    """
    Create 3 CLOSED historical sessions for T01 with relative dates.

    Idempotency: if >= 3 CLOSED sessions already exist for T01 in
    [now()-4d, now()], skip the whole block.
    """
    table = await _find_table(db, branch_id=branch_id, code="T01")
    if table is None:
        logger.warning("seed: T01 not found for branch_id=%s — skipping historical sessions", branch_id)
        return

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=4)

    # Idempotency check: count CLOSED sessions for T01 in the relevant range
    existing_count_result = await db.execute(
        select(func.count())
        .select_from(TableSession)
        .where(
            TableSession.table_id == table.id,
            TableSession.status == "CLOSED",
            TableSession.created_at >= cutoff,
        )
    )
    if existing_count_result.scalar_one() >= 3:
        logger.info(
            "seed: >= 3 CLOSED sessions already exist for T01 in the last 4 days — skipping historical"
        )
        return

    for hist in _HISTORICAL:
        days_ago = hist["days_ago"]
        session_created_at = now - timedelta(days=days_ago)

        # Create CLOSED session (is_active=False — closed sessions are soft-deleted per convention)
        session = TableSession(
            table_id=table.id,
            branch_id=branch_id,
            status="CLOSED",
            is_active=False,
            created_at=session_created_at,
        )
        db.add(session)
        await db.flush()
        logger.info(
            "seed: created historical session id=%s days_ago=%d",
            session.id, days_ago,
        )

        # Diner
        diner = Diner(session_id=session.id, name=hist["diner_name"])
        db.add(diner)
        await db.flush()

        # Round SERVED
        round_created_at = session_created_at + timedelta(minutes=10)
        round_ = Round(
            session_id=session.id,
            branch_id=branch_id,
            round_number=1,
            status="SERVED",
            created_by_role="DINER",
            created_by_diner_id=diner.id,
            created_by_user_id=None,
            confirmed_by_id=_ADMIN_USER_ID,
            submitted_by_id=_ADMIN_USER_ID,
            pending_at=round_created_at,
            confirmed_at=round_created_at + timedelta(minutes=2),
            submitted_at=round_created_at + timedelta(minutes=5),
            in_kitchen_at=round_created_at + timedelta(minutes=6),
            ready_at=round_created_at + timedelta(minutes=20),
            served_at=round_created_at + timedelta(minutes=25),
        )
        db.add(round_)
        await db.flush()

        # Round items
        r_items = []
        for item_data in hist["items"]:
            product = product_map.get(item_data["product"])
            if product is None:
                logger.warning(
                    "seed: product %r not found — skipping historical item",
                    item_data["product"],
                )
                continue
            ri = RoundItem(
                round_id=round_.id,
                product_id=product.id,
                diner_id=diner.id,
                quantity=item_data["qty"],
                price_cents_snapshot=item_data["price_cents"],
            )
            db.add(ri)
            r_items.append(ri)
        await db.flush()

        # KitchenTicket — DELIVERED
        ticket = KitchenTicket(
            round_id=round_.id,
            branch_id=branch_id,
            status="DELIVERED",
            started_at=round_created_at + timedelta(minutes=6),
            ready_at=round_created_at + timedelta(minutes=20),
            delivered_at=round_created_at + timedelta(minutes=25),
        )
        db.add(ticket)
        await db.flush()
        for ri in r_items:
            db.add(KitchenTicketItem(ticket_id=ticket.id, round_item_id=ri.id))
        await db.flush()

        # Check PAID
        total_cents = hist["total_cents"]
        check = Check(
            session_id=session.id,
            branch_id=branch_id,
            tenant_id=tenant_id,
            total_cents=total_cents,
            status="PAID",
        )
        db.add(check)
        await db.flush()

        # Charge — full amount
        charge = Charge(
            check_id=check.id,
            diner_id=diner.id,
            amount_cents=total_cents,
            description="Cuenta histórica",
        )
        db.add(charge)
        await db.flush()

        # Payment APPROVED — full amount
        payment = Payment(
            check_id=check.id,
            amount_cents=total_cents,
            method=hist["payment_method"],
            status="APPROVED",
        )
        db.add(payment)
        await db.flush()

        # Allocation — covers the full charge
        allocation = Allocation(
            charge_id=charge.id,
            payment_id=payment.id,
            amount_cents=total_cents,
        )
        db.add(allocation)
        await db.flush()

        logger.info(
            "seed: historical session id=%s days_ago=%d total_cents=%d method=%r DONE",
            session.id, days_ago, total_cents, hist["payment_method"],
        )


# ---------------------------------------------------------------------------
# Low-level upsert helpers
# ---------------------------------------------------------------------------


async def _find_table(db: AsyncSession, branch_id: int, code: str) -> Table | None:
    result = await db.execute(
        select(Table).where(
            Table.branch_id == branch_id,
            Table.code == code,
            Table.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none()


async def _find_diner(db: AsyncSession, session_id: int, name: str) -> Diner | None:
    result = await db.execute(
        select(Diner).where(
            Diner.session_id == session_id,
            Diner.name == name,
            Diner.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none()


async def _find_category(
    db: AsyncSession, branch_id: int, name: str
) -> Category | None:
    result = await db.execute(
        select(Category).where(
            Category.branch_id == branch_id,
            Category.name == name,
            Category.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none()


async def _upsert_category(db: AsyncSession, branch_id: int, name: str) -> Category:
    existing = await _find_category(db, branch_id=branch_id, name=name)
    if existing is not None:
        return existing

    # Find next display order
    max_order_result = await db.execute(
        select(func.max(Category.order)).where(Category.branch_id == branch_id)
    )
    max_order = max_order_result.scalar_one_or_none() or 0
    category = Category(branch_id=branch_id, name=name, order=max_order + 10)
    db.add(category)
    await db.flush()
    logger.info("seed: created category id=%s name=%r", category.id, category.name)
    return category


async def _upsert_subcategory(db: AsyncSession, category_id: int, name: str) -> Subcategory:
    result = await db.execute(
        select(Subcategory).where(
            Subcategory.category_id == category_id,
            Subcategory.name == name,
            Subcategory.is_active.is_(True),
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing

    max_order_result = await db.execute(
        select(func.max(Subcategory.order)).where(Subcategory.category_id == category_id)
    )
    max_order = max_order_result.scalar_one_or_none() or 0
    subcategory = Subcategory(category_id=category_id, name=name, order=max_order + 10)
    db.add(subcategory)
    await db.flush()
    logger.info(
        "seed: created subcategory id=%s name=%r", subcategory.id, subcategory.name
    )
    return subcategory


async def _upsert_product(
    db: AsyncSession,
    branch_id: int,
    subcategory_id: int,
    prod_data: dict,
) -> Product:
    result = await db.execute(
        select(Product).where(
            Product.subcategory_id == subcategory_id,
            Product.name == prod_data["name"],
            Product.is_active.is_(True),
        )
    )
    product = result.scalar_one_or_none()

    if product is None:
        product = Product(
            subcategory_id=subcategory_id,
            name=prod_data["name"],
            description=prod_data.get("description"),
            price=prod_data["price_cents"],
        )
        db.add(product)
        await db.flush()
        logger.info("seed: created product id=%s name=%r", product.id, product.name)

    # Ensure BranchProduct exists
    bp_result = await db.execute(
        select(BranchProduct).where(
            BranchProduct.product_id == product.id,
            BranchProduct.branch_id == branch_id,
            BranchProduct.is_active.is_(True),
        )
    )
    if bp_result.scalar_one_or_none() is None:
        db.add(
            BranchProduct(
                product_id=product.id,
                branch_id=branch_id,
                price_cents=prod_data["price_cents"],
                is_available=True,
            )
        )
        await db.flush()
        logger.info(
            "seed: linked product id=%s to branch_id=%s price=%s",
            product.id, branch_id, prod_data["price_cents"],
        )

    return product


async def _upsert_product_allergen(
    db: AsyncSession,
    product_id: int,
    allergen: Allergen,
    presence_type: str,
    risk_level: str,
) -> None:
    """
    Link an allergen to a product (idempotent via UniqueConstraint on product_id, allergen_id).
    """
    result = await db.execute(
        select(ProductAllergen).where(
            ProductAllergen.product_id == product_id,
            ProductAllergen.allergen_id == allergen.id,
        )
    )
    if result.scalar_one_or_none() is not None:
        return

    pa = ProductAllergen(
        product_id=product_id,
        allergen_id=allergen.id,
        presence_type=presence_type,
        risk_level=risk_level,
    )
    db.add(pa)
    await db.flush()
    logger.info(
        "seed: linked product_id=%s allergen=%r presence_type=%r",
        product_id, allergen.name, presence_type,
    )
