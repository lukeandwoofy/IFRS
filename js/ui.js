// js/ui.js

import { auth } from './firebase-config.js';

/* =============================================================================
   IFRS — Airbus-style UI and Systems
   - Controls/pedestal permanently on left
   - Tabs/pages permanently on right
   - Cold & Dark enforced — no motion until startup complete (APU→BLEED→FUEL→IGN→ENG MSTR)
   - PFD (artificial horizon), IAS tape, ALT tape, VSI
   - FCU (Autopilot): SPD/ALT/VS/HDG, AP1/AP2 gating
   - ATC stub with voice
   - Wind drift, fuel burn, engine audio whine (throttle-tied)
   - Minimal inline layout so it looks right even without CSS updates
   ========================================================================== */


/* =============================================================================
   Screen Management
   ========================================================================== */
const screens = {
  auth:    document.getElementById('auth-screen'),
  home:    document.getElementById('home-screen'),
  setup:   document.getElementById('setup-screen'),
  cockpit: document.getElementById('cockpit-screen'),
  runway:  document.getElementById('runway-screen')
};

function show(key) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[key].classList.remove('hidden');
}


/* =============================================================================
   Audio
   ========================================================================== */
const A = {
  flap:  () => document.getElementById('snd-flaps'),
  whine: () => document.getElementById('snd-whine'),
  ding:  () => document.getElementById('snd-ding'),
  fire:  () => document.getElementById('snd-fire'),
  click: () => document.getElementById('snd-click')
};

function play(a){
  try{
    if(a){
      a.currentTime = 0;
      a.play().catch(()=>{});
    }
  }catch{}
}

function ensureWhineStarted() {
  const wh = A.whine();
  if (!wh) return;
  if (wh.paused) {
    // start silent; volume follows throttle in loop
    wh.volume = 0.0;
    wh.play().catch(()=>{});
  }
}


/* =============================================================================
   Speech (ATC)
   ========================================================================== */
let VOICES = [], voiceATC=null, voicePilot=null;

function loadVoices() {
  VOICES = speechSynthesis.getVoices();
  voiceATC   = VOICES.find(v => /en-?GB|US/i.test(v.lang) && /Female/i.test(v.name)) || VOICES[0] || null;
  voicePilot = VOICES.find(v => /en-?GB|US/i.test(v.lang) && /Male/i.test(v.name))   || VOICES[0] || null;
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}
function say(voice, text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  } catch {}
}
const sayATC   = t => say(voiceATC, t);
const sayPilot = t => say(voicePilot, t);


/* =============================================================================
   State
   ========================================================================== */
const flight = {
  plane: null, livery: null, origin: null, dest: null,
  coldDark: false, atcIncluded: true,

  // physics
  tasKts: 0, altFt: 0, vsFpm: 0,
  hdgDeg: 0, rollDeg: 0, pitchDeg: 0,

  // motion gating
  enginesRunning: false,

  // inputs
  throttle: 0, flaps: 0, gearDown: true, rudder: 0, trim: 0,

  // AP/FCU
  ap: { speedKts: 160, altFt: 6000, vsFpm: 1200, hdgDeg: 0, ap1: false, ap2: false },

  // systems (Airbus-ish)
  eng:  { master1:false, master2:false, ign:false, fire1:false, fire2:false },
  apu:  { master:false, start:false, bleed:false, avail:false },
  fuel: { pumpL:false, pumpR:false, pumpCTR:false, xfeed:false },
  lights:{ beacon:false, strobe:false, land:false, taxi:false, logo:false, wing:false, seatbelt:false },

  // route/time/fuel
  t: 0, durationSec: 900, // 15 minutes default
  fuelMax: 0, fuelKg: 0,

  // runtime fields
  _startTime: 0
};

const AirportDB = {
  LPPT:{name:"Lisbon",  lat:38.7813, lon:-9.1359},
  EGKK:{name:"Gatwick", lat:51.1537, lon:-0.1821},
  EGLL:{name:"Heathrow",lat:51.4706, lon:-0.4619},
  KIAD:{name:"Dulles",  lat:38.9531, lon:-77.4565},
  KJFK:{name:"JFK",     lat:40.6413, lon:-73.7781},
  KLAX:{name:"LAX",     lat:33.9416, lon:-118.4085}
};


