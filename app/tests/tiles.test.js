import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CORRIDOR_ZOOMS,
  TILE_CAP,
  corridorTiles,
  tileAt,
  tileFrac,
  tileKey,
  tileUrl,
} from '../js/tile_math.js';
import {
  browserTiles,
  openTileStore,
} from '../js/tile_store.js';
import {
  baseTileLayer,
  loadCachedTile,
  prefetchRouteTiles,
} from '../js/map_ui.js';
import {
  downloadRouteTiles,
  initVoyage,
  refreshTileStatus,
} from '../js/voyage_ui.js';
import {
  fire,
  makeDoc,
  makeIndexedDb,
  makeLeaflet,
  makeStorage,
  makeTiles,
} from './helpers.js';

const SPLIT = { lat: 43.5081, lon: 16.4402 };

// --- tile math -----------------------------------------------------------

test('tileAt matches the slippy-map reference and handles the edges', () => {
  assert.deepEqual(tileAt(0, 0, 0), { z: 0, x: 0, y: 0 });
  // Split, Croatia at z10 (reference values from the OSM formula).
  const t = tileAt(SPLIT.lat, SPLIT.lon, 10);
  assert.deepEqual(t, { z: 10, x: 558, y: 374 });
  assert.equal(tileKey(t), '10/558/374');
  assert.equal(tileUrl(t),
               'https://tile.openstreetmap.org/10/558/374.png');
  // Longitude wraps; polar latitudes clamp to the Mercator edge tiles.
  assert.equal(tileAt(0, 181, 4).x, 0);
  assert.equal(tileAt(0, -181, 4).x, 15);
  assert.equal(tileAt(89.9, 0, 4).y, 0);
  assert.equal(tileAt(-89.9, 0, 4).y, 15);
  assert.ok(Math.abs(tileFrac(0, 0, 1).x - 1) < 1e-12);
});

test('corridorTiles covers a short route uncapped, coarse zooms first',
     () => {
  const { tiles, capped } = corridorTiles([
    SPLIT, { lat: 43.3908, lon: 16.2911 },
  ]);
  assert.equal(capped, false);
  assert.ok(tiles.length > 20 && tiles.length <= TILE_CAP,
            `${tiles.length} tiles`);
  assert.equal(tiles[0].z, CORRIDOR_ZOOMS[0]);
  // Every zoom is represented, no duplicates, both endpoints covered.
  const keys = new Set(tiles.map(tileKey));
  assert.equal(keys.size, tiles.length);
  for (const z of CORRIDOR_ZOOMS) {
    assert.ok(keys.has(tileKey(tileAt(SPLIT.lat, SPLIT.lon, z))), `z${z}`);
    assert.ok(keys.has(tileKey(tileAt(43.3908, 16.2911, z))), `z${z}`);
  }
});

test('corridorTiles hard-caps long routes, keeping the coarse zooms',
     () => {
  const { tiles, capped } = corridorTiles([
    { lat: 43.5, lon: 16.4 }, { lat: 37.9, lon: 23.7 },  // Split→Athens
  ]);
  assert.equal(capped, true);
  assert.equal(tiles.length, TILE_CAP);
  assert.ok(tiles.some((t) => t.z === CORRIDOR_ZOOMS[0]));
});

// --- tile store ----------------------------------------------------------

test('openTileStore round-trips blobs through the injected IndexedDB',
     async () => {
  const store = await openTileStore(makeIndexedDb());
  assert.equal(store.available, true);
  assert.equal(await store.get('10/1/2'), undefined);
  await store.put('10/1/2', 'blob-a');
  assert.equal(await store.get('10/1/2'), 'blob-a');
  assert.equal(await store.count(), 1);
  await store.clear();
  assert.equal(await store.count(), 0);
});

test('openTileStore degrades to an unavailable no-op store', async () => {
  for (const idb of [null, makeIndexedDb({ failOpen: true })]) {
    const store = await openTileStore(idb);
    assert.equal(store.available, false);
    assert.equal(await store.get('x'), undefined);
    await store.put('x', 'y');
    assert.equal(await store.count(), 0);
    await store.clear(); // no throw
  }
});

test('tile store writes are best-effort under failing IndexedDB ops',
     async () => {
  const store = await openTileStore(makeIndexedDb({ failOps: true }));
  assert.equal(store.available, true);
  await store.put('k', 'v'); // rejection swallowed
  await assert.rejects(() => store.count(), /idb op failed/);
});

