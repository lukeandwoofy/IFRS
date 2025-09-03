// IFRS Flight Simulator UI - All Cockpit Panels, ND, Leaflet GPS, MCDU, and System Logic
// Drop-in ready for IFRS/IFR/analog instrument JS simulator projects
// Consistent, modular, and maintainable

// --------------- Global State ---------------------------

const state = {
  // Flight phase state machine
  flightPhase: 'cold_dark', // cold_dark, systems_active, engines_running, ready_for_taxi, in_flight, post_flight
  // Electrical, engines, and panel readiness
  electricalOn: false,
  apuOn: false,
  enginesRunning: false,

  // Autopilot state machine (manual, lnav, vnav, lnav_vnav)
  autopilotMode: 'manual',

  // Fuel and engine
  totalFuel: 12000, // kg
  fuelFlowRate: 0,  // kg/s, set by engine state
  lastFuelUpdate: Date.now(),

  // Flight params
  pitch: 0,
  roll: 0,
  hdg_true: 0,

  // Navigation / Position (mock/test values)
  position: { lat: 51.505, lon: -0.09, alt: 0, gs: 0 },
  route: [], // [{ id, lat, lon, alt, speed }]
  currentLeg: 0,

  // ND panel
  ndRange: 40, // NM

  // MCDU INIT A state
  mcduInitA: {
    fromTo: '',
    flightNumber: '',
    costIndex: '',
    crzFL: '',
    temperature: '',
    wind: ''
  },

  // MCDU F-PLAN state
  mcduFPlan: {
    waypoints: [] // [{ id, lat, lon, alt, spd }]
  },

  // MCDU PERF page state
  mcduPerf: {
    takeoff: {
      v1: '',
      vr: '',
      v2: '',
      flapSetting: '',
      flexTemp: '',
      transAlt: '',
      thrRed: '',
      accelAlt: '',
      engOutAccel: ''
    },
    climb: {
      ci: '',
      managedSpd: '',
      selectedSpd: ''
    },
    cruise: {
      ci: '',
      managedSpd: '',
      selectedSpd: ''
    },
    descent: {
      ci: '',
      managedSpd: '',
      selectedSpd: ''
    },
    approach: {
      qnh: '',
      temp: '',
      wind: '',
      transAlt: '',
      vApp: '',
      config: 'CONF3' // or 'FULL'
    }
  },

  // ATC messages queue
  atcMessages: [],

  // --- Leaflet & Map
  leafletMap: null
};

// --------------- State Machine Helpers ------------------
const flightPhases = ['cold_dark', 'systems_active', 'engines_running', 'ready_for_taxi', 'in_flight', 'post_flight'];

// Flight phase state transitions
function setFlightPhase(next) {
  if (flightPhases.includes(next)) {
    state.flightPhase = next;
    // State-phase side effects
    if (next === 'cold_dark') {
      state.electricalOn = false;
      state.apuOn = false;
      state.enginesRunning = false;
      state.autopilotMode = 'manual';
      state.fuelFlowRate = 0;
    }
    if (next === 'systems_active') state.electricalOn = true;
    if (next === 'engines_running') {
      state.electricalOn = true;
      state.enginesRunning = true;
      state.fuelFlowRate = 15;
    }
    if (next === 'in_flight') {
      state.autopilotMode = 'manual';
    }
    if (next === 'post_flight') {
      state.enginesRunning = false;
      state.fuelFlowRate = 0;
    }
  }
}

// Autopilot logic
function setAutopilotMode(mode) {
  const valid = ['manual', 'lnav', 'vnav', 'lnav_vnav'];
  if (!valid.includes(mode)) return;
  state.autopilotMode = mode;
  // Could add: logic to synchronize with ND and AP displays
}

// --- Helper: Clamp number
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// --- ATC Voice Stub
function atcVoiceStub(message) {
  // Placeholder for real ATC subsystem (e.g. speech synthesis or socket)
  state.atcMessages.push({ text: message, ts: new Date() });
  if (state.atcMessages.length > 5) state.atcMessages.shift();
  console.log('[ATC]', message);
}

// --------------- Fuel Burn Logic (per Dancila/Botez model basic implementation) ---------

