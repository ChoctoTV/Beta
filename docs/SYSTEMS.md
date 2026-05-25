# ChoctoTV — System Deep Dives

## CommandGate

```mermaid
stateDiagram-v2
    [*] --> Paused : app.js startup
    Paused --> Open : setTimeout 5s + "✅ commands active"
    Open --> Paused : !480 / !720 / !1080 fired
    Paused --> Open : 15s drain + reboot script + 5s warmup
    note right of Paused
      Game cmds blocked
      Lurker ticks skip
      Streamer cmds pass through
      Viewers told "commands paused"
    end note
```

All commands work **with or without the `!` prefix** — Chat.js strips it if present, then checks the registry.

---

## Lurk System

```mermaid
flowchart TD
    A[!lurk] --> B[Lurk.add — join queue]
    A --> C[MoraleState.plays.delete — leave active list]
    B --> D{Global 5s setInterval}
    D --> E[Shift next user from queue]
    E --> F{CommandGate open?}
    F -- Paused --> G[Skip this tick]
    F -- Open --> H[Pick next game from shuffled list]
    H --> I[Execute game → earn bits]
    I --> J[Re-add to back of global queue]
    J --> D

    K[User plays game command] --> L[Chat.js cancels lurk]
    L --> M[MoraleState.recordPlay — joins active list]
```

**Mutual exclusivity:** a user is either in the active list OR the lurker list, never both.

---

## Lick Queue System

```mermaid
flowchart TD
    A[chest_lick event arrives] --> B[Push to _queue]
    B --> C[_processNext]
    C --> D{_paused or _processing?}
    D -- Yes --> E[Wait]
    D -- No --> F[_processing = true]
    F --> G[Dequeue next event]
    G --> H[_spawnRunner]
    H --> I[Pup runs to jar via CSS transition]
    I --> J[Lick bob animation]
    J --> K[Jar wiggle]
    K --> L{isLast — lock ≤ 0?}
    L -- No --> M[Pup runs back → img.remove]
    M --> N[onDone: _processing=false → _processNext]
    L -- Yes --> O[_openJar animation]
    O --> P[Pup runs back → img.remove]
    P --> Q[onDone: _paused=true]
    Q --> R[setTimeout 3600ms]
    R --> S[_paused=false → _processNext]
```

**Double rAF pattern:** ensures CSS transitions fire correctly.
```javascript
document.body.appendChild(img);       // paint initial position
requestAnimationFrame(() => {          // frame 1: initial position rendered
  requestAnimationFrame(() => {        // frame 2: trigger transition
    img.style.left = arriveX + 'px';  // browser sees genuine position delta
  });
});
```

---

## Morale System

```mermaid
flowchart LR
    subgraph Every Minute
        A[Count AP + Lurkers] --> B[score = clamp AP-L, -10+10]
        B --> C[baseBonus = 100+score×10]
        C --> D[bowlFactor = food+water÷200]
        D --> E[finalBonus = base×factor]
        E --> F[Broadcast morale_update]
    end
    subgraph Every 5 Min
        G[water -= AP%] --> I[Broadcast bowl_update]
        H[food -= Lurker%] --> I
    end
    subgraph Every 10 Min
        J[Calculate finalBonus] --> K{> 0?}
        K -- No --> L[Chat: no bonus]
        K -- Yes --> M[Pay all AP + Lurkers]
        M --> N[Chat announcement]
    end
```

---

## NFT Image Pipeline

```mermaid
flowchart TD
    A[Game fires with favPup.imageUrl] --> B[_loadCachedImg url]
    B --> C{Memory cache?}
    C -- Hit --> Z[Return Image element]
    C -- Miss --> D[Route through /nftimg proxy]
    D --> E[app.js fetches server-side\nipfs:// ar:// normalized\nfollows redirects]
    E --> F[Serve same-origin + CORS headers]
    F --> G[img.onload → cache in _imgCache]
    G --> H[_removeBgAsync img, url, num]
    H --> I{/nobg/num_nobg.png exists?}
    I -- Yes --> J[Load cached PNG — instant]
    I -- No --> K[Corner flood-fill bg removal]
    K --> L[POST /savenobg → vault/data/nobg/]
    K --> Z
    J --> Z
```

---

## Stream Quality Switch

```mermaid
sequenceDiagram
    participant S as Streamer
    participant A as app.js
    participant QF as quality.txt
    participant SH as setsid script

    S->>A: !480
    A->>QF: write "480p"
    A->>A: CommandGate.pause
    A->>S: "🔧 Commands paused — queues clearing"
    Note over A: await 15s (animations drain)
    A->>S: "♻️ Rebooting now. Back in ~20s."
    Note over A: await 1.5s (message sends)
    A->>SH: spawn setsid /tmp/choctotv_reboot_N.sh
    Note over SH: sleep 5 → start.sh restart
    SH->>A: new app.js starts
    A->>A: CommandGate.pause 5s warmup
    A->>S: "✅ ChoctoTV online — commands active!"
```

---

## Purge Flow

```mermaid
sequenceDiagram
    participant S as Streamer
    participant A as app.js
    participant DB as SQLite
    participant TL as teller.js

    S->>A: !purge all
    A->>DB: SELECT COUNT(*) FROM cashouts
    alt 0 pending
        A->>S: "✅ Cashout queue empty — purging now"
        A->>DB: UPDATE balances SET amount=0
        A->>DB: UPDATE inventory SET sticks=0...
        A->>DB: DELETE game state tables
        A->>S: "🧹 Purge complete — N users reset"
    else pending cashouts
        A->>S: "⏳ N cashouts pending — will auto-purge when clear"
        loop Every 5s
            A->>DB: SELECT COUNT(*) FROM cashouts
            DB-->>A: count
            TL->>DB: process cashouts
            Note over A: when count = 0
            A->>S: "✅ Cashout queue cleared — executing purge"
            A->>DB: UPDATE / DELETE all economy tables
            A->>S: "🧹 Purge complete"
        end
    end
```

---

## Billboard Lights

```mermaid
flowchart LR
    A[yard._tick ~1/sec] --> B[window.dispatchEvent chocto:daytime]
    B --> C[billboard._setNight night]
    C --> D{night > 0.35?}
    D -- No --> E[opacity=0, remove lit class]
    D -- Yes --> F[brightness = min1, night-0.35÷0.25]
    F --> G[18 bulbs: opacity = brightness]
    G --> H[animationDelay = i×0.12s]
    H --> I[bbGlow keyframe pulses drop-shadow]
```

