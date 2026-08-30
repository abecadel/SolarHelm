// OpenStreetMap route editor for the Voyage tab.
//
// The Leaflet instance is INJECTED (deps.leaflet) so this module is fully
// unit-testable with a recording fake, and the app degrades gracefully
// when the library is absent (ESP32-served with no vendor bundle, or a
// stripped build): waypoints then come from the textarea alone.
//
// UX: tap the map to append a waypoint (the first one is marked
// anchorable — it's the departure dock); click a marker to toggle its
// anchorable flag; double-click a marker to remove it. Markers are
// circle markers (no icon sprites — nothing to load offline). The
// waypoint textarea stays the source of truth: the map writes it via
// onChange, and edits to the textarea can be pushed back with
// setWaypoints().

import { corridorTiles, tileKey, tileUrl,
         TILE_URL_TEMPLATE } from './tile_math.js';

export const TILE_URL = TILE_URL_TEMPLATE;
export const OSM_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">' +
    'OpenStreetMap</a> contributors';
export const DEFAULT_CENTER = [43.5, 16.4];
export const DEFAULT_ZOOM = 9;

const STYLE_PLAIN = { radius: 8, color: '#0b3d5c', fillColor: '#2778c4',
                      fillOpacity: 0.9, weight: 2 };
const STYLE_ANCHOR = { radius: 9, color: '#7a5200', fillColor: '#e8a013',
                       fillOpacity: 0.95, weight: 2 };

/**
 * Resolves a tile to a renderable URL, caching through the tile store:
 * cached blob -> object URL; otherwise fetch, best-effort store, render.
 * tiles: {store, fetchImpl, toUrl, createElement}.
 */
export async function loadCachedTile(tiles, t) {
  const cached = await tiles.store.get(tileKey(t));
  if (cached) return tiles.toUrl(cached);
  const resp = await tiles.fetchImpl(tileUrl(t));
  if (!resp.ok) throw new Error(`tile HTTP ${resp.status}`);
  const blob = await resp.blob();
  await tiles.store.put(tileKey(t), blob);
  return tiles.toUrl(blob);
}

/**
 * The map's base layer: a cache-through OSM layer when the tile store is
 * available (every tile the user views renders offline afterwards), the
 * plain online tile layer otherwise.
 */
export function baseTileLayer(L, tiles) {
  if (!tiles || !tiles.store.available || !L.GridLayer) {
    return L.tileLayer(TILE_URL, { attribution: OSM_ATTRIBUTION,
                                   maxZoom: 19 });
  }
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const img = tiles.createElement('img');
      loadCachedTile(tiles, coords)
          .then((url) => { img.src = url; done(null, img); },
                (err) => done(err, img));
      return img;
    },
  });
  return new Layer({ attribution: OSM_ATTRIBUTION, maxZoom: 19 });
}

/**
 * Prefetches the capped route corridor (tile_math.corridorTiles) at a
 * polite rate. onProgress(done, total) fires per tile; sleep paces the
 * network fetches (cached tiles are skipped without sleeping).
 */
export async function prefetchRouteTiles(tiles, wps, onProgress) {
  const { tiles: list, capped } = corridorTiles(wps);
  let fetched = 0;
  let failed = 0;
  let done = 0;
  for (const t of list) {
    if (!(await tiles.store.get(tileKey(t)))) {
      try {
        const resp = await tiles.fetchImpl(tileUrl(t));
        if (!resp.ok) throw new Error(`tile HTTP ${resp.status}`);
        await tiles.store.put(tileKey(t), await resp.blob());
        fetched += 1;
      } catch {
        failed += 1;
      }
      await tiles.sleep(600); // OSM tile policy: stay under 2 req/s
    }
    done += 1;
    onProgress(done, list.length);
  }
  return { total: list.length, fetched, failed, capped };
}

/** Serializes waypoints into the textarea format parseWaypoints reads. */
export function waypointsToText(wps) {
  return wps.map((w) => `${w.lat.toFixed(4)}, ${w.lon.toFixed(4)}` +
                        (w.anchorable ? ', anchor' : '')).join('\n');
}

/**
 * Builds the map controller. deps: {leaflet, element, onChange(wps)}
 * plus an optional tiles bundle for offline caching (see baseTileLayer).
 * Returns {setWaypoints, getWaypoints, enabled} — enabled=false (and a
 * null controller surface that no-ops) when leaflet is unavailable.
 */
export function initMap(deps) {
  const L = deps.leaflet;
  if (!L) {
    return { enabled: false, setWaypoints: () => {}, getWaypoints: () => [] };
  }
  const map = L.map(deps.element,
                    { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
  baseTileLayer(L, deps.tiles).addTo(map);

  const state = { wps: [], markers: [], line: null };

  const notify = () => deps.onChange(state.wps.slice());

  const rebuild = () => {
    for (const m of state.markers) map.removeLayer(m);
    state.markers = [];
    if (state.line) {
      map.removeLayer(state.line);
      state.line = null;
    }
    state.wps.forEach((w, i) => {
      const marker = L.circleMarker([w.lat, w.lon],
                                    w.anchorable ? STYLE_ANCHOR
                                                 : STYLE_PLAIN);
      marker.on('click', () => {
        state.wps[i] = { ...w, anchorable: !w.anchorable };
        rebuild();
        notify();
      });
      marker.on('dblclick', () => {
        state.wps.splice(i, 1);
        rebuild();
        notify();
      });
      marker.addTo(map);
      state.markers.push(marker);
    });
    if (state.wps.length >= 2) {
      state.line = L.polyline(state.wps.map((w) => [w.lat, w.lon]),
                              { color: '#0b3d5c', weight: 3,
                                dashArray: '6 6' });
      state.line.addTo(map);
    }
  };

  map.on('click', (ev) => {
    state.wps.push({ lat: ev.latlng.lat, lon: ev.latlng.lng,
                     anchorable: state.wps.length === 0 });
    rebuild();
    notify();
  });

  return {
    enabled: true,
    /** Replaces the route (e.g. after a textarea edit); no onChange. */
    setWaypoints(wps) {
      state.wps = wps.map((w) => ({ ...w }));
      rebuild();
      if (state.wps.length > 0) {
        map.setView([state.wps[0].lat, state.wps[0].lon], DEFAULT_ZOOM);
      }
    },
    getWaypoints: () => state.wps.slice(),
  };
}
