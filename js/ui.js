// IFRS Flight Simulator: Complete Cockpit UI
// Updated: September 2025
// All panels, ND, Leaflet map, MCDU (INIT A, F-PLAN, PERF), Cold & Dark, AP, Fuel, AH, and ATC Stub

(() => {
  // ---------------------------
  // Sim State Model and Helpers
  // ---------------------------
  const state = {
    // Electrical
    batteryOn: false,
    extPwrOn: false,
    apuOn: false,
    apuAvail: false,
    apuGenOn: false,
    busPowered: false,

    // IRS/Avionics
    irsAligning: false,
    irsAligned: false,
    avionicsOn: false,

    // Fuel/Engine
    eng1Start: false,
    eng2Start: false,
    eng1Running: false,
    eng2Running: false,
    fuelTankL: 5500, // kg
    fuelTankR: 5500, // kg
    fuelBurnRate: 2.8, // kg/s per engine at cruise

    // Panel Light
    emerLights: false,

    // Autopilot
    apOn: false,
    apMode: 'OFF', // OFF, HDG, ALT, SPD, LNAV, VNAV
    apTarget: {
      hdg: 0,
      alt: 10000,
      spd: 250
    },
    lnavActive: false,
    vnavActive: false,

    // Flight Dynamics
    attitude: { pitch: 0, roll:0, slip:0 },
    heading: 0,
    airspeed: 0,
    vspeed: 0,
    altitude: 0,

    // Navigation & Route
    position: { lat: 51.5, lon: -0.12 }, // Default: London
    waypoints: [],
    routeIndex: 0, // Active waypoint
    flightPlanLoaded: false,

    // Time
    time: 0,

    // MCDU Data
    mcdu: {
      INIT: {
        flightNo: '', from: '', to: '',
        costIdx: 0, crzFL: 350, crzTemp: -56, wind: '---'
      },
      FPLAN: [], // Array of waypoints: {fix, alt, spd}
      PERF: {
        zfw: 55.4, res: 2, ci: 50, takeoffFlaps: '1+F', v1:131, vr:135, v2:140
      },
    },
    mcduPage: 'INIT',
    // ATC
    atcLog: [],
    // Panel UI (for focus highlight)
    selectedPanel: 'PFD'
  };

  // LVar / Persistent State Storage Helpers
  function saveState() {
    try {
      localStorage.setItem('ifrs_ui_state', JSON.stringify(state));
    } catch (e) {}
  }
  function loadState() {
    try {
      const s = localStorage.getItem('ifrs_ui_state');
      if (s) Object.assign(state, JSON.parse(s));
    } catch (e) {}
  }

  // ---------------------------
  // Helper Functions
  // ---------------------------

  function isColdAndDark() {
    return !state.batteryOn && !state.eng1Running && !state.eng2Running && !state.apuOn;
  }
  function isReadyForStart() {
    return state.batteryOn && (state.extPwrOn || state.apuGenOn);
  }
  function isAvionicsPowered() {
    return (state.batteryOn && (state.extPwrOn || state.apuGenOn)) && state.irsAligned;
  }
  function getActiveFPLWaypoint() {
    if (!state.mcdu.FPLAN.length) return null;
    return state.mcdu.FPLAN[state.routeIndex] || null;
  }
  function nextWaypoint() {
    if (state.routeIndex + 1 < state.mcdu.FPLAN.length) state.routeIndex++;
  }
  function prevWaypoint() {
    if (state.routeIndex > 0) state.routeIndex--;
  }

  // Degrees to radians
  const deg2rad = deg => deg * Math.PI / 180;
  // Bearing between two coords
  function bearingTo(from, to) {
    const φ1 = deg2rad(from.lat), φ2 = deg2rad(to.lat);
    const λ1 = deg2rad(from.lon), λ2 = deg2rad(to.lon);
    const y = Math.sin(λ2-λ1)*Math.cos(φ2);
    const x = Math.cos(φ1)*Math.sin(φ2) -
      Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
    let θ = Math.atan2(y,x);
    θ = (θ * 180 / Math.PI + 360) % 360;
    return θ;
  }
  function haversine(from, to) {
    // Returns distance in NM
    const R = 3440.065; // NM
    const dLat = deg2rad(to.lat-from.lat);
    const dLon = deg2rad(to.lon-from.lon);
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
      Math.cos(deg2rad(from.lat))*Math.cos(deg2rad(to.lat))*Math.sin(dLon/2)*Math.sin(dLon/2);
    return 2*R*Math.asin(Math.sqrt(a));
  }

  // Fuel burn logic
  function updateFuelBurn(dt) {
    let burn = 0;
    if (state.eng1Running) burn += state.fuelBurnRate * dt;
    if (state.eng2Running) burn += state.fuelBurnRate * dt;
    // Simple: 50/50 tanks
    state.fuelTankL = Math.max(0, state.fuelTankL - burn/2);
    state.fuelTankR = Math.max(0, state.fuelTankR - burn/2);
  }

  // ATC Voice Stub
  function atcSay(line) {
    state.atcLog.push({ time: Date.now(), line });
    // (Voice playback can be integrated here; currently a stub for UI display)
  }

  // Simple random wind for PERF
  function randomWind() {
    const dir = Math.floor(Math.random()*360);
    const spd = Math.floor(Math.random()*60);
    return `${dir}/${spd}`;
  }

  // ---------------------------
  // Panel UI: DOM Construction
  // ---------------------------

  // Main container creation, once
  const mainContainer = document.createElement('div');
  mainContainer.id = 'ifrs-cockpit-main';
  mainContainer.style = `display:flex;flex-direction:row;background:#161b20;color:#f3f3f3;font:15px/1.3 "Segoe UI",Arial,sans-serif;height:100vh`;

  // Panels: Overhead, Engine, Autopilot, PFD, ND, Map, MCDU (tabbed layout)
  mainContainer.innerHTML = `
    <div id="ifrs-sidepanels" style="width:360px;min-width:300px;max-width:450px;background:#10151a;display:flex;flex-direction:column">
      <div style="flex:1 1 0;display:flex;flex-direction:column;">
        <div id="overhead-panel"></div>
        <div id="engine-panel"></div>
        <div id="autopilot-panel"></div>
      </div>
      <div style="height:50px;display:flex;flex-direction:row;border-top:1px solid #333">
        <button id="pfd-tab">PFD</button>
        <button id="nd-tab">ND</button>
        <button id="map-tab">Map</button>
        <button id="mcdu-tab">MCDU</button>
      </div>
    </div>
    <div id="ifrs-centerpanels" style="flex:1 1 0;background:#03040a;display:flex;flex-direction:column;overflow:hidden;">
      <div id="pfd-panel" style="display:flex;flex:1 1 0;"></div>
      <div id="nd-panel" style="display:none;flex:1 1 0;"></div>
      <div id="map-panel" style="display:none;flex:1 1 0;"></div>
      <div id="mcdu-panel" style="display:none;flex:1 1 0;"></div>
    </div>
  `;
  document.body.appendChild(mainContainer);

  // Focus switchers for tabbed panels
  document.getElementById('pfd-tab').onclick = ()=>switchPanel('PFD');
  document.getElementById('nd-tab').onclick = ()=>switchPanel('ND');
  document.getElementById('map-tab').onclick = ()=>switchPanel('MAP');
  document.getElementById('mcdu-tab').onclick = ()=>switchPanel('MCDU');
  function switchPanel(name) {
    state.selectedPanel = name;
    document.getElementById('pfd-panel').style.display = name==='PFD' ? 'flex':'none';
    document.getElementById('nd-panel').style.display = name==='ND' ? 'flex':'none';
    document.getElementById('map-panel').style.display = name==='MAP' ? 'flex':'none';
    document.getElementById('mcdu-panel').style.display = name==='MCDU' ? 'flex':'none';
  }

  // Attach Canvas and Map placeholders once
  const pfdCanvas = document.createElement('canvas');
  pfdCanvas.id = 'pfd-canvas'; pfdCanvas.width = 500; pfdCanvas.height = 500;
  pfdCanvas.style = 'background:#212a38;margin:8px;border-radius:12px;box-shadow:0 0 20px #0896ff3a;';
  document.getElementById('pfd-panel').appendChild(pfdCanvas);

  const ndCanvas = document.createElement('canvas');
  ndCanvas.id = 'nd-canvas'; ndCanvas.width = 500; ndCanvas.height = 500;
  ndCanvas.style = 'background:#19252d;margin:8px;border-radius:12px;box-shadow:0 0 16px #ccabff38;';
  document.getElementById('nd-panel').appendChild(ndCanvas);

  const mapDiv = document.createElement('div');
  mapDiv.id = 'leaflet-map'; mapDiv.style = 'width:98%;height:480px;border-radius:16px;margin:10px auto;';
  document.getElementById('map-panel').appendChild(mapDiv);

  // ---------------------------
  // Panel Render Functions
  // ---------------------------

  function renderOverheadPanel() {
    document.getElementById('overhead-panel').innerHTML = `
      <div style="margin:12px;">
        <h3 style="color:#b4cffa">Overhead Panel</h3>
        <button id="batteryBtn" style="background:${state.batteryOn ? '#19e0af':'#222'};color:#000;font-weight:bold;">Battery ${state.batteryOn?'ON':'OFF'}</button>
        <button id="extPwrBtn" style="background:${state.extPwrOn ? '#e0e632':'#333'}">EXT PWR</button>
        <button id="apuBtn" style="background:${state.apuOn?'#98f':'#454545'}">APU ${state.apuOn?(state.apuAvail?'(Avail)':'(Starting)'):'OFF'}</button>
        <button id="apuGenBtn" style="background:${state.apuGenOn?'#01bffd':'#333'}">APU GEN</button>
        <button id="irsBtn" style="background:${state.irsAligned?'#6f3':'#181'}">IRS: ${state.irsAligned?'Aligned':'OFF'}</button>
        <button id="emerBtn" style="background:${state.emerLights?'#fdfc07':'#333'}">EMER LT</button>
      </div>
    `;

    const AirportDB = { … };

// add helpers here
function blockSwitch(label, id, on) {
  return `
    <div class="switch" style="display:flex; align-items:center; gap:.5rem; margin:.25rem 0;">
      <span>${label}</span>
      <button id="${id}">${on ? 'ON' : 'OFF'}</button>
    </div>
  `;
}

function blockToggle(label, id, on, onTxt = 'ON', offTxt = 'OFF') {
  return `
    <div class="switch" style="display:flex; align-items:center; gap:.5rem; margin:.25rem 0;">
      <span>${label}</span>
      <button id="${id}">${on ? onTxt : offTxt}</button>
    </div>
  `;
}

// now your panel functions
function renderOverheadPanel() {
    // …
}
    // Wire events
    document.getElementById('batteryBtn').onclick = ()=>{ state.batteryOn=!state.batteryOn;saveState();};
    document.getElementById('extPwrBtn').onclick = ()=>{ state.extPwrOn=!state.extPwrOn;saveState();};
    document.getElementById('apuBtn').onclick = ()=>{ 
      if (!state.apuOn) { state.apuOn=true; state.apuAvail=false; setTimeout(()=>{ state.apuAvail=true; }, 3000);}
      else { state.apuOn=false; state.apuAvail=false; state.apuGenOn=false;}
      saveState();
    };
    document.getElementById('apuGenBtn').onclick = ()=>{ 
      if (state.apuOn && state.apuAvail) state.apuGenOn=!state.apuGenOn;
      saveState();
    };
    document.getElementById('irsBtn').onclick = ()=>{
      if (!state.irsAligned && isReadyForStart()) {
        state.irsAligning = true;
        setTimeout(()=>{ 
          state.irsAligning=false; 
          state.irsAligned=true; 
          state.atcLog.push({time: Date.now(),line:'IRS aligned'});
          saveState();
        }, 3000);
      } else if (state.irsAligned) {
        state.irsAligned=false; state.irsAligning=false; saveState();
      }
    };
    document.getElementById('emerBtn').onclick = ()=>{ state.emerLights=!state.emerLights;saveState();};
  }

  function renderEnginePanel() {
    document.getElementById('engine-panel').innerHTML = `
      <div style="margin:12px;">
        <h3 style="color:#ddc">Engine Panel</h3>
        <button id="eng1Btn" style="background:${state.eng1Start?'#fbb':'#333'}">ENG 1 START</button>
        <button id="eng2Btn" style="background:${state.eng2Start?'#fbb':'#333'}">ENG 2 START</button>
        <span style="margin-left:16px;">L:${state.fuelTankL.toFixed(0)}kg | R:${state.fuelTankR.toFixed(0)}kg</span>
        <div style="color:#baf;">Status: 
          <span>ENG1: ${state.eng1Running?'RUN':'OFF'}</span>,
          <span>ENG2: ${state.eng2Running?'RUN':'OFF'}</span>
        </div>
      </div>
    `;
    document.getElementById('eng1Btn').onclick = ()=>{
      if (state.eng1Running) state.eng1Running=false;
      else if (isAvionicsPowered()) { state.eng1Start=true; setTimeout(()=>{ state.eng1Running=true; state.eng1Start=false;}, 2500);}
      saveState();
    };
    document.getElementById('eng2Btn').onclick = ()=>{
      if (state.eng2Running) state.eng2Running=false;
      else if (isAvionicsPowered()) { state.eng2Start=true; setTimeout(()=>{ state.eng2Running=true; state.eng2Start=false;}, 2600);}
      saveState();
    };
  }

  function renderAutopilotPanel() {
    document.getElementById('autopilot-panel').innerHTML = `
      <div style="margin:12px;">
        <h3 style="color:#fade88;">Autopilot Panel</h3>
        <label>AP: <input id="apOnChk" type="checkbox" ${state.apOn?'checked':''}/></label>
        <label>HDG: <input id="apHdg" type="number" value="${state.apTarget.hdg}" min="0" max="359" style="width:60px;"></label>
        <label>ALT: <input id="apAlt" type="number" value="${state.apTarget.alt}" min="100" max="40000" style="width:80px;"></label>
        <label>SPD: <input id="apSpd" type="number" value="${state.apTarget.spd}" min="80" max="500" style="width:64px;"></label>
        <button id="apModeBtn" style="background:#282">Mode: ${state.apMode}</button>
      </div>
      <div style="margin-left:12px;">
        <button id="lnavBtn" style="background:${state.lnavActive ? '#adf':'#222'};">LNAV</button>
        <button id="vnavBtn" style="background:${state.vnavActive ? '#fea':'#222'};">VNAV</button>
      </div>
    `;
    document.getElementById('apOnChk').onchange = e => { state.apOn = !!e.target.checked; saveState();};
    document.getElementById('apHdg').onchange = e => { state.apTarget.hdg=parseInt(e.target.value)||0; saveState();};
    document.getElementById('apAlt').onchange = e => { state.apTarget.alt=parseInt(e.target.value)||0; saveState();};
    document.getElementById('apSpd').onchange = e => { state.apTarget.spd=parseInt(e.target.value)||0; saveState();};
    document.getElementById('apModeBtn').onclick = ()=>{
      // Cycle through HDG/SPD/ALT/LNAV/VNAV/OFF
      const modes = ['OFF','HDG','SPD','ALT','LNAV','VNAV'];
      let idx = modes.indexOf(state.apMode);
      state.apMode = modes[(idx+1)%modes.length];
      saveState();
    };
    document.getElementById('lnavBtn').onclick = ()=>{ state.lnavActive=!state.lnavActive; saveState();};
    document.getElementById('vnavBtn').onclick = ()=>{ state.vnavActive=!state.vnavActive; saveState();};
  }

  // --- PFD Artificial Horizon Panel (Canvas) ---
  function drawPFD() {
    const ctx = pfdCanvas.getContext('2d');
    ctx.clearRect(0,0,pfdCanvas.width,pfdCanvas.height);

    // Artificial horizon
    const cx = 250, cy = 250, r = 170;
    const pitch = state.attitude.pitch, roll = state.attitude.roll;
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(-roll*Math.PI/180);

    // Horizon sky/ground
    let pitchPx = pitch * 2.1;
    ctx.fillStyle = '#3193ff';
    ctx.beginPath();
    ctx.arc(0,pitchPx, r, Math.PI, 2*Math.PI);
    ctx.fill();
    ctx.fillStyle = '#e9bd79';
    ctx.beginPath();
    ctx.arc(0,pitchPx, r, 0, Math.PI);
    ctx.fill();

    // Horizon line
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r, pitchPx); ctx.lineTo(r,pitchPx);
    ctx.stroke();

    ctx.restore();

    // Center cross/aircraft symbol
    ctx.save();
    ctx.translate(cx,cy);
    ctx.strokeStyle='#fff'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(-20,0);ctx.lineTo(20,0);ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-10);ctx.lineTo(0,10);ctx.stroke();
    ctx.restore();

    // Speed/Alt tapes
    ctx.font='bold 20px Segoe UI';
    ctx.fillStyle='#ace';
    ctx.fillText('SPD', 10,180);
    ctx.font='bold 32px Segoe UI';
    ctx.fillText(state.airspeed.toFixed(0), 16,220);

    ctx.font='bold 20px Segoe UI';
    ctx.fillText('ALT', 426,180);
    ctx.font='bold 32px Segoe UI';
    ctx.fillText(state.altitude.toFixed(0), 415,220);

    // Heading box
    ctx.strokeStyle='#8d5'; ctx.lineWidth = 6;
    ctx.strokeRect(188,10,130,40);
    ctx.fillStyle='#ebe';
    ctx.font = 'bold 30px monospace';
    ctx.fillText('HDG',205,38);
    ctx.fillStyle="#fff"; ctx.font = 'bold 36px monospace';
    ctx.fillText(`${state.heading.toFixed(0)}`,270,38);

    // VSI - vertical speed indicator
    ctx.save(); ctx.translate(470,340);
    ctx.rotate(-Math.PI/2);
    ctx.fillStyle='#fad';
    ctx.font='bolder 22px Segoe UI';
    ctx.fillText(`V/S: ${state.vspeed.toFixed(0)}`,0,0);
    ctx.restore();
  }

  // --- ND: Navigation Display Canvas ---
  function drawND() {
    const ctx = ndCanvas.getContext('2d');
    ctx.clearRect(0,0,ndCanvas.width,ndCanvas.height);

    // Outer compass circle
    const cx=250,cy=250,r=200;
    ctx.save();
    ctx.strokeStyle='#88d';
    ctx.lineWidth=4;
    ctx.beginPath();ctx.arc(cx,cy,r,0,2*Math.PI);ctx.stroke();

    // Compass rose
    for(let i=0;i<36;i++) {
      const ang = (i*10 - state.heading)*Math.PI/180;
      let x = cx + Math.sin(ang)*r, y = cy - Math.cos(ang)*r;
      ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.strokeStyle='#444';ctx.stroke();
      if (i%3===0) {
        ctx.save();
        ctx.translate(cx+Math.sin(ang)*r, cy-Math.cos(ang)*r);
        ctx.rotate(ang);
        ctx.fillStyle='#aaa'; ctx.font='14px monospace';
        let hdgLabel = (i*10)%360;
        ctx.fillText(String(hdgLabel).padStart(3,'0'),-16,0);
        ctx.restore();
      }
    }

    // Active WP, route, and aircraft
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(0);
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(0,0,12,0,2*Math.PI); ctx.fill();
    ctx.fillStyle='#98f'; ctx.font='bold 14px monospace';
    ctx.fillText('A/C',-16,4);
    ctx.restore();

    // Draw route
    if (state.mcdu.FPLAN.length > 0) {
      let prev = state.position;
      ctx.strokeStyle='#1fd'; ctx.lineWidth=4; ctx.beginPath();
      ctx.moveTo(cx,cy);
      for (let w=state.routeIndex;w<state.mcdu.FPLAN.length;w++) {
        const wp = state.mcdu.FPLAN[w];
        let brg = bearingTo(prev, wp);
        let dist = Math.min(haversine(prev, wp), 40); // clamp for ND
        let x = cx+Math.sin(deg2rad(brg-state.heading))*dist*4;
        let y = cy-Math.cos(deg2rad(brg-state.heading))*dist*4;
        ctx.lineTo(x,y);
        prev = wp;
      }
      ctx.stroke();
      // Waypoint marker
      for (let w=state.routeIndex;w<Math.min(state.mcdu.FPLAN.length,state.routeIndex+5);w++) {
        const wp=state.mcdu.FPLAN[w];
        let brg = bearingTo(state.position, wp);
        let dist = Math.min(haversine(state.position, wp), 40);
        let x = cx+Math.sin(deg2rad(brg-state.heading))*dist*4;
        let y = cy-Math.cos(deg2rad(brg-state.heading))*dist*4;
        ctx.fillStyle='#fea'; ctx.beginPath(); ctx.arc(x,y,10,0,2*Math.PI);ctx.fill();
        ctx.fillStyle='#3132ff'; ctx.font='13px monospace';
        ctx.fillText(wp.fix,x-13,y-14);
      }
    }
  }

  // --- Leaflet Map Panel ---
  let map, aircraftMarker, routeLine;
  function initLeaflet() {
    if (window.L && !map) {
      map = L.map('leaflet-map').setView([state.position.lat, state.position.lon], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      aircraftMarker = L.marker([state.position.lat,state.position.lon]).addTo(map)
        .bindPopup('Your Aircraft').openPopup();
      updateRouteOnMap();
    }
  }
  function updateLeaflet() {
    if (map && aircraftMarker) {
      aircraftMarker.setLatLng([state.position.lat,state.position.lon]);
      map.setView([state.position.lat,state.position.lon], map.getZoom(), {animate:true});
      updateRouteOnMap();
    }
  }
  function updateRouteOnMap() {
    // Remove old polyline
    if (routeLine) { try { map.removeLayer(routeLine); } catch(e){} }
    if (state.mcdu.FPLAN.length > 1) {
      const latlons = [[state.position.lat,state.position.lon], ...state.mcdu.FPLAN.map(wp=>[wp.lat,wp.lon])];
      routeLine = L.polyline(latlons, {color:'#1fd',weight:4}).addTo(map);
    }
  }

  // --- MCDU Panel ---
  function renderMCDU() {
    // Draw header + nav
    let html = `<div style="font:15px monospace;background:#222;border-radius:20px 20px 2px 2px;box-shadow:0 4px 24px #ccf2;">
      <div style="display:flex;gap:16px;">
        <strong style="padding:8px 18px;border-bottom:3px solid #11b">${state.mcduPage}</strong>
        <button id="mcdu-initA" style="background:#333;color:#a4c;">INIT A</button>
        <button id="mcdu-fplan" style="background:#333;color:#86f;">F-PLAN</button>
        <button id="mcdu-perf" style="background:#333;color:#f86;">PERF</button>
        <span style="flex:1 1 0"></span>
      </div>
      <div id="mcdu-page-content" style="margin:20px 8px 8px 8px;"></div>
    </div>`;
    document.getElementById('mcdu-panel').innerHTML = html;
    document.getElementById('mcdu-initA').onclick = ()=>{state.mcduPage='INIT';saveState();};
    document.getElementById('mcdu-fplan').onclick = ()=>{state.mcduPage='FPLAN';saveState();};
    document.getElementById('mcdu-perf').onclick = ()=>{state.mcduPage='PERF';saveState();};
    // Page content render
    if (state.mcduPage==='INIT') renderMCDU_INIT();
    if (state.mcduPage==='FPLAN') renderMCDU_FPLAN();
    if (state.mcduPage==='PERF') renderMCDU_PERF();
  }
  function renderMCDU_INIT() {
    const d = state.mcdu.INIT;
    document.getElementById('mcdu-page-content').innerHTML = `
      <form id="initForm">
        <label>Flight No: <input name="flightNo" value="${d.flightNo}" placeholder="EZY123"></label>
        <label>From ICAO: <input name="from" value="${d.from}" placeholder="EGLL" maxlength="4"></label>
        <label>To ICAO: <input name="to" value="${d.to}" placeholder="LFMN" maxlength="4"></label>
        <label>Cost Index: <input name="costIdx" type="number" value="${d.costIdx}" min="0" max="999"></label>
        <label>CRZ FL: <input name="crzFL" type="number" value="${d.crzFL}" min="50" max="450"></label>
        <label>CRZ Temp: <input name="crzTemp" type="number" value="${d.crzTemp}" min="-80" max="50"></label>
        <label>WIND: <input name="wind" value="${d.wind || randomWind()}" maxlength="8"></label>
        <button type="submit">Save</button>
      </form>
    `;
    document.getElementById('initForm').onsubmit = e=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      d.flightNo = fd.get('flightNo');
      d.from = fd.get('from');
      d.to = fd.get('to');
      d.costIdx = parseInt(fd.get('costIdx'))||0;
      d.crzFL= parseInt(fd.get('crzFL'))||350;
      d.crzTemp= parseInt(fd.get('crzTemp'))||-56;
      d.wind = fd.get('wind');
      // Optionally: Load simBrief route if connected.
      saveState();
    };
  }
  function renderMCDU_FPLAN() {
    // List waypoints and allow editing, removal, or addition
    let rows = state.mcdu.FPLAN.map((wp,i)=>`
      <tr><td>${i+1}</td>
          <td><input data-idx="${i}" class="mcdu-fix" value="${wp.fix}"></td>
          <td><input data-idx="${i}" class="mcdu-lat" value="${wp.lat.toFixed(3)}"></td>
          <td><input data-idx="${i}" class="mcdu-lon" value="${wp.lon.toFixed(3)}"></td>
          <td><input data-idx="${i}" class="mcdu-alt" value="${wp.alt||''}"></td>
          <td><input data-idx="${i}" class="mcdu-spd" value="${wp.spd||''}"></td>
          <td><button data-idx="${i}" class="delwp">X</button></td></tr>
    `).join('');
    // New row template
    const newRow = `<tr><td>+</td><td><input id="new-fix" size="7"></td>
      <td><input id="new-lat" size="7"></td><td><input id="new-lon" size="7"></td>
      <td><input id="new-alt" size="5"></td><td><input id="new-spd" size="5"></td>
      <td><button id="addwp">Add</button></td></tr>`;
    document.getElementById('mcdu-page-content').innerHTML =`
      <table style="background:#191b25;width:99%;border-collapse:collapse;">
        <thead><tr>
        <th>#</th><th>FIX</th><th>LAT</th><th>LON</th><th>ALT</th><th>SPD</th><th></th></tr></thead>
        <tbody>${rows}${newRow}</tbody>
      </table>
      <button id="savefplan">Save & Refresh</button>
    `;
    // Wire up WP editing & add/remove
    document.querySelectorAll('.delwp').forEach(btn=>{
      btn.onclick = ()=>{ 
        state.mcdu.FPLAN.splice(parseInt(btn.dataset.idx),1); 
        saveState();
      };
    });
    document.getElementById('addwp').onclick = ()=>{
      const fix = document.getElementById('new-fix').value;
      const lat = parseFloat(document.getElementById('new-lat').value);
      const lon = parseFloat(document.getElementById('new-lon').value);
      const alt = parseInt(document.getElementById('new-alt').value)||null;
      const spd = parseInt(document.getElementById('new-spd').value)||null;
      if (fix && !isNaN(lat) && !isNaN(lon)) {
        state.mcdu.FPLAN.push({fix,lat,lon,alt,spd});
        saveState();
      }
    };
    // Save/refresh after manual editing
    document.getElementById('savefplan').onclick = () => {
      document.querySelectorAll('.mcdu-fix').forEach(inp=>{
        let idx=parseInt(inp.dataset.idx); state.mcdu.FPLAN[idx].fix=inp.value;
      });
      document.querySelectorAll('.mcdu-lat').forEach(inp=>{
        let idx=parseInt(inp.dataset.idx); state.mcdu.FPLAN[idx].lat=parseFloat(inp.value)||state.mcdu.FPLAN[idx].lat;
      });
      document.querySelectorAll('.mcdu-lon').forEach(inp=>{
        let idx=parseInt(inp.dataset.idx); state.mcdu.FPLAN[idx].lon=parseFloat(inp.value)||state.mcdu.FPLAN[idx].lon;
      });
      document.querySelectorAll('.mcdu-alt').forEach(inp=>{
        let idx=parseInt(inp.dataset.idx); state.mcdu.FPLAN[idx].alt=parseInt(inp.value)||state.mcdu.FPLAN[idx].alt;
      });
      document.querySelectorAll('.mcdu-spd').forEach(inp=>{
        let idx=parseInt(inp.dataset.idx); state.mcdu.FPLAN[idx].spd=parseInt(inp.value)||state.mcdu.FPLAN[idx].spd;
      });
      saveState();
    };
  }
  function renderMCDU_PERF() {
    const pf = state.mcdu.PERF;
    document.getElementById('mcdu-page-content').innerHTML = `
      <form id="perfForm">
        <label>ZFW (t): <input name="zfw" value="${pf.zfw}" type="number" step="0.1"></label>
        <label>Reserves (t): <input name="res" value="${pf.res}" type="number" step="0.1"></label>
        <label>Cost idx: <input name="ci" value="${pf.ci}" type="number"></label>
        <label>TO Flaps: <input name="toflaps" value="${pf.takeoffFlaps}" maxlength="4"></label>
        <label>V1: <input name="v1" value="${pf.v1}" type="number"></label>
        <label>Vr: <input name="vr" value="${pf.vr}" type="number"></label>
        <label>V2: <input name="v2" value="${pf.v2}" type="number"></label>
        <button type="submit">Save</button>
      </form>
    `;
    document.getElementById('perfForm').onsubmit = e=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      pf.zfw=parseFloat(fd.get('zfw'))||pf.zfw;
      pf.res=parseFloat(fd.get('res'))||pf.res;
      pf.ci=parseInt(fd.get('ci')) || pf.ci;
      pf.takeoffFlaps = fd.get('toflaps');
      pf.v1=parseInt(fd.get('v1'))||pf.v1;
      pf.vr=parseInt(fd.get('vr'))||pf.vr;
      pf.v2=parseInt(fd.get('v2'))||pf.v2;
      saveState();
    };
  }

  // --- ATC Log Panel (as overlay in PFD) ---
  function renderATCLog() {
    if (state.atcLog.length) {
      const atcPanelId = 'ifrs-atc-log';
      let el = document.getElementById(atcPanelId);
      if (!el) {
        el = document.createElement('div');
        el.id = atcPanelId;
        el.style = 'position:absolute;right:14px;top:16px;background:rgba(10,14,36,0.90);color:#9fc;min-width:180px;max-width:300px;border:2px solid #23a4ff;border-radius:14px;font:13px monospace;z-index:99;padding:8px 16px;';
        pfdCanvas.parentElement.appendChild(el);
      }
      // Render most recent 3 lines
      el.innerHTML = state.atcLog.slice(-3).map(line=>`<div>[ATC] ${line.line}</div>`).join('');
    }
  }

  // ---------------------------
  // Main Simulation Loop Logic
  // ---------------------------

  function mainLoop() {
    // Simulate time
    state.time += 1/60;

    // Power management
    state.busPowered = state.batteryOn && (state.extPwrOn || state.apuGenOn);

    // Simulate avionics and alignment
    state.avionicsOn = isAvionicsPowered();

    // Attitude simulation (simple airplane physics)
    if (state.apOn) {
      // Autopilot logic
      if (state.apMode === 'HDG') {
        let err = (state.apTarget.hdg - state.heading + 540) % 360 - 180;
        state.heading = (state.heading + Math.sign(err)*Math.min(Math.abs(err),1.6)) % 360;
      }
      if (state.apMode === 'ALT') {
        let err = state.apTarget.alt - state.altitude;
        state.vspeed = Math.max(Math.min(err/6,2100),-2100);
        if (Math.abs(err)<8) state.vspeed = 0;
      }
      if (state.apMode === 'SPD') {
        let err = state.apTarget.spd - state.airspeed;
        state.airspeed += Math.sign(err)*Math.min(Math.abs(err),1);
      }
      // LNAV logic
      if ((state.lnavActive || state.apMode==='LNAV') && getActiveFPLWaypoint()) {
        const wp = getActiveFPLWaypoint();
        const dest = {lat:wp.lat,lon:wp.lon};
        let brg = bearingTo(state.position, dest);
        let err = (brg-state.heading+540)%360-180;
        state.heading = (state.heading + Math.sign(err)*Math.min(Math.abs(err),1.4))%360;
        // Advance to next WP if close (<3NM)
        let dist = haversine(state.position, dest);
        if (dist < 3) nextWaypoint();
      }
      // VNAV logic
      if ((state.vnavActive || state.apMode==='VNAV') && getActiveFPLWaypoint()) {
        const wp = getActiveFPLWaypoint();
        if (wp.alt) {
          let err = wp.alt-state.altitude;
          state.vspeed = Math.max(Math.min(err/6,2300),-2300);
          if (Math.abs(err)<16) state.vspeed = 0;
        }
      }
      // Path update
      state.altitude += state.vspeed/60;
      state.airspeed = Math.max(state.airspeed,80);
      // Aircraft movement
      const gs = Math.max(state.airspeed*0.9,70); // knots, to NM/h
      let hdgRad = deg2rad(state.heading);
      state.position.lat += (gs/3600)*Math.cos(hdgRad)/60; // crude, lat per deg ~60NM
      state.position.lon += (gs/3600)*Math.sin(hdgRad)/Math.cos(deg2rad(state.position.lat))/60;
    }

    // Simulate pitch/roll
    state.attitude.pitch = Math.max(Math.min((state.vspeed/700), 18), -18);
    state.attitude.roll = Math.max(Math.min((state.heading - (getActiveFPLWaypoint() ? bearingTo(state.position, getActiveFPLWaypoint()) : state.heading))/2,30),-30);

    // Fuel
    updateFuelBurn(1/60);
    if (state.fuelTankL < 5 && state.eng1Running) state.eng1Running = false;
    if (state.fuelTankR < 5 && state.eng2Running) state.eng2Running = false;

    // Save state every 10 seconds
    if (Math.floor(state.time)%10===0) saveState();

    // Repaint panels/UI
    renderOverheadPanel();
    renderEnginePanel();
    renderAutopilotPanel();
    renderATCLog();
    renderMCDU();
    drawPFD();
    drawND();
    updateLeaflet();

    requestAnimationFrame(mainLoop);
  }

  // ---------------------------
  // Initialization and Cold & Dark Management
  // ---------------------------

  function firstRunInit() {
    loadState();
    if (isColdAndDark()) {
      state.apuOn = false;
      state.apuGenOn = false;
      state.irsAligned = false;
      state.eng1Running = false;
      state.eng2Running = false;
      state.batteryOn = false;
      state.extPwrOn = false;
      state.lnavActive = false;
      state.vnavActive = false;
      state.atcLog = [];
      if (!state.mcdu.FPLAN.length) {
        // Generic route for demonstration
        state.mcdu.FPLAN =
          [{fix:'LON',lat:51.509,lon:-0.12,alt:5000,spd:220},
           {fix:'MID',lat:50.867,lon:-0.145,alt:12000,spd:330},
           {fix:'BES',lat:48.857,lon:-1.608,alt:35000,spd:440},
           {fix:'NCE',lat:43.665,lon:7.215,alt:5000,spd:220}];
      }
    }
    initLeaflet();
    switchPanel('PFD');
    mainLoop();
  }

  // On DOM ready / sim loaded
  window.addEventListener('DOMContentLoaded', firstRunInit);

})();
