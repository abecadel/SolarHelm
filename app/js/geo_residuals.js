// Geographic residual learning: places where the boat consistently needs
// more (or less) power than the vessel model predicts — shallow channels,
// river reaches, kelp — remembered as an EWMA bias per lat/lon bin
// (docs/ADAPTIVE_ENERGY_MODEL_RESEARCH.md §geographic learning).
//
// V1 uses plain 0.2-degree binning instead of an H3 dependency: the store
// shape is versioned, so a hex upgrade later is a migration, not a schema
// break. Population requires positioned residuals, which arrive once the
// ESP32 logs GPS positions alongside telemetry (Milestone 2); the planner
// hook and persistence are live now.

export const GEO_STORAGE_KEY = 'solarhelm.geo_residuals.v1';
export const BIN_DEG = 0.2;
export const MIN_SAMPLES = 3;
export const MAX_ABS_BIAS = 0.3;

export function geoKey(lat, lon, binDeg = BIN_DEG) {
  return `${Math.floor(lat / binDeg)}:${Math.floor(lon / binDeg)}`;
}

export function makeGeoStore() {
  return { version: 1, binDeg: BIN_DEG, bins: {} };
}

/** Folds one positioned relative residual ((measured-predicted)/predicted)
 *  into the store's bin as an EWMA; returns the updated bin. */
export function geoUpdate(store, lat, lon, relResidual, alpha = 0.25) {
  const key = geoKey(lat, lon, store.binDeg);
  const bin = store.bins[key] ?? { bias: 0, n: 0 };
  bin.bias = bin.n === 0 ? relResidual
                         : bin.bias + alpha * (relResidual - bin.bias);
  bin.n += 1;
  store.bins[key] = bin;
  return bin;
}

/** Power multiplier for planning at a location: >1 means the boat needs
 *  more power here than the model says. 1.0 until a bin has evidence;
 *  bias clamped so a few bad samples can never distort a plan badly. */
export function geoPowerFactor(store, lat, lon) {
  const bin = store.bins[geoKey(lat, lon, store.binDeg)];
  if (!bin || bin.n < MIN_SAMPLES) return 1.0;
  const bias = Math.max(-MAX_ABS_BIAS, Math.min(MAX_ABS_BIAS, bin.bias));
  return 1 + bias;
}

export function saveGeoStore(storage, store) {
  try {
    storage.setItem(GEO_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadGeoStore(storage) {
  try {
    const s = JSON.parse(storage.getItem(GEO_STORAGE_KEY));
    if (s && s.bins && typeof s.binDeg === 'number') return s;
  } catch (err) {
    // fall through to a fresh store
  }
  return makeGeoStore();
}
