// js/ui.js

import { auth } from './firebase-config.js';

/*----------------------------------
  Screen Management
----------------------------------*/
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

/*----------------------------------
  Audio Helpers
----------------------------------*/
const A = {
  flap:  () => document.getElementById('snd-flaps'),
  whine: () => document.getElementById('snd-whine'),
  ding:  () => document.getElementById('snd-ding'),
  fire:  () => document.getElementById('snd-fire'),
  click: () => document.getElementById('snd-click')
};

function play(audio) {
  try {
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(()=>{});
    }
  } catch {}
}

function ensureWhineStarted() {
  const wh = A.whine();
  if (wh && wh.paused) {
    wh.volume = 0.5;
    wh.play().catch(()=>{});
  }
}

/*----------------------------------
  Speech Synthesis for ATC
----------------------------------*/
let VOICES = [], voiceATC = null, voicePilot = null;
function loadVoices() {
  VOICES = speechSynthesis.getVoices();
  voiceATC   = VOICES.find(v => /en-?GB|US/.test(v.lang) && /Female/.test(v.name)) || VOICES[0];
  voicePilot = VOICES.find(v => /en-?GB|US/.test(v.lang) && /Male/.test(v.name))   || VOICES[0];
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}
function say(voice, text) {
  try {
    const utt = new SpeechSynthesisUtterance(text);
    if (voice) utt.voice = voice;
    speechSynthesis.speak(utt);
  } catch {}
}
const sayATC   = t => say(voiceATC,   t);
const sayPilot = t => say(voicePilot, t);

/*----------------------------------
  Flight & Systems State
----------------------------------*/
const flight = {
  plane: null, livery: null, origin: null, dest: null,
  coldDark: false, atcIncluded: true,
  t: 0, durationSec: 300,
  tasKts: 0, altFt: 0, vsFpm: 0,
  hdgDeg: 0, rollDeg: 0, pitchDeg: 0,
  enginesRunning: false,
  throttle: 0, flaps: 0, gearDown: true,
  rudder: 0, trim: 0,
  ap: { speedKts: 160, altFt: 6000, vsFpm: 1200, hdgDeg: 0, ap1: false, ap2: false },
  eng:  { master1:false, master2:false, ign:false, fire1:false, fire2:false },
  apu:  { master:false, start:false, bleed:false, avail:false },
  fuel:{ pumpL:false, pumpR:false, pumpCTR:false, xfeed:false },
  lights:{ beacon:false, strobe:false, land:false, taxi:false, logo:false, wing:false, seatbelt:false },
  fuelMax:0, fuelKg:0
};
let flightStartTime=0, timerEl=null;
let windDir=0, windKts=0;

/* Airport Coordinates */
const AirportDB = {
  LPPT:{name:"Lisbon", lat:38.7813, lon:-9.1359},
  EGKK:{name:"Gatwick",lat:51.1537, lon:-0.1821},
  EGLL:{name:"Heathrow",lat:51.4706, lon:-0.4619},
  KIAD:{name:"Dulles", lat:38.9531, lon:-77.4565},
  KJFK:{name:"JFK",    lat:40.6413, lon:-73.7781},
  KLAX:{name:"LAX",    lat:33.9416, lon:-118.4085}
};

/* Utility Functions */
const clamp      = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp       = (a,b,t)=>a+(b-a)*t;
const lerpLatLon = (a,b,t)=>({lat:lerp(a.lat,b.lat,t),lon:lerp(a.lon,b.lon,t)});
const pad        = (n,w=2)=>String(n).padStart(w,'0');

/*----------------------------------
  1) AUTH Screen
----------------------------------*/
export function showAuth() {
  show('auth');
  screens.auth.innerHTML = `
    <h1>IFRS Login / Sign Up</h1>
    <input id="email" type="email" placeholder="Email">
    <input id="pass" type="password" placeholder="Password">
    <button id="btn-login">Login</button>
    <button id="btn-signup">Sign Up</button>
  `;
  document.getElementById('btn-login').onclick = ()=>
    auth.signInWithEmailAndPassword(email.value,pass.value).catch(e=>alert(e.message));
  document.getElementById('btn-signup').onclick = ()=>
    auth.createUserWithEmailAndPassword(email.value,pass.value).catch(e=>alert(e.message));
}

/*----------------------------------
  2) HOME Screen
----------------------------------*/
export function showHome() {
  show('home');
  screens.home.innerHTML = `
    <img src="assets/logo.png" alt="IFRS Logo" style="height:80px">
    <h1>Instrument Flight Rules Sim</h1>
    <button id="btn-signout">Sign Out</button>
    <div id="plane-list"></div>
    <button id="btn-begin">Begin Flight</button>
  `;
  document.getElementById('btn-signout').onclick = ()=>auth.signOut();

  const list=document.getElementById('plane-list');
  let sel=null;
  ['A330-300','A320neo','737 MAX 10','B-17'].forEach(p=>{
    const btn=document.createElement('button');
    btn.textContent=p;
    btn.onclick=()=>{
      sel=p;flight.plane=p;
      list.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');play(A.click());
    };
    list.appendChild(btn);
  });
  document.getElementById('btn-begin').onclick=()=>sel?showSetup():alert('Select a plane first');
}

