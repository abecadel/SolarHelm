// IndexedDB tile store (localStorage is far too small for image tiles).
//
// The IndexedDB factory is INJECTED (a fake in tests, window.indexedDB in
// the browser) and every failure path degrades to an explicit
// `available: false` store whose methods no-op — the map then simply
// stays online-only, which is exactly the pre-offline-maps behavior.

export const TILE_DB = 'solarhelm.tiles';
const STORE = 'tiles';

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('idb error'));
  });
}

const UNAVAILABLE = {
  available: false,
  get: async () => undefined,
  put: async () => {},
  count: async () => 0,
  clear: async () => {},
};

/** Binds the browser primitives into the tiles dependency bundle that
 *  map_ui/voyage_ui consume (blob URLs, <img> creation, pacing). */
export function browserTiles(store, fetchImpl, win, doc) {
  return {
    store,
    fetchImpl, // raw fetch: tiles are binary, the JSON cache stays out
    toUrl: (blob) => win.URL.createObjectURL(blob),
    createElement: (tag) => doc.createElement(tag),
    sleep: (ms) => new Promise((resolve) => win.setTimeout(resolve, ms)),
  };
}

/** Opens (creating on first use) the tile store. Never throws. */
export async function openTileStore(idb) {
  if (!idb) return UNAVAILABLE;
  try {
    const open = idb.open(TILE_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    const db = await promisify(open);
    const os = (mode) => db.transaction(STORE, mode).objectStore(STORE);
    return {
      available: true,
      /** The stored blob for a tile key, or undefined. */
      get: (key) => promisify(os('readonly').get(key)),
      /** Best-effort write: quota failures are swallowed (the tile
       *  still renders from the network response it came from). */
      put: (key, blob) =>
          promisify(os('readwrite').put(blob, key)).catch(() => {}),
      count: () => promisify(os('readonly').count()),
      clear: () => promisify(os('readwrite').clear()),
    };
  } catch {
    return UNAVAILABLE; // private mode / blocked site data
  }
}
