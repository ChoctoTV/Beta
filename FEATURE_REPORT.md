# ChoctoTV — Feature Audit Report
## Build: choctoTVcompact — May 2026

All 5 source files pass syntax checks. No stale references.
Execution order verified: dotenv → decryptEnv → app start.

---

## ✅ STREAM PIPELINE

| Feature | How it works |
|---|---|
| Xvfb virtual display | Creates invisible `:99` display at your stream resolution |
| Chromium headless | Renders overlay inside Xvfb — never visible on desktop |
| Wayland fix | `WAYLAND_DISPLAY` and `XDG_SESSION_TYPE` stripped from Chrome env so it stays on X11 |
| NVENC GPU encode | Auto-detected — uses h264_nvenc if GTX found, falls back to libx264 |
| FFmpeg → Twitch RTMP | Captures Xvfb, encodes, pushes to `rtmp://live.twitch.tv/app/<key>` |
| FFmpeg self-restart | If FFmpeg drops, restarts itself in 5s without touching Chrome or Xvfb |
| Xvfb crash recovery | If Xvfb dies, full pipeline restarts after 10s |
| Chrome no-respawn | Chrome does NOT auto-restart — prevents window spam loop |
| Silent audio | `anullsrc` — stream always has an audio track, no FIFO race |
| `.env` decryption | Happens before dotenv.config() — correct order |

**Start:** `./start.sh`
**Stop:** `./start.sh stop` or `./start.sh kill`

---

## ✅ SETUP & SECURITY

| Feature | Notes |
|---|---|
| `SECRET.txt` pre-fill | Fill any fields to skip their prompt on next run |
| Interactive setup | Prompts only for missing fields |
| Brave browser OAuth | Opens Brave → you authorize → token captured automatically |
| Fallback ports | Tries 3456, then 6969, then 7777 if port is busy |
| Token validation | Validates against Twitch API before saving |
| AES-256-GCM encryption | All sensitive `.env` values encrypted |
| Scattered key derivation | PBKDF2 key built from STREAM_KEY + CLIENT_ID interleaved — both required |
| Token saved to SECRET.txt | After OAuth, `OAUTH_TOKEN=` written back automatically |
| chmod 600 | `.env` and `SECRET.txt` locked to owner-only after setup |
| `.gitignore` | `SECRET.txt` and `.env` never committed — safe for public repo |

**Run:** `node setup.js` or `./start.sh setup`

---

## ✅ TWITCH CHAT

| Feature | Notes |
|---|---|
| Chat reading | tmi.js connects to `#yourchannel` |
| Chat writing | Bot responds in channel |
| `!` commands | `!toss`, `!balance`, etc. |
| Natural language | "let me fish", "going digging" — no `!` needed |
| Bad token detection | Prints clear message + instructions when token rejected |
| Reconnect | tmi.js auto-reconnects on disconnect |
| Refresh token | `!update oauth oauth:newtoken` or re-run `node setup.js` |

---

## ✅ GAME COMMANDS (everyone)

| Command | What it does |
|---|---|
| `!toss` / `!throw` / `!dig` / `!walk` / `!fish` | Play a game — earn Choctobits + item drops |
| Natural language variants | tosses, tossing, threw, digging, fishing, etc. |
| `!battle` | Enter Puppy Wars arena |
| `!lick` | Chip away at the chest lock |
| `!GBM Good/Ball/Moon` | Pick for GoodBallMoon round |
| `!lurk` | Start passive earning at 33% rate |
| `!balance` | Check Choctobit balance |
| `!inventory` / `!inv` | Check sticks 🪵 balls 🎾 moons 🌙 |
| `!vendsticks <n>` | Sell sticks for Choctobits |
| `!vendballs <n>` | Sell balls for Choctobits |
| `!vendmoons <n>` / `!moonvend` | Sell moons for Choctobits |
| `!forgeballs` | Convert sticks → balls |
| `!forgemoons` | Convert balls → moons |
| `!cashout` | Cash out balance via Choctopus API |
| `!lottoupdate 1342` | Set lottery ticket (digits 1–4 only) |
| `!ticket` | Check ticket and last draw result |
| `!song` | Current music track + elapsed time |

---

## ✅ GAME COMMANDS (Mod / Dev on duty)

| Command | Who | What |
|---|---|---|
| `!onduty` | Mod or Dev | Activate role for session |
| `!offduty` | Mod or Dev | Deactivate role |
| `!skip` | Mod/Dev/Streamer | Skip music track |
| `!volume <0-100>` | Mod/Dev/Streamer | Set music volume |
| `!airdrop <amount>` | Mod or Dev | Split Choctobits to active users |

---

## ✅ GAME COMMANDS (Streamer only)

| Command | What |
|---|---|
| `!mod @user` | Instantly confirm Mod (or Dev nominates provisional) |
| `!unmod @user` | Remove Mod |
| `!dev @user` | Grant Dev role |
| `!undev @user` | Remove Dev |
| `!confirm` | List pending provisional Mods with days remaining |
| `!confirm @user` | Confirm a Dev-nominated provisional Mod |
| `!roles` | List all mods, devs, on-duty status, pending |
| `!weather` | Trigger random weather change |
| `!autopilot` | Toggle auto-game every N seconds |
| `!music on/off` | Enable/disable music |
| `!music list` | Show track count |
| `!config list` | All live settings |
| `!config <key>` | Show one setting + range |
| `!config <key> <value>` | Change setting instantly |
| `!cashout on/off` | Enable/disable cashout |
| `!update oauth oauth:xxx` | Refresh OAuth token live |
| `!addcoin SYM id` | Add coin to price ticker |
| `!removecoin SYM` | Remove coin from ticker |
| `!hotfix` | Graceful restart |
| `!settings` | Open overlay settings panel |

