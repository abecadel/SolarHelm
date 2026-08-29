// VesselModel — the boat-specific learned energy model
// (docs/ADAPTIVE_ENERGY_MODEL_RESEARCH.md).
//
// Physics + calibration + residual, no black boxes:
//   - calm-water hull curve: NNLS fit of P = b1*v + b3*v^3 (b >= 0) —
//     monotone and convex by construction, sane extrapolation
//   - steady-state block gating before any sample is trusted
//   - CUSUM drift detection on relative residuals
//   - calibrated error quantiles (split-conformal style) for intervals
//
// All pure functions/classes; the PWA persists model state as JSON.

/** Non-negative least squares for P = b1*v + b3*v^3 on samples
 *  [{stwKmh, powerW, weight?}]. Projected coordinate descent — tiny,
 *  deterministic, dependency-free. Returns {b1, b3}. */
export function fitHullCurveNNLS(samples, iterations = 200) {
  let b1 = 0;
  let b3 = 0;
  if (samples.length === 0) return { b1, b3 };
  for (let it = 0; it < iterations; it++) {
    // Coordinate-wise exact minimization with clamping at 0.
    let num1 = 0, den1 = 0;
    for (const s of samples) {
      const w = s.weight ?? 1;
      const r = s.powerW - b3 * s.stwKmh ** 3;
      num1 += w * s.stwKmh * r;
      den1 += w * s.stwKmh * s.stwKmh;
    }
    b1 = den1 > 0 ? Math.max(0, num1 / den1) : 0;
    let num3 = 0, den3 = 0;
    for (const s of samples) {
      const w = s.weight ?? 1;
      const v3 = s.stwKmh ** 3;
      const r = s.powerW - b1 * s.stwKmh;
      num3 += w * v3 * r;
      den3 += w * v3 * v3;
    }
    b3 = den3 > 0 ? Math.max(0, num3 / den3) : 0;
  }
  return { b1, b3 };
}

/** Predicted electrical propulsion power (W) at speed-through-water. */
export function hullPowerW(curve, stwKmh) {
  if (stwKmh <= 0) return 0;
  return curve.b1 * stwKmh + curve.b3 * stwKmh ** 3;
}

/** Inverse: STW achievable at a given power (bisection; curve monotone). */
export function hullSpeedKmh(curve, powerW) {
  if (powerW <= 0 || (curve.b1 === 0 && curve.b3 === 0)) return 0;
  let lo = 0;
  let hi = 30;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (hullPowerW(curve, mid) < powerW) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** PAVA isotonic regression cross-check: returns monotone fitted values
 *  for samples sorted by stwKmh (used to flag model inadequacy). */
export function isotonicFit(values) {
  const level = values.slice();
  const weight = values.map(() => 1);
  let n = 0;
  const idx = [];
  for (let i = 0; i < values.length; i++) {
    level[n] = values[i];
    weight[n] = 1;
    idx[n] = i;
    n++;
    while (n > 1 && level[n - 2] > level[n - 1]) {
      const w = weight[n - 2] + weight[n - 1];
      level[n - 2] = (level[n - 2] * weight[n - 2] +
                      level[n - 1] * weight[n - 1]) / w;
      weight[n - 2] = w;
      n--;
    }
  }
  const out = [];
  let block = 0;
  for (let i = 0; i < values.length; i++) {
    if (block + 1 < n && i >= idx[block + 1]) block++;
    out.push(level[block]);
  }
  return out;
}

/** Steady-state block detector (docs/ADAPTIVE_ENERGY_MODEL_RESEARCH.md §6).
 *  rows: 1 Hz-ish [{t_s, speedKmh, powerW}]; returns accepted blocks
 *  [{stwKmh, powerW, n}] using blockS-second windows, gated on relative
 *  power variation and speed variation. Discards the first block after
 *  any block whose gate failed (settling). */
export function detectSteadyBlocks(rows, opts = {}) {
  const blockS = opts.blockS ?? 90;
  const maxPowerCv = opts.maxPowerCv ?? 0.05;
  const maxSpeedSd = opts.maxSpeedSdKmh ?? 0.3;
  const minPowerW = opts.minPowerW ?? 50;
  const blocks = [];
  let lastRejected = true; // treat start-of-log as unsettled
  for (let start = 0; start < rows.length;) {
    const t0 = rows[start].t_s;
    let end = start;
    while (end < rows.length && rows[end].t_s - t0 < blockS) end++;
    const n = end - start;
    if (n < Math.max(10, blockS / 3)) break; // tail too short
    let sumP = 0, sumV = 0;
    for (let i = start; i < end; i++) {
      sumP += rows[i].powerW;
      sumV += rows[i].speedKmh;
    }
    const meanP = sumP / n;
    const meanV = sumV / n;
    let varP = 0, varV = 0;
    for (let i = start; i < end; i++) {
      varP += (rows[i].powerW - meanP) ** 2;
      varV += (rows[i].speedKmh - meanV) ** 2;
    }
    const cvP = meanP > 0 ? Math.sqrt(varP / n) / meanP : 1;
    const sdV = Math.sqrt(varV / n);
    const ok = meanP >= minPowerW && meanV > 1.0 && cvP <= maxPowerCv &&
               sdV <= maxSpeedSd;
    if (ok && !lastRejected) {
      blocks.push({ stwKmh: meanV, powerW: meanP, n });
    }
    lastRejected = !ok;
    start = end;
  }
  return blocks;
}

/** CUSUM drift detector on relative residuals (vessel-performance drift).
 *  Positive drift = boat needs more power than the model predicts. */
export class CusumDrift {
  constructor(kAllowance = 0.03, hThreshold = 0.5) {
    this.k = kAllowance;
    this.h = hThreshold;
    this.pos = 0;
    this.neg = 0;
    this.tripped = 0; // +1 more-power drift, -1 less-power, 0 none
  }

  /** relResidual = (measured - predicted)/predicted for one steady block. */
  update(relResidual) {
    this.pos = Math.max(0, this.pos + relResidual - this.k);
    this.neg = Math.min(0, this.neg + relResidual + this.k);
    if (this.pos > this.h) this.tripped = 1;
    else if (this.neg < -this.h) this.tripped = -1;
    return this.tripped;
  }

  reset() {
    this.pos = 0;
    this.neg = 0;
    this.tripped = 0;
  }
}

/** Calibrated error quantiles from prediction-vs-actual relative errors
 *  (split-conformal in its simplest form). */
export function errorQuantiles(relErrors) {
  if (relErrors.length === 0) {
    // Conservative defaults until the boat has history.
    return { p10: -0.25, p50: 0, p90: 0.25, calibrated: false };
  }
  const s = relErrors.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1,
                              Math.max(0, Math.floor(p * s.length)))];
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9),
           calibrated: relErrors.length >= 10 };
}

/** A complete vessel model: hull curve + hotel + PV params + quantiles.
 *  fromProfile() seeds from the shared boat profile until sea trials. */
export function vesselFromProfile(profile) {
  // Seed the NNLS curve from the profile's placeholder curve points.
  const samples = profile.hull_efficiency_curve_kmh_whkm.map(([v, whkm]) => ({
    stwKmh: v, powerW: whkm * v,
  }));
  return {
    curve: fitHullCurveNNLS(samples),
    hotelW: profile.hotel_load_w,
    motorMaxW: profile.motor_max_power_w,
    pvKwp: profile.pv_kwp,
    pvDerating: profile.pv_derating,
    batteryKwh: profile.battery_capacity_kwh,
    relErrors: [],
    voyages: 0,
  };
}
