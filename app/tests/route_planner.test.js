import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_PLAN_OPTIONS,
  aeroExtraW,
  arrivalSocQuantiles,
  bearingDeg,
  groundSpeedKmh,
  haversineKm,
  planLedger,
  planVoyage,
  segmentRoute,
  solveStwKmh,
  waveExtraW,
} from '../js/route_planner.js';
import { vesselFromProfile } from '../js/vessel_model.js';

const PROFILE = {
  hull_efficiency_curve_kmh_whkm: [[4, 50], [6, 80], [8, 120]],
  hotel_load_w: 50,
  motor_max_power_w: 1164,
  pv_kwp: 1.0,
  pv_derating: 0.85,
  battery_capacity_kwh: 2.56,
};
const VESSEL = vesselFromProfile(PROFILE);

const CALM = {
  ghiWm2: 800, windMs: 0, windDirDeg: 0,
  waveHsM: 0, waveDirDeg: 0, currentMs: 0, currentDirDeg: 0,
};
const NIGHT = { ...CALM, ghiWm2: 0 };
const DEPART = new Date(Date.UTC(2026, 5, 21, 8, 0));

test('haversineKm and bearingDeg match known geometry', () => {
  assert.equal(haversineKm(43.5, 16.4, 43.5, 16.4), 0);
  assert.ok(Math.abs(haversineKm(0, 0, 0, 1) - 111.19) < 0.5);
  assert.ok(Math.abs(bearingDeg(0, 0, 1, 0) - 0) < 1e-9);   // due north
  assert.ok(Math.abs(bearingDeg(0, 0, 0, 1) - 90) < 1e-9);  // due east
  assert.ok(Math.abs(bearingDeg(1, 0, 0, 0) - 180) < 1e-9); // due south
});

test('segmentRoute splits legs and inherits anchorable from leg starts', () => {
  const wps = [
    { lat: 43.5, lon: 16.4, anchorable: true },
    { lat: 43.54, lon: 16.4, anchorable: true }, // ~4.45 km north
    { lat: 43.55, lon: 16.4 },                   // short second leg
  ];
  const segs = segmentRoute(wps);
  const total = segs.reduce((a, s) => a + s.lengthKm, 0);
  assert.ok(Math.abs(total - haversineKm(43.5, 16.4, 43.54, 16.4)
                           - haversineKm(43.54, 16.4, 43.55, 16.4)) < 1e-9);
  assert.ok(segs.every((s) => s.lengthKm <= 2.0 + 1e-9));
  assert.equal(segs[0].anchorable, true);   // leg-1 start
  assert.equal(segs[1].anchorable, false);  // interior split point
  const leg2Start = segs.findIndex((s, i) => i > 0 && s.anchorable);
  assert.ok(leg2Start > 0); // second leg's start kept its anchorable flag
  assert.ok(Math.abs(segs[0].bearing - 0) < 0.5); // due north
});

test('groundSpeedKmh handles crab, fair current, and unstemmable water', () => {
  assert.equal(groundSpeedKmh(5, 0, 0, 0), 5); // no current
  // Fair current straight down-track (dir TO = bearing): adds fully.
  assert.ok(Math.abs(groundSpeedKmh(5, 0, 1, 0) - 8.6) < 1e-9);
  // Pure cross-current: crab eats part of STW.
  const crab = groundSpeedKmh(5, 0, 1, 90);
  assert.ok(crab > 3 && crab < 5);
  // Cross-current too strong to stem at all.
  assert.equal(groundSpeedKmh(2, 0, 1, 90), 0);
  // Opposing current stronger than STW: negative SOG clamps to 0.
  assert.equal(groundSpeedKmh(5, 0, 2, 180), 0);
});

test('aeroExtraW: headwind costs, strong tailwind costs nothing', () => {
  const head = aeroExtraW(5, 5, 0, 0); // wind FROM dead ahead
  assert.ok(head > 0);
  assert.equal(aeroExtraW(5, 5, 180, 0), 0); // tailwind faster than boat
  const cross = aeroExtraW(5, 5, 90, 0); // pure crosswind: only boat speed
  assert.ok(cross > 0 && cross < head);
});

