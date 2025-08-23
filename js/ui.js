// js/ui.js

import { auth } from './firebase-config.js';

/* =============================================================================
   IFRS — Airbus-style UI and Systems
   =============================================================================
   - Pedestal (controls) permanently on left
   - Tabs/pages permanently on right
   - Cold & Dark enforced — no motion until startup complete
   - PFD (artificial horizon), IAS, ALT, VS
   - FCU (Autopilot): SPD/ALT/VS/HDG, AP1/AP2 gating
   - ATC stub with voice
   - Wind drift, fuel burn, engine whine tied to throttle
   - Inline layout to work even without external CSS
   ========================================================================== */


/* ========= Screens ========= */
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


/* ========= Audio ========= */
const A = {
  flap:  () => document.getElementById('snd-flaps'),
  whine: () => document.getElementById('snd-whine'),
  ding:  () => document.getElementById('snd-ding'),
  fire:  () => document.getElementById('snd-fire'),
  click: () => document.getElementById('snd-click')
};

function play(a) {
  try {
    if (a) {
      a.currentTime = 0;
      a.play().catch(()=>{});
    }
  } catch {}
}

function ensureWhineStarted() {
  const wh = A.whine();
  if (!wh) return;
  if (wh.paused) {
    wh.volume = 0.0; // start silent; volume follows throttle in loop
    wh.play().catch(()=>{});
  }
}


/* ========= Speech (ATC) ========= */
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


/* ========= State ========= */
const flight = {
  plane: null,
  livery: null,
  origin: null,
  dest: null,
  coldDark: false,
  atcIncluded: true,

  // physics
  tasKts: 0,
  altFt: 0,
  vsFpm: 0,
  hdgDeg: 0,
  rollDeg: 0,
  pitchDeg: 0,

  // gating
  enginesRunning: false,

  // inputs
  throttle: 0,
  flaps: 0,
  gearDown: true,
  rudder: 0,
  trim: 0,

  // AP/FCU
  ap: { speedKts: 160, altFt: 6000, vsFpm: 1200, hdgDeg: 0, ap1: false, ap2: false },

  // systems
  eng:  { master1:false, master2:false, ign:false, fire1:false, fire2:false },
  apu:  { master:false, start:false, bleed:false, avail:false },
  fuel: { pumpL:false, pumpR:false, pumpCTR:false, xfeed:false },
  lights:{ beacon:false, strobe:false, land:false, taxi:false, logo:false, wing:false, seatbelt:false },

  // route/time/fuel
  t: 0,
  durationSec: 900,
  fuelMax: 0,
  fuelKg: 0,

  // runtime
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


/* ========= Utils ========= */
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const pad   = (n,w=2)=>String(n).padStart(w,'0');
const lerp  = (a,b,t)=>a+(b-a)*t;
const lerpLatLon=(a,b,t)=>({ lat: lerp(a.lat,b.lat,t), lon: lerp(a.lon,b.lon,t) });
function wrap360(d){ return (d%360+360)%360; }
function degToRad(d){ return d*Math.PI/180; }


/* ========= Auth ========= */
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


/* ========= Home ========= */
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
    const b=document.createElement('button');
    b.textContent=code;
    b.onclick=()=>{
      selected=code;
      flight.plane=code;
      list.querySelectorAll('button').forEach(x=>x.style.outline='');
      b.style.outline='2px solid #3ec1ff';
      play(A.click());
    };
    list.appendChild(b);
  });
  document.getElementById('btn-begin').onclick=()=> selected? showSetup() : alert('Pick a plane');
  document.getElementById('btn-signout').onclick=()=> auth.signOut();
}


/* ========= Setup ========= */
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


