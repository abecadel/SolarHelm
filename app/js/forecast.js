// Forecast layer: Open-Meteo hourly forecast with an offline clear-sky
// fallback built from sun geometry (energy_model.js).
//
// Open-Meteo (https://open-meteo.com) is free for non-commercial use, needs
// no API key and sends CORS headers, so the PWA can call it straight from
// the phone browser.
//
// fetchImpl is injectable for tests; the browser passes window.fetch.

import { clearSkyGhiWm2, solarElevationRad } from './energy_model.js';

export const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

/** Day-of-year (1..366) for a Date, in UTC. */
export function dayOfYearUtc(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

/** Builds the Open-Meteo request URL for a lat/lon and date span. */
export function buildForecastUrl(latDeg, lonDeg, startDate, days) {
  const start = startDate.toISOString().slice(0, 10);
  const endDate = new Date(startDate.getTime() + (days - 1) * 86400000);
  const end = endDate.toISOString().slice(0, 10);
  const params = [
    `latitude=${latDeg.toFixed(4)}`,
    `longitude=${lonDeg.toFixed(4)}`,
    'hourly=shortwave_radiation,cloud_cover,wind_speed_10m,temperature_2m',
    'wind_speed_unit=ms',
    'timezone=UTC',
    `start_date=${start}`,
    `end_date=${end}`,
  ];
  return `${OPEN_METEO_BASE}?${params.join('&')}`;
}

/** Normalises an Open-Meteo hourly payload to our internal shape:
 *  [{ time: Date, ghiWm2, cloudPct, windMs, tempC }] */
export function parseOpenMeteo(payload) {
  const h = payload && payload.hourly;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.shortwave_radiation)) {
    throw new Error('unexpected Open-Meteo payload shape');
  }
  const out = [];
  for (let i = 0; i < h.time.length; i++) {
    out.push({
      time: new Date(h.time[i] + (h.time[i].endsWith('Z') ? '' : 'Z')),
      ghiWm2: h.shortwave_radiation[i] ?? 0,
      cloudPct: (h.cloud_cover && h.cloud_cover[i]) ?? 0,
      windMs: (h.wind_speed_10m && h.wind_speed_10m[i]) ?? 0,
      tempC: (h.temperature_2m && h.temperature_2m[i]) ?? 15,
    });
  }
  return out;
}

/** Synthesises a clear-sky hourly forecast (offline fallback). */
export function clearSkyForecast(latDeg, lonDeg, startDate, days) {
  const out = [];
  const startDay = new Date(Date.UTC(
      startDate.getUTCFullYear(), startDate.getUTCMonth(),
      startDate.getUTCDate()));
  for (let hour = 0; hour < days * 24; hour++) {
    const t = new Date(startDay.getTime() + hour * 3600000);
    const elev = solarElevationRad(latDeg, dayOfYearUtc(t),
                                   t.getUTCHours() + 0.5, lonDeg);
    out.push({
      time: t,
      ghiWm2: clearSkyGhiWm2(elev),
      cloudPct: 0,
      windMs: 0,
      tempC: 22,
    });
  }
  return out;
}

/** Fetches the real forecast, falling back to clear-sky on any failure.
 *  Returns { hours, source } where source is 'open-meteo' | 'clear-sky'. */
export async function getForecast(latDeg, lonDeg, startDate, days, fetchImpl) {
  try {
    const url = buildForecastUrl(latDeg, lonDeg, startDate, days);
    const resp = await fetchImpl(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const hours = parseOpenMeteo(await resp.json());
    if (hours.length === 0) throw new Error('empty forecast');
    return { hours, source: 'open-meteo' };
  } catch (err) {
    return {
      hours: clearSkyForecast(latDeg, lonDeg, startDate, days),
      source: 'clear-sky',
      error: String(err && err.message ? err.message : err),
    };
  }
}
