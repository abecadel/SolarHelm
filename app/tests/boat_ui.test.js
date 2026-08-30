import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CSV_HEADER,
  DEFAULT_BOAT_URL,
  decodeFaults,
  initBoat,
  pollOnce,
  sendRemote,
  toCsv,
} from '../js/boat_ui.js';
import { parseTelemetryRows } from '../js/vessel_store.js';
import { fire, makeDoc } from './helpers.js';

const SAMPLE = {
  timestamp_ms: 123456, mode: 1, battery_voltage_v: 25.61,
  battery_current_a: -3.2, battery_power_w: -81.9, battery_soc_pct: 76.5,
  solar_power_w: 412, motor_command_pct: 43.5,
  motor_estimated_power_w: 495, speed_kmh: 5.42, distance_today_km: 12.3,
  energy_solar_today_wh: 1500, energy_motor_today_wh: 1300,
  energy_hotel_today_wh: 240, efficiency_wh_km: 91.3,
  reserve_soc_pct: 25, fault_flags: 0,
};

test('decodeFaults names the raised bits', () => {
  assert.deepEqual(decodeFaults(0), []);
  assert.deepEqual(decodeFaults(1 << 0 | 1 << 6 | 1 << 12),
                   ['battery-stale', 'sag-soft', 'remote-stale']);
});

test('toCsv emits the firmware CSV format the learner reads', () => {
  const csv = toCsv([SAMPLE, { ...SAMPLE, timestamp_ms: 124456 }]);
  assert.ok(csv.startsWith(CSV_HEADER));
  assert.equal(csv.split('\n').length, 3);
  const rows = parseTelemetryRows(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].powerW, 495);
  assert.ok(Math.abs(rows[0].t_s - 123.456) < 1e-9);
});

function boatDeps(fetchImpl, values = {}) {
  const doc = makeDoc({ 'boat-url': DEFAULT_BOAT_URL,
                        'boat-target': '400', ...values });
  const timers = { set: [], cleared: [] };
  const downloads = [];
  return {
    doc, fetchImpl,
    setIntervalFn: (fn, ms) => { timers.set.push({ fn, ms }); return 7; },
    clearIntervalFn: (id) => timers.cleared.push(id),
    download: (name, text) => downloads.push({ name, text }),
    _timers: timers, _downloads: downloads,
  };
}

const okTelemetry = () => async (url, opts) => {
  if (opts && opts.method === 'POST') return { ok: true };
  return { ok: true, json: async () => SAMPLE };
};

test('pollOnce renders live cards and records the sample', async () => {
  const deps = boatDeps(okTelemetry());
  const state = { boatUrl: DEFAULT_BOAT_URL, samples: [] };
  assert.equal(await pollOnce(deps, state), true);
  assert.equal(state.samples.length, 1);
  const html = deps.doc.getElementById('boat-cards').innerHTML;
  assert.ok(html.includes('SOLAR'));
  assert.ok(html.includes('-82 W'));
  assert.ok(html.includes('no faults'));
  assert.ok(deps.doc.getElementById('boat-status').textContent
      .includes('1 samples'));
});

test('pollOnce shows faults and survives link errors', async () => {
  const deps = boatDeps(async () => ({
    ok: true,
    json: async () => ({ ...SAMPLE, mode: 9, fault_flags: 1 << 2 }),
  }));
  const state = { boatUrl: DEFAULT_BOAT_URL, samples: [] };
  await pollOnce(deps, state);
  const html = deps.doc.getElementById('boat-cards').innerHTML;
  assert.ok(html.includes('faults: gps-stale'));
  assert.ok(html.includes('#9')); // unknown mode rendered raw

  const dead = boatDeps(async () => { throw new Error('unreachable'); });
  assert.equal(await pollOnce(dead,
                              { boatUrl: 'http://x', samples: [] }),
               false);
  assert.ok(dead.doc.getElementById('boat-status').textContent
      .includes('No boat at http://x'));
  const http500 = boatDeps(async () => ({ ok: false, status: 500 }));
  assert.equal(await pollOnce(http500,
                              { boatUrl: 'http://x', samples: [] }),
               false);
});

test('sendRemote posts a valid target and reports failures', async () => {
  const calls = [];
  const deps = boatDeps(async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true };
  });
  const state = { boatUrl: 'http://192.168.4.1', samples: [] };
  assert.equal(await sendRemote(deps, state), true);
  assert.equal(calls[0].url, 'http://192.168.4.1/remote');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { target_w: 400 });
  assert.ok(deps.doc.getElementById('boat-remote-status').textContent
      .includes('degrades to SOLAR'));

  deps.doc.getElementById('boat-target').value = '-5';
  assert.equal(await sendRemote(deps, state), false);
  deps.doc.getElementById('boat-target').value = 'abc';
  assert.equal(await sendRemote(deps, state), false);

  const failing = boatDeps(async () => ({ ok: false, status: 400 }));
  assert.equal(await sendRemote(failing, state), false);
  assert.ok(failing.doc.getElementById('boat-remote-status').textContent
      .includes('Send failed'));
});

test('initBoat wires connect/disconnect polling and CSV export',
     async () => {
  const deps = boatDeps(okTelemetry(),
                        { 'boat-url': 'http://192.168.4.1/' });
  const state = initBoat(deps);

  // Export before any data: guidance, no download.
  fire(deps.doc, 'boat-export', 'click');
  assert.equal(deps._downloads.length, 0);

  await fire(deps.doc, 'boat-connect', 'click');
  assert.equal(state.boatUrl, 'http://192.168.4.1'); // trailing / stripped
  assert.equal(deps._timers.set.length, 1);
  assert.equal(deps.doc.getElementById('boat-connect').textContent,
               'Disconnect');
  await deps._timers.set[0].fn(); // one timed poll
  assert.equal(state.samples.length, 2);

  fire(deps.doc, 'boat-export', 'click');
  assert.equal(deps._downloads.length, 1);
  assert.ok(deps._downloads[0].name.endsWith('.csv'));
  assert.ok(deps._downloads[0].text.startsWith(CSV_HEADER));

  fire(deps.doc, 'boat-connect', 'click'); // disconnect
  assert.deepEqual(deps._timers.cleared, [7]);
  assert.equal(deps.doc.getElementById('boat-connect').textContent,
               'Connect');
  assert.ok(deps.doc.getElementById('boat-status').textContent
      .includes('2 samples kept'));

  // Reconnect with an empty URL field falls back to the default.
  deps.doc.getElementById('boat-url').value = '';
  await fire(deps.doc, 'boat-connect', 'click');
  assert.equal(state.boatUrl, DEFAULT_BOAT_URL);
  assert.equal(await sendRemote(deps, state), true);
});