test('browserTiles binds the browser primitives', async () => {
  const win = {
    URL: { createObjectURL: (blob) => `obj:${blob}` },
    setTimeout: (fn, ms) => { win._ms = ms; fn(); },
  };
  const doc = { createElement: (tag) => ({ tag }) };
  const t = browserTiles('store', 'fetch', win, doc);
  assert.equal(t.store, 'store');
  assert.equal(t.fetchImpl, 'fetch');
  assert.equal(t.toUrl('B'), 'obj:B');
  assert.deepEqual(t.createElement('img'), { tag: 'img' });
  await t.sleep(600);
  assert.equal(win._ms, 600);
});

// --- cache-through layer + prefetch --------------------------------------

test('loadCachedTile serves the cache first, then fetch-and-store',
     async () => {
  const store = await openTileStore(makeIndexedDb());
  const tiles = makeTiles(store);
  const t = { z: 10, x: 558, y: 371 };
  assert.equal(await loadCachedTile(tiles, t),
               `url:blob:${tileUrl(t)}`);
  assert.equal(tiles._fetched.length, 1);
  assert.equal(await loadCachedTile(tiles, t),
               `url:blob:${tileUrl(t)}`); // now from the store
  assert.equal(tiles._fetched.length, 1);
  const failing = makeTiles(store, { fetchOk: false });
  await assert.rejects(() => loadCachedTile(failing, { z: 9, x: 1, y: 1 }),
                       /tile HTTP 503/);
});

test('baseTileLayer is cache-through with a store, plain OSM without',
     async () => {
  const store = await openTileStore(makeIndexedDb());
  const tiles = makeTiles(store);
  const L = makeLeaflet();
  const layer = baseTileLayer(L, tiles).addTo(L._calls.map ?? {
    addLayer() {} }); // fake addTo records the instance
  assert.equal(L._calls.gridLayers.length, 1);
  assert.ok(layer.options.attribution.includes('OpenStreetMap'));
  // createTile resolves the tile through the cache and calls done.
  let doneArgs = null;
  const img = layer.createTile({ z: 10, x: 558, y: 374 },
                               (...a) => { doneArgs = a; });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(img.src, `url:blob:${tileUrl({ z: 10, x: 558, y: 374 })}`);
  assert.equal(doneArgs[0], null);
  // A failing tile reports the error to Leaflet instead of hanging.
  const failing = baseTileLayer(L, makeTiles(store, { fetchOk: false }));
  const img2 = failing.createTile({ z: 9, x: 5, y: 5 },
                                  (...a) => { doneArgs = a; });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(img2.src, '');
  assert.ok(String(doneArgs[0]).includes('tile HTTP 503'));

  // No store / no IndexedDB / no GridLayer -> the plain online layer.
  const plain = makeLeaflet();
  baseTileLayer(plain, null);
  const noIdb = makeTiles(await openTileStore(null));
  baseTileLayer(plain, noIdb);
  assert.equal(plain._calls.tiles.length, 2);
  assert.equal(plain._calls.gridLayers.length, 0);
});

test('prefetchRouteTiles fills the corridor politely and reports totals',
     async () => {
  const store = await openTileStore(makeIndexedDb());
  const tiles = makeTiles(store);
  let sleeps = 0;
  tiles.sleep = async () => { sleeps += 1; };
  const wps = [SPLIT, { lat: 43.3908, lon: 16.2911 }];
  const progress = [];
  const r = await prefetchRouteTiles(tiles, wps,
                                     (done, total) =>
                                         progress.push([done, total]));
  assert.equal(r.failed, 0);
  assert.equal(r.capped, false);
  assert.equal(r.fetched, r.total);
  assert.equal(sleeps, r.total); // one pacing sleep per network fetch
  assert.deepEqual(progress[progress.length - 1], [r.total, r.total]);
  assert.equal(await store.count(), r.total);

  // Second run: everything cached -> no fetches, no sleeps.
  tiles._fetched.length = 0;
  sleeps = 0;
  const r2 = await prefetchRouteTiles(tiles, wps, () => {});
  assert.equal(r2.fetched, 0);
  assert.equal(tiles._fetched.length, 0);
  assert.equal(sleeps, 0);

  // Network failures are counted, not thrown.
  await store.clear();
  const failing = makeTiles(store, { fetchOk: false });
  const r3 = await prefetchRouteTiles(failing, wps, () => {});
  assert.equal(r3.fetched, 0);
  assert.equal(r3.failed, r3.total);
});

