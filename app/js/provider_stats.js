// Provider historical-error learning: how good has each forecast provider
// actually been for THIS boat's waters?
// (docs/GLOBAL_ENVIRONMENT_PROVIDERS.md §provider-performance learning.)
//
// Each (provider, variable) pair accumulates bias and MAE from
// forecast-vs-observed pairs; adjustedConfidence() then shades the
// provider's static confidence so the coverage score and SAFE gates
// reflect demonstrated skill, not just brochure resolution. Observations
// come from logged telemetry (solar) and, later, ESP32 wind/wave proxies.

export const PROVIDER_STATS_KEY = 'solarhelm.provider_stats.v1';

/** Per-variable "a typical error this big halves your usefulness" scales,
 *  in the variable's own units. */
export const ERROR_SCALES = {
  wind: 3.0,      // m/s
  waves: 0.5,     // m
  solar: 200.0,   // W/m^2
  currents: 0.5,  // m/s
};

export function makeProviderStats() {
  return { version: 1, entries: {} };
}

/** Records one forecast-vs-observed pair; returns the updated entry. */
export function recordProviderSample(stats, providerId, variable,
                                     forecastValue, observedValue) {
  const key = `${providerId}/${variable}`;
  const e = stats.entries[key] ?? { n: 0, sumErr: 0, sumAbsErr: 0 };
  const err = forecastValue - observedValue;
  e.n += 1;
  e.sumErr += err;
  e.sumAbsErr += Math.abs(err);
  stats.entries[key] = e;
  return e;
}

export function providerSummary(stats, providerId, variable) {
  const e = stats.entries[`${providerId}/${variable}`];
  if (!e || e.n === 0) return null;
  return { n: e.n, bias: e.sumErr / e.n, mae: e.sumAbsErr / e.n };
}

/** Shades a provider's static confidence by demonstrated skill. Fewer
 *  than 10 comparisons: no adjustment (don't punish a provider for a
 *  small sample). A provider whose MAE reaches the variable's error
 *  scale drops to half confidence; a perfect one keeps its base. */
export function adjustedConfidence(base, summary, variable) {
  if (!summary || summary.n < 10) return base;
  const scale = ERROR_SCALES[variable] ?? 1.0;
  const skill = Math.max(0, Math.min(1, 1 - summary.mae / scale));
  return base * (0.5 + 0.5 * skill);
}

export function saveProviderStats(storage, stats) {
  try {
    storage.setItem(PROVIDER_STATS_KEY, JSON.stringify(stats));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadProviderStats(storage) {
  try {
    const s = JSON.parse(storage.getItem(PROVIDER_STATS_KEY));
    if (s && s.entries) return s;
  } catch (err) {
    // fall through to fresh stats
  }
  return makeProviderStats();
}
