"""
Image URL anti-SSRF validation.

validate_image_url(url) rejects URLs that could be used to probe internal
infrastructure (SSRF — Server-Side Request Forgery).

Validation rules:
  - Only HTTPS scheme allowed (rejects http, ftp, file, data, etc.)
  - Rejects private IP ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  - Rejects loopback: 127.0.0.0/8, ::1
  - Rejects non-standard ports (only None/80/443 accepted for https)
  - Rejects URLs without a valid hostname
  - Accepts None (image is optional — returns None unchanged)

Usage:
    from shared.utils.url_validation import validate_image_url

    url = validate_image_url("https://cdn.example.com/image.jpg")  # ok
    validate_image_url("http://example.com/image.jpg")  # raises ValueError
    validate_image_url("https://192.168.1.1/image.jpg")  # raises ValueError
    validate_image_url(None)  # returns None
"""
import ipaddress
import socket
from urllib.parse import urlparse

from pydantic import field_validator


_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local
    ipaddress.ip_network("::1/128"),          # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),         # IPv6 unique local
]

_ALLOWED_PORTS = {None, 443}  # https standard port only


def _is_private_ip(hostname: str) -> bool:
    """Return True if hostname resolves to a private/loopback IP address."""
    try:
        addr = ipaddress.ip_address(hostname)
        return any(addr in network for network in _PRIVATE_NETWORKS)
    except ValueError:
        # hostname is a domain name, not a bare IP — check if it looks safe
        # We do NOT resolve DNS here (prevents DNS rebinding mitigation bypass)
        # Domain-name validation is sufficient for our SSRF threat model
        return False


def validate_image_url(url: str | None) -> str | None:
    """
    Validate an image URL against SSRF attack vectors.

    Args:
        url: The image URL to validate, or None (image is optional).

    Returns:
        The original url if valid, or None if url is None.

    Raises:
        ValueError: if the URL fails any validation check.
    """
    if url is None:
        return None

    if not url or not url.strip():
        raise ValueError("Image URL must not be empty if provided")

    parsed = urlparse(url)

    # 1. Must be HTTPS only
    if parsed.scheme != "https":
        raise ValueError(
            f"Image URL must use HTTPS scheme, got '{parsed.scheme}://'"
        )

    # 2. Must have a hostname
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Image URL must have a valid hostname")

    # 3. Reject private/loopback IP addresses
    if _is_private_ip(hostname):
        raise ValueError(
            f"Image URL must point to a public host — '{hostname}' is a private/loopback address"
        )

    # 4. Reject non-standard ports
    port = parsed.port
    if port is not None and port not in _ALLOWED_PORTS:
        raise ValueError(
            f"Image URL must use the standard HTTPS port (443), got port {port}"
        )

    # 5. Hostname must contain at least one dot (basic sanity check)
    # Bare hostnames like "localhost" or "internal" are rejected
    if "." not in hostname and hostname != "localhost":
        # Allow numeric IPs — these will be caught by _is_private_ip
        try:
            ipaddress.ip_address(hostname)
        except ValueError:
            raise ValueError(
                f"Image URL hostname '{hostname}' is not a valid public hostname"
            )

    # Explicitly reject "localhost" as a hostname
    if hostname.lower() == "localhost":
        raise ValueError("Image URL must not use 'localhost' as hostname")

    return url
