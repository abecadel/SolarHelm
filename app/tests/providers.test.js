import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MARINE_BASE,
  PROVIDER_REGISTRY,
  buildMarineUrl,
  buildWindUrl,
  coverageScore,
  getVoyageEnvironment,
  kMaxPlausibleCurrentMs,
  parseMarine,
  parseWind,
  providersFor,
} from '../js/providers.js';
import { marinePayload, windPayload } from './helpers.js';

const START = new Date(Date.UTC(2026, 5, 21));

test('providersFor filters by capability', () => {
  const wind = providersFor('wind', 43.5, 16.4);
  assert.deepEqual(wind.map((p) => p.id), ['open-meteo-weather']);
  const solar = providersFor('solar', -35.0, 174.0).map((p) => p.id);
  assert.ok(solar.includes('open-meteo-weather'));
  assert.ok(solar.includes('clear-sky-model'));
  assert.equal(providersFor('tides', 43.5, 16.4).length, 0);
});

test('providersFor honours regional coverage boxes', () => {
  PROVIDER_REGISTRY.push({
    id: 'fake-regional', tier: 2, global: false,
    capabilities: ['currents'],
    coverage: { latMin: 40, latMax: 46, lonMin: 12, lonMax: 20 },
  });
  try {
    const inBox = providersFor('currents', 43.5, 16.4).map((p) => p.id);
    assert.ok(inBox.includes('fake-regional'));
    assert.ok(inBox.includes('open-meteo-marine'));
    const outBox = providersFor('currents', 0, 0).map((p) => p.id);
    assert.ok(!outBox.includes('fake-regional'));
  } finally {
    PROVIDER_REGISTRY.pop();
  }
});

test('buildMarineUrl and buildWindUrl encode location, span and variables', () => {
  const m = buildMarineUrl(43.5081, 16.4402, START, 2);
  assert.ok(m.startsWith(`${MARINE_BASE}?`));
  assert.ok(m.includes('latitude=43.5081'));
  assert.ok(m.includes('ocean_current_velocity'));
  assert.ok(m.includes('start_date=2026-06-21'));
  assert.ok(m.includes('end_date=2026-06-22'));

  const w = buildWindUrl(43.5081, 16.4402, START, 1);
  assert.ok(w.includes('wind_direction_10m'));
  assert.ok(w.includes('wind_gusts_10m'));
  assert.ok(w.includes('wind_speed_unit=ms'));
  assert.ok(w.includes('end_date=2026-06-21'));
});

test('parseMarine normalises a payload with unit conversion', () => {
  const hours = parseMarine(marinePayload(1));
  assert.equal(hours.length, 24);
  assert.ok(Math.abs(hours[0].currentMs - 0.5) < 1e-9); // 1.8 km/h -> 0.5 m/s
  assert.equal(hours[0].currentDirDeg, 90);
  assert.equal(hours[0].waveHsM, 0.4);
  assert.equal(hours[0].waveTpS, 4);
  assert.equal(hours[0].windWaveHsM, 0.3);
  assert.equal(hours[0].time.getUTCHours(), 0);
});

test('parseMarine clamps implausible currents to zero', () => {
  const hours = parseMarine(marinePayload(1, { currentKmh: 20 })); // 5.6 m/s
  assert.ok(20 / 3.6 > kMaxPlausibleCurrentMs);
  assert.equal(hours[0].currentMs, 0);
});

test('parseMarine tolerates missing optional arrays', () => {
  const p = marinePayload(1);
  delete p.hourly.ocean_current_velocity;
  delete p.hourly.wave_period;
  const hours = parseMarine(p);
  assert.equal(hours[3].currentMs, 0);
  assert.equal(hours[3].waveTpS, 0);
});

test('parseMarine throws on malformed payloads', () => {
  assert.throws(() => parseMarine(null));
  assert.throws(() => parseMarine({}));
  assert.throws(() => parseMarine({ hourly: { time: ['2026-06-21T00:00'] } }));
});

