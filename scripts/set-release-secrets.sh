#!/usr/bin/env bash
# Uploads the release secrets (see docs/development.md) to GitHub with the gh CLI.
# Values are read from files and piped straight into gh; nothing is printed.
#
#   scripts/set-release-secrets.sh                      # defaults below
#   APPLE_P12=~/certs/devid.p12 scripts/set-release-secrets.sh
#   scripts/set-release-secrets.sh apple                # only some of: updater apple notarization
set -euo pipefail

REPO="${REPO:-unfuckedapps/ufLabelPrinter}"
UPDATER_KEY="${UPDATER_KEY:-$HOME/.tauri/uflabelprinter.key}"
APPLE_P12="${APPLE_P12:-$HOME/.tauri/devid-cert.p12}"
APPLE_API_KEY_FILE="${APPLE_API_KEY_FILE:-$(ls "$HOME"/.tauri/AuthKey_*.p8 2>/dev/null | head -1)}"

PARTS="${*:-updater apple notarization}"
want() { [[ " $PARTS " == *" $1 "* ]]; }
secret() { gh secret set "$1" --repo "$REPO"; }

# OpenSSL 3 needs -legacy for keychain exports (RC2) and to write p12s macOS can import.
[[ $(openssl version) == LibreSSL* ]] && LEGACY=() || LEGACY=(-legacy)
p12() { openssl pkcs12 "${LEGACY[@]}" "$@"; }

# Keychain exports often hold several identities (Apple Development, local test
# certificates) and Tauri signs with the first one. Repack only the Developer ID
# Application identity plus Apple's intermediates, under the same password.
developer_id_p12() {
  local pem
  pem=$(p12 -in "$APPLE_P12" -passin file:"$APPLE_P12.password" -nodes 2>/dev/null |
    perl -0777 -ne '
      my @bags = map { +{ id => (/localKeyID: (.+)/)[0] // "", name => (/friendlyName: (.+)/)[0] // "",
                         pem => (/(-----BEGIN (.+?)-----.*?-----END \2-----\n)/s)[0] // "" } }
        split /^Bag Attributes\n/m;
      my ($cert) = grep { $_->{name} =~ /^Developer ID Application:/ && $_->{pem} =~ /CERTIFICATE/ } @bags or exit 1;
      print map { $_->{pem} } grep { $_->{id} eq $cert->{id} } @bags;')
  # pkcs12 -export reads the key and the certificate in separate passes, so the PEM is
  # handed in twice; it stays in memory either way.
  p12 -export -name "$1" -passout file:"$APPLE_P12.password" \
    -inkey <(printf '%s\n' "$pem") -in <(printf '%s\n' "$pem") \
    -certfile <(security find-certificate -a -p -c "Developer ID Certification Authority")
}

if want updater; then
  echo "Updater signing key"
  secret TAURI_SIGNING_PRIVATE_KEY < "$UPDATER_KEY"
  secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD < "$UPDATER_KEY.password"
fi

if want apple && [[ -f "$APPLE_P12" ]]; then
  echo "Developer ID certificate"
  identity=$(p12 -in "$APPLE_P12" -passin file:"$APPLE_P12.password" -nokeys 2>/dev/null |
    sed -n 's/.*friendlyName: \(Developer ID Application: .*\)/\1/p' | head -1)
  [[ -n "$identity" ]] || { echo "No Developer ID Application certificate in $APPLE_P12" >&2; exit 1; }
  developer_id_p12 "$identity" | base64 | tr -d '\n' | secret APPLE_CERTIFICATE
  secret APPLE_CERTIFICATE_PASSWORD < "$APPLE_P12.password"
  printf '%s' "$identity" | secret APPLE_SIGNING_IDENTITY
fi

if want notarization && [[ -n "$APPLE_API_KEY_FILE" && -f "$APPLE_API_KEY_FILE" ]]; then
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