test('waveExtraW: head seas cost, following seas are free (V1 floor)', () => {
  assert.ok(waveExtraW(5, 1, 0, 0) > 0);
  assert.equal(waveExtraW(5, 1, 180, 0), 0);
  assert.ok(waveExtraW(5, 2, 0, 0) > 3 * waveExtraW(5, 1, 0, 0)); // ~Hs^2
});

test('solveStwKmh converges and collapses under overwhelming headwind', () => {
  const calm = solveStwKmh(VESSEL, 500, CALM, 0);
  assert.ok(calm > 4 && calm < 9);
  const windy = solveStwKmh(VESSEL, 500,
                            { ...CALM, windMs: 8, windDirDeg: 0 }, 0);
  assert.ok(windy < calm);
  const stalled = solveStwKmh(VESSEL, 100,
                              { ...CALM, windMs: 15, windDirDeg: 0 }, 0);
  assert.equal(stalled, 0);
});

const ROUTE = segmentRoute([
  { lat: 43.5, lon: 16.4, anchorable: true },
  { lat: 43.52, lon: 16.4, anchorable: true },
  { lat: 43.54, lon: 16.4 },
]);

test('planVoyage finds a feasible sunny-day plan with a consistent chain',
     () => {
  const r = planVoyage(VESSEL, ROUTE, () => CALM, DEPART,
                       { windowH: 12, timeStepMin: 10 });
  assert.equal(r.feasible, true);
  assert.ok(r.arrivalRow.length > 0);
  const S = ROUTE.length;
  // Plan is a contiguous chain from (0,0) to the destination.
  assert.equal(r.plan[0].fromS, 0);
  assert.equal(r.plan[0].tStart, 0);
  assert.equal(r.plan[r.plan.length - 1].toS, S);
  for (let i = 1; i < r.plan.length; i++) {
    assert.equal(r.plan[i].fromS, r.plan[i - 1].toS);
    assert.equal(r.plan[i].tStart, r.plan[i - 1].tEnd);
  }
  for (const st of r.plan) {
    if (!st.wait) {
      assert.ok(st.socAfterPct >= DEFAULT_PLAN_OPTIONS.reserveSocPct);
      assert.ok(st.sogKmh > 0);
    }
  }
  assert.ok(Math.abs(r.summary.distanceKm -
                     haversineKm(43.5, 16.4, 43.54, 16.4)) < 0.01);
  assert.ok(r.summary.arrivalSocPct > 25);
  assert.ok(r.summary.arrivalTimeMs > DEPART.getTime());
  assert.equal(typeof r.summary.solarStopBuckets, 'number');
  assert.equal(r.summary.departureDelayH,
               r.summary.bestDepartureBucket * (10 / 60));
});

test('planVoyage objective earliest picks the first adequate arrival', () => {
  const maxSoc = planVoyage(VESSEL, ROUTE, () => CALM, DEPART,
                            { windowH: 12, objective: 'maxSoc' });
  const earliest = planVoyage(VESSEL, ROUTE, () => CALM, DEPART,
                              { windowH: 12, objective: 'earliest',
                                requiredArrivalSocPct: 30 });
  assert.ok(earliest.summary.arrivalTimeMs <= maxSoc.summary.arrivalTimeMs);
  assert.ok(earliest.summary.arrivalSocPct >= 30);
  // No arrival meets an impossible requirement: falls back to best SOC.
  const fallback = planVoyage(VESSEL, ROUTE, () => CALM, DEPART,
                              { windowH: 12, objective: 'earliest',
                                requiredArrivalSocPct: 101 });
  assert.equal(fallback.summary.arrivalSocPct, maxSoc.summary.arrivalSocPct);
});

