import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hullPowerW, vesselFromProfile } from '../js/vessel_model.js';
import {
  MAX_REL_ERRORS,
  VESSEL_STORAGE_KEY,
  learnFromTelemetry,
  loadVessel,
  parseTelemetryRows,
  saveVessel,
} from '../js/vessel_store.js';
import { makeStorage, telemetryCsv } from './helpers.js';

const PROFILE = {
  hull_efficiency_curve_kmh_whkm: [[4, 50], [6, 80], [8, 120]],
  hotel_load_w: 50,
  motor_max_power_w: 1164,
  pv_kwp: 1.0,
  pv_derating: 0.85,
  battery_capacity_kwh: 2.56,
};

// P = 10v + 2v^3 at four speeds; first block is settling and discarded,
// so include a throwaway leading block.
const GOOD_LOG = telemetryCsv([
  [4, 168], [4, 168], [5, 300], [6, 492], [7, 756],
]);

test('parseTelemetryRows reads the telemetry columns and skips bad rows',
     () => {
  const rows = parseTelemetryRows(
      'timestamp_ms,speed_kmh,motor_estimated_power_w\n' +
      '1000,5.0,400\nnot,a,row\n2000,5.1,410');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].t_s, 1);
  assert.equal(rows[1].powerW, 410);
});

test('parseTelemetryRows rejects unusable logs', () => {
  assert.equal(parseTelemetryRows(''), null);
  assert.equal(parseTelemetryRows('a,b,c\n1,2,3'), null); // wrong header
  assert.equal(parseTelemetryRows(
      'timestamp_ms,speed_kmh,motor_estimated_power_w\nx,y,z'), null);
});

test('learnFromTelemetry refits the curve and calibrates from residuals',
     () => {
  const vessel = vesselFromProfile(PROFILE);
  const out = learnFromTelemetry(vessel, GOOD_LOG);
  assert.equal(out.ok, true);
  assert.equal(out.report.blocks, 4);
  assert.equal(out.vessel.voyages, 1);
  assert.equal(out.vessel.relErrors.length, 4);
  // The refit curve reproduces the log's law, not the profile seed.
  assert.ok(Math.abs(hullPowerW(out.vessel.curve, 6) - 492) < 15);
  // Original model untouched (pure function).
  assert.equal(vessel.voyages, 0);
  assert.equal(vessel.relErrors.length, 0);
});

test('learnFromTelemetry flags sustained more-power drift', () => {
  const vessel = { ...vesselFromProfile(PROFILE),
                   curve: { b1: 10, b3: 2 } };
  // Boat consistently needs 50% more power than the model predicts.
  const fouled = telemetryCsv([
    [4, 252], [4, 252], [5, 450], [6, 738], [7, 1134],
  ]);
  const out = learnFromTelemetry(vessel, fouled);
  assert.equal(out.ok, true);
  assert.equal(out.report.drift, 1);
});

test('learnFromTelemetry refuses logs without enough steady evidence',
     () => {
  const vessel = vesselFromProfile(PROFILE);
  const bad = learnFromTelemetry(vessel, 'garbage');
  assert.equal(bad.ok, false);
  assert.ok(bad.reason.includes('no usable telemetry'));
  const short = learnFromTelemetry(vessel, telemetryCsv([[4, 168], [5, 300]]));
  assert.equal(short.ok, false);
  assert.ok(short.reason.includes('steady block'));
});

test('learnFromTelemetry with a blank model fits without residuals', () => {
  const blank = { curve: { b1: 0, b3: 0 }, relErrors: [], voyages: 0 };
  const out = learnFromTelemetry(blank, GOOD_LOG);
  assert.equal(out.ok, true);
  assert.equal(out.vessel.relErrors.length, 0); // no prediction to score
  assert.ok(out.vessel.curve.b3 > 0);
});

test('learnFromTelemetry caps the residual history', () => {
  const vessel = { ...vesselFromProfile(PROFILE),
                   relErrors: new Array(MAX_REL_ERRORS).fill(0.01) };
  const out = learnFromTelemetry(vessel, GOOD_LOG);
  assert.equal(out.vessel.relErrors.length, MAX_REL_ERRORS);
});

test('saveVessel/loadVessel round-trip through storage', () => {
  const storage = makeStorage();
  const vessel = vesselFromProfile(PROFILE);
  assert.equal(saveVessel(storage, vessel), true);
  const back = loadVessel(storage, PROFILE);
  assert.deepEqual(back.curve, vessel.curve);
});

test('loadVessel falls back to the profile seed on any bad state', () => {
  const seed = vesselFromProfile(PROFILE);
  // Empty storage.
  assert.deepEqual(loadVessel(makeStorage(), PROFILE).curve, seed.curve);
  // Corrupt JSON.
  assert.deepEqual(
      loadVessel(makeStorage({ [VESSEL_STORAGE_KEY]: '{nope' }),
                 PROFILE).curve,
      seed.curve);
  // Wrong shape.
  assert.deepEqual(
      loadVessel(makeStorage({ [VESSEL_STORAGE_KEY]:
                               JSON.stringify({ curve: { b1: -1 } }) }),
                 PROFILE).curve,
      seed.curve);
  // Storage that throws (private mode).
  const throwing = { getItem() { throw new Error('blocked'); },
                     setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadVessel(throwing, PROFILE).curve, seed.curve);
  assert.equal(saveVessel(throwing, seed), false);
});
