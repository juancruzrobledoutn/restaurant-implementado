#!/bin/bash
# =============================================================================
# generate-selfsigned.sh — Generate a self-signed TLS certificate for local dev
# =============================================================================
# Creates a self-signed certificate in devOps/ssl/selfsigned/ for use with
# nginx-selfsigned.conf during local development or CI environments where
# a real Let's Encrypt certificate is not available.
#
# Usage:
#   bash devOps/ssl/generate-selfsigned.sh
#
# Optional env vars:
#   DOMAIN         — CN for the certificate (default: localhost)
#   CERT_DAYS      — Validity period in days (default: 365)
#   KEY_SIZE       — RSA key size (default: 2048 — sufficient for local dev)
#
# Output:
#   devOps/ssl/selfsigned/fullchain.pem   — self-signed certificate (PEM)
#   devOps/ssl/selfsigned/privkey.pem     — private key (PEM)
#
# Re-running: Safe. Existing certs are overwritten (they are self-signed, so no
# backup is needed — they were never valid outside the local machine).
# =============================================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
DOMAIN="${DOMAIN:-localhost}"
CERT_DAYS="${CERT_DAYS:-365}"
KEY_SIZE="${KEY_SIZE:-2048}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELFSIGNED_DIR="$SCRIPT_DIR/selfsigned"

echo "======================================================="
echo "  Integrador — Self-Signed Certificate Generator"
echo "======================================================="
echo "  CN (domain):    $DOMAIN"
echo "  Validity:       $CERT_DAYS days"
echo "  Key size:       $KEY_SIZE bits"
echo "  Output dir:     $SELFSIGNED_DIR"
echo "======================================================="
echo ""

# ─── Create output directory ─────────────────────────────────────────────────
mkdir -p "$SELFSIGNED_DIR"

# ─── Generate self-signed certificate ────────────────────────────────────────
echo "[1/2] Generating RSA private key + self-signed certificate..."

openssl req -x509 \
    -nodes \
    -newkey "rsa:$KEY_SIZE" \
    -days "$CERT_DAYS" \
    -keyout "$SELFSIGNED_DIR/privkey.pem" \
    -out "$SELFSIGNED_DIR/fullchain.pem" \
    -subj "/C=AR/ST=Buenos Aires/L=Buenos Aires/O=Integrador Dev/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1"

echo "  -> Private key:  $SELFSIGNED_DIR/privkey.pem"
echo "  -> Certificate:  $SELFSIGNED_DIR/fullchain.pem"

# ─── Display certificate info ────────────────────────────────────────────────
echo ""
echo "[2/2] Certificate details:"
openssl x509 -in "$SELFSIGNED_DIR/fullchain.pem" -noout -subject -dates

echo ""
echo "======================================================="
echo "  Done!"
echo "======================================================="
echo ""
echo "  To use this certificate with nginx:"
echo "    docker compose -f docker-compose.yml up -d nginx"
echo "  (nginx-selfsigned.conf references devOps/ssl/selfsigned/)"
echo ""
echo "  NOTE: Browsers will show a security warning for self-signed"
echo "  certificates. Accept the exception for local development only."
echo ""
echo "  For production, use init-letsencrypt.sh instead."
echo ""
