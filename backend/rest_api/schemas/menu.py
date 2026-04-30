"""
Pydantic schemas for menu catalog endpoints.

Design rules:
  - Prices are always integers (cents). 12550 = $125.50
  - Image URLs pass anti-SSRF validation via validate_image_url()
  - IDs are int (backend convention — frontend converts to string at boundary)
  - Schemas are pure data — no business logic here
  - `from_attributes = True` on all response schemas for ORM-to-Pydantic coercion

Schemas:
  Category:       CategoryCreate, CategoryUpdate, CategoryResponse
  Subcategory:    SubcategoryCreate, SubcategoryUpdate, SubcategoryResponse
  Product:        ProductCreate, ProductUpdate, ProductResponse
  BranchProduct:  BranchProductCreate, BranchProductUpdate, BranchProductResponse
  Public menu:    PublicProductResponse, PublicSubcategoryResponse,
                  PublicCategoryResponse, PublicMenuResponse
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from shared.utils.url_validation import validate_image_url


# ── Category ───────────────────────────────────────────────────────────────────


class CategoryCreate(BaseModel):
    """Request body for POST /api/admin/categories."""

    branch_id: int
    name: str
    icon: Optional[str] = None
    image: Optional[str] = None
    order: int = 0

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Category name cannot be empty")
        return v.strip()

    @field_validator("image")
    @classmethod
    def validate_image(cls, v: Optional[str]) -> Optional[str]:
        return validate_image_url(v)


class CategoryUpdate(BaseModel):
    """Request body for PUT /api/admin/categories/{id}."""

    name: Optional[str] = None
    icon: Optional[str] = None
    image: Optional[str] = None
    order: Optional[int] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Category name cannot be empty")
        return v.strip() if v else v

    @field_validator("image")
    @classmethod
    def validate_image(cls, v: Optional[str]) -> Optional[str]:
        return validate_image_url(v)


class CategoryResponse(BaseModel):
    """Response schema for category CRUD operations."""

    id: int
    branch_id: int
    name: str
    icon: Optional[str] = None
    image: Optional[str] = None
    order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Subcategory ────────────────────────────────────────────────────────────────


class SubcategoryCreate(BaseModel):
    """Request body for POST /api/admin/subcategories."""

    category_id: int
    name: str
    image: Optional[str] = None
    order: int = 0

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Subcategory name cannot be empty")
        return v.strip()

    @field_validator("image")
    @classmethod
    def validate_image(cls, v: Optional[str]) -> Optional[str]:
        return validate_image_url(v)


class SubcategoryUpdate(BaseModel):
    """Request body for PUT /api/admin/subcategories/{id}."""

    name: Optional[str] = None
    image: Optional[str] = None
    order: Optional[int] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Subcategory name cannot be empty")
        return v.strip() if v else v

    @field_validator("image")
    @classmethod
    def validate_image(cls, v: Optional[str]) -> Optional[str]:
        return validate_image_url(v)


class SubcategoryResponse(BaseModel):
    """Response schema for subcategory CRUD operations."""

    id: int
    category_id: int
    name: str
    image: Optional[str] = None
    order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Product ────────────────────────────────────────────────────────────────────


class ProductCreate(BaseModel):
    """Request body for POST /api/admin/products."""

    subcategory_id: int
    name: str
    description: Optional[str] = None
    price: int  # base price in cents — must be positive
    image: Optional[str] = None
    featured: bool = False
    popular: bool = False

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Product name cannot be empty")
        return v.strip()

    @field_validator("price")
    @classmethod
    def price_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Product price must be a positive integer (cents)")
        return v

    @field_validator("image")
    @classmethod
    def validate_image(cls, v: Optional[str]) -> Optional[str]:
        return validate_image_url(v)


class ProductUpdate(BaseModel):
    """Request body for PUT /api/admin/products/{id}."""

    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[int] = None
    image: Optional[str] = None
    featured: Optional[bool] = None
    popular: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Product name cannot be empty")
        return v.strip() if v else v

    @field_validator("price")
    @classmethod
    def price_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError("Product price must be a positive integer (cents)")
        return v

    @field_validator("image")
    @classmethod
    def validate_image(cls, v: Optional[str]) -> Optional[str]:
        return validate_image_url(v)


class ProductResponse(BaseModel):
    """Response schema for product CRUD operations."""

    id: int
    subcategory_id: int
    name: str
    description: Optional[str] = None
    price: int
    image: Optional[str] = None
    featured: bool
    popular: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── BranchProduct ──────────────────────────────────────────────────────────────


class BranchProductCreate(BaseModel):
    """Request body for POST /api/admin/branch-products."""

    product_id: int
    branch_id: int
    price_cents: int  # branch-specific price in cents — must be positive
    is_available: bool = True

    @field_validator("price_cents")
    @classmethod
    def price_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("price_cents must be a positive integer (cents)")
        return v


class BranchProductUpdate(BaseModel):
    """Request body for PUT /api/admin/branch-products/{id}."""

    price_cents: Optional[int] = None
    is_available: Optional[bool] = None

    @field_validator("price_cents")
    @classmethod
    def price_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError("price_cents must be a positive integer (cents)")
        return v


class BranchProductResponse(BaseModel):
    """Response schema for branch-product CRUD operations."""

    id: int
    product_id: int
    branch_id: int
    price_cents: int
    is_available: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Public menu response ───────────────────────────────────────────────────────


class PublicProductResponse(BaseModel):
    """
    Product as seen in the public menu.

    Includes branch-specific price (price_cents from BranchProduct) and
    the current availability flag. Only products with is_available=True
    are included in the public menu response.

    allergens: list of allergens linked to this product (presence_type + risk_level).
    """

    id: int
    name: str
    description: Optional[str] = None
    price_cents: int  # branch-specific price from BranchProduct
    is_available: bool = True
    image: Optional[str] = None
    featured: bool
    popular: bool
    allergens: list["PublicProductAllergenItem"] = []

    model_config = {"from_attributes": True}


class PublicProductAllergenItem(BaseModel):
    """Minimal allergen info embedded in the public product response."""

    id: int
    name: str
    icon: Optional[str] = None
    presence_type: str
    risk_level: str

    model_config = {"from_attributes": True}


class PublicSubcategoryResponse(BaseModel):
    """Subcategory as seen in the public menu (nested under category)."""

    id: int
    name: str
    image: Optional[str] = None
    order: int
    products: list[PublicProductResponse] = []

    model_config = {"from_attributes": True}


class PublicCategoryResponse(BaseModel):
    """Category as seen in the public menu (nested, contains subcategories)."""

    id: int
    name: str
    icon: Optional[str] = None
    image: Optional[str] = None
    order: int
    subcategories: list[PublicSubcategoryResponse] = []

    model_config = {"from_attributes": True}


class PublicBranchInfo(BaseModel):
    """Branch information included in the public menu response."""

    id: int
    name: str
    slug: str
    address: str

    model_config = {"from_attributes": True}


class PublicMenuResponse(BaseModel):
    """
    Full public menu response for GET /api/public/menu/{slug}.

    Nested structure:
      branch → categories → subcategories → products (with branch pricing)

    All items are active and available. Products without a BranchProduct
    record for this branch, or with is_available=False, are excluded.
    """

    branch: PublicBranchInfo
    categories: list[PublicCategoryResponse] = []

    model_config = {"from_attributes": True}
