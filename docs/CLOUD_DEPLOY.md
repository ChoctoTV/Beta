# ChoctoTV — Oracle Cloud Free Tier Deployment Guide

## What You Need

- Oracle Cloud account (free tier — AMD or ARM)
- Instance: **VM.Standard.A1.Flex** (ARM, 4 OCPU, 24GB RAM free) — recommended
- OS: Ubuntu 22.04 or Oracle Linux 8
- Domain optional (stream goes via Twitch RTMP, no inbound needed)

---

## 1. Provision Instance

Oracle Cloud Console → Compute → Instances → Create:
- Shape: VM.Standard.A1.Flex · 4 OCPU · 24GB RAM
- Image: Canonical Ubuntu 22.04
- Network: default VCN, public subnet, assign public IP
- SSH key: paste your public key

**Security List:** add ingress rules only if you need external access to `/status` or `/metrics` — otherwise all ports stay internal.

---

## 2. First Login & System Prep

```bash
ssh ubuntu@<YOUR-IP>
sudo apt-get update && sudo apt-get upgrade -y

# Core packages
sudo apt-get install -y \
  xvfb x11-utils \
  chromium-browser \
  ffmpeg \
  mpv \
  pulseaudio \
  curl git build-essential \
  sqlite3

# Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version   # should be v20.x
ffmpeg -version  # should show 4.x or 5.x

# Create app user (don't run stream as root)
sudo useradd -m -s /bin/bash choctotv
sudo su - choctotv
```

---

## 3. PulseAudio (headless audio)

```bash
# As choctotv user — configure PA for headless
mkdir -p ~/.config/pulse
cat > ~/.config/pulse/default.pa << 'PA'
load-module module-native-protocol-unix
load-module module-null-sink sink_name=choctotv_music sink_properties=device.description=ChoctoTVMusic
load-module module-null-sink sink_name=choctotv_stream sink_properties=device.description=ChoctoTVStream
PA

# Start PA as daemon (add to ~/.bashrc or systemd unit)
pulseaudio --start --log-target=syslog
```

---

## 4. Deploy App

```bash
# As choctotv user
cd /home/choctotv
git clone https://github.com/your-repo/choctotv choctotv
cd choctotv

# Install dependencies
npm install

# Verify better-sqlite3 compiled correctly
node -e "require('better-sqlite3')(':memory:')" && echo "SQLite OK"
# If it fails: npm rebuild better-sqlite3
```

---

## 5. Configure Secrets

```bash
# Generate a fresh secret file from template
./start.sh resetenv

# Fill in values interactively (prompts for each line)
./start.sh verifyenv
```

Required values:

