// UI glue for the planner PWA.
//
// Every dependency (document, fetch, geolocation, localStorage, clock) is
// injected through initApp(deps) so this module runs — and is covered —
// under node with a stub DOM, and unchanged in the browser (see main.js
// for the browser bootstrap).

import { legend, lineChart, hourTicks } from './charts.js';
import { bestEfficiencySpeedKmh } from './energy_model.js';
import { getForecast } from './forecast.js';
import {
  fitCurveFromTelemetryCsv,
  maxRangeEstimateKm,
  planTrip,
} from './planner.js';
import { loadProfile, profileValid } from './profile.js';

export const CURVE_STORAGE_KEY = 'solarhelm.fitted_curve.v1';

function num(doc, id, fallback) {
  const v = parseFloat(doc.getElementById(id).value);
  return Number.isFinite(v) ? v : fallback;
}

export function readOptions(doc) {
  return {
    latDeg: num(doc, 'lat', 43.508),
    lonDeg: num(doc, 'lon', 16.44),
    distanceKm: num(doc, 'distance', 40),
    days: Math.min(3, Math.max(1, num(doc, 'days', 2))),
    mode: doc.getElementById('mode').value === 'fixed' ? 'fixed' : 'solar',
    fixedSpeedKmh: num(doc, 'speed', 5),
    startSocPct: num(doc, 'soc', 90),
    reserveSocPct: num(doc, 'reserve', 25),
    cruiseStartHourUtc: num(doc, 'cruise-start', 6),
    cruiseEndHourUtc: num(doc, 'cruise-end', 18),
  };
}

export function summaryHtml(summary, forecastSource, maxRangeKm) {
  const fits = summary.tripFits;
  const days = summary.perDay
      .map((d) => `<tr><td>Day ${d.day}</td>` +
                  `<td>${d.distanceKm.toFixed(1)} km</td>` +
                  `<td>${d.pvKwh.toFixed(2)} kWh</td>` +
                  `<td>${d.motorKwh.toFixed(2)} kWh</td></tr>`)
      .join('');
  return `
    <div class="verdict ${fits ? 'ok' : 'warn'}">
      ${fits
        ? `Trip fits: ${summary.plannedDistanceKm.toFixed(0)} km reached` +
          (summary.arrivalTime
            ? ` by ${summary.arrivalTime.toISOString().slice(0, 16)}Z`
            : '')
        : `Trip does NOT fit: ${summary.distanceCoveredKm.toFixed(1)} of ` +
          `${summary.plannedDistanceKm.toFixed(0)} km within the horizon`}
    </div>
    <div class="cards">
      <div class="card"><b>${summary.finalSocPct.toFixed(0)}%</b>
        <span>SOC at end</span></div>
      <div class="card"><b>${summary.minSocPct.toFixed(0)}%</b>
        <span>lowest SOC</span></div>
      <div class="card"><b>${summary.pvKwh.toFixed(1)} kWh</b>
        <span>solar harvested</span></div>
      <div class="card"><b>${summary.motorKwh.toFixed(1)} kWh</b>
        <span>propulsion</span></div>
      <div class="card"><b>${maxRangeKm.toFixed(0)} km</b>
        <span>max range (optimistic)</span></div>
      <div class="card"><b>${forecastSource}</b>
        <span>forecast source</span></div>
    </div>
    <table class="days"><tr><th></th><th>distance</th><th>solar</th>
      <th>motor</th></tr>${days}</table>`;
}

export function chartsHtml(steps, forecastHours) {
  const idx = steps.map((s, i) => i);
  const ticks = hourTicks(forecastHours);
  const power = [
    { label: 'PV W', color: '#e8a013',
      points: idx.map((i) => [i, steps[i].pvW]) },
    { label: 'Motor W', color: '#2778c4',
      points: idx.map((i) => [i, steps[i].motorW]) },
  ];
  const soc = [
    { label: 'SOC %', color: '#c43535',
      points: idx.map((i) => [i, steps[i].socPct]) },
  ];
  const dist = [
    { label: 'Distance km', color: '#7a51a1',
      points: idx.map((i) => [i, steps[i].distanceKm]) },
    { label: 'Speed km/h', color: '#3d8f5f',
      points: idx.map((i) => [i, steps[i].speedKmh]) },
  ];
  return legend(power) + lineChart(power, { xTicks: ticks }) +
         legend(soc) +
         lineChart(soc, { xTicks: ticks, yMin: 0, yMax: 100 }) +
         legend(dist) + lineChart(dist, { xTicks: ticks });
}

