// js/ui.js

import { auth } from './firebase-config.js';

/* =============================================================================
   IFRS — Airbus-style UI and Systems
   =============================================================================
   - Controls/pedestal permanently on left
   - Tabs/pages permanently on right
   - Cold & Dark enforced — no motion until startup complete
   - PFD (artificial horizon), IAS, ALT, VS
   - FCU (Autopilot): SPD/ALT/VS/HDG, AP1/AP2 gating
   - ATC stub with voice
   - Wind drift, fuel burn, engine whine tied to throttle
   - Leaflet directional map in Flight Info
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
  if (wh && wh.paused) {
    wh.volume = 0.0;
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
    const b=document.createElement('button'); b.textContent=code;
    b.onclick=()=>{ selected=code; flight.plane=code; list.querySelectorAll('button').forEach(x=>x.style.outline=''); b.style.outline='2px solid #3ec1ff'; play(A.click()); };
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
  // Fuel setup
  const caps = { 'A330-300':139000, 'A320neo':27000, '737 MAX 10':26000, 'B-17':8000 };
  flight.fuelMax = caps[flight.plane]||20000;
  flight.fuelKg  = flight.fuelMax;
  // Cold & Dark gating
  flight.enginesRunning = false;
  // Reset flight state
  flight.tasKts=0; flight.altFt=0; flight.vsFpm=0;
  flight.rollDeg=0; flight.pitchDeg=0;
  flight.throttle=0; flight.flaps=0; flight.gearDown=true; flight.rudder=0; flight.trim=0;
  // Systems
  Object.assign(flight.eng, { master1:false, master2:false, ign:false, fire1:false, fire2:false });
  Object.assign(flight.apu, { master:false, start:false, bleed:false, avail:false });
  Object.assign(flight.fuel,{ pumpL:false, pumpR:false, pumpCTR:false, xfeed:false });
  Object.assign(flight.lights,{ beacon:false, strobe:false, land:false, taxi:false, logo:false, wing:false, seatbelt:false });
  Object.assign(flight.ap,{ speedKts:160, altFt:6000, vsFpm:1200, hdgDeg:flight.hdgDeg, ap1:false, ap2:false });
  flight.t = 0;
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
  // If these functions are not defined elsewhere, add empty stubs or implement as needed
  if (typeof renderOverheadPanel === "function") renderOverheadPanel();
  if (typeof renderEnginePanel === "function") renderEnginePanel();
  if (typeof renderAutopilotPanel === "function") renderAutopilotPanel();
  if (typeof renderAltPanel === "function") renderAltPanel();
  if (typeof renderATCPanel === "function") renderATCPanel();
  if (typeof renderFlightInfoPanel === "function") renderFlightInfoPanel();
  if (typeof renderAircraftInfoPanel === "function") renderAircraftInfoPanel();
  setupInstruments();
  setupMap();
  // Insert Open Map button after DOM is ready
  document.getElementById('right-pane').insertAdjacentHTML(
    'afterbegin',
    `<div style="padding:.5rem; border-bottom:1px solid #1b3e6d;">
       <button onclick="window.open('map.html','mapWin')">Open Map</button>
     </div>`
  );
  timerEl = document.getElementById('flight-timer');
  flight._startTime = performance.now();
  lastTime = performance.now();
  rafId && cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
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

/* ========= Pedestal ========= */
function renderPedestal() {
  const el = document.getElementById('left-pane');
  el.innerHTML = `
    <h3 style="margin:.25rem 0 .5rem;">Controls</h3>
    <div style="display:flex; align-items:center; gap:.5rem; margin:.4rem 0;">
      <div style="flex:1;">Throttle</div>
      <input id="thr" type="range" min="0" max="100" value="${Math.round(flight.throttle*100)}" style="flex:2">
      <span id="thr-val">${Math.round(flight.throttle*100)}%</span>
    </div>
    <div style="display:flex; align-items:center; gap:.5rem; margin:.4rem 0;">
      <div style="flex:1;">Flaps</div>
      <button id="flaps-dec">-</button>
      <span id="flaps-val">${flight.flaps}</span>
      <button id="flaps-inc">+</button>
    </div>
    <div style="display:flex; align-items:center; gap:.5rem; margin:.4rem 0;">
      <div style="flex:1;">Gear</div>
      <button id="gear">${flight.gearDown?'Gear Down':'Gear Up'}</button>
    </div>
  `;
  // Throttle event
  const thr = document.getElementById('thr');
  const thrVal = document.getElementById('thr-val');
  if (thr) {
    thr.oninput = e => {
      flight.throttle = clamp(e.target.value / 100, 0, 1);
      thrVal.textContent = `${Math.round(flight.throttle*100)}%`;
      play(A.click());
    };
  }
  // Flaps events
  const flapsDec = document.getElementById('flaps-dec');
  const flapsInc = document.getElementById('flaps-inc');
  const flapsVal = document.getElementById('flaps-val');
  if (flapsDec && flapsInc && flapsVal) {
    flapsDec.onclick = () => {
      flight.flaps = clamp(flight.flaps - 1, 0, 5);
      flapsVal.textContent = flight.flaps;
      play(A.flap());
    };
    flapsInc.onclick = () => {
      flight.flaps = clamp(flight.flaps + 1, 0, 5);
      flapsVal.textContent = flight.flaps;
      play(A.flap());
    };
  }
  // Gear event
  const gearBtn = document.getElementById('gear');
  if (gearBtn) {
    gearBtn.onclick = () => {
      flight.gearDown = !flight.gearDown;
      gearBtn.textContent = flight.gearDown ? 'Gear Down' : 'Gear Up';
      play(A.click());
    };
  }
}

