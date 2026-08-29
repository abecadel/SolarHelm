// Environment provider layer — global-first (docs/GLOBAL_ENVIRONMENT_PROVIDERS.md).
//
// Nothing here is hard-coded to a region. A small registry describes each
// provider's coverage and capabilities; getVoyageEnvironment() assembles a
// merged hourly environment series for a point (or route sample point)
// from the best available providers, every value carrying metadata
// {source, model?, resolutionKm, ageH, confidence} that feeds the
// uncertainty model and the coverage score.
//
// V1 providers (Tier 0: browser-direct, keyless, CORS):
//   - Open-Meteo weather+solar (already used by the day-planner)
//   - Open-Meteo Marine: waves + ocean currents
//   - Clear-sky fallback (sun geometry; no wind/wave/current)
//   - Learned/telemetry current estimates plug in later behind the same
//     shape (a provider is just an async function + metadata).
//
// Conventions normalized here so downstream code never guesses:
//   wind_direction: degrees FROM (meteorological)
//   current direction: degrees TO (oceanographic)  [Open-Meteo marine]
//   current speed: m/s (Open-Meteo serves km/h by default — converted;
//     values are sanity-clamped, see kMaxPlausibleCurrentMs)
//   wave direction: degrees FROM

import { clearSkyForecast } from './forecast.js';

export const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';
export const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';

// A current faster than this is treated as a unit/parse error, not water.
export const kMaxPlausibleCurrentMs = 4.0;

/** The V1 provider registry. Coverage: global:true or {latMin,latMax,...}. */
export const PROVIDER_REGISTRY = [
  {
    id: 'open-meteo-weather', tier: 0, global: true,
    capabilities: ['wind', 'solar', 'temperature'],
    resolutionKm: 11, updateH: 6, horizonH: 168,
  },
  {
    id: 'open-meteo-marine', tier: 0, global: true,
    capabilities: ['waves', 'currents'],
    resolutionKm: 8, updateH: 12, horizonH: 168,
    coastalCaveat: '8 km grid: unreliable in narrow channels/harbours',
  },
  {
    id: 'clear-sky-model', tier: 0, global: true,
    capabilities: ['solar'],
    resolutionKm: 0, updateH: 0, horizonH: Infinity,
  },
];

