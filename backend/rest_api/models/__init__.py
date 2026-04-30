"""
Model registry — import all models here so Alembic autodiscovery works.

This file MUST import every model class that should appear in migrations.
Alembic's env.py imports Base from this module, which triggers all model
registrations with SQLAlchemy's metadata.

IMPORTANT: The order of imports matters for FK resolution — import parent
tables before child tables.
"""
from shared.infrastructure.db import Base  # noqa: F401 — re-export for Alembic

# Import all models to register them with Base.metadata
from rest_api.models.tenant import Tenant  # noqa: F401
from rest_api.models.branch import Branch  # noqa: F401
from rest_api.models.user import User, UserBranchRole  # noqa: F401
from rest_api.models.menu import (  # noqa: F401 — C-04 menu catalog
    Category,
    Subcategory,
    Product,
    BranchProduct,
)

# C-06: ingredient hierarchy, recipes, and tenant-scoped catalog lookups
from rest_api.models.ingredient import IngredientGroup, Ingredient, SubIngredient  # noqa: F401
from rest_api.models.recipe import Recipe, RecipeIngredient  # noqa: F401
from rest_api.models.catalog import (  # noqa: F401
    CookingMethod,
    FlavorProfile,
    TextureProfile,
    CuisineType,
)

# C-05: allergen catalog and product-allergen linking
from rest_api.models.allergen import (  # noqa: F401
    Allergen,
    ProductAllergen,
    AllergenCrossReaction,
)

# C-07: branch sectors, tables, and waiter assignments
from rest_api.models.sector import BranchSector, Table, WaiterSectorAssignment  # noqa: F401

# C-08: table sessions, diners, cart items
from rest_api.models.table_session import TableSession, Diner, CartItem  # noqa: F401

# C-13: staff management — outbox, promotions, push subscriptions
from rest_api.models.outbox import OutboxEvent  # noqa: F401
from rest_api.models.promotion import Promotion, PromotionBranch, PromotionItem  # noqa: F401
from rest_api.models.push_subscription import PushSubscription  # noqa: F401

# C-10: rounds — Round and RoundItem with 7-state machine and void support
from rest_api.models.round import Round, RoundItem  # noqa: F401

# C-11: kitchen tickets and service calls
from rest_api.models.kitchen_ticket import (  # noqa: F401
    KitchenTicket,
    KitchenTicketItem,
)
from rest_api.models.service_call import ServiceCall  # noqa: F401

# C-12: billing — Check (app_check), Charge, Payment, Allocation + FIFO allocation
from rest_api.models.billing import (  # noqa: F401
    Check,
    Charge,
    Payment,
    Allocation,
)

# C-19: customer loyalty — device tracking, opt-in GDPR, visit history
from rest_api.models.customer import Customer  # noqa: F401

__all__ = [
    "Base",
    # C-01 / C-02
    "Tenant",
    "Branch",
    "User",
    "UserBranchRole",
    # C-04
    "Category",
    "Subcategory",
    "Product",
    "BranchProduct",
    # C-06
    "IngredientGroup",
    "Ingredient",
    "SubIngredient",
    "Recipe",
    "RecipeIngredient",
    "CookingMethod",
    "FlavorProfile",
    "TextureProfile",
    "CuisineType",
    # C-05
    "Allergen",
    "ProductAllergen",
    "AllergenCrossReaction",
    # C-07
    "BranchSector",
    "Table",
    "WaiterSectorAssignment",
    # C-08
    "TableSession",
    "Diner",
    "CartItem",
    # C-13
    "OutboxEvent",
    "Promotion",
    "PromotionBranch",
    "PromotionItem",
    "PushSubscription",
    # C-10 rounds
    "Round",
    "RoundItem",
    # C-11 kitchen
    "KitchenTicket",
    "KitchenTicketItem",
    "ServiceCall",
    # C-12 billing
    "Check",
    "Charge",
    "Payment",
    "Allocation",
    # C-19 customer loyalty
    "Customer",
]
