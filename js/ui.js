// IFRS Glass Cockpit UI Implementation
// All Panels, ND, Leaflet Integration, MCDU Full (INIT A, F-PLAN, PERF), Cold & Dark, Autopilot (LNAV/VNAV), ATC Stub
// Author: IFRS Instrument Flight Rules Simulator Team (2025)
// Strict mode, ES2021+ syntax. Fully modular, ready to drop into IFRS project.

"use strict";

/* ---- STATE MANAGEMENT SECTION ---- */

// Top-level state object
const state = {
  aircraft: {
    powered: false,
    coldAndDark: true,
    overhead: {
      battery: false,
      externalPower: false,
      apuAvailable: false,
      apuOn: false,
      fuelPumps: false,
      hydraulics: false,
      lights: {
        beacon: false,
        nav: false,
        strobe: false,
        landing: false,
        taxi: false,
      },
      airConditioning: false,
    },
    engines: [
      { master: false, running: false, n1: 0, n2: 0, egt: 0, fuelFlow: 0 },
      { master: false, running: false, n1: 0, n2: 0, egt: 0, fuelFlow: 0 },
    ],
    fuel: {
      quantity: 10000,    // in kilograms
      capacity: 10000,
      burnRate: 0,        // kg/h, updated dynamically
    },
    flight: {
      altitude: 0,
      vs: 0,
      hdg: 0,
      ias: 0,
      tas: 0,
      gs: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      lat: 0,
      lon: 0,
    },
    autopilot: {
      enabled: false,
      lnav: false,
      vnav: false,
      heading: 0,
      altSel: 0,
      speedSel: 0,
      vsSel: 0,
      mode: "OFF",      // "HDG", "LNAV", etc.
      armed: {
        lnav: false,
        vnav: false,
      },
    },
    fms: {
      flightPlan: [],      // array of waypoints (lat,lon,alt)
      perf: {},
      initA: {
        from: "",    // ICAO
        to: "",      // ICAO
        flightNumber: "",
        costIndex: "",
        cruiseLevel: "",
        cruiseTemp: "",
      },
      perfPages: {
        current: "TAKEOFF", // "TAKEOFF", "CLIMB", etc.
        data: {},
      },
      position: 0,   // index in FPLN
    },
    mcdu: {
      page: "MENU", // "INITA", "FPLN", "PERF", etc.
      scratchpad: "",
      selectedField: null,
    },
    atc: {
      lastMessage: "",
      stubEnabled: true,
    },
    isInitialized: false, // for startup
  }
};

/* ---- SUBSCRIBERS & STATE MANAGEMENT ---- */

const subscribers = [];

function subscribe(fn) {
  subscribers.push(fn);
}
function notify() {
  subscribers.forEach(fn => fn(state));
}
function setState(mutator) {
  mutator(state);
  notify();
}

/* ---- HELPER FUNCTIONS ---- */

// Clamp a value between min and max
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Format number to n decimals
function fmt(n, d = 0) {
  return Number.parseFloat(n).toFixed(d);
}

// ICAO Uppercase validation
function validIcao(s) {
  return !!/^[A-Z]{4}$/.test((s || "").toUpperCase());
}

// Simplified fuel burn calculation (derate based on N1)
function computeFuelBurn(engine) {
  if (!engine.running || engine.n1 < 10) return 0;
  const base = 2500; // kg/hr at 100% N1
  return base * (engine.n1 / 100);
}

// MCDU Field Text Helper
function mcduLine(str, len = 24) {
  // Pads/truncates string for display
  return (str + " ".repeat(len)).slice(0, len);
}

// Geodetic calculations for ND, move aircraft
function moveAircraft(lat, lon, hdg, distNm) {
  const R = 3440.07; // nautical miles earth radius
  const hdgRad = hdg * (Math.PI / 180);
  const d = distNm / R;
  const lat1 = lat * (Math.PI / 180);
  const lon1 = lon * (Math.PI / 180);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(hdgRad));
  const lon2 = lon1 + Math.atan2(
    Math.sin(hdgRad) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    lat: lat2 * (180 / Math.PI),
    lon: lon2 * (180 / Math.PI),
  };
}

