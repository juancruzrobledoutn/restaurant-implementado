"""
Pydantic schemas for the compact waiter menu endpoint (C-11).

Design (from design.md §D-07):
  - No images, no allergens, no descriptions, no branch metadata
  - Product carries only id, name, price_cents, is_available
  - Nested: categories → subcategories → products
  - Smaller payload than the public menu — intended for fast list rendering
    on older tablets / quick-command flow
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class WaiterMenuProduct(BaseModel):
    """Minimum product data needed for a quick-command list entry."""

    id: int
    name: str
    price_cents: int
    is_available: bool


class WaiterMenuSubcategory(BaseModel):
    """Subcategory with its compact product list."""

    id: int
    name: str
    order: int
    products: list[WaiterMenuProduct] = Field(default_factory=list)


class WaiterMenuCategory(BaseModel):
    """Category with its subcategories."""

    id: int
    name: str
    order: int
    subcategories: list[WaiterMenuSubcategory] = Field(default_factory=list)


class WaiterMenuResponse(BaseModel):
    """Top-level response shape for GET /api/waiter/branches/{id}/menu."""

    categories: list[WaiterMenuCategory] = Field(default_factory=list)
