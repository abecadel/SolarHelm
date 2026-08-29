import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ERROR_SCALES,
  PROVIDER_STATS_KEY,
  adjustedConfidence,
  loadProviderStats,
  makeProviderStats,
  providerSummary,
  recordProviderSample,
  saveProviderStats,
} from '../js/provider_stats.js';
import { makeStorage } from './helpers.js';

test('recordProviderSample accumulates bias and MAE per provider/variable',
     () => {
  const stats = makeProviderStats();
  recordProviderSample(stats, 'open-meteo-weather', 'wind', 5, 4);
  recordProviderSample(stats, 'open-meteo-weather', 'wind', 3, 4);
  recordProviderSample(stats, 'open-meteo-weather', 'wind', 6, 4);
  const s = providerSummary(stats, 'open-meteo-weather', 'wind');
  assert.equal(s.n, 3);
  assert.ok(Math.abs(s.bias - (1 - 1 + 2) / 3) < 1e-9);
  assert.ok(Math.abs(s.mae - 4 / 3) < 1e-9);
  // Different variable, separate bucket.
  assert.equal(providerSummary(stats, 'open-meteo-weather', 'waves'), null);
  assert.equal(providerSummary(stats, 'nobody', 'wind'), null);
});

function statsWithMae(providerId, variable, mae, n = 12) {
  const stats = makeProviderStats();
  for (let i = 0; i < n; i++) {
    recordProviderSample(stats, providerId, variable, mae, 0);
  }
  return stats;
}

test('adjustedConfidence shades by demonstrated skill', () => {
  // Perfect provider: base kept.
  const perfect = providerSummary(
      statsWithMae('p', 'wind', 0), 'p', 'wind');
  assert.equal(adjustedConfidence(0.9, perfect, 'wind'), 0.9);
  // MAE at the variable scale: halved.
  const awful = providerSummary(
      statsWithMae('p', 'wind', ERROR_SCALES.wind), 'p', 'wind');
  assert.ok(Math.abs(adjustedConfidence(0.9, awful, 'wind') - 0.45) < 1e-9);
  // Small sample or no history: untouched.
  const few = providerSummary(
      statsWithMae('p', 'wind', 10, 5), 'p', 'wind');
  assert.equal(adjustedConfidence(0.9, few, 'wind'), 0.9);
  assert.equal(adjustedConfidence(0.9, null, 'wind'), 0.9);
  // Unknown variable falls back to a unit scale.
  const odd = providerSummary(
      statsWithMae('p', 'fog', 0.5), 'p', 'fog');
  assert.ok(adjustedConfidence(0.8, odd, 'fog') < 0.8);
});

test('saveProviderStats/loadProviderStats round-trip and survive bad state',
     () => {
  const storage = makeStorage();
  const stats = statsWithMae('p', 'wind', 1);
  assert.equal(saveProviderStats(storage, stats), true);
  assert.equal(loadProviderStats(storage).entries['p/wind'].n, 12);
  assert.deepEqual(loadProviderStats(makeStorage()).entries, {});
  assert.deepEqual(
      loadProviderStats(makeStorage({ [PROVIDER_STATS_KEY]: '{nope' }))
          .entries,
      {});
  const throwing = { getItem() { throw new Error('blocked'); },
                     setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadProviderStats(throwing).entries, {});
  assert.equal(saveProviderStats(throwing, stats), false);
});
