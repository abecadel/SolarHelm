import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CSV_HEADER,
  DEFAULT_BOAT_URL,
  MODE_NAMES,
  decodeFaults,
  initBoat,
  pollOnce,
  sendMode,
  sendRemote,
  toCsv,
} from '../js/boat_ui.js';
import { BLE_SERVICE } from '../js/ble_link.js';
import { parseTelemetryRows } from '../js/vessel_store.js';
import { fire, makeDoc } from './helpers.js';

const SAMPLE = {
  timestamp_ms: 123456, mode: 1, battery_voltage_v: 25.61,
  battery_current_a: -3.2, battery_power_w: -81.9, battery_soc_pct: 76.5,
  solar_power_w: 412, motor_command_pct: 43.5,
  motor_estimated_power_w: 495, speed_kmh: 5.42, distance_today_km: 12.3,
  energy_solar_today_wh: 1500, energy_motor_today_wh: 1300,
  energy_hotel_today_wh: 240, efficiency_wh_km: 91.3,
  reserve_soc_pct: 25, fault_flags: 0, latitude_deg: 43.5081,
  longitude_deg: 16.4402,
};

test('decodeFaults names the raised bits', () => {
  assert.deepEqual(decodeFaults(0), []);
  assert.deepEqual(decodeFaults(1 << 0 | 1 << 6 | 1 << 12),
                   ['battery-stale', 'sag-soft', 'remote-stale']);
  assert.deepEqual(decodeFaults(1 << 13), ['arrival-stale']);
  assert.equal(MODE_NAMES[4], 'RANGE');
  assert.equal(MODE_NAMES[5], 'ARRIVAL');
});

test('toCsv emits the firmware CSV format, positions included', () => {
  const csv = toCsv([SAMPLE, { ...SAMPLE, timestamp_ms: 124456,
                               latitude_deg: undefined,
                               longitude_deg: undefined }]);
  assert.ok(csv.startsWith(CSV_HEADER));
  assert.ok(CSV_HEADER.endsWith('latitude_deg,longitude_deg'));
  const rows = parseTelemetryRows(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].powerW, 495);
  assert.equal(rows[0].lat, 43.5081);
  assert.equal(rows[1].lat, 0); // missing position -> the 0,0 sentinel
});

function boatDeps(fetchImpl, values = {}) {
  const doc = makeDoc({ 'boat-url': DEFAULT_BOAT_URL,
                        'boat-target': '400', 'boat-transport': 'http',
                        ...values });
  const timers = { set: [], cleared: [] };
  const downloads = [];
  return {
    doc, rawFetch: fetchImpl, pageProtocol: 'http:', bluetooth: null,
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
  const state = initBoat(deps);
  await fire(deps.doc, 'boat-connect', 'click');
  assert.equal(state.samples.length, 1);
  const html = deps.doc.getElementById('boat-cards').innerHTML;
  assert.ok(html.includes('SOLAR'));
  assert.ok(html.includes('-82 W'));
  assert.ok(html.includes('no faults'));
  assert.ok(deps.doc.getElementById('boat-status').textContent
      .includes('Live via http://192.168.4.1'));
});

test('pollOnce shows faults and survives link errors', async () => {
  const deps = boatDeps(async () => ({
    ok: true,
    json: async () => ({ ...SAMPLE, mode: 9, fault_flags: 1 << 2 }),
  }));
  const state = initBoat(deps);
  await fire(deps.doc, 'boat-connect', 'click');
  const html = deps.doc.getElementById('boat-cards').innerHTML;
  assert.ok(html.includes('faults: gps-stale'));
  assert.ok(html.includes('#9')); // unknown mode rendered raw

  const dead = boatDeps(async () => { throw new Error('unreachable'); });
  const deadState = initBoat(dead);
  await fire(dead.doc, 'boat-connect', 'click');
  assert.ok(dead.doc.getElementById('boat-status').textContent
      .includes('Link down'));
  assert.equal(await pollOnce(dead, deadState), false);
});

