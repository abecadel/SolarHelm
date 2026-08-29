// Voyage planner (planner v2) UI glue: A→B routes over the global-first
// environment layer, the learned vessel model, and the (segment, time)
// route DP. Same dependency-injection pattern as ui.js so the whole module
// runs — and is covered — under node with a stub DOM.

import { getVoyageEnvironment } from './providers.js';
import {
  arrivalSocQuantiles,
  planVoyage,
  segmentRoute,
} from './route_planner.js';
import { errorQuantiles, vesselFromProfile } from './vessel_model.js';
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

/** Adapts an hourly environment series to the planner's envAt(seg, hour)
 *  callback (V1: one series for the whole route — legs are short). */
export function envAtFactory(hours, departTime) {
  if (hours.length === 0) {
    const dead = { ghiWm2: 0, windMs: 0, windDirDeg: 0, waveHsM: 0,
                   waveDirDeg: 0, currentMs: 0, currentDirDeg: 0 };
    return () => dead;
  }
  const offsetH = (departTime.getTime() - hours[0].time.getTime()) / 3.6e6;
  return (segIdx, hourFloat) => {
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

export function voyageHtml(result, assessment, socQ) {
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
  return head + cards + gatesHtml(assessment.gates) + table;
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
  const mid = wps[Math.floor(wps.length / 2)];
  const env = await getVoyageEnvironment(mid.lat, mid.lon, departTime, 3,
                                         deps.fetchImpl);
  const vessel = vesselFromProfile(state.profile);
  const opt = {
    objective,
    startSocPct: readNum(doc, 'soc', 90),
    reserveSocPct: readNum(doc, 'reserve', 25),
  };
  const result = planVoyage(vessel, segments, envAtFactory(env.hours,
                                                           departTime),
                            departTime, opt);
  const quantiles = errorQuantiles(vessel.relErrors);
  const socQ = result.feasible
      ? arrivalSocQuantiles(vessel, result.plan, result.summary, quantiles)
      : { expectedPct: 0, conservativePct: 0, optimisticPct: 0,
          calibrated: quantiles.calibrated };
  const assessment = assessPlan({
    feasible: result.feasible,
    coverage: env.coverage,
    forecastAgeH: 0, // fetched just now
    currentDataPresent: env.sources.currents.confidence > 0,
    socQuantiles: socQ,
    reserveSocPct: opt.reserveSocPct,
  });
  doc.getElementById('voyage-summary').innerHTML =
      voyageHtml(result, assessment, socQ);
  doc.getElementById('voyage-status').textContent =
      `Environment — wind: ${env.coverage.perVar.wind.label}, waves: ` +
      `${env.coverage.perVar.waves.label}, currents: ` +
      `${env.coverage.perVar.currents.label}`;
  return { result, assessment, socQ, env };
}

export function initVoyage(deps, state) {
  const doc = deps.doc;
  doc.getElementById('voyage-plan').addEventListener('click', () => {
    doc.getElementById('voyage-status').textContent = 'Planning voyage…';
    return runVoyage(deps, state).catch((err) => {
      doc.getElementById('voyage-status').textContent =
          `Voyage planning failed: ${err}`;
    });
  });
}
