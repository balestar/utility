# Utility

Remote administration tool — a web dashboard for managing Metasploit Framework sessions, payloads, listeners, and modules.

## Architecture

```
Caddy (:80/:443) → Next.js Dashboard (:3000) → MSF RPC (TCP :55553) → PostgreSQL (:5432)
```

## Quick Start

```bash
# 1. Clone and enter
git clone https://github.com/balestar/utility.git
cd utility

# 2. Start the full stack
docker compose up -d

# 3. Access the dashboard
open http://localhost:3000
```

## Features

| Module | Description |
|---|---|
| **Dashboard** | Overview with stat cards and quick actions |
| **Payloads** | Generate backdoors (exe, elf, python, powershell, etc.) |
| **Listeners** | Start/stop multi/handler listeners |
| **Sessions** | View active shells and meterpreter sessions |
| **Modules** | Browse exploits, payloads, and auxiliary modules |
| **Workspaces** | Manage isolated engagement environments |
| **Settings** | App lock, connection info, quick commands |

## Security

- PIN lock screen with auto-lock after inactivity
- Panic button (double-click bottom-right corner to lock)
- API key authentication on all routes
- Caddy reverse proxy with basic auth + TLS
- Generic "Utility" branding (PWA named "Utility")

## Development

```bash
# Run dashboard locally with demo data
cp .env.example .env.local
# Edit .env.local — ensure MSF_DEMO_MODE=true
npm install
npm run dev
```

## Remote Access

```bash
# Option 1: Tailscale
tailscale up
tailscale funnel 80

# Option 2: ngrok
ngrok http 80

# Option 3: LAN (already works on port 80)
```

## License

MIT
