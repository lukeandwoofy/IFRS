// js/app.js

import { auth } from './firebase-config.js';
import { showAuth, showHome } from './ui.js';

window.addEventListener('load', () => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js');
  }

  // Redirect based on auth state
  auth.onAuthStateChanged(user => {
    user ? showHome() : showAuth();
  });
});