/* ========= Engine Panel ========= */
function renderEnginePanel() {
  const el = document.getElementById('ENGINE');
  el.innerHTML = `
    <h3>Engine Panel</h3>
    ${blockSwitch('IGN/START','btn-ign', flight.eng.ign)}
    ${blockSwitch('ENG1 MASTER','btn-eng1', flight.eng.master1)}
    ${blockSwitch('ENG2 MASTER','btn-eng2', flight.eng.master2)}
  `;
  document.getElementById('btn-ign').onclick  = () => { flight.eng.ign=!flight.eng.ign; renderEnginePanel(); checkEngineSpool(); };
  document.getElementById('btn-eng1').onclick = () => { flight.eng.master1=!flight.eng.master1; renderEnginePanel(); checkEngineSpool(); };
  document.getElementById('btn-eng2').onclick = () => { flight.eng.master2=!flight.eng.master2; renderEnginePanel(); checkEngineSpool(); };
}

/* ========= Autopilot (FCU) ========= */
function renderAutopilotPanel() {
  const el = document.getElementById('AP');
  el.innerHTML = `
    <h3>Autopilot</h3>
    SPD: <input id="spd" type="number" value="${flight.ap.speedKts}"><br>
    ALT: <input id="alt" type="number" value="${flight.ap.altFt}"><br>
    VS:  <input id="vs"  type="number" value="${flight.ap.vsFpm}"><br>
    HDG: <input id="hdg" type="number" value="${flight.ap.hdgDeg}">
  `;
  ['spd','alt','vs','hdg'].forEach(id=>{
    document.getElementById(id).onchange = e => { flight.ap[`${id==='spd'?'speedKts':id==='alt'?'altFt':id==='vs'?'vsFpm':'hdgDeg'}`] = parseInt(e.target.value,10); };
  });
}

/* ========= PFD ========= */
function renderAltPanel() {
  const el = document.getElementById('ALT');
  el.innerHTML = `
    <h3>PFD</h3>
    <canvas id="attitude" width="300" height="260" style="background:#071b34;"></canvas>
    <div>IAS: <span id="speed">000</span></div>
    <div>ALT: <span id="alt">00000</span></div>
    <div>VS:  <span id="vs">0000</span></div>
  `;
  setupInstruments();
}

/* ========= ATC Panel ========= */
function renderATCPanel() {
  const el = document.getElementById('ATC');
  el.innerHTML = `<h3>ATC</h3><div id="atc-log"></div>`;
}

/* ========= Flight Info Panel ========= */
function renderFlightInfoPanel() {
  const el = document.getElementById('FLIGHTINFO');
  el.innerHTML = `
    <h3>Flight Info</h3>
    <div>From: ${flight.origin}</div>
    <div>To: ${flight.dest}</div>
    <div id="map" style="height:300px;"></div>
  `;
}

