"""
Common validation utilities for the Integrador backend.

Usage:
    from shared.utils.validators import validate_image_url, escape_like_pattern
"""
import re
from urllib.parse import urlparse


def validate_image_url(url: str | None) -> str | None:
    """
    Validate that a URL is a valid http/https image URL.

    Returns the URL if valid, raises ValueError otherwise.
    Returns None if url is None (field is optional).
    """
    if url is None:
        return None

    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"Image URL must use http or https, got: {parsed.scheme!r}")
        if not parsed.netloc:
            raise ValueError("Image URL must have a valid host")
    except Exception as exc:
        raise ValueError(f"Invalid image URL: {url!r}") from exc

    return url


def escape_like_pattern(value: str) -> str:
    """
    Escape special characters in a SQL LIKE pattern.

    Escapes %, _, and \\ so they are treated as literals.
    Use when building LIKE patterns from user input.

    Example:
        pattern = f"%{escape_like_pattern(user_input)}%"
        query.filter(Model.name.like(pattern, escape="\\"))
    """
    return re.sub(r"([%_\\])", r"\\\1", value)