/* =============================================================================
   Utilities
   ========================================================================== */
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const pad   = (n,w=2)=>String(n).padStart(w,'0');
const lerp  = (a,b,t)=>a+(b-a)*t;
const lerpLatLon=(a,b,t)=>({ lat: lerp(a.lat,b.lat,t), lon: lerp(a.lon,b.lon,t) });

function degToRad(d){ return d*Math.PI/180; }
function wrap360(d){ return (d%360+360)%360; }


/* =============================================================================
   1) AUTH Screen
   ========================================================================== */
export function showAuth() {
  show('auth');
  screens.auth.innerHTML = `
    <h1>IFRS Login</h1>
    <div style="display:grid; gap:.5rem; max-width:420px;">
      <input id="email" type="email" placeholder="Email">
      <input id="pass" type="password" placeholder="Password">
      <div style="display:flex; gap:.5rem;">
        <button id="btn-login">Login</button>
        <button id="btn-signup">Sign Up</button>
      </div>
    </div>
  `;
  document.getElementById('btn-login').onclick  = () => auth.signInWithEmailAndPassword(email.value, pass.value).catch(e=>alert(e.message));
  document.getElementById('btn-signup').onclick = () => auth.createUserWithEmailAndPassword(email.value, pass.value).catch(e=>alert(e.message));
}


/* =============================================================================
   2) HOME Screen
   ========================================================================== */
export function showHome() {
  show('home');
  screens.home.innerHTML = `
    <h1>IFRS — Airbus Cockpit</h1>
    <div style="margin:.5rem 0;">Select Aircraft</div>
    <div id="plane-list" style="display:flex; gap:.5rem; flex-wrap:wrap;"></div>
    <div style="margin-top:.5rem; display:flex; gap:.5rem;">
      <button id="btn-begin">Begin</button>
      <button id="btn-signout">Sign Out</button>
    </div>
  `;
  const list = document.getElementById('plane-list'); let selected=null;
  ['A330-300','A320neo','737 MAX 10','B-17'].forEach(code=>{
    const b=document.createElement('button'); b.textContent=code;
    b.onclick=()=>{ selected=code; flight.plane=code; list.querySelectorAll('button').forEach(x=>x.style.outline=''); b.style.outline='2px solid #3ec1ff'; play(A.click()); };
    list.appendChild(b);
  });
  document.getElementById('btn-begin').onclick=()=> selected? showSetup() : alert('Pick a plane');
  document.getElementById('btn-signout').onclick=()=> auth.signOut();
}


/* =============================================================================
   3) SETUP Screen
   ========================================================================== */
export async function showSetup() {
  show('setup');
  screens.setup.innerHTML = `<p>Loading options…</p>`;
  let lvr, apt;
  try {
    [lvr, apt] = await Promise.all([
      fetch('./assets/liveries.json').then(r=>r.json()),
      fetch('./assets/airports.json').then(r=>r.json())
    ]);
  } catch {
    screens.setup.innerHTML = `<p style="color:#f66">Error loading JSON</p>`;
    return;
  }

  screens.setup.innerHTML = `
    <h2>Setup Flight (${flight.plane})</h2>
    <div style="display:grid; gap:.5rem; max-width:520px;">
      <label>Livery</label>
      <select id="sel-livery">${(lvr[flight.plane]||[]).map(x=>`<option>${x}</option>`).join('')}</select>
      <label>Origin</label>
      <select id="sel-origin">${apt.map(x=>`<option>${x}</option>`).join('')}</select>
      <label>Destination</label>
      <select id="sel-dest">${apt.map(x=>`<option>${x}</option>`).join('')}</select>
      <label><input id="chk-gate" type="checkbox"> Cold & Dark at Gate</label>
      <label><input id="chk-atc" type="checkbox" checked> Include ATC</label>
      <button id="btn-fly">Fly!</button>
    </div>
  `;
  document.getElementById('btn-fly').onclick = () => {
    flight.livery   = document.getElementById('sel-livery').value;
    flight.origin   = document.getElementById('sel-origin').value;
    flight.dest     = document.getElementById('sel-dest').value;
    flight.coldDark = document.getElementById('chk-gate').checked;
    flight.atcIncluded = document.getElementById('chk-atc').checked;
    initFlight();
    showCockpit();
  };
}


/* =============================================================================
   Initialize Flight (Cold & Dark enforced)
   ========================================================================== */
