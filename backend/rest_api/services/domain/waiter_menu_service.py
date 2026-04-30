"""
WaiterMenuService — compact menu builder for the quick-command flow (C-11).

Design (from design.md §D-07):
  - No images, no allergens, no descriptions, no branch metadata
  - Product carries only id, name, price_cents, is_available
  - Nested: categories → subcategories → products
  - No cache in v1 — waiters hit this less often than diners hit the public menu

Clean Architecture rules:
  - Stateless — no DB session stored on the class (new instance per call is fine)
  - Router calls `build_menu()` via instantiation — no business logic in routers
  - Validates tenant + branch scope before querying
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.utils.exceptions import ForbiddenError, NotFoundError
from rest_api.models.branch import Branch
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.schemas.waiter_menu import (
    WaiterMenuCategory,
    WaiterMenuProduct,
    WaiterMenuResponse,
    WaiterMenuSubcategory,
)

logger = get_logger(__name__)


class WaiterMenuService:
    """
    Build the compact waiter menu for a branch.

    Filters:
      - Category.is_active = True AND branch_id matches
      - Subcategory.is_active = True
      - Product.is_active = True
      - BranchProduct.is_active = True AND is_available = True (for the target branch)

    Ordering:
      - Categories by order ASC (ties broken by id ASC)
      - Subcategories by order ASC (ties broken by id ASC)
      - Products by name ASC (Product has no `order` column)
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def build_menu(
        self,
        *,
        branch_id: int,
        tenant_id: int,
        branch_ids: list[int] | None = None,
    ) -> WaiterMenuResponse:
        """
        Return the full compact menu for a branch.

        Raises:
          NotFoundError: branch not found in tenant or inactive.
          ForbiddenError: branch_ids is non-None and branch_id is not in it.
        """
        # Step 1: validate branch exists in tenant + is accessible
        branch = await self._db.scalar(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if branch is None:
            raise NotFoundError("Branch", branch_id)
        if branch_ids is not None and branch.id not in branch_ids:
            raise ForbiddenError(f"No tenés acceso a la sucursal {branch_id}")

        # Step 2: fetch categories with nested sub→products→branch_products.
        #  We eager-load the full chain in one round-trip, then post-filter in
        #  Python. This matches the pattern used in public_menu.py.
        stmt = (
            select(Category)
            .where(
                Category.branch_id == branch_id,
                Category.is_active.is_(True),
            )
            .order_by(Category.order.asc(), Category.id.asc())
            .options(
                selectinload(Category.subcategories)
                .selectinload(Subcategory.products)
                .selectinload(Product.branch_products),
            )
        )
        categories = list(
            (await self._db.execute(stmt)).scalars().unique().all()
        )

        # Step 3: filter + build the compact response.
        out_categories: list[WaiterMenuCategory] = []
        for cat in categories:
            if not cat.is_active:
                continue

            out_subcats: list[WaiterMenuSubcategory] = []
            for subcat in sorted(
                (s for s in cat.subcategories if s.is_active),
                key=lambda s: (s.order, s.id),
            ):
                out_products: list[WaiterMenuProduct] = []
                for product in sorted(
                    (p for p in subcat.products if p.is_active),
                    key=lambda p: (p.name, p.id),
                ):
                    # Find the BranchProduct for this branch
                    bp = next(
                        (
                            bp
                            for bp in product.branch_products
                            if bp.branch_id == branch_id
                            and bp.is_active
                            and bp.is_available
                        ),
                        None,
                    )
                    if bp is None:
                        continue
                    out_products.append(
                        WaiterMenuProduct(
                            id=product.id,
                            name=product.name,
                            price_cents=int(bp.price_cents),
                            is_available=True,
                        )
                    )

                if not out_products:
                    # Empty subcategory — skip to keep the payload tight.
                    # (Spec allows it either way; matches the public menu behaviour
                    #  of omitting subcategories with no visible products.)
                    continue

                out_subcats.append(
                    WaiterMenuSubcategory(
                        id=subcat.id,
                        name=subcat.name,
                        order=subcat.order,
                        products=out_products,
                    )
                )

            if not out_subcats:
                continue

            out_categories.append(
                WaiterMenuCategory(
                    id=cat.id,
                    name=cat.name,
                    order=cat.order,
                    subcategories=out_subcats,
                )
            )

        return WaiterMenuResponse(categories=out_categories)
