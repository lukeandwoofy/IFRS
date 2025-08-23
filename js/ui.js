// js/ui.js
import { auth } from './firebase-config.js';

/* Screens */
const screens = {
  auth:    document.getElementById('auth-screen'),
  home:    document.getElementById('home-screen'),
  setup:   document.getElementById('setup-screen'),
  cockpit: document.getElementById('cockpit-screen'),
  runway:  document.getElementById('runway-screen')
};
function show(key) { Object.values(screens).forEach(s => s.classList.add('hidden')); screens[key].classList.remove('hidden'); }

/* Sounds */
const S = {
  ding:  () => document.getElementById('snd-ding')?.play().catch(()=>{}),
  fire:  () => document.getElementById('snd-fire')?.play().catch(()=>{}),
  click: () => document.getElementById('snd-click')?.play().catch(()=>{})
};

/* Flight & systems state */
const flight = {
  plane: null, livery: null, origin: null, dest: null,
  coldDark: false, atcIncluded: true,
  t: 0, durationSec: 300,
  tasKts: 140, altFt: 0, vsFpm: 0, hdgDeg: 0, rollDeg: 0, pitchDeg: 0,
  ap: { speedKts: 160, altFt: 6000, vsFpm: 1200, hdgDeg: 0, ap1: false, ap2: false },
  eng: { master1:false, master2:false, ign:false, fire1:false, fire2:false },
  apu: { master:false, start:false, bleed:false, avail:false },
  fuel:{ pumpL:false, pumpR:false, pumpCTR:false, xfeed:false },
  lights:{ beacon:false, strobe:false, land:false, taxi:false, logo:false, wing:false, seatbelt:false }
};

/* Airport DB for map coordinates */
const AirportDB = {
  LPPT:{name:"Lisbon", lat:38.7813, lon:-9.1359},
  EGKK:{name:"Gatwick", lat:51.1537, lon:-0.1821},
  EGLL:{name:"Heathrow", lat:51.4706, lon:-0.4619},
  KIAD:{name:"Dulles", lat:38.9531, lon:-77.4565},
  KJFK:{name:"JFK", lat:40.6413, lon:-73.7781},
  KLAX:{name:"LAX", lat:33.9416, lon:-118.4085}
};

/* Utilities */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b - a) * t;
const lerpLatLon = (a,b,t) => ({ lat: lerp(a.lat,b.lat,t), lon: lerp(a.lon,b.lon,t) });
const pad = (n, w=3) => String(n).padStart(w,'0');

/* Auth */
export function showAuth() {
  show('auth');
  screens.auth.innerHTML = `
    <h1>IFRS Login / Sign Up</h1>
    <input id="email" type="email" placeholder="Email">
    <input id="pass"  type="password" placeholder="Password">
    <button id="btn-login">Login</button>
    <button id="btn-signup">Sign Up</button>
  `;
  document.getElementById('btn-login').onclick  = () => auth.signInWithEmailAndPassword(email.value, pass.value).catch(e => alert(e.message));
  document.getElementById('btn-signup').onclick = () => auth.createUserWithEmailAndPassword(email.value, pass.value).catch(e => alert(e.message));
}

/* Home */
export function showHome() {
  show('home');
  screens.home.innerHTML = `
    <img src="assets/logo.png" alt="IFRS Logo" style="height:80px">
    <h1>Instrument Flight Rules Sim</h1>
    <button id="btn-signout">Sign Out</button>
    <div id="plane-list"></div>
    <button id="btn-begin">Begin Flight</button>
  `;
  document.getElementById('btn-signout').onclick = () => auth.signOut();

  const planes = ['A330-300','A320neo','737 MAX 10','B-17'];
  const list = document.getElementById('plane-list'); let selected = null;
  planes.forEach(p => {
    const b = document.createElement('button'); b.textContent = p;
    b.onclick = () => { selected = p; flight.plane = p; Array.from(list.children).forEach(c=>c.classList.remove('active')); b.classList.add('active'); S.click(); };
    list.appendChild(b);
  });
  document.getElementById('btn-begin').onclick = () => selected ? showSetup() : alert('Select a plane first');
}

