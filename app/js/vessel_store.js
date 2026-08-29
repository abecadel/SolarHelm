// Vessel-model learning loop: telemetry log in, better vessel model out.
//
// Closes the loop described in docs/ADAPTIVE_ENERGY_MODEL_RESEARCH.md with
// the machinery from vessel_model.js: steady-block gating -> residuals
// against the current model (relErrors + CUSUM drift verdict) -> NNLS
// refit -> recalibrated error quantiles. Persisted as JSON in
// localStorage; every function is pure apart from the explicit
// save/load pair.

import {
  CusumDrift,
  detectSteadyBlocks,
  errorQuantiles,
  fitHullCurveNNLS,
  hullPowerW,
  vesselFromProfile,
} from './vessel_model.js';

export const VESSEL_STORAGE_KEY = 'solarhelm.vessel_model.v1';
export const MAX_REL_ERRORS = 200;

/** Parses the SolarHelm telemetry CSV into learning rows
 *  [{t_s, speedKmh, powerW}]; null when the format is unusable. */
export function parseTelemetryRows(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].split(',');
  const iT = header.indexOf('timestamp_ms');
  const iSpeed = header.indexOf('speed_kmh');
  const iMotor = header.indexOf('motor_estimated_power_w');
  if (iT < 0 || iSpeed < 0 || iMotor < 0) return null;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const t = parseFloat(c[iT]);
    const v = parseFloat(c[iSpeed]);
    const p = parseFloat(c[iMotor]);
    if (!Number.isFinite(t) || !Number.isFinite(v) ||
        !Number.isFinite(p)) continue;
    rows.push({ t_s: t / 1000, speedKmh: v, powerW: p });
  }
  return rows.length > 0 ? rows : null;
}

/**
 * One learning pass over a telemetry log. Returns {ok:false, reason} when
 * the log yields too little trustworthy data (the model is left alone), or
 * {ok:true, vessel, report} with the updated model and a report:
 * {blocks, drift, quantiles, curve}. drift: +1 the boat needs more power
 * than modelled (fouling?), -1 less, 0 no drift detected.
 */
export function learnFromTelemetry(vessel, csvText, opts = {}) {
  const rows = parseTelemetryRows(csvText);
  if (!rows) {
    return { ok: false,
             reason: 'no usable telemetry rows (need timestamp_ms, ' +
                     'speed_kmh, motor_estimated_power_w columns)' };
  }
  const blocks = detectSteadyBlocks(rows, opts);
  if (blocks.length < 3) {
    return { ok: false,
             reason: `only ${blocks.length} steady block(s) in the log ` +
                     '(need 3) - hold power steady for longer stretches' };
  }
  // Residuals against the model as it was BEFORE this log (honest
  // prediction-vs-actual), then refit including the new evidence.
  const relErrors = vessel.relErrors.slice();
  const cusum = new CusumDrift();
  let drift = 0;
  for (const b of blocks) {
    const pred = hullPowerW(vessel.curve, b.stwKmh);
    if (pred > 50) {
      const rel = (b.powerW - pred) / pred;
      relErrors.push(rel);
      drift = cusum.update(rel);
    }
  }
  while (relErrors.length > MAX_REL_ERRORS) relErrors.shift();
  const samples = blocks.map((b) => ({ stwKmh: b.stwKmh, powerW: b.powerW,
                                       weight: b.n }));
  const curve = fitHullCurveNNLS(samples);
  const quantiles = errorQuantiles(relErrors);
  const next = { ...vessel, curve, relErrors,
                 voyages: vessel.voyages + 1 };
  return { ok: true, vessel: next,
           report: { blocks: blocks.length, drift, quantiles, curve } };
}

export function saveVessel(storage, vessel) {
  try {
    storage.setItem(VESSEL_STORAGE_KEY, JSON.stringify(vessel));
    return true;
  } catch (err) {
    return false;
  }
}

/** Loads the stored vessel model, falling back to the profile seed on any
 *  missing/invalid/unreadable state (never throws). */
export function loadVessel(storage, profile) {
  const fallback = vesselFromProfile(profile);
  let stored = null;
  try {
    stored = storage.getItem(VESSEL_STORAGE_KEY);
  } catch (err) {
    return fallback;
  }
  if (!stored) return fallback;
  try {
    const v = JSON.parse(stored);
    if (!v || !v.curve || !(v.curve.b1 >= 0) || !(v.curve.b3 >= 0) ||
        !Array.isArray(v.relErrors)) {
      return fallback;
    }
    return { ...fallback, ...v };
  } catch (err) {
    return fallback;
  }
}
