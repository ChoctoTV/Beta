# ChoctoTV — Viewer Guide 🐾🍫

Welcome to the yard! Here's everything on screen and how to play.

---

## What's on Screen

```
┌─────────────────────────────────────────────────────────────┐
│  PRICE TICKER ← live token prices · announcements · lurkers │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│         YARD  ← pups walk, fetch, dig, fish here           │
│                 weather changes · billboard in back         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  CLASSIFIEDS / BATTLE ARENA ← adoption ads or PvP fights   │
└─────────────────────────────────────────────────────────────┘
```

**Top ticker strip** — scrolls token prices, announcements, and a list of who's currently lurking.

**The yard** — animated pups play games here when viewers type commands. Each pup has a rarity that affects how much they earn for you.

**Bottom panel** — normally shows Choctonaut adoption classifieds. When a battle or gauntlet starts, it becomes the arena.

**Billboard** — background images rotate every 3 minutes.

---

## Currency

**Choctobits 🍫** — earned by playing games. Everything costs or pays in Choctobits.
**Choctopus** — the real token. Convert Choctobits → Choctopus via `!cashout` (requires Discord link).

---

## Earning Choctobits

Type any of these in chat:

| Command | What happens | Notes |
|---|---|---|
| `!walk` | Your pup walks the yard perimeter | Always features your fav pup |
| `!toss` | Throw a stick for your pup | 10% chance fav pup appears |
| `!throw` | Throw a ball for your pup | 10% chance fav pup appears |
| `!dig` | Your pup digs up buried loot | 10% chance fav pup appears |
| `!fish` | Your pup fishes the pond | 1% chance to catch someone else's fav pup (2× reward!) |
| `!lurk` | Auto-play in the background for up to 8h at 33% rate | You keep earning while away |

### Pup Rarities

Your pup affects how much you earn. Rarer = more Choctobits:

| Rarity | Multiplier | How to get one |
|---|---|---|
| Common | **1×** base | Yard pups are random |
| Rare | **2×** base | |
| Epic | **3×** base | |
| Legendary | **5×** base | |

Your fav pup (NFT) adds **+25%** on top of rarity. Playing on its randomly assigned favourite game adds another **+10%**. Matching weather adds another **+10%**. Max combo: **+45% × rarity multiplier**.

There's a very small chance (<1%) your pup comes back empty-pawed — no loot, just muddy paws.

### Natural Language

You don't need `!` — just type naturally:
- *"toss the stick"* → runs `!toss`
- *"let's fish"* → runs `!fish`
- *"I'm going to lurk"* → runs `!lurk`

---

## Checking Your Balance

| Command | What it shows |
|---|---|
| `!balance` or `!inv` | Your 🍫 + sticks 🪵 balls 🎾 moons 🌙 |
| `!top` | Top 5 Choctobit holders |

---

## Fav Pup (NFT holders only)

Link your Choctonaut Army NFT to use it as your yard pup — it appears in animations and earns bonuses.

1. `!setwallet <SolanaAddress>` — link your wallet
2. `!setfav <MintAddress>` — verify and set your NFT
3. `!namepup <name>` — give your pup a custom name (optional)

Your fav pup is automatically assigned a **favourite game** and **favourite weather** each day by the system (you can't set these — they reset at midnight UTC).

---

## Group Games

### Chest (`!lick`)
Everyone licks the chest together. When it pops (random threshold), top lickers share a prize pool. Keep licking!

### GBM — Good / Ball / Moon
```
!gbm Good
!gbm Ball
!gbm Moon
```
Pick one and forget it — your pick stays until you change it. The streamer can reveal results at any time. The game that beats your pick wins!

### Lottery
```
!lottoupdate 1234   ← set your 4-digit ticket (stays forever until changed)
!ticket             ← check your current numbers
```
Daily draw at midnight UTC. Matches by position:
- 1 match = 100🍫 · 2 matches = 500🍫 · 3 matches = 2000🍫 · **4 matches = JACKPOT 10,000🍫**

### Battle / Gauntlet
```
!gauntlet   ← challenge the gauntlet (once per day)
!battle     ← join an active battle queue
```
Your pup represents you in Puppy Wars. Two pups clash in the arena — winner advances.

---

## Cashout (Choctopus tokens)

Convert 1,000🍫 → 1 Choctopus token:

1. **Link Discord first:** run `/twitch_verify` in the Discord server → get a code → type `!vcode <code>` in Twitch chat
2. **Cashout:** `!cashout` — sends your Choctopus to the tipbot. Balance only deducted after confirmed.

---

## Music

```
!song       ← info
```
Community vote — if 3 viewers type *"music off"* or *"music on"* within 10 minutes, it happens. Mods can also `!skip`, `!volume 0-100`.

---

## Other Useful Commands

| Command | What it does |
|---|---|
| `!lastannounce` | Repeats the last ticker announcement |
| `!urgent` | Lists all active urgent announcements |
| `!checkfav <mint>` | Check if you own an NFT before setting it |

---

## Quick Reference

```
EARN:       !walk  !toss  !throw  !dig  !fish  !lurk
CHEST:      !lick
GBM:        !gbm Good / Ball / Moon
LOTTERY:    !lottoupdate 1234
BATTLE:     !gauntlet  !battle
FAV PUP:    !setwallet  !setfav  !namepup
BALANCE:    !balance  !inv  !top
CASHOUT:    !vcode <code>  →  !cashout
MUSIC:      "music on" / "music off"  (community vote)
```