/* ========= Init Flight ========= */
function initFlight() {
  const o=AirportDB[flight.origin], d=AirportDB[flight.dest];
  if (o&&d) {
    const dx=d.lon-o.lon, dy=d.lat-o.lat;
    flight.hdgDeg = wrap360(Math.atan2(dx,dy)*180/Math.PI);
    flight.ap.hdgDeg = flight.hdgDeg;
  }
  // Fuel
  const caps = { 'A330-300':139000, 'A320neo':27000, '737 MAX 10':26000, 'B-17':8000 };
  flight.fuelMax = caps[flight.plane]||20000;
  flight.fuelKg  = flight.fuelMax;
  // Engines OFF until startup complete (prevents motion)
  flight.enginesRunning = false;
  // Physics reset
  flight.tasKts=0; flight.altFt=0; flight.vsFpm=0;
  flight.rollDeg=0; flight.pitchDeg=0;
  flight.throttle=0; flight.flaps=0; flight.gearDown=true; flight.rudder=0; flight.trim=0;
  // Cold & dark systems
  Object.assign(flight.eng, { master1:false, master2:false, ign:false, fire1:false, fire2:false });
  Object.assign(flight.apu, { master:false, start:false, bleed:false, avail:false });
  Object.assign(flight.fuel,{ pumpL:false, pumpR:false, pumpCTR:false, xfeed:false });
  Object.assign(flight.lights,{ beacon:false, strobe:false, land:false, taxi:false, logo:false, wing:false, seatbelt:false });
  Object.assign(flight.ap,{ speedKts:160, altFt:6000, vsFpm:1200, hdgDeg:flight.hdgDeg, ap1:false, ap2:false });
  // Route timer
  flight.t=0;
}


/* ========= Cockpit ========= */
let attCanvas, attCtx, speedEl, altEl, vsEl, timerEl;
let lastTime=0, rafId=0;

export function showCockpit() {
  show('cockpit');
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
    <div style="display:grid; grid-template-columns:320px 1fr; gap:.5rem; height:calc(100vh - 100px);">
      <div id="left-pane" style="background:#081e3a; border:1px solid #1b3e6d; border-radius:6px; padding:.5rem; overflow:auto;"></div>
      <div id="right-pane" style="background:#081e3a; border:1px solid #1b3e6d; border-radius:6px; display:flex; flex-direction:column;">
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
          <div id="${id}" class="panel${i===0?' active':''}" style="display:${i===0?'block':'none'}; overflow:auto; padding:.5rem;"></div>
        `).join('')}
      </div>
    </div>
  `;
  document.getElementById('btn-audio').onclick = () => { ensureWhineStarted(); play(A.click()); };
  document.getElementById('btn-night').onclick = () => { document.body.classList.toggle('night'); play(A.click()); };
  renderPedestal();
  setupTabs();
  renderOverheadPanel();
  renderEnginePanel();
  renderAutopilotPanel();
  renderAltPanel();
  renderATCPanel();
  renderFlightInfoPanel();
  renderAircraftInfoPanel();
  setupInstruments();
  timerEl = document.getElementById('flight-timer');
  flight._startTime = performance.now();
  lastTime = performance.now();
  rafId && cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop); // loop defined in Part 2
}

function setupTabs() {
  const tabs = document.getElementById('tabs');
  tabs.querySelectorAll('.tab').forEach(btn=>{
    btn.onclick = () => {
      tabs.querySelectorAll('.tab').forEach(t=>{t.classList.remove('active'); t.style.background='#0d2a4e';});
      document.querySelectorAll('.panel').forEach(p=>p.style.display='none');
      btn.classList.add('active'); btn.style.background='#1e3a5f';
      document.getElementById(btn.dataset.panel).style.display='block';
      play(A.click());
    };
  });
}


/* ========= Pedestal (left) ========= */
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


/* ========= Overhead Panel ========= */
function blockSwitch(label,id,on){
  return `
    <div class="switch" style="display:flex; align-items:center; gap:.5rem; background:#0d2a4e; border:1px solid #2b5587; border-radius:6px; padding:.4rem .5rem; margin:.25rem 0;">
      <span style="font-size:.8rem; letter-spacing:.5px;">${label}</span>
      <button id="${id}">${on?'ON':'OFF'}</button>
      <span style="width:10px; height:10px; border-radius:50%; background:${on?'#2aff5a':'#233'}; border:1px solid #345;"></span>
    </div>`;
}
function blockToggle(label,id,on,onTxt='ON',offTxt='OFF'){
  return `
    <div class="switch" style="display:flex; align-items:center; gap:.5rem; background:#0d2a4e; border:1px solid #2b5587; border-radius:6px; padding:.4rem .5rem; margin:.25rem 0;">
      <span style="font-size:.8rem; letter-spacing:.5px;">${label}</span>
      <button id="${id}">${on?onTxt:offTxt}</button>
      <span style="width:10px; height:10px; border-radius:50%; background:${on?'#2aff5a':'#233'}; border:1px solid #345;"></span>
    </div>`;
}

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


/* ========= Engine Panel ========= */
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


/* ========= Autopilot (FCU) ========= */
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


/* ========= PFD Panel (shell) ========= */
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
  setupInstruments(); // bind canvas/context; draw happens in loop (Part 2)
}


