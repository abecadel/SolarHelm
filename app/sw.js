// SolarHelm Planner service worker: cache-first app shell so the planner
// opens on the water without connectivity (forecast then falls back to the
// clear-sky model inside the app).
//
// EXCLUDED from the unit-coverage gate (browser lifecycle code); exercised
// by the headless-browser smoke test instead. Keep it logic-free.

const CACHE = 'solarhelm-planner-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './js/main.js',
  './js/ui.js',
  './js/planner.js',
  './js/forecast.js',
  './js/energy_model.js',
  './js/charts.js',
  './js/profile.js',
  './js/tabs.js',
  './js/map_ui.js',
  './js/boat_ui.js',
  './js/model_ui.js',
  './js/setup_ui.js',
  './js/providers.js',
  './js/route_planner.js',
  './js/vessel_model.js',
  './js/vessel_store.js',
  './js/voyage_safety.js',
  './js/voyage_ui.js',
  './js/geo_residuals.js',
  './js/provider_stats.js',
  './js/ble_link.js',
  './js/net_cache.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(
      (hit) => hit ?? fetch(event.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return resp;
      }))
  );
});
