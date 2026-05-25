// YardPets3 — modules/yard/yard.js
// All game animations are coded — no GIFs.
//
// TOSS  : stick arcs across yard, pup slides to it and back with wobble
// THROW : ball arcs across yard, pup slides to it and back with wobble
// DIG   : pup wiggles in place, dirt flies up, leaves persistent holes (max 5)
// WALK  : pup slides around entire yard perimeter (up to 10 concurrent)
// FISH  : bouncing emoji → rarity-scaled wiggle → caught pup PNG pop-up
//         (no sparkle at common, scaling to intense at legendary)

const W = 1920, H = 1080;
const WEATHER_TRANS_SPEED = 0.00167;
const AUTO_WEATHER_MS     = 15 * 60 * 1000;
const WEATHER_LIST        = ['sunny','cloudy','rainy','stormy','snowy','windy'];
const MAX_WALKERS         = 3;  // cap concurrent to reduce canvas load
const MAX_PROJECTILES     = 4;  // cap concurrent toss/throw/dig/fish
const MAX_HOLES           = 5;
const HOLE_FADE_SPEED     = 0.007;

const SKY = {
  sunny:  {top:'#2E86DE',bot:'#74C0FC',gTop:'#6DBF67',gBot:'#3A7D44'},
  cloudy: {top:'#6B7C8F',bot:'#A3B0BD',gTop:'#58A05A',gBot:'#2E7031'},
  rainy:  {top:'#2C3E50',bot:'#546E7A',gTop:'#4A7C4D',gBot:'#265628'},
  stormy: {top:'#0D1B2A',bot:'#1B2A3B',gTop:'#2E5C31',gBot:'#1A3D1C'},
  snowy:  {top:'#8BB8E8',bot:'#D6EAF8',gTop:'#E8F5E9',gBot:'#C8E6C9'},
  windy:  {top:'#1E90FF',bot:'#63BFFF',gTop:'#5CB85C',gBot:'#357A35'},
};
const SKY_NIGHT  = {top:'#020510', bot:'#0A1628'};
const WEATHER_FOG = {
  cloudy:'rgba(160,175,195,.12)', rainy:'rgba(70,100,130,.22)',
  stormy:'rgba(10,18,45,.44)',    snowy:'rgba(200,220,255,.14)',
};
const RARITY_COL = {common:'#aaa',uncommon:'#2ecc71',rare:'#3498db',epic:'#9b59b6',legendary:'#f39c12'};


const GAME_LABEL = {toss:'🎯 Toss!',throw:'🎾 Throw!',dig:'⛏️ Dig!',walk:'🐾 Walk!',fish:'🎣 Fish!'};
const RARITIES   = ['common','uncommon','rare','epic','legendary'];
const RAR_WT     = [50,25,15,7,3];

// Fish sparkle — null at common, scaled up to legendary
const FISH_SPARKLE = {
  common:   null,
  uncommon: {n:8,  spd:2.5, colors:['#2ecc71','#58d68d','#abebc6'],       maxR:4, glow:false},
  rare:     {n:22, spd:3.5, colors:['#3498db','#5dade2','#aed6f1'],       maxR:6, glow:true},
  epic:     {n:40, spd:5,   colors:['#9b59b6','#c39bd3','#f5eef8'],       maxR:7, glow:true},
  legendary:{n:70, spd:7,   colors:['#f39c12','#ffd700','#fff','#ffe082'],maxR:12,glow:true},
};

const lerp   = (a,b,t) => a+(b-a)*t;
const clamp  = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const smooth = t => { const c=clamp(t,0,1); return c*c*(3-2*c); };
const cap    = s => s ? s[0].toUpperCase()+s.slice(1) : '';
const rand   = (mn,mx) => Math.random()*(mx-mn)+mn;
const delay  = ms => new Promise(r=>setTimeout(r,ms));

function rngRarity(){
  const tot=RAR_WT.reduce((s,w)=>s+w,0);let r=Math.random()*tot;
  for(let i=0;i<RAR_WT.length;i++){r-=RAR_WT[i];if(r<=0)return RARITIES[i];}
  return 'common';
}
function hex2rgb(h){
  if(!h||typeof h!=='string')return[0,0,0];
  if(h.startsWith('#'))return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const m=h.match(/\d+/g);return m?[parseInt(m[0]),parseInt(m[1]),parseInt(m[2])]:[0,0,0];
}
function lerpCol(a,b,t){
  const[r1,g1,b1]=hex2rgb(a),[r2,g2,b2]=hex2rgb(b);
  return `rgb(${Math.round(lerp(r1,r2,t))},${Math.round(lerp(g1,g2,t))},${Math.round(lerp(b1,b2,t))})`;
}

// Weather particle factories
// Looney Tunes style particles — exaggerated & cartoony
const mkRain = s => ({
  x:Math.random()*W, y:Math.random()*H,
  spd: s ? rand(18,28) : rand(9,15),
  // Teardrop shape: len=body height, r=radius at top (fat cartoon drop)
  r:   s ? rand(5,9)   : rand(3,6),
  len: s ? rand(18,30) : rand(10,18),
  op:  s ? rand(.55,.9): rand(.35,.65),
  wx:  s ? rand(3,7)   : rand(1,3),
  col: s ? '#60A8E0' : '#88C8F0',
  lw:  s ? 2.5 : 1.8,
});
const mkSnow = () => ({
  x:Math.random()*W, y:Math.random()*H,
  spd:rand(.4,1.2), r:rand(6,18),  // big chunky flakes
  drift:rand(-.5,.5), op:rand(.7,1),
  phase:Math.random()*Math.PI*2, wobble:rand(.4,1),
  rot:Math.random()*Math.PI*2, rotSpd:rand(-.02,.02),
});
const mkWind = () => {
  // Mix of speed lines and flying objects (leaves, stars)
  const type = Math.random()<.6 ? 'line' : 'obj';
  return {
    x:Math.random()<.5?-60:W+60, y:rand(80,H*.8),
    spd:rand(10,22)*(Math.random()<.5?1:-1),
    len:rand(60,200), op:rand(.08,.22),
    life:1, lw:rand(1,2.5), curve:rand(-20,20),
    type, rot:Math.random()*Math.PI*2, rotSpd:rand(-.05,.05),
    emoji:['🍂','⭐','💨','🌿'][Math.floor(Math.random()*4)],
  };
};
const mkCloud = x  => ({x:x??W+100,y:rand(30,230),spd:rand(.12,.34),scale:rand(.55,1.4),op:rand(.7,1),puffs:Array.from({length:Math.floor(rand(5,9))},()=>({dx:rand(-85,55),dy:rand(-32,32),r:rand(20,52)}))});

// Game particle factories
const mkDirt = (cx,cy) => {
  const a=-Math.PI/2+rand(-.75,.75), s=rand(2,6.5);
  return {x:cx+rand(-22,22),y:cy,vx:Math.cos(a)*s*(Math.random()>.5?1:-1),vy:Math.sin(a)*s-rand(.5,2),
          r:rand(2,7),col:`hsl(${rand(22,46)},${rand(52,72)}%,${rand(28,46)}%)`,
          alpha:1,life:0,maxLife:rand(35,65),grav:.26};
};
const mkFishSparkle = (cx,cy,cfg) => {
  const a=rand(-Math.PI,0), s=rand(cfg.spd*.5,cfg.spd*1.5);
  return {x:cx+rand(-45,45),y:cy+rand(-10,10),vx:Math.cos(a)*s,vy:Math.sin(a)*s-rand(.5,2.5),
          r:rand(1.5,cfg.maxR),col:cfg.colors[Math.floor(Math.random()*cfg.colors.length)],
          alpha:1,life:0,maxLife:rand(30,65),grav:.1,glow:cfg.glow};
};

// Perimeter walk path — full clockwise loop around the visible yard.
// Pup enters from off-screen left, walks the full on-screen perimeter, exits off-screen left.
// At 0.023 steps/frame (60fps) this takes exactly 3 minutes per loop.
function makePerimeterPath(grassY,puppyWarsY){
  const top    = grassY + 72;      // just below fence line
  const bottom = puppyWarsY - 48;  // just above battle zone
  const entryX = -130;             // off-screen left (entry/exit point)
  const rightX = W - 60;          // right turn — stays on screen (1860)
  const leftX  = 60;              // left turn — stays on screen
  const step   = 20;
  const pts    = [];
  // Top edge: enter from off-screen left, walk right
  for(let x=entryX; x<=rightX; x+=step) pts.push({x, y:top});
  // Right edge: walk down (fully visible)
  for(let y=top;    y<=bottom;  y+=step) pts.push({x:rightX, y});
  // Bottom edge: walk left (fully visible)
  for(let x=rightX; x>=leftX;  x-=step) pts.push({x, y:bottom});
  // Left edge: walk up (fully visible)
  for(let y=bottom; y>=top;    y-=step) pts.push({x:leftX, y});
  // Exit: walk off-screen left along top
  for(let x=leftX;  x>=entryX; x-=step) pts.push({x, y:top});
  return pts;
}