function initFlight() {
  const o=AirportDB[flight.origin], d=AirportDB[flight.dest];
  if (o && d) {
    const dx=d.lon-o.lon, dy=d.lat-o.lat;
    flight.hdgDeg = wrap360(Math.atan2(dx,dy)*180/Math.PI);
    flight.ap.hdgDeg = flight.hdgDeg;
  }

  // Fuel capacities (kg)
  const caps = { 'A330-300':139000, 'A320neo':27000, '737 MAX 10':26000, 'B-17':8000 };
  flight.fuelMax = caps[flight.plane]||20000;
  flight.fuelKg  = flight.fuelMax;

  // Strict: engines OFF by default to prevent any motion until startup complete
  flight.enginesRunning = false;

  // Reset physics
  flight.tasKts=0; flight.altFt=0; flight.vsFpm=0;
  flight.rollDeg=0; flight.pitchDeg=0;
  flight.throttle=0; flight.flaps=0; flight.gearDown=true; flight.rudder=0; flight.trim=0;

  // Systems baseline
  Object.assign(flight.eng, { master1:false, master2:false, ign:false, fire1:false, fire2:false });
  Object.assign(flight.apu, { master:false, start:false, bleed:false, avail:false });
  Object.assign(flight.fuel,{ pumpL:false, pumpR:false, pumpCTR:false, xfeed:false });
  Object.assign(flight.lights,{ beacon:false, strobe:false, land:false, taxi:false, logo:false, wing:false, seatbelt:false });
  Object.assign(flight.ap, { speedKts:160, altFt:6000, vsFpm:1200, hdgDeg:flight.hdgDeg, ap1:false, ap2:false });

  // Route timer
  flight.t = 0;
  flight.durationSec = 900;
}


/* =============================================================================
   4) COCKPIT layout (Airbus feel): Pedestal left, Tabs right
   ========================================================================== */
let attCanvas, attCtx, speedEl, altEl, vsEl, timerEl;
let lastTime=0, rafId=0;

export function showCockpit() {
  show('cockpit');

  // Two-column grid with inline style so it works even without CSS file updates
  screens.cockpit.innerHTML = `
    <div id="cockpit-title" style="grid-column:1/-1; display:flex; justify-content:space-between; align-items:center; background:#0a2346; border:1px solid #1b3e6d; border-radius:6px; padding:.5rem; margin-bottom:.5rem;">
      <div style="display:flex; gap:.5rem; align-items:center">
        <strong>${flight.plane}</strong>
        <span style="opacity:.8">${flight.livery||''}</span>
        <span style="font-family:monospace; background:#122d57; border:1px solid #2b5587; border-radius:4px; padding:.1rem .4rem;">${flight.origin} → ${flight.dest}</span>
      </div>
      <div style="display:flex; gap:.5rem; align-items:center">
        <span id="flight-timer" style="font-family:monospace; background:#122d57; border:1px solid #2b5587; border-radius:4px; padding:.1rem .4rem;">00:00:00</span>
        <button id="btn-audio">Audio</button>
        <button id="btn-night">Night</button>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:320px 1fr; grid-auto-rows:1fr; gap:.5rem; height:calc(100vh - 100px);">
      <!-- Left: pedestal (controls) -->
      <div id="left-pane" style="background:#081e3a; border:1px solid #1b3e6d; border-radius:6px; padding:.5rem; overflow:auto;"></div>

      <!-- Right: tabs + pages -->
      <div id="right-pane" style="background:#081e3a; border:1px solid #1b3e6d; border-radius:6px; display:flex; flex-direction:column; min-height:0;">
        <div id="tabs" style="display:flex; border-bottom:1px solid #1b3e6d;">
          ${[
            ['OVERHEAD','Overhead Panel'],
            ['ENGINE','Engine Panel'],
            ['AP','Autopilot Panel'],
            ['ALT','Altimeter'],
            ['ATC','ATC Panel'],
            ['FLIGHTINFO','Flight Info'],
            ['AIRCRAFTINFO','Aircraft Info']
          ].map(([id,label],i)=>`<div class="tab${i===0?' active':''}" data-panel="${id}" style="flex:1; text-align:center; padding:.5rem; cursor:pointer; background:${i===0?'#1e3a5f':'#0d2a4e'}; border-right:1px solid #1b3e6d;">${label}</div>`).join('')}
        </div>

        ${['OVERHEAD','ENGINE','AP','ALT','ATC','FLIGHTINFO','AIRCRAFTINFO'].map((id,i)=>`
          <div id="${id}" class="panel${i===0?' active':''}" style="display:${i===0?'block':'none'}; overflow:auto; padding:.5rem; min-height:0;"></div>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('btn-audio').onclick = () => { ensureWhineStarted(); play(A.click()); };
  document.getElementById('btn-night').onclick = () => { document.body.classList.toggle('night'); play(A.click()); };

  renderPedestal();        // controls locked on left
  setupTabs();             // tabs on right

  renderOverheadPanel();   // APU, FUEL, LIGHTS (Airbus overhead)
  renderEnginePanel();     // IGN, ENG MASTER, FIRE TEST
  renderAutopilotPanel();  // FCU SPD/ALT/VS/HDG, AP1/AP2
  renderAltPanel();        // PFD with attitude, IAS, ALT, VS
  renderATCPanel();
  renderFlightInfoPanel();
  renderAircraftInfoPanel();

  setupInstruments();

  // Timer start
  timerEl = document.getElementById('flight-timer');
  flight._startTime = performance.now();

  lastTime = performance.now();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}