function updateFuelBurn() {
  // Compute time step
  const now = Date.now();
  const deltaSec = clamp((now - state.lastFuelUpdate) / 1000, 0, 10);
  state.lastFuelUpdate = now;

  if (state.enginesRunning && state.totalFuel > 0) {
    let burn = state.fuelFlowRate * deltaSec;
    burn = clamp(burn, 0, state.totalFuel);
    state.totalFuel -= burn;
  }
  if (state.totalFuel < 0.1) {
    state.totalFuel = 0;
    // Could trigger shutdown if needed
    setFlightPhase('post_flight');
  }
}

function getFuelPercent() {
  return Math.round(100 * state.totalFuel / 12000);
}

// --------------- Panel Rendering Functions ------------------

// --- Overhead Panel
function renderOverheadPanel() {
  const c = document.getElementById('overhead-panel');
  if (!c) return;
  c.innerHTML = `
    <div class="panel-title">Overhead Panel</div>
    <button id="btn-power-on" ${state.electricalOn ? 'disabled' : ''}>Power On</button>
    <button id="btn-apu-start" ${state.apuOn ? 'disabled' : !state.electricalOn ? 'disabled' : ''}>APU Start</button>
    <button id="btn-engines-start" ${state.enginesRunning ? 'disabled' : !state.apuOn ? 'disabled' : ''}>Engine Start</button>
    <span style="margin-left:20px">Electrical: <b>${state.electricalOn ? 'ON' : 'OFF'}</b></span>
    <span style="margin-left:15px">APU: <b>${state.apuOn ? 'ON' : 'OFF'}</b></span>
    <span style="margin-left:15px">Engines: <b>${state.enginesRunning ? 'ON' : 'OFF'}</b></span>
  `;
  // Button actions
  setTimeout(() => {
    const pwr = document.getElementById('btn-power-on');
    if (pwr) pwr.onclick = () => { setFlightPhase('systems_active'); renderAllUIPanels(); };
    const apu = document.getElementById('btn-apu-start');
    if (apu) apu.onclick = () => { state.apuOn = true; renderAllUIPanels(); };
    const eng = document.getElementById('btn-engines-start');
    if (eng) eng.onclick = () => { setFlightPhase('engines_running'); renderAllUIPanels(); };
  }, 0);
}

// --- Engine Panel
function renderEnginePanel() {
  const c = document.getElementById('engine-panel');
  if (!c) return;
  c.innerHTML = `
    <div class="panel-title">Engine Panel</div>
    <div>Fuel Onboard: <b><span id="fuel-qty">${state.totalFuel.toFixed(0)}</span> kg</b> (${getFuelPercent()}%)</div>
    <div>Engine(s): <b>${state.enginesRunning ? 'RUNNING' : 'OFF'}</b></div>
    <div>Fuel Flow: <b>${state.fuelFlowRate} kg/s</b></div>
  `;
}

// --- Autopilot Panel
function renderAutopilotPanel() {
  const c = document.getElementById('autopilot-panel');
  if (!c) return;
  c.innerHTML = `
    <div class="panel-title">Autopilot Panel</div>
    <div>
      <button id="btn-ap-lnav" ${state.autopilotMode === 'lnav' || state.autopilotMode === 'lnav_vnav' ? 'disabled' : ''}>LNAV</button>
      <button id="btn-ap-vnav" ${state.autopilotMode === 'vnav' || state.autopilotMode === 'lnav_vnav' ? 'disabled' : ''}>VNAV</button>
      <button id="btn-ap-off" ${state.autopilotMode === 'manual' ? 'disabled' : ''}>AP OFF</button>
    </div>
    <div>Mode: <b>${state.autopilotMode.toUpperCase()}</b></div>
  `;
  setTimeout(() => {
    document.getElementById('btn-ap-lnav')?.addEventListener('click', () => {
      if (state.autopilotMode === 'vnav') setAutopilotMode('lnav_vnav');
      else setAutopilotMode('lnav');
      renderAllUIPanels();
    });
    document.getElementById('btn-ap-vnav')?.addEventListener('click', () => {
      if (state.autopilotMode === 'lnav') setAutopilotMode('lnav_vnav');
      else setAutopilotMode('vnav');
      renderAllUIPanels();
    });
    document.getElementById('btn-ap-off')?.addEventListener('click', () => {
      setAutopilotMode('manual');
      renderAllUIPanels();
    });
  }, 0);
}

