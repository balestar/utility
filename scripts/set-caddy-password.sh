#!/bin/sh
# ──────────────────────────────────────────────────────
# Generate a Caddyfile with a custom basic auth password
# ──────────────────────────────────────────────────────
set -e

CADDYFILE="$(cd "$(dirname "$0")/.." && pwd)/Caddyfile"
PASSWORD="${1:-changeme}"

if ! command -v caddy >/dev/null 2>&1; then
  echo "ERROR: 'caddy' not found. Install it: brew install caddy"
  exit 1
fi

echo "Generating bcrypt hash for password..."
HASH=$(caddy hash-password --plaintext "$PASSWORD")

# Replace the hash in the Caddyfile
sed -i '' "s|admin \$2a.*|admin $HASH|" "$CADDYFILE"

echo "Done! Caddyfile updated with new password hash."
echo "Password: $PASSWORD"
echo "File:     $CADDYFILE"