/*----------------------------------
  3) SETUP Screen
----------------------------------*/
export async function showSetup(){
  show('setup');
  screens.setup.innerHTML=`<p>Loading flight options…</p>`;

  let lvr,apt;
  try{
    [lvr,apt]=await Promise.all([
      fetch('./assets/liveries.json').then(r=>r.json()),
      fetch('./assets/airports.json').then(r=>r.json())
    ]);
  }catch{
    screens.setup.innerHTML=`<p style="color:#f66">Error loading data</p>`;
    return;
  }

  screens.setup.innerHTML=`
    <h2>Setup Flight (${flight.plane})</h2>
    <label>Livery</label>
    <select id="sel-livery">${(lvr[flight.plane]||[]).map(x=>`<option>${x}</option>`).join('')}</select><br>
    <label>Origin</label>
    <select id="sel-origin">${apt.map(x=>`<option>${x}</option>`).join('')}</select><br>
    <label>Destination</label>
    <select id="sel-dest">${apt.map(x=>`<option>${x}</option>`).join('')}</select><br>
    <label><input id="chk-gate" type="checkbox"> Cold & Dark at Gate</label><br>
    <label><input id="chk-atc" type="checkbox" checked> Include ATC</label><br>
    <button id="btn-fly">Fly!</button>
  `;
  document.getElementById('btn-fly').onclick=()=>{
    flight.livery=document.getElementById('sel-livery').value;
    flight.origin=document.getElementById('sel-origin').value;
    flight.dest=document.getElementById('sel-dest').value;
    flight.coldDark=document.getElementById('chk-gate').checked;
    flight.atcIncluded=document.getElementById('chk-atc').checked;
    initFlight(); showCockpit();
  };
}

/*----------------------------------
  Initialize Flight State
----------------------------------*/
function initFlight(){
  const o=AirportDB[flight.origin], d=AirportDB[flight.dest];
  if(o&&d){
    const dx=d.lon-o.lon, dy=d.lat-o.lat;
    flight.hdgDeg=(Math.atan2(dx,dy)*180/Math.PI+360)%360;
    flight.ap.hdgDeg=flight.hdgDeg;
  }
  // Fuel capacity
  const caps={'A330-300':139000,'A320neo':27000,'737 MAX 10':26000,'B-17':8000};
  flight.fuelMax=caps[flight.plane]||20000;
  flight.fuelKg=flight.fuelMax;
  // Wind
  windKts=Math.round(Math.random()*40);
  windDir=Math.floor(Math.random()*360);
  // Reset physics & controls
  Object.assign(flight,{
    t:0,durationSec:300,
    tasKts:0,altFt:flight.coldDark?0:1500,vsFpm:0,
    rollDeg:0,pitchDeg:0,
    throttle:0,flaps:0,gearDown:!flight.coldDark,
    rudder:0,trim:0,
    enginesRunning:!flight.coldDark
  });
  if(flight.coldDark){
    Object.assign(flight.eng,{master1:false,master2:false,ign:false,fire1:false,fire2:false});
    Object.assign(flight.apu,{master:false,start:false,bleed:false,avail:false});
    Object.assign(flight.fuel,{pumpL:false,pumpR:false,pumpCTR:false,xfeed:false});
    Object.assign(flight.lights,{beacon:false,strobe:false,land:false,taxi:false,logo:false,wing:false,seatbelt:false});
    Object.assign(flight.ap,{speedKts:160,altFt:6000,vsFpm:1200,hdgDeg:flight.hdgDeg,ap1:false,ap2:false});
  }
}

/*----------------------------------
  4) COCKPIT Screen & Tabs
----------------------------------*/
let map, routeLine, planeMarker, attCanvas, attCtx, speedEl, altEl, vsEl, lastTime=0, rafId=0;
let atcController;