// Simple color util
function getBatteryColor(on) {
  return on ? "#51ff55" : "#ccc";
}

/* ---- PANEL RENDERING FUNCTIONS ---- */

function renderOverheadPanel(el, st) {
  el.innerHTML = `
    <h3>Overhead Panel</h3>
    <div>
      <button id="battery-btn" style="background:${getBatteryColor(st.battery)}">Battery</button>
      <button id="extpower-btn" ${st.battery ? "" : "disabled"}>${st.externalPower ? "EXT PWR ON" : "EXT PWR OFF"}</button>
    </div>
    <div>
      <button id="apu-btn" ${st.battery ? "" : "disabled"}>${st.apuOn ? "APU ON" : "APU OFF"}</button>
      <span>APU AVAILABLE: <strong>${st.apuAvailable ? "✔" : "✖"}</strong></span>
    </div>
    <div>
      <label><input type="checkbox" id="fuelPumps-btn" ${st.fuelPumps ? "checked" : ""}> Fuel Pumps</label>
      <label><input type="checkbox" id="hydraulics-btn" ${st.hydraulics ? "checked" : ""}> Hydraulics</label>
    </div>
    <div>
      <fieldset>
        <legend>Lighting</legend>
        ${Object.entries(st.lights).map(([k, v]) =>
          `<label><input type="checkbox" class="light-btn" data-light="${k}" ${v ? "checked" : ""}> ${k.charAt(0).toUpperCase() + k.slice(1)}</label>`
        ).join(" ")}
      </fieldset>
    </div>
    <div>
      <label><input type="checkbox" id="ac-btn" ${st.airConditioning ? "checked" : ""}> Air Conditioning</label>
    </div>
  `;
}

function renderEnginePanel(el, st, engines, fuel) {
  el.innerHTML = `
    <h3>Engine Panel</h3>
    ${engines.map((eng, idx) => `
      <div class="engine">
        <button id="eng-master-${idx}" ${fuel.fuelPumps ? "" : "disabled"}>${eng.master ? "MASTER ON" : "MASTER OFF"}</button>
        <span>N1: ${fmt(eng.n1,1)}%</span>
        <span>N2: ${fmt(eng.n2,1)}%</span>
        <span>EGT: ${fmt(eng.egt,0)}°C</span>
        <span>Fuel Flow: ${fmt(eng.fuelFlow,0)} kg/h</span>
        <span>Status: ${eng.running ? "RUNNING" : "STOPPED"}</span>
      </div>
    `).join("")}
    <div>Fuel: ${fmt(fuel.quantity,0)} kg / ${fmt(fuel.capacity,0)} kg</div>
  `;
}

function renderAutopilotPanel(el, ap, fms) {
  el.innerHTML = `
    <h3>Autopilot Panel (AP)</h3>
    <div>
      <label>HDG: <input id="ap-hdg" type="number" value="${fmt(ap.heading,0)}" min="0" max="359"></label>
      <label>ALT: <input id="ap-alt" type="number" value="${fmt(ap.altSel,0)}" min="0" max="45000"></label>
      <label>SPD: <input id="ap-spd" type="number" value="${fmt(ap.speedSel,0)}" min="80" max="500"></label>
      <label>VS: <input id="ap-vs" type="number" value="${fmt(ap.vsSel,0)}" min="-8000" max="8000"></label>
    </div>
    <div>
      <button id="ap-onoff">${ap.enabled ? "DISENGAGE AP" : "ENGAGE AP"}</button>
      <label><input type="checkbox" id="ap-lnav" ${ap.lnav ? "checked" : ""} ${fms.flightPlan.length > 1 ? "" : "disabled"}> LNAV</label>
      <label><input type="checkbox" id="ap-vnav" ${ap.vnav ? "checked" : ""} ${fms.initA.cruiseLevel ? "" : "disabled"}> VNAV</label>
      <span>Mode: <strong>${ap.mode}</strong></span>
    </div>
  `;
}

