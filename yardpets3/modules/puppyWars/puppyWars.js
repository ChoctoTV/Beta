// YardPets3 — modules/puppyWars/puppyWars.js
// Battle Royal: up to 20 fighters, each gets a unique pup for the whole fight.
// Overflow users are held in nextQueue for the next battle automatically.

const MAX_FIGHTERS  = 20;
const ROUND_DELAY   = 900;
const MULTI_WAIT    = 30000;  // 30s after 2nd player joins
const GAUNTLET_WAIT       = 300000; // 5 min auto-start if alone
const GAUNTLET_SHORT_WAIT = 10000;  // 10s when player explicitly requests !gauntlet
const SHOW_DELAY    = 4500;
const GAUNTLET_COINS = 50;    // Choctobits per gauntlet win
const API_PORT      = 3000;

const STATS = {
  common:   { hp:100, dmin:8,  dmax:22 },
  uncommon: { hp:130, dmin:10, dmax:28 },
  rare:     { hp:160, dmin:14, dmax:36 },
  epic:     { hp:210, dmin:20, dmax:50 },
  legendary:{ hp:300, dmin:30, dmax:75 },
};
const RCOL = { common:'#aaa',uncommon:'#2ecc71',rare:'#3498db',epic:'#9b59b6',legendary:'#f39c12' };
const st     = r => STATS[(r||'common').toLowerCase()] || STATS.common;
const rCol   = r => RCOL[(r||'common').toLowerCase()] || '#aaa';
const hpPct  = f => Math.max(0, Math.round((f.hp / f.max) * 100));
const hpCol  = p => p > 50 ? '#2ecc71' : p > 25 ? '#f39c12' : '#e74c3c';
const delay  = ms => new Promise(r => setTimeout(r, ms));

