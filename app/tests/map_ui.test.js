import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_CENTER,
  OSM_ATTRIBUTION,
  TILE_URL,
  initMap,
  waypointsToText,
} from '../js/map_ui.js';
import { parseWaypoints } from '../js/voyage_ui.js';
import { makeLeaflet } from './helpers.js';

test('waypointsToText round-trips through parseWaypoints', () => {
  const wps = [
    { lat: 43.5081, lon: 16.4402, anchorable: true },
    { lat: 43.39, lon: 16.29, anchorable: false },
  ];
  const text = waypointsToText(wps);
  assert.equal(text, '43.5081, 16.4402, anchor\n43.3900, 16.2900');
  const back = parseWaypoints(text);
  assert.equal(back.length, 2);
  assert.equal(back[0].anchorable, true);
  assert.equal(back[1].anchorable, false);
});

function mapWith(onChangeLog) {
  const L = makeLeaflet();
  const ctl = initMap({
    leaflet: L,
    element: 'map-el',
    onChange: (wps) => onChangeLog.push(wps),
  });
  return { L, ctl };
}

test('initMap sets up OSM tiles with attribution', () => {
  const { L, ctl } = mapWith([]);
  assert.ok(ctl.enabled);
  assert.equal(L._calls.mapEl, 'map-el');
  assert.deepEqual(L._calls.mapOpts.center, DEFAULT_CENTER);
  assert.equal(L._calls.tiles[0].url, TILE_URL);
  assert.ok(L._calls.tiles[0].opts.attribution.includes('OpenStreetMap'));
  assert.ok(OSM_ATTRIBUTION.includes('openstreetmap.org/copyright'));
});

test('map clicks append waypoints; the first is the anchorable dock', () => {
  const changes = [];
  const { L, ctl } = mapWith(changes);
  L._calls.map.handlers.click({ latlng: { lat: 43.5, lng: 16.4 } });
  L._calls.map.handlers.click({ latlng: { lat: 43.4, lng: 16.3 } });
  const wps = ctl.getWaypoints();
  assert.equal(wps.length, 2);
  assert.equal(wps[0].anchorable, true);
  assert.equal(wps[1].anchorable, false);
  assert.equal(changes.length, 2);
  // With two waypoints a dashed route line is drawn.
  assert.ok(L._calls.lines.length >= 1);
  const line = L._calls.lines[L._calls.lines.length - 1];
  assert.deepEqual(line.points, [[43.5, 16.4], [43.4, 16.3]]);
});

test('marker click toggles anchorable; double-click removes', () => {
  const changes = [];
  const { L, ctl } = mapWith(changes);
  L._calls.map.handlers.click({ latlng: { lat: 43.5, lng: 16.4 } });
  L._calls.map.handlers.click({ latlng: { lat: 43.4, lng: 16.3 } });
  // Latest rebuild created one marker per waypoint (last two in the log).
  const second = L._calls.markers[L._calls.markers.length - 1];
  second.handlers.click();
  assert.equal(ctl.getWaypoints()[1].anchorable, true);
  const secondAgain = L._calls.markers[L._calls.markers.length - 1];
  secondAgain.handlers.dblclick();
  assert.equal(ctl.getWaypoints().length, 1);
  assert.equal(changes.length, 4);
});

test('setWaypoints redraws and recenters without firing onChange', () => {
  const changes = [];
  const { L, ctl } = mapWith(changes);
  ctl.setWaypoints([
    { lat: 60.1, lon: 24.9, anchorable: true },
    { lat: 60.2, lon: 24.8 },
  ]);
  assert.equal(changes.length, 0);
  assert.equal(ctl.getWaypoints().length, 2);
  assert.deepEqual(L._calls.views[L._calls.views.length - 1][0],
                   [60.1, 24.9]);
  // Setting an empty route clears markers and does not recenter again.
  const viewsBefore = L._calls.views.length;
  ctl.setWaypoints([]);
  assert.equal(ctl.getWaypoints().length, 0);
  assert.equal(L._calls.views.length, viewsBefore);
});

test('initMap without Leaflet degrades to a disabled controller', () => {
  const ctl = initMap({ leaflet: null, element: 'x', onChange: () => {} });
  assert.equal(ctl.enabled, false);
  ctl.setWaypoints([{ lat: 1, lon: 2 }]);
  assert.deepEqual(ctl.getWaypoints(), []);
});
