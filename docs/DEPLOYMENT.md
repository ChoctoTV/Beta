# ChoctoTV — Deployment Guide

## Prerequisites

- **Oracle Cloud VM** (or any Ubuntu 24 server with 4+ cores, 8GB RAM recommended)
- Node.js 20+, FFmpeg, Xvfb, Chromium, PulseAudio, mpv, taskset (util-linux)
- Twitch account (channel + bot account, or same account)
- Helius API key (for NFT verification)
- Optional: teller.js SOL wallet for cashouts

---

## First-Time Setup

```bash
# 1. Clone / unzip the project
cd /home/choctotv && unzip ChoctoTVv3-131.zip -d choctotv_fresh
cd choctotv_fresh

# 2. Install dependencies
npm install --production

# 3. Create your Secret file
cp Secret.template.txt "Secret(live).txt"
# Edit Secret(live).txt with your credentials

# 4. Run setup
./start.sh setup

# 5. First start
./start.sh start
```

---

## Secret File Format

`Secret(live).txt` or `Secret(beta).txt` (beta uses the `rydersbnc` test channel).

```ini
# ── Twitch ───────────────────────────────────────────────────────────────────
TWITCH_CHANNEL=yourchannel
TWITCH_BOT_USERNAME=yourbotaccount
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
# TWITCH_OAUTH_TOKEN=oauth:... ← optional manual token; auto-managed via OAuth

# ── Helius (NFT verification) ──────────────────────────────────────────────
HELIUS_API_KEY=your_helius_key

# ── Stream quality (controlled by !480/!720/!1080 commands) ───────────────
# DO NOT set STREAM_QUALITY here — use the chat commands instead.
# Quality is persisted in vault/data/quality.txt

# ── Optional: teller (SOL cashouts) ───────────────────────────────────────
# TELLER_ENDPOINT=...
# TELLER_SECRET=...
```

> **Never commit** `Secret(live).txt` — it goes into `vault/` after first load and is archived there.

---

## Stream Quality

Quality is **not** read from the Secret file. It is controlled via:
- Chat commands `!480` / `!720` / `!1080` (streamer only)
- Or manually: `echo -n "480p" > vault/data/quality.txt && ./start.sh restart`
- Default: `480p` (854×480 @ 1500k, 30fps)

| Preset | Resolution | Bitrate | Notes |
|---|---|---|---|
| 480p | 854×480 | 1500k | Default — phone-friendly |
| 720p | 1280×720 | 3500k | PC quality |
| 1080p | 1920×1080 | 6000k | Requires strong CPU / NVENC |

Twitch viewer quality dropdown (480p / 360p / etc.) requires **Twitch transcoding** — available to Partners always, Affiliates sometimes. Sending 720p source with proper keyframe interval lets Twitch auto-generate lower options when transcoding is active.

---

## Audio Chain

```
mpv (music player)
  └── PulseAudio sink: choctotv_music (44.1kHz stereo)
        └── Monitor source: choctotv_music.monitor
              └── FFmpeg -f pulse -i choctotv_music.monitor
                    └── AAC 96k @ 44.1kHz → Twitch RTMP
```

- **Music on:** mpv spawns, pinned to last CPU core (`taskset`)
- **Music off:** mpv fully killed (not paused) — frees core completely
- **Stutter issue?** A stale PulseAudio sink from a previous session can cause issues. Full `./start.sh kill` then `start` resolves it.
- **Check music.log** for `[Music][mpv]` errors if music doesn't play

---

## CPU Pinning

When `taskset` is available and 3+ cores are present:
- **Cores 0..N-2** → FFmpeg + Chrome (render cores)
- **Core N-1** → mpv (music, isolated so it can't starve renderer)

Falls back gracefully on single/dual-core or without taskset.

---

## Process Management

```bash
./start.sh start      # ensure_clean + start all 5 services
./start.sh stop       # graceful stop all
./start.sh restart    # stop + clean + start
./start.sh kill       # force-kill everything (including stray mpv/Xvfb)
./start.sh status     # show running services
./start.sh monitor    # tail all logs live
./start.sh session    # show tmux session (if in one)
./start.sh verifyenv  # dump loaded environment variables
./start.sh verifytoken # validate OAuth token with Twitch API
./start.sh updatescopes # re-run device flow to get new scopes
./start.sh rollback   # restore previous build
./start.sh deploy     # deploy + bump build counter
```

`ensure_clean()` kills: node processes, Chrome, FFmpeg, Xvfb, mpv, removes Xvfb locks, frees ports 3000-3003.

---

## OAuth Scopes

The following scopes are requested:
- `chat:read` `chat:edit`
- `channel:read:redemptions` `channel:manage:redemptions`
- `channel:read:subscriptions` `channel:read:vips`
- `moderator:read:chatters`
- `channel:read:ads`
- `user:read:email`

Run `./start.sh updatescopes` to re-authorize if scopes change.

---

## Database

SQLite at `./choctotv.db`. Migrations in `db/migrations/`:
- `001_initial` — core tables
- `002_persistence` — lurk_sessions, sprite_bonuses, app_state, mint_names

---

## Vault Directory

`vault/` holds all persistent runtime data and is never committed:
```
vault/
├── data/
│   ├── quality.txt      # Current stream quality preset
│   ├── oauth.json       # Stored OAuth tokens (auto-managed)
│   ├── favpups.json     # User fav pup registrations
│   ├── wallets.json     # User wallet registrations
│   └── nobg/            # Cached bg-removed NFT PNGs (<num>_nobg.png)
└── (archived Secret files)
```

---

## Adding a New Overlay Module

1. Create `yardpets3/modules/<name>/<name>.js` (ES module, export default object with `async init({mount, EventBus})`)
2. Add a mount div to `yardpets3/index.html` with appropriate z-index
3. Add `loadModule('<name>', '<name>-mount', './modules/<name>/<name>.js')` to `renderer.js`
4. Subscribe to events via `EventBus.on('event:<type>', handler)` in `init()`

---

## Adding a New Command

1. Create `commands/<name>.js`:
```javascript
'use strict';
module.exports = {
  name: 'cmdname',
  aliases: ['alias1'],         // optional
  permissions: 'viewer',       // viewer | mod | streamer | dev
  cooldown: 30,                // seconds (false = no cooldown)
  async execute(ctx) {
    const { user, say, broadcast, Balance, Lurk, PupCore, Config } = ctx;
    say(`Hello @${user}!`);
    return { ok: true };
  },
};
```
2. `CommandLoader` picks it up automatically — no registration needed.

---

## Debugging Tips

| Issue | Check |
|---|---|
| Commands not working | `./start.sh verifytoken` — check OAuth. `./start.sh monitor` — look for errors |
| Music not playing | `cat /tmp/choctotv_music_state.json` — check state. `tail -f music.log` — look for `[Music][mpv]` errors |
| Stream shows wrong quality | `cat vault/data/quality.txt` — check value. Look for `━━━ STREAM OUTPUT:` line in stream.log |
| Billboard/overlay not loading | Check Chrome launch in stream.log. Xvfb may have failed |
| Reboot after !480 not working | Check `/tmp/choctotv_reboot.log` — the setsid restart script logs here |
| NFT images not showing | Check app.log for `/nftimg` proxy errors. Verify Helius API key |

