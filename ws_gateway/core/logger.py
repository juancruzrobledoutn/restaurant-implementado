"""
Logger factory for ws_gateway — re-exports shared get_logger with namespace context.

Usage:
    from ws_gateway.core.logger import get_logger
    logger = get_logger(__name__)  # produces "ws_gateway.components.auth.strategies" etc.

All ws_gateway modules MUST use this function. Never call logging.getLogger() directly.

In production (ENVIRONMENT=production), logs are emitted as JSON with:
  - service: "ws_gateway"
  - request_id, user_id, tenant_id from ContextVars (set by RequestIDMiddleware)
"""
import os
import sys

# Ensure backend/shared is importable when running ws_gateway tests in isolation
_repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_backend_path = os.path.join(_repo_root, "backend")
if _backend_path not in sys.path:
    sys.path.insert(0, _backend_path)

from shared.config.logging import configure_logging, get_logger  # noqa: F401, E402

# Configure root logger with service name "ws_gateway" for JSON production logs.
# This is idempotent — safe to call on every import.
configure_logging(service="ws_gateway")

__all__ = ["get_logger"]
