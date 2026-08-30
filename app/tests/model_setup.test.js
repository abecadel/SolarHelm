import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyModelLearning,
  initModel,
  refreshModel,
} from '../js/model_ui.js';
import { DEFAULT_PROFILE } from '../js/profile.js';
import {
  PROFILE_STORAGE_KEY,
  applyStoredProfile,
  curveToText,
  fillSetupForm,
  initSetup,
  parseCurveText,
  saveSetup,
} from '../js/setup_ui.js';
import { cruiseBandKmh } from '../js/vessel_model.js';
import { VESSEL_STORAGE_KEY } from '../js/vessel_store.js';
import { fire, makeDoc, makeStorage, telemetryCsv } from './helpers.js';

const PROFILE = { ...DEFAULT_PROFILE };
const GOOD_LOG = telemetryCsv([[4, 168], [4, 168], [5, 300], [6, 492],
                               [7, 756]]);

function modelDeps(values = {}) {
  return { doc: makeDoc({ 'model-pv': '800', ...values }),
           storage: makeStorage() };
}

// --- cruiseBandKmh (vessel_model addition) -------------------------------

test('cruiseBandKmh finds a hotel-aware optimum and the knee above it',
     () => {
  const band = cruiseBandKmh({ b1: 10, b3: 2 }, 60);
  // Analytic optimum for hotel/2b3: v = (60/4)^(1/3) ~ 2.47 km/h.
  assert.ok(Math.abs(band.bestKmh - 2.47) < 0.1);
  assert.ok(band.kneeKmh > band.bestKmh);
  const f = (v) => (10 * v + 2 * v ** 3 + 60) / v;
  assert.ok(f(band.kneeKmh) <= band.minWhKm * 1.25 + 1e-6);
  assert.ok(f(band.kneeKmh + 0.1) > band.minWhKm * 1.25);
  // No hotel load: the band starts at the bottom of the scan.
  const noHotel = cruiseBandKmh({ b1: 10, b3: 2 }, 0);
  assert.ok(noHotel.bestKmh <= 0.2);
  // Unlearned curve: zeros.
  assert.deepEqual(cruiseBandKmh({ b1: 0, b3: 0 }, 60),
                   { bestKmh: 0, kneeKmh: 0, minWhKm: 0 });
});

// --- Model tab -----------------------------------------------------------

test('refreshModel renders curve, band, equilibrium and store counts',
     () => {
  const deps = modelDeps();
  const state = { profile: PROFILE };
  refreshModel(deps, state);
  const html = deps.doc.getElementById('model-summary').innerHTML;
  assert.ok(html.includes('voyages learned'));
  assert.ok(html.includes('recommended cruise band'));
  assert.ok(html.includes('solar equilibrium at 800 W'));
  assert.ok(html.includes('defaults')); // uncalibrated seed model
  assert.ok(html.includes('learned hull curve'));
  assert.ok(html.includes('3 km/h'));
});

test('applyModelLearning learns, persists, refreshes and reports drift',
     () => {
  const deps = modelDeps();
  const state = { profile: PROFILE };
  assert.equal(applyModelLearning(deps, state, GOOD_LOG), true);
  assert.equal(state.vessel.voyages, 1);
  assert.ok(deps.storage.getItem(VESSEL_STORAGE_KEY).includes('"curve"'));
  assert.ok(deps.doc.getElementById('model-learn-status').textContent
      .includes('Learned from 4 steady blocks'));

  assert.equal(applyModelLearning(deps, state, 'garbage'), false);
  assert.ok(deps.doc.getElementById('model-learn-status').textContent
      .includes('Nothing learned'));

  // Drift both ways.
  state.vessel = { curve: { b1: 10, b3: 2 }, relErrors: [], voyages: 0 };
  applyModelLearning(deps, state, telemetryCsv(
      [[4, 252], [4, 252], [5, 450], [6, 738], [7, 1134]]));
  assert.ok(deps.doc.getElementById('model-learn-status').textContent
      .includes('DRIFT'));
  state.vessel = { curve: { b1: 10, b3: 2 }, relErrors: [], voyages: 0 };
  applyModelLearning(deps, state, telemetryCsv(
      [[4, 84], [4, 84], [5, 150], [6, 246], [7, 378]]));
  assert.ok(deps.doc.getElementById('model-learn-status').textContent
      .includes('runs easier'));
});

test('initModel binds CSV, PV input and reset', async () => {
  const deps = modelDeps();
  const state = { profile: PROFILE };
  initModel(deps, state);
  await fire(deps.doc, 'model-csv', 'change',
             { target: { files: [{ text: async () => GOOD_LOG }] } });
  assert.equal(state.vessel.voyages, 1);
  await fire(deps.doc, 'model-csv', 'change', { target: { files: [] } });
  assert.equal(state.vessel.voyages, 1);

  deps.doc.getElementById('model-pv').value = '1500';
  fire(deps.doc, 'model-pv', 'change');
  assert.ok(deps.doc.getElementById('model-summary').innerHTML
      .includes('solar equilibrium at 1500 W'));

  fire(deps.doc, 'model-reset', 'click');
  assert.equal(state.vessel.voyages, 0);
  assert.equal(deps.storage.getItem(VESSEL_STORAGE_KEY), null);
  assert.ok(deps.doc.getElementById('model-learn-status').textContent
      .includes('reset'));

  // Reset with a throwing storage still resets the in-memory model.
  const throwing = { ...deps, storage: {
    getItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); } } };
  initModel(throwing, state);
  fire(throwing.doc, 'model-reset', 'click');
  assert.equal(state.vessel.voyages, 0);
});

