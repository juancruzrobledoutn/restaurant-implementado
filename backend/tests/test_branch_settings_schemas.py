"""
Unit tests for branch_settings schemas (C-28).

Covers:
  - OpeningHoursInterval: valid formats, open >= close raises, 24:00 in close ok
  - OpeningHoursWeek: overlapping intervals raise, non-overlapping pass
  - BranchSettingsUpdate: slug validation (regex, length), timezone validation, name blank
"""
import pytest
from pydantic import ValidationError

from rest_api.schemas.branch_settings import (
    BranchSettingsUpdate,
    OpeningHoursInterval,
    OpeningHoursWeek,
)


# ---------------------------------------------------------------------------
# OpeningHoursInterval
# ---------------------------------------------------------------------------

class TestOpeningHoursInterval:
    def test_valid_interval(self):
        i = OpeningHoursInterval(open="09:00", close="23:00")
        assert i.open == "09:00"
        assert i.close == "23:00"

    def test_close_24_00_is_valid(self):
        i = OpeningHoursInterval(open="00:00", close="24:00")
        assert i.close == "24:00"

    def test_open_ge_close_raises(self):
        with pytest.raises(ValidationError):
            OpeningHoursInterval(open="23:00", close="09:00")

    def test_open_equals_close_raises(self):
        with pytest.raises(ValidationError):
            OpeningHoursInterval(open="09:00", close="09:00")

    def test_open_24_00_raises(self):
        with pytest.raises(ValidationError):
            OpeningHoursInterval(open="24:00", close="24:00")

    def test_invalid_format_raises(self):
        with pytest.raises(ValidationError):
            OpeningHoursInterval(open="9:00", close="23:00")

    def test_invalid_minutes_raises(self):
        with pytest.raises(ValidationError):
            OpeningHoursInterval(open="09:60", close="23:00")


# ---------------------------------------------------------------------------
# OpeningHoursWeek
# ---------------------------------------------------------------------------

class TestOpeningHoursWeek:
    def test_valid_week(self):
        week = OpeningHoursWeek(
            mon=[{"open": "09:00", "close": "23:00"}],
            tue=[],
            wed=[{"open": "09:00", "close": "14:00"}, {"open": "20:00", "close": "23:00"}],
        )
        assert len(week.mon) == 1
        assert len(week.tue) == 0
        assert len(week.wed) == 2

    def test_24h_notation_valid(self):
        week = OpeningHoursWeek(thu=[{"open": "00:00", "close": "24:00"}])
        assert week.thu[0].close == "24:00"

    def test_overlapping_intervals_raises(self):
        with pytest.raises(ValidationError):
            OpeningHoursWeek(
                mon=[
                    {"open": "09:00", "close": "15:00"},
                    {"open": "14:00", "close": "23:00"},  # overlaps with first
                ]
            )

    def test_non_overlapping_split_schedule_valid(self):
        week = OpeningHoursWeek(
            fri=[
                {"open": "09:00", "close": "13:00"},
                {"open": "20:00", "close": "23:30"},
            ]
        )
        assert len(week.fri) == 2

    def test_empty_week_is_valid(self):
        week = OpeningHoursWeek()
        assert week.mon == []
        assert week.sun == []


# ---------------------------------------------------------------------------
# BranchSettingsUpdate — slug validation
# ---------------------------------------------------------------------------

class TestBranchSettingsUpdateSlug:
    def test_valid_slug(self):
        s = BranchSettingsUpdate(slug="mi-sucursal-01")
        assert s.slug == "mi-sucursal-01"

    def test_slug_too_short(self):
        with pytest.raises(ValidationError):
            BranchSettingsUpdate(slug="ab")  # < 3 chars

    def test_slug_too_long(self):
        with pytest.raises(ValidationError):
            BranchSettingsUpdate(slug="a" * 61)  # > 60 chars

    def test_slug_uppercase_raises(self):
        with pytest.raises(ValidationError):
            BranchSettingsUpdate(slug="Mi-Sucursal")

    def test_slug_with_spaces_raises(self):
        with pytest.raises(ValidationError):
            BranchSettingsUpdate(slug="mi sucursal")

    def test_slug_with_underscore_raises(self):
        with pytest.raises(ValidationError):
            BranchSettingsUpdate(slug="mi_sucursal")

    def test_slug_none_is_valid(self):
        s = BranchSettingsUpdate(slug=None)
        assert s.slug is None

    def test_slug_exact_3_chars(self):
        s = BranchSettingsUpdate(slug="abc")
        assert s.slug == "abc"

    def test_slug_exact_60_chars(self):
        s = BranchSettingsUpdate(slug="a" * 60)
        assert s.slug == "a" * 60


# ---------------------------------------------------------------------------
# BranchSettingsUpdate — timezone validation
# ---------------------------------------------------------------------------

class TestBranchSettingsUpdateTimezone:
    def test_valid_iana_timezone(self):
        s = BranchSettingsUpdate(timezone="America/Argentina/Buenos_Aires")
        assert s.timezone == "America/Argentina/Buenos_Aires"

    def test_valid_utc(self):
        s = BranchSettingsUpdate(timezone="UTC")
        assert s.timezone == "UTC"

    def test_invalid_timezone_raises(self):
        with pytest.raises(ValidationError):
            BranchSettingsUpdate(timezone="Not/A/Timezone")

    def test_timezone_none_is_valid(self):
        s = BranchSettingsUpdate(timezone=None)
        assert s.timezone is None


# ---------------------------------------------------------------------------
# BranchSettingsUpdate — name validation
# ---------------------------------------------------------------------------

class TestBranchSettingsUpdateName:
    def test_valid_name(self):
        s = BranchSettingsUpdate(name="La Sucursal Centro")
        assert s.name == "La Sucursal Centro"

    def test_blank_name_raises(self):
        with pytest.raises(ValidationError):
            BranchSettingsUpdate(name="   ")

    def test_name_none_is_valid(self):
        s = BranchSettingsUpdate(name=None)
        assert s.name is None


# ---------------------------------------------------------------------------
# BranchSettingsUpdate — all none is valid (partial patch)
# ---------------------------------------------------------------------------

class TestBranchSettingsUpdateEmpty:
    def test_empty_patch_is_valid(self):
        s = BranchSettingsUpdate()
        assert s.name is None
        assert s.slug is None
        assert s.timezone is None
        assert s.phone is None
        assert s.opening_hours is None