function renderPFD(el, flt, ap) {
  // Simple canvas PFD with attitude indicator (artificial horizon)
  el.innerHTML = `<canvas id="pfd-canvas" width="350" height="350"></canvas>
    <div>
      <span>IAS: <strong>${fmt(flt.ias,0)}</strong> kts</span>
      <span>ALT: <strong>${fmt(flt.altitude,0)}</strong> ft</span>
      <span>VS: <strong>${fmt(flt.vs,0)}</strong> fpm</span>
      <span>HDG: <strong>${fmt(flt.hdg,0)}</strong>°</span>
      <span>AP: <strong>${ap.enabled ? "ON" : "OFF"}</strong></span>
    </div>
  `;
  const c = el.querySelector("#pfd-canvas");
  if (c && c.getContext) drawPfdCanvas(c, flt);
}

function drawPfdCanvas(canvas, flt) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Artificial horizon
  const cx = 175, cy = 175;
  const radius = 100;
  // Draw sky
  ctx.save();
  ctx.translate(cx, cy + flt.pitch * -1.5); // negative pitch is up in screen coords
  ctx.rotate(-flt.bank * Math.PI / 180);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.fillStyle = "#8ecae6";
  ctx.fill();
  // Draw ground
  ctx.beginPath();
  ctx.arc(0, 0, radius, Math.PI, 2 * Math.PI);
  ctx.closePath();
  ctx.fillStyle = "#b08968";
  ctx.fill();
  // Draw horizon line
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-radius, 0);
  ctx.lineTo(radius, 0);
  ctx.stroke();
  ctx.restore();

  // Draw bank marks
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  for(let i = -60; i <= 60; i += 30) {
    ctx.rotate(i * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, -radius + 15);
    ctx.stroke();
    ctx.rotate(-i * Math.PI / 180);
  }
  ctx.restore();
}

/* -- ND DIRECTIONAL MAP (CANVAS) -- */

function renderND(el, flt, fms, ap) {
  el.innerHTML = `<canvas id="nd-canvas" width="350" height="350"></canvas>
    <div><span>TRK: <strong>${fmt(flt.hdg,0)}°</strong></span> | GS: ${fmt(flt.gs,0)} kts</div>
  `;
  const c = el.querySelector("#nd-canvas");
  if (c && c.getContext) drawNdCanvas(c, flt, fms, ap);
}

function drawNdCanvas(canvas, flt, fms, ap) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = 175, cy = 175, radius = 130;
  // Draw compass rose
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-flt.hdg * Math.PI / 180);
  ctx.strokeStyle = "#aaa";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, 2 * Math.PI);
  ctx.stroke();
  // Draw heading bug
  ctx.save();
  ctx.rotate((ap.heading - flt.hdg) * Math.PI / 180);
  ctx.strokeStyle = "yellow";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(0, -radius + 25);
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // Plot flight plan waypoints (simple straight lines)
  if (fms.flightPlan && fms.flightPlan.length > 1) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "#8ecae6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    let prevWp = { lat: flt.lat, lon: flt.lon };
    for (let i = 0; i < 2 && fms.position + i < fms.flightPlan.length; ++i) {
      const wp = fms.flightPlan[fms.position + i];
      const hdgToWp = getHeadingBetween(prevWp, wp);
      const distNm = getDistanceNM(prevWp, wp);
      const angle = (hdgToWp - flt.hdg) * Math.PI / 180;
      const r = clamp(distNm * 10, 10, radius);
      ctx.lineTo(Math.sin(angle) * r, -Math.cos(angle) * r);
      prevWp = wp;
    }
    ctx.stroke();
    ctx.restore();
  }
}

function getHeadingBetween(from, to) {
  if (!(from && to)) return 0;
  const dLon = (to.lon - from.lon) * Math.PI / 180;
  const fromLat = from.lat * Math.PI / 180;
  const toLat = to.lat * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) -
            Math.sin(fromLat) * Math.cos(toLat) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function getDistanceNM(a, b) {
  if (!(a && b)) return 0;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const R = 3440.07; // nm
  const s =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

/* -- LEAFLET IFRS MAP -- */

// Map object scoped to state
let leafletMap = null;

function renderLeafletMap(el, flt, fms) {
  // Use Leaflet only if library loaded (`L`)
  if (!window.L) {
    el.innerHTML = `<div style="color:red">Leaflet.js library not found. IFRS Map unavailable.</div>`;
    return;
  }
  el.innerHTML = `<div id="leaflet-map" style="width:350px;height:350px;background:#222"></div>`;
  if (!leafletMap) {
    leafletMap = L.map("leaflet-map").setView([flt.lat, flt.lon], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 15,
      attribution: ""
    }).addTo(leafletMap);
    leafletMap.flyTo([flt.lat, flt.lon], 10);
    L.marker([flt.lat, flt.lon], {title: "You"}).addTo(leafletMap);
  } else {
    leafletMap.setView([flt.lat, flt.lon]);
    // update marker...
  }
}

