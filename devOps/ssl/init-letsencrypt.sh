#!/bin/bash
# =============================================================================
# init-letsencrypt.sh — Bootstrap SSL certificates for Integrador
# =============================================================================
# This script:
#   1. Creates a temporary self-signed certificate so nginx can start
#   2. Starts nginx with the self-signed cert
#   3. Requests a real Let's Encrypt certificate via Certbot
#   4. Reloads nginx with the real certificate
#   5. Sets up automatic renewal
#
# Usage:
#   export DOMAIN=yourdomain.com
#   export CERT_EMAIL=admin@yourdomain.com
#   export STAGING=0            # Set to 1 for Let's Encrypt staging (rate-limit safe)
#   bash devOps/ssl/init-letsencrypt.sh
#
# Prerequisites:
#   - Domain DNS A record pointing to this server's public IP
#   - Ports 80 and 443 open in firewall
#   - Docker and Docker Compose installed
#
# Re-running: Safe to re-run. Existing certificates are backed up automatically.
# =============================================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
DOMAIN="${DOMAIN:?ERROR: Set DOMAIN environment variable (e.g., export DOMAIN=yourdomain.com)}"
CERT_EMAIL="${CERT_EMAIL:?ERROR: Set CERT_EMAIL environment variable (e.g., export CERT_EMAIL=admin@yourdomain.com)}"
STAGING="${STAGING:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVOPS_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$DEVOPS_DIR")"

CERTBOT_PATH="$DEVOPS_DIR/certbot"
LETSENCRYPT_PATH="$CERTBOT_PATH/conf"
WEBROOT_PATH="$CERTBOT_PATH/www"

RSA_KEY_SIZE=4096

echo "=============================================="
echo "  Integrador SSL Certificate Setup"
echo "=============================================="
echo "  Domain:  $DOMAIN"
echo "  Email:   $CERT_EMAIL"
echo "  Staging: $([ "$STAGING" = "1" ] && echo "YES (testing)" || echo "NO (production)")"
echo "=============================================="
echo ""

# ─── Step 1: Create directories ─────────────────────────────────────────────
echo "[1/6] Creating certificate directories..."
mkdir -p "$LETSENCRYPT_PATH/live/$DOMAIN"
mkdir -p "$WEBROOT_PATH"
echo "  -> $LETSENCRYPT_PATH"
echo "  -> $WEBROOT_PATH"

# ─── Step 2: Generate self-signed certificate for initial nginx startup ──────
CERT_FILE="$LETSENCRYPT_PATH/live/$DOMAIN/fullchain.pem"
KEY_FILE="$LETSENCRYPT_PATH/live/$DOMAIN/privkey.pem"

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    echo "[2/6] Existing certificates found. Backing up..."
    BACKUP_DIR="$LETSENCRYPT_PATH/live/$DOMAIN/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp "$CERT_FILE" "$BACKUP_DIR/"
    cp "$KEY_FILE" "$BACKUP_DIR/"
    echo "  -> Backup saved to $BACKUP_DIR"
fi

echo "[2/6] Generating temporary self-signed certificate..."
docker run --rm \
    -v "$LETSENCRYPT_PATH:/etc/letsencrypt" \
    certbot/certbot:latest \
    sh -c "
        mkdir -p /etc/letsencrypt/live/$DOMAIN && \
        openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE -days 1 \
            -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
            -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
            -subj '/CN=$DOMAIN'
    "

# Create a dummy chain.pem for OCSP stapling (will be replaced by real cert)
docker run --rm \
    -v "$LETSENCRYPT_PATH:/etc/letsencrypt" \
    certbot/certbot:latest \
    sh -c "cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/letsencrypt/live/$DOMAIN/chain.pem"

echo "  -> Self-signed certificate created for initial startup"

# ─── Step 3: Start nginx with self-signed certificate ────────────────────────
echo "[3/6] Starting nginx with temporary certificate..."
cd "$DEVOPS_DIR"

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx
echo "  -> Nginx started on ports 80 and 443"

# Wait for nginx to be ready
echo "  -> Waiting for nginx to be ready..."
sleep 5

# ─── Step 4: Request real certificate from Let's Encrypt ─────────────────────
echo "[4/6] Requesting Let's Encrypt certificate..."

STAGING_FLAG=""
if [ "$STAGING" = "1" ]; then
    STAGING_FLAG="--staging"
    echo "  -> Using STAGING environment (not production-valid)"
fi

# Delete the self-signed certificate before requesting real one
docker run --rm \
    -v "$LETSENCRYPT_PATH:/etc/letsencrypt" \
    certbot/certbot:latest \
    sh -c "rm -rf /etc/letsencrypt/live/$DOMAIN && rm -rf /etc/letsencrypt/archive/$DOMAIN && rm -rf /etc/letsencrypt/renewal/$DOMAIN.conf" || true

docker run --rm \
    -v "$LETSENCRYPT_PATH:/etc/letsencrypt" \
    -v "$WEBROOT_PATH:/var/www/certbot" \
    certbot/certbot:latest \
    certonly --webroot \
        --webroot-path=/var/www/certbot \
        --email "$CERT_EMAIL" \
        --agree-tos \
        --no-eff-email \
        --force-renewal \
        -d "$DOMAIN" \
        $STAGING_FLAG

echo "  -> Certificate obtained successfully!"

# ─── Step 5: Reload nginx with real certificate ──────────────────────────────
echo "[5/6] Reloading nginx with production certificate..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -s reload
echo "  -> Nginx reloaded"

# ─── Step 6: Verify ─────────────────────────────────────────────────────────
echo "[6/6] Verifying SSL setup..."
echo ""

# Test HTTPS (allow self-signed for staging)
if [ "$STAGING" = "1" ]; then
    CURL_FLAGS="-sSk"
else
    CURL_FLAGS="-sS"
fi

if curl $CURL_FLAGS "https://$DOMAIN/health" -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q "200"; then
    echo "  [OK] HTTPS is working on https://$DOMAIN/health"
else
    echo "  [WARN] Could not verify HTTPS — check DNS and firewall settings"
fi

if curl -sS "http://$DOMAIN/" -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q "301"; then
    echo "  [OK] HTTP -> HTTPS redirect is working"
else
    echo "  [WARN] HTTP redirect check failed — may need DNS propagation"
fi

echo ""
echo "=============================================="
echo "  SSL Setup Complete!"
echo "=============================================="
echo ""
echo "  Certificate location:"
echo "    $LETSENCRYPT_PATH/live/$DOMAIN/"
echo ""
echo "  Renewal: Certificates auto-renew via the certbot"
echo "  service in docker-compose.prod.yml (runs every 12h)."
echo ""
echo "  To manually renew:"
echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml \\"
echo "      run --rm certbot renew"
echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml \\"
echo "      exec nginx nginx -s reload"
echo ""
echo "  To test renewal (dry run):"
echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml \\"
echo "      run --rm certbot renew --dry-run"
echo ""