const Yard = {
  mount:null,EventBus:null,CONFIG:null,
  getRandomSprite:null,getSpriteByPupId:null,getSpritesByRarity:null,getImageForSprite:null,
  ctx:null,pCtx:null,spriteLayer:null,popupLayer:null,

  // scene
  clouds:[],wx:[],sun:0,lightning:0,raf:null,lt:0,
  weather:'sunny',target:'sunny',wt:1,fogAlpha:0,
  dayPhase:0,dayDir:1,DAY_SPEED:0.000012,

  // game state
  particles:[],    // dirt + sparkles
  projectiles:[],  // flying sticks / balls
  holes:[],        // persistent dig holes {x,y,rx,ry,alpha,evicting}
  movers:[],       // sliding pup elements {el,x,y,tx,ty,spd,wobblePhase,sz,done}

  // queues
  gameQ:   {toss:[],throw:[],dig:[],fish:[]},
  _favSky:    null,   // { top, mid, bot, fx, alpha, particles[] }
  _fenceColor:null,    // hex string from diamond trait (active)
  _skyRoll:null,       // pre-rendered day/night sky canvas (built once at init)
  _skyRollH:0,         // height of the sky roll canvas
  _skyOffset:0,        // current scroll position in px
  _skyStartMs:0,       // Date.now() at init for offset calculation
  _walkerColors:[],    // diamond colors of all currently-walking favPups
  _fenceTimer:null,    // interval for cycling when multiple walkers
  _imgCache:  {},     // url → HTMLImageElement cache
  _favWalkBusy: false,
  gameBusy:{toss:false,throw:false,dig:false,fish:false},
  walkQ:[],walkers:[],walkBlocked:new Set(),walkPath:null,

  popup:null,demo:false,tapN:0,tapTimer:null,
  billboardImg:null,
  chestImg:null,

  // Hole collision / rescue
  pupInHole:false,       // true while a pup has fallen in
  queuesHeld:false,      // queues paused during rescue
  savePopup:null,        // the warning DOM element

  // GBM overlay result
  gbmResult:null,        // {winningPick,winners,ties,losers,winReward,tieReward} for 6s
  gbmResultTs:0,

  async init({mount,EventBus,CONFIG,getRandomSprite,getSpriteByPupId,getSpriteByName,getSpritesByRarity,getImageForSprite}){
    Object.assign(this,{mount,EventBus,CONFIG,getRandomSprite,getSpriteByPupId,getSpriteByName,getSpritesByRarity,getImageForSprite});
    const{grassY,puppyWarsY}=CONFIG.layout;
    this.walkPath=makePerimeterPath(grassY,puppyWarsY);
    this._buildSkyRoll(grassY); // pre-render sky cycle once
    this._buildDOM();
    this._injectCSS();
    this.clouds=Array.from({length:10},()=>mkCloud(Math.random()*W));
    this._mkWxParticles('sunny');
    this._startLoop();
    this._autoWeather();
    this._bind();
    // Preload billboard image from assets/
    const _bi = new Image();
    _bi.onload  = () => { this.billboardImg = _bi; };
    _bi.onerror = () => console.warn('[Yard] billboard.png not found — skipping billboard');
    _bi.src = this.CONFIG.assets.base + '/billboard.png';

    const _ci = new Image();
    _ci.onload  = () => { this.chestImg = _ci; };
    _ci.onerror = () => console.warn('[Yard] chest.png not found — skipping chest');
    _ci.src = this.CONFIG.assets.base + '/chest.png';
    console.log('[Yard] Ready');
  },

  _buildDOM(){
    this.mount.style.cssText='position:absolute;inset:0;width:1920px;height:1080px;overflow:hidden;';
    // Sky canvas — sits BELOW the billboard (z3) so the billboard shows against the sky.
    // Weather stays on the main canvas (z10) so rain/snow render IN FRONT of the billboard.
    const skyCv=document.createElement('canvas');skyCv.width=W;skyCv.height=H;
    skyCv.style.cssText='position:absolute;inset:0;z-index:3;pointer-events:none;';
    this.skyCtx=skyCv.getContext('2d');
    (this.mount.parentNode||document.body).insertBefore(skyCv, this.mount);
    const cv=document.createElement('canvas');cv.width=W;cv.height=H;cv.style.cssText='position:absolute;inset:0;';this.ctx=cv.getContext('2d');this.mount.appendChild(cv);
    this.spriteLayer=document.createElement('div');this.spriteLayer.style.cssText='position:absolute;inset:0;pointer-events:none;';this.mount.appendChild(this.spriteLayer);
    const pc=document.createElement('canvas');pc.width=W;pc.height=H;pc.style.cssText='position:absolute;inset:0;pointer-events:none;';this.pCtx=pc.getContext('2d');this.mount.appendChild(pc);
    this.popupLayer=document.createElement('div');this.popupLayer.style.cssText='position:absolute;inset:0;pointer-events:none;';this.mount.appendChild(this.popupLayer);
    const{pondX,pondY}=this.CONFIG.layout;
    const pt=document.createElement('div');pt.style.cssText=`position:absolute;left:${pondX-80}px;top:${pondY-70}px;width:160px;height:140px;border-radius:50%;`;pt.onclick=()=>this._pondTap();this.mount.appendChild(pt);
  },

  _injectCSS(){
    if(document.getElementById('yard-css'))return;
    const s=document.createElement('style');s.id='yard-css';
    s.textContent=`
      @keyframes yPin  {from{opacity:0;transform:translateX(-50%) translateY(20px) scale(.88)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
      @keyframes yPout {from{opacity:1;transform:translateX(-50%) scale(1)}to{opacity:0;transform:translateX(-50%) translateY(10px) scale(.93)}}
      @keyframes yUin  {from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

      /* Dig — rapid alternating tilt */
      @keyframes yDig {
        0%,100%{transform:rotate(0) translateY(0);}
        12%{transform:rotate(-16deg) translateY(-12px);}
        26%{transform:rotate(14deg) translateY(-20px);}
        40%{transform:rotate(-11deg) translateY(-9px);}
        55%{transform:rotate(13deg) translateY(-17px);}
        70%{transform:rotate(-8deg) translateY(-7px);}
        84%{transform:rotate(9deg) translateY(-13px);}
      }

      /* Walk bob */
      @keyframes yWalk{0%,100%{transform:translateY(0);}50%{transform:translateY(-7px);}}

      /* Fish emoji bounce */
      @keyframes yFishBounce{
        0%,100%{transform:translateY(0) rotate(-5deg) scale(1);}
        50%{transform:translateY(-28px) rotate(5deg) scale(1.12);}
      }

      /* Bite wiggle — scaled by rarity */
      @keyframes yBite1{0%,100%{transform:rotate(0);}35%{transform:rotate(-8deg);}70%{transform:rotate(8deg);}}
      @keyframes yBite2{0%,100%{transform:rotate(0);}20%{transform:rotate(-18deg);}40%{transform:rotate(16deg);}60%{transform:rotate(-14deg);}80%{transform:rotate(14deg);}}
      @keyframes yBite3{0%,100%{transform:rotate(0);}15%{transform:rotate(-28deg);}30%{transform:rotate(26deg);}45%{transform:rotate(-22deg);}60%{transform:rotate(22deg);}75%{transform:rotate(-18deg);}90%{transform:rotate(18deg);}}
      @keyframes yBite4{
        0%,100%{transform:rotate(0) scale(1);}
        10%{transform:rotate(-35deg) scale(1.15);}20%{transform:rotate(33deg) scale(.9);}
        30%{transform:rotate(-30deg) scale(1.2);}40%{transform:rotate(30deg) scale(.88);}
        50%{transform:rotate(-28deg) scale(1.18);}60%{transform:rotate(28deg) scale(.92);}
        70%{transform:rotate(-24deg) scale(1.1);}80%{transform:rotate(24deg) scale(.95);}
        90%{transform:rotate(-18deg) scale(1.05);}
      }

      /* Catch — pup rises from pond */
      @keyframes yCatch{0%{transform:translateY(80px) scale(.4);opacity:0;}60%{transform:translateY(-16px) scale(1.1);opacity:1;}100%{transform:translateY(0) scale(1);opacity:1;}}
      @keyframes yFloat{
        0%   {opacity:0;  transform:translateX(-50%) translateY(0)      scale(.7);}
        15%  {opacity:1;  transform:translateX(-50%) translateY(-40px)  scale(1.15);}
        70%  {opacity:1;  transform:translateX(-50%) translateY(-220px) scale(1);}
        100% {opacity:0;  transform:translateX(-50%) translateY(-420px) scale(.85);}
      }

      .yUser{position:absolute;transform:translateX(-50%);white-space:nowrap;pointer-events:none;
        font-family:'Segoe UI',system-ui,sans-serif;font-size:20px;font-weight:800;color:#fff;
        background:rgba(0,0,0,.75);padding:4px 14px;border-radius:8px;letter-spacing:.02em;
        text-shadow:0 2px 6px rgba(0,0,0,1);animation:yUin .2s ease both;}
    `;
    document.head.appendChild(s);
  },

  _mkWxParticles(w){
    this.wx=[];
    if(w==='rainy')       for(let i=0;i<43;i++) this.wx.push(mkRain(false));
    else if(w==='stormy') for(let i=0;i<77;i++) this.wx.push(mkRain(true));
    else if(w==='snowy')  for(let i=0;i<70;i++) this.wx.push(mkSnow());
    else if(w==='windy')  for(let i=0;i<29;i++) this.wx.push(mkWind());
  },

  _drawNeeded:true,   // force first draw

  _startLoop(){
    const TARGET_MS = 1000/30;  // 30fps cap — stream is 30fps, 60fps wastes CPU
    let lastTs=0;
    const loop=ts=>{
      this.raf=requestAnimationFrame(loop);
      const elapsed=ts-lastTs;
      if(elapsed<TARGET_MS) return;          // skip frame — not time yet
      const dt=Math.min(elapsed/16.67,3);
      lastTs=ts-(elapsed%TARGET_MS);         // avoid drift accumulation
      try{
        const active=this._tick(dt);  // returns true if something is animating
        if(active||this._drawNeeded){
          this._draw();
          this._drawNeeded=false;
        }
      }catch(e){
        console.error('[Yard] RAF error (recovering):', e);
      }
    };
    this.raf=requestAnimationFrame(loop);
  },

  _tick(dt){
    // Dispatch time-of-day ~1/sec for billboard lights
    if(!this._lastDayEvt||Date.now()-this._lastDayEvt>1000){this._lastDayEvt=Date.now();const _cp=this._skyStartMs?(((Date.now()-this._skyStartMs)/900000)%1):0.25;const _nt=0.5-0.5*Math.cos((_cp-0.25)*2*Math.PI);try{window.dispatchEvent(new CustomEvent('chocto:daytime',{detail:{cycleP:_cp,night:_nt}}));}catch{}}
    // Returns true if any animation is active (tells loop to redraw)
    const hasWeather = this.wt < 1 || this.wx.length > 0;
    const hasWalkers  = this.walkers.length > 0 || this.walkQ.length > 0;
    const hasProjs    = this.projectiles.length > 0;
    const hasMovers   = this.movers.length > 0;
    const hasClouds   = this.clouds.some(c => Math.abs(c.vx) > 0.01);
    const hasFavSky   = !!(this._favSky);
    const hasHoles    = this.holes?.some(h => h.alpha > 0);
    const hasLightning= this.lightning > 0;
    const hasSkyRoll  = !!this._skyRoll;  // scrolling sky always animates → always redraw
    const isActive    = hasSkyRoll||hasWeather||hasWalkers||hasProjs||hasMovers||hasFavSky||hasHoles||hasLightning;
    if(this.wt<1){
      this.wt=Math.min(1,this.wt+dt*WEATHER_TRANS_SPEED);
      if(this.wt>=1){this.weather=this.target;this._mkWxParticles(this.weather);}
    }
    const curW=this.wt>.5?this.target:this.weather;
    this.fogAlpha=lerp(this.fogAlpha,WEATHER_FOG[curW]?smooth(Math.min(1,this.wt*1.8)):0,dt*.025);
    this.sun=(this.sun+dt*.00018)%(Math.PI*2);
    this.dayPhase=clamp(this.dayPhase+dt*this.DAY_SPEED*this.dayDir,0,1);
    // Advance sky roll offset (real-time based, not dt, for perfect accuracy)
    if (this._skyRoll) {
      this._skyOffset = ((Date.now() - this._skyStartMs) / 900000 * this._skyRollH) % this._skyRollH;
    }
    if(this.dayPhase>=1)this.dayDir=-1;else if(this.dayPhase<=0)this.dayDir=1;
    if(this.weather==='stormy'||this.target==='stormy'){if(Math.random()<.001*dt)this.lightning=1.8+rand(0,.6);}else this.lightning=0;
    if(this.lightning>0)this.lightning=Math.max(0,this.lightning-dt*.09);
    const wm=curW==='windy'?3.5:curW==='stormy'?.55:1;
    this.clouds.forEach(c=>{c.x-=c.spd*dt*wm;if(c.x<-350)Object.assign(c,mkCloud(W+120+rand(0,400)));});
    const pw=this.wt<1?this.target:this.weather;
    this.wx.forEach(p=>{
      if(pw==='rainy'||pw==='stormy'){p.x+=p.wx*dt;p.y+=p.spd*dt;if(p.y>H+20){p.y=-20;p.x=Math.random()*W;}}
      else if(pw==='snowy'){p.phase+=dt*.025;p.x+=Math.sin(p.phase)*p.wobble*1.8*dt+p.drift*dt;p.y+=p.spd*dt;if(p.y>H+20){p.y=-20;p.x=Math.random()*W;}}
      else if(pw==='windy'){p.x+=p.spd*dt;p.y+=p.curve*dt*.03;p.life-=dt*.014;if((p.spd>0&&p.x>W+120)||(p.spd<0&&p.x<-120)||p.life<=0)Object.assign(p,mkWind());}
    });
    this.particles=this.particles.filter(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=p.grav;p.life++;p.alpha=Math.max(0,1-p.life/p.maxLife);return p.alpha>0;});
    this._tickProjectiles(dt);
    this._tickMovers(dt);
    this.holes.forEach(h=>{if(h.evicting)h.alpha=Math.max(0,h.alpha-HOLE_FADE_SPEED*dt);});
    this.holes=this.holes.filter(h=>h.alpha>0);
    this._tickWalkers(dt);
    return isActive;  // tells RAF loop whether to redraw
  },

  // ── Projectile physics ───────────────────────────────────────────────────────
  _tickProjectiles(dt){
    const floor=this.CONFIG.layout.grassY+65;
    const{puppyWarsY}=this.CONFIG.layout;
    this.projectiles.forEach(p=>{
      if(p.landed)return;
      p.vy+=p.grav*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
      if(p.type==='stick')p.angle=(p.angle||0)+p.vx*.035*dt;
      else p.spin=(p.spin||0)+p.vx*.025*dt;
      if(p.y>=floor&&p.vy>0){
        p.y=floor+rand(0,(puppyWarsY-floor-80));p.x=clamp(p.x,80,W-80);
        p.vx=0;p.vy=0;p.landed=true;p.landX=p.x;p.landY=p.y;
      }
    });
  },
  _waitLand(proj){return new Promise(res=>{const chk=()=>{if(proj.landed)res();else requestAnimationFrame(chk);};requestAnimationFrame(chk);});},

  // ── Mover system ─────────────────────────────────────────────────────────────
  _tickMovers(dt){
    this.movers.forEach(m=>{
      if(m.done)return;
      const dx=m.tx-m.x,dy=m.ty-m.y,dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<2){m.x=m.tx;m.y=m.ty;m.done=true;}
      else{const spd=Math.min(m.spd*dt,dist);m.x+=dx/dist*spd;m.y+=dy/dist*spd;}
      m.wobblePhase=(m.wobblePhase||0)+dt*.14;
      const wb=Math.sin(m.wobblePhase)*6;
      const flip=m.tx<m.startX;
      m.el.style.left=`${m.x-m.sz/2}px`;m.el.style.top=`${m.y-m.sz}px`;
      m.el.style.transform=`${flip?'scaleX(-1)':'scaleX(1)'} rotate(${wb}deg)`;
    });
  },
  _moveTo(el,x,y,tx,ty,sz,spd,startX){
    return new Promise(res=>{
      const m={el,x,y,tx,ty,sz,spd,startX:startX??x,wobblePhase:0,done:false};
      this.movers.push(m);
      const chk=()=>{if(m.done){this.movers=this.movers.filter(v=>v!==m);res();}else requestAnimationFrame(chk);};
      requestAnimationFrame(chk);
    });
  },

  // ── Draw ─────────────────────────────────────────────────────────────────────
  // Sky color phases keyed by cycleP — interpolated for smooth fade across day cycle
  _skyPhases: [
    { p:0.00, top:'#E8603C', bot:'#F4A460' },  // dawn
    { p:0.08, top:'#5BA3D9', bot:'#C5DDEF' },  // early morning
    { p:0.25, top:'#1A6FBF', bot:'#7EC8E3' },  // midday
    { p:0.42, top:'#3D90CC', bot:'#B0DCF0' },  // afternoon
    { p:0.50, top:'#E8603C', bot:'#D4774B' },  // dusk
    { p:0.58, top:'#4B1F6F', bot:'#7B3F9E' },  // evening twilight
    { p:0.75, top:'#050510', bot:'#0A1020' },  // midnight
    { p:0.92, top:'#1A1240', bot:'#3B1F70' },  // pre-dawn
    { p:1.00, top:'#E8603C', bot:'#F4A460' },  // dawn (loop)
  ],
  _lerpHex(a, b, t) {
    const h = s => parseInt(s,16);
    const r = c => Math.max(0,Math.min(255,Math.round(c)));
    const ah = [h(a.slice(1,3)),h(a.slice(3,5)),h(a.slice(5,7))];
    const bh = [h(b.slice(1,3)),h(b.slice(3,5)),h(b.slice(5,7))];
    return '#'+[0,1,2].map(i=>r(ah[i]+(bh[i]-ah[i])*t).toString(16).padStart(2,'0')).join('');
  },
  _skyColorAt(cycleP) {
    const ph = this._skyPhases;
    let i = 0;
    while (i < ph.length-1 && ph[i+1].p <= cycleP) i++;
    const a = ph[i], b = ph[Math.min(i+1,ph.length-1)];
    const t = (b.p > a.p) ? (cycleP - a.p) / (b.p - a.p) : 0;
    return { top: this._lerpHex(a.top, b.top, t), bot: this._lerpHex(a.bot, b.bot, t) };
  },

  _draw(){
    const c=this.ctx;
    const sky=this.skyCtx||c;   // sky renders on its own below-billboard canvas
    const t=smooth(clamp(this.wt,0,1));
    const{grassY,pondX,pondY,puppyWarsY}=this.CONFIG.layout;
    // Keep the main canvas transparent above the ground so the billboard shows through;
    // weather particles drawn later on `c` still appear in front of the billboard.
    if(this.skyCtx) c.clearRect(0,0,W,grassY);
    const fw=this.weather,tw=this.target;
    const curW=t>.5?tw:fw;
    // One day-cycle clock (15 min) drives sky color, star/cloud dimming AND the sun/moon arc.
    const cycleP = this._skyStartMs
      ? (((Date.now() - this._skyStartMs) / 900000) % 1)
      : (this.dayDir >= 0 ? this.dayPhase*0.5 : 1 - this.dayPhase*0.5);
    // night: 0 at midday (cycleP .25), 1 at midnight (cycleP .75)
    const night = 0.5 - 0.5*Math.cos((cycleP - 0.25) * 2 * Math.PI);

    let sTop=lerpCol(lerpCol(SKY[fw].top,SKY[tw].top,t),SKY_NIGHT.top,night*.88);
    let sBot=lerpCol(lerpCol(SKY[fw].bot,SKY[tw].bot,t),SKY_NIGHT.bot,night*.88);
    const fs = this._favSky;
    if (fs && fs.alpha > 0) {
      sTop = lerpCol(sTop, fs.top, fs.alpha);
      sBot = lerpCol(sBot, fs.bot, fs.alpha);
    }
    // Draw pre-rendered sky roll (time-based scrolling — one blit replaces gradient calc)
    if(this.skyCtx) sky.clearRect(0,0,W,grassY);
    // ── Fading sky: interpolate between day-cycle color phases (no scroll) ──────
    const { top:skyTop, bot:skyBot } = this._skyColorAt(cycleP);
    // Blend with weather tint
    const wTintA={sunny:0,cloudy:0.12,rainy:0.22,stormy:0.42,snowy:0.14,windy:0.06};
    const wTintC={sunny:'#b8d4f0',cloudy:'#b4b4c8',rainy:'#506488',stormy:'#1a1a3c',snowy:'#c8dcff',windy:'#b4c8a0'};
    const wKey = t>.5 ? tw : fw;
    const wBlend = wTintA[wKey] || 0;
    const skyGrad = sky.createLinearGradient(0,0,0,grassY);
    skyGrad.addColorStop(0, skyTop);
    skyGrad.addColorStop(1, skyBot);
    sky.fillStyle = skyGrad;
    sky.fillRect(0,0,W,grassY);
    if(wBlend>0){sky.save();sky.globalAlpha=wBlend;sky.fillStyle=wTintC[wKey]||'#000';sky.fillRect(0,0,W,grassY);sky.restore();}
    // favSky overlay (fav pup sky config)
    if(fs&&fs.alpha>0&&fs.top&&fs.bot){
      sky.save();sky.globalAlpha=fs.alpha*.45;
      const fsg=sky.createLinearGradient(0,0,0,grassY);fsg.addColorStop(0,fs.top);fsg.addColorStop(1,fs.bot);
      sky.fillStyle=fsg;sky.fillRect(0,0,W,grassY);sky.restore();
    }

    if(night>.08&&curW!=='stormy'){
      // Stars: pre-rendered to offscreen canvas, just composite with globalAlpha
      if(!this._starCanvas){
        this._starCanvas=document.createElement('canvas');
        this._starCanvas.width=W;this._starCanvas.height=grassY;
        const sc=this._starCanvas.getContext('2d');
        // Render all 130 stars at full brightness once
        for(let i=0;i<130;i++){
          const sx=(Math.sin(i*137.508)*.5+.5)*W, sy=(Math.cos(i*97.3)*.5+.5)*grassY*.9;
          sc.globalAlpha=0.55+Math.sin(i*7.3)*.45;
          sc.fillStyle='#fff';sc.beginPath();sc.arc(sx,sy,.6+Math.sin(i*13.7)*.5,0,Math.PI*2);sc.fill();
        }
      }
      sky.save();sky.globalAlpha=night*.88;sky.drawImage(this._starCanvas,0,0);sky.restore();
    }

    // ── Sun & moon arc ACROSS the sky (left→right), sharing the same day-cycle clock ──
    const arcTop = 46, arcBot = grassY * 0.62;          // peak height vs horizon
    // SUN — visible during the day half (cycleP 0..0.5), arcs across the full width
    if (cycleP < 0.5 && (curW==='sunny'||curW==='windy'||curW==='cloudy')) {
      const dp = cycleP / 0.5;                           // 0→1 across the day
      const sx = dp * W;
      const sy = arcBot - Math.sin(dp * Math.PI) * (arcBot - arcTop);
      const edge = Math.sin(dp * Math.PI);               // fade near horizon (rise/set)
      sky.save();sky.globalAlpha = Math.min(1, edge*1.4) * (curW==='cloudy'?.4:1);
      const sr=sky.createRadialGradient(sx,sy,0,sx,sy,95);sr.addColorStop(0,'rgba(255,255,200,1)');sr.addColorStop(.22,'rgba(255,220,80,.95)');sr.addColorStop(.55,'rgba(255,200,0,.28)');sr.addColorStop(1,'rgba(255,180,0,0)');
      sky.fillStyle=sr;sky.beginPath();sky.arc(sx,sy,95,0,Math.PI*2);sky.fill();sky.fillStyle='#FFFDE7';sky.beginPath();sky.arc(sx,sy,30,0,Math.PI*2);sky.fill();sky.restore();
    }
    // MOON — visible during the night half (cycleP 0.5..1), arcs across the full width
    if (cycleP >= 0.5) {
      const np = (cycleP - 0.5) / 0.5;                   // 0→1 across the night
      const mx = np * W;
      const my = arcBot - Math.sin(np * Math.PI) * (arcBot - arcTop);
      const edge = Math.sin(np * Math.PI);
      sky.save();sky.globalAlpha = Math.min(1, edge*1.4);
      const mr=sky.createRadialGradient(mx,my,0,mx,my,38);mr.addColorStop(0,'rgba(240,248,255,1)');mr.addColorStop(.6,'rgba(200,220,255,.8)');mr.addColorStop(1,'rgba(150,180,255,0)');sky.fillStyle=mr;sky.beginPath();sky.arc(mx,my,38,0,Math.PI*2);sky.fill();sky.restore();
    }

    sky.save();sky.beginPath();sky.rect(0,0,W,grassY-10);sky.clip();
    this.clouds.forEach(cl=>{
      let bv=curW==='stormy'?55:curW==='rainy'?130:curW==='cloudy'?195:250;bv=Math.round(bv*(1-night*.55));
      sky.save();sky.globalAlpha=cl.op*(curW==='sunny'?.78:curW==='stormy'?.52:.93)*(1-night*.28);sky.fillStyle=`rgb(${bv},${bv},${bv})`;sky.shadowColor=`rgba(0,0,0,${curW==='stormy'?.45:.12})`;sky.shadowBlur=10;
      cl.puffs.forEach(p=>{sky.beginPath();sky.arc(cl.x+p.dx*cl.scale,cl.y+p.dy*cl.scale,p.r*cl.scale,0,Math.PI*2);sky.fill();});sky.restore();
    });sky.restore();

    if(this.fogAlpha>.005&&WEATHER_FOG[curW]){sky.save();sky.globalAlpha=this.fogAlpha;sky.fillStyle=WEATHER_FOG[curW];sky.fillRect(0,0,W,grassY);sky.restore();}
    const flash=Math.sin(Math.PI*this.wt)*.07;
    if(flash>.004&&(fw==='stormy'||tw==='stormy')){c.save();c.globalAlpha=flash;c.fillStyle='#000';c.fillRect(0,0,W,grassY);c.restore();}
    if(this.lightning>0){
      c.fillStyle=`rgba(200,220,255,${this.lightning*.38})`;c.fillRect(0,0,W,H);
      if(this.lightning>.6){const lx=350+Math.random()*1200;c.save();c.shadowColor=`rgba(200,230,255,${this.lightning*.8})`;c.shadowBlur=12;c.strokeStyle=`rgba(255,255,255,${this.lightning})`;c.lineWidth=2.5;c.beginPath();c.moveTo(lx,0);c.lineTo(lx-22,85);c.lineTo(lx+18,85);c.lineTo(lx-35,185);c.lineTo(lx-12,grassY);c.stroke();c.restore();}
    }

    const gT=lerpCol(lerpCol(SKY[fw].gTop,SKY[tw].gTop,t),'#1A2A1A',night*.7);
    const gB=lerpCol(lerpCol(SKY[fw].gBot,SKY[tw].gBot,t),'#0D1A0D',night*.7);
    const gg=c.createLinearGradient(0,grassY,0,puppyWarsY);gg.addColorStop(0,gT);gg.addColorStop(1,gB);
    c.fillStyle=gg;c.fillRect(0,grassY,W,puppyWarsY-grassY);
    c.fillStyle=lerpCol(curW==='snowy'?'#DDE8DD':'#7BC650','#243B24',night*.65);c.fillRect(0,grassY,W,14);

    this._drawBillboard(c,grassY,night);
    this._drawHoles(c);

    const pz=c.createLinearGradient(0,puppyWarsY,0,H);pz.addColorStop(0,'rgba(0,0,0,.55)');pz.addColorStop(1,'rgba(0,0,0,.75)');
    c.fillStyle=pz;c.fillRect(0,puppyWarsY,W,H-puppyWarsY);
    c.strokeStyle='rgba(255,255,255,.07)';c.lineWidth=1;c.beginPath();c.moveTo(0,puppyWarsY);c.lineTo(W,puppyWarsY);c.stroke();

    this._drawPond(c,pondX,pondY,curW,night);
    this._drawFence(c,grassY,night);
    this._drawChest(c,grassY,puppyWarsY);
    this._drawWxFX(c,curW);
    this._drawParticles();
    this._drawGBMResult(c);
  },

  // ── Holes ─────────────────────────────────────────────────────────────────────
  _addHole(x,y){
    if(this.holes.filter(h=>!h.evicting).length>=MAX_HOLES) this.holes.find(h=>!h.evicting).evicting=true;
    this.holes.push({x,y,rx:rand(22,34),ry:rand(10,16),alpha:.72,evicting:false});
  },

  _drawHoles(c){
    this.holes.forEach(h=>{
      if(h.alpha<=0)return;
      c.save();c.globalAlpha=h.alpha;
      c.fillStyle='rgba(0,0,0,.5)';c.beginPath();c.ellipse(h.x+2,h.y+3,h.rx+3,h.ry+3,0,0,Math.PI*2);c.fill();
      const hg=c.createRadialGradient(h.x,h.y,2,h.x,h.y,h.rx);
      hg.addColorStop(0,'rgba(10,5,0,.95)');hg.addColorStop(.6,'rgba(30,18,5,.85)');hg.addColorStop(1,'rgba(55,35,10,.5)');
      c.fillStyle=hg;c.beginPath();c.ellipse(h.x,h.y,h.rx,h.ry,0,0,Math.PI*2);c.fill();
      c.strokeStyle=`rgba(90,60,20,${h.alpha*.55})`;c.lineWidth=2;
      c.beginPath();c.ellipse(h.x,h.y-2,h.rx,h.ry*.65,0,Math.PI,Math.PI*2);c.stroke();
      c.restore();
    });
  },

  _drawPond(c,cx,cy,w,night){
    const rx=230,ry=104; // 2× each axis = 4× area
    c.save();c.globalAlpha=.18;c.fillStyle='#000';c.beginPath();c.ellipse(cx+8,cy+12,rx,ry,0,0,Math.PI*2);c.fill();c.restore();
    let wc=w==='stormy'?'#122030':w==='snowy'?'#90C4E0':'#1E90FF';
    if(night>0)wc=lerpCol(wc,'#0A1525',night*.6);
    const wg=c.createRadialGradient(cx-50,cy-24,14,cx,cy,rx);wg.addColorStop(0,w==='stormy'?'#1E3A50':(night>.5?'#1030A0':'#4FC3F7'));wg.addColorStop(1,wc);
    c.fillStyle=wg;c.beginPath();c.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);c.fill();
    c.save();c.globalAlpha=.28*(1-night*.5);c.strokeStyle='#E1F5FE';c.lineWidth=2;
    for(let i=0;i<4;i++){c.beginPath();c.ellipse(cx-36+i*40,cy-16+i*12,32+i*22,9,-.18,0,Math.PI);c.stroke();}c.restore();
    if(w!=='stormy'){c.fillStyle=night<.5?'#4CAF50':'#2A5C2A';[[cx-90,cy+25,22],[cx+110,cy-20,18],[cx+25,cy+42,20],[cx-60,cy-30,15],[cx+80,cy+35,17]].forEach(([x,y,r])=>{c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();});}
    if(night>.3){c.save();c.globalAlpha=night*.16;c.fillStyle='rgba(200,220,255,1)';c.beginPath();c.ellipse(cx,cy-16,rx*.5,ry*.3,0,0,Math.PI*2);c.fill();c.restore();}
  },

  _drawBillboard(c,gy,night){
    if(!this.billboardImg)return;
    // Billboard panel sits just above fence line, behind it (fence drawn after)
    const BW   = 520;                  // panel width
    const BH   = 180;                  // panel height
    const bCX  = 580;                  // centre X of billboard
    const panelB = gy - 58;            // bottom of panel (just above fence rails)
    const panelT = panelB - BH;        // top of panel
    const postW  = 22;                 // post width
    const postTop= panelB;
    const postBot= gy + 6;             // post meets ground

    // Night dim: billboard fades like everything else
    const brightness = 1 - night * 0.55;
    c.save();
    c.globalAlpha = brightness;

    // Pole / post
    const pg = c.createLinearGradient(bCX - postW/2, 0, bCX + postW/2, 0);
    pg.addColorStop(0, '#2a2a2a'); pg.addColorStop(0.4, '#555'); pg.addColorStop(1, '#1a1a1a');
    c.fillStyle = pg;
    c.fillRect(bCX - postW/2, postTop, postW, postBot - postTop);

    // Billboard border / frame
    c.fillStyle = '#222';
    c.fillRect(bCX - BW/2 - 8, panelT - 8, BW + 16, BH + 16);

    // Thin accent trim
    c.strokeStyle = '#444';
    c.lineWidth = 3;
    c.strokeRect(bCX - BW/2 - 8, panelT - 8, BW + 16, BH + 16);

    // Billboard image stretched to fill panel
    c.drawImage(this.billboardImg, bCX - BW/2, panelT, BW, BH);

    // Night vignette over image
    if(night > 0.1){
      c.globalAlpha = night * 0.45;
      c.fillStyle = '#000';
      c.fillRect(bCX - BW/2, panelT, BW, BH);
    }

    c.restore();
  },

  _drawFence(c,gy,night){
    const PW=14,GAP=26,PH=75,RH=10,RT=gy-52,RB=gy-22;
    const bv=Math.round(248*(1-night*.55));
    const dc = this._fenceColor; // diamond override
    c.save();c.shadowColor='rgba(0,0,0,.22)';c.shadowBlur=6;c.shadowOffsetX=2;c.shadowOffsetY=2;
    // Rails
    c.fillStyle = dc ? dc : `rgb(${bv},${bv},${bv})`;
    if (dc) { c.shadowColor = dc; c.shadowBlur = 12; }
    c.fillRect(0,RT,W,RH);c.fillRect(0,RB,W,RH);
    c.fillStyle=`rgba(0,0,0,${night>.2?.14:.06})`;c.fillRect(0,RT+RH-3,W,3);c.fillRect(0,RB+RH-3,W,3);
    // Pickets
    for(let x=0;x<W+PW;x+=PW+GAP){
      const v=Math.round(245*(1-night*.5));
      c.fillStyle = dc ? dc : `rgb(${v},${v},${v})`;
      if (dc) { c.shadowColor = dc; c.shadowBlur = 14; }
      c.beginPath();c.moveTo(x,gy-PH);c.lineTo(x+PW/2,gy-PH-16);c.lineTo(x+PW,gy-PH);c.lineTo(x+PW,gy+8);c.lineTo(x,gy+8);c.closePath();c.fill();
      c.strokeStyle = dc ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.48)';
      c.lineWidth=1;c.beginPath();c.moveTo(x+1.5,gy+6);c.lineTo(x+1.5,gy-PH);c.stroke();
    }c.restore();
  },

  _drawWxFX(c,w){
    c.save();
    this.wx.forEach(p=>{
      if(w==='rainy'||w==='stormy'){
        // Fat cartoon teardrop raindrop
        c.globalAlpha=p.op;
        const r=p.r||4, len=p.len||14;
        c.save();
        c.translate(p.x,p.y);
        c.rotate(Math.atan2(len,p.wx||1));
        // Drop body
        const dg=c.createLinearGradient(0,0,r*2,len);
        dg.addColorStop(0,p.col||'#88C8F0');
        dg.addColorStop(1,w==='stormy'?'rgba(60,140,220,.3)':'rgba(120,200,240,.2)');
        c.fillStyle=dg;
        c.beginPath();
        c.moveTo(0,0); // tip of drop at top
        c.bezierCurveTo(-r*1.2,len*.35,-r*1.4,len*.7,0,len);
        c.bezierCurveTo(r*1.4,len*.7,r*1.2,len*.35,0,0);
        c.fill();
        // Shine
        c.globalAlpha=p.op*.4;
        c.fillStyle='rgba(255,255,255,.6)';
        c.beginPath();c.ellipse(-r*.3,len*.2,r*.25,len*.18,0,0,Math.PI*2);c.fill();
        c.restore();
      }
      else if(w==='snowy'){
        // Big cartoony snowflake with 6 arms
        p.rot=(p.rot||0)+p.rotSpd;
        c.save();c.globalAlpha=p.op;c.translate(p.x,p.y);c.rotate(p.rot);
        const r=p.r||8;
        c.strokeStyle='rgba(220,240,255,.95)';c.lineWidth=Math.max(1.5,r*.18);c.lineCap='round';
        for(let a=0;a<6;a++){
          c.rotate(Math.PI/3);
          c.beginPath();c.moveTo(0,0);c.lineTo(0,r);c.stroke();
          // Branch marks
          c.beginPath();c.moveTo(0,r*.4);c.lineTo(r*.25,r*.55);c.stroke();
          c.beginPath();c.moveTo(0,r*.4);c.lineTo(-r*.25,r*.55);c.stroke();
          c.beginPath();c.moveTo(0,r*.7);c.lineTo(r*.2,r*.82);c.stroke();
          c.beginPath();c.moveTo(0,r*.7);c.lineTo(-r*.2,r*.82);c.stroke();
        }
        // Centre dot
        c.fillStyle='rgba(240,248,255,.9)';c.beginPath();c.arc(0,0,r*.18,0,Math.PI*2);c.fill();
        c.restore();
      }
      else if(w==='windy'){
        p.rot=(p.rot||0)+p.rotSpd;
        c.globalAlpha=p.op*Math.max(0,p.life);
        if(p.type==='obj'){
          // Flying cartoon object
          c.save();c.translate(p.x,p.y);c.rotate(p.rot);
          c.font=`${Math.round(p.len*.25+20)}px serif`;
          c.fillStyle='rgba(0,0,0,.55)'; // shadow
          c.fillText(p.emoji||'🍂',2,2);
          c.globalAlpha=Math.max(0,p.life)*p.op*6;
          c.fillText(p.emoji||'🍂',0,0);
          c.restore();
        } else {
          // Speed streak — multiple parallel lines for cartoon whoosh
          c.strokeStyle='rgba(180,210,240,.7)';c.lineWidth=p.lw||1.2;
          for(let j=0;j<3;j++){
            const off=j*8-8;
            c.globalAlpha=(p.op*Math.max(0,p.life))*(1-j*.3);
            c.beginPath();c.moveTo(p.x,p.y+off);
            c.quadraticCurveTo(p.x+p.len*.4,p.y+off+p.curve*.3,p.x+p.len,p.y+off+p.curve);
            c.stroke();
          }
        }
      }
    });
    c.restore();
  },

  _drawParticles(){
    const c=this.pCtx;
    c.clearRect(0,0,W,H);

    // Flying projectiles
    this.projectiles.forEach(p=>{
      if(p.landed)return;
      c.save();c.translate(p.x,p.y);
      if(p.type==='stick'){
        c.rotate(p.angle||0);
        const sg=c.createLinearGradient(-22,0,22,0);sg.addColorStop(0,'#5A2808');sg.addColorStop(.35,'#9A5A22');sg.addColorStop(.75,'#7A4012');sg.addColorStop(1,'#4A2206');
        c.fillStyle=sg;c.beginPath();
        if(c.roundRect)c.roundRect(-22,-3.5,44,7,3);else{c.rect(-22,-3.5,44,7);}
        c.fill();
        c.strokeStyle='rgba(0,0,0,.2)';c.lineWidth=.7;c.beginPath();c.moveTo(-18,-1);c.lineTo(18,-1);c.stroke();
        c.beginPath();c.moveTo(-16,1.5);c.lineTo(16,1.5);c.stroke();
      } else {
        c.rotate(p.spin||0);
        const bg=c.createRadialGradient(-4,-4,1,0,0,13);bg.addColorStop(0,'#58D68D');bg.addColorStop(.4,'#2ECC71');bg.addColorStop(1,'#1A8A4A');
        c.fillStyle=bg;c.beginPath();c.arc(0,0,13,0,Math.PI*2);c.fill();
        c.strokeStyle='rgba(255,255,255,.3)';c.lineWidth=1.5;
        c.beginPath();c.arc(0,0,13,-0.5,0.5);c.stroke();c.beginPath();c.arc(0,0,13,Math.PI-.5,Math.PI+.5);c.stroke();
        c.fillStyle='rgba(255,255,255,.38)';c.beginPath();c.ellipse(-4,-4,3.5,2,-.6,0,Math.PI*2);c.fill();
      }
      c.restore();
    });

    // Dirt + sparkles
    if(!this.particles.length)return;
    c.save();
    this.particles.forEach(p=>{
      if(p.glow){c.shadowColor=p.col;c.shadowBlur=12;}else c.shadowBlur=0;
      c.globalAlpha=p.alpha;c.fillStyle=p.col;
      c.beginPath();c.arc(p.x,p.y,Math.max(.5,p.r*p.alpha+.5),0,Math.PI*2);c.fill();
    });
    c.shadowBlur=0;c.restore();
  },

  _autoWeather(){this._wt=setInterval(()=>{const o=WEATHER_LIST.filter(w=>w!==this.target);this._setWeather(o[Math.floor(Math.random()*o.length)]);},AUTO_WEATHER_MS);},
  _setWeather(cond){if(!WEATHER_LIST.includes(cond)||cond===this.target)return;this.weather=this.target;this.target=cond;this.wt=0;this._mkWxParticles(cond);},
  _cycleWeather(){const i=WEATHER_LIST.indexOf(this.target);this._setWeather(WEATHER_LIST[(i+1)%WEATHER_LIST.length]);},

  _bind(){
    this.EventBus.on('event:game',        m=>this._onGame(m));

    // Pre-cache bg removal when favPup image URL arrives — zero delay on first walk
    this.EventBus.on('event:pupcore:state', ev => {
      const url = ev.state?.favPupImageURL;
      if (url && !this._bgCache.has(url)) {
        this._loadCachedImg(url)
          .then(img => { if (img) this._removeBgAsync(img, url); })
          .catch(() => {});
      }
    });

    this.EventBus.on('event:weather', m=>this._setWeather(m.weather));
    this.EventBus.on('demo:start',    ()=>this._demoOn());
    this.EventBus.on('demo:stop',     ()=>this._demoOff());
    this.EventBus.on('event:save_choctonaut', () => this._rescuePup());
    this.EventBus.on('event:gbm_result', ev => {
      this.gbmResult   = ev;
      this.gbmResultTs = Date.now();
    });
    this.EventBus.on('event:chest_lick', ev => {
      broadcast && true; // chest visual handled via DOM flash
    });
    this.EventBus.on('event:chest_new', () => {
      // chest image pulses when new lock starts
    });
    document.addEventListener('keydown',e=>{
      if(!this.demo)return;
      const map={'1':'toss','2':'throw','3':'dig','4':'walk','5':'fish'};
      if(map[e.key])this._triggerDemo(map[e.key]);
      else if(e.key.toLowerCase()==='w')this._cycleWeather();
      else if(e.key.toLowerCase()==='n')this.dayPhase=this.dayPhase>.5?0:1;
      else if(e.key.toLowerCase()==='r')this._clearAll();
    });
  },
  _pondTap(){this.tapN=(this.tapN||0)+1;clearTimeout(this.tapTimer);this.tapTimer=setTimeout(()=>this.tapN=0,600);if(this.tapN>=2){this.tapN=0;this.demo?this._demoOff():this._demoOn();}},
  _demoOn(){this.demo=true;this._showPopup({title:'🎮 DEMO MODE',subtitle:'1-5 games · W weather · N night · R clear'});},
  _demoOff(){this.demo=false;this._clearPopup();},
  _triggerDemo(game){const s=this.getRandomSprite&&this.getRandomSprite();this._onGame({command:game,user:'Demo'+(Math.floor(Math.random()*99)+1),pupId:s?.name,reward:Math.floor(Math.random()*90)+10,balance:Math.floor(Math.random()*2000),rarity:game==='fish'?rngRarity():undefined});},

  _onGame(msg){
    const cmd=(msg.command||'').toLowerCase();
    if(cmd==='walk'){this._enqueueWalk(msg);return;}
    if(this.gameQ[cmd]){this.gameQ[cmd].push(msg);if(!this.gameBusy[cmd])this._runQ(cmd);}
  },
  async _runQ(game){
    if(!this.gameQ[game].length){this.gameBusy[game]=false;return;}
    this.gameBusy[game]=true;
    const msg=this.gameQ[game].shift();
    // PupCore state drives the image. App.js already decided whether to feature
    // the fav pup (10% on toss/throw/dig, separate fish mechanic). When
    // msg.pcImageURL is set, we use it — no independent roll here.
    const sprite = this._resolveSprite(msg.pupId);
    const hero   = await this._resolveHeroImages(msg, sprite); // {animImg,popupImg,pupName,rarity}
    try{
      if(game==='toss')  await this._doToss(sprite,msg,hero);
      else if(game==='throw') await this._doThrow(sprite,msg,hero);
      else if(game==='dig')   await this._doDig(sprite,msg,hero);
      else if(game==='fish')  await this._doFish(msg,hero);
    }catch(e){
      console.error('[Yard] ERROR in', game, ':', e.message, e.stack);
      window.onerror && window.onerror('[Yard:'+game+'] '+e.message,'yard.js',0,0,e);
    }
    this._runQ(game);
  },
  // ── Generic sky config — set by PupCore Bot state, no blockchain logic ────────
  // ── Pre-rendered sky roll — built once, scrolled each frame ─────────────────
  // One full loop = weather_min_ms (15 min). Phases: midnight→dawn→noon→dusk→midnight.
  _buildSkyRoll(grassY) {
    try {
    const W = this.CONFIG?.layout?.width || 1920;
    // 16 segments × grassY px each → smooth 15-min scrolling loop
    const SEG  = Math.round(grassY);
    const SEGS = 16;
    const H    = SEG * SEGS;
    const cv   = document.createElement('canvas');
    cv.width   = W; cv.height = H;
    const c    = cv.getContext('2d');

    // Sky color phases for a full day cycle (top, bottom of sky) — 17 stops (0=16 wraps)
    const STOPS = [
      ['#03030f','#0a0825'],   //  0/16  deep night
      ['#06051a','#120f40'],   //  1/16  late night
      ['#0e0830','#1e1260'],   //  2/16  pre-dawn deep
      ['#2a0e5e','#8a2070'],   //  3/16  pre-dawn purple
      ['#8a2060','#e84c28'],   //  4/16  dawn break
      ['#c84828','#f5a030'],   //  5/16  sunrise
      ['#5090d8','#f8c870'],   //  6/16  early morning
      ['#3878c8','#a8d8f8'],   //  7/16  morning
      ['#1860c0','#78c8f0'],   //  8/16  noon
      ['#2070c8','#88d0f8'],   //  9/16  midday
      ['#2878c0','#a0c8e8'],   // 10/16  afternoon
      ['#3870a8','#d8a848'],   // 11/16  golden hour
      ['#c04820','#f06020'],   // 12/16  sunset
      ['#882050','#c84860'],   // 13/16  dusk
      ['#2a0e50','#5a1850'],   // 14/16  evening
      ['#0a0620','#18103a'],   // 15/16  night
      ['#03030f','#0a0825'],   // 16/16  deep night (= stop 0, seamless loop)
    ];

    for (let i = 0; i < SEGS; i++) {
      const y0  = i * SEG;
      const y1  = (i + 1) * SEG;
      // Vertical gradient within this segment: top of sky → horizon
      // Top colour blends from stops[i] to stops[i+1] across the segment
      const [t0, b0] = STOPS[i];
      const [t1, b1] = STOPS[i + 1];
      // Draw in 2 halves: top-to-mid and mid-to-bottom for 2D colour accuracy
      const midY = y0 + SEG / 2;
      let g = c.createLinearGradient(0, y0, 0, midY);
      g.addColorStop(0, t0); g.addColorStop(1, t1);
      c.fillStyle = g; c.fillRect(0, y0, W, SEG / 2);

      g = c.createLinearGradient(0, midY, 0, y1);
      g.addColorStop(0, b0); g.addColorStop(1, b1);
      c.fillStyle = g; c.fillRect(0, midY, W, SEG / 2);
    }

    this._skyRoll  = cv;
    this._skyRollH = H;
    this._skyStartMs = Date.now();
    console.log('[Yard] Sky roll built:', W + 'x' + H);
    } catch(e) {
      console.warn('[Yard] Sky roll failed, using gradient fallback:', e.message);
      this._skyRoll = null;
    }
  },

  // ── Called when a walker with a diamond color starts or ends ─────────────────
  _updateFenceCycle() {
    if (this._fenceTimer) { clearInterval(this._fenceTimer); this._fenceTimer = null; }
    const cols = [...new Set(this._walkerColors.filter(Boolean))];
    if (cols.length === 0)      { this._fenceColor = null; }
    else if (cols.length === 1) { this._fenceColor = cols[0]; }
    else {
      // Multiple fav pups with diamonds — cycle through their colors every 2s
      let idx = 0;
      this._fenceColor = cols[0];
      this._fenceTimer = setInterval(() => {
        idx = (idx + 1) % cols.length;
        this._fenceColor = cols[idx];
      }, 2000);
    }
  },

  _setSkyCfg(cfg) {
    if (!cfg) return;
    if (this._favSky) { Object.assign(this._favSky, cfg); return; }
    this._favSky = { ...cfg, alpha: 0 };
    const fade = () => {
      if (!this._favSky) return;
      this._favSky.alpha = Math.min(1, this._favSky.alpha + 0.04);
      if (this._favSky.alpha < 1) requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  },
  _clearSkyCfg() {
    if (!this._favSky || this._favSky._clearing) return;
    this._favSky._clearing = true;
    const fade = () => {
      if (!this._favSky) return;
      this._favSky.alpha = Math.max(0, this._favSky.alpha - 0.025);
      if (this._favSky.alpha > 0) requestAnimationFrame(fade);
      else { this._favSky = null; if (!this._walkerColors.length) this._fenceColor = null; }
    };
    requestAnimationFrame(fade);
  },
  _addSparkle(el, color) {
    if (!color || !el) return;
    const styleId = '__pcSparkle_' + color.replace('#','');
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style'); s.id = styleId;
      s.textContent = `@keyframes pcSpkl${styleId}{0%,100%{filter:drop-shadow(0 0 4px ${color});}50%{filter:drop-shadow(0 0 14px ${color}) brightness(1.15);}}`;
      document.head.appendChild(s);
    }
    el.style.animation = `pcSpkl${styleId} 1.4s ease-in-out infinite`;
  },
  // ── Image cache — localStorage-backed, blockchain-agnostic ───────────────────
  _loadCachedImg(url) {
    if (!url) return Promise.resolve(null);
    if (this._imgCache[url]) return Promise.resolve(this._imgCache[url]);
    if (typeof _nftImgPrewarm !== 'undefined' && _nftImgPrewarm[url]) {
      this._imgCache[url] = _nftImgPrewarm[url]; return Promise.resolve(this._imgCache[url]);
    }
    // Route remote/IPFS images through our same-origin proxy so bg removal (canvas
    // pixel access) works — direct loads fail CORS on most NFT gateways.
    const isRemote = /^(https?:|ipfs:|ar:)/i.test(url);
    const loadUrl  = isRemote ? ('/nftimg?url=' + encodeURIComponent(url)) : url;
    return new Promise(res => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => {
        this._imgCache[url] = img;
        try {
          const store = JSON.parse(localStorage.getItem('choctotv_nft_imgs') || '{}');
          store[url] = Date.now();
          for (const k of Object.keys(store)) if (store[k] < Date.now()-7*86400000) delete store[k];
          localStorage.setItem('choctotv_nft_imgs', JSON.stringify(store));
        } catch {}
        res(img);
      };
      img.onerror = () => { console.warn('[Yard] NFT image failed to load:', url); res(null); };
      img.src = loadUrl;
    });
  },

  // ── Background removal — async, cached per URL, never blocks main thread ──────
  // Uses requestIdleCallback so pixel processing runs in browser idle time.
  // Result cached forever so each NFT image is only processed once.
  _bgCache: new Map(),  // url → Promise<processedDataURL|null>

  _removeBgAsync(imgEl, url, num = null, tolerance = 38) {
    if (this._bgCache.has(url)) return this._bgCache.get(url);
    const p = new Promise(resolve => {
      // 1. If a saved <num>_nobg.png already exists on the server, use it (no reprocessing)
      const tryCached = () => {
        if (!num) { run(); return; }
        const cImg = new Image();
        cImg.onload = () => resolve(`/nobg/${num}_nobg.png`);
        cImg.onerror = () => run();   // not saved yet → process now
        cImg.src = `/nobg/${num}_nobg.png`;
      };
      const run = () => {
        try {
          const W = imgEl.naturalWidth || imgEl.width || 512;
          const H = imgEl.naturalHeight || imgEl.height || 512;
          // Work on a smaller copy to reduce pixel count (max 256px)
          const scale = Math.min(1, 256 / Math.max(W, H));
          const sw = Math.round(W * scale), sh = Math.round(H * scale);
          const cv  = document.createElement('canvas');
          cv.width  = sw; cv.height = sh;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(imgEl, 0, 0, sw, sh);
          const data = ctx.getImageData(0, 0, sw, sh);
          const d    = data.data;
          const idx  = (x,y) => (y*sw+x)*4;
          const diff = (i1, i2) => Math.abs(d[i1]-d[i2]) + Math.abs(d[i1+1]-d[i2+1]) + Math.abs(d[i1+2]-d[i2+2]);
          // Sample 4 corners as background candidates
          const corners = [idx(1,1), idx(sw-2,1), idx(1,sh-2), idx(sw-2,sh-2)];
          for (let i = 0; i < d.length; i += 4) {
            if (d[i+3] < 10 || corners.some(c => diff(i,c) < tolerance)) d[i+3] = 0;
          }
          ctx.putImageData(data, 0, 0);
          const out = cv.toDataURL('image/png');
          // Persist a copy as <num>_nobg.png so it survives + skips future reprocessing
          if (num) {
            try {
              fetch('/savenobg', { method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ num, dataUrl: out }) }).catch(()=>{});
            } catch {}
          }
          resolve(out);
        } catch { resolve(null); }
      };
      // Use idle callback so it never blocks animation frames
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(tryCached, { timeout: 2000 });
      } else {
        setTimeout(tryCached, 50);
      }
    });
    this._bgCache.set(url, p);
    return p;
  },


  _resolveSprite(pupIdOrName){
    // Prefer name-based lookup (exact PNG file match) sent by server
    const byName = (pupIdOrName && typeof pupIdOrName==='string' && this.getSpriteByName)
      ? this.getSpriteByName(pupIdOrName) : null;
    const s = byName
      || (pupIdOrName && this.getSpriteByPupId && this.getSpriteByPupId(pupIdOrName))
      || (this.getRandomSprite && this.getRandomSprite())
      || null;
    if(!s) console.warn('[Yard] _resolveSprite null for',pupIdOrName);
    return s;
  },
  // Resolve the ONE pup shown in both animation and popup so they always match.
  //  • Fav pup set  → animation uses background-REMOVED image, popup uses original (with bg)
  //  • No fav pup   → random sprite (already transparent) used for both
  // Returns { animImg, popupImg, pupName, rarity } — animImg/popupImg are <img> elements (or null).
  async _resolveHeroImages(msg, sprite){
    const pupName = msg.pupName || sprite?.name || 'Pup';
    const rarity  = (msg.rarity || sprite?.rarity || 'common').toLowerCase();
    if (msg.pcImageURL) {
      let orig = null;
      try { orig = await this._loadCachedImg(msg.pcImageURL); } catch {}
      if (orig) {
        let animImg = orig; // animation: background removed
        try {
          const noBgSrc = await this._removeBgAsync(orig, msg.pcImageURL, msg.favPup?.num || null);
          if (noBgSrc) { const i = new Image(); i.src = noBgSrc; try { await i.decode(); } catch {} animImg = i; }
        } catch {}
        return { animImg, popupImg: orig, pupName, rarity }; // popup: original WITH bg
      }
      console.warn('[Yard] Fav pup image failed to load, using sprite fallback:', msg.pcImageURL);
    }
    // No fav (or fav failed) → random sprite, same transparent image for both
    let simg = null;
    try { simg = sprite ? await this.getImageForSprite(sprite) : null; } catch {}
    if (!simg && sprite) console.warn('[Yard] Sprite image failed to load:', sprite.name);
    return { animImg: simg, popupImg: simg, pupName, rarity };
  },

  // ── Fav pup image loader — memory cache + localStorage URL persistence ───────
  // ── Sky effect manager — guarded rAF to prevent stacked loops ──────────────
  // ── Sparkle CSS animation injected onto a pup element ────────────────────
  // ── TOSS — stick arcs across yard, pup slides to it and back ─────────────────
  async _doToss(sprite,msg,hero){
    const{grassY}=this.CONFIG.layout;
    const sz=180, img=hero.animImg;
    const startX=rand(140,480), startY=grassY+85;
    const el=this._mkPupEl(img,'',startX-sz/2,startY-sz,sz,sz);
    const lb=this._mkLbl(msg.user,hero.pupName,startX,startY-sz-8);
    this.spriteLayer.append(el,lb);

    const proj={type:'stick',x:startX+sz*.35,y:startY-sz*.5,
      vx:rand(6,8),vy:-rand(7,10),grav:.22,angle:0,landed:false};
    this.projectiles.push(proj);
    await this._waitLand(proj);
    // Pup slides to stick
    lb.style.left=`${proj.landX}px`;lb.style.top=`${proj.landY-sz-8}px`;
    await this._moveTo(el,startX,startY,proj.landX,proj.landY,sz,5.5,startX);
    await delay(200);
    this.projectiles=this.projectiles.filter(p=>p!==proj);

    // Pup slides back
    lb.style.left=`${startX}px`;lb.style.top=`${startY-sz-8}px`;
    await this._moveTo(el,proj.landX,proj.landY,startX,startY,sz,5.5,proj.landX);

    el.remove();lb.remove();
    this._floatReward(startX, startY - sz - 20, msg.reward);
    await this._showPopup({title:GAME_LABEL.toss,user:msg.user,reward:msg.reward,balance:msg.balance,imgEl:hero.popupImg,pupName:hero.pupName,rarityColor:RARITY_COL[hero.rarity]});
    await delay(2500);this._clearPopup();
  },

  // ── THROW — ball arcs across yard, pup slides to it and back ─────────────────
  async _doThrow(sprite,msg,hero){
    const{grassY}=this.CONFIG.layout;
    const sz=180, img=hero.animImg;
    const startX=rand(100,380), startY=grassY+85;
    const el=this._mkPupEl(img,'',startX-sz/2,startY-sz,sz,sz);
    const lb=this._mkLbl(msg.user,hero.pupName,startX,startY-sz-8);
    this.spriteLayer.append(el,lb);

    const proj={type:'ball',x:startX+sz*.4,y:startY-sz*.55,
      vx:rand(7,9),vy:-rand(8,11),grav:.24,spin:0,landed:false};
    this.projectiles.push(proj);
    await this._waitLand(proj);
    lb.style.left=`${proj.landX}px`;lb.style.top=`${proj.landY-sz-8}px`;
    await this._moveTo(el,startX,startY,proj.landX,proj.landY,sz,5.5,startX);
    await delay(200);
    this.projectiles=this.projectiles.filter(p=>p!==proj);

    lb.style.left=`${startX}px`;lb.style.top=`${startY-sz-8}px`;
    await this._moveTo(el,proj.landX,proj.landY,startX,startY,sz,5.5,proj.landX);

    el.remove();lb.remove();
    this._floatReward(startX, startY - sz - 20, msg.reward);
    await this._showPopup({title:GAME_LABEL.throw,user:msg.user,reward:msg.reward,balance:msg.balance,imgEl:hero.popupImg,pupName:hero.pupName,rarityColor:RARITY_COL[hero.rarity]});
    await delay(2500);this._clearPopup();
  },

  // ── DIG — pup wiggles, dirt flies, leaves a persistent hole ──────────────────
  async _doDig(sprite,msg,hero){
    const{grassY}=this.CONFIG.layout;
    const sz=180, img=hero.animImg;
    const x=this._rndX(), py=grassY+42;
    const feetX=x+sz/2, feetY=py+sz-8;
    const el=this._mkPupEl(img,'',x,py,sz,sz);
    el.style.animation='yDig .8s ease-in-out infinite';
    el.style.transformOrigin='bottom center';
    const lb=this._mkLbl(msg.user,hero.pupName,x+sz/2,py-8);
    this.spriteLayer.append(el,lb);

    let digging=true;
    const spawnDirt=()=>{if(!digging)return;for(let i=0;i<8;i++)this.particles.push(mkDirt(feetX,feetY));setTimeout(spawnDirt,140);};
    spawnDirt();
    await delay(2800);
    digging=false;

    this._addHole(feetX,feetY+10);
    el.remove();lb.remove();
    this._floatReward(feetX, py - 30, msg.reward);
    await this._showPopup({title:GAME_LABEL.dig,user:msg.user,reward:msg.reward,balance:msg.balance,imgEl:hero.popupImg,pupName:hero.pupName,rarityColor:RARITY_COL[hero.rarity]});
    await delay(2500);this._clearPopup();
  },

  // ── FISH — emoji bounces → rarity wiggle → pup PNG rises ─────────────────────
  async _doFish(msg,hero){
    // Fish CATCHES a pup. Priority: caught player's fav → own fav (hero) → random sprite.
    let imgOverride = hero?.animImg || null;          // animation image (bg-removed)
    let popupOverride = hero?.popupImg || null;        // popup image (with bg)
    let caughtName  = (msg.pcImageURL ? hero?.pupName : null) || null;
    if (msg.fishCatchFav?.imageUrl) {
      try {
        const caughtImg = await this._loadCachedImg(msg.fishCatchFav.imageUrl);
        if (caughtImg) {
          popupOverride = caughtImg;
          caughtName = msg.fishCatchFav.name || caughtName;
          let anim = caughtImg;
          try { const nb = await this._removeBgAsync(caughtImg, msg.fishCatchFav.imageUrl, msg.fishCatchFav.num || null); if (nb){const i=new Image();i.src=nb;try{await i.decode();}catch{}anim=i;} } catch {}
          imgOverride = anim;
        }
      } catch {}
    }
    const{pondX,pondY}=this.CONFIG.layout;
    const r=(msg.rarity||rngRarity()).toLowerCase();

    const emo=document.createElement('div');
    emo.style.cssText=`position:absolute;left:${pondX-50}px;top:${pondY-210}px;font-size:105px;line-height:1;animation:yFishBounce 1.2s ease-in-out infinite;transform-origin:bottom center;user-select:none;`;
    emo.textContent='🎣';
    this.spriteLayer.appendChild(emo);
    const lb=this._mkLbl(msg.user,caughtName,pondX,pondY-180);
    this.spriteLayer.appendChild(lb);

    // Bouncing phase
    await delay(2000+rand(0,400));

    // Bite — switch to rarity-appropriate wiggle
    const wiggleAnim={
      common:   null,
      uncommon: 'yBite1 .5s ease-in-out infinite',
      rare:     'yBite2 .38s ease-in-out infinite',
      epic:     'yBite3 .28s ease-in-out infinite',
      legendary:'yBite4 .2s ease-in-out infinite',
    };
    const anim=wiggleAnim[r];
    if(anim){emo.style.animation=anim;}
    else{emo.style.animation='none';emo.style.transform='rotate(-5deg)';}

    // Sparkles for rare+
    const scfg=FISH_SPARKLE[r];
    if(scfg){
      const bx=pondX+rand(-100,100),by=pondY-50; // wider spread on bigger pond
      for(let i=0;i<scfg.n;i++)this.particles.push(mkFishSparkle(bx,by,scfg));
      if(r==='legendary'){
        for(let a=0;a<Math.PI*2;a+=Math.PI/10){
          this.particles.push({x:bx,y:by,vx:Math.cos(a)*scfg.spd*.7,vy:Math.sin(a)*scfg.spd*.7-1,r:10,col:'#ffd700',alpha:1,life:0,maxLife:60,grav:.07,glow:true});
        }
      }
    }

    await delay(1000);
    emo.style.transition='opacity .6s';emo.style.opacity='0';
    lb.remove();
    await delay(420);
    emo.remove();

    // Use the specific pup companion.js picked (so chat + overlay match), fallback to random
    const catchSprite=(msg.catchPupId!=null&&this.getSpriteByPupId&&this.getSpriteByPupId(msg.catchPupId))
      ||(this.getRandomSprite&&(this.getRandomSprite(r)||this.getRandomSprite()))||null;
    // Animation image: fav/caught (bg-removed) or the random catch sprite (already transparent)
    const catchImg   = imgOverride   || (catchSprite ? await this.getImageForSprite(catchSprite) : null);
    const catchPopup = popupOverride || catchImg;  // popup keeps background
    const finalName  = caughtName || catchSprite?.name || 'Pup';
    const csz = 160;

    if (catchImg) {
      const cel = document.createElement('img');
      cel.src = catchImg.src || catchImg;
      cel.style.cssText = `position:absolute;left:${pondX-csz/2}px;top:${pondY-csz-10}px;width:${csz}px;height:${csz}px;image-rendering:auto;animation:yCatch 1.0s cubic-bezier(.34,1.56,.64,1) both;`;
      this.spriteLayer.appendChild(cel);
      const clb = this._mkLbl(msg.user, finalName, pondX, pondY - csz - 18);
      this.spriteLayer.appendChild(clb);
      this._floatReward(pondX, pondY - csz - 30, msg.reward);
      await this._showPopup({
        title: `🎣 ${cap(r)} Catch!`,
        user: msg.user, reward: msg.reward, balance: msg.balance,
        imgEl: catchPopup, pupName: finalName, rarityColor: RARITY_COL[r],
      });
      await delay(2500); cel.remove(); clb.remove(); this._clearPopup();
    } else {
      this._floatReward(pondX, pondY - 200, msg.reward);
      await this._showPopup({ title: GAME_LABEL.fish, user: msg.user, reward: msg.reward, balance: msg.balance });
      await delay(2500); this._clearPopup();
    }
  },

  // ── WALK — perimeter loop ─────────────────────────────────────────────────────
  _enqueueWalk(msg){
    if(this.walkBlocked.has(msg.user)){return;}
    if(this.walkers.length>=MAX_WALKERS){this.walkQ.push(msg);return;}
    this._spawnWalker(msg);
  },
  async _spawnWalker(msg){
    this.walkBlocked.add(msg.user);

    const fav    = msg.favPup; // set if user ran !setfav
    const hasFav = fav && (fav.imageUrl || fav.background || fav.diamonds);

    // Image — use NFT if available, else resolve random sprite as always
    let img = null, sprite = null;
    if (hasFav && fav.imageUrl) {
      img = await this._loadCachedImg(fav.imageUrl);
    }
    if (!img) {
      sprite = this._resolveSprite(msg.pupId);
      img    = sprite ? await this.getImageForSprite(sprite) : null;
    }

    // pcSky / dcol — fav pup sky config and diamond sparkle color
    const pcSky = hasFav ? (fav.pcSkyConfig || null) : null;
    const dcol  = pcSky?.diamonds?.color || pcSky?.fenceColor || null;
    // Apply sky + fence effects for this user's fav pup walk
    if (hasFav) this._setSkyCfg(fav.pcSkyConfig);
    // Set fence glow color (diamond trait) — was computed but never applied
    if (dcol) { this._fenceColor = dcol; this._drawNeeded = true; }

    // Background removal — start async processing, walker shows original meanwhile.
    // When done, the walker's <img> src is swapped in-place (no freeze).
    let bgPromise = null;
    const favUrl  = fav?.imageUrl || null;
    if (img && hasFav && favUrl) {
      bgPromise = this._removeBgAsync(img, favUrl, fav?.num || null);
    }
    const sz=130;
    const wrap=document.createElement('div');wrap.style.cssText=`position:absolute;width:${sz}px;height:${sz}px;`;
    const inner=document.createElement(img?'img':'div');
    if(img){inner.src=img.src||img;inner.style.cssText='width:100%;height:100%;image-rendering:pixelated;';}
    else{inner.style.cssText=`width:100%;height:100%;background:${RARITY_COL[(sprite?.rarity||'common').toLowerCase()]||'#4ecdc4'};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:54px;`;inner.textContent='🐾';}
    inner.style.animation='yWalk .48s ease-in-out infinite';
    if (dcol) this._addSparkle(inner, dcol);
    wrap.appendChild(inner);this.spriteLayer.appendChild(wrap);

    const lb=document.createElement('div');lb.className='yUser';
    const _wPup = msg.pupName || sprite?.name || null;
    lb.textContent = _wPup ? `@${msg.user} (${_wPup})` : ('@'+msg.user);
    lb.style.animation='none';
    this.spriteLayer.appendChild(lb);

    const startOffset=this.walkers.length*(Math.floor(this.walkPath.length/(MAX_WALKERS)));
    const walkerEntry = {user:msg.user,wrap,inner,lb,sz,msg,sprite,popupImg:(hasFav&&fav.imageUrl)?img:null,pupName:(msg.pupName||sprite?.name||null),pathIdx:startOffset,totalSteps:0,done:false,totalPath:this.walkPath.length,hasPcSky:!!pcSky,_dcol:dcol||null};
    this.walkers.push(walkerEntry);
    if (dcol) { this._walkerColors.push(dcol); this._updateFenceCycle(); }
    // Swap to bg-removed image when idle processing completes
    // Preserve original (with-bg) image for the popup, then swap the walking sprite to bg-removed
    if (img && (hasFav && fav.imageUrl)) {
      const orig = new Image(); orig.src = img.src || img; walkerEntry.popupImg = orig;
    }
    if (bgPromise && inner.tagName === 'IMG') {
      bgPromise.then(noBg => {
        if (noBg && !walkerEntry.done) inner.src = noBg;
      }).catch(()=>{});
    }
  },
  _tickWalkers(dt){
    if (this.queuesHeld) return; // paused during rescue
    const path=this.walkPath;if(!path?.length)return;
    const{grassY,puppyWarsY}=this.CONFIG.layout;
    const pathTop=grassY+72,pathBot=puppyWarsY-48;
    const done=[];
    this.walkers.forEach(w=>{
      if(w.done)return;
      const step=0.023*dt; // 3-minute perimeter loop at 60fps
      w.pathIdx+=step;w.totalSteps+=step;
      if(w.totalSteps>=w.totalPath){w.done=true;done.push(w);return;}
      const idx=Math.floor(w.pathIdx)%path.length,nextIdx=(idx+1)%path.length,frac=w.pathIdx%1;
      const pt=path[idx],nt=path[nextIdx];
      const px=Math.round(lerp(pt.x,nt.x,frac)),py=Math.round(lerp(pt.y,nt.y,frac));
      const depth=(py-pathTop)/Math.max(1,pathBot-pathTop);
      const scale=lerp(0.72,1,clamp(depth,0,1));
      const bob=Math.sin(w.pathIdx*.22)*5;
      const flip=nt.x<pt.x;
      w.wrap.style.left=`${px-w.sz/2}px`;w.wrap.style.top=`${py-w.sz+bob}px`;
      w.wrap.style.transform=`scale(${scale})`;w.inner.style.transform=flip?'scaleX(-1)':'scaleX(1)';
      w.lb.style.left=`${px}px`;w.lb.style.top=`${Math.round(py - w.sz + w.sz*(1-scale)/2 - 24)}px`;
    });
    // Check all walkers for hole collision — only while queues not held
    if (!this.pupInHole) {
      for (const w of this.walkers) {
        if (w.done) continue;
        const path=this.walkPath; if(!path?.length) continue;
        const idx=Math.floor(w.pathIdx)%path.length;
        const pt=path[idx];
        for (const h of this.holes) {
          if (h.alpha < 0.1 || h.evicting) continue;
          const dx=pt.x-h.x, dy=pt.y-h.y;
          if (Math.abs(dx)<h.rx*1.2 && Math.abs(dy)<h.ry*1.8) {
            // Pup fell in hole!
            this._pupFellInHole(w, h);
            break;
          }
        }
        if (this.pupInHole) break;
      }
    }

    done.forEach(async w=>{
      w.wrap.remove();w.lb.remove();
      this.walkers=this.walkers.filter(x=>x!==w);
      this.walkBlocked.delete(w.user);
      if (w.hasPcSky) this._clearSkyCfg();
      this._floatReward(w.wrap._x||900, (this.CONFIG.layout.grassY||310) - 40, w.msg.reward);
      {
        let _popImg = w.popupImg;
        if (!_popImg && w.sprite) { try { _popImg = await this.getImageForSprite(w.sprite); } catch {} }
        this._showPopup({title:GAME_LABEL.walk,user:w.msg.user,reward:w.msg.reward,balance:w.msg.balance,imgEl:_popImg,pupName:w.pupName,rarityColor:RARITY_COL[(w.msg.rarity||w.sprite?.rarity||'common').toLowerCase()]});
      }
      setTimeout(()=>this._clearPopup(),2500);
      if(this.walkQ.length)this._spawnWalker(this.walkQ.shift());
    });
    this.walkers=this.walkers.filter(w=>!w.done);
  },

  // ── Hole collision ───────────────────────────────────────────────────────────────
  _pupFellInHole(walker, hole) {
    if (this.pupInHole) return;
    this.pupInHole  = true;
    this.queuesHeld = true;
    console.log('[Yard] Pup fell in hole! Queues paused. Type !SaveChoctonaut');

    // Sink the pup element into the hole
    walker.el.style.transition='transform 0.5s ease, opacity 0.5s';
    walker.el.style.transform ='scale(0.3) translateY(40px)';
    walker.el.style.opacity   ='0.3';
    walker.lb.style.opacity   ='0';

    // Show dramatic save warning
    const warn = document.createElement('div');
    warn.style.cssText = [
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
      'background:rgba(200,30,30,.95);border:4px solid #ff6b6b;border-radius:16px;',
      'padding:30px 60px;text-align:center;',
      'font-family:"Segoe UI",system-ui,sans-serif;',
      'box-shadow:0 0 60px rgba(255,50,50,.8),0 0 120px rgba(255,50,50,.4);',
      'animation:yPin .3s cubic-bezier(.34,1.56,.64,1) both;',
      'z-index:999;',
    ].join('');
    warn.innerHTML = `
      <div style="font-size:72px;margin-bottom:10px;">🐾⚠️</div>
      <div style="font-size:42px;font-weight:900;color:#fff;text-shadow:0 0 20px rgba(255,200,200,.8);">
        CHOCTONAUT IN A HOLE!
      </div>
      <div style="font-size:28px;color:#ffcccc;margin-top:10px;">
        Type <strong style="color:#fff;">!SaveChoctonaut</strong> to rescue!
      </div>
    `;
    this.popupLayer.appendChild(warn);
    this.savePopup = warn;
  },

  _rescuePup() {
    if (!this.pupInHole) return;
    this.pupInHole  = false;
    this.queuesHeld = false;

    // Restore all walkers
    this.walkers.forEach(w => {
      w.el.style.transition='transform 0.4s ease, opacity 0.4s';
      w.el.style.transform='';
      w.el.style.opacity='1';
      w.lb.style.opacity='1';
    });

    if (this.savePopup) {
      this.savePopup.style.animation='yPout .3s ease forwards';
      setTimeout(()=>{ if(this.savePopup){this.savePopup.remove();this.savePopup=null;} },300);
    }
    console.log('[Yard] Pup rescued! Queues resumed.');
  },

  // ── GBM result overlay ────────────────────────────────────────────────────────
  _drawGBMResult(c) {
    if (!this.gbmResult) return;
    if (Date.now() - this.gbmResultTs > 6000) { this.gbmResult=null; return; }
    const r   = this.gbmResult;
    const age = (Date.now()-this.gbmResultTs)/6000;
    const alpha = age < 0.8 ? 1 : 1-(age-0.8)/0.2;
    const cx=W/2, cy=200;

    c.save(); c.globalAlpha=alpha;
    // Background box
    c.fillStyle='rgba(10,10,30,.92)';
    c.strokeStyle='rgba(180,100,255,.8)';
    c.lineWidth=3;
    const bx=cx-400, bw=800, by=cy-60, bh=160;
    c.beginPath(); c.roundRect(bx,by,bw,bh,14); c.fill(); c.stroke();

    c.fillStyle='#e8b4ff'; c.font='bold 28px Consolas,monospace'; c.textAlign='center';
    c.fillText(`🎮 GoodBallMoon — ${r.winningPick} wins!`, cx, cy-20);
    c.fillStyle='#fff'; c.font='22px Consolas,monospace';
    c.fillText(
      `🏆 ${r.winners.length} winners +${r.winReward}🍫  |  🤝 ${r.ties.length} ties +${r.tieReward}🍫  |  💀 ${r.losers.length} out`,
      cx, cy+22
    );
    if (r.winners.length && r.winners.length <= 6) {
      c.fillStyle='rgba(255,255,255,.6)'; c.font='18px Consolas,monospace';
      c.fillText(r.winners.map(u=>'@'+u).join(' '), cx, cy+60);
    }
    c.restore();
  },

  // ── Chest draw ───────────────────────────────────────────────────────────────
  _drawChest(c, grassY, puppyWarsY) {
    if (!this.chestImg) return;
    const CW=140, CH=140;
    const cx=100, cy=puppyWarsY-CH-20;
    c.drawImage(this.chestImg, cx, cy, CW, CH);
  },

  // ── Popup ─────────────────────────────────────────────────────────────────────
  _floatReward(x, y, reward) {
    if (!reward) return;
    const el = document.createElement('div');
    el.style.cssText = [
      `position:absolute`,
      `left:${x}px`,
      `top:${y}px`,
      `font-size:38px`,
      `font-weight:900`,
      `color:#ffd700`,
      `text-shadow:0 0 20px rgba(255,215,0,.9),0 0 40px rgba(255,140,0,.6),0 2px 8px rgba(0,0,0,1)`,
      `white-space:nowrap`,
      `pointer-events:none`,
      `z-index:999`,
      `animation:yFloat 2.8s cubic-bezier(.25,.46,.45,.94) forwards`,
      `letter-spacing:1px`,
    ].join(';');
    el.textContent = `+${(reward||0).toLocaleString('en-US')} 🍫`;
    this.spriteLayer.appendChild(el);
    setTimeout(() => el.remove(), 2900);
  },

  async _showPopup({title,subtitle,user,reward,balance,imgEl,pupName,rarityColor}){
    this._clearPopup();
    const col=rarityColor||'#4ecdc4',bot=this.CONFIG.layout.popupBottom;
    const img=imgEl||null;  // popup shows the WITH-background image (fav) or sprite
    const pop=document.createElement('div');
    pop.style.cssText=`position:absolute;bottom:${bot}px;right:calc(50% + 155px);background:linear-gradient(135deg,rgba(5,5,15,.97),rgba(15,15,35,.99));border:2px solid ${col};border-radius:18px;padding:22px 36px;display:flex;align-items:center;gap:18px;min-width:320px;max-width:460px;box-shadow:0 0 50px ${col}55,0 8px 32px rgba(0,0,0,.7);animation:yPin .3s cubic-bezier(.34,1.56,.64,1) both;`;
    if(img){const th=document.createElement('img');th.src=img.src||img;th.style.cssText='width:104px;height:104px;border-radius:10px;flex-shrink:0;object-fit:cover;border:1px solid '+col+'55;';pop.appendChild(th);}
    const txt=document.createElement('div');txt.style.cssText='flex:1;min-width:0;';
    txt.innerHTML=`<div style="font-size:30px;font-weight:700;color:${col};text-shadow:0 0 14px ${col}66;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>${subtitle?`<div style="font-size:18px;color:#999;margin-top:2px;">${subtitle}</div>`:''}${(user||pupName)?`<div style="font-size:24px;color:#eee;margin-top:6px;">${user?'@'+user:''}${pupName?` <span style="color:${col};">(${pupName})</span>`:''}</div>`:''}${reward?`<div style="font-size:20px;color:#ffd700;margin-top:4px;">+${reward} Choctobits${balance!=null?` <span style="color:#888;font-size:17px;">· bal: ${balance}</span>`:''}</div>`:''}`;
    pop.appendChild(txt);this.popupLayer.appendChild(pop);this.popup=pop;return pop;
  },
  _clearPopup(){if(!this.popup)return;const el=this.popup;this.popup=null;el.style.animation='yPout .25s ease forwards';setTimeout(()=>el.remove(),280);},

  _mkPupEl(img,cls,x,y,w,h){
    const el=document.createElement(img?'img':'div');
    if(img){el.src=img.src;}else{el.style.background='#4ecdc4';el.style.borderRadius='12px';el.style.display='flex';el.style.alignItems='center';el.style.justifyContent='center';el.style.fontSize='52px';el.textContent='🐾';}
    if(cls)el.className=cls;
    el.style.cssText=(el.style.cssText||'')+`;position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;image-rendering:pixelated;`;
    return el;
  },
  _mkLbl(user,pupName,cx,cy){const d=document.createElement('div');d.className='yUser';d.textContent=pupName?`@${user} (${pupName})`:('@'+user);d.style.left=`${cx}px`;d.style.top=`${cy}px`;return d;},
  _clearAll(){
    this.particles=[];this.projectiles=[];this.movers=[];
    this.walkers.forEach(w=>{try{w.wrap.remove();w.lb.remove();}catch{}});
    this.walkers=[];this.walkBlocked.clear();
    this.spriteLayer.innerHTML='';
    this._clearPopup();
  },
  _rndX(){const m=this.CONFIG.layout.safeMarginX;return Math.floor(Math.random()*(W-m*2-180))+m;},
};

export default Yard;