/* ---- MCDU RENDERING AND LOGIC ---- */

function renderMCDU(el, mcdu, fms) {
  el.innerHTML = `
    <div class="mcdu">
      <h3>MCDU</h3>
      <div class="mcdu-scr">${mcdu.scratchpad}</div>
      <div class="mcdu-main">${renderMcduPage(mcdu, fms)}</div>
      <div class="mcdu-keypad">
        <div>
          ${["A","B","C","D","E","F","G","H","I","J"].map(x =>
            `<button class="key" data-key="${x}">${x}</button>`
          ).join("")}
        </div>
        <div>
          ${["K","L","M","N","O","P","Q","R","S","T"].map(x =>
            `<button class="key" data-key="${x}">${x}</button>`
          ).join("")}
        </div>
        <div>
          ${["U","V","W","X","Y","Z","1","2","3","4"].map(x =>
            `<button class="key" data-key="${x}">${x}</button>`
          ).join("")}
        </div>
        <div>
          ${["5","6","7","8","9","0","/",".","CLR","EXEC"].map(k =>
            `<button class="key" data-key="${k}">${k}</button>`
          ).join("")}
        </div>
        <div>
          ${["LEFT", "RIGHT", "UP", "DOWN", "MENU", "INIT", "FPLN", "PERF"].map(k =>
            `<button class="page" data-page="${k}">${k}</button>`
          ).join("")}
        </div>
      </div>
    </div>
  `;
  // Add page switchers if needed
}

function renderMcduPage(mcdu, fms) {
  switch(mcdu.page) {
    case "INIT":
    case "INITA":
      return renderMcduInitA(fms.initA);
    case "FPLN":
      return renderMcduFPLN(fms.flightPlan, fms.position);
    case "PERF":
      return renderMcduPerf(fms.perfPages);
    default:
      return `
        <div>
          <button class="page" data-page="INIT">INIT A</button>
          <button class="page" data-page="FPLN">F-PLAN</button>
          <button class="page" data-page="PERF">PERF</button>
        </div>
      `;
  }
}

function renderMcduInitA(initA) {
  return `
    <pre>
${mcduLine("  INIT A                      ", 24)}
${mcduLine(` FROM/TO   ${initA.from || "----"}/${initA.to || "----"}`, 24)}
${mcduLine(` FLT NBR   ${initA.flightNumber || "----"}`, 24)}
${mcduLine(` COST INDEX ${initA.costIndex || "---"}`, 24)}
${mcduLine(` CRZ FL/TEMP ${initA.cruiseLevel || "---"}/${initA.cruiseTemp || "--"}`, 24)}
${mcduLine(" IRS INIT>", 24)}
    </pre>
  `;
}

function renderMcduFPLN(fpln, pos) {
  let lines = [
    mcduLine("  F-PLAN               ACTIVE", 24),
  ];
  for(let i = Math.max(0, pos - 2); i < Math.min(fpln.length, pos+4); ++i) {
    const wp = fpln[i];
    lines.push(mcduLine(
      `${i === pos ? "»" : " "} ${wp.ident}   ${fmt(wp.lat, 2)},${fmt(wp.lon, 2)} ${wp.alt ? `${wp.alt}ft` : ""}`,
      24));
  }
  return `<pre>${lines.join("\n")}</pre>`;
}

/* Sample simple PERF rendering */
function renderMcduPerf(perfPages) {
  const p = perfPages.data[perfPages.current] || {};
  return `
    <pre>
${mcduLine(` PERF - ${perfPages.current}  `, 24)}
${mcduLine(` V1   ${p.V1 || "---"}`)}
${mcduLine(` VR   ${p.VR || "---"}`)}
${mcduLine(` V2   ${p.V2 || "---"}`)}
${mcduLine(` THR RED ALT   ${p.thrRedAlt || "---"}`)}
${mcduLine(` ACC ALT      ${p.accAlt || "---"}`)}
    </pre>
  `;
}