const PuppyWars = {
  mount:null, EventBus:null,
  getSprites:null, getSpriteByPupId:null, getImageForSprite:null,
  container:null, arenaEl:null,
  queue:[], nextQueue:[], battle:null, startTimer:null, _used:new Set(), _leaderboard:[], _gauntletShort:false,
  _countdownTimer:null, _countdownEnd:0,

  async init({ mount, EventBus, getSprites, getSpriteByPupId, getImageForSprite }) {
    Object.assign(this, { mount, EventBus, getSprites, getSpriteByPupId, getImageForSprite });
    this._buildDOM();
    EventBus.on('event:battle',           m => this._enqueue(m));
    EventBus.on('event:gauntlet_request',  m => this._enqueueGauntlet(m));
    EventBus.on('event:gauntlet_leaderboard', m => { this._leaderboard = m.leaderboard; if (!this.battle && !this.queue.length) this._renderLeaderboard(); });
    // Load leaderboard on init
    fetch(`http://localhost:${API_PORT}/gauntlet/leaderboard`)
      .then(r=>r.json()).then(lb=>{ this._leaderboard=lb; this._renderLeaderboard(); }).catch(()=>{});
  },

  _buildDOM() {
    this.mount.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    if (!document.getElementById('pw-css')) {
      const s = document.createElement('style'); s.id = 'pw-css';
      s.textContent = `
        @keyframes pwIn  {from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
        @keyframes pwOut {to{opacity:0;transform:translateY(20px)}}
        .pw-bar{transition:width .4s ease,background .4s;}
        /* ── Duel (1v1) crash animation ── */
        @keyframes pwChargeR{0%{transform:translateX(0)}45%{transform:translateX(220px) rotate(8deg)}55%{transform:translateX(200px)}100%{transform:translateX(0)}}
        @keyframes pwChargeL{0%{transform:translateX(0) scaleX(-1)}45%{transform:translateX(-220px) rotate(-8deg) scaleX(-1)}55%{transform:translateX(-200px) scaleX(-1)}100%{transform:translateX(0) scaleX(-1)}}
        @keyframes pwHit{0%,100%{transform:translateX(0)}20%{transform:translateX(14px)}40%{transform:translateX(-10px)}60%{transform:translateX(7px)}80%{transform:translateX(-4px)}}
        @keyframes pwFlash{0%,100%{filter:none}30%{filter:brightness(2.2) sepia(1) hue-rotate(-25deg) saturate(6)}}
        @keyframes pwFlyR{0%{transform:translateX(0) rotate(0);opacity:1}100%{transform:translateX(1400px) rotate(900deg);opacity:0}}
        @keyframes pwFlyL{0%{transform:translateX(0) rotate(0) scaleX(-1);opacity:1}100%{transform:translateX(-1400px) rotate(-900deg) scaleX(-1);opacity:0}}
        .pw-duelist{position:absolute;bottom:30px;width:150px;height:150px;transition:none;}
        .pw-duelist.left{left:18%;}
        .pw-duelist.right{right:18%;}
        .pw-duelist img{width:100%;height:100%;object-fit:contain;image-rendering:auto;}
        .pw-charge-r{animation:pwChargeR .8s ease-in-out;}
        .pw-charge-l{animation:pwChargeL .8s ease-in-out;}
        .pw-hit{animation:pwHit .5s ease, pwFlash .5s ease;}
        .pw-fly-r{animation:pwFlyR 1s cubic-bezier(.4,0,.9,.5) forwards;}
        .pw-fly-l{animation:pwFlyL 1s cubic-bezier(.4,0,.9,.5) forwards;}
        .pw-duel-hp{position:absolute;top:-22px;left:50%;transform:translateX(-50%);width:140px;height:12px;background:rgba(0,0,0,.6);border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,.25);}
        .pw-duel-name{position:absolute;top:-40px;left:50%;transform:translateX(-50%);font-size:14px;font-weight:800;color:#fff;white-space:nowrap;text-shadow:0 1px 3px #000;}
        .pw-vs{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);font-size:44px;font-weight:900;color:#f39c12;text-shadow:0 2px 8px #000;z-index:5;}
      `;
      document.head.appendChild(s);
    }
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:220px;background:rgba(0,0,0,.9);border-top:2px solid rgba(255,255,255,.14);overflow:hidden;';
    this.arenaEl = document.createElement('div');
    this.arenaEl.style.cssText = 'height:100%;display:none;';
    this.container.appendChild(this.arenaEl);

    this.arenaEl = document.createElement('div');
    this.arenaEl.style.cssText = 'height:100%;display:none;';
    this.container.appendChild(this.arenaEl);

    // Idle panel — NFT Adoption Classifieds from Magic Eden
    // Replaces the previous iframe scroll panel. Shows 3 Choctonaut NFTs at a time
    // as a "pet adoption" feed. Data fetched from /classifieds endpoint.
    this.idleEl = document.createElement('div');
    this.idleEl.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#f2ead8;display:flex;flex-direction:column;justify-content:flex-end;';
    this.idleEl.style.contain = 'strict';
    this.idleEl.innerHTML = '';
    const npWrap = document.createElement('div');
    npWrap.className = 'np-wrap';
    npWrap.innerHTML = `
      <div class="np-banner">
        <span class="np-title">The Choctonaut Chronicle</span>
        <span class="np-rule">★ Adoption Classifieds ★ Pups Seeking Good Homes ★</span>
        <span class="np-date" id="__npDate"></span>
      </div>
      <div class="np-track"><div class="np-inner" id="__npInner"></div></div>
    `;
    this.idleEl.appendChild(npWrap);
    // Live date in header
    const npDate = npWrap.querySelector('#__npDate');
    if (npDate) npDate.textContent = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});

    this.mount.appendChild(this.container);
    // Start in idle/classifieds mode — battle takes over when one starts
    this._setActive(false);
  },

  // Switch container between idle (web scroll) and active (battle/queue/leaderboard)
  _setActive(active) {
    this.arenaEl.style.display = active ? 'block' : 'none';
    // Show/hide the whole battle-mount panel
    this.mount.style.display  = active ? 'block' : 'none';
  },

  _enqueue(msg) {
    const { user } = msg;
    if (this.queue.find(e=>e.user===user)) return;
    if (this.battle?.fighters.some(f=>f.user===user)) return;
    if (this.nextQueue.find(e=>e.user===user)) return;

    if (this.battle) { this.nextQueue.push(msg); return; }

    this.queue.push(msg);

    if (this.queue.length >= MAX_FIGHTERS) {
      if (this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null; }
      this._stopCountdown();
      this._startBattle();
    } else if (this.queue.length === 2 && !this.startTimer) {
      if (this.startTimer) clearTimeout(this.startTimer);
      this._startCountdown(MULTI_WAIT);
      this.startTimer = setTimeout(() => {
        this.startTimer = null; this._stopCountdown();
        if (this.queue.length >= 2) this._startBattle();
        else this._startGauntlet(this.queue[0]);
      }, MULTI_WAIT);
    } else if (this.queue.length === 1 && !this.startTimer) {
      this._startCountdown(GAUNTLET_WAIT);
      this.startTimer = setTimeout(() => {
        this.startTimer = null; this._stopCountdown();
        if (this.queue.length >= 2) this._startBattle();
        else if (this.queue.length === 1) this._startGauntlet(this.queue.shift());
      }, GAUNTLET_WAIT);
    }
    // Render lobby AFTER timers are set — a render error cannot block the timer
    try { this._renderLobby(); } catch(e) { console.error('[PuppyWars] lobby render:', e); }
  },

  _enqueueGauntlet(msg) {
    // Viewer !battle can supercede — if 2+ join during the 1min wait, runs battle royal instead
    this._gauntletShort = true;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.queue = this.queue.filter(e => e.user !== msg.user);
    this.queue.unshift(msg); // gauntlet requester goes first
    this._renderLobby();
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      if (this.queue.length >= 2) this._startBattle();
      else if (this.queue.length === 1) { this._gauntletShort = false; this._startGauntlet(this.queue.shift()); }
    }, GAUNTLET_SHORT_WAIT);
  },

  _renderLeaderboard() {
    if (this.battle || this.queue.length || !this._leaderboard?.length) return;
    this._setActive(true);
    this.container.style.animation = '';
    const medals = ['🥇','🥈','🥉'];
    this.arenaEl.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:8px 20px;gap:6px;font-family:'Segoe UI',system-ui,sans-serif;color:#fff;">
        <div style="font-size:16px;font-weight:900;color:#f39c12;letter-spacing:1px;flex-shrink:0;">⚔️ GAUNTLET LEADERBOARD — use !gauntlet to challenge</div>
        <div id="lb-scroll" style="flex:1;overflow:hidden;position:relative;">
          <div id="lb-inner" style="display:flex;gap:12px;position:absolute;white-space:nowrap;">
            ${this._leaderboard.map((e,i)=>`
              <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.06);border-radius:8px;padding:6px 14px;flex-shrink:0;">
                <span style="font-size:20px;">${medals[i]||`#${i+1}`}</span>
                <div>
                  <div style="font-size:14px;font-weight:800;">@${e.user}</div>
                  <div style="font-size:12px;color:#aaa;">${e.wins}/${e.total} pups · ${e.runs} run${e.runs!==1?'s':''}</div>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
    // Scroll the leaderboard
    const inner = this.arenaEl.querySelector('#lb-inner');
    if (inner) {
      inner.style.animation = 'none';
      const w = inner.scrollWidth;
      inner.style.cssText += `;animation:lbScroll ${Math.max(10,w/60)}s linear infinite;`;
      if (!document.getElementById('lb-scroll-css')) {
        const s = document.createElement('style'); s.id = 'lb-scroll-css';
        s.textContent = `@keyframes lbScroll{0%{left:0}100%{left:-${w}px}}`;
        document.head.appendChild(s);
      }
    }
  },

  _startCountdown(ms) {
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    this._countdownEnd = Date.now() + ms;
    this._countdownTimer = setInterval(() => {
      if (!this.queue.length || this.battle) { clearInterval(this._countdownTimer); this._countdownTimer = null; return; }
      this._updateLobby();
    }, 500);
  },

  _stopCountdown() {
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
    this._countdownEnd = 0;
  },

  _renderLobby() {
    this._setActive(true);
    this.container.style.animation = 'pwIn .35s ease both';
    this._updateLobby();
  },

  _updateLobby() {
    const isGauntlet  = this._gauntletShort && this.queue.length === 1;
    const secsLeft    = this._countdownEnd ? Math.max(0, Math.ceil((this._countdownEnd - Date.now()) / 1000)) : 0;
    const pct         = this._countdownEnd
      ? Math.max(0, Math.min(100, ((this._countdownEnd - Date.now()) /
          (isGauntlet ? GAUNTLET_SHORT_WAIT : this.queue.length >= 2 ? MULTI_WAIT : GAUNTLET_WAIT)) * 100))
      : 100;
    const barCol      = secsLeft <= 10 ? '#e74c3c' : secsLeft <= 30 ? '#f39c12' : '#2ecc71';

    const title = isGauntlet
      ? '⚔️ GAUNTLET MODE'
      : '⚔️ PUPPY WARS — BATTLE ROYAL';

    const subtitle = isGauntlet
      ? `@${this.queue[0]?.user} vs ALL pups — viewers can !battle to start a battle royal instead`
      : `Use <span style="color:#3498db;font-weight:900;">!battle</span> to join — ${this.queue.length}/${MAX_FIGHTERS} fighters`;

    // Fighter list — up to 20 cards in a grid
    const cols = Math.min(this.queue.length, 10);
    const fighterCards = this.queue.map((e, i) => `
      <div style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);
        border-radius:8px;padding:5px 14px;font-size:15px;font-weight:800;
        color:#fff;animation:pwIn .3s ease ${i*.04}s both;white-space:nowrap;">
        <span style="color:#f39c12;font-size:12px;margin-right:4px;">#${i+1}</span>@${e.user}
      </div>`).join('');

    this.arenaEl.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:8px 20px;gap:6px;
        font-family:'Segoe UI',system-ui,sans-serif;color:#fff;">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
          <div style="font-size:18px;font-weight:900;color:#f39c12;letter-spacing:1px;">${title}</div>
          <div style="font-size:13px;color:#aaa;">${subtitle}</div>
          <!-- Countdown -->
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;">
            <div style="font-size:28px;font-weight:900;color:${barCol};font-variant-numeric:tabular-nums;
              line-height:1;${secsLeft<=5?'animation:pwIn .1s ease infinite alternate;':''}">
              ${secsLeft}s
            </div>
            <div style="font-size:10px;color:#555;">until start</div>
          </div>
        </div>

        <!-- Countdown bar -->
        <div style="background:rgba(255,255,255,.07);border-radius:4px;height:6px;overflow:hidden;flex-shrink:0;">
          <div style="width:${pct}%;height:100%;background:${barCol};border-radius:3px;
            transition:width .5s linear,background .5s;"></div>
        </div>

        <!-- Fighter list -->
        <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;gap:4px;">
          ${this.queue.length === 0
            ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:15px;">Waiting for fighters...</div>`
            : `<div style="display:flex;flex-wrap:wrap;gap:5px;align-content:flex-start;overflow:hidden;">
                ${fighterCards}
               </div>`}
        </div>

      </div>`;
  },

  _pickUniquePup() {
    const all  = this.getSprites ? this.getSprites() : [];
    if (!all.length) return null;
    const pool = all.filter(s => !this._used.has(s.name));
    const pick = pool.length ? pool[Math.floor(Math.random()*pool.length)] : all[Math.floor(Math.random()*all.length)];
    if (pick) this._used.add(pick.name);
    return pick;
  },

  async _startBattle() {
    if (this.battle) return;
    this._stopCountdown();
    this._used.clear();
    const entries  = this.queue.splice(0, MAX_FIGHTERS);
    const fighters = await Promise.all(entries.map(async e => {
      const sprite = this._pickUniquePup();
      const rarity = (sprite?.rarity || 'common').toLowerCase();
      const base   = st(rarity);
      const img    = sprite && this.getImageForSprite ? await this.getImageForSprite(sprite) : null;
      return { user:e.user, sprite, rarity, img, hp:base.hp, max:base.hp, alive:true, attacking:false };
    }));
    this.battle = { fighters, round:0, log:[], isGauntlet:false, _duelBuilt:false };
    this._setActive(true);
    this.container.style.animation = 'pwIn .35s ease both';
    this._render();
    await delay(1500);
    await this._runRounds();
  },

  async _runRounds() {
    const b = this.battle;
    while (true) {
      const alive = b.fighters.filter(f => f.alive);
      if (alive.length <= 1) break;

      const ai   = Math.floor(Math.random() * alive.length);
      let   di   = Math.floor(Math.random() * (alive.length - 1));
      if (di >= ai) di++;
      const atk  = alive[ai], def = alive[di];
      const s    = st(atk.rarity);
      const dmg  = Math.floor(Math.random() * (s.dmax - s.dmin + 1)) + s.dmin;
      const crit = dmg >= s.dmax * 0.9;
      def.hp     = Math.max(0, def.hp - dmg);
      atk.attacking = true;
      b._lastAtk = atk; b._lastDef = def;  // for duel crash animation

      if (def.hp <= 0) {
        def.alive = false;
        b.log.push(crit ? `💥 @${atk.user} CRITS @${def.user} <b>${dmg}</b>dmg — ELIMINATED!`
                        : `⚔️ @${atk.user} hits @${def.user} for <b>${dmg}</b> — OUT!`);
      } else {
        b.log.push(crit ? `💥 @${atk.user} CRITS @${def.user} for <b>${dmg}</b>!`
                        : `⚔️ @${atk.user} hits @${def.user} for <b>${dmg}</b>`);
      }
      if (b.log.length > 5) b.log.shift();
      b.round++;
      this._render();
      await delay(ROUND_DELAY);
      atk.attacking = false;
    }

    const alive  = b.fighters.filter(f => f.alive);
    const winner = alive[0] || null;
    if (winner) b.log = [`🏆 @${winner.user} & ${winner.sprite?.name||'their pup'} win Puppy Wars!`];
    this._render();
    await delay(SHOW_DELAY);

    this.container.style.animation = 'pwOut .4s ease forwards';
    await delay(400);
    this._setActive(false);
    this.container.style.animation = '';
    this.battle = null; this._used.clear();

    // Start next battle with overflow
    if (this.nextQueue.length >= 2) {
      this.queue = [...this.nextQueue]; this.nextQueue = [];
      await delay(800);
      this._startBattle();
    } else if (this.nextQueue.length === 1) {
      this.queue = [...this.nextQueue]; this.nextQueue = [];
    }
  },

  // ── Gauntlet mode — solo player vs every pup ─────────────────────────────
  async _startGauntlet(entry) {
    if (this.battle) return;
    this._stopCountdown();
    this._used.clear();

    // Assign player their pup
    const playerSprite = this._pickUniquePup();
    const playerRarity = (playerSprite?.rarity || 'common').toLowerCase();
    const playerBase   = st(playerRarity);
    const playerImg    = playerSprite && this.getImageForSprite ? await this.getImageForSprite(playerSprite) : null;
    const player = {
      user:   entry.user,
      sprite: playerSprite,
      rarity: playerRarity,
      img:    playerImg,
      hp:     playerBase.hp,
      max:    playerBase.hp,
      alive:  true,
    };

    // Build opponent pool with difficulty ramping:
    //   Round 1-2:  guaranteed common (warm-up, never a round 1 loss)
    //   Round 3-4:  common + uncommon
    //   Round 5-6:  uncommon + rare
    //   Round 7-8:  rare + epic
    //   Round 9+:   epic + legendary (true endgame)
    // Players should clear 3-5 rounds on average.
    const all = this.getSprites ? this.getSprites() : [];
    const byRarity = { common:[], uncommon:[], rare:[], epic:[], legendary:[] };
    for (const s of all) {
      if (s.name === playerSprite?.name) continue;
      const r = (s.rarity || 'common').toLowerCase();
      if (byRarity[r]) byRarity[r].push(s);
    }
    const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);

    // Build a difficulty-tiered queue. Each tier has 2 rounds.
    const ladder = [
      ...shuffle(byRarity.common).slice(0, 2),                                   // 1-2: common only
      ...shuffle([...byRarity.common, ...byRarity.uncommon]).slice(0, 2),        // 3-4: common + uncommon
      ...shuffle([...byRarity.uncommon, ...byRarity.rare]).slice(0, 2),          // 5-6: uncommon + rare
      ...shuffle([...byRarity.rare, ...byRarity.epic]).slice(0, 2),              // 7-8: rare + epic
      ...shuffle([...byRarity.epic, ...byRarity.legendary]),                     // 9+:  epic + legendary, all remaining
    ];
    // Fill out the rest if any pups left (mostly legendaries that didn't fit)
    const usedNames = new Set(ladder.map(s => s.name));
    const remaining = all.filter(s => s.name !== playerSprite?.name && !usedNames.has(s.name));
    const opponents = [...ladder, ...shuffle(remaining)];

    this.battle = { fighters:[player], round:0, log:[], gauntlet:true, wins:0, total:opponents.length };
    this._setActive(true);
    this.container.style.animation  = 'pwIn .35s ease both';

    let totalWins = 0;

    for (const oppSprite of opponents) {
      if (!this.battle) break; // battle was cancelled

      const oppRarity = (oppSprite.rarity || 'common').toLowerCase();
      const oppBase   = st(oppRarity);
      const oppImg    = this.getImageForSprite ? await this.getImageForSprite(oppSprite) : null;
      const opp = {
        user:   oppSprite.name,
        sprite: oppSprite,
        rarity: oppRarity,
        img:    oppImg,
        hp:     oppBase.hp,
        max:    oppBase.hp,
        alive:  true,
      };

      // Restore player HP before each round
      player.hp    = player.max;
      player.alive = true;
      opp.alive    = true;

      this.battle.fighters  = [player, opp];
      this.battle.currentOpp = oppSprite.name;
      this.battle.wins       = totalWins;
      this.battle.log        = [`⚔️ Round ${totalWins+1}: @${player.user} vs ${oppSprite.name} (${oppRarity})!`];
      this._renderGauntlet();
      await delay(1200);

      // Fight until one dies
      let playerWon = false;
      while (player.hp > 0 && opp.hp > 0) {
        // Player attacks first each round (gauntlet is solo mode, slight advantage)
        const ps  = st(player.rarity);
        const pd  = Math.floor(Math.random()*(ps.dmax-ps.dmin+1))+ps.dmin;
        opp.hp    = Math.max(0, opp.hp - pd);
        this.battle.log = [`⚔️ @${player.user} hits ${opp.user} for ${pd}!`];
        this.battle._gAtk = 'player';
        if (opp.hp <= 0) { playerWon = true; this._renderGauntlet(); await delay(900); break; }

        // Opponent counter-attacks
        const os  = st(opp.rarity);
        const od  = Math.floor(Math.random()*(os.dmax-os.dmin+1))+os.dmin;
        player.hp = Math.max(0, player.hp - od);
        this.battle.log.push(`${opp.user} hits back for ${od}!`);
        this.battle._gAtk = 'opp';

        this.battle.round++;
        this._renderGauntlet();
        await delay(ROUND_DELAY);
      }

      if (playerWon) {
        totalWins++;
        this.battle.wins = totalWins;
        this.battle.log  = [`✅ @${player.user} beat ${oppSprite.name}! +${GAUNTLET_COINS}🍫 (${totalWins} wins)`];
        this._renderGauntlet();
        // Award Choctobits via API
        this._awardCoins(player.user, GAUNTLET_COINS);
        await delay(800);
      } else {
        this.battle.log = [`💀 @${player.user} was beaten by ${oppSprite.name}! ${totalWins} pups defeated.`];
        this._renderGauntlet();
        await delay(SHOW_DELAY);
        break;
      }
    }

    // Final summary
    if (this.battle) {
      const all_ = totalWins === opponents.length;
      this.battle.log = [all_
        ? `🏆 @${player.user} conquered ALL ${totalWins} pups! Legendary Gauntlet run! +${totalWins * GAUNTLET_COINS}🍫 total`
        : `🏁 @${player.user} finished with ${totalWins}/${opponents.length} wins! +${totalWins * GAUNTLET_COINS}🍫 earned`];
      this._renderGauntlet();
      await delay(SHOW_DELAY);
    }

    this.container.style.animation = 'pwOut .4s ease forwards';
    await delay(400);
    this._setActive(false);
    this.container.style.animation = '';
    this.battle = null; this._used.clear();

    // Report results to app.js for shoutout + leaderboard
    try {
      fetch(`http://localhost:${API_PORT}/gauntlet/record`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user:player.user, wins:totalWins, total:opponents.length }),
      }).then(r=>r.json()).then(d=>{
        if (d.leaderboard) { this._leaderboard = d.leaderboard; }
      }).catch(()=>{});
    } catch {}

    // Start next battle if overflow
    if (this.nextQueue.length >= 2) {
      this.queue = [...this.nextQueue]; this.nextQueue = [];
      await delay(800); this._startBattle();
    } else if (this.nextQueue.length === 1) {
      this.queue = [...this.nextQueue]; this.nextQueue = [];
    }
  },

  _awardCoins(user, amount) {
    try {
      fetch(`http://localhost:${API_PORT}/command`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ command:'addbalance', user:'system', args:[user, String(amount)] }),
      }).catch(()=>{});
    } catch {}
  },

  _renderGauntlet() {
    const b = this.battle; if (!b || !b.gauntlet) return;
    const player = b.fighters[0];
    const opp    = b.fighters[1];
    const pPct   = Math.max(0, Math.round((player.hp/player.max)*100));
    const oPct   = opp ? Math.max(0, Math.round((opp.hp/opp.max)*100)) : 0;
    const sp     = 64;
    const mkCanvas = (f, id) => `
      <canvas id="${id}" width="${sp}" height="${sp}"
        style="image-rendering:pixelated;border-radius:8px;background:rgba(255,255,255,.06);">
      </canvas>`;

    this.arenaEl.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:8px 20px;gap:6px;font-family:'Segoe UI',system-ui,sans-serif;color:#fff;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
          <div style="font-size:16px;font-weight:900;color:#f39c12;letter-spacing:1px;">⚔️ GAUNTLET MODE</div>
          <div style="font-size:14px;color:#aaa;">${b.wins} wins · ${b.total - b.wins} pups remain · +${GAUNTLET_COINS}🍫 per win</div>
        </div>
        <div style="display:flex;align-items:center;gap:20px;flex:1;">
          <!-- Player -->
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px;min-width:140px;">
            ${mkCanvas(player,'gq-player')}
            <div style="font-size:13px;font-weight:800;">@${player.user}</div>
            <div style="font-size:11px;color:${rCol(player.rarity)};">${player.sprite?.name||player.rarity}</div>
            <div style="width:120px;background:rgba(255,255,255,.08);border-radius:4px;height:10px;overflow:hidden;">
              <div class="pw-bar" style="width:${pPct}%;height:100%;background:${hpCol(pPct)};"></div>
            </div>
            <div style="font-size:11px;color:#888;">${player.hp}/${player.max}</div>
          </div>
          <!-- VS + log -->
          <div style="flex:1;text-align:center;">
            <div style="font-size:26px;font-weight:900;color:#e74c3c;margin-bottom:8px;">VS</div>
            <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px 12px;min-height:60px;border:1px solid rgba(255,255,255,.06);">
              ${b.log.map(l=>`<div style="font-size:15px;color:#ccc;line-height:1.8;">${l}</div>`).join('')}
            </div>
            <div style="font-size:12px;color:#555;margin-top:4px;">Round ${b.round}</div>
          </div>
          <!-- Opponent -->
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px;min-width:140px;">
            ${opp ? mkCanvas(opp,'gq-opp') : ''}
            <div style="font-size:13px;font-weight:800;">${opp?.user||'???'}</div>
            <div style="font-size:11px;color:${rCol(opp?.rarity||'common')};">${opp?.rarity||''}</div>
            ${opp ? `<div style="width:120px;background:rgba(255,255,255,.08);border-radius:4px;height:10px;overflow:hidden;">
              <div class="pw-bar" style="width:${oPct}%;height:100%;background:${hpCol(oPct)};"></div>
            </div>
            <div style="font-size:11px;color:#888;">${opp.hp}/${opp.max}</div>` : ''}
          </div>
        </div>
      </div>`;

    requestAnimationFrame(() => {
      const pcv = document.getElementById('gq-player');
      const ocv = document.getElementById('gq-opp');
      if (player.img && pcv) { const ctx=pcv.getContext('2d'); ctx.clearRect(0,0,sp,sp); ctx.drawImage(player.img,0,0,sp,sp); }
      if (opp?.img && ocv) { const ctx=ocv.getContext('2d'); ctx.save(); ctx.translate(sp,0); ctx.scale(-1,1); ctx.drawImage(opp.img,0,0,sp,sp); ctx.restore(); }

      // Crash animation — attacker lunges toward the other, defender shakes
      const atk = b._gAtk;
      if (atk === 'player' && pcv) {
        pcv.style.animation='none'; void pcv.offsetWidth;
        pcv.style.animation='pwChargeR .7s ease-in-out';
        if (ocv) setTimeout(()=>{ ocv.style.animation='pwHit .5s ease,pwFlash .5s ease'; setTimeout(()=>ocv.style.animation='',500); },300);
      } else if (atk === 'opp' && ocv) {
        ocv.style.animation='none'; void ocv.offsetWidth;
        ocv.style.animation='pwChargeL .7s ease-in-out';
        if (pcv) setTimeout(()=>{ pcv.style.animation='pwHit .5s ease,pwFlash .5s ease'; setTimeout(()=>pcv.style.animation='',500); },300);
      }
      // Loser flies off-screen
      if (opp && opp.hp <= 0 && ocv) { ocv.style.animation='pwFlyR 1s cubic-bezier(.4,0,.9,.5) forwards'; }
      if (player.hp <= 0 && pcv)     { pcv.style.animation='pwFlyL 1s cubic-bezier(.4,0,.9,.5) forwards'; }
      b._gAtk = null;
    });
  },

  // 1v1 crash duel: fighters charge and collide; the loser flies off-screen.
  _renderDuel() {
    const b = this.battle; if (!b) return;
    const [L, R] = b.fighters;
    const lastLog = b.log.length ? b.log[b.log.length-1].replace(/<\/?b>/g,'') : '';

    // Build the duel stage once
    if (!b._duelBuilt) {
      this.arenaEl.innerHTML = `
        <div style="position:relative;height:100%;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;">
          <div style="position:absolute;top:8px;left:0;right:0;text-align:center;font-size:17px;font-weight:900;color:#f39c12;letter-spacing:1px;z-index:6;">⚔️ ${b.isGauntlet?'GAUNTLET':'DUEL'}</div>
          <div class="pw-vs">VS</div>
          <div class="pw-duelist left" id="pw-duel-l">
            <div class="pw-duel-name" style="color:${rCol(L.rarity)}">@${L.user}</div>
            <div class="pw-duel-hp"><div class="pw-bar" id="pw-hp-l" style="width:100%;height:100%;background:#2ecc71;"></div></div>
            ${L.img ? `<img src="${L.img.src||L.img}">` : '<div style="font-size:90px;text-align:center;">🐶</div>'}
          </div>
          <div class="pw-duelist right" id="pw-duel-r">
            <div class="pw-duel-name" style="color:${rCol(R.rarity)}">@${R.user}</div>
            <div class="pw-duel-hp"><div class="pw-bar" id="pw-hp-r" style="width:100%;height:100%;background:#2ecc71;"></div></div>
            ${R.img ? `<img src="${R.img.src||R.img}">` : '<div style="font-size:90px;text-align:center;transform:scaleX(-1);">🐶</div>'}
          </div>
          <div style="position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:13px;color:#ccc;padding:0 10px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" id="pw-duel-log">${lastLog}</div>
        </div>`;
      b._duelBuilt = true;
      b._lDead = b._rDead = false;
    }

    // Update HP bars
    const lEl = document.getElementById('pw-duel-l'), rEl = document.getElementById('pw-duel-r');
    const lHp = document.getElementById('pw-hp-l'),   rHp = document.getElementById('pw-hp-r');
    const log = document.getElementById('pw-duel-log');
    if (log) log.textContent = lastLog;
    if (lHp) { const p=hpPct(L); lHp.style.width=p+'%'; lHp.style.background=hpCol(p); }
    if (rHp) { const p=hpPct(R); rHp.style.width=p+'%'; rHp.style.background=hpCol(p); }

    // Charge/hit animation — figure out who attacked this round
    const atk = b._lastAtk, def = b._lastDef;
    if (atk && def && lEl && rEl) {
      const atkEl = atk===L ? lEl : rEl;
      const defEl = def===L ? lEl : rEl;
      const chargeCls = atk===L ? 'pw-charge-r' : 'pw-charge-l';
      atkEl.classList.remove('pw-charge-r','pw-charge-l'); void atkEl.offsetWidth;
      atkEl.classList.add(chargeCls);
      setTimeout(()=>{ defEl.classList.add('pw-hit'); setTimeout(()=>defEl.classList.remove('pw-hit'),500); }, 320);
      setTimeout(()=>atkEl.classList.remove(chargeCls), 800);
    }

    // Fly-off on elimination
    if (!L.alive && !b._lDead && lEl) { b._lDead=true; lEl.classList.add('pw-fly-l'); }
    if (!R.alive && !b._rDead && rEl) { b._rDead=true; rEl.classList.add('pw-fly-r'); }
  },

  _render() {
    const b = this.battle; if (!b) return;
    if (b.fighters.length === 2) { this._renderDuel(); return; }
    const total = b.fighters.length;
    const alive = b.fighters.filter(f=>f.alive).length;
    const cols  = Math.min(10, total);
    const cellW = Math.floor(1880 / cols);
    const rows  = [];
    for (let r=0; r<Math.ceil(total/cols); r++) rows.push(b.fighters.slice(r*cols,(r+1)*cols));
    const lastLog = b.log.length ? b.log[b.log.length-1].replace(/<\/?b>/g,'') : '';

    this.arenaEl.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:6px 8px;gap:4px;font-family:'Segoe UI',system-ui,sans-serif;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;padding:0 4px;">
          <div style="font-size:16px;font-weight:900;color:#f39c12;letter-spacing:1px;">⚔️ PUPPY WARS</div>
          <div style="font-size:14px;color:#888;">Round ${b.round} &nbsp;·&nbsp; ${alive}/${total} alive</div>
          <div style="font-size:13px;color:#ccc;max-width:800px;text-align:right;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${lastLog}</div>
        </div>
        <div style="display:flex;flex-direction:column;flex:1;gap:3px;overflow:hidden;">
          ${rows.map(row=>`
            <div style="display:flex;gap:3px;flex:1;">
              ${row.map(f=>{
                const pct=hpPct(f);
                const sp = Math.min(32,Math.floor(cellW*0.28));
                return `
                  <div style="flex:0 0 ${cellW-3}px;max-width:${cellW-3}px;background:rgba(255,255,255,.04);border-radius:6px;padding:4px 5px;
                    border:${f.attacking?'2px solid #f39c12':f.alive?'1px solid rgba(255,255,255,.1)':'1px solid rgba(255,255,255,.03)'};
                    opacity:${f.alive?1:.18};${f.alive?'':'filter:grayscale(1);'}display:flex;flex-direction:column;gap:2px;">
                    <div style="display:flex;align-items:center;gap:4px;">
                      <canvas id="pwf-${f.user.replace(/\W/g,'_')}" width="${sp}" height="${sp}"
                        style="image-rendering:pixelated;border-radius:3px;flex-shrink:0;background:rgba(255,255,255,.04);">
                      </canvas>
                      <div style="flex:1;min-width:0;overflow:hidden;">
                        <div style="font-size:10px;font-weight:800;color:${f.alive?'#fff':'#444'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">@${f.user}</div>
                        <div style="font-size:9px;color:${rCol(f.rarity)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.sprite?.name||f.rarity}</div>
                      </div>
                    </div>
                    <div style="background:rgba(255,255,255,.06);border-radius:3px;height:4px;overflow:hidden;">
                      <div class="pw-bar" style="width:${pct}%;height:100%;background:${f.alive?hpCol(pct):'#333'};border-radius:2px;"></div>
                    </div>
                  </div>`;
              }).join('')}
            </div>`).join('')}
        </div>
      </div>`;

    requestAnimationFrame(() => {
      b.fighters.forEach(f => {
        if (!f.img) return;
        const cv = document.getElementById(`pwf-${f.user.replace(/\W/g,'_')}`);
        if (!cv) return;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0,0,cv.width,cv.height);
        if (!f.alive) ctx.globalAlpha = 0.25;
        ctx.drawImage(f.img,0,0,cv.width,cv.height);
        ctx.globalAlpha = 1;
      });
    });
  },
};

export default PuppyWars;