export async function runPlan(deps, state) {
  const doc = deps.doc;
  const opt = readOptions(doc);
  const start = deps.now();
  const forecast = await getForecast(opt.latDeg, opt.lonDeg, start, opt.days,
                                     deps.fetchImpl);
  const { steps, summary } = planTrip(state.profile, opt, forecast.hours);
  const maxRange = maxRangeEstimateKm(state.profile, opt, forecast.hours);
  doc.getElementById('summary').innerHTML =
      summaryHtml(summary, forecast.source, maxRange);
  doc.getElementById('charts').innerHTML =
      chartsHtml(steps, forecast.hours);
  doc.getElementById('status').textContent =
      forecast.source === 'clear-sky'
        ? 'Offline/clear-sky estimate (no forecast reachable)'
        : 'Live Open-Meteo forecast';
  return { steps, summary, forecast };
}

export function applyFittedCurve(state, deps, csvText) {
  const doc = deps.doc;
  const curve = fitCurveFromTelemetryCsv(csvText);
  if (!curve) {
    doc.getElementById('curve-status').textContent =
        'Not enough usable telemetry in that CSV (need speed>1 km/h rows).';
    return false;
  }
  state.profile = {
    ...state.profile,
    hull_efficiency_curve_kmh_whkm: curve,
  };
  try {
    deps.storage.setItem(CURVE_STORAGE_KEY, JSON.stringify(curve));
  } catch (err) { /* per-viewer convenience only */ }
  doc.getElementById('curve-status').textContent =
      `Learned curve applied (${curve.length} points, best speed ` +
      `${bestEfficiencySpeedKmh(curve).toFixed(1)} km/h). Stored locally.`;
  return true;
}

export function restoreFittedCurve(state, deps) {
  let stored = null;
  try {
    stored = deps.storage.getItem(CURVE_STORAGE_KEY);
  } catch (err) {
    return false;
  }
  if (!stored) return false;
  try {
    const curve = JSON.parse(stored);
    const candidate = {
      ...state.profile,
      hull_efficiency_curve_kmh_whkm: curve,
    };
    if (!profileValid(candidate)) return false;
    state.profile = candidate;
    deps.doc.getElementById('curve-status').textContent =
        `Using stored learned curve (${curve.length} points).`;
    return true;
  } catch (err) {
    return false;
  }
}

export async function initApp(deps) {
  const doc = deps.doc;
  const state = { profile: null };
  const loaded = await loadProfile(deps.fetchImpl);
  state.profile = loaded.profile;
  doc.getElementById('profile-name').textContent =
      `${state.profile.name ?? 'boat'} — ` +
      `${state.profile.pv_kwp} kWp / ` +
      `${state.profile.battery_capacity_kwh} kWh` +
      (loaded.source === 'builtin' ? ' (built-in profile)' : '');
  restoreFittedCurve(state, deps);

  doc.getElementById('plan').addEventListener('click', () => {
    doc.getElementById('status').textContent = 'Fetching forecast…';
    return runPlan(deps, state).catch((err) => {
      doc.getElementById('status').textContent = `Planning failed: ${err}`;
    });
  });

  doc.getElementById('locate').addEventListener('click', () => {
    if (!deps.geolocation) {
      doc.getElementById('status').textContent =
          'GPS unavailable — enter coordinates manually';
      return;
    }
    deps.geolocation.getCurrentPosition(
        (pos) => {
          doc.getElementById('lat').value =
              pos.coords.latitude.toFixed(4);
          doc.getElementById('lon').value =
              pos.coords.longitude.toFixed(4);
          doc.getElementById('status').textContent = 'Position set from GPS';
        },
        () => {
          doc.getElementById('status').textContent =
              'GPS unavailable — enter coordinates manually';
        });
  });

  doc.getElementById('csv').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    applyFittedCurve(state, deps, await file.text());
  });

  return state;
}
