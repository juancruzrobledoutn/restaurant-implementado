"""
Pydantic schemas for sales reporting endpoints (C-16).

Schemas:
  Output:
    - DailyKPIsOutput: daily revenue KPIs for a branch
    - TopProductOutput: a top-selling product by revenue
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class DailyKPIsOutput(BaseModel):
    """Daily KPIs aggregated for a branch on a given date."""

    model_config = ConfigDict(from_attributes=True)

    revenue_cents: int
    orders: int
    average_ticket_cents: int
    diners: int


class TopProductOutput(BaseModel):
    """A top-selling product ordered by revenue descending."""

    model_config = ConfigDict(from_attributes=True)

    product_id: int
    product_name: str
    quantity_sold: int
    revenue_cents: int
