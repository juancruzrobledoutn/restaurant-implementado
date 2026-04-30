"""
Pydantic schemas for recipe endpoints.

Design:
  - RecipeCreate includes a list of ingredients with ingredient_id, quantity, unit
  - RecipeOut includes nested ingredient details (name and group name)
  - RecipeIngredientOut shows ingredient name and group for recipe detail views
  - quantity is Decimal (not float) for precise representation

Rules:
  - IDs are int at the API boundary
  - All output schemas use from_attributes=True (ORM mode)
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_validator


# ── RecipeIngredient schemas ───────────────────────────────────────────────────

class RecipeIngredientIn(BaseModel):
    """An ingredient line item in a recipe request (create or update)."""
    ingredient_id: int
    quantity: Decimal
    unit: str

    @field_validator("quantity")
    @classmethod
    def quantity_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("quantity must be positive")
        return v

    @field_validator("unit")
    @classmethod
    def unit_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("unit cannot be empty")
        return v.strip()


class RecipeIngredientOut(BaseModel):
    """An ingredient line in a recipe response — includes ingredient name and group."""
    id: int
    ingredient_id: int
    ingredient_name: str = ""
    ingredient_group_name: str = ""
    quantity: Decimal
    unit: str
    is_active: bool = True  # reflects whether the ingredient itself is active

    model_config = {"from_attributes": True}


# ── Recipe schemas ─────────────────────────────────────────────────────────────

class RecipeCreate(BaseModel):
    """Request body for creating a recipe with its ingredient list."""
    name: str
    description: Optional[str] = None
    ingredients: list[RecipeIngredientIn] = []

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip()


class RecipeUpdate(BaseModel):
    """
    Request body for updating a recipe (all fields optional).

    If `ingredients` is provided, the entire ingredient list is replaced atomically.
    If `ingredients` is omitted (None), the existing ingredient list is unchanged.
    """
    name: Optional[str] = None
    description: Optional[str] = None
    ingredients: Optional[list[RecipeIngredientIn]] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip() if v else v


class RecipeOut(BaseModel):
    """Full recipe representation including nested ingredient details."""
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    ingredients: list[RecipeIngredientOut] = []

    model_config = {"from_attributes": True}
