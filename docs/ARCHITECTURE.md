# ChoctoTV — System Architecture

## Overview

ChoctoTV is a headless 24/7 Twitch stream overlay. Viewers interact via Twitch chat; the overlay renders live animations, economy data, and NFT pup interactions in a browser captured by FFmpeg.

---

## Directory Structure

```
choctotv_fresh/
├── src/                    ← Game engine (Node.js server-side)
│   ├── app.js              ← MAIN ENTRY — HTTP + WebSocket + Twitch chat + economy
│   ├── commands/           ← One file per chat command (40+ commands)
│   ├── core/               ← Framework: Chat, Broadcast, Config, Paths, etc.
│   ├── db/                 ← Database layer (better-sqlite3)
│   │   ├── index.js        ← Opens DB, runs migrations
│   │   ├── migrations/     ← Schema migrations (run once, in order)
│   │   ├── Balance.js      ← Choctobit balance model
│   │   ├── Inventory.js    ← Item inventory model
│   │   └── Roles.js        ← User role model
│   ├── economy/            ← Economy modules
│   │   ├── calcReward.js   ← Per-game reward calculator
│   │   ├── lurk.js         ← Lurk session manager
│   │   ├── pupXP.js        ← NFT + User XP ladders
│   │   ├── dynamicRewards.js ← Pool-based reward scaling
│   │   ├── lottery.js      ← Lottery system
│   │   ├── gbm.js          ← Gauntlet/Battle mode
│   │   ├── duty.js         ← Mod on-duty bonuses
│   │   └── activity.js     ← Viewer activity tracking
│   ├── services/           ← External API integrations
│   │   ├── PupCoreClient.js ← NFT ownership verifier client
│   │   ├── Teller.js       ← Cashout webhook dispatcher
│   │   ├── OAuthManager.js ← Twitch OAuth token refresh
│   │   ├── TwitchAPI.js    ← Helix API calls
│   │   ├── ChannelPoints.js ← Channel point redemptions
│   │   ├── CircuitBreaker.js ← HTTP request circuit breaker
│   │   └── ChoctoCalendarHelper.js ← Howliday calendar
│   ├── observability/      ← Logging + metrics
│   └── scripts/            ← Dev/admin scripts
├── overlay/                ← Browser overlay (HTML/JS, served as static)
│   ├── index.html          ← Mount points for all UI modules
│   ├── renderer.js         ← Boot: asset load, WS connect, module init
│   ├── config.js           ← Overlay configuration (ports, layout, asset paths)
│   └── modules/
│       ├── yard/           ← Main scene: pups, sky, fence, animations
│       ├── priceTicker/    ← Scrolling ticker (prices, lurkers, commands)
│       ├── queueDisplay/   ← Active players + lurker panels
│       ├── classifieds/    ← Classified ads + !checkfav popup card
│       ├── moraleMeter/    ← Food/water/morale bar
│       ├── chestGame/      ← Peanut butter jar click game
│       ├── musicToast/     ← "Now playing" toast
│       ├── choctoCalendar/ ← Howliday calendar
│       ├── puppyWars/      ← Battle animations
│       ├── settings/       ← Streamer settings UI
│       └── streaming/      ← Stream status overlay
├── assets/                 ← Runtime assets (populated by firststart.sh)
│   ├── vault/              ← Secrets: teller.json, nobg/ cache
│   ├── music/              ← Audio tracks (.mp3, .wav, .flac, .ogg, .m4a)
│   ├── sprites/            ← Pup sprite PNGs + sprites_meta.json
│   └── billboard/          ← Billboard images (main/, ads/, review/)
├── config/                 ← App configuration (read-only)
│   ├── economy.txt         ← Game economy settings (rewards, multipliers)
│   ├── ticker.txt          ← Custom ticker commands shown in price ticker
│   └── announcements.txt   ← Queued announcements
├── data/                   ← Runtime data (writable, not in git)
│   ├── db/                 ← SQLite databases + cashout log
│   └── logs/               ← App logs + session logs
│       └── sessions/       ← Per-session log files
├── docs/                   ← This documentation
├── pupcore.js              ← NFT verifier service (port 3002)
├── teller.js               ← Cashout audit server (port 3003)
├── music.js                ← Music player (PulseAudio)
├── stream.js               ← Xvfb + Chrome + FFmpeg encoder
├── start.sh                ← Service manager (start/stop/status/reload)
├── firststart.sh           ← One-time bootstrap (npm install, vault unzip, env)
└── package.json
```

---

## Service Map

| Service    | File          | Port | Role |
|------------|---------------|------|------|
| Game engine | src/app.js   | 3000 (HTTP) + 3001 (WS) | All game logic, economy, Twitch chat |
| NFT verifier | pupcore.js  | 3002 | Solana NFT ownership checks via Helius |
| Cashout audit | teller.js  | 3003 | Logs cashout confirmations from tipbot |
| Music player | music.js    | —    | Plays audio through PulseAudio |
| Stream encoder | stream.js | —    | Xvfb virtual display + Chrome + FFmpeg |

---

## Complete Event Pipeline