/* ========= ATC Panel ========= */
function renderATCPanel() {
  const el = document.getElementById('ATC');
  el.innerHTML = `
    <h3>ATC</h3>
    <div id="atc-log" style="height:180px; overflow:auto; background:#0a1f3d; border:1px solid #1b3e6d; border-radius:6px; padding:.5rem; font-family:monospace;"></div>
    <div style="display:flex; gap:.5rem; margin-top:.5rem;">
      <button id="atc-connect">Connect</button>
      <button id="atc-request">Request</button>
      <button id="atc-readback">Readback</button>
      <button id="atc-next">Next</button>
      <button id="atc-disconnect">Disconnect</button>
    </div>
  `;
  const atc = makeATC();
  document.getElementById('atc-connect').onclick    = ()=>atc.connect();
  document.getElementById('atc-request').onclick    = ()=>atc.request();
  document.getElementById('atc-readback').onclick   = ()=>atc.readback();
  document.getElementById('atc-next').onclick       = ()=>atc.next();
  document.getElementById('atc-disconnect').onclick = ()=>atc.disconnect();
}
function logATC(type, text) {
  const box = document.getElementById('atc-log');
  const div = document.createElement('div');
  div.className = type==='rx'?'rx':'tx';
  div.style.color = type==='rx' ? '#8ab6ff' : '#76ff8a';
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function makeATC() {
  let connected=false, i=0;
  const callsign = `${(flight.plane||'IFRS').replace(/\s+/g,'')}${Math.floor(100+Math.random()*900)}`;
  const legs = [
    {id:'CLR',  tx:`${callsign}, request IFR clearance ${flight.origin} to ${flight.dest}`, rx:`${callsign}, cleared to ${flight.dest} as filed, climb maintain 6000, departure 124.5, squawk 4301.`},
    {id:'GND',  tx:`${callsign}, ready to taxi`, rx:`${callsign}, taxi to runway 27 via A, hold short runway 27.`},
    {id:'TWR',  tx:`${callsign}, ready for departure runway 27`, rx:`${callsign}, wind calm, cleared for takeoff runway 27.`},
    {id:'DEP',  tx:`${callsign}, passing 2000 for 6000`, rx:`${callsign}, radar contact, proceed direct, climb maintain 6000, fly heading ${Math.round(flight.ap.hdgDeg)}.`}
  ];
  return {
    connect(){ if(connected) return; connected=true; logATC('rx','ATC connected.'); sayATC('ATC connected'); },
    request(){ if(!connected)return; logATC('tx',legs[i].tx); sayPilot(legs[i].tx); },
    readback(){ if(!connected)return; const rb=legs[i].rx.replace('radar contact, ',''); logATC('tx',`${callsign} readback ${rb}`); sayPilot(`${callsign} readback ${rb}`); },
    next(){ if(!connected)return; logATC('rx',legs[i].rx); sayATC(legs[i].rx); i=Math.min(i+1,legs.length-1); },
    disconnect(){ if(!connected)return; connected=false; logATC('rx','ATC disconnected.'); sayATC('ATC disconnected'); }
  };
}


/* ========= Flight Info / Aircraft Info ========= */
function renderFlightInfoPanel() {
  const el = document.getElementById('FLIGHTINFO');
  const o=AirportDB[flight.origin], d=AirportDB[flight.dest];
  el.innerHTML = `
    <h3>Flight Info</h3>
    <div>From: <strong>${flight.origin}</strong> — ${o?.name||''}</div>
    <div>To:   <strong>${flight.dest}</strong> — ${d?.name||''}</div>
    <div>Planned Duration: ~${Math.round(flight.durationSec/60)} min</div>
  `;
}
function renderAircraftInfoPanel() {
  const el = document.getElementById('AIRCRAFTINFO');
  const img = `assets/aircraft/${flight.plane}.jpg`;
  el.innerHTML = `
    <h3>Aircraft</h3>
    <img src="${img}" alt="${flight.plane}" onerror="this.style.display='none'" style="max-width:100%; border-radius:6px; border:1px solid #1b3e6d; margin-bottom:.5rem;">
    <div>Type: ${flight.plane}</div>
    <div>Livery: ${flight.livery||'—'}</div>
    <div>Ceiling: ~39,000 ft • Cruise: M0.78–0.82</div>
  `;
}


/* ========= Instruments (bind only; drawing in Part 2) ========= */
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

/* ===== Part 1 ends here. Part 2 will add: drawPFD(), checkEngineSpool(), loop() ===== */
/* ========= Draw the PFD ========= */
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
  for (let p=-20; p<=20; p+=5) {
    if (p===0) continue;
    const yy = y - p * 4;
    ctx.beginPath();
    ctx.moveTo(-40, yy);
    ctx.lineTo(-10, yy);
    ctx.moveTo(40, yy);
    ctx.lineTo(10, yy);
    ctx.stroke();
    ctx.fillText(`${p}`, -55, yy+4);
    ctx.fillText(`${p}`,  45, yy+4);
  }
  ctx.restore();

  // Aircraft symbol
  ctx.strokeStyle = '#ffef5a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w/2-40,h/2);
  ctx.lineTo(w/2+40,h/2);
  ctx.moveTo(w/2,h/2);
  ctx.lineTo(w/2,h/2+12);
  ctx.stroke();
}

