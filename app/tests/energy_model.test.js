import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bestEfficiencySpeedKmh,
  clearSkyGhiWm2,
  powerForSpeedW,
  pvPowerW,
  solarElevationRad,
  speedForPowerKmh,
  stepSocPct,
  usableWhAboveReserve,
  whPerKmAt,
} from '../js/energy_model.js';
import { DEFAULT_PROFILE } from '../js/profile.js';

const CURVE = DEFAULT_PROFILE.hull_efficiency_curve_kmh_whkm;

test('powerForSpeedW matches curve points and interpolates', () => {
  assert.equal(powerForSpeedW(CURVE, 0), 0);
  assert.ok(Math.abs(powerForSpeedW(CURVE, 5.0) - 600) < 1e-6);
  assert.ok(Math.abs(powerForSpeedW(CURVE, 7.0) - 2002) < 1e-6);
  const mid = powerForSpeedW(CURVE, 5.35);
  assert.ok(mid > 600 && mid < 798);
  // Cubic extrapolation below/above the measured range.
  assert.ok(Math.abs(powerForSpeedW(CURVE, 1.5) - 255 * 0.125) < 1e-6);
  assert.ok(Math.abs(powerForSpeedW(CURVE, 14) - 2002 * 8) < 1e-3);
});

test('speedForPowerKmh inverts the curve', () => {
  assert.equal(speedForPowerKmh(CURVE, 0), 0);
  assert.equal(speedForPowerKmh(CURVE, -100), 0);
  assert.ok(speedForPowerKmh(CURVE, 100) < 3);
  assert.ok(speedForPowerKmh(CURVE, 3000) > 7);
  for (let v = 3; v <= 7; v += 0.4) {
    const w = powerForSpeedW(CURVE, v);
    assert.ok(Math.abs(speedForPowerKmh(CURVE, w) - v) < 0.15);
  }
});

test('whPerKmAt applies wind penalty and credit', () => {
  assert.equal(whPerKmAt(CURVE, 0), 0);
  const calm = whPerKmAt(CURVE, 5, 0);
  assert.ok(Math.abs(calm - 120) < 1e-6);
  assert.ok(whPerKmAt(CURVE, 5, 5) > calm);      // headwind costs
  assert.ok(whPerKmAt(CURVE, 5, -5) < calm);     // tailwind credits less
  assert.ok(calm - whPerKmAt(CURVE, 5, -5) < whPerKmAt(CURVE, 5, 5) - calm);
});

test('pvPowerW scales with irradiance', () => {
  assert.equal(pvPowerW(DEFAULT_PROFILE, 0), 0);
  assert.equal(pvPowerW(DEFAULT_PROFILE, -5), 0);
  assert.ok(Math.abs(pvPowerW(DEFAULT_PROFILE, 1000) - 780) < 1e-6);
});

test('solar elevation: Split at June noon high, midnight below horizon', () => {
  const june = 172;
  const noonUtc = 11; // ~solar noon for lon 16.4E
  const elev = solarElevationRad(43.5, june, noonUtc, 16.4);
  assert.ok(elev > 1.0); // ~70 degrees
  const night = solarElevationRad(43.5, june, 0, 16.4);
  assert.ok(night < 0);
});

test('clear-sky GHI is 0 below horizon and near 1000 at high sun', () => {
  assert.equal(clearSkyGhiWm2(-0.1), 0);
  assert.equal(clearSkyGhiWm2(0), 0);
  const high = clearSkyGhiWm2(1.2);
  assert.ok(high > 900 && high < 1050);
});

test('stepSocPct integrates with charge efficiency and clamps', () => {
  const soc1 = stepSocPct(DEFAULT_PROFILE, 50, 1000, 1);
  assert.ok(Math.abs(soc1 - (50 + (1000 * 0.97 / 2560) * 100)) < 1e-9);
  const soc2 = stepSocPct(DEFAULT_PROFILE, 50, -1000, 1);
  assert.ok(Math.abs(soc2 - (50 - (1000 / 2560) * 100)) < 1e-9);
  assert.equal(stepSocPct(DEFAULT_PROFILE, 99, 5000, 1), 100);
  assert.equal(stepSocPct(DEFAULT_PROFILE, 1, -5000, 1), 0);
});

test('usableWhAboveReserve', () => {
  assert.ok(Math.abs(usableWhAboveReserve(DEFAULT_PROFILE, 90, 25) -
                     0.65 * 2560) < 1e-9);
  assert.equal(usableWhAboveReserve(DEFAULT_PROFILE, 20, 25), 0);
});

test('bestEfficiencySpeedKmh finds the cheapest point', () => {
  assert.equal(bestEfficiencySpeedKmh(CURVE), 3.0);
  assert.equal(bestEfficiencySpeedKmh([[4, 100], [5, 80], [6, 90]]), 5);
});