```
Twitch Chat
    │ viewer types "!toss"
    ▼
core/Chat.js
    │ parse command, check permissions + cooldown
    │ build ctx = { userId, user, say, broadcast, db, Balance, ... }
    ▼
commands/toss.js.execute(ctx)
    │ pick random sprite, compute rarity
    │ calcReward() → amount
    │ Balance.add() → new balance
    │ say("@user: Choco tossed the stick! ...")
    │ broadcast({ type:'game', command:'toss', reward, rarity, pcImageURL, ... })
    ▼
core/Broadcast.js (patched intercept in app.js)
    │ ① update MoraleState.actionCount
    │ ② record active player (MoraleState.recordPlay)
    │ ③ push to _rewardHistory (for ticker stats)
    │ ④ award XP (pupXP.addXP, pupXP.addUserXP) — isolated try/catch
    │ _origBc(msg) → ALWAYS fires, even if ① ② ③ ④ fail
    ▼
WebSocket server (port 3001)
    │ JSON.stringify + send to all connected clients
    ▼
Chrome overlay (overlay/renderer.js)
    │ receive WS message
    │ delay by BUFFER_MS (stream delay, default 3000ms)
    │ EventBus.emit('event:game', msg)
    ▼
overlay/modules/yard/yard.js
    │ _onGame(msg) → route to _doToss / _doThrow / etc.
    │ _resolveHeroImages() → load sprite/NFT image
    │ animate: projectile physics, pup movement, popup card
    ▼
Canvas render loop (60fps rAF)
    └── FFmpeg captures Xvfb display → Twitch RTMP stream
```

---

## Economy Flow

```
Player action → calcReward(game, cfg, opts)
    opts.rarity   → rarityMult (common 1×, rare 2×, epic 3×, legendary 5×)
    opts.usePC    → favpup bonus (+25%)
    opts.favGame  → fav game bonus (+10%)
    opts.isSub    → subscriber bonus (+25% XP)
    opts.modOnDuty → mod bonus
    → amount (Choctobits)

Balance.add(userId, amount)
    → UPDATE balances SET amount += ?

!cashout → Teller.sendCashout() → TIPBOT_WEBHOOK_URL (external)
    → Balance.subtract(userId, spent) only on HTTP 200 from tipbot
```

---

## NFT (Pup) XP System

Two separate XP ladders per user:

| Ladder | Key | Scale | Lvl 99 target |
|--------|-----|-------|--------------|
| NFT ladder | mint address | K=9,125 | ~6 months casual (25 actions/day) |
| User ladder | userId | K=876,000 | ~5 years @ 8hr/day |

**XP per action:** base pup = 1 XP, fav NFT = 2 XP, subscriber = +25% (ceil)

**Dynamic rarity:** based on how many other NFTs share the same level:
- 1–2 NFTs at level → Legendary (5× rewards, 2% appearance chance)
- 3–5 → Epic (3×, 5%)
- 6–15 → Rare (2×, 12%)
- 16+ → Common (1×, 25%)

**Hourly passive:** `userLevel + nftLevel` Choctobits to all users with any XP.

---

## Overlay Module Lifecycle

```javascript
// renderer.js boot sequence
await loadAssets()          // sprite metadata + precache all images
await loadModule('yard')    // sequential — scene visible immediately
await Promise.all([         // all other modules in parallel
  loadModule('priceTicker'),
  loadModule('queueDisplay'),
  loadModule('moraleMeter'),
  // ... etc
])
connectWS()                 // start WebSocket after modules ready
```

Each module exports `{ init({ mount, EventBus, CONFIG, ...spriteHelpers }) }`.
The module attaches its DOM to `mount` and subscribes to EventBus events.

---

## Hot Reload (No Restart Required)

```bash
./start.sh reload           # hot-reload all game commands
./start.sh reload teller    # restart just the cashout service
```

Via chat (dev only): `!reload`

Via HTTP (localhost only): `POST http://localhost:3000/admin/reload`

---

## Player Data Persistence

All player data (balances, inventory, XP, wallets, NFT links, roles) lives in `data/db/choctotv.db`.

### Backup schedule
| Trigger | Action |
|---|---|
| App startup | Immediate backup to `vault/persistence/` + vault.zip regenerated |
| Every 10 minutes | Backup + vault.zip regenerated |
| SIGTERM / SIGINT | Backup + vault.zip regenerated, then process exits |

### Protected data
- `vault/persistence/choctotv.db` — full DB backup (balances, XP, inventory, wallets, NFTs)
- `vault/persistence/cashouts.json` — cashout history
- `vault/persistence/last_backup.txt` — timestamp of last successful backup

### Survival across updates and rebuilds
```
Deploy update → unzip overwrites src/ but NOT vault/ (gitignored)
                └── vault/persistence/choctotv.db still intact

firststart.sh runs:
  1. npm install (no data change)
  2. Detects data/db/choctotv.db missing
  3. Restores from vault/persistence/choctotv.db → players keep all data
```

### Commands
```
!persistence          → show last backup time and vault.zip status
!persistence backup   → trigger immediate backup (dev/streamer)
```

### Disaster recovery
If you need to roll back player data:
1. Stop the app (`./start.sh stop`)
2. Delete `data/db/choctotv.db`
3. Copy `vault/persistence/choctotv.db` to `data/db/choctotv.db`
4. Start the app (`./start.sh`)