export function showCockpit(){
  show('cockpit');
  screens.cockpit.innerHTML=`
    <div id="cockpit-title">
      <h2>${flight.plane} – ${flight.livery||''} (${flight.origin}→${flight.dest})</h2>
      <span id="flight-timer" class="badge">00:00:00</span>
      <button id="btn-audio">Enable Audio</button>
      <button id="btn-night">Night Mode</button>
    </div>
    <div id="left-pane">
      <div class="tabs" id="tabs">
        <button class="tab active" data-panel="ENGINE">ENGINE</button>
        <button class="tab" data-panel="APU">APU</button>
        <button class="tab" data-panel="FUEL">FUEL</button>
        <button class="tab" data-panel="LIGHTS">LIGHTS</button>
        <button class="tab" data-panel="AP">Autopilot</button>
        <button class="tab" data-panel="ATC">ATC</button>
        <button class="tab" data-panel="CONTROLS">Controls</button>
        <button class="tab" data-panel="FLIGHTINFO">Flight Info</button>
        <button class="tab" data-panel="AIRCRAFTINFO">Aircraft Info</button>
      </div>
      <div class="panel active" id="ENGINE"></div>
      <div class="panel" id="APU"></div>
      <div class="panel" id="FUEL"></div>
      <div class="panel" id="LIGHTS"></div>
      <div class="panel" id="AP"></div>
      <div class="panel" id="ATC"></div>
      <div class="panel" id="CONTROLS"></div>
      <div class="panel" id="FLIGHTINFO"></div>
      <div class="panel" id="AIRCRAFTINFO"></div>
    </div>
    <div id="center-pane">
      <div id="map"></div>
      <p>Wind: <span id="wind-text">${windKts} kts @ ${windDir}°</span></p>
      <div id="instruments">
        <canvas id="attitude"></canvas>
        <div class="tape"><div class="tape-title">IAS</div><div id="speed" class="num">000</div></div>
        <div class="tape"><div class="tape-title">ALT</div><div id="alt" class="num">00000</div></div>
        <div class="tape"><div class="tape-title">VS</div><div id="vs" class="num">0000</div></div>
      </div>
    </div>
    <div id="right-pane"></div>
  `;
  document.getElementById('btn-audio').onclick = ()=>{ ensureWhineStarted(); play(A.click()); };
  document.getElementById('btn-night').onclick=()=>{ document.body.classList.toggle('night'); play(A.click()); };

  flightStartTime = performance.now();
  timerEl = document.getElementById('flight-timer');

  setupTabs();
  renderEnginePanel();
  renderAPUPanel();
  renderFuelPanel();
  renderLightsPanel();
  renderAutopilotPanel();
  renderATCPanel();
  renderControlsPanel();
  renderFlightInfoPanel();
  renderAircraftInfoPanel();

  setupMap();
  setupInstruments();

  lastTime = performance.now();
  rafId && cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function setupTabs(){
  document.getElementById('tabs').querySelectorAll('.tab').forEach(btn=>{
    btn.onclick=()=>{
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.panel).classList.add('active');
      play(A.click()); ensureWhineStarted();
    };
  });
}

/*----------------------------------
  ENGINE Panel
----------------------------------*/
function renderEnginePanel(){
  const el=document.getElementById('ENGINE');
  el.innerHTML=`
    <div class="ann caut">ENGINE PANEL</div><br>
    <div class="switch"><span class="label">IGN/START</span><button id="btn-ign">${flight.eng.ign?'ON':'OFF'}</button><span id="led-ign" class="led ${flight.eng.ign?'on':''}"></span></div>
    <div class="switch"><span class="label">ENG1 MASTER</span><button id="btn-eng1">${flight.eng.master1?'ON':'OFF'}</button><span id="led-eng1" class="led ${flight.eng.master1?'on':''}"></span></div>
    <div class="switch"><span class="label">ENG2 MASTER</span><button id="btn-eng2">${flight.eng.master2?'ON':'OFF'}</button><span id="led-eng2" class="led ${flight.eng.master2?'on':''}"></span></div>
    <div class="switch"><span class="label">FIRE TEST 1</span><button id="btn-fire1">TEST</button><span id="led-fire1" class="led ${flight.eng.fire1?'on':''}"></span></div>
    <div class="switch"><span class="label">FIRE TEST 2</span><button id="btn-fire2">TEST</button><span id="led-fire2" class="led ${flight.eng.fire2?'on':''}"></span></div>
    <p style="opacity:.7;margin-top:.5rem;">Startup sequence: APU→BLEED→Fuel Pumps→IGN→Engine Masters</p>
  `;
  const toggle=(obj,k,led,btn)=>{
    obj[k]=!obj[k];
    document.getElementById(led).classList.toggle('on',obj[k]);
    document.getElementById(btn).textContent=obj[k]?'ON':'OFF';
    play(A.click());
    checkEngineSpool();
  };
  document.getElementById('btn-ign').onclick=()=>toggle(flight.eng,'ign','led-ign','btn-ign');
  document.getElementById('btn-eng1').onclick=()=>toggle(flight.eng,'master1','led-eng1','btn-eng1');
  document.getElementById('btn-eng2').onclick=()=>toggle(flight.eng,'master2','led-eng2','btn-eng2');
  document.getElementById('btn-fire1').onclick=()=>{
    flight.eng.fire1=!flight.eng.fire1;
    document.getElementById('led-fire1').classList.toggle('on',flight.eng.fire1);
    play(A.fire()); setTimeout(()=>{
      flight.eng.fire1=false; document.getElementById('led-fire1').classList.remove('on');
    },1500);
  };
  document.getElementById('btn-fire2').onclick=()=>{
    flight.eng.fire2=!flight.eng.fire2;
    document.getElementById('led-fire2').classList.toggle('on',flight.eng.fire2);
    play(A.fire()); setTimeout(()=>{
      flight.eng.fire2=false; document.getElementById('led-fire2').classList.remove('on');
    },1500);
  };
}

