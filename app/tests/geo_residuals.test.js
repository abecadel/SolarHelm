import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GEO_STORAGE_KEY,
  MAX_ABS_BIAS,
  MIN_SAMPLES,
  geoKey,
  geoPowerFactor,
  geoUpdate,
  loadGeoStore,
  makeGeoStore,
  saveGeoStore,
} from '../js/geo_residuals.js';
import { makeStorage } from './helpers.js';

test('geoKey bins by 0.2 degrees, stable within a bin', () => {
  assert.equal(geoKey(43.51, 16.41), geoKey(43.59, 16.59));
  assert.notEqual(geoKey(43.51, 16.41), geoKey(43.61, 16.41));
  assert.notEqual(geoKey(43.51, 16.41), geoKey(43.51, 16.61));
  assert.equal(geoKey(-0.1, -0.1), '-1:-1'); // floor, not truncation
});

test('geoUpdate is an EWMA and geoPowerFactor needs evidence', () => {
  const store = makeGeoStore();
  // No evidence: neutral.
  assert.equal(geoPowerFactor(store, 43.5, 16.4), 1.0);
  geoUpdate(store, 43.5, 16.4, 0.2);
  geoUpdate(store, 43.5, 16.4, 0.2);
  // Below MIN_SAMPLES: still neutral.
  assert.equal(geoPowerFactor(store, 43.5, 16.4), 1.0);
  const bin = geoUpdate(store, 43.5, 16.4, 0.2);
  assert.equal(bin.n, MIN_SAMPLES);
  assert.ok(Math.abs(geoPowerFactor(store, 43.5, 16.4) - 1.2) < 1e-9);
  // EWMA moves toward new evidence without jumping.
  geoUpdate(store, 43.5, 16.4, 0.0);
  const f = geoPowerFactor(store, 43.5, 16.4);
  assert.ok(f > 1.1 && f < 1.2);
});

test('geoPowerFactor clamps runaway biases', () => {
  const store = makeGeoStore();
  for (let i = 0; i < 5; i++) geoUpdate(store, 10, 10, 2.0);
  assert.equal(geoPowerFactor(store, 10, 10), 1 + MAX_ABS_BIAS);
  for (let i = 0; i < 5; i++) geoUpdate(store, 20, 20, -2.0);
  assert.equal(geoPowerFactor(store, 20, 20), 1 - MAX_ABS_BIAS);
});

test('saveGeoStore/loadGeoStore round-trip and survive bad state', () => {
  const storage = makeStorage();
  const store = makeGeoStore();
  geoUpdate(store, 43.5, 16.4, 0.1);
  assert.equal(saveGeoStore(storage, store), true);
  const back = loadGeoStore(storage);
  assert.equal(back.bins[geoKey(43.5, 16.4)].n, 1);
  // Empty, corrupt and throwing storages all yield a fresh store.
  assert.deepEqual(loadGeoStore(makeStorage()).bins, {});
  assert.deepEqual(
      loadGeoStore(makeStorage({ [GEO_STORAGE_KEY]: '{nope' })).bins, {});
  const throwing = { getItem() { throw new Error('blocked'); },
                     setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadGeoStore(throwing).bins, {});
  assert.equal(saveGeoStore(throwing, store), false);
});
