#!/bin/sh
# ──────────────────────────────────────────────────────────────
# Utility — Data Backup Script
#
# Backs up payloads, environment config, and exported DB data
# to a local archive or cloud destination.
#
# Usage:
#   ./scripts/backup.sh                    # save to ./backups/
#   ./scripts/backup.sh s3://my-bucket     # save to S3 (requires aws-cli)
#   ./scripts/backup.sh /path/to/dir       # save to local path
#
# Recommended: run daily via cron or launchctl
#   ./scripts/backup.sh s3://utility-backups/
# ──────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="utility-backup-${TIMESTAMP}"
TEMP_DIR=$(mktemp -d)
DEST="${1:-$PROJECT_DIR/backups}"

echo "=== Utility Backup ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# ── 1. Collect payloads ─────────────────────────────────────
echo "[1/4] Collecting payloads..."
if [ -d "$PROJECT_DIR/payloads" ] && [ "$(ls -A "$PROJECT_DIR/payloads" 2>/dev/null)" ]; then
  mkdir -p "$TEMP_DIR/payloads"
  cp -r "$PROJECT_DIR/payloads/"* "$TEMP_DIR/payloads/" 2>/dev/null || true
  echo "  $(find "$PROJECT_DIR/payloads" -type f | wc -l | tr -d ' ') payload files found."
fi

# ── 2. Export environment ───────────────────────────────────
echo "[2/4] Exporting environment..."
if [ -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env" "$TEMP_DIR/env"
  echo "  .env file saved."
fi

# ── 3. Dump Docker volumes (if Docker is running) ────────────
echo "[3/4] Dumping Docker volumes..."
if docker info >/dev/null 2>&1; then
  # Check if MSF DB container is running and dump data
  if docker ps --format '{{.Names}}' | grep -q 'metasploit-db'; then
    echo "  Exporting MSF database..."
    docker exec metasploit-db pg_dump -U msf msf > "$TEMP_DIR/msf-db.sql" 2>/dev/null || \
      echo "  WARNING: Could not dump database (might be in use)."
  fi
  # Export MSF volume payloads
  if docker ps --format '{{.Names}}' | grep -q 'metasploit-rpc'; then
    echo "  Exporting MSF container payloads..."
    docker cp metasploit-rpc:/payloads/. "$TEMP_DIR/msf-container-payloads/" 2>/dev/null || true
  fi
  # Save list of running services
  docker compose ps --format json > "$TEMP_DIR/docker-ps.json" 2>/dev/null || true
else
  echo "  Docker not running — skipping volume dumps."
fi

# ── 4. Package and upload ───────────────────────────────────
echo "[4/4] Packaging backup..."
cd "$TEMP_DIR"
tar czf "${BACKUP_NAME}.tar.gz" --exclude="${BACKUP_NAME}.tar.gz" .

# Determine destination
if echo "$DEST" | grep -q '^s3://'; then
  # S3 destination
  if ! command -v aws >/dev/null 2>&1; then
    echo "  ERROR: 'aws' CLI not found. Install it: brew install awscli"
    rm -rf "$TEMP_DIR"
    exit 1
  fi
  echo "  Uploading to $DEST..."
  aws s3 cp "${BACKUP_NAME}.tar.gz" "${DEST}${BACKUP_NAME}.tar.gz"
  echo "  Upload complete."
elif echo "$DEST" | grep -q '^r2://'; then
  # Cloudflare R2 (S3-compatible)
  if ! command -v aws >/dev/null 2>&1; then
    echo "  ERROR: 'aws' CLI not found."
    rm -rf "$TEMP_DIR"
    exit 1
  fi
  BUCKET_PATH=$(echo "$DEST" | sed 's|^r2://|s3://|')
  echo "  Uploading to R2: $BUCKET_PATH..."
  aws s3 cp "${BACKUP_NAME}.tar.gz" "${BUCKET_PATH}${BACKUP_NAME}.tar.gz" \
    --endpoint-url "${R2_ENDPOINT_URL:-https://r2.cloudflarestorage.com}" 2>/dev/null || \
    echo "  WARNING: R2 upload failed. Check R2_ENDPOINT_URL env var."
  echo "  Upload complete."
elif [ -d "$DEST" ] || mkdir -p "$DEST" 2>/dev/null; then
  # Local directory
  mkdir -p "$DEST"
  cp "${BACKUP_NAME}.tar.gz" "$DEST/"
  echo "  Saved to: $DEST/${BACKUP_NAME}.tar.gz"
else
  echo "  ERROR: Cannot write to destination: $DEST"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "=== Backup complete: ${BACKUP_NAME}.tar.gz ==="
echo ""
