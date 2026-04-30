"""
Pydantic schemas for promotion endpoints.

Design rules:
  - Prices in cents (int, ge=0) — NEVER float
  - from_attributes = True on all response schemas for ORM coercion
  - Temporal validation: start_date+start_time MUST be <= end_date+end_time

Schemas:
  PromotionBranchOut  — embedded branch info in PromotionOut
  PromotionItemOut    — embedded item info in PromotionOut
  PromotionCreate     — body for POST /api/admin/promotions
  PromotionUpdate     — body for PATCH /api/admin/promotions/{id} (metadata only)
  PromotionOut        — full response with nested branches + items
"""
from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator


class PromotionBranchOut(BaseModel):
    """Branch info embedded in promotion response."""

    branch_id: int
    branch_name: str

    model_config = {"from_attributes": True}


class PromotionItemOut(BaseModel):
    """Product info embedded in promotion response."""

    product_id: int
    product_name: str

    model_config = {"from_attributes": True}


class PromotionCreate(BaseModel):
    """Request body for POST /api/admin/promotions."""

    name: str
    description: Optional[str] = None
    price: int  # cents, ge=0 validated below
    start_date: date
    start_time: time
    end_date: date
    end_time: time
    promotion_type_id: Optional[int] = None
    branch_ids: list[int] = []
    product_ids: list[int] = []

    @field_validator("price")
    @classmethod
    def price_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("price must be non-negative (in cents)")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip()

    @model_validator(mode="after")
    def start_before_end(self) -> "PromotionCreate":
        """Validate that start datetime is before or equal to end datetime."""
        from datetime import datetime as dt
        start = dt.combine(self.start_date, self.start_time)
        end = dt.combine(self.end_date, self.end_time)
        if start > end:
            raise ValueError(
                "start_date+start_time must be less than or equal to end_date+end_time"
            )
        return self


class PromotionUpdate(BaseModel):
    """
    Request body for PATCH /api/admin/promotions/{id}.

    Metadata only — branch/product lists are managed via separate endpoints
    (POST /{id}/branches, DELETE /{id}/branches/{branch_id}, etc.).
    """

    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[int] = None
    start_date: Optional[date] = None
    start_time: Optional[time] = None
    end_date: Optional[date] = None
    end_time: Optional[time] = None
    promotion_type_id: Optional[int] = None

    @field_validator("price")
    @classmethod
    def price_non_negative(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("price must be non-negative (in cents)")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip() if v else v


class PromotionOut(BaseModel):
    """Full promotion response including nested branches and items."""

    id: int
    tenant_id: int
    name: str
    description: Optional[str] = None
    price: int
    start_date: date
    start_time: time
    end_date: date
    end_time: time
    promotion_type_id: Optional[int] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    branches: list[PromotionBranchOut] = []
    items: list[PromotionItemOut] = []

    model_config = {"from_attributes": True}
