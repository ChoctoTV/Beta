# ChoctoTV — Overlay Modules

The overlay runs in headless Chrome at `yardpets3/index.html`. All modules are ES modules loaded by `renderer.js`, communicating via a shared `EventBus`.

---

## Z-Index Stack

```
z:3    Sky canvas       — gradient, sun/moon arc, stars, clouds, fog (behind billboard)
z:5    Billboard        — rotating images + dusk/dawn bulb lights
z:10   Yard canvas      — ground, scene, walkers, projectiles, weather
z:15   Classifieds      — scrolling newspaper strip (bottom)
z:16   Calendar         — ChoctoCalendar (bottom right)
z:18   Morale bowls     — food + water SVG jars (bottom left, in-scene)
z:20   Battle           — puppyWars duel/gauntlet popup
z:21   Lick pups        — running pup sprites (appended to body)
z:22   Chest game       — peanut butter jar (right of morale meter)
z:25   Morale meter     — happiness bar + bonus display (bottom center)
z:30   Ticker           — top scrolling price + announcements
z:50   Lurker panel     — right side, bottom-anchored at grassY
z:90   Queue bar        — center horizontal, hidden; `!queues` reveals 30s
z:90   Active panel     — left side, bottom-anchored at grassY
z:150  Spotlight        — NFT card / fav pup popup
z:200  Float animations — bowl fill number animations
```

---

## Modules

### yard.js — The Game World
Two canvases:
- **Sky canvas (z:3)** — sky gradient (8 color phases), sun/moon arc, stars, clouds, fog. All behind the billboard.
- **Main canvas (z:10)** — transparent sky region, ground, scene, walkers, weather particles.

**Day/night cycle:** single `cycleP` (0→1 over 15 min) drives sky color, star dimming, AND sun/moon arc. `night = 0.5 - 0.5×cos((cycleP-0.25)×2π)`.

Sun arcs left→right during cycleP 0..0.5; moon during 0.5..1. Both fade at horizon edges.

**`chocto:daytime` DOM event** dispatched every ~1s from `_tick()` — consumed by billboard (lights) and available to any future module.

**NFT image pipeline:** `_loadCachedImg(url)` routes remote URLs through `/nftimg?url=` proxy → same-origin → CORS-safe canvas pixel access → `_removeBgAsync(img, url, num)` → saves `vault/data/nobg/<num>_nobg.png` → future loads instant.

---

### billboard.js — Background Billboard
- Rotates `billboard.png`, `billboard(1-9).png` every 3 minutes
- Main billboard shown every 5 rotations
- **Always `filter:none`** — never dims in weather
- **18 coloured bulbs**: fade in at `night > 0.35`, full brightness at `night > 0.6`, off at dawn
- Each bulb has staggered `animationDelay` for independent twinkle
- Listens to `chocto:daytime` DOM event

---

### classifieds.js — Scrolling Newspaper
Scrapes NFT listings every 5 minutes. Card layout:
```
[PHOTO] │ Cute description (word-wrapped, up to 2 lines, game verb corrected to match favGame)
        │
        │ 1.5 SOL                              !read "#1234"
```
- Name removed (was obscured by larger text)
- NFT number `#1234` in top-right corner as absolute badge
- `!read "#N"` flush right on same line as SOL price
- Game verb in description auto-corrected: if favGame=toss, "loves walking" → "loves 🎯 tossing"

---

### choctoCalendar.js — ChoctoCalendar
- 96 ChoctoHours per Earth day
- Format: `DAY.HOUR` inline (e.g., `24.42`) — flex baseline alignment
- Month 2× size (46px), day.hour combined at 110px
- Page-flip animation on hour change, bottom-right corner

---

### puppyWars.js — Battles
- **Duel (2 fighters):** pups face each other, charge on each attack (`pwChargeR`/`pwChargeL`), defender shakes (`pwHit`+`pwFlash`); loser flies off-screen (`pwFlyR`/`pwFlyL`)
- **Gauntlet:** same crash animation per opponent; opponent flies off when beaten
- **Battle royale (3+ fighters):** HP bar grid

---

### queueDisplay.js — Three Independent Panels

1. **Queue bar** (center, horizontal, z:90) — `🎯🎾⛏️🐾🎣⚔️` with live counts. Hidden by default. `!queues` reveals 30s with 1.5s fade. Game events do NOT reveal it.

2. **Active players panel** (left, fixed, z:90) — players who played any game in last 10 min. `★` = has fav pup set. Updates on every game event. Mutually exclusive with lurker panel — a user appears in only one list.

3. **Lurker panel** (right, fixed, z:50) — live countdown timers. Updates every second. Both panels bottom-anchored at `grassY + 5px` (just above fence line), extending upward into sky region.

---

### moraleMeter.js — Morale System Visual

**Meter bar** (bottom-center, z:25): gradient red→grey→blue, white marker slides to score position. Bonus amount shown below in yellow/green/red.

**Food bowl 🍗** (bottom-left, z:18): `left:16px; bottom:220px` — SVG glass jar, amber PB fill, clip-path animated fill level.

**Water bowl 💧** (bottom-left, z:18): `left:100px; bottom:220px` — same, blue liquid.

**Float animation** on bowl fill: AP count (`👥N`) floats from active panel → water bowl; lurker count (`🌙N`) floats from lurker panel → food bowl.

---

### chestGame.js — Peanut Butter Jar Lick Game

**Always visible** at `fixed; bottom:248px; left:calc(50% + 168px)` — right of the morale meter.

**"👅 Lick Me!" tag** hangs below the jar with an upward-pointing arrow.

**Lick queue** (`_queue[]`, `_processing`, `_paused`):
- Each `chest_lick` event pushed to queue, processed sequentially
- One pup animation at a time — no collisions
- Pauses 3.6s after jar opens for the animation to play, then resumes

**Each lick:**
1. Random pup spawns off-screen (70% from left, 30% from right)
2. Double-rAF transition to jar position (no stuck pups)
3. Lick bob animation when touching jar
4. Jar wiggles (`cgWiggle` keyframe)
5. Pup returns off-screen via reverse transition
6. `onDone()` callback fires → `_processNext()`

**On final lick:** lid pops off (`cgLidPop`), 🥜🍫 shower, lid resets after 3.5s (jar stays visible).

**Rarity scaling:** common 0.75×, uncommon 0.85×, rare 1×, epic 1.1×, legendary 1.25× sprite size.

**Persistence:** `chest` table in SQLite survives reboots. App broadcasts current chest state on startup (5s delay after connect).

---

### priceTicker.js — Top Ticker
Live coin prices + announcements, scrolls continuously. Rebuilds only on content hash change.

---

## `chocto:daytime` Event Contract
```javascript
// Dispatched by yard._tick every ~1 second
window.dispatchEvent(new CustomEvent('chocto:daytime', {
  detail: { cycleP: 0..1, night: 0..1 }
}));
// cycleP: position in 15-min day cycle
// night: 0 = midday, 1 = midnight
```

