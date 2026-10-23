#!/usr/bin/env bash
# Uploads the release secrets (see docs/development.md) to GitHub with the gh CLI.
# Values are read from files and piped straight into gh; nothing is printed.
#
#   scripts/set-release-secrets.sh                      # defaults below
#   APPLE_P12=~/certs/devid.p12 scripts/set-release-secrets.sh
set -euo pipefail

REPO="${REPO:-unfuckedapps/ufLabelPrinter}"
UPDATER_KEY="${UPDATER_KEY:-$HOME/.tauri/uflabelprinter.key}"
APPLE_P12="${APPLE_P12:-$HOME/.tauri/devid-cert.p12}"
APPLE_API_KEY_FILE="${APPLE_API_KEY_FILE:-$(ls "$HOME"/.tauri/AuthKey_*.p8 2>/dev/null | head -1)}"

secret() { gh secret set "$1" --repo "$REPO"; }

echo "Updater signing key"
secret TAURI_SIGNING_PRIVATE_KEY < "$UPDATER_KEY"
secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD < "$UPDATER_KEY.password"

if [[ -f "$APPLE_P12" ]]; then
  echo "Developer ID certificate"
  base64 < "$APPLE_P12" | tr -d '\n' | secret APPLE_CERTIFICATE
  secret APPLE_CERTIFICATE_PASSWORD < "$APPLE_P12.password"
  identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)
  [[ -n "$identity" ]] || { echo "No Developer ID Application identity in the keychain" >&2; exit 1; }
  printf '%s' "$identity" | secret APPLE_SIGNING_IDENTITY
fi

if [[ -n "$APPLE_API_KEY_FILE" && -f "$APPLE_API_KEY_FILE" ]]; then
  echo "App Store Connect API key (notarization)"
  key_id=$(basename "$APPLE_API_KEY_FILE" .p8); key_id=${key_id#AuthKey_}
  printf '%s' "$key_id" | secret APPLE_API_KEY
  secret APPLE_API_KEY_P8 < "$APPLE_API_KEY_FILE"
  issuer="${APPLE_API_ISSUER:-}"
  [[ -n "$issuer" ]] || read -rp "App Store Connect issuer ID (Users and Access → Integrations): " issuer
  printf '%s' "$issuer" | secret APPLE_API_ISSUER
fi

echo "Done. Secrets in $REPO:"
gh secret list --repo "$REPO"
