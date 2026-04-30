"""
Centralized logger factory for the Integrador backend.

Usage:
    from shared.config.logging import get_logger
    logger = get_logger(__name__)
    logger.info("Message")

NEVER use print() or logging.getLogger() directly — always use get_logger().

Log format:
  - Development: human-readable text (%(asctime)s [%(levelname)s] %(name)s: %(message)s)
  - Production (ENVIRONMENT=production): structured JSON, one object per line.
    Fields: timestamp, level, service, logger, message, request_id, user_id,
            tenant_id (when set via ContextVars from RequestIDMiddleware).

The request_id, user_id, and tenant_id fields are populated automatically from
ContextVars set by RequestIDMiddleware — no explicit passing required.
"""
import json
import logging
import sys
from datetime import datetime, timezone

from shared.config.settings import settings

_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_configured = False


class _JSONFormatter(logging.Formatter):
    """
    Formats log records as newline-delimited JSON.

    Reads request_id, user_id, tenant_id from ContextVars set by
    RequestIDMiddleware at the time of formatting (not at call site),
    which is correct for async FastAPI handlers.

    Args:
        service: Service name included in every log record.
                 Defaults to "backend". Set to "ws_gateway" when
                 configuring the logger for the ws_gateway process.
    """

    def __init__(self, service: str = "backend", **kwargs):
        super().__init__(**kwargs)
        self._service = service

    def format(self, record: logging.LogRecord) -> str:
        # Import here to avoid circular import at module load time
        try:
            from shared.middleware.request_id import (
                request_id_ctx,
                tenant_id_ctx,
                user_id_ctx,
            )
            request_id = request_id_ctx.get()
            user_id = user_id_ctx.get()
            tenant_id = tenant_id_ctx.get()
        except ImportError:
            # Middleware not available (e.g., running in a script context)
            request_id = ""
            user_id = ""
            tenant_id = ""

        payload: dict = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "level": record.levelname,
            "service": self._service,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if request_id:
            payload["request_id"] = request_id
        if user_id:
            payload["user_id"] = user_id
        if tenant_id:
            payload["tenant_id"] = tenant_id

        # Include exception info if present
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False)


def configure_logging(service: str = "backend") -> None:
    """
    Configure the root logger. Idempotent — only runs once per process.

    Args:
        service: Name embedded in JSON log records (e.g. "backend", "ws_gateway").
                 Only used when ENVIRONMENT=production (JSON mode).
    """
    global _configured
    if _configured:
        return

    level = logging.DEBUG if settings.DEBUG else logging.INFO

    if settings.ENVIRONMENT == "production":
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_JSONFormatter(service=service))
    else:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT))

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)

    _configured = True


# Keep the private alias for backward compatibility within this module
_configure_root_logger = configure_logging


def get_logger(name: str) -> logging.Logger:
    """
    Return a configured logger for the given module name.

    For the backend service, call this directly.
    For ws_gateway, prefer importing via ws_gateway.core.logger which sets
    service="ws_gateway" in production JSON logs.
    """
    configure_logging()
    return logging.getLogger(name)