// --- voyage tab wiring ---------------------------------------------------

function voyageDeps(tiles) {
  const doc = makeDoc({
    waypoints: '43.5081, 16.4402, anchor\n43.3908, 16.2911',
  });
  return {
    doc, tiles, storage: makeStorage(), leaflet: null,
    now: () => new Date('2026-06-21T05:00:00Z'),
  };
}

test('refreshTileStatus reports the cache size or unavailability',
     async () => {
  const deps = voyageDeps(makeTiles(await openTileStore(makeIndexedDb())));
  assert.equal(await refreshTileStatus(deps), true);
  assert.ok(deps.doc.getElementById('tile-status').textContent
      .includes('0 tiles cached'));
  const noIdb = voyageDeps(undefined);
  assert.equal(await refreshTileStatus(noIdb), false);
  assert.ok(noIdb.doc.getElementById('tile-status').textContent
      .includes('unavailable'));
});

test('downloadRouteTiles drives progress, summary and guidance',
     async () => {
  const tiles = makeTiles(await openTileStore(makeIndexedDb()));
  const deps = voyageDeps(tiles);
  const r = await downloadRouteTiles(deps);
  const status = deps.doc.getElementById('tile-status').textContent;
  assert.ok(status.includes(`Map pack ready: ${r.fetched} downloaded`));
  assert.ok(!status.includes('failed'));
  assert.ok(!status.includes('capped'));

  // Route missing -> guidance; store missing -> unavailable, null.
  deps.doc.getElementById('waypoints').value = '';
  assert.equal(await downloadRouteTiles(deps), null);
  assert.ok(deps.doc.getElementById('tile-status').textContent
      .includes('Enter a route first'));
  assert.equal(await downloadRouteTiles(voyageDeps(undefined)), null);

  // Failures and the cap both surface in the summary line.
  const failStore = await openTileStore(makeIndexedDb());
  const failDeps = voyageDeps(makeTiles(failStore, { fetchOk: false }));
  failDeps.doc.getElementById('waypoints').value =
      '43.5, 16.4\n37.9, 23.7'; // Split→Athens: capped at TILE_CAP
  const rf = await downloadRouteTiles(failDeps);
  assert.equal(rf.capped, true);
  const failText = failDeps.doc.getElementById('tile-status').textContent;
  assert.ok(failText.includes(`${rf.failed} failed`));
  assert.ok(failText.includes('capped at 200'));
});

test('initVoyage wires the download and clear buttons', async () => {
  const tiles = makeTiles(await openTileStore(makeIndexedDb()));
  const deps = voyageDeps(tiles);
  const state = { profile: {
    hull_efficiency_curve_kmh_whkm: [[4, 50], [6, 80]],
    hotel_load_w: 50, motor_max_power_w: 1164, pv_kwp: 1,
    pv_derating: 0.85, battery_capacity_kwh: 2.56 } };
  initVoyage(deps, state);
  await fire(deps.doc, 'tile-download', 'click');
  assert.ok(await tiles.store.count() > 0);
  await fire(deps.doc, 'tile-clear', 'click');
  assert.equal(await tiles.store.count(), 0);
  assert.ok(deps.doc.getElementById('tile-status').textContent
      .includes('0 tiles cached'));

  // Without a tiles bundle the buttons degrade to guidance, no crash.
  const bare = voyageDeps(undefined);
  initVoyage(bare, { ...state });
  await fire(bare.doc, 'tile-download', 'click');
  await fire(bare.doc, 'tile-clear', 'click');
  assert.ok(bare.doc.getElementById('tile-status').textContent
      .includes('unavailable'));

  // Failing IndexedDB ops: rejections land in the status line, not the
  // console (and the fire-and-forget initial refresh stays silent).
  const broken = voyageDeps(makeTiles(
      await openTileStore(makeIndexedDb({ failOps: true }))));
  initVoyage(broken, { ...state });
  await fire(broken.doc, 'tile-download', 'click');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(broken.doc.getElementById('tile-status').textContent
      .includes('Map download failed'));
  await fire(broken.doc, 'tile-clear', 'click');
  assert.ok(broken.doc.getElementById('tile-status').textContent
      .includes('Map cache unavailable'));
});
