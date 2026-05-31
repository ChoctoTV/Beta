# ChoctoTV — System Pipeline & Flowcharts

## Startup Pipeline

```
./start.sh
  │
  ├─ First run? (.bootstrapped missing)
  │     └─ ./firststart.sh
  │           ├─ npm install (with --legacy-peer-deps fallback)
  │           ├─ unzip vault.zip
  │           │     ├─ assets/ → assets/sprites/
  │           │     ├─ music/  → assets/music/
  │           │     └─ vault/  → assets/vault/
  │           ├─ Parse secret.txt → assets/vault/.env
  │           ├─ Create data/, data/db/, data/logs/
  │           └─ Touch .bootstrapped flag
  │
  ├─ load_secret() → parse secret.txt / testzone.txt → export env vars
  ├─ load_env()    → source assets/vault/.env
  ├─ ensure_clean() → kill stale processes, free ports 3000-3003
  │
  ├─ launch pupcore  (port 3002) → NFT ownership verifier
  ├─ launch teller   (port 3003) → Cashout audit server
  ├─ launch app      (port 3000+3001) → Game engine
  ├─ launch music    → PulseAudio music player
  └─ launch stream   → Xvfb + Chrome + FFmpeg

src/app.js startup (inside launch):
  ├─ load_secret() → dotenv from assets/vault/.env
  ├─ require('./core/Paths') → create data dirs if missing
  ├─ require('./db') → open SQLite, run all migrations
  ├─ require all modules (core, economy, services)
  ├─ load commands from src/commands/
  ├─ start HTTP server on :3000
  ├─ start WebSocket server on :3001
  ├─ connect to Twitch IRC via tmi.js
  └─ chat.on('ready'):
        ├─ patch Broadcast.broadcast (add intercept for XP, morale, stats)
        ├─ restore lurk sessions from DB
        ├─ start periodic intervals (hourly payout, morale, ad checks)
        └─ after 5s: broadcast initial state to overlay
```

## Chat Command Pipeline

```
Twitch chat message received
    │
    ▼ core/Chat.js._onMessage()
    │
    ├─ Is it a follow-gated game command? Check Twitch follow status
    ├─ Check command cooldown (_cd Map, per-user per-command)
    ├─ Set cooldown timestamp BEFORE execute() (so cooldown fires even if error)
    ├─ Build ctx = makeCtx({ userId, user, args, isMod, isSub, ... })
    │     ctx includes: say, broadcast, db, Balance, Inventory, PupCore,
    │                   Lurk, SpriteManager, Lottery, Duty, loader, ...
    └─ await command.execute(ctx)

Game command (e.g. toss.execute):
    ├─ If not lurk tick: clear lurk session (Lurk.remove)
    ├─ pc = PupCore.getCachedState(userId) ← NFT state
    ├─ sprite = SpriteManager.pickRandom() ← random pup sprite
    ├─ effRarity = pupXP.getEffectiveRarity(db, userId, PupCore, sprite.rarity)
    │   └─ counts NFTs at same level → dynamic rarity
    ├─ _pcChance = { legendary:2%, epic:5%, rare:12%, common:25% }[effRarity]
    ├─ usePC = pc has favPup image AND random() < _pcChance
    ├─ calcReward(game, cfg, { usePC, rarity: usePC ? effRarity : sprite.rarity })
    │   └─ base × rarityMult × favpupBonus × modBonus × activeScale × lurkMult
    ├─ Balance.add(userId, amount)
    ├─ say(response from GameResponses)
    └─ broadcast({ type:'game', command:'toss', reward, rarity, pcImageURL, ... })
```

## WebSocket Broadcast Pipeline

```
Any Broadcast.broadcast(msg) call
    │
    ▼ Patched intercept (app.js, inside chat.on('ready'))
    │
    ├─ try {
    │   ├─ chest_lick → update MoraleState.foodBowl, re-broadcast bowl_update
    │   ├─ game → MoraleState.recordPlay, push to _rewardHistory
    │   │         XP award (pupXP) — fully isolated try/catch
    │   └─ lurk_update → sync active_players panel
    │   } catch {} ← nothing can prevent _origBc from running
    │
    └─ _origBc(msg) ← ALWAYS FIRES, guaranteed
         └─ JSON.stringify → send to all WS clients with readyState=OPEN
```