// --- PFD (Primary Flight Display) including Artificial Horizon
function renderPFD() {
  const canvas = document.getElementById('pfd-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw artificial horizon
  renderArtificialHorizon(state.pitch, state.roll, ctx);

  ctx.fillStyle = 'lime';
  ctx.font = '18px monospace';
  ctx.fillText("PFD", 12, 22);

  // Show HDG, AP status
  ctx.fillStyle = 'white';
  ctx.font = '14px Arial';
  ctx.fillText(`HDG ${state.hdg_true.toFixed(0)}°`, 12, 45);
  ctx.fillText(`AP: ${state.autopilotMode.toUpperCase()}`, 12, 62);
}

// --- Artificial Horizon Helper (basic attitude ball only)
function renderArtificialHorizon(pitch, roll, ctx) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Horizon bars, pitch as pixels (8 px per deg)
  ctx.translate(w/2, h/2);
  ctx.rotate(-roll*Math.PI/180);
  // Sky
  ctx.fillStyle = '#58aeea';
  ctx.fillRect(-w, -h, 2*w, h/2 + pitch*8);
  // Ground
  ctx.fillStyle = '#c2a159';
  ctx.fillRect(-w, pitch*8, 2*w, h/2-pitch*8);
  // Horizon line
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-w, pitch*8);
  ctx.lineTo(w, pitch*8);
  ctx.stroke();

  // Aircraft symbol
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'yellow';
  ctx.beginPath();
  ctx.moveTo(-20,0);
  ctx.lineTo(20,0);
  ctx.moveTo(0,-10);
  ctx.lineTo(0,10);
  ctx.stroke();
  ctx.restore();
}

// --- ND Navigation Display (canvas)
function renderND() {
  const canvas = document.getElementById('nd-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ND center: ownship bottom center
  const cx = canvas.width/2, cy = canvas.height-40;
  // Draw compass arc
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0,0,120,Math.PI,2*Math.PI);
  ctx.stroke();
  // Draw ticks every 30 deg
  for (let a=0; a<180; a+=30) {
    let rad = (a-90)*Math.PI/180;
    ctx.save();
    ctx.rotate(rad);
    ctx.beginPath();
    ctx.moveTo(0,-100);
    ctx.lineTo(0, -120);
    ctx.stroke();
    ctx.restore();
  }
  // Heading bug (ownship)
  ctx.strokeStyle = 'yellow';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -105);
  ctx.lineTo(0, -120);
  ctx.stroke();

  // Draw route legs (if any)
  ctx.strokeStyle = 'cyan';
  ctx.lineWidth = 2;
  if (state.mcduFPlan.waypoints.length > 1) {
    ctx.beginPath();
    ctx.moveTo(0,0);
    for (let i=1; i<state.mcduFPlan.waypoints.length; ++i) {
      // Simple mock: each WP 50px up
      ctx.lineTo(0, -i*50);
    }
    ctx.stroke();
    // Waypoint names
    ctx.font = '11px Arial';
    for (let i=0; i<state.mcduFPlan.waypoints.length; ++i) {
      ctx.fillText(state.mcduFPlan.waypoints[i].id||('-'+i), 10, -i*50);
    }
  }

  ctx.restore();
  ctx.fillStyle = 'white';
  ctx.font = '14px Arial';
  ctx.fillText("ND Range: "+state.ndRange+"NM", 14, 25);
}

// --- Leaflet Map (separate DOM)
function initializeLeafletMap() {
  if (!window.L) return;
  state.leafletMap = L.map('leaflet-map').setView([state.position.lat, state.position.lon], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'IFRS &copy; OpenStreetMap contributors'
  }).addTo(state.leafletMap);
  // Aircraft marker
  const ownIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3884/3884367.png',
    iconSize: [32,32]
  });
  state.ownLeafletMarker = L.marker([state.position.lat, state.position.lon], {icon: ownIcon}).addTo(state.leafletMap).bindPopup('Ownship');
}

// --- MCDU rendering and logic
function renderMCDU() {
  const c = document.getElementById('mcdu-panel');
  if (!c) return;
  // Tab controls
  let tabbar = `
    <button class="mcdu-tab" id="tab-init-a">INIT A</button>
    <button class="mcdu-tab" id="tab-fplan">F-PLAN</button>
    <button class="mcdu-tab" id="tab-perf">PERF</button>
  `;
  c.innerHTML = `
    <div class="panel-title">MCDU</div>
    <div>${tabbar}</div>
    <div id="mcdu-content"></div>
    <div id="mcdu-input"></div>
  `;
  // Init A default
  renderMCDUInitA();
  setTimeout(() => {
    document.getElementById('tab-init-a')?.addEventListener('click', renderMCDUInitA);
    document.getElementById('tab-fplan')?.addEventListener('click', renderMCDUFPlan);
    document.getElementById('tab-perf')?.addEventListener('click', renderMCDUPerf);
  },0);
}

