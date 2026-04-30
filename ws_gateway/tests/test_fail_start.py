"""
Tests for fail-start validation in ws_gateway/main.py.

Covered scenarios:
  - ENVIRONMENT=production + WS_ALLOWED_ORIGINS="" → _validate_startup_config raises SystemExit
  - NullAuthStrategy is usable in test/development (no production block in strategy itself)
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest


def test_production_with_empty_allowed_origins_raises_system_exit():
    """
    _validate_startup_config() must call sys.exit(1) if:
      ENVIRONMENT=production AND WS_ALLOWED_ORIGINS is empty.
    """
    from ws_gateway.main import _validate_startup_config

    mock_settings = MagicMock()
    mock_settings.ENVIRONMENT = "production"
    mock_settings.WS_ALLOWED_ORIGINS = ""  # Empty → must fail
    mock_settings.JWT_SECRET = "a" * 32
    mock_settings.TABLE_TOKEN_SECRET = "b" * 32
    mock_settings.ALLOWED_ORIGINS = "https://example.com"
    mock_settings.COOKIE_SECURE = True
    mock_settings.DEBUG = False

    with patch("ws_gateway.main.sys.exit") as mock_exit, \
         patch("shared.config.settings.settings", mock_settings), \
         patch("shared.config.settings.validate_production_secrets") as mock_validate:
        # Don't raise from validate_production_secrets in this test
        mock_validate.return_value = None
        _validate_startup_config()
        mock_exit.assert_called_with(1)


def test_development_with_empty_allowed_origins_does_not_exit():
    """In development, empty WS_ALLOWED_ORIGINS is OK (uses DEFAULT_CORS_ORIGINS)."""
    from ws_gateway.main import _validate_startup_config

    mock_settings = MagicMock()
    mock_settings.ENVIRONMENT = "development"
    mock_settings.WS_ALLOWED_ORIGINS = ""

    with patch("ws_gateway.main.sys.exit") as mock_exit, \
         patch("shared.config.settings.settings", mock_settings):
        _validate_startup_config()
        mock_exit.assert_not_called()


def test_null_strategy_accepted_in_test_environment():
    """NullAuthStrategy can be instantiated in non-production environments."""
    from ws_gateway.components.auth.strategies import NullAuthStrategy
    strategy = NullAuthStrategy(tenant_id=1, user_id=1, roles=["ADMIN"])
    assert strategy is not None
