"""
Branch settings schemas (C-28).

Validation rules:
  - slug: ^[a-z0-9-]+$ length 3-60
  - timezone: validated against zoneinfo.ZoneInfo (IANA timezone)
  - opening_hours: JSONB shape {mon..sun: [{open, close}]}
    - intervals non-overlapping
    - open < close
    - HH:MM 24h format
  - privacy_salt NEVER appears in any response schema

Design decisions (from design.md):
  - opening_hours [] = closed, [{"open":"00:00","close":"24:00"}] = 24h
  - timezone is stored as an IANA timezone string (e.g. 'America/Argentina/Buenos_Aires')
"""
from __future__ import annotations

import re
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, field_validator, model_validator

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SLUG_RE = re.compile(r"^[a-z0-9-]+$")
_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$|^24:00$")
_DAY_KEYS = frozenset({"mon", "tue", "wed", "thu", "fri", "sat", "sun"})


def _parse_minutes(hhmm: str) -> int:
    """Convert HH:MM (or 24:00) to minutes since midnight."""
    if hhmm == "24:00":
        return 1440
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


# ---------------------------------------------------------------------------
# Opening hours sub-schemas
# ---------------------------------------------------------------------------


class OpeningHoursInterval(BaseModel):
    """A single time interval within a day."""

    open: str  # HH:MM
    close: str  # HH:MM or 24:00

    @field_validator("open")
    @classmethod
    def validate_open_format(cls, v: str) -> str:
        if not _HHMM_RE.match(v):
            raise ValueError(f"open must be HH:MM format (00:00–23:59), got {v!r}")
        if v == "24:00":
            raise ValueError("open cannot be 24:00 — use 00:00 for midnight open")
        return v

    @field_validator("close")
    @classmethod
    def validate_close_format(cls, v: str) -> str:
        if not _HHMM_RE.match(v):
            raise ValueError(f"close must be HH:MM or 24:00, got {v!r}")
        return v

    @model_validator(mode="after")
    def validate_open_before_close(self) -> "OpeningHoursInterval":
        open_min = _parse_minutes(self.open)
        close_min = _parse_minutes(self.close)
        if open_min >= close_min:
            raise ValueError(
                f"open ({self.open}) must be strictly before close ({self.close})"
            )
        return self


class OpeningHoursWeek(BaseModel):
    """
    Weekly opening hours.

    Shape: {mon..sun: [{open, close}, ...]}
    - Empty list = closed that day.
    - [{open: '00:00', close: '24:00'}] = 24h.
    - Multiple intervals per day = split schedule (e.g. lunch + dinner).
    """

    mon: list[OpeningHoursInterval] = []
    tue: list[OpeningHoursInterval] = []
    wed: list[OpeningHoursInterval] = []
    thu: list[OpeningHoursInterval] = []
    fri: list[OpeningHoursInterval] = []
    sat: list[OpeningHoursInterval] = []
    sun: list[OpeningHoursInterval] = []

    @model_validator(mode="after")
    def validate_no_overlaps(self) -> "OpeningHoursWeek":
        for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
            intervals: list[OpeningHoursInterval] = getattr(self, day)
            if len(intervals) < 2:
                continue
            sorted_intervals = sorted(intervals, key=lambda i: _parse_minutes(i.open))
            for i in range(len(sorted_intervals) - 1):
                curr = sorted_intervals[i]
                nxt = sorted_intervals[i + 1]
                if _parse_minutes(curr.close) > _parse_minutes(nxt.open):
                    raise ValueError(
                        f"{day}: intervals overlap: "
                        f"{curr.open}–{curr.close} and {nxt.open}–{nxt.close}"
                    )
        return self


# ---------------------------------------------------------------------------
# Branch settings request/response schemas
# ---------------------------------------------------------------------------


class BranchSettingsUpdate(BaseModel):
    """
    PATCH body for branch settings.
    All fields are optional — only provided fields are updated.
    """

    name: Optional[str] = None
    address: Optional[str] = None
    slug: Optional[str] = None
    phone: Optional[str] = None
    timezone: Optional[str] = None
    opening_hours: Optional[OpeningHoursWeek] = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not (3 <= len(v) <= 60):
            raise ValueError("slug must be between 3 and 60 characters")
        if not _SLUG_RE.match(v):
            raise ValueError(
                "slug may only contain lowercase letters, digits, and hyphens"
            )
        return v

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, KeyError):
            raise ValueError(f"Invalid IANA timezone: {v!r}")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name cannot be blank")
        return v

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 50:
            raise ValueError("phone cannot exceed 50 characters")
        return v


class BranchSettingsResponse(BaseModel):
    """
    Branch settings response.
    NOTE: privacy_salt is NEVER included — it lives on Tenant, not Branch.
    """

    id: int
    tenant_id: int
    name: str
    address: str
    slug: str
    phone: Optional[str] = None
    timezone: str
    opening_hours: Optional[dict] = None

    model_config = {"from_attributes": True}
