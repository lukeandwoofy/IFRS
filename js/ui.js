// js/ui.js

import { auth } from './firebase-config.js';

const screens = {
  auth:    document.getElementById('auth-screen'),
  home:    document.getElementById('home-screen'),
  setup:   document.getElementById('setup-screen'),
  cockpit: document.getElementById('cockpit-screen'),
  runway:  document.getElementById('runway-screen')
};

const flightConfig = {};

function show(key) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[key].classList.remove('hidden');
}

export function showAuth() {
  show('auth');
  screens.auth.innerHTML = `
    <h1>IFRS Login / Sign Up</h1>
    <input id="email" type="email" placeholder="Email">
    <input id="pass"  type="password" placeholder="Password">
    <button id="btn-login">Login</button>
    <button id="btn-signup">Sign Up</button>
  `;
  document.getElementById('btn-login').onclick = () => {
    const email = document.getElementById('email').value;
    const pass  = document.getElementById('pass').value;
    auth.signInWithEmailAndPassword(email, pass).catch(e => alert(e.message));
  };
  document.getElementById('btn-signup').onclick = () => {
    const email = document.getElementById('email').value;
    const pass  = document.getElementById('pass').value;
    auth.createUserWithEmailAndPassword(email, pass).catch(e => alert(e.message));
  };
}

export function showHome() {
  show('home');
  screens.home.innerHTML = `
    <img src="assets/logo.png" alt="IFRS Logo" style="height:80px">
    <h1>Instrument Flight Rules Sim</h1>
    <div id="plane-list"></div>
  `;
  const planes = ['A330-300','A320neo','737 MAX 10','B-17'];
  const listEl = document.getElementById('plane-list');
  planes.forEach(code => {
    const btn = document.createElement('button');
    btn.textContent = code;
    btn.onclick = () => {
      flightConfig.plane = code;
      showSetup();
    };
    listEl.appendChild(btn);
  });
}

export async function showSetup() {
  show('setup');
  screens.setup.innerHTML = `<p>Loading setup options…</p>`;

  let liveriesData, airportsData;
  try {
    [liveriesData, airportsData] = await Promise.all([
      fetch('./assets/liveries.json').then(r => {
        if (!r.ok) throw new Error('liveries.json not found');
        return r.json();
      }),
      fetch('./assets/airports.json').then(r => {
        if (!r.ok) throw new Error('airports.json not found');
        return r.json();
      })
    ]);
  } catch (err) {
    screens.setup.innerHTML = `<p>Error: ${err.message}</p>`;
    return;
  }

  const liveryOptions = liveriesData[flightConfig.plane]
    .map(l => `<option>${l}</option>`).join('');
  const airportOptions = airportsData
    .map(a => `<option>${a}</option>`).join('');

  screens.setup.innerHTML = `
    <h2>Setup Flight (${flightConfig.plane})</h2>
    <label>Livery:</label>
    <select id="sel-livery">${liveryOptions}</select><br>
    <label>Origin:</label>
    <select id="sel-origin">${airportOptions}</select>
    <label>Destination:</label>
    <select id="sel-dest">${airportOptions}</select><br>
    <label><input type="checkbox" id="chk-gate"> Start Cold & Dark</label><br>
    <label><input type="checkbox" id="chk-atc"> Include ATC</label><br>
    <button id="btn-fly">Fly!</button>
  `;

  document.getElementById('btn-fly').onclick = () => {
    flightConfig.livery = document.getElementById('sel-livery').value;
    flightConfig.origin  = document.getElementById('sel-origin').value;
    flightConfig.dest    = document.getElementById('sel-dest').value;
    flightConfig.gate    = document.getElementById('chk-gate').checked;
    flightConfig.atc     = document.getElementById('chk-atc').checked;
    showCockpit();
  };
}

export function showCockpit() {
  show('cockpit');
  screens.cockpit.innerHTML = `
    <h2>${flightConfig.plane} – ${flightConfig.livery}</h2>
    <div id="map"></div>
    <div id="instruments"></div>
    <div id="controls">
      <div class="tab-buttons">
        <button data-page="ENGINE">ENGINE</button>
        <button data-page="APU">APU</button>
        <button data-page="FUEL">FUEL</button>
        <button data-page="AP">Autopilot</button>
        <button data-page="INFO">Aircraft Info</button>
      </div>
      <div id="pages-container">
        <div id="ENGINE" class="panel-page"></div>
        <div id="APU"     class="panel-page"></div>
        <div id="FUEL"    class="panel-page"></div>
        <div id="AP"      class="panel-page"></div>
        <div id="INFO"    class="panel-page"></div>
      </div>
      <button id="btn-takeoff">Go to TAKEOFF</button>
    </div>
  `;

  // Activate panel tabs
  const tabs = screens.cockpit.querySelectorAll('.tab-buttons button');
  tabs.forEach(btn => {
    btn.onclick = () => {
      const pid = btn.dataset.page;
      screens.cockpit.querySelectorAll('.panel-page')
        .forEach(p => p.classList.remove('active'));
      screens.cockpit.querySelector(`#${pid}`).classList.add('active');
    };
  });
  tabs[0].click();

  document.getElementById('btn-takeoff').onclick = () => {
    showRunway();
  };
}

export function showRunway() {
  show('runway');
  screens.runway.innerHTML = `
    <h2>Runway Ready</h2>
    <p>${flightConfig.origin} &rarr; ${flightConfig.dest}</p>
    <button id="btn-start">Start Takeoff Roll</button>
  `;
  document.getElementById('btn-start').onclick = () => {
    alert('Takeoff roll initiated!');
  };
}
