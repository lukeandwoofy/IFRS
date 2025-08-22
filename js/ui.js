import { auth } from './firebase-config.js';

const screens = {
  auth: document.getElementById('auth-screen'),
  home: document.getElementById('home-screen'),
  setup: document.getElementById('setup-screen'),
  cockpit: document.getElementById('cockpit-screen'),
  runway: document.getElementById('runway-screen')
};

const flightConfig = {};

function show(key) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[key].classList.remove('hidden');
}

// 1. Authentication Screen
export function showAuth() {
  show('auth');
  screens.auth.innerHTML = `
    <h1>IFRS Login / Sign Up</h1>
    <input id="email" type="email" placeholder="Email">
    <input id="pass" type="password" placeholder="Password">
    <button id="btn-login">Login</button>
    <button id="btn-signup">Sign Up</button>
  `;
  document.getElementById('btn-login').onclick = () => {
    auth.signInWithEmailAndPassword(email.value, pass.value)
      .catch(e => alert(e.message));
  };
  document.getElementById('btn-signup').onclick = () => {
    auth.createUserWithEmailAndPassword(email.value, pass.value)
      .catch(e => alert(e.message));
  };
}

// 2. Home Screen
export function showHome() {
  show('home');
  screens.home.innerHTML = `
    <img src="assets/logo.png" alt="IFRS Logo" style="height:80px;">
    <h1>Instrument Flight Rules Sim</h1>
    <div id="plane-list"></div>
    <button id="btn-begin">Begin Flight</button>
  `;
  const planes = ['A330-300','A320neo','737 MAX 10','B-17'];
  const list = document.getElementById('plane-list');
  planes.forEach(code => {
    const btn = document.createElement('button');
    btn.textContent = code;
    btn.onclick = () => {
      flightConfig.plane = code;
      showSetup();
    };
    list.appendChild(btn);
  });
  document.getElementById('btn-begin').onclick = () => {
    if (!flightConfig.plane) return alert('Select a plane first');
    showSetup();
  };
}

// 3. Flight Setup
export async function showSetup() {
  show('setup');
  const [liveries, airports] = await Promise.all([
    fetch('assets/liveries.json').then(r => r.json()),
    fetch('assets/airports.json').then(r => r.json())
  ]);

  screens.setup.innerHTML = `
    <h2>Setup Flight (${flightConfig.plane})</h2>
    <label>Livery:</label>
    <select id="sel-livery">
      ${liveries[flightConfig.plane].map(l => `<option>${l}</option>`).join('')}
    </select><br>
    <label>Origin:</label>
    <select id="sel-origin">${airports.map(a => `<option>${a}</option>`)}</select>
    <label>Destination:</label>
    <select id="sel-dest">${airports.map(a => `<option>${a}</option>`)}</select><br>
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

// 4. Cockpit Screen
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

  setupPanelPages();
  document.getElementById('btn-takeoff').onclick = () => showRunway();
}

// Panel tabs logic
function setupPanelPages() {
  const tabs = screens.cockpit.querySelectorAll('.tab-buttons button');
  tabs.forEach(btn => {
    btn.onclick = () => {
      screens.cockpit.querySelectorAll('.panel-page')
        .forEach(p => p.classList.remove('active'));
      screens.cockpit.querySelector(`#${btn.dataset.page}`)
        .classList.add('active');
    };
  });
  tabs[0].click(); // open ENGINE by default
}

// 5. Runway / Takeoff Screen
export function showRunway() {
  show('runway');
  screens.runway.innerHTML = `
    <h2>Runway Ready</h2>
    <p>Airport: ${flightConfig.origin} ➔ ${flightConfig.dest}</p>
    <button id="btn-start">Start Takeoff Roll</button>
  `;
  document.getElementById('btn-start').onclick = () => {
    alert('Takeoff roll started! (controls on the left)');
  };
}