/* Setup */
export async function showSetup() {
  show('setup');
  screens.setup.innerHTML = `<p>Loading flight options…</p>`;
  let lvr, apt;
  try {
    [lvr, apt] = await Promise.all([
      fetch('./assets/liveries.json').then(r => { if (!r.ok) throw new Error('liveries.json not found'); return r.json(); }),
      fetch('./assets/airports.json').then(r => { if (!r.ok) throw new Error('airports.json not found'); return r.json(); })
    ]);
  } catch (e) { screens.setup.innerHTML = `<p style="color:#ff6b6b">Error: ${e.message}</p>`; return; }

  screens.setup.innerHTML = `
    <h2>Setup Flight (${flight.plane})</h2>
    <label>Livery</label>
    <select id="sel-livery">${(lvr[flight.plane] || []).map(x => `<option>${x}</option>`).join('')}</select><br/>
    <label>Origin</label>
    <select id="sel-origin">${apt.map(a=>`<option>${a}</option>`).join('')}</select>
    <label>Destination</label>
    <select id="sel-dest">${apt.map(a=>`<option>${a}</option>`).join('')}</select><br/>
    <label><input id="chk-gate" type="checkbox"> Start Cold & Dark at Gate</label><br/>
    <label><input id="chk-atc"  type="checkbox" checked> Include ATC</label><br/>
    <button id="btn-fly">Fly!</button>
  `;
  document.getElementById('btn-fly').onclick = () => {
    flight.livery = document.getElementById('sel-livery').value;
    flight.origin = document.getElementById('sel-origin').value;
    flight.dest   = document.getElementById('sel-dest').value;
    flight.coldDark = document.getElementById('chk-gate').checked;
    flight.atcIncluded = document.getElementById('chk-atc').checked;
    initFlight();
    showCockpit();
  };
}

/* Init flight */
function initFlight() {
  Object.assign(flight, { t:0, durationSec:300, tasKts:140, altFt: flight.coldDark ? 0 : 1500, vsFpm:0, rollDeg:0, pitchDeg:0 });
  const o = AirportDB[flight.origin], d = AirportDB[flight.dest];
  if (o && d) {
    const dx = d.lon - o.lon, dy = d.lat - o.lat;
    flight.hdgDeg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    flight.ap.hdgDeg = flight.hdgDeg;
  }
  // Reset systems if cold & dark
  if (flight.coldDark) {
    Object.assign(flight.eng, { master1:false, master2:false, ign:false, fire1:false, fire2:false });
    Object.assign(flight.apu, { master:false, start:false, bleed:false, avail:false });
    Object.assign(flight.fuel,{ pumpL:false, pumpR:false, pumpCTR:false, xfeed:false });
    Object.assign(flight.lights,{ beacon:false, strobe:false, land:false, taxi:false, logo:false, wing:false, seatbelt:false });
    Object.assign(flight.ap, { speedKts:160, altFt:6000, vsFpm:1200, hdgDeg:flight.hdgDeg, ap1:false, ap2:false });
  }
}

/* Cockpit */
let map, routeLine, planeMarker, attCanvas, attCtx, speedEl, altEl, vsEl, lastTime=0, rafId=0;
let atc; // atc controller

export function showCockpit() {
  show('cockpit');
  screens.cockpit.innerHTML = `
    <div id="cockpit-title">
      <h2>${flight.plane} – ${flight.livery || ''} (${flight.origin} → ${flight.dest})</h2>
    </div>

    <div id="left-pane">
      <div class="tabs" id="tabs">
        <button class="tab active" data-panel="ENGINE">ENGINE</button>
        <button class="tab" data-panel="APU">APU</button>
        <button class="tab" data-panel="FUEL">FUEL</button>
        <button class="tab" data-panel="LIGHTS">LIGHTS</button>
        <button class="tab" data-panel="AP">Autopilot</button>
        <button class="tab" data-panel="ATC">ATC</button>
        <button class="tab" data-panel="FLIGHTINFO">Flight Info</button>
        <button class="tab" data-panel="AIRCRAFTINFO">Aircraft Info</button>
      </div>
      <div class="panel active" id="ENGINE"></div>
      <div class="panel" id="APU"></div>
      <div class="panel" id="FUEL"></div>
      <div class="panel" id="LIGHTS"></div>
      <div class="panel" id="AP"></div>
      <div class="panel" id="ATC"></div>
      <div class="panel" id="FLIGHTINFO"></div>
      <div class="panel" id="AIRCRAFTINFO"></div>
    </div>

    <div id="center-pane">
      <div id="map"></div>
      <div id="instruments">
        <canvas id="attitude"></canvas>
        <div class="tape"><div class="tape-title">IAS</div><div id="speed" class="num">000</div></div>
        <div class="tape"><div class="tape-title">ALT</div><div id="alt" class="num">00000</div></div>
        <div class="tape"><div class="tape-title">VS</div><div id="vs" class="num">0000</div></div>
      </div>
    </div>

    <div id="right-pane"></div>
  `;

  setupTabs();
  renderEnginePanel();
  renderAPUPanel();
  renderFuelPanel();
  renderLightsPanel();
  renderAutopilotPanel();
  renderATCPanel();
  renderFlightInfoPanel();
  renderAircraftInfoPanel();

  setupMap();
  setupInstruments();

  lastTime = performance.now();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

/* Tabs */
function setupTabs() {
  const tabs = document.getElementById('tabs');
  tabs.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      t.classList.add('active');
      document.getElementById(t.dataset.panel).classList.add('active');
      S.click();
    };
  });
}

