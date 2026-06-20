#!/bin/sh
# ──────────────────────────────────────────────────────────────
# Utility — Full Factory Reset Recovery
#
# After a factory reset (macOS reinstall, new machine, etc.),
# run this single command to restore the entire stack:
#
#   curl -fsSL https://raw.githubusercontent.com/balestar/utility/main/scripts/factory-recovery.sh | sh
#
# This script:
#   1. Installs Xcode Command Line Tools (if missing)
#   2. Installs Homebrew (if missing)
#   3. Installs Docker (if missing)
#   4. Clones the project repo
#   5. Restores data from cloud backups (if available)
#   6. Builds and starts the full Docker stack
#   7. Configures auto-start on boot
#   8. Prints access information
#
# Environment variables (all optional):
#   REPO_URL  — Git URL (default: https://github.com/balestar/utility.git)
#   BRANCH    — Git branch (default: main)
#   DATA_URL  — URL to download a backup tarball (optional)
#   MSF_RPC_PASSWORD — Metasploit RPC password (default: changeme)
#   DASHBOARD_API_KEY — API key for dashboard auth (auto-generated if empty)
#   CADDY_DOMAIN      — Public domain for Caddy (default: localhost)
#   CADDY_AUTH_USER   — Caddy basic auth username (default: admin)
#   CADDY_AUTH_PASS   — Caddy basic auth password (default: changeme)
#   MSF_DEMO_MODE     — Use demo data (default: false)
# ──────────────────────────────────────────────────────────────
set -e

# ── Config ───────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/balestar/utility.git}"
BRANCH="${BRANCH:-main}"
DATA_URL="${DATA_URL:-}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/utility}"
MSF_RPC_PASSWORD="${MSF_RPC_PASSWORD:-changeme}"
DASHBOARD_API_KEY="${DASHBOARD_API_KEY:-$(openssl rand -hex 32)}"
CADDY_DOMAIN="${CADDY_DOMAIN:-localhost}"
CADDY_AUTH_USER="${CADDY_AUTH_USER:-admin}"
CADDY_AUTH_PASS="${CADDY_AUTH_PASS:-changeme}"
MSF_DEMO_MODE="${MSF_DEMO_MODE:-false}"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║      Utility — Factory Reset Recovery               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "This script will restore the full utility stack after a factory reset."
echo "Target directory: $INSTALL_DIR"
echo ""

# ── 1. Xcode Command Line Tools ────────────────────────────
echo "[1/7] Checking Xcode Command Line Tools..."
if ! xcode-select -p >/dev/null 2>&1; then
  echo "  Installing Xcode CLI tools (this may take a while)..."
  xcode-select --install 2>/dev/null || true
  echo "  Waiting for installation to complete..."
  until xcode-select -p >/dev/null 2>&1; do
    sleep 5
  done
  echo "  Xcode CLI tools installed."
else
  echo "  Found."
fi

# ── 2. Homebrew ────────────────────────────────────────────
echo "[2/7] Checking Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
  echo "  Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo "  Homebrew installed."
else
  echo "  Found."
fi

# ── 3. Docker ──────────────────────────────────────────────
echo "[3/7] Checking Docker..."
if ! command -v docker >/dev/null 2>&1; then
  echo "  Installing Docker via Homebrew..."
  brew install --cask docker
  echo "  Docker installed. Please open Docker Desktop to complete setup."
  echo "  Opening Docker Desktop..."
  open -a Docker 2>/dev/null || true
  echo "  Waiting for Docker daemon..."
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      echo "  Docker is ready."
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo "  WARNING: Docker did not start. Run 'open -a Docker' manually."
    fi
    sleep 5
  done
else
  echo "  Found."
fi

# ── 4. Clone / Update repo ─────────────────────────────────
echo "[4/7] Setting up project..."
if [ -d "$INSTALL_DIR" ]; then
  echo "  Directory exists. Updating..."
  cd "$INSTALL_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  echo "  Cloning repository..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── 5. Create .env from template ───────────────────────────
echo "[5/7] Configuring environment..."
if [ ! -f .env ]; then
  cp .env.example .env
  # Replace defaults with secure values
  if [ "$(uname)" = "Darwin" ]; then
    sed -i '' "s/MSF_RPC_PASSWORD=changeme/MSF_RPC_PASSWORD=$MSF_RPC_PASSWORD/" .env
    sed -i '' "s/DASHBOARD_API_KEY=.*/DASHBOARD_API_KEY=$DASHBOARD_API_KEY/" .env
    sed -i '' "s/CADY_DOMAIN=localhost/CADDY_DOMAIN=$CADDY_DOMAIN/" .env
    sed -i '' "s/CADDY_AUTH_USER=admin/CADDY_AUTH_USER=$CADDY_AUTH_USER/" .env
    sed -i '' "s/CADDY_AUTH_PASS=changeme/CADDY_AUTH_PASS=$CADDY_AUTH_PASS/" .env
    sed -i '' "s/MSF_DEMO_MODE=true/MSF_DEMO_MODE=$MSF_DEMO_MODE/" .env
  else
    sed -i "s/MSF_RPC_PASSWORD=changeme/MSF_RPC_PASSWORD=$MSF_RPC_PASSWORD/" .env
    sed -i "s/DASHBOARD_API_KEY=.*/DASHBOARD_API_KEY=$DASHBOARD_API_KEY/" .env
    sed -i "s/CADDY_DOMAIN=localhost/CADDY_DOMAIN=$CADDY_DOMAIN/" .env
    sed -i "s/CADDY_AUTH_USER=admin/CADDY_AUTH_USER=$CADDY_AUTH_USER/" .env
    sed -i "s/CADDY_AUTH_PASS=changeme/CADDY_AUTH_PASS=$CADDY_AUTH_PASS/" .env
    sed -i "s/MSF_DEMO_MODE=true/MSF_DEMO_MODE=$MSF_DEMO_MODE/" .env
  fi
  echo "  .env file created with secure defaults."