test('sendRemote posts a valid target and reports failures', async () => {
  const calls = [];
  const deps = boatDeps(async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => SAMPLE };
  });
  const state = initBoat(deps);
  // Not connected yet: guidance instead of a crash.
  assert.equal(await sendRemote(deps, state), false);
  assert.ok(deps.doc.getElementById('boat-remote-status').textContent
      .includes('Connect'));

  await fire(deps.doc, 'boat-connect', 'click');
  assert.equal(await sendRemote(deps, state), true);
  const post = calls.find((c) => c.opts && c.opts.method === 'POST');
  assert.equal(post.url, 'http://192.168.4.1/remote');
  assert.deepEqual(JSON.parse(post.opts.body), { target_w: 400 });
  assert.ok(deps.doc.getElementById('boat-remote-status').textContent
      .includes('degrades to SOLAR'));

  deps.doc.getElementById('boat-target').value = '-5';
  assert.equal(await sendRemote(deps, state), false);
  deps.doc.getElementById('boat-target').value = 'abc';
  assert.equal(await sendRemote(deps, state), false);

  const failing = boatDeps(async (url, opts) =>
      (opts && opts.method === 'POST'
        ? { ok: false, status: 400 }
        : { ok: true, json: async () => SAMPLE }));
  const fState = initBoat(failing);
  await fire(failing.doc, 'boat-connect', 'click');
  assert.equal(await sendRemote(failing, fState), false);
  assert.ok(failing.doc.getElementById('boat-remote-status').textContent
      .includes('Send failed'));
});

test('sendMode requests modes and streams the ARRIVAL budget', async () => {
  const posts = [];
  const deps = boatDeps(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      posts.push(JSON.parse(opts.body));
      return { ok: true };
    }
    return { ok: true, json: async () => SAMPLE };
  }, { 'boat-mode': 'range' });
  const state = initBoat(deps);

  // Not connected yet: guidance instead of a crash.
  assert.equal(await sendMode(deps, state), false);
  assert.ok(deps.doc.getElementById('boat-mode-status').textContent
      .includes('Connect'));

  await fire(deps.doc, 'boat-connect', 'click');
  await fire(deps.doc, 'boat-mode-set', 'click');
  assert.deepEqual(posts[posts.length - 1], { mode: 'range' });
  assert.equal(state.arrivalBudget, null);
  assert.ok(deps.doc.getElementById('boat-mode-status').textContent
      .includes('Mode RANGE requested'));

  // ARRIVAL: budget validated, sent with the mode, then re-streamed on
  // every poll so the boat's 10 s watchdog stays fed.
  deps.doc.getElementById('boat-mode').value = 'arrival';
  deps.doc.getElementById('boat-budget').value = '-150';
  assert.equal(await sendMode(deps, state), true);
  assert.deepEqual(posts[posts.length - 1],
                   { mode: 'arrival', arrival_battery_w: -150 });
  assert.equal(state.arrivalBudget, -150);
  const before = posts.length;
  await deps._timers.set[0].fn(); // one timed poll
  assert.deepEqual(posts[before], { arrival_battery_w: -150 });

  // Bad budget: refused with guidance, nothing sent.
  deps.doc.getElementById('boat-budget').value = '-9999';
  assert.equal(await sendMode(deps, state), false);
  deps.doc.getElementById('boat-budget').value = 'abc';
  assert.equal(await sendMode(deps, state), false);
  assert.ok(deps.doc.getElementById('boat-mode-status').textContent
      .includes('battery budget'));

  // Leaving ARRIVAL stops the stream; disconnect clears it too.
  deps.doc.getElementById('boat-mode').value = 'solar';
  assert.equal(await sendMode(deps, state), true);
  assert.equal(state.arrivalBudget, null);
  deps.doc.getElementById('boat-mode').value = 'arrival';
  deps.doc.getElementById('boat-budget').value = '-100';
  await sendMode(deps, state);
  assert.equal(state.arrivalBudget, -100);
  await fire(deps.doc, 'boat-connect', 'click'); // disconnect
  assert.equal(state.arrivalBudget, null);

  // A failing link surfaces the error.
  const failing = boatDeps(async (url, opts) =>
      (opts && opts.method === 'POST'
        ? { ok: false, status: 400 }
        : { ok: true, json: async () => SAMPLE }),
      { 'boat-mode': 'solar' });
  const fState = initBoat(failing);
  await fire(failing.doc, 'boat-connect', 'click');
  assert.equal(await sendMode(failing, fState), false);
  assert.ok(failing.doc.getElementById('boat-mode-status').textContent
      .includes('Send failed'));
});