// --- Setup tab -----------------------------------------------------------

test('parseCurveText and curveToText round-trip and reject garbage', () => {
  const curve = parseCurveText('5, 120\n3, 85\n\n7, 286');
  assert.deepEqual(curve, [[3, 85], [5, 120], [7, 286]]); // sorted
  assert.equal(curveToText([[3, 85], [5, 120]]), '3, 85\n5, 120');
  assert.equal(parseCurveText('3, 85'), null);       // one point
  assert.equal(parseCurveText('3, 85\nx, 1'), null); // NaN
  assert.equal(parseCurveText('3, 85\n0, 5'), null); // non-positive
  assert.equal(parseCurveText('3, 85\n4'), null);    // missing column
});

function setupDeps(values = {}) {
  return { doc: makeDoc(values), storage: makeStorage() };
}

test('saveSetup validates, bumps the revision and persists', () => {
  const deps = setupDeps();
  const state = { profile: { ...PROFILE } };
  fillSetupForm(deps.doc, state.profile);
  assert.ok(deps.doc.getElementById('setup-revision').textContent
      .includes('revision 1'));

  deps.doc.getElementById('setup-pv').value = '2.0';
  deps.doc.getElementById('setup-note').value = 'second panel pair';
  assert.equal(saveSetup(deps, state), true);
  assert.equal(state.profile.pv_kwp, 2);
  assert.equal(state.profile.config_revision, 2);
  assert.equal(state.profile.config_change_note, 'second panel pair');
  const stored = JSON.parse(deps.storage.getItem(PROFILE_STORAGE_KEY));
  assert.equal(stored.config_revision, 2);
  assert.ok(deps.doc.getElementById('setup-status').textContent
      .includes('revision 2'));

  // Bad curve refused, profile untouched.
  deps.doc.getElementById('setup-curve').value = 'nope';
  assert.equal(saveSetup(deps, state), false);
  assert.equal(state.profile.config_revision, 2);
  // Invalid numbers refused by profileValid.
  fillSetupForm(deps.doc, state.profile);
  deps.doc.getElementById('setup-pv').value = '0';
  assert.equal(saveSetup(deps, state), false);
  assert.ok(deps.doc.getElementById('setup-status').textContent
      .includes('Invalid values'));
});

test('applyStoredProfile overlays only a valid stored profile', () => {
  const good = { ...PROFILE, pv_kwp: 3, config_revision: 5 };
  const deps = setupDeps();
  deps.storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(good));
  const state = { profile: PROFILE };
  assert.equal(applyStoredProfile(deps, state), true);
  assert.equal(state.profile.pv_kwp, 3);

  assert.equal(applyStoredProfile(setupDeps(), { profile: PROFILE }),
               false); // nothing stored
  const corrupt = setupDeps();
  corrupt.storage.setItem(PROFILE_STORAGE_KEY, '{nope');
  assert.equal(applyStoredProfile(corrupt, { profile: PROFILE }), false);
  const invalid = setupDeps();
  invalid.storage.setItem(PROFILE_STORAGE_KEY,
                          JSON.stringify({ pv_kwp: -1 }));
  assert.equal(applyStoredProfile(invalid, { profile: PROFILE }), false);
  const throwing = { doc: makeDoc(), storage: {
    getItem() { throw new Error('blocked'); } } };
  assert.equal(applyStoredProfile(throwing, { profile: PROFILE }), false);
});

test('initSetup binds save and reset-to-default', () => {
  const deps = setupDeps();
  const state = { profile: { ...PROFILE } };
  initSetup(deps, state, PROFILE);
  deps.doc.getElementById('setup-hotel').value = '90';
  fire(deps.doc, 'setup-save', 'click');
  assert.equal(state.profile.hotel_load_w, 90);
  fire(deps.doc, 'setup-reset', 'click');
  assert.equal(state.profile.hotel_load_w, PROFILE.hotel_load_w);
  assert.equal(deps.storage.getItem(PROFILE_STORAGE_KEY), null);
  assert.ok(deps.doc.getElementById('setup-status').textContent
      .includes('reference profile'));
  // Save persisting into a throwing storage still updates the state.
  const throwing = { doc: deps.doc, storage: {
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); } } };
  initSetup(throwing, state, PROFILE);
  throwing.doc.getElementById('setup-hotel').value = '75';
  fire(throwing.doc, 'setup-save', 'click');
  assert.equal(state.profile.hotel_load_w, 75);
  fire(throwing.doc, 'setup-reset', 'click');
  assert.equal(state.profile.hotel_load_w, PROFILE.hotel_load_w);
});
