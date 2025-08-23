// js/app.js
import { auth } from './firebase-config.js';
import { showAuth, showHome } from './ui.js';

window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js');
  }
  auth.onAuthStateChanged(user => user ? showHome() : showAuth());
});
