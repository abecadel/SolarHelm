// All data shown in the demo video is REAL output of the app's own
// modules — the same code that runs in the planner PWA. Nothing is drawn
// from thin air; the video is a scripted screen recording of computed
// results.

import { hourTicks, legend, lineChart } from '../../app/js/charts.js';
import { clearSkyForecast } from '../../app/js/forecast.js';
import { planTrip } from '../../app/js/planner.js';
import { DEFAULT_PROFILE } from '../../app/js/profile.js';
import { coverageScore } from '../../app/js/providers.js';
import {
  arrivalSocQuantiles,
  planVoyage,
  segmentRoute,
} from '../../app/js/route_planner.js';
import { vesselFromProfile } from '../../app/js/vessel_model.js';
import { learnFromTelemetry } from '../../app/js/vessel_store.js';
import { assessPlan } from '../../app/js/voyage_safety.js';

const START = new Date(Date.UTC(2026, 5, 21));

// --- Day-trip plan (the classic planner) --------------------------------
const forecastHours = clearSkyForecast(43.5081, 16.4402, START, 2);
export const trip = planTrip(DEFAULT_PROFILE, {
  distanceKm: 40, days: 2, mode: 'solar',
  startSocPct: 90, reserveSocPct: 25,
}, forecastHours);

const idx = trip.steps.map((s, i) => i);
const ticks = hourTicks(forecastHours);
const powerSeries = [
  { label: 'PV W', color: '#e8a013',
    points: idx.map((i) => [i, trip.steps[i].pvW]) },
  { label: 'Motor W', color: '#2778c4',
    points: idx.map((i) => [i, trip.steps[i].motorW]) },
];
const socSeries = [
  { label: 'SOC %', color: '#c43535',
    points: idx.map((i) => [i, trip.steps[i].socPct]) },
];
export const chartsSvg = {
  power: legend(powerSeries) + lineChart(powerSeries, { xTicks: ticks }),
  soc: legend(socSeries) +
       lineChart(socSeries, { xTicks: ticks, yMin: 0, yMax: 100 }),
};

// --- Voyage A→B (planner v2: the route DP + safety gates) ---------------
const WAYPOINTS = [
  { lat: 43.5081, lon: 16.4402, anchorable: true }, // Split
  { lat: 43.45, lon: 16.3 },
  { lat: 43.39, lon: 16.29 },                       // toward Šolta/Brač
];
const segments = segmentRoute(WAYPOINTS);
const departTime = new Date(Date.UTC(2026, 5, 21, 6));
const voyageHours = clearSkyForecast(43.45, 16.35, START, 2);
const envAt = (segIdx, hourFloat) => {
  const i = Math.min(voyageHours.length - 1,
                     Math.max(0, Math.round(6 + hourFloat)));
  const h = voyageHours[i];
  return { ghiWm2: h.ghiWm2, windMs: 2, windDirDeg: 315, waveHsM: 0.2,
           waveDirDeg: 315, waveTpS: 3, currentMs: 0.1, currentDirDeg: 90 };
};
const vessel = vesselFromProfile(DEFAULT_PROFILE);
export const voyage = planVoyage(vessel, segments, envAt, departTime,
                                 { windowH: 24, startSocPct: 90,
                                   reserveSocPct: 25 });
// Simulated "good day": live providers reachable, model calibrated from
// past voyages — the SAFE path a real user sees with data and history.
const coverage = coverageScore({
  solar: { confidence: 0.9 }, wind: { confidence: 0.9 },
  waves: { confidence: 0.9 }, currents: { confidence: 0.9 },
});
export const socQ = arrivalSocQuantiles(
    vessel, voyage.plan, voyage.summary,
    { p10: -0.07, p50: 0, p90: 0.09, calibrated: true });
export const assessment = assessPlan({
  feasible: voyage.feasible,
  coverage,
  forecastAgeH: 1.2,
  currentDataPresent: true,
  socQuantiles: socQ,
  reserveSocPct: 25,
});

// --- Learning from a voyage log -----------------------------------------
function telemetryCsv(settings) {
  const lines = ['timestamp_ms,speed_kmh,motor_estimated_power_w'];
  let t = 0;
  for (const [v, p] of settings) {
    for (let s = 0; s < 90; s++) {
      lines.push(`${t * 1000},${v},${p}`);
      t += 1;
    }
  }
  return lines.join('\n');
}
export const learned = learnFromTelemetry(
    vesselFromProfile(DEFAULT_PROFILE),
    telemetryCsv([[4, 168], [4, 168], [5, 300], [6, 492], [7, 756]]));

export const profileName = DEFAULT_PROFILE.name;