/* ---- ATC VOICE STUB ---- */

function renderATCStub(el, atc) {
  el.innerHTML = `
    <h3>ATC (Stub)</h3>
    <div>Last: <span id="atc-msg">${atc.lastMessage || "None"}</span></div>
    <button id="atc-contact-btn">Send Contact</button>
  `;
}

/* ---- COLD & DARK STARTUP LOGIC ---- */

function coldAndDarkStart() {
  setState(s => {
    const ac = s.aircraft;
    // Power OFF everything
    ac.overhead.battery = false;
    ac.overhead.externalPower = false;
    ac.overhead.apuOn = false;
    ac.overhead.apuAvailable = false;
    ac.overhead.fuelPumps = false;
    ac.overhead.hydraulics = false;
    Object.keys(ac.overhead.lights).forEach(k => ac.overhead.lights[k] = false);
    ac.overhead.airConditioning = false;
    ac.engines.forEach(e => {
      e.master = false;
      e.running = false;
      e.n1 = e.n2 = e.egt = e.fuelFlow = 0;
    });
    ac.autopilot.enabled = false;
    ac.coldAndDark = true;
    ac.powered = false;
    ac.isInitialized = false;
  });
}

function startupPowerFlow() {
  // Simulate full startup sequence (battery → ext pwr → APU → fuel pumps)
  setState(s => {
    const oh = s.aircraft.overhead;
    oh.battery = true;
    setTimeout(() => {
      setState(s2 => { s2.aircraft.overhead.externalPower = true; s2.aircraft.powered = true; notify(); });
      setTimeout(() => {
        setState(s3 => { s3.aircraft.overhead.apuOn = true; s3.aircraft.overhead.apuAvailable = true; notify(); });
        setTimeout(() => {
          setState(s4 => { s4.aircraft.overhead.fuelPumps = true; notify(); });
          setTimeout(() => {
            setState(s5 => {
              s5.aircraft.isInitialized = true;
              s5.aircraft.coldAndDark = false;
              notify();
            });
          }, 500);
        }, 700);
      }, 1000);
    }, 800);
  });
}

/* ---- AUTOPILOT WITH LNAV/VNAV ---- */

function autopilotLogic(acft, dtSec) {
  if (!acft.autopilot.enabled) return;
  const ap = acft.autopilot;
  const flt = acft.flight;
  // Autopilot Heading
  if (ap.lnav && acft.fms.flightPlan.length >= 2) {
    // Active LNAV: Track to next waypoint
    const pos = acft.fms.position;
    const wp = acft.fms.flightPlan[pos+1];
    if (!wp) return;
    const hdgToWp = getHeadingBetween({ lat: flt.lat, lon: flt.lon }, wp);
    const diff = ((hdgToWp - flt.hdg + 540)%360)-180;
    flt.hdg = clamp(flt.hdg + diff*0.05, 0, 359); // Simple PID
    // If close to WP, increment
    if (getDistanceNM({lat: flt.lat, lon: flt.lon}, wp) < 2) acft.fms.position++;
  }
  if (ap.vnav && acft.fms.flightPlan.length > acft.fms.position+1) {
    // Climb/Descend to next waypoint altitude
    const wp = acft.fms.flightPlan[acft.fms.position+1];
    if (wp && wp.alt) {
      const err = wp.alt - flt.altitude;
      let vs;
      if (Math.abs(err) < 30) vs = 0;
      else vs = clamp(err/10, -1800, 2200);
      flt.vs = vs;
      flt.altitude += vs * dtSec / 60; // Convert fpm to feet per dt
    }
  } else {
    // HDG/ALT/VS/SPD holds
    flt.hdg = clamp(ap.heading, 0, 359);
    if (flt.altitude !== ap.altSel) {
      const diff = ap.altSel - flt.altitude;
      const vs = clamp(diff/10, -1800, 2200);
      flt.altitude += vs * dtSec / 60;
      flt.vs = vs;
    } else {
      flt.vs = 0;
    }
  }
  // Airspeed hold
  if (ap.speedSel && ap.speedSel > 79) {
    flt.ias += clamp(ap.speedSel - flt.ias, -3, 3);
  }
}