else
  echo "  .env file exists — keeping existing configuration."
fi

# ── 5b. Restore from cloud backup (optional) ────────────────
if [ -n "$DATA_URL" ]; then
  echo "  Restoring data from backup: $DATA_URL"
  TMP_BACKUP=$(mktemp -d)
  curl -fsSL "$DATA_URL" -o "$TMP_BACKUP/backup.tar.gz"
  tar xzf "$TMP_BACKUP/backup.tar.gz" -C "$TMP_BACKUP"
  if [ -d "$TMP_BACKUP/payloads" ]; then
    mkdir -p payloads
    cp -r "$TMP_BACKUP/payloads/"* payloads/ 2>/dev/null || true
    echo "  Payloads restored."
  fi
  if [ -f "$TMP_BACKUP/env" ]; then
    cp "$TMP_BACKUP/env" .env.restored
    echo "  Environment backup restored to .env.restored (review before using)."
  fi
  rm -rf "$TMP_BACKUP"
fi

# ── 6. Build and start Docker stack ────────────────────────
echo "[6/7] Building and starting Docker stack..."
docker compose build --no-cache dashboard 2>&1
docker compose up -d 2>&1

# Wait for stack to be healthy
echo "  Waiting for services to become healthy..."
sleep 15
docker compose ps 2>&1

# ── 7. Configure auto-start on boot ────────────────────────
echo "[7/7] Configuring auto-start on boot..."
if [ "$(uname)" = "Darwin" ]; then
  # macOS: install LaunchAgent
  mkdir -p "$HOME/Library/LaunchAgents"
  PLIST_DEST="$HOME/Library/LaunchAgents/com.utility.console.plist"
  cat > "$PLIST_DEST" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.utility.console</string>
    <key>ProgramArguments</key>
    <array>
        <string>$INSTALL_DIR/scripts/start-after-reboot.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/utility-console-startup.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/utility-console-startup.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
PLISTEOF
  # Update the reboot script to point to the correct install dir
  if [ -f "$INSTALL_DIR/scripts/start-after-reboot.sh" ]; then
    sed -i '' "s|PROJECT_DIR=.*|PROJECT_DIR=\"$INSTALL_DIR\"|" "$INSTALL_DIR/scripts/start-after-reboot.sh" 2>/dev/null || true
  fi
  launchctl load "$PLIST_DEST" 2>/dev/null || true
  echo "  LaunchAgent installed. Stack will auto-start on boot."
elif command -v systemctl >/dev/null 2>&1; then
  # Linux: use systemd
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/utility-console.service" << SYSTEMDEOF
[Unit]
Description=Utility Console Stack
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=docker compose up -d
ExecStop=docker compose down
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
SYSTEMDEOF
  systemctl --user enable utility-console.service 2>/dev/null || true
  echo "  systemd user service installed."
else
  echo "  No auto-start mechanism configured for this OS."
  echo "  Add this to crontab: @reboot cd $INSTALL_DIR && docker compose up -d"
fi

# ── Done ────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✓ Recovery Complete                                ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Dashboard:   http://localhost:3000"
echo "  Via Caddy:   http://localhost:80"
echo "  MSF RPC:     localhost:55553"
echo ""
echo "  API Key:           $DASHBOARD_API_KEY"
echo "  Caddy User:        $CADDY_AUTH_USER"
echo "  Caddy Password:    $CADDY_AUTH_PASS"
echo "  RPC Password:      $MSF_RPC_PASSWORD"
echo "  Demo Mode:         $MSF_DEMO_MODE"
echo ""
echo "  Install dir:       $INSTALL_DIR"
echo "  Auto-start:        enabled"
echo ""
echo "  To check status:   docker compose ps"
echo "  To view logs:      docker compose logs -f"
echo "  To stop:           docker compose down"
echo ""

# Show Tailscale info if available
if command -v tailscale >/dev/null 2>&1; then
  TS_IP=$(tailscale ip -4 2>/dev/null || true)
  if [ -n "$TS_IP" ]; then
    echo "  Tailscale IP: http://${TS_IP}:80"
  fi
fi
echo ""
