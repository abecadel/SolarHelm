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

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">' +
    'OpenStreetMap</a> contributors';
export const DEFAULT_CENTER = [43.5, 16.4];
export const DEFAULT_ZOOM = 9;

const STYLE_PLAIN = { radius: 8, color: '#0b3d5c', fillColor: '#2778c4',
                      fillOpacity: 0.9, weight: 2 };
const STYLE_ANCHOR = { radius: 9, color: '#7a5200', fillColor: '#e8a013',
                       fillOpacity: 0.95, weight: 2 };

/** Serializes waypoints into the textarea format parseWaypoints reads. */
export function waypointsToText(wps) {
  return wps.map((w) => `${w.lat.toFixed(4)}, ${w.lon.toFixed(4)}` +
                        (w.anchorable ? ', anchor' : '')).join('\n');
}

/**
 * Builds the map controller. deps: {leaflet, element, onChange(wps)}.
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
  L.tileLayer(TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: 19 })
      .addTo(map);

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