/* ========= Engine Spool Gate ========= */
function checkEngineSpool() {
  const pumps = (flight.fuel.pumpL || flight.fuel.pumpCTR || flight.fuel.pumpR);
  const apuOK = (flight.apu.master && flight.apu.avail && flight.apu.bleed);
  const ignOK = flight.eng.ign;
  const master = (flight.eng.master1 || flight.eng.master2);
  if (pumps && apuOK && ignOK && master) {
    flight.enginesRunning = true;
    ensureWhineStarted();
  }
}

/* ========= Flight Loop ========= */
function loop(now) {
  const dt = (now - lastTime)/1000;
  lastTime = now;

  // Timer
  if (timerEl && flight._startTime!=null) {
    const e = now - flight._startTime;
    const h = Math.floor(e/3600000),
          m = Math.floor((e%3600000)/60000),
          s = Math.floor((e%60000)/1000);
    timerEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  // Engines not running: decay IAS, freeze altitude
  if (!flight.enginesRunning) {
    flight.tasKts = Math.max(0, flight.tasKts - 10*dt);
    flight.vsFpm  = 0;
  } else {
    // Speed target from AP or throttle
    const apOn = flight.ap.ap1 || flight.ap.ap2;
    let spdTarget = apOn ? flight.ap.speedKts : flight.throttle * 300;
    flight.tasKts += (spdTarget - flight.tasKts) * 0.02;
    // Drag from flaps/gear
    const drag = 1 + flight.flaps * 0.2 + (flight.gearDown ? 0.3 : 0);
    flight.tasKts *= (1 - drag * 0.001);
    // Vertical speed from AP or trim
    flight.vsFpm = apOn ? flight.ap.vsFpm : flight.trim * 500;
    flight.altFt += flight.vsFpm * dt;
    flight.altFt = Math.max(0, flight.altFt);
    // Heading control
    let hdgTarget = apOn ? flight.ap.hdgDeg : flight.hdgDeg + flight.rudder * 10;
    let err = ((hdgTarget - flight.hdgDeg + 540) % 360) - 180;
    flight.hdgDeg = wrap360(flight.hdgDeg + err * dt * 2);
    // Attitude for PFD
    flight.rollDeg  = clamp(err * 0.5, -30, 30);
    flight.pitchDeg = clamp(flight.vsFpm / 1000 * 3, -10, 10);
    // Route progress
    flight.t = clamp(flight.t + dt / flight.durationSec, 0, 1);
  }

  // Fuel consumption (~2 kg/sec at full throttle)
  if (flight.enginesRunning) {
    flight.fuelKg = Math.max(0, flight.fuelKg - flight.throttle * 2 * dt);
  }
  const pct = (flight.fuelKg / flight.fuelMax) * 100;
  const fuelLvl = document.getElementById('fuel-level');
  const fuelTxt = document.getElementById('fuel-text');
  if (fuelLvl) {
    fuelLvl.style.width = `${pct}%`;
    fuelLvl.style.background = pct < 20 ? '#f66' : '#2aff5a';
  }
  if (fuelTxt) {
    fuelTxt.textContent = `${Math.round(flight.fuelKg)} kg`;
  }

  // Update instruments
  if (speedEl) speedEl.textContent = pad(Math.round(flight.tasKts), 3);
  if (altEl)   altEl.textContent   = pad(Math.round(flight.altFt), 5);
  if (vsEl)    vsEl.textContent    = pad(Math.round(flight.vsFpm), 4);
  if (attCtx && attCanvas) {
    drawPFD(attCtx, attCanvas.width, attCanvas.height, flight.pitchDeg, flight.rollDeg);
  }

  rafId = requestAnimationFrame(loop);
}

/* ========= Exported for other modules if needed ========= */
export { checkEngineSpool };
