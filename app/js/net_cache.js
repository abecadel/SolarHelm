// Offline-first fetch cache: online data is downloaded BY THE PHONE while
// it has internet, cached, and reused when the boat link is all there is.
// GET-only; the responses report their age so the voyage freshness gate
// judges cached forecasts honestly instead of pretending they are live.

export const CACHE_PREFIX = 'solarhelm.fetch_cache.';
export const CACHE_TTL_H = 24;

/** Deletes cache entries: expired ones, or (all=true) every entry except
 *  keepKey. Returns how many were removed. Storage errors end the sweep
 *  quietly — eviction is itself best-effort. */
export function evictCache(storage, now, { all = false,
                                           keepKey = null } = {}) {
  const doomed = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(CACHE_PREFIX) || key === keepKey) {
        continue;
      }
      if (all) {
        doomed.push(key);
        continue;
      }
      try {
        const entry = JSON.parse(storage.getItem(key));
        if ((now - entry.t) / 3.6e6 > CACHE_TTL_H) doomed.push(key);
      } catch (err) {
        doomed.push(key); // corrupt entries are dead weight
      }
    }
    for (const key of doomed) storage.removeItem(key);
  } catch (err) {
    return doomed.length;
  }
  return doomed.length;
}

export function cachedFetch(fetchImpl, storage, now = () => Date.now()) {
  return async (url, opts) => {
    if (opts && opts.method && opts.method !== 'GET') {
      return fetchImpl(url, opts);
    }
    try {
      const resp = await fetchImpl(url, opts);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const payload = await resp.json();
      const key = CACHE_PREFIX + url;
      const value = JSON.stringify({ t: now(), payload });
      try {
        evictCache(storage, now()); // routine sweep of expired entries
        storage.setItem(key, value);
      } catch (err) {
        // Quota: sacrifice every other cached payload for this one —
        // the most recent forecast is the one a voyage needs.
        try {
          evictCache(storage, now(), { all: true, keepKey: key });
          storage.setItem(key, value);
        } catch (err2) { /* storage unusable: cache is best-effort */ }
      }
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
