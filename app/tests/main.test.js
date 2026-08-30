// Covers the browser bootstrap (main.js) by providing browser globals in
// node before importing it. Runs in its own process (node --test isolates
// test files), so the globals leak nowhere.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FORM_DEFAULTS, fire, makeDoc, makeStorage } from './helpers.js';

test('main.js boots the app against browser globals', async () => {
  const doc = makeDoc(FORM_DEFAULTS);
  let registered = null;
  const clicked = [];
  doc.createElement = () => {
    const a = { click: () => clicked.push(a) };
    return a;
  };
  globalThis.document = doc;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/telemetry')) {
      return { ok: true, json: async () => ({
        timestamp_ms: 1000, mode: 0, battery_voltage_v: 25.6,
        battery_current_a: 0, battery_power_w: 0, battery_soc_pct: 80,
        solar_power_w: 300, motor_command_pct: 0,
        motor_estimated_power_w: 0, speed_kmh: 0, distance_today_km: 0,
        energy_solar_today_wh: 0, energy_motor_today_wh: 0,
        energy_hotel_today_wh: 0, efficiency_wh_km: 0,
        reserve_soc_pct: 25, fault_flags: 0,
      }) };
    }
    throw new Error('offline');
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition: (ok) =>
            ok({ coords: { latitude: 43.1, longitude: 16.2 } }),
      },
      serviceWorker: {
        register: (url) => {
          registered = url;
          return Promise.reject(new Error('not a real browser'));
        },
      },
    },
  });
  const winListeners = {};
  globalThis.window = {
    localStorage: makeStorage(),
    location: { hash: '' },
    addEventListener: (ev, fn) => { winListeners[ev] = fn; },
  };

  await import('../js/main.js');
  // initApp is async; give it a tick to resolve the profile load.
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(doc.getElementById('profile-name').textContent
      .includes('built-in profile'));
  assert.equal(registered, './sw.js');

  // The bound deps are live: plan click renders an offline plan and the
  // injected now()/fetch() arrows execute.
  await fire(doc, 'plan', 'click');
  assert.ok(doc.getElementById('summary').innerHTML.includes('forecast'));
  fire(doc, 'locate', 'click');
  assert.equal(doc.getElementById('lat').value, '43.1000');

  // The tab shell is wired: clicking a tab button switches panels and
  // writes the hash; the model tab refresh hook runs.
  fire(doc, 'tabbtn-model', 'click');
  assert.equal(globalThis.window.location.hash, 'model');
  assert.equal(doc.getElementById('tab-model').hidden, false);
  assert.equal(doc.getElementById('tab-plan').hidden, true);
  assert.ok(doc.getElementById('model-summary').innerHTML
      .includes('voyages learned'));
  // Hash navigation (back button) also switches tabs.
  globalThis.window.location.hash = '#boat';
  winListeners.hashchange();
  assert.equal(doc.getElementById('tab-boat').hidden, false);

  // Boat link through the REAL bound deps: connect (live timer), record
  // one sample, export (exercises the download binding), disconnect.
  fire(doc, 'boat-connect', 'click');
  await new Promise((r) => setTimeout(r, 10));
  fire(doc, 'boat-export', 'click');
  assert.equal(clicked.length, 1);
  fire(doc, 'boat-connect', 'click'); // disconnect clears the interval
  assert.ok(doc.getElementById('boat-status').textContent
      .includes('samples kept'));
});
