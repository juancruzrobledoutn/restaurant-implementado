"""
Seed: DEV demo data — sectors, tables, categories, products.

Unblocks the smoke tests for C-18 (pwaMenu) and C-21 (pwaWaiter) by creating
the minimum operational dataset needed to exercise the full flow:

  - BranchSector "Salón principal"
  - 3 Tables: T01, T02, T03 (numbered 1..3, capacity 4 each)
  - 2 Categories: "Bebidas", "Platos Principales"
  - 3 Subcategories: "Gaseosas", "Cervezas", "Carnes"
  - 5 Products with BranchProduct pricing (all prices in cents):
      * Coca Cola       $3.00
      * Fanta           $2.80
      * Quilmes         $4.00
      * Milanesa        $18.00
      * Bife de Chorizo $25.00

Idempotent — every insert checks for an existing record first.

Must run BEFORE seed_staff_management so the waiter can be assigned to the sector.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.models.sector import BranchSector, Table

logger = get_logger(__name__)

_SECTOR_NAME = "Salón principal"

_TABLES = [
    {"number": 1, "code": "T01", "capacity": 4},
    {"number": 2, "code": "T02", "capacity": 4},
    {"number": 3, "code": "T03", "capacity": 6},
]

_MENU = {
    "Bebidas": {
        "Gaseosas": [
            {"name": "Coca Cola", "price_cents": 300, "description": "Lata 354ml"},
            {"name": "Fanta", "price_cents": 280, "description": "Lata 354ml"},
        ],
        "Cervezas": [
            {"name": "Quilmes", "price_cents": 400, "description": "Porrón 330ml"},
        ],
    },
    "Platos Principales": {
        "Carnes": [
            {"name": "Milanesa", "price_cents": 1800, "description": "Con papas fritas"},
            {"name": "Bife de Chorizo", "price_cents": 2500, "description": "350gr con guarnición"},
        ],
    },
}


async def seed_demo_data(db: AsyncSession, branch_id: int) -> None:
    """Create sector, tables, and menu entries for the given branch."""
    sector = await _seed_sector(db, branch_id=branch_id)
    await _seed_tables(db, branch_id=branch_id, sector_id=sector.id)
    await _seed_menu(db, branch_id=branch_id)


async def _seed_sector(db: AsyncSession, branch_id: int) -> BranchSector:
    result = await db.execute(
        select(BranchSector).where(
            BranchSector.branch_id == branch_id,
            BranchSector.name == _SECTOR_NAME,
            BranchSector.is_active.is_(True),
        )
    )
    sector = result.scalar_one_or_none()
    if sector is not None:
        logger.info("seed: sector already exists id=%s", sector.id)
        return sector

    sector = BranchSector(branch_id=branch_id, name=_SECTOR_NAME)
    db.add(sector)
    await db.flush()
    logger.info("seed: created sector id=%s name=%r", sector.id, sector.name)
    return sector


async def _seed_tables(db: AsyncSession, branch_id: int, sector_id: int) -> None:
    for data in _TABLES:
        result = await db.execute(
            select(Table).where(
                Table.branch_id == branch_id,
                Table.code == data["code"],
                Table.is_active.is_(True),
            )
        )
        if result.scalar_one_or_none() is not None:
            logger.info("seed: table %r already exists", data["code"])
            continue

        table = Table(
            branch_id=branch_id,
            sector_id=sector_id,
            number=data["number"],
            code=data["code"],
            capacity=data["capacity"],
        )
        db.add(table)
        await db.flush()
        logger.info("seed: created table id=%s code=%r", table.id, table.code)


async def _seed_menu(db: AsyncSession, branch_id: int) -> None:
    order = 10
    for category_name, subcats in _MENU.items():
        category = await _upsert_category(db, branch_id=branch_id, name=category_name, order=order)
        order += 10

        sub_order = 10
        for subcat_name, products in subcats.items():
            subcategory = await _upsert_subcategory(
                db,
                category_id=category.id,
                name=subcat_name,
                order=sub_order,
            )
            sub_order += 10

            for prod_data in products:
                await _upsert_product(
                    db,
                    branch_id=branch_id,
                    subcategory_id=subcategory.id,
                    prod_data=prod_data,
                )


async def _upsert_category(
    db: AsyncSession, branch_id: int, name: str, order: int
) -> Category:
    result = await db.execute(
        select(Category).where(
            Category.branch_id == branch_id,
            Category.name == name,
            Category.is_active.is_(True),
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing

    category = Category(branch_id=branch_id, name=name, order=order)
    db.add(category)
    await db.flush()
    logger.info("seed: created category id=%s name=%r", category.id, category.name)
    return category


async def _upsert_subcategory(
    db: AsyncSession, category_id: int, name: str, order: int
) -> Subcategory:
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

    subcategory = Subcategory(category_id=category_id, name=name, order=order)
    db.add(subcategory)
    await db.flush()
    logger.info(
        "seed: created subcategory id=%s name=%r", subcategory.id, subcategory.name
    )
    return subcategory


async def _upsert_product(
    db: AsyncSession, branch_id: int, subcategory_id: int, prod_data: dict
) -> None:
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
            description=prod_data["description"],
            price=prod_data["price_cents"],
        )
        db.add(product)
        await db.flush()
        logger.info("seed: created product id=%s name=%r", product.id, product.name)

    bp_result = await db.execute(
        select(BranchProduct).where(
            BranchProduct.product_id == product.id,
            BranchProduct.branch_id == branch_id,
            BranchProduct.is_active.is_(True),
        )
    )
    if bp_result.scalar_one_or_none() is not None:
        return

    branch_product = BranchProduct(
        product_id=product.id,
        branch_id=branch_id,
        price_cents=prod_data["price_cents"],
        is_available=True,
    )
    db.add(branch_product)
    await db.flush()
    logger.info(
        "seed: linked product id=%s to branch id=%s price=%s",
        product.id,
        branch_id,
        prod_data["price_cents"],
    )
