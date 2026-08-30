// Browser bootstrap: binds real browser services to the dependency-
// injected app core. Excluded surface is deliberately tiny — everything
// with logic lives in the tested modules.

import { initBoat } from './boat_ui.js';
import { initModel, refreshModel } from './model_ui.js';
import { DEFAULT_PROFILE } from './profile.js';
import { applyStoredProfile, initSetup } from './setup_ui.js';
import { initTabs } from './tabs.js';
import { initApp } from './ui.js';
import { initVoyage } from './voyage_ui.js';

const deps = {
  doc: document,
  fetchImpl: (...args) => fetch(...args),
  geolocation: navigator.geolocation,
  storage: window.localStorage,
  now: () => new Date(),
  leaflet: window.L ?? null,
  getHash: () => window.location.hash,
  setHash: (t) => { window.location.hash = t; },
  onHashChange: (fn) => window.addEventListener('hashchange', fn),
  setIntervalFn: (fn, ms) => setInterval(fn, ms),
  clearIntervalFn: (id) => clearInterval(id),
  download: (name, text) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    a.click();
  },
};

initApp(deps).then((state) => {
  applyStoredProfile(deps, state);
  initVoyage(deps, state);
  initBoat(deps);
  initModel(deps, state);
  initSetup(deps, state, DEFAULT_PROFILE);
  initTabs(deps, (tab) => {
    if (tab === 'model') refreshModel(deps, state);
  });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