test('initBoat wires connect/disconnect polling and CSV export',
     async () => {
  const deps = boatDeps(okTelemetry(),
                        { 'boat-url': 'http://192.168.4.1/' });
  const state = initBoat(deps);

  fire(deps.doc, 'boat-export', 'click'); // nothing recorded yet
  assert.equal(deps._downloads.length, 0);

  await fire(deps.doc, 'boat-connect', 'click');
  assert.equal(state.link.label, 'http://192.168.4.1'); // slash stripped
  assert.equal(deps._timers.set.length, 1);
  assert.equal(deps.doc.getElementById('boat-connect').textContent,
               'Disconnect');
  await deps._timers.set[0].fn(); // one timed poll
  assert.equal(state.samples.length, 2);

  fire(deps.doc, 'boat-export', 'click');
  assert.equal(deps._downloads.length, 1);
  assert.ok(deps._downloads[0].text.startsWith(CSV_HEADER));

  await fire(deps.doc, 'boat-connect', 'click'); // disconnect
  assert.deepEqual(deps._timers.cleared, [7]);
  assert.equal(state.link, null);
  assert.ok(deps.doc.getElementById('boat-status').textContent
      .includes('2 samples kept'));

  // Reconnect with an empty URL falls back to the default.
  deps.doc.getElementById('boat-url').value = '';
  await fire(deps.doc, 'boat-connect', 'click');
  assert.equal(state.link.label, DEFAULT_BOAT_URL);
});

test('a second click during a pending BLE connect is ignored', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let connects = 0;
  const deps = boatDeps(okTelemetry(), { 'boat-transport': 'ble' });
  deps.bluetooth = {
    requestDevice: async () => {
      connects += 1;
      await gate;
      throw new Error('chooser cancelled');
    },
  };
  const state = initBoat(deps);
  const first = fire(deps.doc, 'boat-connect', 'click');
  await Promise.resolve(); // first click is now awaiting the chooser
  await fire(deps.doc, 'boat-connect', 'click'); // must be a no-op
  assert.equal(connects, 1);
  release();
  await first;
  assert.equal(state.link, null); // cancelled cleanly
  assert.equal(state.connecting, false);
  assert.ok(deps.doc.getElementById('boat-status').textContent
      .includes('chooser cancelled'));
});

test('disconnect during the first poll leaves no zombie timer', async () => {
  let releasePoll;
  const pollGate = new Promise((r) => { releasePoll = r; });
  const deps = boatDeps(async (url) => {
    if (url.endsWith('/telemetry')) {
      await pollGate;
      return { ok: true, json: async () => SAMPLE };
    }
    return { ok: true };
  });
  const state = initBoat(deps);
  const first = fire(deps.doc, 'boat-connect', 'click');
  // Let the link build (sync for HTTP) and the first poll start pending.
  await Promise.resolve();
  await Promise.resolve();
  await fire(deps.doc, 'boat-connect', 'click'); // disconnect mid-poll
  assert.equal(state.link, null);
  releasePoll();
  await first;
  assert.equal(state.timer, null);          // never armed
  assert.equal(deps._timers.set.length, 0); // no zombie interval
});

test('mixed content and missing Bluetooth produce clear guidance',
     async () => {
  const https = boatDeps(okTelemetry());
  https.pageProtocol = 'https:';
  initBoat(https);
  await fire(https.doc, 'boat-connect', 'click');
  assert.ok(https.doc.getElementById('boat-status').textContent
      .includes('cannot call the boat over plain HTTP'));

  const noBt = boatDeps(okTelemetry(), { 'boat-transport': 'ble' });
  initBoat(noBt);
  await fire(noBt.doc, 'boat-connect', 'click');
  assert.ok(noBt.doc.getElementById('boat-status').textContent
      .includes('no Web Bluetooth'));
});

test('initBoat connects over BLE and disconnects the GATT link',
     async () => {
  let disconnected = 0;
  const chars = {
    read: { readValue: async () =>
        new TextEncoder().encode(JSON.stringify(SAMPLE)) },
    write: { writeValue: async () => {} },
  };
  const bt = {
    requestDevice: async () => ({
      name: 'SolarHelm',
      gatt: {
        connected: true,
        connect: async function () {
          return { getPrimaryService: async (u) => {
            assert.equal(u, BLE_SERVICE);
            return { getCharacteristic: async (uuid) =>
                (uuid.endsWith('0002') ? chars.read : chars.write) };
          } };
        },
        disconnect: () => { disconnected += 1; },
      },
    }),
  };
  const deps = boatDeps(okTelemetry(), { 'boat-transport': 'ble' });
  deps.bluetooth = bt;
  const state = initBoat(deps);
  await fire(deps.doc, 'boat-connect', 'click');
  assert.equal(state.link.kind, 'ble');
  assert.equal(state.samples.length, 1);
  assert.ok(deps.doc.getElementById('boat-status').textContent
      .includes('Live via BLE: SolarHelm'));
  await fire(deps.doc, 'boat-connect', 'click'); // disconnect
  assert.equal(disconnected, 1);
});
