// Model tab: everything the boat has learned, in one place — the hull
// curve with the recommended cruise band (EnergyKnee), the solar
// equilibrium speed, calibration state, drift, and the stores collected
// so far. The learn-from-CSV input lives here.

import {
  GEO_STORAGE_KEY,
  geoUpdate,
  loadGeoStore,
  saveGeoStore,
} from './geo_residuals.js';
import { PROVIDER_STATS_KEY, loadProviderStats } from './provider_stats.js';
import {
  VESSEL_STORAGE_KEY,
  learnFromTelemetry,
  saveVessel,
} from './vessel_store.js';
import {
  CusumDrift,
  cruiseBandKmh,
  errorQuantiles,
  hullPowerW,
  hullSpeedKmh,
  vesselFromProfile,
} from './vessel_model.js';

function num(doc, id, fallback) {
  const v = parseFloat(doc.getElementById(id).value);
  return Number.isFinite(v) ? v : fallback;
}

/** Re-renders the whole tab from current state. Exported for tests and
 *  for refresh-on-tab-show. */
export function refreshModel(deps, state) {
  const doc = deps.doc;
  const vessel = state.vessel ?? vesselFromProfile(state.profile);
  const hotelW = vessel.hotelW ?? 0; // tolerate minimal stored models
  const band = cruiseBandKmh(vessel.curve, hotelW);
  const q = errorQuantiles(vessel.relErrors);
  const drift = new CusumDrift();
  let verdict = 0;
  for (const r of vessel.relErrors) verdict = drift.update(r);

  const rows = [];
  for (let v = 3; v <= 9; v += 1) {
    const w = hullPowerW(vessel.curve, v);
    const inBand = v >= Math.floor(band.bestKmh) && v <= band.kneeKmh;
    rows.push(`<tr${inBand ? ' style="font-weight:700"' : ''}>` +
              `<td>${v} km/h</td><td>${w.toFixed(0)} W</td>` +
              `<td>${(w / v).toFixed(0)} Wh/km</td></tr>`);
  }

  const pvW = num(doc, 'model-pv', 800);
  const eqKmh = hullSpeedKmh(vessel.curve, pvW - hotelW);

  const geoBins = Object.keys(loadGeoStore(deps.storage).bins).length;
  const provEntries =
      Object.keys(loadProviderStats(deps.storage).entries).length;

  doc.getElementById('model-summary').innerHTML = `
    <div class="cards">
      <div class="card"><b>${vessel.voyages}</b><span>voyages learned</span></div>
      <div class="card"><b>${vessel.relErrors.length}</b>
        <span>scored blocks</span></div>
      <div class="card"><b>${q.calibrated ? 'calibrated' : 'defaults'}</b>
        <span>error p10..p90 ${(q.p10 * 100).toFixed(0)}..${
          (q.p90 * 100).toFixed(0)}%</span></div>
      <div class="card"><b>${verdict === 0 ? 'none'
          : verdict > 0 ? 'MORE power' : 'less power'}</b>
        <span>drift (CUSUM)</span></div>
      <div class="card"><b>${geoBins}</b><span>geo bias bins</span></div>
      <div class="card"><b>${provEntries}</b>
        <span>provider stats</span></div>
    </div>
    <div class="cards">
      <div class="card"><b>${eqKmh.toFixed(1)} km/h</b>
        <span>solar equilibrium at ${pvW.toFixed(0)} W PV − ${
          hotelW.toFixed(0)} W hotel</span></div>
      <div class="card"><b>${band.bestKmh.toFixed(1)}–${
          band.kneeKmh.toFixed(1)} km/h</b>
        <span>recommended cruise band (knee)</span></div>
      <div class="card"><b>P = ${vessel.curve.b1.toFixed(1)}·v + ${
          vessel.curve.b3.toFixed(2)}·v³</b>
        <span>learned hull curve</span></div>
    </div>
    <table class="days"><tr><th>speed</th><th>power</th><th>Wh/km</th></tr>
      ${rows.join('')}</table>`;
}

export function applyModelLearning(deps, state, csvText) {
  const doc = deps.doc;
  const vessel = state.vessel ?? vesselFromProfile(state.profile);
  const out = learnFromTelemetry(vessel, csvText);
  if (!out.ok) {
    doc.getElementById('model-learn-status').textContent =
        `Nothing learned: ${out.reason}`;
    return false;
  }
  state.vessel = out.vessel;
  saveVessel(deps.storage, out.vessel);
  // Positioned residuals feed the geographic bias store: places where
  // this boat consistently needs more (or less) power than modelled.
  if (out.report.positioned.length > 0) {
    const geo = loadGeoStore(deps.storage);
    for (const p of out.report.positioned) {
      geoUpdate(geo, p.lat, p.lon, p.rel);
    }
    saveGeoStore(deps.storage, geo);
  }
  doc.getElementById('model-learn-status').textContent =
      (out.report.revisionBranched
        ? `New configuration revision ${out.vessel.configRevision} in ` +
          'this log — residual history reset (a refit is a new boat). '
        : '') +
      `Learned from ${out.report.blocks} steady blocks — voyage ` +
      `#${out.vessel.voyages}` +
      (out.report.positioned.length > 0
        ? ` (${out.report.positioned.length} positioned for the geo map).`
        : '.') +
      (out.report.drift > 0
        ? ' DRIFT: the boat needs more power than modelled - check hull ' +
          'fouling/prop.'
        : out.report.drift < 0 ? ' Drift: the boat runs easier than modelled.'
                               : '');
  refreshModel(deps, state);
  return true;
}

export function initModel(deps, state) {
  const doc = deps.doc;
  doc.getElementById('model-csv').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    applyModelLearning(deps, state, await file.text());
  });
  doc.getElementById('model-pv').addEventListener('change',
      () => refreshModel(deps, state));
  doc.getElementById('model-reset').addEventListener('click', () => {
    try {
      deps.storage.removeItem(VESSEL_STORAGE_KEY);
      deps.storage.removeItem(GEO_STORAGE_KEY);
      deps.storage.removeItem(PROVIDER_STATS_KEY);
    } catch (err) { /* storage unavailable: nothing to clear */ }
    state.vessel = vesselFromProfile(state.profile);
    doc.getElementById('model-learn-status').textContent =
        'Model reset to the profile seed; stores cleared.';
    refreshModel(deps, state);
  });
  refreshModel(deps, state);
}