/*----------------------------------
  APU Panel
----------------------------------*/
function renderAPUPanel(){
  const el=document.getElementById('APU');
  el.innerHTML=`
    <div class="ann info">APU PANEL</div><br>
    <div class="switch"><span class="label">APU MASTER</span><button id="btn-apu-master">${flight.apu.master?'ON':'OFF'}</button><span id="led-apu-master" class="led ${flight.apu.master?'on':''}"></span></div>
    <div class="switch"><span class="label">APU START</span><button id="btn-apu-start">START</button><span id="led-apu-start" class="led ${flight.apu.avail?'on':''}"></span></div>
    <div class="switch"><span class="label">APU BLEED</span><button id="btn-apu-bleed">${flight.apu.bleed?'ON':'OFF'}</button><span id="led-apu-bleed" class="led ${flight.apu.bleed?'on':''}"></span></div>
  `;
  document.getElementById('btn-apu-master').onclick=()=>{
    flight.apu.master=!flight.apu.master;
    document.getElementById('led-apu-master').classList.toggle('on',flight.apu.master);
    document.getElementById('btn-apu-master').textContent=flight.apu.master?'ON':'OFF';
    play(A.click());
  };
  document.getElementById('btn-apu-start').onclick=()=>{
    if(!flight.apu.master)return;
    setTimeout(()=>{
      flight.apu.avail=true;
      document.getElementById('led-apu-start').classList.add('on');
      play(A.click());
      checkEngineSpool();
    },800);
  };
  document.getElementById('btn-apu-bleed').onclick=()=>{
    flight.apu.bleed=!flight.apu.bleed;
    document.getElementById('led-apu-bleed').classList.toggle('on',flight.apu.bleed);
    document.getElementById('btn-apu-bleed').textContent=flight.apu.bleed?'ON':'OFF';
    play(A.click());
    checkEngineSpool();
  };
}

/*----------------------------------
  FUEL Panel
----------------------------------*/
function renderFuelPanel(){
  const el=document.getElementById('FUEL');
  el.innerHTML=`
    <div class="ann info">FUEL PANEL</div><br>
    <div class="switch"><span class="label">PUMP L</span><button id="btn-puml">${flight.fuel.pumpL?'ON':'OFF'}</button><span id="led-puml" class="led ${flight.fuel.pumpL?'on':''}"></span></div>
    <div class="switch"><span class="label">PUMP CTR</span><button id="btn-pumc">${flight.fuel.pumpCTR?'ON':'OFF'}</button><span id="led-pumc" class="led ${flight.fuel.pumpCTR?'on':''}"></span></div>
    <div class="switch"><span class="label">PUMP R</span><button id="btn-pumr">${flight.fuel.pumpR?'ON':'OFF'}</button><span id="led-pumr" class="led ${flight.fuel.pumpR?'on':''}"></span></div>
    <div class="switch"><span class="label">X-FEED</span><button id="btn-xfeed">${flight.fuel.xfeed?'OPEN':'CLOSE'}</button><span id="led-xfeed" class="led ${flight.fuel.xfeed?'on':''}"></span></div>
  `;
  const T=(k,led,btn,on='ON',off='OFF')=>{
    flight.fuel[k]=!flight.fuel[k];
    document.getElementById(led).classList.toggle('on',flight.fuel[k]);
    document.getElementById(btn).textContent=flight.fuel[k]?on:off;
    play(A.click());
    checkEngineSpool();
  };
  document.getElementById('btn-puml').onclick=()=>T('pumpL','led-puml','btn-puml');
  document.getElementById('btn-pumc').onclick=()=>T('pumpCTR','led-pumc','btn-pumc');
  document.getElementById('btn-pumr').onclick=()=>T('pumpR','led-pumr','btn-pumr');
  document.getElementById('btn-xfeed').onclick=()=>T('xfeed','led-xfeed','btn-xfeed','OPEN','CLOSE');
}

