import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_PROFILE } from '../js/profile.js';
import {
  CURVE_STORAGE_KEY,
  applyFittedCurve,
  chartsHtml,
  initApp,
  readOptions,
  restoreFittedCurve,
  runPlan,
  summaryHtml,
} from '../js/ui.js';
import {
  FORM_DEFAULTS,
  fire,
  makeDoc,
  makeFetch,
  makeStorage,
  openMeteoPayload,
} from './helpers.js';

const NOW = () => new Date(Date.UTC(2026, 5, 21, 4, 0));

function makeDeps(overrides = {}) {
  return {
    doc: makeDoc(FORM_DEFAULTS),
    fetchImpl: makeFetch(null, { reject: true }), // default: offline
    geolocation: undefined,
    storage: makeStorage(),
    now: NOW,
    ...overrides,
  };
}

test('readOptions parses the form and falls back on garbage', () => {
  const doc = makeDoc({ ...FORM_DEFAULTS, distance: 'garbage', days: '9',
                        mode: 'fixed' });
  const opt = readOptions(doc);
  assert.equal(opt.distanceKm, 40);   // fallback
  assert.equal(opt.days, 3);          // clamped
  assert.equal(opt.mode, 'fixed');
  const opt2 = readOptions(makeDoc(FORM_DEFAULTS));
  assert.equal(opt2.mode, 'solar');
  assert.equal(opt2.latDeg, 43.5081);
});

test('summaryHtml renders both verdicts', () => {
  const base = {
    plannedDistanceKm: 40, distanceCoveredKm: 40, finalSocPct: 71.2,
    minSocPct: 33.3, pvKwh: 6.1, motorKwh: 4.9, hotelKwh: 1.4,
    perDay: [{ day: 1, distanceKm: 25, pvKwh: 3.5, motorKwh: 2.8 }],
  };
  const fits = summaryHtml({ ...base, tripFits: true,
                             arrivalTime: new Date(Date.UTC(2026, 5, 21, 15)) },
                           'open-meteo', 66);
  assert.ok(fits.includes('Trip fits'));
  assert.ok(fits.includes('2026-06-21T15:00Z'));
  assert.ok(fits.includes('66 km'));
  const fitsNoTime = summaryHtml({ ...base, tripFits: true,
                                   arrivalTime: null }, 'open-meteo', 66);
  assert.ok(fitsNoTime.includes('Trip fits'));
  const nope = summaryHtml({ ...base, tripFits: false, arrivalTime: null,
                             distanceCoveredKm: 22.5 }, 'clear-sky', 30);
  assert.ok(nope.includes('does NOT fit'));
  assert.ok(nope.includes('22.5 of 40'));
});

test('runPlan renders with live forecast', async () => {
  const deps = makeDeps({ fetchImpl: makeFetch(openMeteoPayload(2)) });
  const state = { profile: DEFAULT_PROFILE };
  const r = await runPlan(deps, state);
  assert.equal(r.forecast.source, 'open-meteo');
  const summaryEl = deps.doc.getElementById('summary');
  assert.ok(summaryEl.innerHTML.includes('forecast source'));
  assert.ok(deps.doc.getElementById('charts').innerHTML.includes('<svg'));
  assert.equal(deps.doc.getElementById('status').textContent,
               'Live Open-Meteo forecast');
  // chartsHtml directly: three charts.
  const html = chartsHtml(r.steps, r.forecast.hours);
  assert.equal((html.match(/<svg/g) || []).length, 3);
});

test('runPlan falls back to clear-sky when offline', async () => {
  const deps = makeDeps(); // rejecting fetch
  const state = { profile: DEFAULT_PROFILE };
  const r = await runPlan(deps, state);
  assert.equal(r.forecast.source, 'clear-sky');
  assert.ok(deps.doc.getElementById('status').textContent
      .includes('clear-sky'));
});

test('applyFittedCurve: bad CSV reports, good CSV applies and persists', () => {
  const deps = makeDeps();
  const state = { profile: DEFAULT_PROFILE };
  assert.equal(applyFittedCurve(state, deps, 'x,y\n1,2'), false);
  assert.ok(deps.doc.getElementById('curve-status').textContent
      .includes('Not enough'));

  const lines = ['speed_kmh,motor_estimated_power_w'];
  for (const [s, w] of [[4, 400], [5, 620], [6, 1000]]) {
    for (let i = 0; i < 6; i++) lines.push(`${s},${w}`);
  }
  assert.equal(applyFittedCurve(state, deps, lines.join('\n')), true);
  assert.equal(state.profile.hull_efficiency_curve_kmh_whkm.length, 3);
  assert.ok(deps.storage._map.has(CURVE_STORAGE_KEY));
  assert.ok(deps.doc.getElementById('curve-status').textContent
      .includes('Learned curve applied'));
});

