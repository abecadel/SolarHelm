import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VESSEL_STORAGE_KEY } from '../js/vessel_store.js';
import {
  applyVoyageLearning,
  envAtFactory,
  initVoyage,
  parseWaypoints,
  runVoyage,
  voyageHtml,
} from '../js/voyage_ui.js';
import {
  fire,
  makeDoc,
  makeStorage,
  marinePayload,
  telemetryCsv,
  windPayload,
} from './helpers.js';

const PROFILE = {
  hull_efficiency_curve_kmh_whkm: [[4, 50], [6, 80], [8, 120]],
  hotel_load_w: 50,
  motor_max_power_w: 1164,
  pv_kwp: 1.0,
  pv_derating: 0.85,
  battery_capacity_kwh: 2.56,
};

const WAYPOINTS = '43.5, 16.4, anchor\n43.52, 16.4\n43.54, 16.4';
// Noon of the day the payload helpers cover.
const NOW = new Date(Date.UTC(2026, 5, 21, 12, 0));

function liveFetch() {
  return async (url) => ({
    ok: true,
    json: async () => (url.includes('marine') ? marinePayload(3)
                                              : windPayload(3)),
  });
}

function voyageDeps(values = {}, fetchImpl = liveFetch()) {
  const doc = makeDoc({
    waypoints: WAYPOINTS, objective: 'maxSoc', soc: '90', reserve: '25',
    ...values,
  });
  return { doc, fetchImpl, now: () => NOW, storage: makeStorage() };
}

test('parseWaypoints reads lines, comments and the anchor flag', () => {
  const wps = parseWaypoints('# comment\n43.5, 16.4, ANCHOR\n\n43.54,16.4');
  assert.equal(wps.length, 2);
  assert.equal(wps[0].anchorable, true);
  assert.equal(wps[1].anchorable, false);
  assert.equal(wps[1].lon, 16.4);
});

test('parseWaypoints rejects garbage and one-point routes', () => {
  assert.equal(parseWaypoints(''), null);
  assert.equal(parseWaypoints('43.5, 16.4'), null);
  assert.equal(parseWaypoints('43.5, 16.4\nnot,numbers'), null);
});

function hoursSeries(scale) {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    hours.push({ time: new Date(Date.UTC(2026, 5, 21, h)),
                 ghiWm2: h * scale });
  }
  return hours;
}

test('envAtFactory offsets by departure time and clamps to the series', () => {
  const routeEnv = { envs: [{ hours: hoursSeries(1) }], segToPoint: [0] };
  const envAt = envAtFactory(routeEnv, NOW); // 12 h into the series
  assert.equal(envAt(0, 0).ghiWm2, 12);
  assert.equal(envAt(0, 3).ghiWm2, 15);
  assert.equal(envAt(0, 100).ghiWm2, 23);  // clamps high
  assert.equal(envAt(0, -100).ghiWm2, 0);  // clamps low
});

test('envAtFactory routes each segment to its own sample point', () => {
  const routeEnv = {
    envs: [{ hours: hoursSeries(1) }, { hours: hoursSeries(10) }],
    segToPoint: [0, 1],
  };
  const envAt = envAtFactory(routeEnv, NOW);
  assert.equal(envAt(0, 0).ghiWm2, 12);
  assert.equal(envAt(1, 0).ghiWm2, 120);
  assert.equal(envAt(99, 0).ghiWm2, 12); // unknown segment: first point
});

test('envAtFactory yields a dead-calm environment for an empty series', () => {
  for (const routeEnv of [{ envs: [], segToPoint: [] },
                          { envs: [{ hours: [] }], segToPoint: [0] }]) {
    const e = envAtFactory(routeEnv, NOW)(0, 5);
    assert.equal(e.ghiWm2, 0);
    assert.equal(e.windMs, 0);
    assert.equal(e.currentMs, 0);
  }
});

test('runVoyage plans a live-forecast voyage and renders the verdict',
     async () => {
  const deps = voyageDeps();
  const out = await runVoyage(deps, { profile: PROFILE });
  assert.equal(out.result.feasible, true);
  assert.ok(['SAFE', 'POSSIBLE'].includes(out.assessment.label));
  const html = deps.doc.getElementById('voyage-summary').innerHTML;
  assert.ok(html.includes('arrival SOC'));
  assert.ok(html.includes('PASS'));
  assert.ok(html.includes('arrive by'));
  assert.ok(deps.doc.getElementById('voyage-status').textContent
      .includes('wind: HIGH'));
});

test('runVoyage honours the earliest objective and blank SOC fields',
     async () => {
  const deps = voyageDeps({ objective: 'earliest', soc: '', reserve: '' });
  const out = await runVoyage(deps, { profile: PROFILE });
  assert.equal(out.result.feasible, true);
});

test('runVoyage reports unusable waypoints without planning', async () => {
  const deps = voyageDeps({ waypoints: 'one line only' });
  const out = await runVoyage(deps, { profile: PROFILE });
  assert.equal(out, null);
  assert.ok(deps.doc.getElementById('voyage-status').textContent
      .includes('at least two'));
});