test('parseWind normalises the extended weather payload', () => {
  const hours = parseWind(windPayload(1));
  assert.equal(hours.length, 24);
  assert.equal(hours[12].windMs, 3);
  assert.equal(hours[12].windDirDeg, 270);
  assert.equal(hours[12].gustMs, 6);
  assert.equal(hours[12].tempC, 24);
  assert.ok(hours[12].ghiWm2 > 500);
});

test('parseWind falls back on missing arrays and throws on bad shapes', () => {
  const minimal = {
    hourly: {
      time: ['2026-06-21T12:00'],
      shortwave_radiation: [600],
    },
  };
  const hours = parseWind(minimal);
  assert.equal(hours[0].windMs, 0);
  assert.equal(hours[0].tempC, 15); // explicit fallback
  assert.throws(() => parseWind(undefined));
  assert.throws(() => parseWind({ hourly: { time: [] } }));
});

function dispatchFetch({ windResp, marineResp }) {
  return async (url) => (url.includes('marine') ? marineResp() : windResp());
}

const okJson = (payload) => () => ({ ok: true, json: async () => payload });
const httpError = (status) => () => ({ ok: false, status,
                                       json: async () => ({}) });

test('getVoyageEnvironment merges live wind and marine data', async () => {
  const env = await getVoyageEnvironment(43.5, 16.4, START, 1,
      dispatchFetch({ windResp: okJson(windPayload(1)),
                      marineResp: okJson(marinePayload(1)) }));
  assert.equal(env.hours.length, 24);
  assert.equal(env.sources.wind.id, 'open-meteo-weather');
  assert.equal(env.sources.waves.id, 'open-meteo-marine');
  assert.equal(env.sources.currents.id, 'open-meteo-marine');
  assert.equal(env.sources.solar.id, 'open-meteo-weather');
  assert.equal(env.hours[12].windMs, 3);
  assert.equal(env.hours[12].waveHsM, 0.4);
  assert.ok(Math.abs(env.hours[12].currentMs - 0.5) < 1e-9);
  // marine merge must not clobber the wind-layer timestamps
  assert.equal(env.hours[12].time.getUTCHours(), 12);
  assert.equal(env.coverage.perVar.wind.label, 'HIGH');
  assert.equal(env.coverage.overallLabel, 'HIGH');
});

test('getVoyageEnvironment degrades to clear-sky when both HTTP calls fail',
     async () => {
  const env = await getVoyageEnvironment(43.5, 16.4, START, 1,
      dispatchFetch({ windResp: httpError(500),
                      marineResp: httpError(503) }));
  assert.equal(env.sources.wind.id, 'none');
  assert.equal(env.sources.waves.id, 'none');
  assert.equal(env.sources.solar.id, 'clear-sky-model');
  assert.equal(env.hours[12].windMs, 0);
  assert.ok(env.hours[12].ghiWm2 > 300); // clear-sky noon irradiance
  assert.equal(env.coverage.perVar.wind.label, 'NONE');
  assert.ok(env.coverage.overall < 0.5);
});

test('getVoyageEnvironment keeps live wind when only marine is down',
     async () => {
  const env = await getVoyageEnvironment(43.5, 16.4, START, 1,
      dispatchFetch({ windResp: okJson(windPayload(1)),
                      marineResp: () => { throw new Error('offline'); } }));
  assert.equal(env.sources.wind.id, 'open-meteo-weather');
  assert.equal(env.sources.waves.id, 'none');
  assert.equal(env.sources.currents.id, 'none');
  assert.equal(env.hours[12].waveHsM, 0);
});

test('coverageScore labels each confidence band', () => {
  const sources = {
    solar: { confidence: 0.9 }, wind: { confidence: 0.6 },
    waves: { confidence: 0.35 }, currents: { confidence: 0 },
  };
  const c = coverageScore(sources);
  assert.equal(c.perVar.solar.label, 'HIGH');
  assert.equal(c.perVar.wind.label, 'MEDIUM');
  assert.equal(c.perVar.waves.label, 'LOW');
  assert.equal(c.perVar.currents.label, 'NONE');
  assert.ok(c.overall <= 0.35); // min-aggregation on the critical pair
});