test('applyFittedCurve survives a throwing storage', () => {
  const deps = makeDeps({ storage: { setItem() { throw new Error('quota'); },
                                     getItem() { return null; } } });
  const state = { profile: DEFAULT_PROFILE };
  const lines = ['speed_kmh,motor_estimated_power_w'];
  for (const [s, w] of [[4, 400], [5, 620]]) {
    for (let i = 0; i < 6; i++) lines.push(`${s},${w}`);
  }
  assert.equal(applyFittedCurve(state, deps, lines.join('\n')), true);
});

test('restoreFittedCurve handles absent, broken and valid stored curves', () => {
  // Absent.
  let deps = makeDeps();
  let state = { profile: DEFAULT_PROFILE };
  assert.equal(restoreFittedCurve(state, deps), false);
  // Throwing storage.
  deps = makeDeps({ storage: { getItem() { throw new Error('denied'); } } });
  assert.equal(restoreFittedCurve(state, deps), false);
  // Unparseable JSON.
  deps = makeDeps({ storage: makeStorage({ [CURVE_STORAGE_KEY]: '{oops' }) });
  assert.equal(restoreFittedCurve(state, deps), false);
  // Parseable but invalid curve.
  deps = makeDeps({ storage: makeStorage({
    [CURVE_STORAGE_KEY]: JSON.stringify([[3, 85]]) }) });
  assert.equal(restoreFittedCurve(state, deps), false);
  // Valid.
  deps = makeDeps({ storage: makeStorage({
    [CURVE_STORAGE_KEY]: JSON.stringify([[3, 85], [5, 120], [7, 280]]) }) });
  state = { profile: DEFAULT_PROFILE };
  assert.equal(restoreFittedCurve(state, deps), true);
  assert.equal(state.profile.hull_efficiency_curve_kmh_whkm.length, 3);
  assert.ok(deps.doc.getElementById('curve-status').textContent
      .includes('stored learned curve'));
});

test('initApp wires the whole app (offline path)', async () => {
  const deps = makeDeps();
  const state = await initApp(deps);
  assert.equal(state.profile, DEFAULT_PROFILE);
  assert.ok(deps.doc.getElementById('profile-name').textContent
      .includes('built-in profile'));

  // Plan click runs a full offline plan.
  await fire(deps.doc, 'plan', 'click');
  assert.ok(deps.doc.getElementById('summary').innerHTML.length > 100);

  // Locate without geolocation support.
  fire(deps.doc, 'locate', 'click');
  assert.ok(deps.doc.getElementById('status').textContent
      .includes('GPS unavailable'));

  // CSV change with no file selected is a no-op.
  await fire(deps.doc, 'csv', 'change', { target: { files: [] } });
  // CSV change with a real file applies the curve.
  const lines = ['speed_kmh,motor_estimated_power_w'];
  for (const [s, w] of [[4, 400], [5, 620]]) {
    for (let i = 0; i < 6; i++) lines.push(`${s},${w}`);
  }
  await fire(deps.doc, 'csv', 'change',
             { target: { files: [{ text: async () => lines.join('\n') }] } });
  assert.equal(state.profile.hull_efficiency_curve_kmh_whkm.length, 2);
});

test('initApp: GPS success and failure callbacks', async () => {
  let deps = makeDeps({
    fetchImpl: makeFetch(DEFAULT_PROFILE),  // profile via config
    geolocation: { getCurrentPosition:
        (ok) => ok({ coords: { latitude: 44.1234, longitude: 15.5678 } }) },
  });
  await initApp(deps);
  assert.ok(!deps.doc.getElementById('profile-name').textContent
      .includes('built-in'));
  fire(deps.doc, 'locate', 'click');
  assert.equal(deps.doc.getElementById('lat').value, '44.1234');
  assert.equal(deps.doc.getElementById('lon').value, '15.5678');

  deps = makeDeps({
    geolocation: { getCurrentPosition: (_ok, fail) => fail(new Error('no')) },
  });
  await initApp(deps);
  fire(deps.doc, 'locate', 'click');
  assert.ok(deps.doc.getElementById('status').textContent
      .includes('GPS unavailable'));
});

test('initApp: plan click failure path reports the error', async () => {
  const deps = makeDeps({ now: () => { throw new Error('boom'); } });
  await initApp(deps);
  await fire(deps.doc, 'plan', 'click');
  assert.ok(deps.doc.getElementById('status').textContent
      .includes('Planning failed'));
});

test('initApp restores a stored curve on startup', async () => {
  const deps = makeDeps({ storage: makeStorage({
    [CURVE_STORAGE_KEY]: JSON.stringify([[3, 85], [5, 120], [7, 280]]) }) });
  const state = await initApp(deps);
  assert.equal(state.profile.hull_efficiency_curve_kmh_whkm.length, 3);
});