// --- MCDU INIT A Page
function renderMCDUInitA() {
  const c = document.getElementById('mcdu-content');
  c.innerHTML = `
    <table><tr><td>FROM/TO:</td><td>${state.mcduInitA.fromTo || '&mdash;'}</td></tr>
      <tr><td>FLIGHT NO:</td><td>${state.mcduInitA.flightNumber || '&mdash;'}</td></tr>
      <tr><td>COST INDEX:</td><td>${state.mcduInitA.costIndex || '&mdash;'}</td></tr>
      <tr><td>CRZ FL:</td><td>${state.mcduInitA.crzFL || '&mdash;'}</td></tr>
      <tr><td>TEMP:</td><td>${state.mcduInitA.temperature || '&mdash;'}</td></tr>
      <tr><td>WIND:</td><td>${state.mcduInitA.wind || '&mdash;'}</td></tr>
    </table>
    <input type="text" id="init-a-inp" placeholder="LSZH/EGLL, EZY123..." size="18">
    <button id="init-a-cnf">Enter</button>
  `;
  setTimeout(() => {
    document.getElementById('init-a-cnf')?.onclick = () => {
      const val = document.getElementById('init-a-inp').value.trim();
      if (val.match(/^[A-Z]{4}\/[A-Z]{4}/)) {
        state.mcduInitA.fromTo = val.toUpperCase();
      } else if (/^\d+$/.test(val)) {
        state.mcduInitA.costIndex = val;
      } else if (/^[A-Z]{3,4}\d{1,4}$/i.test(val)) {
        state.mcduInitA.flightNumber = val;
      } else if (/^FL\d+$/i.test(val)) {
        state.mcduInitA.crzFL = val;
      } else if (/^-?\d+[A-Z]?$/.test(val)) {
        state.mcduInitA.temperature = val;
      } else if (/^\d+\/\d+$/i.test(val)) {
        state.mcduInitA.wind = val;
      }
      renderMCDUInitA();
    }
  }, 0);
}

// --- MCDU F-PLAN Page
function renderMCDUFPlan() {
  const c = document.getElementById('mcdu-content');
  const wps = state.mcduFPlan.waypoints.length ? state.mcduFPlan.waypoints.map((wp,i)=>
    `<li>${wp.id || ('+'+i)} <b>(${wp.lat.toFixed(2)},${wp.lon.toFixed(2)})</b></li>`).join('') : "<li>No waypoints loaded</li>";
  c.innerHTML = `
    <div><b>Waypoints</b> <ol>${wps}</ol></div>
    <input type="text" id="fplan-inp" placeholder="WPT123, etc" size="8">
    <input type="text" id="fplan-lat" placeholder="Lat" size="6">
    <input type="text" id="fplan-lon" placeholder="Lon" size="6">
    <button id="fplan-add">Add</button>
    <button id="fplan-clear">Clear</button>
  `;
  setTimeout(() => {
    document.getElementById('fplan-add')?.onclick = () => {
      const wp = document.getElementById('fplan-inp').value || `WPT${state.mcduFPlan.waypoints.length}`;
      let lat = parseFloat(document.getElementById('fplan-lat').value);
      let lon = parseFloat(document.getElementById('fplan-lon').value);
      if(Number.isFinite(lat) && Number.isFinite(lon)) {
        state.mcduFPlan.waypoints.push({ id: wp, lat, lon });
        renderMCDUFPlan();
      }
    };
    document.getElementById('fplan-clear')?.onclick = () => {
      state.mcduFPlan.waypoints = [];
      renderMCDUFPlan();
    }
  },0);
}

