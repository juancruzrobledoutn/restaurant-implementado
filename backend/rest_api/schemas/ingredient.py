"""
Pydantic schemas for the ingredient hierarchy endpoints.

Hierarchy: IngredientGroup → Ingredient → SubIngredient

Rules:
  - IDs are int at the API boundary
  - Nested output schemas: IngredientGroupOut includes list[IngredientOut],
    IngredientOut includes list[SubIngredientOut]
  - Update schemas use Optional fields to support partial updates
  - All output schemas use from_attributes=True (ORM mode)
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


# ── SubIngredient schemas ──────────────────────────────────────────────────────

class SubIngredientCreate(BaseModel):
    """Request body for creating a sub-ingredient."""
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip()


class SubIngredientUpdate(BaseModel):
    """Request body for updating a sub-ingredient (all fields optional)."""
    name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip() if v else v


class SubIngredientOut(BaseModel):
    """Sub-ingredient representation in API responses."""
    id: int
    ingredient_id: int
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Ingredient schemas ─────────────────────────────────────────────────────────

class IngredientCreate(BaseModel):
    """Request body for creating an ingredient within a group."""
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip()


class IngredientUpdate(BaseModel):
    """Request body for updating an ingredient (all fields optional)."""
    name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip() if v else v


class IngredientOut(BaseModel):
    """Ingredient representation — includes nested sub-ingredients."""
    id: int
    group_id: int
    tenant_id: int
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    sub_ingredients: list[SubIngredientOut] = []

    model_config = {"from_attributes": True}


# ── IngredientGroup schemas ────────────────────────────────────────────────────

class IngredientGroupCreate(BaseModel):
    """Request body for creating an ingredient group."""
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip()


class IngredientGroupUpdate(BaseModel):
    """Request body for updating an ingredient group (all fields optional)."""
    name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip() if v else v


class IngredientGroupOut(BaseModel):
    """Ingredient group representation — includes nested ingredients."""
    id: int
    tenant_id: int
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    ingredients: list[IngredientOut] = []

    model_config = {"from_attributes": True}


class IngredientGroupListOut(BaseModel):
    """Ingredient group list item — lighter, with ingredient count only."""
    id: int
    tenant_id: int
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    ingredient_count: int = 0

    model_config = {"from_attributes": True}
