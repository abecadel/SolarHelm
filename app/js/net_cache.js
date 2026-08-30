// Offline-first fetch cache: online data is downloaded BY THE PHONE while
// it has internet, cached, and reused when the boat link is all there is.
// GET-only; the responses report their age so the voyage freshness gate
// judges cached forecasts honestly instead of pretending they are live.

export const CACHE_PREFIX = 'solarhelm.fetch_cache.';
export const CACHE_TTL_H = 24;

export function cachedFetch(fetchImpl, storage, now = () => Date.now()) {
  return async (url, opts) => {
    if (opts && opts.method && opts.method !== 'GET') {
      return fetchImpl(url, opts);
    }
    try {
      const resp = await fetchImpl(url, opts);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const payload = await resp.json();
      try {
        storage.setItem(CACHE_PREFIX + url,
                        JSON.stringify({ t: now(), payload }));
      } catch (err) { /* cache is best-effort */ }
      return { ok: true, status: 200, json: async () => payload,
               cachedAgeH: 0 };
    } catch (err) {
      let raw = null;
      try {
        raw = storage.getItem(CACHE_PREFIX + url);
      } catch (storageErr) {
        throw err;
      }
      if (!raw) throw err;
      let entry = null;
      try {
        entry = JSON.parse(raw);
      } catch (parseErr) {
        throw err;
      }
      const ageH = (now() - entry.t) / 3.6e6;
      if (ageH > CACHE_TTL_H) throw err;
      return { ok: true, status: 200, json: async () => entry.payload,
               cachedAgeH: ageH };
    }
  };
}