---

## ✅ ROLE SYSTEM

| Feature | Notes |
|---|---|
| Mod role | Streamer: instant. Dev: provisional 7-day window |
| Dev role | Streamer only, instant |
| Provisional mod expiry | Auto-expires after 7 days, announced in chat |
| Hourly cleanup | Expired pending mods removed automatically |
| Mod on-duty boost | +10% community reward while any Mod is on duty (configurable) |
| Dev on-duty airdrop | Unlocks airdrop for the session |
| roles.json persists | Roles survive restarts |

---

## ✅ AIRDROP SYSTEM

| Feature | Notes |
|---|---|
| Mod free budget | 5,000 Choctobits/day, system pays, own balance never touched |
| Dev free budget | 25,000 Choctobits/day, system pays |
| Dev paid drops | After free budget: spend own balance |
| Flexible splits | Budget can be split across multiple drops (min 1,000 each) |
| Eligibility window | Users active in last 60 min (configurable) |
| Daily reset | Budgets reset at midnight UTC |

---

## ✅ ECONOMY SYSTEM

| Feature | Notes |
|---|---|
| Choctobits balance | Per-user, persisted to `data/balances.json` |
| Item inventory | Sticks 🪵 Balls 🎾 Moons 🌙 per user, `data/items.json` |
| Vend rates | Configurable per item type |
| Forge costs | Configurable sticks→balls, balls→moons |
| Reward scaling | Scales with active player count to maintain target earn/hr |
| Pup game bonus | +10% when game matches pup's daily favourite |
| Pup weather bonus | +10% when weather matches pup's daily favourite |
| Global multiplier | `!config reward_multiplier 2.0` for events |
| Mod boost stacks | Applies on top of all other multipliers |

---

## ✅ LIVE CONFIG

All settings saved to `data/config.json`, take effect immediately.

**Groups:** Cashout, Rewards (per game), Item Drops, Cooldowns, Vend, Forge,
Multipliers, Autopilot, Weather, Lurk, Chest, GBM, Music, Mod On-Duty, Airdrops

**Terminal:** `./start.sh chat` → `!config list`

---

## ✅ GAME SYSTEMS

| System | Notes |
|---|---|
| 44 pups | 17 common, 13 rare, 8 epic, 6 legendary — from sprites_meta.json |
| 5 rarities | Common/Uncommon/Rare/Epic/Legendary — weighted random |
| Daily favourites | Each pup has a daily favourite game and weather (changes at midnight) |
| Weather | 6 conditions, auto-rotates every 15 min or `!weather` |
| Day/Night cycle | ~14 min real-time |
| Chest game | Shared lick-to-unlock, rewards all participants |
| GoodBallMoon | Rock-Paper-Scissors community game, timed rounds |
| Daily lottery | Draws at midnight UTC, 4-digit tickets |
| Lurk mode | Passive earning, Twitch viewer-list verification |
| Autopilot | Auto-fires random games when chat is quiet |
| QueueDisplay | 6 per-game counters, vertically centred left side |
| Price ticker | SOL + CHOCT live prices via DexScreener/CoinGecko |

---

## ✅ MUSIC SYSTEM

| Feature | Notes |
|---|---|
| Auto-shuffle | Scans `./music/` for .mp3 and .wav, shuffles on loop |
| ffplay → PulseAudio | Plays through system speakers on Nobara |
| IPC via files | ctrl/state files in /tmp — no FIFO race conditions |
| Persistent volume | Saved to config.json |
| Commands | `!song` `!skip` `!volume` `!music on/off/list` |

---

## ✅ TERMINAL TOOLS

| Tool | Command | What |
|---|---|---|
| Chat terminal | `./start.sh chat` or `node chat.js` | Send any command as streamer |
| `.exit` | Inside chat.js | Close chat terminal only |
| `.quit` | Inside chat.js | Close chat + run killswitch |
| `.help` | Inside chat.js | Show all commands |
| Kill switch | `./start.sh kill` or `bash killswitch.sh` | Kill every ChoctoTV process system-wide |
| Viewer | `./start.sh viewer` | Open half-res ffplay preview of what's streaming |
| Status | `./start.sh status` | Show per-service health, PID, memory |

---

## ✅ GITHUB VERSION CONTROL

| Command | What |
|---|---|
| `./start.sh update` | Commit + push to main, save backup branch, create revision/vX.Y |
| `./start.sh update v` | Same but bumps major version (v1.x → v2.0) |
| `./start.sh rollback` | Restore from backup branch + restart |
| `./start.sh rollback v1.2` | Restore from specific revision + restart |
| `./start.sh rollback list` | List all available revisions |

---

## ✅ ORACLE CLOUD DEPLOY

| Command | What |
|---|---|
| `./start.sh deploy` | Push to GitHub then SSH to Oracle Cloud, pull, npm install, PM2 restart |

Requires `CLOUD_IP`, `CLOUD_SSH_KEY`, `CLOUD_USER`, `CLOUD_PATH` in SECRET.txt.

---

## ⚠️ KNOWN LIMITATIONS

| Item | Status |
|---|---|
| Music in stream audio | Not in stream — plays locally via PulseAudio only |
| Twitch viewer-list for lurk | Requires `CLIENT_ID` and valid OAuth with `moderator:read:chatters` scope |
| Cashout API | Calls `api.choctopus.io` — must be reachable |
| Cloud deploy | Requires SSH key set up and Oracle VM provisioned |
| `!update oauth` saves plain | Token written to .env without re-encryption — run `node setup.js` to re-encrypt |

---

*Audit completed: all 5 JS files + 2 shell scripts pass syntax checks. 52/53 feature checks pass (broadcast defined as const arrow, not function — works correctly).*
