import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearSkyForecast } from '../js/forecast.js';
import {
  fitCurveFromTelemetryCsv,
  maxRangeEstimateKm,
  planTrip,
} from '../js/planner.js';
import { DEFAULT_PROFILE } from '../js/profile.js';

const JUNE = new Date(Date.UTC(2026, 5, 21));
const sunnyDays = (days) => clearSkyForecast(43.5, 16.44, JUNE, days);

test('solar-float plan: a modest trip fits on a clear June day', () => {
  const { steps, summary } = planTrip(DEFAULT_PROFILE,
                                      { distanceKm: 30, days: 2 },
                                      sunnyDays(2));
  assert.equal(steps.length, 48);
  assert.ok(summary.tripFits, `covered ${summary.distanceCoveredKm}`);
  assert.ok(summary.arrivalTime instanceof Date);
  assert.ok(summary.finalSocPct > 60);
  assert.ok(summary.minSocPct > 25);
  assert.equal(summary.perDay.length, 2);
  assert.ok(summary.perDay[0].distanceKm > 20);
  assert.ok(summary.pvKwh > 5);
});

test('solar-float plan: an absurd distance does not fit', () => {
  const { summary } = planTrip(DEFAULT_PROFILE,
                               { distanceKm: 500, days: 2 }, sunnyDays(2));
  assert.equal(summary.tripFits, false);
  assert.equal(summary.arrivalTime, null);
  assert.ok(summary.distanceCoveredKm < 150);
});

test('cruising stops after arrival; battery recovers while moored', () => {
  const { steps, summary } = planTrip(DEFAULT_PROFILE,
                                      { distanceKm: 10, days: 1 },
                                      sunnyDays(1));
  assert.ok(summary.tripFits);
  const after = steps.filter((s) => s.time > summary.arrivalTime &&
                                    s.motorW > 0);
  assert.equal(after.length, 0);
  assert.ok(summary.finalSocPct > 85); // afternoon sun refills the battery
});

test('fixed-speed plan burns battery and respects the reserve', () => {
  const opt = { distanceKm: 300, days: 1, mode: 'fixed', fixedSpeedKmh: 6.5,
                startSocPct: 60, reserveSocPct: 40, headwindMs: 0 };
  const { steps, summary } = planTrip(DEFAULT_PROFILE, opt, sunnyDays(1));
  assert.equal(summary.tripFits, false);
  // Reserve floor: propulsion never drags SOC meaningfully below the
  // reserve while cruising. (Overnight the hotel load still drains the
  // battery — the floor governs the motor, not the fridge, exactly like
  // the firmware.)
  const cruisingMin = Math.min(
      ...steps.filter((s) => s.cruising).map((s) => s.socPct));
  assert.ok(cruisingMin > opt.reserveSocPct - 1.5,
            `min cruising SOC ${cruisingMin}`);
  // After hitting the floor the boat keeps moving on solar (slower).
  const lateCruise = steps.filter((s) => s.cruising &&
                                         s.socPct <= opt.reserveSocPct + 2);
  assert.ok(lateCruise.some((s) => s.speedKmh > 0 && s.speedKmh < 6.0));
});

test('headwind slows the solar-float boat', () => {
  const calm = planTrip(DEFAULT_PROFILE, { distanceKm: 500, days: 1 },
                        sunnyDays(1)).summary;
  const windy = planTrip(DEFAULT_PROFILE, { distanceKm: 500, days: 1 },
                         sunnyDays(1).map((h) => ({ ...h, windMs: 8 })))
      .summary;
  assert.ok(windy.distanceCoveredKm < calm.distanceCoveredKm);
});

test('fixed-speed plan costs more into a headwind', () => {
  const opt = { distanceKm: 20, days: 1, mode: 'fixed', fixedSpeedKmh: 5 };
  const calm = planTrip(DEFAULT_PROFILE, opt, sunnyDays(1)).summary;
  const windy = planTrip(DEFAULT_PROFILE, opt,
                         sunnyDays(1).map((h) => ({ ...h, windMs: 8 })))
      .summary;
  assert.ok(windy.motorKwh > calm.motorKwh);
});

test('a monster PV array saturates at motor max power', () => {
  const big = { ...DEFAULT_PROFILE, pv_kwp: 6 };
  const { steps } = planTrip(big, { distanceKm: 500, days: 1 }, sunnyDays(1));
  const peak = Math.max(...steps.map((s) => s.motorW));
  assert.ok(peak <= big.motor_max_power_w + 1e-9);
  assert.ok(peak > big.motor_max_power_w - 60);
});

test('fitCurveFromTelemetryCsv rejects unusable input', () => {
  assert.equal(fitCurveFromTelemetryCsv(''), null);
  assert.equal(fitCurveFromTelemetryCsv('a,b\n1,2'), null); // wrong headers
  const header = 'speed_kmh,motor_estimated_power_w';
  assert.equal(fitCurveFromTelemetryCsv(header), null);     // no rows
  // Rows exist but all idle/drifting -> no bins survive.
  const idle = [header, '0.5,5', '0.8,3', '0.2,0'].join('\n');
  assert.equal(fitCurveFromTelemetryCsv(idle), null);
  // One healthy bin is still not a curve (need >= 2 points).
  const oneBin = [header,
                  ...Array(8).fill('5.0,600')].join('\n');
  assert.equal(fitCurveFromTelemetryCsv(oneBin), null);
});

test('fitCurveFromTelemetryCsv learns a plausible curve', () => {
  const header = 'timestamp_ms,speed_kmh,motor_estimated_power_w';
  const rows = [header.replace('timestamp_ms,', '') // exercise header search
  ];
  const lines = ['timestamp_ms,speed_kmh,motor_estimated_power_w'];
  let t = 0;
  for (const [speed, watts] of [[4.0, 380], [5.0, 600], [6.0, 1050]]) {
    for (let i = 0; i < 10; i++) {
      lines.push(`${t++},${(speed + (i % 3) * 0.05).toFixed(2)},` +
                 `${watts + i * 4}`);
    }
  }
  lines.push(`${t++},2.2,120`); // sparse bin (< 5 samples) gets dropped
  const curve = fitCurveFromTelemetryCsv(lines.join('\n'));
  assert.ok(curve && curve.length === 3, JSON.stringify(curve));
  assert.equal(curve[0][0], 4.0);
  assert.ok(Math.abs(curve[1][1] - 120) < 8); // ~600 W / 5 km/h
  assert.ok(rows.length === 1); // (silence unused warning)
});

test('maxRangeEstimateKm is energy-limited for a small battery+array', () => {
  const est = maxRangeEstimateKm(DEFAULT_PROFILE,
                                 { startSocPct: 90, reserveSocPct: 25,
                                   days: 1 },
                                 sunnyDays(1));
  assert.ok(est > 30 && est < 120, `estimate ${est}`);
});

test('maxRangeEstimateKm is time-limited when energy is huge', () => {
  const monster = { ...DEFAULT_PROFILE, battery_capacity_kwh: 500 };
  const est = maxRangeEstimateKm(monster,
                                 { startSocPct: 100, reserveSocPct: 0,
                                   days: 1 },
                                 sunnyDays(1));
  // 12 cruise hours x 3 km/h best-efficiency speed.
  assert.ok(Math.abs(est - 36) < 1e-6, `estimate ${est}`);
});

test('empty battery margin yields PV-only range', () => {
  const est = maxRangeEstimateKm(DEFAULT_PROFILE,
                                 { startSocPct: 20, reserveSocPct: 25,
                                   days: 1 },
                                 sunnyDays(1));
  assert.ok(est > 0);
});