## Overlay Render Pipeline

```
Chrome loads http://localhost:3000
    │
    ▼ overlay/renderer.js.boot()
    ├─ loadAssets() → fetch /assets/sprites/sprites_meta.json
    │                  precache all pup images into memory Map
    ├─ loadModule('yard')          ← sequential, scene visible first
    └─ Promise.all([               ← all others parallel
          loadModule('priceTicker'),
          loadModule('queueDisplay'),
          loadModule('moraleMeter'),
          loadModule('classifieds'),
          loadModule('chestGame'),
          loadModule('musicToast'),
          loadModule('choctoCalendar'),
          loadModule('puppyWars'),
          loadModule('settings'),
          loadModule('streaming'),
       ])
       connectWS()                ← WS connects AFTER modules ready

WebSocket message received:
    ├─ System events (lurk_update, settings, weather) → dispatch immediately
    └─ Gameplay events (game, bowl_update, ...) → delay by BUFFER_MS (stream delay)
         └─ EventBus.emit('event:' + msg.type, msg)
              └─ yard.js._onGame(msg) / moraleMeter / queueDisplay / etc.
```

## Price Ticker Pipeline

```
overlay/modules/priceTicker/priceTicker.js.init()
    │
    ├─ Load coin list from /coins endpoint
    ├─ fetchAll() → Promise.allSettled([
    │     _fetchCG(cg coins)        ← CoinGecko prices
    │     _fetchDex(each coin)      ← Dexscreener prices  
    │     _fetchSolBinance()        ← SOL/USD via /sol-price proxy (avoids CORS)
    │     _fetchLotto()             ← Lottery data (cached in localStorage)
    │     _fetchAnnouncements()     ← Current announcements
    │     _fetchRewardStats()       ← 8hr reward avg + top earner
    │  ])
    ├─ _buildContent()
    │     fingerprint = [coinPrices, SOL, lurkers, urgents, ann, rewards].join(';')
    │     if fingerprint unchanged → skip rebuild (no DOM thrash)
    │     else → build HTML segment + segment (doubled for seamless scroll)
    │     contentW = inner.scrollWidth / 2
    └─ _startScroll() → requestAnimationFrame loop

Events that trigger rebuild:
    - EventBus 'event:lurk_update' → 2s debounce → _buildContent()
    - EventBus 'event:coins_update' → update coin list → fetchAll()
    - setInterval(fetchAll, REFRESH_MS)  ← periodic refresh
```

## NFT XP Pipeline

```
game event broadcast arrives in app.js intercept
    │
    ├─ PupCore.getCachedState(userId) → { favPupMint, ... }
    ├─ calcXP(hasFavPup, isSub)
    │     hasFavPup=true, isSub=false → 2 XP
    │     hasFavPup=true, isSub=true  → 3 XP (ceil(2×1.25))
    │     hasFavPup=false             → 1 XP (or 2 XP for subs)
    │
    ├─ NFT ladder (if favPupMint set):
    │     addXP(db, mint, amount)
    │     if levelUp → nftLevel × userLevel Choctobits → chat announcement
    │
    └─ User ladder (always):
          addUserXP(db, userId, amount)
          if levelUp → 100 × userLevel Choctobits → chat announcement

Hourly passive (setInterval 1hr):
    for each user_id in user_xp where xp > 0:
        payout = userLevel + nftLevel
        Balance.add(user_id, payout)

Lurk XP (every 10 minutes while lurking):
    addXP(db, mint, 1)        ← NFT ladder
    addUserXP(db, userId, 1)  ← User ladder
```

## Cashout Pipeline

```
!cashout
    │
    ├─ !cashout test → dry run only, no tipbot call
    │
    └─ live mode:
          ├─ Teller.sendCashout({ user, user_id, amount })
          │     POST → TIPBOT_WEBHOOK_URL (from env)
          │     timeout: 30s
          ├─ HTTP 200 → Balance.subtract(userId, spent)
          │             chat "✅ X Choctopus sent!"
          └─ non-200 → chat "❌ rejected — balance unchanged"

teller.js (port 3003):
    ├─ POST /confirm  ← tipbot calls this after successful payout
    ├─ POST /cashout  ← legacy webhook logging
    └─ GET /payouts   ← admin: full cashout history
```