test('runVoyage labels an impossible voyage INFEASIBLE', async () => {
  // A 3.5 m/s cross-current the boat cannot stem on a northbound route.
  const ripFetch = async (url) => ({
    ok: true,
    json: async () => (url.includes('marine')
        ? marinePayload(3, { currentKmh: 12.6 }) : windPayload(3)),
  });
  const deps = voyageDeps({}, ripFetch);
  const out = await runVoyage(deps, { profile: PROFILE });
  assert.equal(out.result.feasible, false);
  assert.equal(out.assessment.label, 'INFEASIBLE');
  assert.ok(deps.doc.getElementById('voyage-summary').innerHTML
      .includes('unreachable'));
});

test('runVoyage degrades to clear-sky offline and the gates say so',
     async () => {
  const deps = voyageDeps({}, async () => { throw new Error('offline'); });
  const out = await runVoyage(deps, { profile: PROFILE });
  assert.equal(out.result.feasible, true); // clear-sky June noon: plenty of sun
  assert.equal(out.assessment.label, 'POSSIBLE');
  const coverageGate = out.assessment.gates
      .find((g) => g.id === 'forecast-coverage');
  assert.equal(coverageGate.pass, false);
  assert.ok(deps.doc.getElementById('voyage-status').textContent
      .includes('wind: NONE'));
});

test('voyageHtml subsamples a long Pareto row', () => {
  const arrivalRow = [];
  for (let t = 0; t < 40; t++) {
    arrivalRow.push({ t, timeMs: NOW.getTime() + t * 600000, socPct: 50 + t });
  }
  const html = voyageHtml(
      { feasible: true, arrivalRow,
        summary: { arrivalSocPct: 89, arrivalTimeMs: NOW.getTime(),
                   departureDelayH: 0.5, distanceKm: 4.4,
                   solarStopBuckets: 2 } },
      { label: 'SAFE', gates: [{ id: 'x', pass: true, detail: 'ok' }] },
      { conservativePct: 70, optimisticPct: 95 });
  const rows = html.split('<tr>').length - 2; // minus header row
  assert.ok(rows <= 8 + 1);
  assert.ok(html.includes('SAFE'));
});

test('applyVoyageLearning updates, persists and reports the vessel model',
     () => {
  const deps = voyageDeps();
  const state = { profile: PROFILE };
  const log = telemetryCsv([[4, 168], [4, 168], [5, 300], [6, 492],
                            [7, 756]]);
  assert.equal(applyVoyageLearning(deps, state, log), true);
  assert.equal(state.vessel.voyages, 1);
  assert.ok(deps.storage.getItem(VESSEL_STORAGE_KEY).includes('"curve"'));
  const status = deps.doc.getElementById('voyage-learn-status').textContent;
  assert.ok(status.includes('Learned from 4 steady blocks'));
  // A drift-free log carries no drift warning.
  assert.ok(!status.includes('DRIFT'));

  // The next voyage plan uses the learned vessel, not the profile seed.
  const bad = applyVoyageLearning(deps, state, 'garbage');
  assert.equal(bad, false);
  assert.ok(deps.doc.getElementById('voyage-learn-status').textContent
      .includes('Nothing learned'));
  assert.equal(state.vessel.voyages, 1); // untouched by the failed pass
});

test('applyVoyageLearning warns about drift in both directions', () => {
  const deps = voyageDeps();
  const state = { profile: PROFILE,
                  vessel: { curve: { b1: 10, b3: 2 }, relErrors: [],
                            voyages: 0 } };
  applyVoyageLearning(deps, state, telemetryCsv(
      [[4, 252], [4, 252], [5, 450], [6, 738], [7, 1134]]));
  assert.ok(deps.doc.getElementById('voyage-learn-status').textContent
      .includes('DRIFT'));
  state.vessel = { curve: { b1: 10, b3: 2 }, relErrors: [], voyages: 0 };
  applyVoyageLearning(deps, state, telemetryCsv(
      [[4, 84], [4, 84], [5, 150], [6, 246], [7, 378]]));
  assert.ok(deps.doc.getElementById('voyage-learn-status').textContent
      .includes('runs easier'));
});

test('initVoyage loads the stored vessel and binds the CSV input',
     async () => {
  const deps = voyageDeps();
  const state = { profile: PROFILE };
  initVoyage(deps, state);
  assert.ok(state.vessel.curve.b3 > 0); // seeded from the profile
  const log = telemetryCsv([[4, 168], [4, 168], [5, 300], [6, 492],
                            [7, 756]]);
  await fire(deps.doc, 'voyage-csv', 'change',
             { target: { files: [{ text: async () => log }] } });
  assert.equal(state.vessel.voyages, 1);
  // No file selected: a no-op.
  await fire(deps.doc, 'voyage-csv', 'change', { target: { files: [] } });
  assert.equal(state.vessel.voyages, 1);

  // A fresh init on the same storage restores the learned model.
  const deps2 = { ...voyageDeps(), storage: deps.storage };
  const state2 = { profile: PROFILE };
  initVoyage(deps2, state2);
  assert.equal(state2.vessel.voyages, 1);
});

test('initVoyage binds the button; failures land in the status line',
     async () => {
  const deps = voyageDeps();
  const state = { profile: PROFILE };
  initVoyage(deps, state);
  await fire(deps.doc, 'voyage-plan', 'click');
  assert.ok(deps.doc.getElementById('voyage-summary').innerHTML
      .includes('verdict'));

  // A broken profile makes runVoyage throw; the catch handler reports it.
  state.profile = null;
  state.vessel = null;
  await fire(deps.doc, 'voyage-plan', 'click');
  assert.ok(deps.doc.getElementById('voyage-status').textContent
      .includes('Voyage planning failed'));
});