/* ========= Aircraft Info Panel ========= */
function renderAircraftInfoPanel() {
  const el = document.getElementById('AIRCRAFTINFO');
  el.innerHTML = `<h3>Aircraft</h3><div>Type: ${flight.plane}</div>`;
}

/* ========= Instruments ========= */
function setupInstruments() {
  attCanvas = document.getElementById('attitude');
  if (!attCanvas) return;
  attCtx = attCanvas.getContext('2d');
  speedEl = document.getElementById('speed');
  altEl   = document.getElementById('alt');
  vsEl    = document.getElementById('vs');
}

/* ========= Map ========= */
let map, routeLine, planeMarker;
function setupMap() {
  const o=AirportDB[flight.origin], d=AirportDB[flight.dest];
  map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
  routeLine = L.polyline([[o.lat,o.lon],[d.lat,d.lon]], { color: '#3ec1ff', weight: 3 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
  const icon = L.divIcon({ className: 'plane-icon', html: '✈️', iconSize: [24, 24] });
  planeMarker = L.marker([o.lat,o.lon], { icon }).addTo(map);
}

/* ========= Draw PFD ========= */
function drawPFD(ctx, w, h, pitchDeg, rollDeg) {
  ctx.clearRect(0,0,w,h);
  ctx.save();
  ctx.translate(w/2, h/2);
  ctx.rotate(-degToRad(rollDeg));
  const y = pitchDeg * 4;
  ctx.fillStyle = '#2d76c2';
  ctx.fillRect(-w, -h*2 + y, w*2, h*2);
  ctx.fillStyle = '#a66a2e';
  ctx.fillRect(-w, y, w*2, h*2);
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-w, y);
  ctx.lineTo(w, y);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#ffef5a';
  ctx.beginPath();
  ctx.moveTo(w/2-40,h/2);
  ctx.lineTo(w/2+40,h/2);
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

/* ========= Loop ========= */
function loop(now) {
  const dt = (now - lastTime)/1000;
  lastTime = now;

  if (timerEl && flight._startTime!=null) {
    const e = now - flight._startTime;
    const h = Math.floor(e/3600000),
          m = Math.floor((e%3600000)/60000),
          s = Math.floor((e%60000)/1000);
    timerEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  if (!flight.enginesRunning) {
    flight.tasKts = Math.max(0, flight.tasKts - 10 * dt);
    flight.vsFpm = 0;
  } else {
    const apOn = flight.ap.ap1 || flight.ap.ap2;
    let spdTarget = apOn ? flight.ap.speedKts : flight.throttle * 300;
    // Simple physics: accelerate/decelerate towards target speed
    flight.tasKts += clamp(spdTarget - flight.tasKts, -20, 20) * dt;
    // Altitude and VS
    if (apOn) {
      flight.vsFpm += clamp(flight.ap.vsFpm - flight.vsFpm, -500, 500) * dt;
    } else {
      flight.vsFpm = 0;
    }
    flight.altFt += flight.vsFpm * dt / 60;
    // Simple pitch/roll simulation
    flight.pitchDeg = clamp(flight.vsFpm / 100, -10, 10);
    flight.rollDeg = clamp((flight.ap.hdgDeg - flight.hdgDeg + 540) % 360 - 180, -30, 30) * (apOn ? 0.1 : 0);
    // Fuel burn
    flight.fuelKg = Math.max(0, flight.fuelKg - flight.tasKts * dt * 0.1);
  }

  // Update instruments if available.
  if (speedEl) speedEl.textContent = pad(Math.round(flight.tasKts), 3);
  if (altEl) altEl.textContent = pad(Math.round(flight.altFt), 5);
  if (vsEl) vsEl.textContent = pad(Math.round(flight.vsFpm), 4);
  if (attCtx && attCanvas) drawPFD(attCtx, attCanvas.width, attCanvas.height, flight.pitchDeg, flight.rollDeg);

  // Optionally update map marker if needed
  // if (planeMarker && map) planeMarker.setLatLng([currentLat, currentLon]);

  rafId = requestAnimationFrame(loop);
}
