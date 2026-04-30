"""
Tests for image URL anti-SSRF validation.

Coverage (10.5):
  - Reject HTTP scheme
  - Reject FTP, file, data schemes
  - Reject private IP ranges (10.x, 172.16-31.x, 192.168.x)
  - Reject loopback (127.x, ::1)
  - Reject link-local (169.254.x)
  - Reject non-standard ports
  - Reject localhost hostname
  - Reject bare hostnames (no dot, not an IP)
  - Accept valid HTTPS URLs
  - Accept None (image is optional)
"""
import pytest

from shared.utils.url_validation import validate_image_url


# ── None is always valid (image is optional) ──────────────────────────────────

def test_none_returns_none():
    assert validate_image_url(None) is None


# ── Valid HTTPS URLs ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "https://cdn.example.com/photo.jpg",
    "https://images.unsplash.com/photo-123.jpg",
    "https://storage.googleapis.com/bucket/image.png",
    "https://s3.amazonaws.com/bucket/img.webp",
    "https://example.com/some/path/to/image.jpg",
])
def test_valid_https_urls_accepted(url: str):
    result = validate_image_url(url)
    assert result == url


# ── Scheme validation ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "http://cdn.example.com/image.jpg",
    "ftp://cdn.example.com/image.jpg",
    "file:///etc/passwd",
    "data:image/png;base64,abc123",
])
def test_non_https_schemes_rejected(url: str):
    with pytest.raises(ValueError, match="HTTPS"):
        validate_image_url(url)


# ── Private IP ranges ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "https://10.0.0.1/image.jpg",
    "https://10.255.255.255/image.png",
    "https://172.16.0.1/image.jpg",
    "https://172.31.255.255/img.png",
    "https://192.168.0.1/image.jpg",
    "https://192.168.100.50/image.png",
])
def test_private_ips_rejected(url: str):
    with pytest.raises(ValueError, match="private|loopback"):
        validate_image_url(url)


# ── Loopback addresses ────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "https://127.0.0.1/image.jpg",
    "https://127.255.255.255/image.jpg",
])
def test_loopback_ips_rejected(url: str):
    with pytest.raises(ValueError, match="private|loopback"):
        validate_image_url(url)


def test_localhost_hostname_rejected():
    with pytest.raises(ValueError, match="localhost"):
        validate_image_url("https://localhost/image.jpg")


def test_localhost_with_path_rejected():
    with pytest.raises(ValueError, match="localhost"):
        validate_image_url("https://localhost:443/image.jpg")


# ── Link-local ────────────────────────────────────────────────────────────────

def test_link_local_rejected():
    """169.254.x.x (AWS metadata, etc.) is rejected."""
    with pytest.raises(ValueError, match="private|loopback"):
        validate_image_url("https://169.254.169.254/latest/meta-data/")


# ── Non-standard ports ────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "https://cdn.example.com:8080/image.jpg",
    "https://cdn.example.com:3000/image.jpg",
    "https://cdn.example.com:22/image.jpg",
])
def test_non_standard_ports_rejected(url: str):
    with pytest.raises(ValueError, match="port"):
        validate_image_url(url)


def test_standard_https_port_accepted():
    """Port 443 is the standard HTTPS port — should be accepted."""
    url = "https://cdn.example.com:443/image.jpg"
    result = validate_image_url(url)
    assert result == url


# ── Missing hostname ──────────────────────────────────────────────────────────

def test_empty_string_rejected():
    with pytest.raises(ValueError):
        validate_image_url("")


def test_url_without_hostname_rejected():
    """A URL with no hostname is rejected."""
    with pytest.raises(ValueError):
        validate_image_url("https:///no-hostname.jpg")


# ── Bare hostnames (no TLD) ────────────────────────────────────────────────────

def test_bare_hostname_rejected():
    """Hostnames with no dot (like 'internal') are not valid public hosts."""
    with pytest.raises(ValueError):
        validate_image_url("https://internal/image.jpg")


def test_bare_hostname_app_rejected():
    with pytest.raises(ValueError):
        validate_image_url("https://backend/image.jpg")