/* =============================================================================
   Tabs
   ========================================================================== */
function setupTabs() {
  const tabs = document.getElementById('tabs');
  tabs.querySelectorAll('.tab').forEach(btn=>{
    btn.onclick = () => {
      tabs.querySelectorAll('.tab').forEach(t=>{
        t.classList.remove('active');
        t.style.background = '#0d2a4e';
      });
      document.querySelectorAll('.panel').forEach(p=>p.style.display='none');
      btn.classList.add('active');
      btn.style.background = '#1e3a5f';
      document.getElementById(btn.dataset.panel).style.display='block';
      play(A.click());
    };
  });
}


/* =============================================================================
   Pedestal (left): Throttle, Flaps, Gear, Trim, Rudder, Fuel gauge
   ========================================================================== */
function renderPedestal() {
  const el = document.getElementById('left-pane');
  el.innerHTML = `
    <h3 style="margin:.25rem 0 .5rem;">Controls</h3>

    <div style="display:flex; align-items:center; gap:.5rem; margin:.4rem 0;">
      <div style="flex:1; font-family:monospace;">Throttle</div>
      <input id="thr" type="range" min="0" max="100" value="${Math.round(flight.throttle*100)}" style="flex:2">
      <span id="thr-val" style="font-family:monospace; background:#122d57; border:1px solid #2b5587; border-radius:4px; padding:.1rem .4rem;">${Math.round(flight.throttle*100)}%</span>
    </div>

    <div style="display:flex; align-items:center; gap:.5rem; margin:.4rem 0;">
      <div style="flex:1; font-family:monospace;">Flaps</div>
      <button id="flaps-dec">-</button>
      <span id="flaps-val" style="min-width:2ch; text-align:center; font-family:monospace;">${flight.flaps}</span>
      <button id="flaps-inc">+</button>
    </div>

    <div style="display:flex; align-items:center; gap:.5rem; margin:.4rem 0;">
      <div style="flex:1; font-family:monospace;">Gear</div>
      <button id="gear">${flight.gearDown?'Gear Down':'Gear Up'}</button>
    </div>

    <div style="display:flex; align-items:center; gap:.5rem; margin:.4rem 0;">
      <div style="flex:1; font-family:monospace;">Trim</div>
      <button id="trim-dn">▼</button>
      <span id="trim-val" style="min-width:4ch; text-align:center; font-family:monospace;">${flight.trim.toFixed(2)}</span>
      <button id="trim-up">▲</button>
    </div>

    <div style="display:flex; align-items:center; gap:.5rem; margin:.4rem 0;">
      <div style="flex:1; font-family:monospace;">Rudder</div>
      <button id="rud-l">◀</button>
      <span id="rud-val" style="min-width:3ch; text-align:center; font-family:monospace;">${flight.rudder.toFixed(1)}</span>
      <button id="rud-r">▶</button>
    </div>

    <hr style="border-color:#1b3e6d; margin:.6rem 0;" />
    <div id="fuel-card">
      <div style="margin-bottom:.25rem;">Fuel</div>
      <div style="height:14px; background:#122d57; border:1px solid #2b5587; border-radius:4px;">
        <div id="fuel-level" style="height:100%; width:100%; background:#2aff5a;"></div>
      </div>
      <div id="fuel-text" style="font-family:monospace; margin-top:.25rem;">${Math.round(flight.fuelKg)} kg</div>
    </div>
  `;

  // events
  const thr = document.getElementById('thr');
  thr.oninput = () => {
    flight.throttle = clamp(thr.value/100,0,1);
    document.getElementById('thr-val').textContent = `${Math.round(flight.throttle*100)}%`;
    ensureWhineStarted();
  };
  document.getElementById('flaps-dec').onclick = () => {
    flight.flaps = clamp(flight.flaps-1, 0, 3);
    document.getElementById('flaps-val').textContent = flight.flaps;
    play(A.flap());
  };
  document.getElementById('flaps-inc').onclick = () => {
    flight.flaps = clamp(flight.flaps+1, 0, 3);
    document.getElementById('flaps-val').textContent = flight.flaps;
    play(A.flap());
  };
  document.getElementById('gear').onclick = (e) => {
    flight.gearDown = !flight.gearDown;
    e.target.textContent = flight.gearDown ? 'Gear Down' : 'Gear Up';
    play(A.click());
  };
  document.getElementById('trim-up').onclick = () => {
    flight.trim = clamp(flight.trim + 0.1, -1, 1);
    document.getElementById('trim-val').textContent = flight.trim.toFixed(2);
  };
  document.getElementById('trim-dn').onclick = () => {
    flight.trim = clamp(flight.trim - 0.1, -1, 1);
    document.getElementById('trim-val').textContent = flight.trim.toFixed(2);
  };
  document.getElementById('rud-l').onclick = () => {
    flight.rudder = clamp(flight.rudder - 0.2, -1, 1);
    document.getElementById('rud-val').textContent = flight.rudder.toFixed(1);
  };
  document.getElementById('rud-r').onclick = () => {
    flight.rudder = clamp(flight.rudder + 0.2, -1, 1);
    document.getElementById('rud-val').textContent = flight.rudder.toFixed(1);
  };
}


