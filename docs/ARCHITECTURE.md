# ChoctoTV — System Architecture

## Pipeline Overview

```mermaid
flowchart LR
    A([Twitch Chat]) -->|IRC / tmi.js| B[Chat.js]
    B -->|parse + perm check| C[CommandGate]
    C -->|paused?| D{Blocked}
    C -->|open| E[Command execute]
    E -->|Broadcast| F[WebSocket :3001]
    F -->|WS messages| G[renderer.js]
    G -->|event:*| H[Overlay Modules]

    subgraph Stream Pipeline
        I[Xvfb :99] --> J[Chrome --headless]
        J --> K[FFmpeg x11grab]
        K -->|RTMP| L([Twitch Ingest])
    end

    subgraph Audio Pipeline
        M[mpv] --> N[PulseAudio sink\nchoctotv_music]
        N --> K
    end

    G --> I
```

---

## Startup Sequence

```mermaid
sequenceDiagram
    participant SH as start.sh
    participant APP as app.js :3000/:3001
    participant PC as pupcore.js :3002
    participant TL as teller.js :3003
    participant ST as stream.js
    participant MU as music.js
    participant CH as Chrome
    participant TW as Twitch

    SH->>SH: ensure_clean() — kill stale procs
    SH->>APP: node app.js &
    SH->>PC: node pupcore.js &
    SH->>TL: node teller.js &
    SH->>ST: node stream.js &
    SH->>MU: node music.js &

    APP->>APP: Load Secret(live/beta).txt → process.env
    APP->>APP: Init DB migrations
    APP->>APP: CommandGate.pause() — 5s startup hold
    APP->>TW: Chat.connect() (non-blocking)
    TW-->>APP: IRC connected
    APP->>APP: CommandGate.resume() after 5s
    APP->>TW: "✅ ChoctoTV online — commands active!"

    ST->>ST: Xvfb :99 @ 1280×720
    ST->>CH: Launch Chrome (SwiftShader)
    ST->>ST: Wait for overlay to load
    ST->>ST: FFmpeg x11grab → RTMP
    ST-->>TW: Stream live
```

---

## Command Dispatch Flow

```mermaid
flowchart TD
    A[Chat message] --> B{Starts with !?}
    B -- No --> Z([Ignore])
    B -- Yes --> C[CommandLoader lookup]
    C -- Not found --> Z
    C -- Found --> D{Permission check}
    D -- Fail --> E[Silent drop]
    D -- Pass --> F{CommandGate.isPaused?}
    F -- Paused + game cmd --> G[Reply: commands paused]
    F -- Open --> H{Lurk active?}
    H -- Yes + game cmd --> I[Lurk.remove — woke up]
    H --> J[Build ctx object]
    J --> K[mod.execute ctx]
    K --> L[Broadcast to overlay WS]
    L --> M[Overlay renders animation]
```

---

## Economy Flow

```mermaid
flowchart TD
    A[Player uses !toss/!throw/!dig/!walk/!fish] --> B[Balance.add reward]
    B --> C[MoraleState.recordPlay userId]
    C --> D[Broadcast active_players list]

    E[Player uses !lurk] --> F[Lurk.add — join queue]
    F --> G[Global 5s queue fires lurk tick]
    G --> H[Random game animation plays]
    H --> B

    I[Every 10 minutes] --> J{active_players count}
    J --> K[score = clamp AP-lurkers, -10, +10]
    K --> L[base bonus = 100 + score×10]
    L --> M[bowl factor = food+water / 200]
    M --> N[final bonus = base × factor]
    N --> O[Pay everyone active]
    O --> P[Broadcast bonus amount to chat]

    Q[Every 5 minutes] --> R[water -= AP count %]
    Q --> S[food -= lurker count %]
    R --> T[Broadcast bowl_update]
    S --> T

    U[!feed or !water] --> V[Bowl += 10%]
    V --> W{User is lurker?}
    W -- Yes --> X[+5🍫 to all lurkers]
    W -- No --> Y[+5🍫 to all active players]
    V --> Z[Broadcast bowl_filled]
    Z --> AA[Overlay: AP count floats to water bowl\nLurker count floats to food bowl]
```

---

## Overlay Module Z-Index Stack

```
z:3    Sky canvas       — sky gradient, sun/moon arc, stars, clouds (behind billboard)
z:5    Billboard        — rotating background images + dusk/dawn lights
z:10   Yard canvas      — ground, scene, walkers, projectiles, weather particles
z:15   Classifieds      — scrolling newspaper strip (bottom)
z:16   Calendar         — ChoctoCalendar (bottom right)
z:18   Morale bowls     — food + water bowl SVGs (bottom right, in-scene feel)
z:20   Battle           — puppyWars duel/gauntlet popup
z:25   Morale meter     — happiness bar + bonus display (bottom center)
z:30   Ticker           — top scrolling price + announcements strip
z:50   Lurker panel     — right side live lurker list
z:90   Queue bar        — center hidden horizontal queue (shown via !queues)
z:90   Active players   — left side 10-min active player list
z:100  Settings
z:150  Spotlight        — NFT card / fav pup popup
z:200  Float animations — bowl fill number animations
```

---

## WebSocket Message Types (server → overlay)

| type | Payload | Handler |
|---|---|---|
| `game` | `{command, user, userId, reward, balance, drops, favPup, ...}` | yard.js animations |
| `lurk_earn` | `{userId, reward}` | yard.js walker |
| `lurk_update` | `{lurkers:[{userId,display,until}]}` | queueDisplay lurker panel |
| `active_players` | `{players:[{userId,display,hasFav}]}` | queueDisplay active panel |
| `morale_update` | `{score,bonus,activePlayers,lurkers,foodBowl,waterBowl}` | moraleMeter bar |
| `bowl_update` | `{food,water,waterDrain?,foodDrain?}` | moraleMeter bowls |
| `bowl_filled` | `{bowl,activePlayers,lurkers}` | moraleMeter float animation |
| `show_queues` | — | queueDisplay — reveal bar 30s |
| `announcements` | `{announcements:[{text,urgent}]}` | priceTicker |
| `scrollsites` | `{sites:[url]}` | priceTicker |
| `coins_update` | `{coins:[{sym,id,color}]}` | priceTicker |
| `weather` | `{weather}` | yard.js weather system |
| `sky_config` | `{favSky}` | yard.js sky overlay |

---

## Day/Night Cycle

- Full cycle: **15 minutes** (900,000 ms) from `_skyStartMs`
- `cycleP` = `(Date.now() - _skyStartMs) / 900000 % 1` → 0..1
- Sky color interpolates through 8 phases (dawn → midday → dusk → midnight)
- `night` = `0.5 - 0.5 × cos((cycleP - 0.25) × 2π)` — 0 at midday, 1 at midnight
- Sun arcs left→right during cycleP 0..0.5; moon during 0.5..1
- Billboard lights: fade in as night > 0.35, full at night > 0.6, off at dawn
- `chocto:daytime` DOM event dispatched every second from yard._tick

