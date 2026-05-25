# ChoctoTV — Command Reference

All commands work **with or without the `!` prefix** — `walk`, `!walk`, `feed`, `!feed` are all equivalent.

## Permission Levels
| Level | Who |
|---|---|
| `viewer` | Anyone in chat |
| `mod` | Mods + streamer + dev |
| `streamer` | Streamer account only |

---

## 🎮 Game Commands (viewer)

| Command | Cooldown | Description |
|---|---|---|
| `!toss` | per-game | Toss your fav pup — earns ChoctoBits |
| `!throw` | per-game | Throw your fav pup across the yard |
| `!dig` | per-game | Dig for buried loot |
| `!walk` | per-game | Send your fav pup on a perimeter walk |
| `!fish` | per-game | Fish in the pond — may catch another user's fav pup |
| `!gauntlet` | per-game | 1v1 gauntlet battle |
| `!battle` | per-game | Multi-player battle royale |
| `!lick` | 8s | Lick the peanut butter jar — sends a random pup sprite to run to the jar and lick it. Lick power based on rarity: common=1, uncommon=1, rare=2, epic=3, legendary=4. When licks reach zero the lid flies off |

> **Fav pup** — set via `!setfav`. Your NFT appears bg-removed in game animations. Cached at `vault/data/nobg/<num>_nobg.png` for instant reuse.

---

## 🥜 Peanut Butter Jar — Lick Game
- Jar is **always visible** on screen to the right of the morale meter
- **"👅 Lick Me!"** tag hangs below the jar
- Each `!lick`: a random pup **runs to the jar**, licks it (jar wiggles), runs back
- Lick count is **random** (no counter shown) and **persists through reboots**
- When it opens: lid pops off, 🥜🍫 shower, chat announces top lickers + payout
- Lick queue ensures pups animate **one at a time** (no collisions)
- Rarity scales pup size: legendary pups are 25% larger than commons

---

## 🌙 Lurk (viewer)

| Command | Description |
|---|---|
| `!lurk` | Enter lurk mode. Removes you from the **active players** list. One lurker action fires every 5 seconds from a global queue, cycling through all 5 games in shuffled order |

Lurk is cancelled when you use any game command (you move back to active players list).

---

## 🥣 Bowl Commands (viewer, 3-min cooldown)

| Command | Aliases | Effect |
|---|---|---|
| `!feed` | `!feedpups` | Food bowl +10%. If lurking → +5🍫 to all lurkers. If active → +5🍫 to all active players |
| `!water` | `!waterpups` | Water bowl +10%. Same payout logic |

**Bowl drain (every 5 min):** water -= active player count %; food -= lurker count %

**Bowl effect on morale bonus:** `finalBonus = baseBonus × (food + water) / 200`

---

## 💰 Economy Commands (viewer)

| Command | Cooldown | Description |
|---|---|---|
| `!balance` | — | Check your ChoctoBit balance |
| `!inv` | 10s | Show balance + inventory + fav pup status. Also triggered by: `inventory`, `wallet` |
| `!top` | — | Leaderboard — top ChoctoBit holders |
| `!cashout` | — | Request SOL cashout (queued via teller.js) |
| `!vend <item> [n\|all]` | 5s | Sell sticks/balls/moons for ChoctoBits. `!vend all` sells everything |
| `!forgeballs [all]` | — | Convert sticks → balls (100 sticks per ball) |
| `!forgemoons [all]` | — | Convert balls → moons (100 balls per moon) |
| `!gbm <Good\|Ball\|Moon>` | — | Set your GBM prediction |
| `!gbmreveal` | — | Reveal GBM result |

**Vend rates** (from config):
- 🪵 Sticks: 1🍫 each
- 🎾 Balls: 50🍫 each
- 🌙 Moons: 200🍫 each

**`!vend` examples:**
```
!vend sticks 100     → sell 100 sticks for 100🍫
!vend balls all      → sell all balls
!vend all sticks     → same as above (both orderings work)
!vend all            → sell EVERYTHING (sticks + balls + moons)
!vend                → show rates and your current stock
```

---

## 🔮 NFT / Fav Pup (viewer)

| Command | Description |
|---|---|
| `!setfav <mint>` | Set fav pup NFT by mint address (requires `!setwallet` first) |
| `!setwallet <addr>` | Link your Solana wallet |
| `!checkfav` | Display your fav pup card (spotlight popup) |
| `!namepup <name>` | Give your fav pup a custom display name |
| `!vcode` | Get verification code for wallet linking |

---

## 📢 Utility (viewer)

| Command | Cooldown | Description |
|---|---|---|
| `!queues` | 10s | Show the queue bar for 30 seconds (center screen, horizontal) |

---

## 🛠 Mod Commands

| Command | Description |
|---|---|
| `!airdrop <amount>` | Drop ChoctoBits to all active viewers |
| `!song` | Display current playing song in chat |
| `!announce <text>` | Add a ticker announcement |
| `!lastannounce` | Show most recent announcement |
| `!classifieds` | Force refresh classifieds data |
| `!wanted <user>` | Add to wanted list |
| `!onduty` | Toggle mod on-duty status |
| `!roles` | Show role configuration |
| `!mod <user>` | Grant/revoke mod status |
| `!addscroll <url>` | Add scroll site to ticker |
| `!removescroll <url>` | Remove scroll site |
| `!scrollsites` | List scroll sites |
| `!read` | Read scroll sites list |

---

## ⚙️ Streamer Commands

| Command | Aliases | Description |
|---|---|---|
| `!480` | `!quality 480` | Switch to 480p and clean reboot (~20s) |
| `!720` | `!quality 720` | Switch to 720p and clean reboot |
| `!1080` | `!quality 1080` | Switch to 1080p and clean reboot |
| `!import @user bits,sticks,balls,moons` | — | Add inventory from Firebot import |
| `!purge all` | — | Reset all balances + inventory to zero (waits for cashout queue to empty first) |
| `!addcoin <sym>` | — | Add coin to price ticker |
| `!addcollection` | — | Add NFT collection to classifieds |
| `!inject` | — | Inject test event |

**Quality switch flow:**
1. CommandGate pauses — no new game commands
2. Chat: "🔧 Commands paused — queues clearing"
3. 15 second drain wait
4. Chat: "♻️ Rebooting now"
5. `setsid` script: `start.sh restart` in new process session
6. 5s startup warmup, then chat: "✅ ChoctoTV online — commands active!"

**`!purge all` flow:**
1. Check cashout queue — if empty, purge immediately
2. If pending cashouts: announce and poll every 5s
3. When cashout queue empties: auto-execute purge
4. Resets: all balances, all inventory, chest progress, lottery, GBM picks, lurk sessions, gauntlet scores
5. Preserves: wallets, NFT fav pups, config, roles, scroll sites, collections

**`!import` format:**
```
!import @RydersBnC 1230,322,14,4
→ adds: 1230🍫 + 322🪵 + 14🎾 + 4🌙
→ replies with new totals
```