/* =============================================================================
   Panels — Overhead (APU, Fuel, Lights)
   ========================================================================== */
function renderOverheadPanel() {
  const el = document.getElementById('OVERHEAD');
  el.innerHTML = `
    <h3>Overhead Panel</h3>
    <div style="opacity:.8; margin-bottom:.3rem">APU, Fuel, Lights (Airbus flow)</div>

    <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
      ${blockSwitch('APU MASTER','oh-apu-master', flight.apu.master)}
      ${blockSwitch('APU START','oh-apu-start',  flight.apu.avail)}
      ${blockSwitch('APU BLEED','oh-apu-bleed',  flight.apu.bleed)}
    </div>

    <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.5rem;">
      ${blockSwitch('PUMP L','oh-puml', flight.fuel.pumpL)}
      ${blockSwitch('PUMP CTR','oh-pumc', flight.fuel.pumpCTR)}
      ${blockSwitch('PUMP R','oh-pumr', flight.fuel.pumpR)}
      ${blockToggle('X-FEED','oh-xfeed', flight.fuel.xfeed, 'OPEN','CLOSE')}
    </div>

    <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.5rem;">
      ${['beacon','strobe','land','taxi','logo','wing','seatbelt'].map(n=>blockSwitch(n.toUpperCase(),`oh-${n}`,flight.lights[n])).join('')}
    </div>

    <div style="margin-top:.5rem; font-size:.9rem; opacity:.8">
      Startup: APU MASTER → APU START → APU BLEED → Fuel Pumps → IGN → ENG MASTER
    </div>
  `;

  // APU
  document.getElementById('oh-apu-master').onclick = () => { flight.apu.master=!flight.apu.master; renderOverheadPanel(); play(A.click()); };
  document.getElementById('oh-apu-start').onclick  = () => {
    if(!flight.apu.master) return;
    setTimeout(()=>{ flight.apu.avail = true; renderOverheadPanel(); play(A.click()); checkEngineSpool(); }, 800);
  };
  document.getElementById('oh-apu-bleed').onclick  = () => { flight.apu.bleed=!flight.apu.bleed; renderOverheadPanel(); play(A.click()); checkEngineSpool(); };

  // Fuel
  document.getElementById('oh-puml').onclick = () => { flight.fuel.pumpL  = !flight.fuel.pumpL;  renderOverheadPanel(); play(A.click()); checkEngineSpool(); };
  document.getElementById('oh-pumc').onclick = () => { flight.fuel.pumpCTR= !flight.fuel.pumpCTR;renderOverheadPanel(); play(A.click()); checkEngineSpool(); };
  document.getElementById('oh-pumr').onclick = () => { flight.fuel.pumpR  = !flight.fuel.pumpR;  renderOverheadPanel(); play(A.click()); checkEngineSpool(); };
  document.getElementById('oh-xfeed').onclick = () => { flight.fuel.xfeed = !flight.fuel.xfeed;  renderOverheadPanel(); play(A.click()); };

  // Lights
  ['beacon','strobe','land','taxi','logo','wing','seatbelt'].forEach(n=>{
    const id=`oh-${n}`; const elb=document.getElementById(id);
    if (elb) elb.onclick = () => {
      flight.lights[n] = !flight.lights[n];
      renderOverheadPanel(); play(n==='seatbelt'?A.ding():A.click());
    };
  });
}