// --- MCDU PERF Page
function renderMCDUPerf() {
  // Only show takeoff as minimal demo, could page climb/cruise/approach via more tabs
  const c = document.getElementById('mcdu-content');
  const p = state.mcduPerf.takeoff;
  c.innerHTML = `
    <table>
      <tr><td>V1</td><td>${p.v1||'—'}</td></tr>
      <tr><td>VR</td><td>${p.vr||'—'}</td></tr>
      <tr><td>V2</td><td>${p.v2||'—'}</td></tr>
      <tr><td>FLAPS</td><td>${p.flapSetting||'—'}</td></tr>
      <tr><td>FLEX TEMP</td><td>${p.flexTemp||'—'}</td></tr>
      <tr><td>THR RED</td><td>${p.thrRed||'—'}</td></tr>
      <tr><td>ACCEL ALT</td><td>${p.accelAlt||'—'}</td></tr>
      <tr><td>ENG OUT ACC</td><td>${p.engOutAccel||'—'}</td></tr>
    </table>
    <input type="text" id="perf-inp" placeholder="ENTER VALUE / FIELD" size="14">
    <button id="perf-cnf">Set</button>
  `;
  setTimeout(() => {
    document.getElementById('perf-cnf')?.onclick = () => {
      const val = document.getElementById('perf-inp').value.trim();
      if (!val) return;
      if (/^v1=\d+$/i.test(val)) p.v1 = val.slice(3);
      else if (/^vr=\d+$/i.test(val)) p.vr = val.slice(3);
      else if (/^v2=\d+$/i.test(val)) p.v2 = val.slice(3);
      else if (/^flaps?=\S+$/i.test(val)) p.flapSetting = val.split('=')[1];
      else if (/^flex=?\S+$/i.test(val)) p.flexTemp = val.split('=')[1];
      else if (/^thrr?ed=?\S+$/i.test(val)) p.thrRed = val.split('=')[1];
      else if (/^acc(el)?=?\S+$/i.test(val)) p.accelAlt = val.split('=')[1];
      else if (/^engout(acc)?=?\S+$/i.test(val)) p.engOutAccel = val.split('=')[1];
      renderMCDUPerf();
    }
  }, 0);
}

// --- ATC Panel (simple recent message log)
function renderATCPanel() {
  const c = document.getElementById('atc-panel');
  if (!c) return;
  c.innerHTML = `
    <div class='panel-title'>ATC Log</div>
    <ol style="font-size:0.95em">
      ${state.atcMessages.map(msg=>`<li>${msg.text}</li>`).join('')}
    </ol>
    <input type="text" id="atc-inp" placeholder="Type ATC request..." size="18">
    <button id="atc-send">Send</button>
  `;
  setTimeout(() => {
    document.getElementById('atc-send')?.onclick = () => {
      const text = document.getElementById('atc-inp').value.trim();
      if (text) atcVoiceStub(text);
      renderATCPanel();
    }
  },0);
}

// --- All Panels at Once
function renderAllUIPanels() {
  renderOverheadPanel();
  renderEnginePanel();
  renderAutopilotPanel();
  renderPFD();
  renderND();
  renderMCDU();
  renderATCPanel();
}

// --------------- Main Simulation Loop ---------------------
let mainLoopStarted = false;

function mainLoop() {
  // Simulate basic dynamic params
  // For demo: bank up and down over time
  state.pitch = 10*Math.sin(Date.now()/2000);
  state.roll = 15*Math.sin(Date.now()/2500);
  state.hdg_true += (state.autopilotMode !== 'manual' ? 0.2 : 0.05);
  if (state.hdg_true > 360) state.hdg_true -= 360;

  updateFuelBurn();

  // Update UI
  renderAllUIPanels();

  // Update Leaflet map
  if (state.leafletMap && state.ownLeafletMarker) {
    state.ownLeafletMarker.setLatLng([state.position.lat, state.position.lon]);
    state.leafletMap.panTo([state.position.lat, state.position.lon], { animate: false });
  }

  window.requestAnimationFrame(mainLoop);
}

// --------------- Initialization Bootstrap ---------------

function bootstrapIFRSCockpitUI() {
  // Attach canvases and panel DIVs
  // Expected: user HTML has <div id='overhead-panel'> etc; <canvas id='pfd-canvas' width=270 height=200>
  renderAllUIPanels();

  // Bootstrap leaflet when loaded (must exist in HTML!)
  if (window.L) setTimeout(initializeLeafletMap, 100);

  if (!mainLoopStarted) {
    mainLoopStarted = true;
    mainLoop();
  }
}

document.addEventListener('DOMContentLoaded', bootstrapIFRSCockpitUI);
