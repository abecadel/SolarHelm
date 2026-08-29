import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildForecastUrl,
  clearSkyForecast,
  dayOfYearUtc,
  getForecast,
  parseOpenMeteo,
} from '../js/forecast.js';
import { makeFetch, openMeteoPayload } from './helpers.js';

test('dayOfYearUtc', () => {
  assert.equal(dayOfYearUtc(new Date(Date.UTC(2026, 0, 1))), 1);
  assert.equal(dayOfYearUtc(new Date(Date.UTC(2026, 11, 31))), 365);
});

test('buildForecastUrl encodes location, span and variables', () => {
  const url = buildForecastUrl(43.5081, 16.4402,
                               new Date(Date.UTC(2026, 5, 21)), 2);
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'));
  assert.ok(url.includes('latitude=43.5081'));
  assert.ok(url.includes('longitude=16.4402'));
  assert.ok(url.includes('start_date=2026-06-21'));
  assert.ok(url.includes('end_date=2026-06-22'));
  assert.ok(url.includes('shortwave_radiation'));
  assert.ok(url.includes('wind_speed_unit=ms'));
});

test('parseOpenMeteo normalises a payload', () => {
  const hours = parseOpenMeteo(openMeteoPayload(1));
  assert.equal(hours.length, 24);
  assert.ok(hours[12].ghiWm2 > 500);
  assert.equal(hours[12].windMs, 3);
  assert.equal(hours[12].cloudPct, 20);
  assert.equal(hours[12].tempC, 24);
  assert.equal(hours[0].time.getUTCHours(), 0);
});

test('parseOpenMeteo tolerates missing optional arrays and null values', () => {
  const p = openMeteoPayload(1);
  delete p.hourly.cloud_cover;
  delete p.hourly.wind_speed_10m;
  delete p.hourly.temperature_2m;
  p.hourly.shortwave_radiation[3] = null;
  p.hourly.time[0] = '2026-06-21T00:00Z'; // already has Z
  const hours = parseOpenMeteo(p);
  assert.equal(hours[5].cloudPct, 0);
  assert.equal(hours[5].windMs, 0);
  assert.equal(hours[5].tempC, 15);
  assert.equal(hours[3].ghiWm2, 0);
});

test('parseOpenMeteo rejects malformed payloads', () => {
  assert.throws(() => parseOpenMeteo(null));
  assert.throws(() => parseOpenMeteo({}));
  assert.throws(() => parseOpenMeteo({ hourly: { time: 'nope' } }));
});

test('clearSkyForecast: Croatian June day shape', () => {
  const hours = clearSkyForecast(43.5, 16.44,
                                 new Date(Date.UTC(2026, 5, 21, 9, 30)), 2);
  assert.equal(hours.length, 48);
  assert.equal(hours[0].time.getUTCHours(), 0);
  assert.equal(hours[1].ghiWm2, 0);              // 01:00 UTC: dark
  const noon = hours[11].ghiWm2;                 // ~solar noon
  assert.ok(noon > 700, `noon GHI ${noon}`);
  const daylight = hours.filter((h) => h.ghiWm2 > 0).length;
  assert.ok(daylight > 24 && daylight < 34);     // ~15 h/day of light
});

test('getForecast uses Open-Meteo when reachable', async () => {
  const r = await getForecast(43.5, 16.4, new Date(Date.UTC(2026, 5, 21)), 1,
                              makeFetch(openMeteoPayload(1)));
  assert.equal(r.source, 'open-meteo');
  assert.equal(r.hours.length, 24);
});

test('getForecast falls back on HTTP error, bad shape, empty and network failure', async () => {
  const when = new Date(Date.UTC(2026, 5, 21));
  for (const fetchImpl of [
    makeFetch(null, { ok: false, status: 500 }),
    makeFetch({ nope: true }),
    makeFetch({ hourly: { time: [], shortwave_radiation: [] } }),
    makeFetch(null, { reject: true }),
  ]) {
    const r = await getForecast(43.5, 16.4, when, 1, fetchImpl);
    assert.equal(r.source, 'clear-sky');
    assert.equal(r.hours.length, 24);
    assert.ok(r.error.length > 0);
  }
});

test('getForecast reports non-Error throwables too', async () => {
  const r = await getForecast(43.5, 16.4, new Date(Date.UTC(2026, 5, 21)), 1,
                              async () => { throw 'plain string'; });
  assert.equal(r.source, 'clear-sky');
  assert.equal(r.error, 'plain string');
});
