// YardPets3 — modules/settings/settings.js
import { CONFIG, reconnectWS } from '../../renderer.js';

const Settings = {
  mount:null, EventBus:null, panel:null, visible:false,

  async init({mount,EventBus}){
    this.mount=mount; this.EventBus=EventBus;
    this.mount.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:9998;';
    this.buildPanel();
    this.bindEvents();
  },

  buildPanel(){
    if(!document.getElementById('sp-css')){
      const s=document.createElement('style');s.id='sp-css';
      s.textContent=`
        .sp-tab{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#888;padding:7px 18px;font-size:13px;font-family:inherit;cursor:none;}
        .sp-tab:hover{background:rgba(255,255,255,.09);color:#ddd;}
        .sp-tab.on{background:rgba(78,205,196,.15);border-color:rgba(78,205,196,.5);color:#4ecdc4;}
        .sp-btn{background:rgba(78,205,196,.15);border:1px solid rgba(78,205,196,.5);border-radius:8px;color:#4ecdc4;padding:9px 22px;font-size:14px;font-family:inherit;cursor:none;}
        .sp-input{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:9px 14px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;}
        .sp-input:focus{border-color:rgba(78,205,196,.5);}
        .sp-tog{position:relative;width:44px;height:24px;flex-shrink:0;}
        .sp-tog input{opacity:0;width:0;height:0;}
        .sp-tr{position:absolute;inset:0;background:rgba(255,255,255,.1);border-radius:12px;cursor:none;transition:background .2s;}
        .sp-tog input:checked+.sp-tr{background:rgba(78,205,196,.6);}
        .sp-tr::after{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s;}
        .sp-tog input:checked+.sp-tr::after{transform:translateX(20px);}
      `;
      document.head.appendChild(s);
    }

    this.panel=document.createElement('div');
    this.panel.style.cssText='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:640px;background:linear-gradient(160deg,rgba(8,8,18,.98),rgba(12,8,24,.99));border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:30px;display:none;pointer-events:all;color:#fff;font-family:Segoe UI,system-ui,sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.85);';

    this.panel.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;">
        <div><div style="font-size:19px;font-weight:700;color:#4ecdc4;">⚙️ YardPets Settings</div><div style="font-size:12px;color:#555;margin-top:2px;">Cloud Mode</div></div>
        <button id="sp-close" style="background:none;border:none;color:#555;font-size:22px;cursor:none;line-height:1;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#555'">✕</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:22px;">
        <button class="sp-tab on" data-tab="network">Network</button>
        <button class="sp-tab"    data-tab="overlay">Overlay</button>
      </div>

      <div id="sp-network">
        <div style="margin-bottom:14px;"><div style="font-size:12px;color:#666;margin-bottom:5px;letter-spacing:.04em;">WEBSOCKET PORT</div><input id="sp-ws" class="sp-input" type="number" value="${CONFIG.wsPort}"></div>
        <div style="margin-bottom:14px;"><div style="font-size:12px;color:#666;margin-bottom:5px;letter-spacing:.04em;">API PORT</div><input id="sp-api" class="sp-input" type="number" value="${CONFIG.apiPort}"></div>
        <div id="sp-preview" style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px 14px;font-size:12px;color:#666;margin-bottom:18px;font-family:monospace;"></div>
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="sp-btn" id="sp-save">Save &amp; Reconnect</button>
          <span id="sp-ok" style="font-size:13px;color:#4ecdc4;opacity:0;transition:opacity .3s;"></span>
        </div>
      </div>

      <div id="sp-overlay" style="display:none;">
        <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <div><div style="font-size:14px;color:#ddd;">Price Ticker</div><div style="font-size:12px;color:#555;">BTC/ETH/SOL/DOGE bottom bar</div></div>
          <label class="sp-tog"><input type="checkbox" id="sp-ticker" checked><div class="sp-tr"></div></label>
        </label>
        <label style="display:flex;align-items:center;justify-content:space-between;">
          <div><div style="font-size:14px;color:#ddd;">Demo Mode</div><div style="font-size:12px;color:#555;">1–5 games · W weather · R reset</div></div>
          <label class="sp-tog"><input type="checkbox" id="sp-demo"><div class="sp-tr"></div></label>
        </label>
      </div>
    `;

    this.mount.appendChild(this.panel);

    // Close
    this.panel.querySelector('#sp-close').onclick=()=>this.hide();

    // Tabs
    this.panel.querySelectorAll('.sp-tab').forEach(btn=>{
      btn.onclick=()=>{
        this.panel.querySelectorAll('.sp-tab').forEach(b=>b.classList.remove('on'));
        btn.classList.add('on');
        this.panel.querySelector('#sp-network').style.display=btn.dataset.tab==='network'?'block':'none';
        this.panel.querySelector('#sp-overlay').style.display=btn.dataset.tab==='overlay'?'block':'none';
      };
    });

    // Preview
    const ws=this.panel.querySelector('#sp-ws'),api=this.panel.querySelector('#sp-api'),prev=this.panel.querySelector('#sp-preview');
    const upd=()=>prev.textContent=`WS: ws://${window.location.hostname}:${ws.value}  API: http://${window.location.hostname}:${api.value}`;
    ws.oninput=api.oninput=upd; upd();

    // Save
    this.panel.querySelector('#sp-save').onclick=()=>{
      const w=parseInt(ws.value),a=parseInt(api.value);
      if(!isNaN(w)&&w>0)CONFIG.wsPort=w;
      if(!isNaN(a)&&a>0)CONFIG.apiPort=a;
      reconnectWS();
      const ok=this.panel.querySelector('#sp-ok');
      ok.textContent='✓ Reconnecting...';ok.style.opacity='1';
      setTimeout(()=>ok.style.opacity='0',2500);
    };

    // Toggles
    this.panel.querySelector('#sp-ticker').onchange=e=>this.EventBus.emit('ticker:toggle',{visible:e.target.checked});
    this.panel.querySelector('#sp-demo').onchange=e=>this.EventBus.emit(e.target.checked?'demo:start':'demo:stop',{});
  },

  bindEvents(){
    this.EventBus.on('event:settings',()=>this.toggle());
    document.addEventListener('keydown',e=>{
      if(e.ctrlKey&&e.key==='s'){e.preventDefault();this.toggle();}
      if(e.key==='Escape'&&this.visible)this.hide();
    });
  },

  toggle(){ this.visible?this.hide():this.show(); },
  show(){ this.visible=true; this.panel.style.display='block'; this.mount.style.pointerEvents='all'; },
  hide(){ this.visible=false; this.panel.style.display='none'; this.mount.style.pointerEvents='none'; },
};
export default Settings;