/* Panels — ENGINE */
function renderEnginePanel() {
  const el = document.getElementById('ENGINE');
  el.innerHTML = `
    <div class="ann caut">ENGINE PANEL</div><br/>
    <div class="switch"><span class="label">IGN/START</span><button id="btn-ign">${flight.eng.ign?'ON':'OFF'}</button><span id="led-ign" class="led ${flight.eng.ign?'on':''}"></span></div>
    <div class="switch"><span class="label">ENG1 MASTER</span><button id="btn-eng1">${flight.eng.master1?'ON':'OFF'}</button><span id="led-eng1" class="led ${flight.eng.master1?'on':''}"></span></div>
    <div class="switch"><span class="label">ENG2 MASTER</span><button id="btn-eng2">${flight.eng.master2?'ON':'OFF'}</button><span id="led-eng2" class="led ${flight.eng.master2?'on':''}"></span></div>
    <div class="switch"><span class="label">FIRE TEST 1</span><button id="btn-fire1">TEST</button><span id="led-fire1" class="led ${flight.eng.fire1?'on':''}"></span></div>
    <div class="switch"><span class="label">FIRE TEST 2</span><button id="btn-fire2">TEST</button><span id="led-fire2" class="led ${flight.eng.fire2?'on':''}"></span></div>
  `;
  const togg = (key, id) => {
    flight.eng[key] = !flight.eng[key];
    document.getElementById(id).classList.toggle('on', flight.eng[key]);
  };
  document.getElementById('btn-ign').onclick = () => { togg('ign','led-ign'); S.click(); document.getElementById('btn-ign').textContent = flight.eng.ign?'ON':'OFF'; };
  document.getElementById('btn-eng1').onclick = () => { togg('master1','led-eng1'); S.click(); document.getElementById('btn-eng1').textContent = flight.eng.master1?'ON':'OFF'; maybeSpool(); };
  document.getElementById('btn-eng2').onclick = () => { togg('master2','led-eng2'); S.click(); document.getElementById('btn-eng2').textContent = flight.eng.master2?'ON':'OFF'; maybeSpool(); };
  document.getElementById('btn-fire1').onclick = () => { flight.eng.fire1 = !flight.eng.fire1; document.getElementById('led-fire1').classList.toggle('on', flight.eng.fire1); S.fire(); setTimeout(()=>{ flight.eng.fire1=false; document.getElementById('led-fire1').classList.remove('on'); }, 1500); };
  document.getElementById('btn-fire2').onclick = () => { flight.eng.fire2 = !flight.eng.fire2; document.getElementById('led-fire2').classList.toggle('on', flight.eng.fire2); S.fire(); setTimeout(()=>{ flight.eng.fire2=false; document.getElementById('led-fire2').classList.remove('on'); }, 1500); };
  function maybeSpool(){
    // very simple: if APU bleed + pumps + ign + master, allow thrust (raise speed over time)
    if (flight.apu.bleed && (flight.fuel.pumpL || flight.fuel.pumpR || flight.fuel.pumpCTR) && flight.eng.ign && (flight.eng.master1 || flight.eng.master2)) {
      flight.tasKts = Math.max(flight.tasKts, 120);
    }
  }
}