function blockSwitch(label,id,on){
  return `
    <div class="switch" style="display:flex; align-items:center; gap:.5rem; background:#0d2a4e; border:1px solid #2b5587; border-radius:6px; padding:.4rem .5rem;">
      <span style="font-size:.8rem; letter-spacing:.5px;">${label}</span>
      <button id="${id}">${on?'ON':'OFF'}</button>
      <span style="width:10px; height:10px; border-radius:50%; background:${on?'#2aff5a':'#233'}; border:1px solid #345;"></span>
    </div>`;
}
function blockToggle(label,id,on,onTxt='ON',offTxt='OFF'){
  return `
    <div class="switch" style="display:flex; align-items:center; gap:.5rem; background:#0d2a4e; border:1px solid #2b5587; border-radius:6px; padding:.4rem .5rem;">
      <span style="font-size:.8rem; letter-spacing:.5px;">${label}</span>
      <button id="${id}">${on?onTxt:offTxt}</button>
      <span style="width:10px; height:10px; border-radius:50%; background:${on?'#2aff5a':'#233'}; border:1px solid #345;"></span>
    </div>`;
}


/* =============================================================================
   Panels — Engine
   ========================================================================== */
function renderEnginePanel() {
  const el = document.getElementById('ENGINE');
  el.innerHTML = `
    <h3>Engine Panel</h3>
    <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
      ${blockSwitch('IGN/START','btn-ign', flight.eng.ign)}
      ${blockSwitch('ENG1 MASTER','btn-eng1', flight.eng.master1)}
      ${blockSwitch('ENG2 MASTER','btn-eng2', flight.eng.master2)}
      ${blockSwitch('FIRE TEST 1','btn-fire1', flight.eng.fire1)}
      ${blockSwitch('FIRE TEST 2','btn-fire2', flight.eng.fire2)}
    </div>
    <div style="margin-top:.4rem; opacity:.8;">IGN then ENG MASTER when APU bleed & pumps are on</div>
  `;
  document.getElementById('btn-ign').onclick  = () => { flight.eng.ign=!flight.eng.ign; renderEnginePanel(); play(A.click()); checkEngineSpool(); };
  document.getElementById('btn-eng1').onclick = () => { flight.eng.master1=!flight.eng.master1; renderEnginePanel(); play(A.click()); checkEngineSpool(); };
  document.getElementById('btn-eng2').onclick = () => { flight.eng.master2=!flight.eng.master2; renderEnginePanel(); play(A.click()); checkEngineSpool(); };
  document.getElementById('btn-fire1').onclick= () => { flight.eng.fire1=!flight.eng.fire1; renderEnginePanel(); play(A.fire()); setTimeout(()=>{ flight.eng.fire1=false; renderEnginePanel(); },1200); };
  document.getElementById('btn-fire2').onclick= () => { flight.eng.fire2=!flight.eng.fire2; renderEnginePanel(); play(A.fire()); setTimeout(()=>{ flight.eng.fire2=false; renderEnginePanel(); },1200); };
}


/* =============================================================================
   Panels — Autopilot (FCU)
   ========================================================================== */
