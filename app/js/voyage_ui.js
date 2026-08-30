// Voyage planner (planner v2) UI glue: A→B routes over the global-first
// environment layer, the learned vessel model, and the (segment, time)
// route DP. Same dependency-injection pattern as ui.js so the whole module
// runs — and is covered — under node with a stub DOM.

import { geoPowerFactor, loadGeoStore } from './geo_residuals.js';
import { initMap, waypointsToText } from './map_ui.js';
import { loadProviderStats } from './provider_stats.js';
import { getRouteEnvironment } from './providers.js';
import {
  arrivalSocQuantiles,
  planLedger,
  planVoyage,
  segmentRoute,
} from './route_planner.js';
import { errorQuantiles, vesselFromProfile } from './vessel_model.js';
import { loadVessel } from './vessel_store.js';
import { assessPlan } from './voyage_safety.js';

/** Parses the waypoint textarea: one "lat, lon[, anchor]" per line.
 *  Returns null unless at least two valid waypoints are present. */
export function parseWaypoints(text) {
  const wps = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split(',').map((p) => p.trim());
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    wps.push({
      lat, lon,
      anchorable: (parts[2] ?? '').toLowerCase() === 'anchor',
    });
  }
  return wps.length >= 2 ? wps : null;
}

/** Adapts a per-segment route environment ({envs, segToPoint} from
 *  getRouteEnvironment) to the planner's envAt(seg, hour) callback. */
export function envAtFactory(routeEnv, departTime) {
  const dead = { ghiWm2: 0, windMs: 0, windDirDeg: 0, waveHsM: 0,
                 waveDirDeg: 0, currentMs: 0, currentDirDeg: 0 };
  const { envs, segToPoint } = routeEnv;
  if (envs.length === 0 || envs[0].hours.length === 0) return () => dead;
  const offsetH =
      (departTime.getTime() - envs[0].hours[0].time.getTime()) / 3.6e6;
  return (segIdx, hourFloat) => {
    const hours = envs[segToPoint[segIdx] ?? 0].hours;
    const i = Math.round(offsetH + hourFloat);
    return hours[Math.min(hours.length - 1, Math.max(0, i))];
  };
}

function gatesHtml(gates) {
  return '<ul class="gates">' + gates.map((g) =>
      `<li class="${g.pass ? 'ok' : 'warn'}">` +
      `${g.pass ? 'PASS' : 'FAIL'} · ${g.id} — ${g.detail}</li>`).join('') +
      '</ul>';
}

function ledgerHtml(ledger) {
  if (ledger.length === 0) return '';
  const rows = ledger.map((d) =>
      `<tr><td>Day ${d.day}</td><td>${d.distanceKm.toFixed(1)} km</td>` +
      `<td>${d.solarKwh.toFixed(1)}</td><td>${d.propKwh.toFixed(1)}</td>` +
      `<td>${d.hotelKwh.toFixed(1)}</td>` +
      `<td>${d.netKwh >= 0 ? '+' : ''}${d.netKwh.toFixed(1)}</td></tr>`)
      .join('');
  return `<table class="days"><tr><th>energy [kWh]</th><th>distance</th>` +
         `<th>solar</th><th>motor</th><th>hotel</th><th>net</th></tr>` +
         `${rows}</table>`;
}

export function voyageHtml(result, assessment, socQ, ledger = []) {
  const head = `<div class="verdict ` +
      `${assessment.label === 'SAFE' ? 'ok' : 'warn'}">` +
      `${assessment.label}</div>`;
  if (!result.feasible) {
    return head + `<p>${result.summary.reason}</p>` +
           gatesHtml(assessment.gates);
  }
  const s = result.summary;
  const arrive = new Date(s.arrivalTimeMs).toISOString().slice(0, 16);
  const cards = `
    <div class="cards">
      <div class="card"><b>${s.arrivalSocPct.toFixed(0)}%</b>
        <span>arrival SOC (expected)</span></div>
      <div class="card"><b>${socQ.conservativePct.toFixed(0)}–${
        socQ.optimisticPct.toFixed(0)}%</b>
        <span>arrival SOC (p90–p10)</span></div>
      <div class="card"><b>${arrive}Z</b><span>arrival</span></div>
      <div class="card"><b>${s.departureDelayH.toFixed(1)} h</b>
        <span>wait before departing</span></div>
      <div class="card"><b>${s.distanceKm.toFixed(1)} km</b>
        <span>route distance</span></div>
      <div class="card"><b>${s.solarStopBuckets}</b>
        <span>solar-stop buckets</span></div>
    </div>`;
  const step = Math.max(1, Math.ceil(result.arrivalRow.length / 8));
  const pareto = result.arrivalRow
      .filter((a, i) => i % step === 0)
      .map((a) => `<tr><td>${new Date(a.timeMs).toISOString()
          .slice(11, 16)}Z</td><td>${a.socPct.toFixed(0)}%</td></tr>`)
      .join('');
  const table = `<table class="days"><tr><th>arrive by</th>` +
      `<th>best SOC</th></tr>${pareto}</table>`;
  return head + cards + gatesHtml(assessment.gates) + ledgerHtml(ledger) +
         table;
}