/* Panels — APU */
function renderAPUPanel() {
  const el = document.getElementById('APU');
  el.innerHTML = `
    <div class="ann info">APU PANEL</div><br/>
    <div class="switch"><span class="label">APU MASTER</span><button id="btn-apu-master">${flight.apu.master?'ON':'OFF'}</button><span id="led-apu-master" class="led ${flight.apu.master?'on':''}"></span></div>
    <div class="switch"><span class="label">APU START</span><button id="btn-apu-start">START</button><span id="led-apu-start" class="led ${flight.apu.avail?'on':''}"></span></div>
    <div class="switch"><span class="label">APU BLEED</span><button id="btn-apu-bleed">${flight.apu.bleed?'ON':'OFF'}</button><span id="led-apu-bleed" class="led ${flight.apu.bleed?'on':''}"></span></div>
  `;
  document.getElementById('btn-apu-master').onclick = () => { flight.apu.master=!flight.apu.master; S.click(); document.getElementById('led-apu-master').classList.toggle('on', flight.apu.master); document.getElementById('btn-apu-master').textContent = flight.apu.master?'ON':'OFF'; };
  document.getElementById('btn-apu-start').onclick = () => {
    if (!flight.apu.master) return;
    S.click(); document.getElementById('led-apu-start').classList.add('on'); flight.apu.avail = true;
  };
  document.getElementById('btn-apu-bleed').onclick = () => { flight.apu.bleed=!flight.apu.bleed; S.click(); document.getElementById('led-apu-bleed').classList.toggle('on', flight.apu.bleed); document.getElementById('btn-apu-bleed').textContent = flight.apu.bleed?'ON':'OFF'; };
}

/* Panels — FUEL */
function renderFuelPanel() {
  const el = document.getElementById('FUEL');
  el.innerHTML = `
    <div class="ann info">FUEL PANEL</div><br/>
    <div class="switch"><span class="label">PUMP L</span><button id="btn-puml">${flight.fuel.pumpL?'ON':'OFF'}</button><span id="led-puml" class="led ${flight.fuel.pumpL?'on':''}"></span></div>
    <div class="switch"><span class="label">PUMP CTR</span><button id="btn-pumc">${flight.fuel.pumpCTR?'ON':'OFF'}</button><span id="led-pumc" class="led ${flight.fuel.pumpCTR?'on':''}"></span></div>
    <div class="switch"><span class="label">PUMP R</span><button id="btn-pumr">${flight.fuel.pumpR?'ON':'OFF'}</button><span id="led-pumr" class="led ${flight.fuel.pumpR?'on':''}"></span></div>
    <div class="switch"><span class="label">X-FEED</span><button id="btn-xfeed">${flight.fuel.xfeed?'OPEN':'CLOSE'}</button><span id="led-xfeed" class="led ${flight.fuel.xfeed?'on':''}"></span></div>
  `;
  const T = (k, led, btn, onLabel='ON', offLabel='OFF') => {
    flight.fuel[k] = !flight.fuel[k]; document.getElementById(led).classList.toggle('on', flight.fuel[k]); document.getElementById(btn).textContent = flight.fuel[k] ? onLabel : offLabel; S.click();
  };
  document.getElementById('btn-puml').onclick = () => T('pumpL','led-puml','btn-puml');
  document.getElementById('btn-pumc').onclick = () => T('pumpCTR','led-pumc','btn-pumc');
  document.getElementById('btn-pumr').onclick = () => T('pumpR','led-pumr','btn-pumr');
  document.getElementById('btn-xfeed').onclick = () => T('xfeed','led-xfeed','btn-xfeed','OPEN','CLOSE');
}

/* Panels — LIGHTS */
function renderLightsPanel() {
  const el = document.getElementById('LIGHTS');
  el.innerHTML = `
    <div class="ann info">LIGHTS</div><br/>
    ${['beacon','strobe','land','taxi','logo','wing','seatbelt'].map(name => `
      <div class="switch"><span class="label">${name.toUpperCase()}</span>
        <button id="btn-${name}">${flight.lights[name]?'ON':'OFF'}</button>
        <span id="led-${name}" class="led ${flight.lights[name]?'on':''}"></span>
      </div>`).join('')}
  `;
  ['beacon','strobe','land','taxi','logo','wing','seatbelt'].forEach(name => {
    document.getElementById(`btn-${name}`).onclick = () => {
      flight.lights[name] = !flight.lights[name]; S.click();
      document.getElementById(`led-${name}`).classList.toggle('on', flight.lights[name]);
      document.getElementById(`btn-${name}`).textContent = flight.lights[name]?'ON':'OFF';
      if (name==='seatbelt') S.ding();
    };
  });
}

