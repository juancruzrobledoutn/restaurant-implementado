"""
Base exception types for the Integrador backend.

Usage:
    from shared.utils.exceptions import NotFoundError, ForbiddenError, ValidationError

These are raised in Domain Services and caught in Routers for HTTP response mapping.
"""


class IntegradorError(Exception):
    """Base class for all Integrador domain exceptions."""

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class NotFoundError(IntegradorError):
    """Raised when a requested resource does not exist or is soft-deleted."""

    def __init__(self, resource: str, identifier: int | str | None = None) -> None:
        detail = f"{resource} not found"
        if identifier is not None:
            detail = f"{resource} with id={identifier} not found"
        super().__init__(detail, code="NOT_FOUND")
        self.resource = resource
        self.identifier = identifier


class ForbiddenError(IntegradorError):
    """Raised when the authenticated user lacks permission for the operation."""

    def __init__(self, message: str = "You do not have permission to perform this action") -> None:
        super().__init__(message, code="FORBIDDEN")


class ValidationError(IntegradorError):
    """Raised when business rule validation fails (distinct from Pydantic schema validation)."""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message, code="VALIDATION_ERROR")
        self.field = field


class ConflictError(IntegradorError):
    """
    Raised when a request conflicts with the current state of a resource.

    Maps to HTTP 409. Distinct from ValidationError (422) — used for state-machine
    violations, duplicate creation attempts, and other operation-on-wrong-state errors.
    """

    def __init__(self, message: str, code: str = "CONFLICT") -> None:
        super().__init__(message, code=code)


class StockInsufficientError(IntegradorError):
    """
    Raised by RoundService.submit() when the round's demand exceeds available stock.

    Maps to HTTP 409 with a structured body: {code:"stock_insufficient", shortages:[...]}.
    The shortages list contains StockShortage entries describing which products or
    ingredients are short and by how much.
    """

    def __init__(self, shortages: list[dict]) -> None:
        super().__init__("Stock insufficient for submit", code="stock_insufficient")
        self.shortages = shortages
