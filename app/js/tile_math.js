// Slippy-map tile arithmetic for offline map packs. Pure functions only.
//
// The corridor enumerator is deliberately modest: OSM's tile policy
// forbids bulk scraping, so downloads are capped at TILE_CAP tiles per
// route, coarse zooms first — a capped pack still covers the whole route
// at overview zooms and simply thins out at the detailed ones.

export const TILE_URL_TEMPLATE =
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const CORRIDOR_ZOOMS = [8, 10, 12];
export const TILE_CAP = 200;

/** Fractional tile coordinates (Web Mercator) at zoom z. */
export function tileFrac(lat, lon, z) {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)
        / 2) * n,
  };
}

/** Integer tile containing a position; x wraps, y clamps. */
export function tileAt(lat, lon, z) {
  const n = 2 ** z;
  const f = tileFrac(lat, lon, z);
  const wrap = (v) => ((Math.floor(v) % n) + n) % n;
  return { z, x: wrap(f.x),
           y: Math.max(0, Math.min(n - 1, Math.floor(f.y))) };
}

export function tileKey(t) {
  return `${t.z}/${t.x}/${t.y}`;
}

export function tileUrl(t) {
  return TILE_URL_TEMPLATE.replace('{z}', t.z).replace('{x}', t.x)
      .replace('{y}', t.y);
}

/**
 * Enumerates the tiles covering a one-tile-wide corridor around the
 * route, coarse zooms first, hard-capped. Returns {tiles, capped} —
 * `tiles.length` is the download estimate shown before fetching.
 */
export function corridorTiles(wps, { zooms = CORRIDOR_ZOOMS,
                                     cap = TILE_CAP } = {}) {
  const seen = new Set();
  const tiles = [];
  for (const z of zooms) {
    const n = 2 ** z;
    for (let i = 0; i + 1 < wps.length; i++) {
      const a = tileFrac(wps[i].lat, wps[i].lon, z);
      const b = tileFrac(wps[i + 1].lat, wps[i + 1].lon, z);
      const steps = Math.max(1, Math.ceil(
          Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2));
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const cx = Math.floor(a.x + (b.x - a.x) * f);
        const cy = Math.floor(a.y + (b.y - a.y) * f);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const t = { z, x: (((cx + dx) % n) + n) % n,
                        y: Math.max(0, Math.min(n - 1, cy + dy)) };
            const key = tileKey(t);
            if (seen.has(key)) continue;
            if (tiles.length >= cap) return { tiles, capped: true };
            seen.add(key);
            tiles.push(t);
          }
        }
      }
    }
  }
  return { tiles, capped: false };
}