/* Panels — AUTOPILOT */
function renderAutopilotPanel() {
  const el = document.getElementById('AP');
  el.innerHTML = `
    <div class="ann info">FCU</div><br/>
    <div class="switch"><span class="label">SPD</span><button id="spd-dec">-</button><span id="spd" class="num">${flight.ap.speedKts}</span><button id="spd-inc">+</button></div>
    <div class="switch"><span class="label">ALT</span><button id="alt-dec">-</button><span id="altset" class="num">${flight.ap.altFt}</span><button id="alt-inc">+</button></div>
    <div class="switch"><span class="label">VS</span><button id="vs-dec">-</button><span id="vsset" class="num">${flight.ap.vsFpm}</span><button id="vs-inc">+</button></div>
    <div class="switch"><span class="label">HDG</span><button id="hdg-dec">-</button><span id="hdgset" class="num">${pad(Math.round(flight.ap.hdgDeg),3)}</span><button id="hdg-inc">+</button></div>
    <div class="switch"><span class="label">AP1</span><button id="ap1">${flight.ap.ap1?'ON':'OFF'}</button><span id="led-ap1" class="led ${flight.ap.ap1?'on':''}"></span></div>
    <div class="switch"><span class="label">AP2</span><button id="ap2">${flight.ap.ap2?'ON':'OFF'}</button><span id="led-ap2" class="led ${flight.ap.ap2?'on':''}"></span></div>
  `;
  const upd = () => {
    document.getElementById('spd').textContent = flight.ap.speedKts;
    document.getElementById('altset').textContent = flight.ap.altFt;
    document.getElementById('vsset').textContent = flight.ap.vsFpm;
    document.getElementById('hdgset').textContent = pad(Math.round(flight.ap.hdgDeg),3);
  };
  document.getElementById('spd-dec').onclick = () => { flight.ap.speedKts = clamp(flight.ap.speedKts-5,120,330); S.click(); upd(); };
  document.getElementById('spd-inc').onclick = () => { flight.ap.speedKts = clamp(flight.ap.speedKts+5,120,330); S.click(); upd(); };
  document.getElementById('alt-dec').onclick = () => { flight.ap.altFt   = clamp(flight.ap.altFt-500,0,39000); S.click(); upd(); };
  document.getElementById('alt-inc').onclick = () => { flight.ap.altFt   = clamp(flight.ap.altFt+500,0,39000); S.click(); upd(); };
  document.getElementById('vs-dec').onclick  = () => { flight.ap.vsFpm   = clamp(flight.ap.vsFpm-100,-3000,3000); S.click(); upd(); };
  document.getElementById('vs-inc').onclick  = () => { flight.ap.vsFpm   = clamp(flight.ap.vsFpm+100,-3000,3000); S.click(); upd(); };
  document.getElementById('hdg-dec').onclick = () => { flight.ap.hdgDeg  = (flight.ap.hdgDeg - 5 + 360) % 360; S.click(); upd(); };
  document.getElementById('hdg-inc').onclick = () => { flight.ap.hdgDeg  = (flight.ap.hdgDeg + 5) % 360; S.click(); upd(); };
  document.getElementById('ap1').onclick = () => { flight.ap.ap1=!flight.ap.ap1; S.click(); document.getElementById('led-ap1').classList.toggle('on', flight.ap.ap1); document.getElementById('ap1').textContent = flight.ap.ap1?'ON':'OFF'; };
  document.getElementById('ap2').onclick = () => { flight.ap.ap2=!flight.ap.ap2; S.click(); document.getElementById('led-ap2').classList.toggle('on', flight.ap.ap2); document.getElementById('ap2').textContent = flight.ap.ap2?'ON':'OFF'; };
}