| Key | Where to get it |
|---|---|
| `TWITCH_CHANNEL` | Your channel name (lowercase, no #) |
| `TWITCH_BOT_USERNAME` | Bot account username |
| `TWITCH_CLIENT_ID` | [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) — create an app, set redirect URI to `http://localhost` |
| `TWITCH_STREAM_KEY` | dashboard.twitch.tv → Settings → Stream |
| `HELIUS_API_KEY` | [helius.xyz](https://helius.xyz) — free tier |

**OAuth is auto-managed** — no `TWITCH_OAUTH_TOKEN` needed in the secret file.
On first run (or after `./start.sh updatescopes`), the app prints:

```
╔══════════════════════════════════════════════════════════╗
║  1. Go to:  https://www.twitch.tv/activate               ║
║  2. Enter:  ABC123                                       ║
║  3. Log in as your BROADCASTER account and approve.      ║
╚══════════════════════════════════════════════════════════╝
```

Visit the URL, enter the code, and the app continues automatically.
Token is saved to `vault/data/oauth.json` and auto-refreshed.

If using cashout, also drop `teller.json`:
```json
{
  "cashout": { "url":"https://your-tipbot/api/cashout", "method":"POST", "headers":{"Authorization":"Bearer TOKEN"} },
  "vcode":   { "url":"https://your-tipbot/api/verify",  "method":"POST", "headers":{"Authorization":"Bearer TOKEN"} }
}
```

---

## 6. Run Data Migration (if upgrading from v2)

```bash
node scripts/migrate.js /path/to/old/vault/data
# Verify:
sqlite3 vault/data/choctotv.db ".tables"
sqlite3 vault/data/choctotv.db "SELECT COUNT(*) FROM balances;"
```

---

## 7. Test Launch

```bash
./start.sh

# Verify in another terminal:
./start.sh status
curl localhost:3000/health
```

Expected startup sequence:
1. `pupcore (pid XXXX)` ← NFT verification service
2. `teller (pid XXXX)` ← cashout service  
3. `app (pid XXXX)` ← game engine (processes Secret file)
4. `music (pid XXXX)` ← music player
5. `stream (pid XXXX)` ← Xvfb → Chrome → FFmpeg → Twitch

Session log at `logs/sessions/YYYY-MM-DD_HH-MM-SS.log`

---

## 8. Keep Running (systemd)

```bash
sudo nano /etc/systemd/system/choctotv.service
```

```ini
[Unit]
Description=ChoctoTV Stream
After=network.target

[Service]
Type=forking
User=choctotv
WorkingDirectory=/home/choctotv/choctotv
ExecStart=/home/choctotv/choctotv/start.sh
ExecStop=/home/choctotv/choctotv/start.sh stop
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable choctotv
sudo systemctl start choctotv
```

---

## 9. Monitoring

```bash
# Quick health
curl localhost:3000/health

# Prometheus metrics
curl localhost:3000/metrics

# Live monitor (CPU/RAM/services)
./start.sh monitor

# Recent logs
./start.sh session latest
tail -f logs/app.log | npx pino-pretty
```

---

## 10. Maintenance

| Task | Command | Frequency |
|---|---|---|
| Check status | `./start.sh status` | Daily |
| Update code | `./start.sh update` | As needed |
| Edit config | `./start.sh verifyenv` | When changing settings |
| Fresh config | `./start.sh resetenv` | New install |
| Reload economy | `!hotfix` in chat | After editing rewardsEcon.txt |
| Mod restart | `!hotfix` as mod | When errors spike |
| Refresh OAuth | `./start.sh updatescopes` | When adding new Twitch features |
| DB backup | `sqlite3 vault/data/choctotv.db ".backup /tmp/backup.db"` | Weekly cron |

**Nightly backup cron:**
```bash
crontab -e
# Add:
0 3 * * * sqlite3 /home/choctotv/choctotv/vault/data/choctotv.db ".backup /home/choctotv/backups/choctotv_$(date +\%Y\%m\%d).db"
```

---

## 11. Performance Tuning (Oracle Cloud ARM)

The stream is CPU-only (no GPU on free tier). x264 settings are already optimized in `stream.js` for Oracle ARM:
- `bframes=0 ref=1` — low complexity encode
- `rc-lookahead=0` — no lookahead (saves CPU)
- Thread budget: `CPU_CORES - 1` (max 4 for FFmpeg)

If CPU spikes during heavy chat:
1. Reduce stream FPS: set `STREAM_FPS=30` in Secret file, re-drop, `!hotfix`
2. Reduce bitrate: `STREAM_BITRATE=3000k`
3. Reduce weather particles: already 25% reduced from default

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `better-sqlite3` compile error | Wrong Node version | `npm rebuild better-sqlite3` or `npm install better-sqlite3@latest` |
| `.env` line errors | System env vars in `.env` | Safe `load_env` already handles this |
| `Invalid NICK` | Bad OAuth token | Re-generate at twitchapps.com/tmi |
| Stream not going live | Wrong stream key | Check TWITCH_STREAM_KEY in Secret |
| No audio | PulseAudio sink missing | Restart with `./start.sh stop && ./start.sh` |
| Overlay blank | Chrome can't load localhost:3000 | Check `app.js` is running: `curl localhost:3000/health` |
| Classifieds empty | Magic Eden API unavailable | Normal — shows "loading" until data available |

