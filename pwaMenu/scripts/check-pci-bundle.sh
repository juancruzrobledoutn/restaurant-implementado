#!/usr/bin/env bash
# check-pci-bundle.sh — Post-build PCI compliance guard (C-19 / Task 11.5)
#
# [BLOQUEANTE — HUMAN REVIEW REQUIRED]
#
# Scans the built JS bundle for patterns that suggest card data handling
# or MercadoPago SDK initialization in-scope.
#
# Fails CI (exit code 1) if any forbidden pattern is found.
# Run as part of the CI pipeline AFTER `npm run build`.
#
# Forbidden patterns (any match = PCI scope violation):
#   card_number      — card number field name
#   cvv              — CVV field name
#   cardholder       — cardholder field name
#   /v1/card_tokens  — MP card tokenization API endpoint
#   @mercadopago/sdk — MP SDK import (must NOT be in the bundle)
#
# IMPORTANT: This script CANNOT guarantee PCI compliance on its own.
# It is a regression guard only. Full PCI review is required before deploy.

set -euo pipefail

DIST_DIR="${DIST_DIR:-dist/assets}"
PATTERNS=(
  "card_number"
  "cvv"
  "cardholder"
  "/v1/card_tokens"
  "@mercadopago/sdk"
)

if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: dist directory not found at $DIST_DIR. Run 'npm run build' first."
  exit 1
fi

JS_FILES=$(find "$DIST_DIR" -name "*.js" 2>/dev/null)

if [ -z "$JS_FILES" ]; then
  echo "ERROR: No JS files found in $DIST_DIR. Run 'npm run build' first."
  exit 1
fi

FOUND_VIOLATIONS=0

for pattern in "${PATTERNS[@]}"; do
  echo "Checking for: $pattern"
  MATCHES=$(grep -rl "$pattern" $JS_FILES 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    echo "❌ PCI VIOLATION: Pattern '$pattern' found in bundle:"
    echo "$MATCHES"
    FOUND_VIOLATIONS=$((FOUND_VIOLATIONS + 1))
  fi
done

if [ "$FOUND_VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "❌ BUILD REJECTED: $FOUND_VIOLATIONS PCI violation(s) found in bundle."
  echo "   The pwaMenu must NOT handle card data directly."
  echo "   All card payments must go through MP hosted checkout (redirect-only)."
  echo "   [HUMAN REVIEW REQUIRED — CRITICO]"
  exit 1
fi

echo "✅ PCI check passed: no card data patterns found in bundle."
exit 0