/*----------------------------------
  LIGHTS Panel
----------------------------------*/
function renderLightsPanel(){
  const el=document.getElementById('LIGHTS');
  el.innerHTML=`
    <div class="ann info">LIGHTS</div><br>
    ${['beacon','strobe','land','taxi','logo','wing','seatbelt'].map(n=>`
      <div class="switch"><span class="label">${n.toUpperCase()}</span>
        <button id="btn-${n}">${flight.lights[n]?'ON':'OFF'}</button>
        <span id="led-${n}" class="led ${flight.lights[n]?'on':''}"></span>
      </div>`).join('')}
  `;
  ['beacon','strobe','land','taxi','logo','wing','seatbelt'].forEach(n=>{
    document.getElementById(`btn-${n}`).onclick=()=>{
      flight.lights[n]=!flight.lights[n];
      document.getElementById(`led-${n}`).classList.toggle('on',flight.lights[n]);
      document.getElementById(`btn-${n}`).textContent=flight.lights[n]?'ON':'OFF';
      play(n==='seatbelt'?A.ding():A.click());
    };
  });
}
/*----------------------------------
  5) AUTOPILOT Panel
----------------------------------*/
function renderAutopilotPanel() {
  const el = document.getElementById('AP');
  const blocked = !flight.enginesRunning;
  el.innerHTML = `
    <div class="ann info">FCU ${blocked ? '— AP UNAVAILABLE' : ''}</div><br>
    <div class="switch"><span class="label">SPD</span><button id="spd-dec">-</button><span id="spd" class="num">${flight.ap.speedKts}</span><button id="spd-inc">+</button></div>
    <div class="switch"><span class="label">ALT</span><button id="alt-dec">-</button><span id="altset" class="num">${flight.ap.altFt}</span><button id="alt-inc">+</button></div>
    <div class="switch"><span class="label">VS</span><button id="vs-dec">-</button><span id="vsset" class="num">${flight.ap.vsFpm}</span><button id="vs-inc">+</button></div>
    <div class="switch"><span class="label">HDG</span><button id="hdg-dec">-</button><span id="hdgset" class="num">${pad(Math.round(flight.ap.hdgDeg),3)}</span><button id="hdg-inc">+</button></div>
    <div class="switch"><span class="label">AP1</span><button id="ap1" ${blocked?'disabled':''}>${flight.ap.ap1?'ON':'OFF'}</button><span id="led-ap1" class="led ${flight.ap.ap1?'on':''}"></span></div>
    <div class="switch"><span class="label">AP2</span><button id="ap2" ${blocked?'disabled':''}>${flight.ap.ap2?'ON':'OFF'}</button><span id="led-ap2" class="led ${flight.ap.ap2?'on':''}"></span></div>
  `;
  function upd() {
    document.getElementById('spd').textContent   = flight.ap.speedKts;
    document.getElementById('altset').textContent= flight.ap.altFt;
    document.getElementById('vsset').textContent = flight.ap.vsFpm;
    document.getElementById('hdgset').textContent= pad(Math.round(flight.ap.hdgDeg),3);
  }
  document.getElementById('spd-dec').onclick = () => { flight.ap.speedKts = clamp(flight.ap.speedKts - 5, 120, 330); play(A.click()); upd(); };
  document.getElementById('spd-inc').onclick = () => { flight.ap.speedKts = clamp(flight.ap.speedKts + 5, 120, 330); play(A.click()); upd(); };
  document.getElementById('alt-dec').onclick = () => { flight.ap.altFt = clamp(flight.ap.altFt - 500, 0, 39000); play(A.click()); upd(); };
  document.getElementById('alt-inc').onclick = () => { flight.ap.altFt = clamp(flight.ap.altFt + 500, 0, 39000); play(A.click()); upd(); };
  document.getElementById('vs-dec').onclick  = () => { flight.ap.vsFpm = clamp(flight.ap.vsFpm - 100, -3000, 3000); play(A.click()); upd(); };
  document.getElementById('vs-inc').onclick  = () => { flight.ap.vsFpm = clamp(flight.ap.vsFpm + 100, -3000, 3000); play(A.click()); upd(); };
  document.getElementById('hdg-dec').onclick = () => { flight.ap.hdgDeg = (flight.ap.hdgDeg - 5 + 360) % 360; play(A.click()); upd(); };
  document.getElementById('hdg-inc').onclick = () => { flight.ap.hdgDeg = (flight.ap.hdgDeg + 5) % 360; play(A.click()); upd(); };
  if (!blocked) {
    document.getElementById('ap1').onclick = () => {
      flight.ap.ap1 = !flight.ap.ap1;
      document.getElementById('led-ap1').classList.toggle('on', flight.ap.ap1);
      play(A.click());
    };
    document.getElementById('ap2').onclick = () => {
      flight.ap.ap2 = !flight.ap.ap2;
      document.getElementById('led-ap2').classList.toggle('on', flight.ap.ap2);
      play(A.click());
    };
  }
}