/** Providers whose coverage includes the point, per capability. */
export function providersFor(capability, latDeg, lonDeg) {
  return PROVIDER_REGISTRY.filter((p) => {
    if (!p.capabilities.includes(capability)) return false;
    if (p.global) return true;
    const c = p.coverage;
    return latDeg >= c.latMin && latDeg <= c.latMax &&
           lonDeg >= c.lonMin && lonDeg <= c.lonMax;
  });
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

export function buildMarineUrl(latDeg, lonDeg, startDate, days) {
  const end = new Date(startDate.getTime() + (days - 1) * 86400000);
  const params = [
    `latitude=${latDeg.toFixed(4)}`,
    `longitude=${lonDeg.toFixed(4)}`,
    'hourly=wave_height,wave_direction,wave_period,wind_wave_height,' +
      'ocean_current_velocity,ocean_current_direction',
    'timezone=UTC',
    `start_date=${isoDate(startDate)}`,
    `end_date=${isoDate(end)}`,
  ];
  return `${MARINE_BASE}?${params.join('&')}`;
}

export function buildWindUrl(latDeg, lonDeg, startDate, days) {
  const end = new Date(startDate.getTime() + (days - 1) * 86400000);
  const params = [
    `latitude=${latDeg.toFixed(4)}`,
    `longitude=${lonDeg.toFixed(4)}`,
    'hourly=shortwave_radiation,cloud_cover,wind_speed_10m,' +
      'wind_direction_10m,wind_gusts_10m,temperature_2m',
    'wind_speed_unit=ms',
    'timezone=UTC',
    `start_date=${isoDate(startDate)}`,
    `end_date=${isoDate(end)}`,
  ];
  return `${WEATHER_BASE}?${params.join('&')}`;
}

function num(arr, i, fallback = 0) {
  const v = arr && arr[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Normalizes an Open-Meteo marine payload; throws on malformed shape. */
export function parseMarine(payload) {
  const h = payload && payload.hourly;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.wave_height)) {
    throw new Error('unexpected marine payload shape');
  }
  const out = [];
  for (let i = 0; i < h.time.length; i++) {
    let currentMs = num(h.ocean_current_velocity, i) / 3.6; // km/h -> m/s
    if (!(currentMs >= 0) || currentMs > kMaxPlausibleCurrentMs) {
      currentMs = 0; // unit/parse anomaly: safer to assume no current data
    }
    out.push({
      time: new Date(h.time[i] + (h.time[i].endsWith('Z') ? '' : 'Z')),
      waveHsM: num(h.wave_height, i),
      waveDirDeg: num(h.wave_direction, i),
      waveTpS: num(h.wave_period, i),
      windWaveHsM: num(h.wind_wave_height, i),
      currentMs,
      currentDirDeg: num(h.ocean_current_direction, i),
    });
  }
  return out;
}

/** Normalizes the weather payload (superset of forecast.js parsing). */
export function parseWind(payload) {
  const h = payload && payload.hourly;
  if (!h || !Array.isArray(h.time) ||
      !Array.isArray(h.shortwave_radiation)) {
    throw new Error('unexpected weather payload shape');
  }
  const out = [];
  for (let i = 0; i < h.time.length; i++) {
    out.push({
      time: new Date(h.time[i] + (h.time[i].endsWith('Z') ? '' : 'Z')),
      ghiWm2: num(h.shortwave_radiation, i),
      cloudPct: num(h.cloud_cover, i),
      windMs: num(h.wind_speed_10m, i),
      windDirDeg: num(h.wind_direction_10m, i),
      gustMs: num(h.wind_gusts_10m, i),
      tempC: num(h.temperature_2m, i, 15),
    });
  }
  return out;
}

const CONFIDENCE = { live: 0.9, clearSky: 0.35, none: 0.0 };

/**
 * Fetches the merged hourly environment for a point.
 * Returns { hours: [{time, ghiWm2, cloudPct, windMs, windDirDeg, gustMs,
 *   tempC, waveHsM, waveDirDeg, waveTpS, windWaveHsM, currentMs,
 *   currentDirDeg}], sources: {solar, wind, waves, currents}, coverage }.
 * Each `sources` entry: {id, confidence, resolutionKm}. Degrades per
 * capability: losing the marine API keeps live wind/solar; losing
 * everything yields clear-sky solar with zero wind/wave/current data
 * (confidence reflects it — the SAFE gates react, the planner still runs).
 */
export async function getVoyageEnvironment(latDeg, lonDeg, startDate, days,
                                           fetchImpl) {
  const sources = {
    solar: { id: 'clear-sky-model', confidence: CONFIDENCE.clearSky,
             resolutionKm: 0 },
    wind: { id: 'none', confidence: CONFIDENCE.none, resolutionKm: 0 },
    waves: { id: 'none', confidence: CONFIDENCE.none, resolutionKm: 0 },
    currents: { id: 'none', confidence: CONFIDENCE.none, resolutionKm: 0 },
  };
  // Baseline: clear-sky solar so the planner always has irradiance.
  const base = clearSkyForecast(latDeg, lonDeg, startDate, days).map((h) => ({
    time: h.time, ghiWm2: h.ghiWm2, cloudPct: 0, windMs: 0, windDirDeg: 0,
    gustMs: 0, tempC: h.tempC, waveHsM: 0, waveDirDeg: 0, waveTpS: 0,
    windWaveHsM: 0, currentMs: 0, currentDirDeg: 0,
  }));

  try {
    const resp = await fetchImpl(buildWindUrl(latDeg, lonDeg, startDate, days));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const wind = parseWind(await resp.json());
    for (let i = 0; i < base.length && i < wind.length; i++) {
      Object.assign(base[i], wind[i]);
    }
    sources.solar = { id: 'open-meteo-weather', confidence: CONFIDENCE.live,
                      resolutionKm: 11 };
    sources.wind = { id: 'open-meteo-weather', confidence: CONFIDENCE.live,
                     resolutionKm: 11 };
  } catch (err) {
    // clear-sky baseline stands; wind stays unavailable
  }

  try {
    const resp = await fetchImpl(
        buildMarineUrl(latDeg, lonDeg, startDate, days));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const marine = parseMarine(await resp.json());
    for (let i = 0; i < base.length && i < marine.length; i++) {
      const { time, ...vars } = marine[i];
      Object.assign(base[i], vars);
    }
    sources.waves = { id: 'open-meteo-marine', confidence: CONFIDENCE.live,
                      resolutionKm: 8 };
    sources.currents = { id: 'open-meteo-marine',
                         confidence: CONFIDENCE.live, resolutionKm: 8 };
  } catch (err) {
    // inland points or offline: marine data simply unavailable
  }

  return { hours: base, sources, coverage: coverageScore(sources) };
}

/** Per-variable and overall coverage score. Safety-critical variables
 *  (wind, waves) dominate via min-aggregation; labels for the UI. */
export function coverageScore(sources) {
  const label = (c) =>
      c >= 0.8 ? 'HIGH' : c >= 0.5 ? 'MEDIUM' : c > 0 ? 'LOW' : 'NONE';
  const perVar = {};
  for (const [k, s] of Object.entries(sources)) {
    perVar[k] = { confidence: s.confidence, label: label(s.confidence) };
  }
  const critical = Math.min(sources.wind.confidence,
                            sources.waves.confidence);
  const overall = Math.min(
      critical === 0 ? sources.solar.confidence * 0.5 : critical,
      (sources.solar.confidence + sources.currents.confidence) / 2 + 0.4);
  return { perVar, overall, overallLabel: label(overall) };
}
