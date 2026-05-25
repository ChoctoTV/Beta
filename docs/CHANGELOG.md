# ChoctoTV v3 — Changelog

All changes since the v3 architectural refactor. Build numbers correspond to `ChoctoTVv3-N.zip` release files.

---

## Architecture Refactor (Builds 89–103)
- **5-service architecture**: app.js (3000/3001), pupcore.js (3002), teller.js (3003), music.js, stream.js
- **5-file overlay**: yard, billboard, classifieds, priceTicker, puppyWars — all ES modules
- Xvfb :99 → Chrome (SwiftShader) → FFmpeg → Twitch RTMP pipeline established
- Twitch chat economy + command system wired
- Oracle Cloud deployment with start.sh process manager
- SQLite database with migrations 001 (core) and 002 (persistence)

---

## Builds 104–115: Core Fixes & Game Animation
- **104** — Fixed `isLurkTick` ReferenceError in walk/toss/throw/dig commands; lurk system stabilised
- **105** — Unified fav-pup hero resolution: animation and popup always show the same NFT; bg-removed image for animation, full NFT for popup; nametag format `@user (pupname)`
- **106** — Lurker list now includes countdown timers (`until` timestamp)
- **107** — Sky split to two canvases: sky canvas (z:3, behind billboard) for gradient/clouds/stars; main canvas (z:10) for scene + weather; billboard (z:5) now visible against sky
- **108** — Sun/moon arc across full sky width (left→right parabolic arc over 15-min day cycle); all sky/weather/stars on unified `cycleP` clock
- **109** — Stream quality presets (1080p/720p/480p/360p) configurable via `vault/data/quality.txt`; `!480`, `!720`, `!1080` commands for live switching with clean reboot
- **110** — CPU pinning: mpv on last core, FFmpeg+Chrome on render cores
- **111** — Music `off` now fully kills mpv (was pause) — eliminates persistent post-music stutter
- **112** — Audio chain unified at 44.1kHz throughout (mpv → PulseAudio sink → FFmpeg); AAC bitrate 96k
- **113** — Stream quality defaults to 480p (854×480 @ 1500k); quality.txt seeded in deploy
- **114** — Quality startup log shows exact output resolution; env/Secret STREAM_QUALITY no longer read
- **115** — `!480`/`!720`/`!1080` reboot uses `setsid` temp script — immune to stop_all process group kill

---

## Builds 116–125: Economy, Morale & UI Overhaul
- **116** — Lurker global 5s queue: one lurker action every 5 seconds (no simultaneous animations); per-user shuffled action order (each game once per loop before repeat)
- **117** — Sky fades instead of scrolling: 8 color phases interpolated over cycleP (dawn → midday → dusk → midnight); scrolling prerendered canvas removed
- **118** — Billboard always visible (filter:none); 18 coloured bulbs fade in at dusk, off at dawn; `chocto:daytime` DOM event dispatched every second from yard._tick
- **119** — NFT image proxy `/nftimg?url=` in app.js: server-side fetch bypasses CORS on IPFS/NFT gateways; bg removal now works reliably for all NFT images
- **120** — `_nobg.png` caching: bg-removed NFT images saved to `vault/data/nobg/<num>_nobg.png`; subsequent loads instant
- **121** — Fix throw game label showing X coordinate as pupname; all `_mkLbl()` calls audited and corrected
- **122** — Morale system: `score = clamp(AP - lurkers, -10, +10)`; `finalBonus = max(0, 100 + score×10) × bowlFactor`; paid every 10 min to all active players + lurkers
- **122** — Food/water bowls: SVG in-scene (bottom-left → later moved); drain every 5 min (water by AP count%, food by lurker count%); `!feed`/`!water` fill +10% (3-min cooldown/user); +5🍫 to the filler's group
- **122** — Morale meter: gradient bar -10 to +10, bonus display, updates every minute
- **122** — Active players panel (left, permanent): lists players active in last 10 min; ★ next to fav pup owners
- **122** — Lurker panel (right, permanent): live countdown timers; lowered to 45% from top
- **122** — Queue bar (horizontal, center): hidden by default; `!queues` reveals for 30s
- **123** — Calendar fix: `24.42` (day.hour) on one line using flex baseline; month 2× (46px), day 110px
- **123** — Classifieds text 3× increase for all ad text (desc 34px, price 36px, tag/url/pref proportional)
- **124** — `!import @user bits,sticks,balls,moons` — streamer command for Firebot migration imports
- **125** — CommandGate: global command pause/resume; 5s startup warmup; chat announces "commands active"; lurker ticks skip during pause; `!480`/`!720`/`!1080` pause → 15s drain → "rebooting" → restart

---

## Builds 126–135: Bowl System, Jar Game, Layout
- **126** — Food/water bowls moved to bottom-right, side by side; floating number animation on fill (AP count → water bowl, lurker count → food bowl using `mmFloat` keyframe)
- **127** — `!feed`/`!water` fill +10% (was 30%); 3-min cooldown per user (community care mechanic)
- **128** — Queue bar starts hidden; `!queues` only trigger; game events no longer un-hide bar
- **129** — Lurker list to right side fixed panel; active players left fixed panel; both bottom-anchored at grassY (fence line)
- **130** — `!lick` peanut butter jar game: SVG jar with screw lid, rarity-based lick power (common 1 → legendary 4), pups run to jar and lick it; lick queue prevents animation collisions
- **130** — Jar always visible (constant on screen); "👅 Lick Me!" tag below jar with upward arrow; lick count persists through reboots via DB + startup broadcast
- **131** — Classifieds card redesign: photo | desc (word-wrapped, game verb corrected to match favGame) → price left / `!read "#N"` right (same line, flex space-between)
- **132** — Bowls moved to left side (right side = pond area); food right of water on left edge
- **133** — Mutual exclusivity: `!lurk` removes user from active players list; active→lurker is clean transition
- **134** — Bowl positions: bottom:220px (at classifieds edge); panels bottom-anchored at grassY

---

## Builds 136–150: Commands & Quality of Life
- **136** — All commands work **with or without `!` prefix** — Chat.js checks first word against command registry
- **136** — `!inv` / `!inventory` / `!wallet` command: shows ChoctoBit balance + fav pup status + wallet link status
- **137** — `!vend <item> [n|all]` command: sell sticks/balls/moons for ChoctoBits at configured rates; `!vend all` sells entire inventory in one shot; `!sell` alias
- **138** — `!purge all` command (streamer): resets all balances + inventory + game state; **waits for cashout queue to empty** before executing; polls every 5s; auto-announces when triggered

---

## Key Config Values

| Key | Default | Description |
|---|---|---|
| `chest_min_lock` | 50 | Min licks needed to open PB jar |
| `chest_max_lock` | 500 | Max licks needed |
| `vend_sticks_rate` | 1 | ChoctoBits per stick |
| `vend_balls_rate` | 50 | ChoctoBits per ball |
| `vend_moons_rate` | 200 | ChoctoBits per moon |
| `forge_balls_cost` | 100 | Sticks to forge 1 ball |
| `forge_moons_cost` | 100 | Balls to forge 1 moon |
| `ad_airdrop_amount` | 1 | Base bits per ad break |
| `chest_min_lock` | 50 | Min licks |

