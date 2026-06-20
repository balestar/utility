#!/bin/sh
# ──────────────────────────────────────────────────────────────
# Utility — Restore from Backup
#
# Usage:
#   ./scripts/restore.sh ./backups/utility-backup-20260620.tar.gz
#   ./scripts/restore.sh s3://my-bucket/utility-backup-20260620.tar.gz
# ──────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_SOURCE="${1:-}"

if [ -z "$BACKUP_SOURCE" ]; then
  # No arg given — list available local backups
  echo "Available backups:"
  ls -1t "$PROJECT_DIR/backups/"*.tar.gz 2>/dev/null | head -10 || echo "  (none found in ./backups/)"
  echo ""
  echo "Usage: $0 <backup-file-or-url>"
  exit 1
fi

TEMP_DIR=$(mktemp -d)

echo "=== Utility Restore ==="
echo "Source: $BACKUP_SOURCE"
echo ""

# ── Download / copy backup ──────────────────────────────────
echo "[1/4] Acquiring backup..."
if echo "$BACKUP_SOURCE" | grep -q '^s3://'; then
  aws s3 cp "$BACKUP_SOURCE" "$TEMP_DIR/backup.tar.gz"
elif echo "$BACKUP_SOURCE" | grep -q '^https\?://'; then
  curl -fsSL "$BACKUP_SOURCE" -o "$TEMP_DIR/backup.tar.gz"
elif [ -f "$BACKUP_SOURCE" ]; then
  cp "$BACKUP_SOURCE" "$TEMP_DIR/backup.tar.gz"
else
  echo "ERROR: Cannot access: $BACKUP_SOURCE"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# ── Extract ──────────────────────────────────────────────────
echo "[2/4] Extracting..."
cd "$TEMP_DIR"
tar xzf backup.tar.gz
echo "  Extracted."

# ── Restore payloads ────────────────────────────────────────
echo "[3/4] Restoring data..."
if [ -d "$TEMP_DIR/payloads" ] && [ "$(ls -A "$TEMP_DIR/payloads" 2>/dev/null)" ]; then
  mkdir -p "$PROJECT_DIR/payloads"
  cp -r "$TEMP_DIR/payloads/"* "$PROJECT_DIR/payloads/" 2>/dev/null || true
  echo "  Payloads restored."
fi

if [ -f "$TEMP_DIR/env" ]; then
  cp "$TEMP_DIR/env" "$PROJECT_DIR/.env.restored"
  echo "  Environment saved to .env.restored (review before overwriting .env)."
fi

if [ -f "$TEMP_DIR/msf-db.sql" ]; then
  echo "  Database dump found. To restore:"
  echo "    docker exec -i metasploit-db psql -U msf msf < .env.restored/msf-db.sql"
fi

if [ -d "$TEMP_DIR/msf-container-payloads" ]; then
  echo "  MSF container payloads found. To restore:"
  echo "    docker cp msf-container-payloads/. metasploit-rpc:/payloads/"
fi

# ── Cleanup ─────────────────────────────────────────────────
echo "[4/4] Cleaning up..."
rm -rf "$TEMP_DIR"

echo ""
echo "=== Restore complete ==="
echo "Restart the stack: docker compose restart"
echo ""