test('planVoyage reports infeasible when the window is too short', () => {
  const r = planVoyage(VESSEL, ROUTE, () => CALM, DEPART,
                       { windowH: 0.2, timeStepMin: 10 });
  assert.equal(r.feasible, false);
  assert.equal(r.plan, null);
  assert.deepEqual(r.arrivalRow, []);
  assert.ok(r.summary.reason.includes('unreachable'));
});

test('planVoyage refuses ways the boat cannot make against the current',
     () => {
  const adverse = { ...CALM, currentMs: 3.5, currentDirDeg: 180 }; // vs north
  const r = planVoyage(VESSEL, ROUTE, () => adverse, DEPART, { windowH: 6 });
  assert.equal(r.feasible, false);
});

test('planVoyage never plans through the reserve floor', () => {
  // Night, tiny margin above reserve: every move would breach it.
  const r = planVoyage(VESSEL, ROUTE, () => NIGHT, DEPART,
                       { windowH: 6, startSocPct: 27, reserveSocPct: 25 });
  assert.equal(r.feasible, false);
});

test('planVoyage: a geographic power penalty costs SOC or time', () => {
  const dim = { ...CALM, ghiWm2: 200 };
  const base = planVoyage(VESSEL, ROUTE, () => dim, DEPART, { windowH: 12 });
  const penalized = planVoyage(VESSEL, ROUTE, () => dim, DEPART,
                               { windowH: 12,
                                 segPowerFactor: () => 1.3 });
  assert.equal(penalized.feasible, true);
  // 30% of drawn power lost to the local penalty: strictly worse plan.
  assert.ok(penalized.summary.arrivalSocPct <= base.summary.arrivalSocPct);
  assert.ok(penalized.summary.arrivalTimeMs >= base.summary.arrivalTimeMs ||
            penalized.summary.arrivalSocPct < base.summary.arrivalSocPct);
});

test('planLedger buckets plan energy into a consistent daily ledger',
     () => {
  const dim = { ...CALM, ghiWm2: 300 };
  const envAt = () => dim;
  const r = planVoyage(VESSEL, ROUTE, envAt, DEPART, { windowH: 12 });
  const ledger = planLedger(VESSEL, ROUTE, r.plan, envAt);
  assert.ok(ledger.length >= 1);
  const total = ledger.reduce((a, d) => a + d.distanceKm, 0);
  assert.ok(Math.abs(total - r.summary.distanceKm) < 0.01);
  for (const d of ledger) {
    assert.ok(d.solarKwh >= 0);
    assert.ok(d.hotelKwh > 0);
    assert.ok(Math.abs(d.netKwh -
                       (d.solarKwh - d.propKwh - d.hotelKwh)) < 1e-9);
  }
  assert.ok(ledger[0].propKwh > 0);
});

test('arrivalSocQuantiles brackets the nominal arrival SOC', () => {
  // Overcast so the boat arrives below 100% and both bounds have room.
  const dim = { ...CALM, ghiWm2: 200 };
  const r = planVoyage(VESSEL, ROUTE, () => dim, DEPART, { windowH: 12 });
  const q = arrivalSocQuantiles(VESSEL, r.plan, r.summary,
                                { p10: -0.2, p50: 0, p90: 0.25,
                                  calibrated: false });
  assert.equal(q.expectedPct, r.summary.arrivalSocPct);
  assert.ok(q.conservativePct < q.expectedPct);
  assert.ok(q.optimisticPct > q.expectedPct);
  assert.equal(q.calibrated, false);
  // Explicit step size gives the same result as the matching default.
  const q10 = arrivalSocQuantiles(VESSEL, r.plan, r.summary,
                                  { p10: -0.2, p50: 0, p90: 0.25,
                                    calibrated: true }, 10);
  assert.equal(q10.conservativePct, q.conservativePct);
  assert.equal(q10.calibrated, true);
  // Extreme quantiles clamp to [0, 100].
  const ext = arrivalSocQuantiles(VESSEL, r.plan, r.summary,
                                  { p10: -50, p50: 0, p90: 50,
                                    calibrated: true });
  assert.equal(ext.conservativePct, 0);
  assert.equal(ext.optimisticPct, 100);
});
