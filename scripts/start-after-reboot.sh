#!/bin/sh
# ─────────────────────────────────────────────────────────
# Utility — Post-Reboot Startup
#
# Brings the full Docker stack online after a machine reboot.
# Auto-detects the project directory so it works from any install path.
#
# Usage:  ./scripts/start-after-reboot.sh
#
# For automatic startup on macOS:
#   This is configured as a LaunchAgent during factory recovery.
# ─────────────────────────────────────────────────────────

set -e

# Auto-detect project directory (works wherever the repo is cloned)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Utility Stack — Post-Reboot Startup ==="
echo "Project: $PROJECT_DIR"
echo ""

# ── 1. Wait for Docker daemon ─────────────────────────
echo "[1/5] Waiting for Docker daemon..."
for i in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then
    echo "  Docker is ready."
    break
  fi
  if [ "$i" = "30" ]; then
    echo "  ERROR: Docker did not start. Is Docker Desktop installed?"
    exit 1
  fi
  sleep 2
done

# ── 2. Create required directories ─────────────────────
echo "[2/5] Ensuring local directories..."
mkdir -p "$PROJECT_DIR/payloads"

# ── 3. Start the full stack ───────────────────────────
echo "[3/5] Starting Docker Compose stack..."
cd "$PROJECT_DIR"
docker compose up -d 2>&1
echo "  Stack launched. Waiting for health checks..."

# ── 4. Wait for Caddy (proxy) to be healthy ───────────
echo "[4/5] Waiting for all services..."
sleep 10
docker compose ps 2>&1

# ── 5. Show access info ───────────────────────────────
echo ""
echo "[5/5] === Stack is running ==="
echo ""
echo "  Local:     http://localhost:3000"
echo "  Via Caddy: http://localhost:80"
echo "  MSF RPC:   localhost:55553"
echo ""
echo "  To check status:  docker compose ps"
echo "  To view logs:     docker compose logs -f"
echo "  To stop:          docker compose down"
echo ""

# Optional: show Tailscale IP if available
if command -v tailscale >/dev/null 2>&1; then
  TS_IP=$(tailscale ip -4 2>/dev/null || true)
  if [ -n "$TS_IP" ]; then
    echo "  Tailscale IP: http://${TS_IP}:80"
  fi
fi