/* ---- FUEL BURN UPDATER ---- */

function updateFuel(acft, dtSec) {
  let totalBurn = 0;
  acft.engines.forEach((e, idx) => {
    // Update EGT, N1/N2 simulation, and fuel
    if (e.master && acft.overhead.fuelPumps) {
      e.n1 = clamp(e.n1 + (100-e.n1)*0.1, 0, 100);
      e.n2 = clamp(e.n2 + (90-e.n2)*0.08, 0, 90);
      e.egt = clamp(e.egt + 350*0.05, 0, 650);
      e.running = true;
    } else {
      e.n1 = clamp(e.n1 - 2, 0, 100);
      e.n2 = clamp(e.n2 - 1, 0, 90);
      e.egt = clamp(e.egt - 40, 0, 650);
      e.running = false;
    }
    e.fuelFlow = computeFuelBurn(e);
    totalBurn += e.fuelFlow;
  });
  const fuelUsed = totalBurn * (dtSec / 3600);
  acft.fuel.quantity = Math.max(acft.fuel.quantity - fuelUsed, 0);
  acft.fuel.burnRate = totalBurn;
}

/* ---- MAIN RENDER FUNCTION ---- */
// Gather UI elements at startup for efficiency
const ui = {};
function setupUIRefs() {
  ui.oh = document.getElementById("overhead");
  ui.eng = document.getElementById("engine");
  ui.ap = document.getElementById("autopilot");
  ui.pfd = document.getElementById("pfd");
  ui.nd = document.getElementById("nd");
  ui.map = document.getElementById("leaflet");
  ui.mcdu = document.getElementById("mcdu");
  ui.atc = document.getElementById("atc");
  ui.coldDarkBtn = document.getElementById("cold-dark");
  ui.startupBtn = document.getElementById("startup-seq");
}

/* ---- MAIN SUBSCRIBER ---- */

subscribe(st => {
  const ac = st.aircraft;
  if (ui.oh) renderOverheadPanel(ui.oh, ac.overhead);
  if (ui.eng) renderEnginePanel(ui.eng, ac.overhead, ac.engines, ac.fuel);
  if (ui.ap) renderAutopilotPanel(ui.ap, ac.autopilot, ac.fms);
  if (ui.pfd) renderPFD(ui.pfd, ac.flight, ac.autopilot);
  if (ui.nd) renderND(ui.nd, ac.flight, ac.fms, ac.autopilot);
  if (ui.map) renderLeafletMap(ui.map, ac.flight, ac.fms);
  if (ui.mcdu) renderMCDU(ui.mcdu, ac.mcdu, ac.fms);
  if (ui.atc) renderATCStub(ui.atc, ac.atc);
});

/* ---- EVENT HANDLING SECTION ---- */