/* Panels — ATC (scripted flow) */
function renderATCPanel() {
  const el = document.getElementById('ATC');
  el.innerHTML = `
    <div class="ann info">ATC</div><br/>
    <div class="atc-row">
      <span class="freq">CLR 121.900</span>
      <span class="freq">GND 121.700</span>
      <span class="freq">TWR 118.700</span>
      <span class="freq">DEP 124.500</span>
      <span class="freq">APP 119.000</span>
    </div>
    <div id="atc-log"></div>
    <div class="atc-row">
      <button id="atc-connect">Connect</button>
      <button id="atc-request">Request</button>
      <button id="atc-readback">Readback</button>
      <button id="atc-next">Next</button>
      <button id="atc-disconnect">Disconnect</button>
    </div>
  `;
  atc = makeATC();
  document.getElementById('atc-connect').onclick    = () => atc.connect();
  document.getElementById('atc-request').onclick    = () => atc.request();
  document.getElementById('atc-readback').onclick   = () => atc.readback();
  document.getElementById('atc-next').onclick       = () => atc.next();
  document.getElementById('atc-disconnect').onclick = () => atc.disconnect();
}
function say(text) { try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {} }
function logATC(type, text) {
  const box = document.getElementById('atc-log');
  const div = document.createElement('div'); div.className = type === 'rx' ? 'rx' : 'tx';
  div.textContent = text; box.appendChild(div); box.scrollTop = box.scrollHeight;
}
function makeATC() {
  // simple state machine mirroring MSFS-like flow
  let phase = 'CLR', connected = false;
  const callsign = `${flight.plane.replace(/\s+/g,'')} IFRS${Math.floor(100+Math.random()*900)}`;
  const legs = [
    { id:'CLR', tx:`${callsign} requesting IFR clearance ${flight.origin} to ${flight.dest}`, rx:`${callsign}, cleared to ${flight.dest} as filed, climb and maintain 6000, departure 124.5, squawk 4301.` },
    { id:'GND', tx:`${callsign} ready to taxi`, rx:`${callsign}, taxi to runway 27 via A, hold short.` },
    { id:'TWR', tx:`${callsign} ready for departure runway 27`, rx:`${callsign}, wind calm, cleared for takeoff runway 27.` },
    { id:'DEP', tx:`${callsign} passing 2000 for 6000`, rx:`${callsign}, radar contact, proceed direct, climb and maintain 6000, fly heading ${Math.round(flight.ap.hdgDeg)}.` },
    { id:'APP', tx:`${callsign} inbound for landing`, rx:`${callsign}, descend and maintain 3000, vectors ILS, contact tower 118.7 on final.` },
    { id:'TWR2', tx:`${callsign} established ILS runway 27`, rx:`${callsign}, cleared to land runway 27.` }
  ];
  let i = 0;

  return {
    connect(){ if (connected) return; connected=true; logATC('rx', `ATC connected. Phase ${phase}.`); say('ATC connected'); },
    request(){ if (!connected) return; logATC('tx', legs[i].tx); say(legs[i].tx); },
    readback(){ if (!connected) return; const rb = legs[i].rx.replace('radar contact, ',''); logATC('tx', `${callsign} readback: ${rb}`); say(`${callsign} readback ${rb}`); },
    next(){ if (!connected) return; logATC('rx', legs[i].rx); say(legs[i].rx); i = Math.min(i+1, legs.length-1); phase = legs[i].id; },
    disconnect(){ if (!connected) return; connected=false; logATC('rx','ATC disconnected.'); say('ATC disconnected'); }
  };
}

/* Panels — Info */
function renderFlightInfoPanel() {
  const el = document.getElementById('FLIGHTINFO');
  const o = AirportDB[flight.origin], d = AirportDB[flight.dest];
  el.innerHTML = `
    <div class="card"><div class="body">
      <h3>Route</h3>
      <p><strong>From:</strong> ${flight.origin} – ${o?.name || ''}</p>
      <p><strong>To:</strong> ${flight.dest} – ${d?.name || ''}</p>
      <p><strong>Duration:</strong> ~${Math.round(flight.durationSec/60)} min</p>
    </div></div>
  `;
}
function renderAircraftInfoPanel() {
  const el = document.getElementById('AIRCRAFTINFO');
  const imgPath = `assets/aircraft/${flight.plane}.jpg`;
  el.innerHTML = `
    <div class="card">
      <img src="${imgPath}" alt="${flight.plane}" onerror="this.style.display='none'">
      <div class="body">
        <h3>${flight.plane}</h3>
        <p>Typical cruise: Mach 0.78–0.82 • Ceiling: ~39,000 ft</p>
        <p>Range depends on variant/payload. Livery: ${flight.livery || '—'}</p>
      </div>
    </div>
  `;
}

