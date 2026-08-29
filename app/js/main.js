// Browser bootstrap: binds real browser services to the dependency-injected
// app core (ui.js). Excluded surface is deliberately tiny — everything with
// logic lives in the tested modules.

import { initApp } from './ui.js';

initApp({
  doc: document,
  fetchImpl: (...args) => fetch(...args),
  geolocation: navigator.geolocation,
  storage: window.localStorage,
  now: () => new Date(),
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
