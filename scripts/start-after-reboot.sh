#!/bin/sh
# ─────────────────────────────────────────────────────────
# Metasploit Console — Reboot Survival Startup Script
# Run this after every machine reboot to bring the full
# stack back online with persisted data.
#
# Usage:  chmod +x scripts/start-after-reboot.sh
#         ./scripts/start-after-reboot.sh
#
# For automatic startup on macOS, add to LaunchAgents or
# run:  sudo crontab -e
# and add:  @reboot /path/to/scripts/start-after-reboot.sh
# ─────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Metasploit Console — Post-Reboot Startup ==="
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