/* Map */
function setupMap() {
  const o = AirportDB[flight.origin], d = AirportDB[flight.dest];
  map = L.map(document.getElementById('map'), { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);
  routeLine = L.polyline([ [o.lat,o.lon], [d.lat,d.lon] ], { color:'#3ec1ff', weight:3 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding:[20,20] });
  const planeIcon = L.icon({ iconUrl:'assets/plane-icon.png', iconSize:[32,32], iconAnchor:[16,16] });
  planeMarker = L.marker([o.lat,o.lon], { icon: planeIcon }).addTo(map);
}

/* Instruments */
function setupInstruments() {
  attCanvas = document.getElementById('attitude'); attCtx = attCanvas.getContext('2d');
  speedEl = document.getElementById('speed'); altEl = document.getElementById('alt'); vsEl = document.getElementById('vs');
  const resize = () => { const r = attCanvas.getBoundingClientRect(); attCanvas.width = r.width; attCanvas.height = Math.max(220, r.height); };
  resize(); window.addEventListener('resize', resize);
}
function drawAttitude(ctx, w, h, pitchDeg, rollDeg) {
  ctx.clearRect(0,0,w,h);
  ctx.save(); ctx.translate(w/2,h/2); ctx.rotate(-rollDeg*Math.PI/180);
  const pitchPxPerDeg = 3, yOffset = pitchDeg * pitchPxPerDeg;
  ctx.fillStyle='#2d76c2'; ctx.fillRect(-w, -h*2 + yOffset, w*2, h*2);
  ctx.fillStyle='#c27a2d'; ctx.fillRect(-w, yOffset, w*2, h*2);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(-w,yOffset); ctx.lineTo(w,yOffset); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.strokeStyle='#fff'; ctx.textAlign='center'; ctx.font='12px "B612 Mono", monospace';
  for (let p=-20; p<=20; p+=5) if (p!==0) {
    const y = yOffset - p*pitchPxPerDeg;
    ctx.beginPath(); ctx.moveTo(-40,y); ctx.lineTo(-10,y); ctx.moveTo(40,y); ctx.lineTo(10,y); ctx.stroke();
    ctx.fillText(String(p), -50, y+4); ctx.fillText(String(p), 50, y+4);
  }
  ctx.restore();
  ctx.strokeStyle='#ffef5a'; ctx.lineWidth=3; ctx.beginPath();
  ctx.moveTo(w/2-40,h/2); ctx.lineTo(w/2+40,h/2); ctx.moveTo(w/2,h/2); ctx.lineTo(w/2,h/2+12); ctx.stroke();
}

/* Loop */
function loop(now) {
  const dt = (now - lastTime)/1000; lastTime = now;
  const apOn = flight.ap.ap1 || flight.ap.ap2;

  // speed
  const spdTarget = apOn ? flight.ap.speedKts : flight.tasKts;
  flight.tasKts += clamp(spdTarget - flight.tasKts, -10, 10) * dt;

  // VS/ALT
  const vsTarget = apOn ? flight.ap.vsFpm : flight.vsFpm;
  flight.vsFpm += clamp(vsTarget - flight.vsFpm, -500, 500) * dt;
  flight.altFt = Math.max(0, flight.altFt + flight.vsFpm * dt);

  // heading
  const hdgErr = (((apOn ? flight.ap.hdgDeg : flight.hdgDeg) - flight.hdgDeg + 540) % 360) - 180;
  flight.hdgDeg = (flight.hdgDeg + clamp(hdgErr, -10, 10) * dt) % 360;

  // attitude
  flight.pitchDeg = clamp(flight.vsFpm / 1000 * 3, -10, 10);
  flight.rollDeg  = clamp(hdgErr, -25, 25);

  // progress
  flight.t = clamp(flight.t + dt / flight.durationSec, 0, 1);

  // position on route
  const o = AirportDB[flight.origin], d = AirportDB[flight.dest];
  const pos = lerpLatLon({lat:o.lat, lon:o.lon}, {lat:d.lat, lon:d.lon}, flight.t);
  if (planeMarker) planeMarker.setLatLng([pos.lat, pos.lon]);

  // instruments
  speedEl.textContent = pad(Math.round(flight.tasKts));
  altEl.textContent   = String(Math.round(flight.altFt)).padStart(5,'0');
  vsEl.textContent    = String(Math.round(flight.vsFpm)).padStart(4,'0');
  drawAttitude(attCtx, attCanvas.width, attCanvas.height, flight.pitchDeg, flight.rollDeg);

  if (flight.t < 1) { rafId = requestAnimationFrame(loop); }
}

/* Runway (placeholder) */
export function showRunway() { show('runway'); screens.runway.innerHTML = `<h2>Runway Ready</h2>`; }
