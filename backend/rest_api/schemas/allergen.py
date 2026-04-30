"""
Pydantic schemas for allergen endpoints.

Design rules:
  - IDs are int (backend convention — frontend converts to string at boundary)
  - severity: mild / moderate / severe / life_threatening
  - presence_type: contains / may_contain / free_from
  - risk_level: mild / moderate / severe / life_threatening
  - Enum validation via field_validator (Literal types rejected in older Pydantic v2 with from_attributes)
  - `from_attributes = True` on all response schemas for ORM-to-Pydantic coercion

Schemas:
  Allergen:        AllergenCreate, AllergenUpdate, AllergenResponse
  ProductAllergen: ProductAllergenCreate, ProductAllergenResponse
  CrossReaction:   CrossReactionCreate, CrossReactionResponse
  Public:          PublicAllergenResponse, PublicProductAllergenResponse
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

# ── Allowed enum values ────────────────────────────────────────────────────────

_SEVERITY_VALUES = {"mild", "moderate", "severe", "life_threatening"}
_PRESENCE_TYPES = {"contains", "may_contain", "free_from"}
_RISK_LEVELS = {"mild", "moderate", "severe", "life_threatening"}


# ── Allergen ───────────────────────────────────────────────────────────────────


class AllergenCreate(BaseModel):
    """Request body for POST /api/admin/allergens."""

    name: str
    is_mandatory: bool = False
    severity: str = "moderate"
    icon: Optional[str] = None
    description: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Allergen name cannot be empty")
        return v.strip()

    @field_validator("severity")
    @classmethod
    def severity_valid(cls, v: str) -> str:
        if v not in _SEVERITY_VALUES:
            raise ValueError(
                f"severity must be one of: {', '.join(sorted(_SEVERITY_VALUES))}"
            )
        return v


class AllergenUpdate(BaseModel):
    """Request body for PUT /api/admin/allergens/{id}."""

    name: Optional[str] = None
    is_mandatory: Optional[bool] = None
    severity: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Allergen name cannot be empty")
        return v.strip() if v else v

    @field_validator("severity")
    @classmethod
    def severity_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _SEVERITY_VALUES:
            raise ValueError(
                f"severity must be one of: {', '.join(sorted(_SEVERITY_VALUES))}"
            )
        return v


class AllergenResponse(BaseModel):
    """Response schema for allergen CRUD operations."""

    id: int
    tenant_id: int
    name: str
    icon: Optional[str] = None
    description: Optional[str] = None
    is_mandatory: bool
    severity: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── ProductAllergen ────────────────────────────────────────────────────────────


class ProductAllergenCreate(BaseModel):
    """Request body for POST /api/admin/products/{product_id}/allergens."""

    allergen_id: int
    presence_type: str
    risk_level: str

    @field_validator("presence_type")
    @classmethod
    def presence_type_valid(cls, v: str) -> str:
        if v not in _PRESENCE_TYPES:
            raise ValueError(
                f"presence_type must be one of: {', '.join(sorted(_PRESENCE_TYPES))}"
            )
        return v

    @field_validator("risk_level")
    @classmethod
    def risk_level_valid(cls, v: str) -> str:
        if v not in _RISK_LEVELS:
            raise ValueError(
                f"risk_level must be one of: {', '.join(sorted(_RISK_LEVELS))}"
            )
        return v


class ProductAllergenResponse(BaseModel):
    """Response schema for a product-allergen link."""

    id: int
    product_id: int
    allergen_id: int
    allergen_name: str
    allergen_icon: Optional[str] = None
    presence_type: str
    risk_level: str

    model_config = {"from_attributes": True}


# ── CrossReaction ──────────────────────────────────────────────────────────────


class CrossReactionCreate(BaseModel):
    """Request body for POST /api/admin/allergens/{id}/cross-reactions."""

    related_allergen_id: int


class CrossReactionResponse(BaseModel):
    """Response schema for a cross-reaction record."""

    id: int
    allergen_id: int
    related_allergen_id: int
    related_allergen_name: str

    model_config = {"from_attributes": True}


# ── Public schemas ─────────────────────────────────────────────────────────────


class PublicAllergenResponse(BaseModel):
    """
    Allergen as seen in the public allergen listing endpoint.

    Includes counts of products per presence_type for the branch:
      contains_count: number of products that CONTAIN this allergen
      may_contain_count: number of products that MAY CONTAIN this allergen
      free_from_count: number of products that are FREE FROM this allergen
    """

    id: int
    name: str
    icon: Optional[str] = None
    description: Optional[str] = None
    is_mandatory: bool
    severity: str
    contains_count: int = 0
    may_contain_count: int = 0
    free_from_count: int = 0

    model_config = {"from_attributes": True}


class PublicProductAllergenResponse(BaseModel):
    """
    Allergen embedded in the public menu product response.

    Minimal info needed by the diner-facing PWA to display allergen badges.
    """

    id: int
    name: str
    icon: Optional[str] = None
    presence_type: str
    risk_level: str

    model_config = {"from_attributes": True}