function renderAutopilotPanel() {
  const el = document.getElementById('AP');
  const blocked = !flight.enginesRunning;
  el.innerHTML = `
    <h3>Autopilot Panel (FCU)</h3>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:.5rem; max-width:520px;">
      ${fcuRow('SPD','spd', flight.ap.speedKts, 120, 330)}
      ${fcuRow('ALT','alt', flight.ap.altFt, 0, 39000, 500)}
      ${fcuRow('VS' ,'vs',  flight.ap.vsFpm, -3000, 3000, 100)}
      ${fcuRow('HDG','hdg', Math.round(flight.ap.hdgDeg), 0, 359, 5)}
      <div style="display:flex; align-items:center; gap:.5rem;">
        <span>AP1</span><button id="ap1" ${blocked?'disabled':''}>${flight.ap.ap1?'ON':'OFF'}</button>
      </div>
      <div style="display:flex; align-items:center; gap:.5rem;">
        <span>AP2</span><button id="ap2" ${blocked?'disabled':''}>${flight.ap.ap2?'ON':'OFF'}</button>
      </div>
    </div>
    <div style="opacity:.8; font-size:.9rem; margin-top:.25rem;">${blocked?'AP unavailable: engines off':'AP ready'}</div>
  `;
  wireFcu('spd',5, 120,330, v=>flight.ap.speedKts=v);
  wireFcu('alt',500,0,39000, v=>flight.ap.altFt=v);
  wireFcu('vs',100,-3000,3000, v=>flight.ap.vsFpm=v);
  wireFcu('hdg',5,0,359, v=>flight.ap.hdgDeg=v);
  if (!blocked) {
    document.getElementById('ap1').onclick=()=>{ flight.ap.ap1=!flight.ap.ap1; renderAutopilotPanel(); play(A.click()); };
    document.getElementById('ap2').onclick=()=>{ flight.ap.ap2=!flight.ap.ap2; renderAutopilotPanel(); play(A.click()); };
  }
}
function fcuRow(label,key,val,min,max,step=1) {
  return `
    <div style="display:flex; align-items:center; gap:.5rem;">
      <span>${label}</span>
      <button id="${key}-dec">-</button>
      <span id="${key}-val" style="font-family:monospace; min-width:5ch; text-align:center;">${val}</span>
      <button id="${key}-inc">+</button>
    </div>`;
}
function wireFcu(key,step,min,max,apply){
  document.getElementById(`${key}-dec`).onclick = () => {
    const v = clamp(parseInt(document.getElementById(`${key}-val`).textContent,10)-step, min, max);
    document.getElementById(`${key}-val`).textContent = v; apply(v); play(A.click());
  };
  document.getElementById(`${key}-inc`).onclick = () => {
    const v = clamp(parseInt(document.getElementById(`${key}-val`).textContent,10)+step, min, max);
    document.getElementById(`${key}-val`).textContent = v; apply(v); play(A.click());
  };
}


/* =============================================================================
   Panels — PFD (Attitude, IAS, ALT, VS)
   ========================================================================== */
function renderAltPanel() {
  const el = document.getElementById('ALT');
  el.innerHTML = `
    <h3>PFD — Attitude, IAS, ALT, VS</h3>
    <div style="display:grid; grid-template-columns:1fr 140px 160px; gap:.5rem; align-items:stretch;">
      <canvas id="attitude" style="width:100%; height:260px; background:#071b34; border:1px solid #1b3e6d; border-radius:6px;"></canvas>

      <div style="background:#081f3c; border:1px solid #1b3e6d; border-radius:6px; padding:.5rem;">
        <div style="font-size:.8rem; color:#9fb6d9; margin-bottom:.25rem;">IAS</div>
        <div id="speed" style="font-family:monospace; font-size:1.4rem; background:#122d57; border:1px solid #2b5587; border-radius:4px; padding:.2rem .4rem; text-align:right;">000</div>
      </div>

      <div style="background:#081f3c; border:1px solid #1b3e6d; border-radius:6px; padding:.5rem;">
        <div style="font-size:.8rem; color:#9fb6d9; margin-bottom:.25rem;">ALT</div>
        <div id="alt" style="font-family:monospace; font-size:1.4rem; background:#122d57; border:1px solid #2b5587; border-radius:4px; padding:.2rem .4rem; text-align:right;">00000</div>
        <div style="font-size:.8rem; color:#9fb6d9; margin:.4rem 0 .2rem;">VS</div>
        <div id="vs"  style="font-family:monospace; font-size:1.2rem; background:#122d57; border:1px solid #2b5587; border-radius:4px; padding:.2rem .4rem; text-align:right;">0000</div>
      </div>
    </div>
  `;
  setupInstruments(); // ensure canvas/context bound
}