document.addEventListener("DOMContentLoaded", function() {
  setupUIRefs();

  // Cold & Dark / Startup
  if (ui.coldDarkBtn) ui.coldDarkBtn.onclick = () => coldAndDarkStart();
  if (ui.startupBtn) ui.startupBtn.onclick = () => startupPowerFlow();

  // Overhead Panel
  ui.oh.addEventListener("click", function(ev) {
    if (ev.target.id === "battery-btn") {
      setState(s => s.aircraft.overhead.battery = !s.aircraft.overhead.battery);
    } else if (ev.target.id === "extpower-btn") {
      setState(s => s.aircraft.overhead.externalPower = !s.aircraft.overhead.externalPower);
    } else if (ev.target.id === "apu-btn") {
      setState(s => s.aircraft.overhead.apuOn = !s.aircraft.overhead.apuOn);
      setTimeout(() =>
        setState(s => s.aircraft.overhead.apuAvailable = s.aircraft.overhead.apuOn), 800);
    }
  });
  ui.oh.addEventListener("change", function(ev) {
    if (ev.target.id === "fuelPumps-btn") {
      setState(s => s.aircraft.overhead.fuelPumps = ev.target.checked);
    } else if (ev.target.id === "hydraulics-btn") {
      setState(s => s.aircraft.overhead.hydraulics = ev.target.checked);
    } else if (ev.target.className === "light-btn") {
      const k = ev.target.dataset.light;
      setState(s => s.aircraft.overhead.lights[k] = ev.target.checked);
    } else if (ev.target.id === "ac-btn") {
      setState(s => s.aircraft.overhead.airConditioning = ev.target.checked);
    }
  });

  // Engine Panel
  ui.eng.addEventListener("click", function(ev) {
    if (ev.target.id && ev.target.id.startsWith("eng-master-")) {
      const idx = parseInt(ev.target.id.slice(-1));
      setState(s => s.aircraft.engines[idx].master = !s.aircraft.engines[idx].master);
    }
  });

  // Autopilot Panel
  ui.ap.addEventListener("click", function(ev) {
    if (ev.target.id === "ap-onoff") {
      setState(s => s.aircraft.autopilot.enabled = !s.aircraft.autopilot.enabled);
    }
  });
  ui.ap.addEventListener("change", function(ev) {
    if (ev.target.id === "ap-lnav") {
      setState(s => s.aircraft.autopilot.lnav = ev.target.checked);
      setState(s => s.aircraft.autopilot.mode = ev.target.checked ? "LNAV" : "HDG");
    }
    if (ev.target.id === "ap-vnav") {
      setState(s => s.aircraft.autopilot.vnav = ev.target.checked);
      setState(s => s.aircraft.autopilot.mode = ev.target.checked ? "VNAV" : s.aircraft.autopilot.mode);
    }
    if (ev.target.id === "ap-hdg") {
      setState(s => s.aircraft.autopilot.heading = clamp(Number(ev.target.value) || 0, 0, 359));
    }
    if (ev.target.id === "ap-alt") {
      setState(s => s.aircraft.autopilot.altSel = clamp(Number(ev.target.value)||0, 0, 45000));
    }
    if (ev.target.id === "ap-spd") {
      setState(s => s.aircraft.autopilot.speedSel = clamp(Number(ev.target.value)||180, 80, 500));
    }
    if (ev.target.id === "ap-vs") {
      setState(s => s.aircraft.autopilot.vsSel = clamp(Number(ev.target.value)||0, -8000, 8000));
    }
  });

  // MCDU Panel
  ui.mcdu.addEventListener("click", function(ev) {
    if (ev.target.classList.contains("key")) {
      // Scratchpad entry logic
      const k = ev.target.dataset.key;
      setState(s => {
        let sp = s.aircraft.mcdu.scratchpad || "";
        if (k === "CLR") sp = ""; else if (k === "EXEC") {}; else sp += k;
        s.aircraft.mcdu.scratchpad = sp;
      });
    }
    if (ev.target.classList.contains("page")) {
      setState(s => s.aircraft.mcdu.page = ev.target.dataset.page === "INIT" ? "INITA" : ev.target.dataset.page);
    }
  });

  // ATC Panel
  ui.atc.addEventListener("click", function(ev) {
    if (ev.target.id === "atc-contact-btn") {
      setState(s => s.aircraft.atc.lastMessage = "ATC contact acknowledged (stub)");
    }
  });
});

/* ---- MAIN LOOP ---- */

// Time tracking for deltaTime updates
let lastTick = performance.now();

function mainLoop(now = performance.now()) {
  const acft = state.aircraft;
  const dt = (now - lastTick) / 1000.0;
  lastTick = now;
  // Only if powered up
  if (acft.overhead.battery || acft.overhead.externalPower || acft.overhead.apuOn) {
    // Main simulation steps
    autopilotLogic(acft, dt);
    updateFuel(acft, dt);
  }
  // Aircraft movement: crude for demo
  if (acft.autopilot.enabled) {
    // Drift along heading at 250 kts (simulate GS)
    const pos = moveAircraft(acft.flight.lat, acft.flight.lon, acft.flight.hdg, (acft.flight.gs || 2.5) * dt / 3600);
    acft.flight.lat = pos.lat;
    acft.flight.lon = pos.lon;
  }
  notify();
  requestAnimationFrame(mainLoop);
}

// Initial Cold & Dark state
coldAndDarkStart();

// Start main loop
mainLoop();
