"""
Pydantic schemas for tenant-scoped catalog lookup tables.

Generic schemas reusable across all four catalog types:
  - CookingMethod
  - FlavorProfile
  - TextureProfile
  - CuisineType

All four share identical structure, so one set of schemas covers all.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class CatalogItemCreate(BaseModel):
    """Request body for creating a catalog item (any catalog type)."""
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip()


class CatalogItemUpdate(BaseModel):
    """Request body for updating a catalog item (all fields optional)."""
    name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip() if v else v


class CatalogItemOut(BaseModel):
    """Catalog item representation in API responses."""
    id: int
    tenant_id: int
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
