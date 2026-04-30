"""
Domain services — business logic layer for all CRUD operations.

Architecture: Router (thin) → Domain Service → Repository/DB → Model

Services:
  - CategoryService: menu category CRUD (branch-scoped, cache-invalidating)
  - SubcategoryService: subcategory CRUD (category-scoped, cache-invalidating)
  - ProductService: product CRUD + BranchProduct management
  - MenuCacheService: Redis cache get/set/invalidate for public menu
  - IngredientService: ingredient hierarchy CRUD (C-06)
  - RecipeService: recipe CRUD with atomic ingredient-list replacement (C-06)
  - CatalogService: generic catalog CRUD for cooking/flavor/texture/cuisine (C-06)
  - AllergenService: allergen catalog, product-allergen linking, cross-reactions (C-05)
  - SectorService: branch sector CRUD + waiter assignment management (C-07)
  - TableService: table CRUD with code uniqueness per branch (C-07)
  - BillingService: check request, FIFO allocation, MP integration (C-12)
"""
from rest_api.services.domain.menu_cache_service import MenuCacheService
from rest_api.services.domain.category_service import CategoryService
from rest_api.services.domain.subcategory_service import SubcategoryService
from rest_api.services.domain.product_service import ProductService
from rest_api.services.domain.ingredient_service import IngredientService
from rest_api.services.domain.recipe_service import RecipeService
from rest_api.services.domain.catalog_service import CatalogService
from rest_api.services.domain.allergen_service import AllergenService
from rest_api.services.domain.sector_service import SectorService
from rest_api.services.domain.table_service import TableService
from rest_api.services.domain.table_session_service import TableSessionService
from rest_api.services.domain.diner_service import DinerService

# C-13: staff management, waiter assignments, promotions, push notifications, outbox
from rest_api.services.domain.outbox_service import OutboxService
from rest_api.services.domain.staff_service import StaffService
from rest_api.services.domain.waiter_assignment_service import WaiterAssignmentService
from rest_api.services.domain.promotion_service import PromotionService
from rest_api.services.domain.push_notification_service import PushNotificationService

# C-10: rounds — state machine, stock validation, void-item, kitchen filter
from rest_api.services.domain.round_service import RoundService

# C-11: kitchen tickets, service calls, waiter compact menu
from rest_api.services.domain.ticket_service import TicketService
from rest_api.services.domain.service_call_service import ServiceCallService
from rest_api.services.domain.waiter_menu_service import WaiterMenuService

# C-12: billing — check lifecycle, FIFO allocation, MP gateway
from rest_api.services.domain.billing_service import BillingService

# C-19: customer loyalty — device tracking, opt-in GDPR, visit history
from rest_api.services.domain.customer_service import CustomerService

# C-16: sales reporting + receipt printing
from rest_api.services.domain.sales_service import SalesService
from rest_api.services.domain.receipt_service import ReceiptService

# C-28: dashboard settings — branch + tenant
from rest_api.services.domain.branch_settings_service import BranchSettingsService
from rest_api.services.domain.tenant_settings_service import TenantSettingsService

__all__ = [
    "MenuCacheService",
    "CategoryService",
    "SubcategoryService",
    "ProductService",
    # C-06
    "IngredientService",
    "RecipeService",
    "CatalogService",
    # C-05
    "AllergenService",
    # C-07
    "SectorService",
    "TableService",
    # C-08
    "TableSessionService",
    "DinerService",
    # C-13
    "OutboxService",
    "StaffService",
    "WaiterAssignmentService",
    "PromotionService",
    "PushNotificationService",
    # C-10 rounds
    "RoundService",
    # C-11 kitchen
    "TicketService",
    "ServiceCallService",
    "WaiterMenuService",
    # C-12 billing
    "BillingService",
    # C-19 customer loyalty
    "CustomerService",
    # C-16 sales + receipt
    "SalesService",
    "ReceiptService",
    # C-28 dashboard settings
    "BranchSettingsService",
    "TenantSettingsService",
]
