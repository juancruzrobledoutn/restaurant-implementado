"""
Pydantic schemas for OutboxEvent — used in tests and optional admin debug endpoints.

Schemas:
  OutboxEventOut — read-only response schema for outbox events
"""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class OutboxEventOut(BaseModel):
    """
    Response schema for OutboxEvent.

    Used in tests to verify event creation and in optional admin debug endpoints.
    Never exposed in production without admin authentication.
    """

    id: int
    event_type: str
    payload: dict[str, Any]
    created_at: datetime
    processed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
