# ChoctoTV — Developer Documentation

**ChoctoTV** is a headless 24/7 Twitch stream that runs a fully interactive overlay economy game, driven entirely by chat commands. Viewers earn ChoctoBits (🍫) by playing games, lurking, maintaining the pup morale, and community care of virtual food/water bowls.

---

**Current build:** ChoctoTVv3-150

## Quick Start

```bash
# Configure secrets
cp Secret.template.txt Secret(live).txt   # fill in your credentials

# Start everything
./start.sh start

# Useful subcommands
./start.sh stop | restart | status | kill
./start.sh verifyenv      # confirm secrets loaded correctly
./start.sh verifytoken    # validate Twitch OAuth token
./start.sh updatescopes   # re-authorize with device flow
./start.sh monitor        # tail all service logs
```

---

## Repository Layout

```
choctotv_fresh/
├── app.js              # Core HTTP + WS server, command dispatcher, game engine
├── stream.js           # Xvfb → Chrome → FFmpeg → Twitch RTMP pipeline
├── music.js            # mpv persistent audio player → PulseAudio sink
├── teller.js           # Cashout queue service (SOL payouts)
├── pupcore.js          # NFT verification via Helius DAS API
├── start.sh            # Process manager (start/stop/restart all services)
│
├── core/               # Shared Node modules
│   ├── Chat.js             # Twitch IRC connection + command routing
│   ├── CommandGate.js      # Global pause/resume for commands
│   ├── MoraleState.js      # Active player tracking + bowl/bonus state
│   ├── CommandLoader.js    # Dynamically loads commands/ at startup
│   └── Config.js           # Runtime config key-value store
│
├── commands/           # One file = one chat command (work with or without !)
├── economy/            # Balance, lurk, reward calculators
├── services/           # OAuth, channel points, teller client
├── db/                 # SQLite migrations + helpers
├── observability/      # Metrics + structured logging
│
├── yardpets3/          # Browser overlay (ES modules, loaded by Chrome)
│   ├── index.html          # Mount points + z-index layout
│   ├── renderer.js         # Loads all modules, connects WS, routes events
│   ├── config.js           # Overlay layout constants (grassY, pondX, etc.)
│   └── modules/
│       ├── yard/           # Main game canvas (sky, scene, weather, sprites)
│       ├── billboard/      # Rotating background billboard + dusk lights
│       ├── classifieds/    # Scrolling newspaper NFT classifieds
│       ├── choctoCalendar/ # Custom 96-ChoctoHour calendar (bottom right)
│       ├── puppyWars/      # Battle + gauntlet popup animations
│       ├── priceTicker/    # Scrolling top ticker (SOL prices, announcements)
│       ├── queueDisplay/   # Hidden queue bar (center) + active players panel
│       ├── moraleMeter/    # Morale gauge + in-scene food/water bowls
│       ├── settings/       # Browser-side config (window-scoped)
│       └── streaming/      # Stream status HUD
│
└── vault/              # Persistent runtime data (never committed)
    └── data/
        ├── quality.txt     # Current stream quality (480p/720p/1080p)
        ├── nobg/           # Cached background-removed NFT PNGs
        └── oauth.json      # Stored OAuth tokens
```

---

## Service Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for flowcharts.

| Service | Port | Role |
|---|---|---|
| app.js | 3000 (HTTP), 3001 (WS) | Game engine, commands, overlay state |
| pupcore.js | 3002 | NFT verification + fav pup state |
| teller.js | 3003 | SOL cashout queue (optional) |
| music.js | — | mpv → PulseAudio (controlled by ctrl file) |
| stream.js | — | Xvfb :99 → Chrome → FFmpeg → Twitch |