function setupInstruments() {
  attCanvas = document.getElementById('attitude');
  if (!attCanvas) return;
  attCtx = attCanvas.getContext('2d');
  speedEl = document.getElementById('speed');
  altEl   = document.getElementById('alt');
  vsEl    = document.getElementById('vs');
  const resize = () => {
    const r = attCanvas.getBoundingClientRect();
    attCanvas.width = Math.max(300, r.width|0);
    attCanvas.height = 260;
  };
  resize();
  window.addEventListener('resize', resize);
}

function drawPFD(ctx, w, h, pitchDeg, rollDeg) {
  ctx.clearRect(0,0,w,h);
  ctx.save();
  ctx.translate(w/2, h/2);
  ctx.rotate(-degToRad(rollDeg));
  const y = pitchDeg * 4;

  // Sky
  ctx.fillStyle = '#2d76c2';
  ctx.fillRect(-w, -h*2 + y, w*2, h*2);

  // Ground
  ctx.fillStyle = '#a66a2e';
  ctx.fillRect(-w, y, w*2, h*2);

  // Horizon
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w, y);
  ctx.lineTo(w, y);
  ctx.stroke();

  // Pitch ladder
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.font = '12px B612 Mono, monospace';
  for (let p=-20; p<=20; p+=5) 
    if (p===0) continue;
    const yy = y - p * 4;
    ctx.beginPath();
    ctx.moveTo(-40, yy); ctx.lineTo(-10, yy);
    ctx.moveTo(40, yy);  ctx.lineTo(10, yy);
    ctx.stroke();
    ctx.fillText(`${p}`, -55, yy+4);
    ctx.fillText(`${p}`,  45, yy+4);
  }

  // Bank scale (ticks at 10,20,30)
  ctx.rotate(degToRad(rollDeg));
  ctx.translate(-w/2, -h/2);
  ctx.save();
  ctx.translate(w/2, h/2 - 110);
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0,0, 40, degToRad(-45), degToRad(45));
  ctx.stroke();
  [10,20,30,45].forEach(a=>{
    const r=40, ax=degToRad(a);
    const x1=r*Math.sin(ax), y1=-r*Math.cos(ax);
    const len = (a%30===0)?10:6;
    ctx.beginPath(); ctx.moveTo( x1, y1); ctx.lineTo( x1, y1+len); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-x1, y1); ctx.lineTo(-x1, y1+len); ctx.stroke();
  });
  // Bank pointer (fixed)
  ctx.fillStyle = '#ffef5a';
  ctx.beginPath();
  ctx.moveTo(0,-55); ctx.lineTo(-6,-45); ctx.lineTo(6,-45); ctx.closePath(); ctx.fill();
  ctx.restore();

  // Flight director cross if AP on
  if (flight.ap.ap1 || flight.ap.ap2) {
    ctx.save();
    // back to center
    // guidance error (dummy): 0 for now; could be linked to AP targets
    const fdX = 0; const fdY = 0;
    ctx.strokeStyle = '#ff5a5a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w/2 - 30 + fdX, h/2 + fdY);
    ctx.lineTo(w/2 + 30 + fdX, h/2 + fdY);
    ctx.moveTo(w/2 + fdX, h/2 - 30 + fdY);
    ctx.lineTo(w/2 + fdX, h/2 + 30 + fdY);
    ctx.stroke();
    ctx.restore();
  }

  // Aircraft symbol (fixed)
  ctx.strokeStyle = '#ffef5a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w/2-40,h/2); ctx.lineTo(w/2+40,h/2);
  ctx.moveTo(w/2,h/2);   ctx.lineTo(w/2,h/2+12);
  ctx.stroke();

  ctx.restore();
}


/* =============================================================================
   Panels — ATC
   ========================================================================== */
function renderATCPanel() {
  const el = document.getElementById('ATC');
  el.innerHTML = `
    <h3>ATC</h3>
    <div id="atc-log" style="height:180px; overflow:auto; background:#0a1f3d; border:1px solid #1b3e6d; border-radius:6px; padding:.5rem; font-family:monospace;"></div>
    <div style="display:flex; gap:.5rem; margin-top:.5rem;">
      <button id="atc-connect">Connect</button>
      <button id="atc-request">Request</button>
      <button id="atc-readback">Read