function readNum(doc, id, fallback) {
  const v = parseFloat(doc.getElementById(id).value);
  return Number.isFinite(v) ? v : fallback;
}

export async function runVoyage(deps, state) {
  const doc = deps.doc;
  const wps = parseWaypoints(doc.getElementById('waypoints').value);
  if (!wps) {
    doc.getElementById('voyage-status').textContent =
        'Enter at least two "lat, lon" lines (append ", anchor" where ' +
        'stopping is possible).';
    return null;
  }
  const objective = doc.getElementById('objective').value === 'earliest'
      ? 'earliest' : 'maxSoc';
  const departTime = deps.now();
  const segments = segmentRoute(wps);
  const env = await getRouteEnvironment(segments, departTime, 3,
                                        deps.fetchImpl, 4,
                                        loadProviderStats(deps.storage));
  const vessel = state.vessel ?? vesselFromProfile(state.profile);
  const geo = loadGeoStore(deps.storage);
  const opt = {
    objective,
    startSocPct: readNum(doc, 'soc', 90),
    reserveSocPct: readNum(doc, 'reserve', 25),
    segPowerFactor: (seg) => geoPowerFactor(geo, seg.lat, seg.lon),
  };
  const envAt = envAtFactory(env, departTime);
  const result = planVoyage(vessel, segments, envAt, departTime, opt);
  const ledger = result.feasible
      ? planLedger(vessel, segments, result.plan, envAt) : [];
  const quantiles = errorQuantiles(vessel.relErrors);
  const socQ = result.feasible
      ? arrivalSocQuantiles(vessel, result.plan, result.summary, quantiles)
      : { expectedPct: 0, conservativePct: 0, optimisticPct: 0,
          calibrated: quantiles.calibrated };
  const moving = result.feasible
      ? result.plan.filter((st) => !st.wait) : [];
  const assessment = assessPlan({
    feasible: result.feasible,
    coverage: env.coverage,
    forecastAgeH: env.ageH ?? 0, // real cache age when offline
    currentDataPresent: env.sources.currents.confidence > 0,
    socQuantiles: socQ,
    reserveSocPct: opt.reserveSocPct,
    minStwKmh: moving.length > 0
        ? Math.min(...moving.map((st) => st.stwKmh)) : undefined,
  });
  doc.getElementById('voyage-summary').innerHTML =
      voyageHtml(result, assessment, socQ, ledger);
  doc.getElementById('voyage-status').textContent =
      `Environment — wind: ${env.coverage.perVar.wind.label}, waves: ` +
      `${env.coverage.perVar.waves.label}, currents: ` +
      `${env.coverage.perVar.currents.label}`;
  return { result, assessment, socQ, env };
}

export function initVoyage(deps, state) {
  const doc = deps.doc;
  state.vessel = loadVessel(deps.storage, state.profile);

  // OSM route editor (when Leaflet is available): map edits write the
  // textarea; textarea edits push back to the map. The textarea stays
  // the source of truth the planner reads.
  const mapCtl = initMap({
    leaflet: deps.leaflet,
    element: doc.getElementById('map'),
    onChange: (wps) => {
      doc.getElementById('waypoints').value = waypointsToText(wps);
    },
  });
  state.mapCtl = mapCtl;
  if (mapCtl.enabled) {
    const syncFromText = () => {
      const wps = parseWaypoints(doc.getElementById('waypoints').value);
      if (wps) mapCtl.setWaypoints(wps);
    };
    doc.getElementById('waypoints').addEventListener('change',
                                                     syncFromText);
    syncFromText();
  }

  doc.getElementById('voyage-plan').addEventListener('click', () => {
    doc.getElementById('voyage-status').textContent = 'Planning voyage…';
    return runVoyage(deps, state).catch((err) => {
      doc.getElementById('voyage-status').textContent =
          `Voyage planning failed: ${err}`;
    });
  });
}