/*----------------------------------
  6) ATC Panel & Logic
----------------------------------*/
function renderATCPanel() {
  const el = document.getElementById('ATC');
  el.innerHTML = `
    <div class="ann info">ATC</div><br>
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
  atcController = makeATC();
  document.getElementById('atc-connect').onclick    = () => atcController.connect();
  document.getElementById('atc-request').onclick    = () => atcController.request();
  document.getElementById('atc-readback').onclick   = () => atcController.readback();
  document.getElementById('atc-next').onclick       = () => atcController.next();
  document.getElementById('atc-disconnect').onclick = () => atcController.disconnect();
}

function logATC(type, text) {
  const box = document.getElementById('atc-log');
  const div = document.createElement('div');
  div.className = type === 'rx' ? 'rx' : 'tx';
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function makeATC() {
  let connected = false, i = 0;
  const callsign = `${flight.plane.replace(/\s+/g, '')}${Math.floor(100 + Math.random()*900)}`;
  const legs = [
    { id:'CLR',  tx:`${callsign}, request IFR clearance ${flight.origin} to ${flight.dest}`, rx:`${callsign}, cleared to ${flight.dest} as filed, climb maintain 6000, departure 124.5, squawk 4301.` },
    { id:'GND',  tx:`${callsign}, ready to taxi`, rx:`${callsign}, taxi to runway 27 via A, hold short runway 27.` },
    { id:'TWR',  tx:`${callsign}, ready for departure runway 27`, rx:`${callsign}, wind calm, cleared for takeoff runway 27.` },
    { id:'DEP',  tx:`${callsign}, passing 2000 for 6000`, rx:`${callsign}, radar contact, proceed direct, climb maintain 6000, fly heading ${Math.round(flight.ap.hdgDeg)}.` },
    { id:'APP',  tx:`${callsign}, inbound for landing`, rx:`${callsign}, descend maintain 3000, vectors ILS, contact tower 118.7 on final.` },
    { id:'TWR2', tx:`${callsign}, established ILS runway 27`, rx:`${callsign}, cleared to land runway 27.` }
  ];

  return {
    connect() {
      if (connected) return;
      connected = true;
      logATC('rx', 'ATC connected.');
      sayATC('ATC connected');
    },
    request() {
      if (!connected) return;
      logATC('tx', legs[i].tx);
      sayPilot(legs[i].tx);
    },
    readback() {
      if (!connected) return;
      const rb = legs[i].rx.replace('radar contact, ', '');
      logATC('tx', `${callsign} readback ${rb}`);
      sayPilot(`${callsign} readback ${rb}`);
    },
    next() {
      if (!connected) return;
      logATC('rx', legs[i].rx);
      sayATC(legs[i].rx);
      i = Math.min(i + 1, legs.length - 1);
    },
    disconnect() {
      if (!connected) return;
      connected = false;
      logATC('rx', 'ATC disconnected.');
      sayATC('ATC disconnected');
    }
  };
}

/*----------------------------------
  7) Manual Controls Panel
----------------------------------*/
function renderControlsPanel() {
  const el = document.getElementById('CONTROLS');
  const blocked = !flight.enginesRunning;
  el.innerHTML = `
    <div class="ann info">MANUAL CONTROLS ${blocked ? '— ENG OFF' : ''}</div><br>
    <div id="controls-grid">
      <div class="ctrl-row">
        <label style="min-width:80px">Throttle</label>
        <input id="thr" type="range" min="0" max="100" value="${Math.round(flight.throttle*100)}" ${blocked?'disabled':''}>
        <span class="badge" id="thr-val">${Math.round(flight.throttle*100)}%</span>
      </div>
      <div class="ctrl-row">
        <label style="min-width:80px">Flaps</label>
        <button id="flaps-dec" ${blocked?'disabled':''}>-</button>
        <span class="badge" id="flaps-val">${flight.flaps}</span>
        <button id="flaps-inc" ${blocked?'disabled':''}>+</button>
      </div>
      <div class="ctrl-row">
        <label style="min-width:80px">Gear</label>
        <button id="gear" ${blocked?'disabled':''}>${flight.gearDown?'GEAR DOWN':'GEAR UP'}</button>
      </div>
      <div class="ctrl-row">
        <label style="min-width:80px">Rudder</label>
        <button id="rud-l" ${blocked?'disabled':''}>◀</button>
        <span class="badge" id="rud-val">${flight.rudder.toFixed(1)}</span>
        <button id="rud-r" ${blocked?'disabled':''}>▶</button>
      </div>
      <div class="ctrl-row">
        <label style="min-width:80px">Trim</label>
        <button id="trim-dn" ${blocked?'disabled':''}>Trim ↓</button>
        <span class="badge" id="trim-val">${flight.trim.toFixed(2)}</span>
        <button id="trim-up" ${blocked?'disabled':''}>Trim ↑</button>
      </div>
    </div>
  `;

  const thr = document.getElementById('thr'), thrVal = document.getElementById('thr-val');
  thr.oninput = () => {
    flight.throttle = clamp(thr.value/100, 0, 1);
    thrVal.textContent = `${Math.round(flight.throttle*100)}%`;
    ensureWhineStarted();
  };

  document.getElementById('flaps-dec').onclick = () => {
    flight.flaps = clamp(flight.flaps - 1, 0, 3);
    document.getElementById('flaps-val').textContent = flight.flaps;
    play(A.flap());
  };
  document.getElementById('flaps-inc').onclick = () => {
    flight.flaps = clamp(flight.flaps + 1, 0, 3);
    document.getElementById('flaps-val').textContent = flight.flaps;
    play(A.flap());
  };

  const gearBtn = document.getElementById('gear');
  gearBtn.onclick = () => {
    flight.gearDown = !flight.gearDown;
    gearBtn.textContent = flight.gearDown ? 'GEAR DOWN' : 'GEAR UP';
    play(A.click());
  };

  document.getElementById('rud-l').onclick = () => {
    flight.rudder = clamp(flight.rudder - 0.2, -1, 1);
    document.getElementById('rud-val').textContent = flight.rudder.toFixed(1);
    play(A.click());
  };
  document.getElementById('rud-r').onclick = () => {
    flight.rudder = clamp(flight.rudder + 0.2, -1, 1);
    document.getElementById('rud-val').textContent = flight.rudder.toFixed(1);
    play(A.click());
  };

  document.getElementById('trim-up').onclick = () => {
    flight.trim = clamp(flight.trim + 0.1, -1, 1);
    document.getElementById('trim-val').textContent = flight.trim.toFixed(2);
    play(A.click());
  };
  document.getElementById('trim-dn').onclick = () => {
    flight.trim = clamp(flight.trim - 0.1, -1, 1);
    document.getElementById('trim-val').textContent = flight.trim.toFixed(2);
    play(A.click());
  };
}

/*----------------------------------
  8) Flight Info Panel
----------------------------------*/
function renderFlightInfoPanel() {
  const el = document.getElementById('FLIGHTINFO');
  const o = AirportDB[flight.origin], d = AirportDB[flight.dest];
  el.innerHTML = `
    <div class="card"><div class="body">
      <h3>Route</h3>
      <p><strong>From:</strong> ${flight.origin} – ${o?.name||''}</p>
      <p><strong>To:</strong>   ${flight.dest} – ${d?.name||''}</p>
      <p><strong>Duration:</strong> ~${Math.round(flight.durationSec/60)} min</p>
    </div></div>
  `;
}

/*----------------------------------
  9) Aircraft Info Panel
----------------------------------*/
function renderAircraftInfoPanel() {
  const el = document.getElementById('AIRCRAFTINFO');
  const img = `assets/aircraft/${flight.plane}.jpg`;
  el.innerHTML = `
    <div class="card">
      <img src="${img}" alt="${flight.plane}" onerror="this.style.display='none'">
      <div class="body">
        <h3>${flight.plane}</h3>
        <p>Typical cruise: Mach 0.78–0.82 • Ceiling: ~39,000 ft</p>
        <p>Livery: ${flight.livery||'—'}</p>
      </div>
    </div>
  `;
}

/*----------------------------------
  10) Map Setup
----------------------------------*/
function setupMap() {
  const o = AirportDB[flight.origin], d = AirportDB[flight.dest];
  map = L.map('map', { zoomControl:true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:18, attribution:'&copy; OpenStreetMap'
  }).addTo(map);

  routeLine = L.polyline([[o.lat,o.lon],[d.lat,d.lon]], { color:'#3ec1ff', weight:3 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding:[20,20] });

  const svgIcon = `
    <div class="plane-icon" id="plane-icon">
      <svg viewBox="0 0 64 64" fill="#fff">
        <path d="M32 2l6 22h18l-6 6h-14l6 20-6 4-8-24-8 24-6-4 6-20h-14l-6-6h18l6-22z"/>
      </svg>
    </div>`;
  const icon = L.divIcon({ html:svgIcon, iconSize:[32,32], iconAnchor:[16,16] });
  planeMarker = L.marker([o.lat,o.lon], { icon }).addTo(map);
}

/*----------------------------------
  11) Instruments Setup
----------------------------------*/
function setupInstruments() {
  attCanvas = document.getElementById('attitude');
  attCtx = attCanvas.getContext('2d');
  speedEl = document.getElementById('speed');
  altEl   = document.getElementById('alt');
  vsEl    = document.getElementById('vs');

  const resize = () => {
    const r = attCanvas.getBoundingClientRect();
    attCanvas.width = r.width;
    attCanvas.height = Math.max(r.height, 220);
  };
  window.addEventListener('resize', resize);
  resize();
}

/*----------------------------------
  12) Main Flight Loop
----------------------------------*/
function loop(now) {
  const dt = (now - lastTime)/1000;
  lastTime = now;

  // Update timer
  if (timerEl) {
    const elapsed = now - flightStartTime;
    const h = Math.floor(elapsed/3600000);
    const m = Math.floor((elapsed%3600000)/60000);
    const s = Math.floor((elapsed%60000)/1000);
    timerEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  // Determine if autopilot is on
  const apOn = flight.ap.ap1 || flight.ap.ap2;

  // Speed control
  let spdTarget = apOn ? flight.ap.speedKts : flight.throttle * 300;
  flight.tasKts += (spdTarget - flight.tasKts) * 0.02;

  // Drag from flaps & gear
  const drag = 1 + flight.flaps * 0.2 + (flight.gearDown ? 0.3 : 0);
  flight.tasKts *= (1 - drag * 0.001);

  // Vertical speed
  flight.vsFpm = apOn ? flight.ap.vsFpm : flight.trim * 500;
  flight.altFt += flight.vsFpm * dt;
  flight.altFt = Math.max(0, flight.altFt);

  // Heading control
  let hdgTarget = apOn ? flight.ap.hdgDeg : flight.hdgDeg + flight.rudder * 10;
  let err = ((hdgTarget - flight.hdgDeg + 540) % 360) - 180;
  flight.hdgDeg = (flight.hdgDeg + err * dt * 2 + 360) % 360;

  // Attitude
  flight.rollDeg  = clamp(err * 0.5, -30, 30);
  flight.pitchDeg = clamp(flight.vsFpm / 1000 * 3, -10, 10);

  // Progress along route
  flight.t = clamp(flight.t + dt / flight.durationSec, 0, 1);

  // Position interpolation + wind drift
  const o = AirportDB[flight.origin], d = AirportDB[flight.dest];
  let pos = lerpLatLon(o, d, flight.t);
  const drift = dt * (windKts / 3600) * 0.5;
  const rad = windDir * Math.PI / 180;
  pos.lat += drift * Math.cos(rad);
  pos.lon += drift * Math.sin(rad);

  // Update marker and rotation
  if (planeMarker) {
    planeMarker.setLatLng([pos.lat, pos.lon]);
    const iconEl = document.getElementById('plane-icon');
    if (iconEl) iconEl.style.transform = `rotate(${flight.hdgDeg}deg)`;
  }

  // Update instruments
  if (speedEl) speedEl.textContent = pad(Math.round(flight.tasKts), 3);
  if (altEl)   altEl.textContent   = pad(Math.round(flight.altFt), 5);
  if (vsEl)    vsEl.textContent    = pad(Math.round(flight.vsFpm), 4);
  drawAttitude(attCtx, attCanvas.width, attCanvas.height, flight.pitchDeg, flight.rollDeg);

  // Fuel consumption (~2 kg/sec at full throttle)
  flight.fuelKg = Math.max(0, flight.fuelKg - flight.throttle * 2 * dt);
  const pct = (flight.fuelKg / flight.fuelMax) * 100;
  const fuelBar = document.getElementById('fuel-bar');
  const fuelLvl = document.getElementById('fuel-level');
  const fuelTxt = document.getElementById('fuel-text');
  if (fuelLvl) {
    fuelLvl.style.width = `${pct}%`;
    fuelLvl.style.background = pct < 20 ? '#f66' : '#2aff5a';
  }
  if (fuelTxt) fuelTxt.textContent = `${Math.round(flight.fuelKg)}kg`;

  // Wind display
  const wtxt = document.getElementById('wind-text');
  if (wtxt) wtxt.textContent = `${windKts} kts @ ${windDir}°`;

  if (flight.t < 1) {
    rafId = requestAnimationFrame(loop);
  } else {
    // Flight complete—could switch to runway screen here
  }
}

/*----------------------------------
  13) Attitude Indicator Drawing
----------------------------------*/
function drawAttitude(ctx, w, h, pitch, roll) {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w/2, h/2);
  ctx.rotate(-roll * Math.PI/180);

  // Sky/Ground
  const yOff = pitch * 4;
  ctx.fillStyle = '#2d76c2';
  ctx.fillRect(-w, -h*2 + yOff, w*2, h*2);
  ctx.fillStyle = '#c27a2d';
  ctx.fillRect(-w, yOff, w*2, h*2);

  // Horizon line
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w, yOff);
  ctx.lineTo(w, yOff);
  ctx.stroke();

  // Pitch ladder
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.font = '12px "B612 Mono"';
  for (let p=-20; p<=20; p+=5) {
    if (p === 0) continue;
    const y = yOff - p * 4;
    ctx.beginPath();
    ctx.moveTo(-40, y);
    ctx.lineTo(-10, y);
    ctx.moveTo(40, y);
    ctx.lineTo(10, y);
    ctx.stroke();
    ctx.fillText(`${p}`, -50, y+4);
    ctx.fillText(`${p}`, 50, y+4);
  }

  ctx.restore();

  // Flight director bars if AP on
  if (flight.ap.ap1 || flight.ap.ap2) {
    ctx.strokeStyle = '#ff5a5a';
    ctx.lineWidth = 3;
    const fdX = -roll * 1.5 + w/2;
    const fdY = -pitch * 4 + h/2;
    ctx.beginPath();
    ctx.moveTo(fdX - 30, fdY);
    ctx.lineTo(fdX + 30, fdY);
    ctx.moveTo(fdX, fdY - 30);
    ctx.lineTo(fdX, fdY + 30);
    ctx.stroke();
  }

  // Airplane symbol
  ctx.strokeStyle = '#ffef5a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w/2 - 40, h/2);
  ctx.lineTo(w/2 + 40, h/2);
  ctx.moveTo(w/2, h/2);
  ctx.lineTo(w/2, h/2 + 12);
  ctx.stroke();
}

/*----------------------------------
  14) Cold & Dark Enforcement
----------------------------------*/
function checkEngineSpool() {
  const fuelOn = flight.fuel.pumpL || flight.fuel.pumpR || flight.fuel.pumpCTR;
  const apuReady = flight.apu.master && flight.apu.avail && flight.apu.bleed;
  const ignOn = flight.eng.ign;
  const masterOn = flight.eng.master1 || flight.eng.master2;
  if (fuelOn && apuReady && ignOn && masterOn) {
    flight.enginesRunning = true;
    ensureWhineStarted();
  }
}

/*----------------------------------
  15) Expose showRunway (optional)
----------------------------------*/
export function showRunway() {
  show('runway');
  screens.runway.innerHTML = `<h2>Runway Ready</h2>`;
}
