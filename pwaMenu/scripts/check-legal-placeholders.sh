#!/usr/bin/env bash
# check-legal-placeholders.sh — Legal review guard for i18n consent texts (C-19 / Task 10.3)
#
# Fails CI if any locale file still contains '[LEGAL REVIEW REQUIRED]' prefix.
# This prefix is intentionally added to consent.legalText and consent.body.
# Remove it ONLY after the legal team has explicitly approved the final texts.
#
# Run in CI before build:
#   npm run check:legal

set -euo pipefail

LOCALES_DIR="${LOCALES_DIR:-src/i18n/locales}"
PLACEHOLDER="[LEGAL REVIEW REQUIRED]"

if [ ! -d "$LOCALES_DIR" ]; then
  echo "ERROR: Locales directory not found at $LOCALES_DIR"
  exit 1
fi

FOUND=0

for locale_file in "$LOCALES_DIR"/*.json; do
  if grep -q "$PLACEHOLDER" "$locale_file" 2>/dev/null; then
    echo "⚠️  LEGAL PLACEHOLDER FOUND in: $locale_file"
    grep -n "$PLACEHOLDER" "$locale_file"
    FOUND=$((FOUND + 1))
  fi
done

if [ "$FOUND" -gt 0 ]; then
  echo ""
  echo "❌ BUILD BLOCKED: $FOUND file(s) contain unreviewed legal texts."
  echo "   Consent texts (consent.legalText, consent.body) require legal team approval"
  echo "   before deploy. Remove '[LEGAL REVIEW REQUIRED]' prefix after legal sign-off."
  echo "   [BLOQUEANTE — review legal required]"
  exit 1
fi

echo "✅ Legal placeholder check passed: no unreviewed consent texts found."
exit 0
