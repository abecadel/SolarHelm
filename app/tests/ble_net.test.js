import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BLE_REMOTE,
  BLE_SERVICE,
  BLE_TELEMETRY,
  bleSupported,
  connectBle,
  httpLink,
  mixedContentBlocked,
} from '../js/ble_link.js';
import {
  CACHE_PREFIX,
  CACHE_TTL_H,
  cachedFetch,
  evictCache,
} from '../js/net_cache.js';
import { makeStorage } from './helpers.js';

// --- transports ----------------------------------------------------------

test('mixedContentBlocked flags exactly the https->http case', () => {
  assert.equal(mixedContentBlocked('https:', 'http://192.168.4.1'), true);
  assert.equal(mixedContentBlocked('http:', 'http://192.168.4.1'), false);
  assert.equal(mixedContentBlocked('https:', 'https://boat.local'), false);
  assert.equal(bleSupported(null), false);
  assert.equal(bleSupported({}), true);
});

test('httpLink reads telemetry/config and posts remote/config', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/config') && opts && opts.method === 'POST') {
      return { ok: true, json: async () => ({ ok: true, fields: 2 }) };
    }
    return { ok: true, json: async () => ({ hello: 1 }) };
  };
  const link = httpLink(fetchImpl, 'http://192.168.4.1/');
  assert.equal(link.kind, 'http');
  assert.deepEqual(await link.readTelemetry(), { hello: 1 });
  assert.equal(calls[0].url, 'http://192.168.4.1/telemetry');
  await link.sendRemote(350);
  assert.deepEqual(JSON.parse(calls[1].opts.body), { target_w: 350 });
  assert.deepEqual(await link.readConfig(), { hello: 1 });
  const out = await link.writeConfig({ deadband_w: 30 });
  assert.equal(out.fields, 2);
  link.disconnect(); // no-op, no throw
});

test('httpLink surfaces HTTP and boat-side validation errors', async () => {
  const bad = httpLink(async () => ({ ok: false, status: 500,
                                      json: async () => ({}) }), 'http://x');
  await assert.rejects(() => bad.readTelemetry(), /HTTP 500/);
  await assert.rejects(() => bad.sendRemote(1), /HTTP 500/);
  await assert.rejects(() => bad.readConfig(), /HTTP 500/);
  const refuse = httpLink(async () => ({
    ok: false, status: 400,
    json: async () => ({ ok: false, error: 'bad-deadband' }),
  }), 'http://x');
  await assert.rejects(() => refuse.writeConfig({ deadband_w: -1 }),
                       /bad-deadband/);
});

function fakeBluetooth() {
  const writes = [];
  let connected = false;
  const chars = {
    [BLE_TELEMETRY]: {
      readValue: async () =>
          new TextEncoder().encode('{"battery_power_w":-12}'),
    },
    [BLE_REMOTE]: {
      writeValue: async (bytes) =>
          writes.push(new TextDecoder().decode(bytes)),
    },
  };
  const device = {
    name: 'SolarHelm',
    gatt: {
      get connected() { return connected; },
      connect: async () => {
        connected = true;
        return {
          getPrimaryService: async (uuid) => {
            assert.equal(uuid, BLE_SERVICE);
            return { getCharacteristic: async (u) => chars[u] };
          },
        };
      },
      disconnect: () => { connected = false; },
    },
  };
  return {
    requestDevice: async (opts) => {
      assert.deepEqual(opts.filters, [{ services: [BLE_SERVICE] }]);
      return device;
    },
    _writes: writes,
    _device: device,
  };
}

test('connectBle wires GATT read/write and disconnect', async () => {
  const bt = fakeBluetooth();
  const link = await connectBle(bt);
  assert.equal(link.kind, 'ble');
  assert.equal(link.label, 'BLE: SolarHelm');
  const t = await link.readTelemetry();
  assert.equal(t.battery_power_w, -12);
  await link.sendRemote(420);
  assert.deepEqual(JSON.parse(bt._writes[0]), { target_w: 420 });
  link.disconnect();
  assert.equal(bt._device.gatt.connected, false);
  link.disconnect(); // second call: already disconnected, no throw
});

test('connectBle falls back to a generic label without a device name',
     async () => {
  const bt = fakeBluetooth();
  bt._device.name = undefined;
  const link = await connectBle(bt);
  assert.equal(link.label, 'BLE: SolarHelm');
});

// --- offline cache -------------------------------------------------------

const URL1 = 'https://api.example/forecast?x=1';

test('cachedFetch stores successful GETs and replays them offline',
     async () => {
  const storage = makeStorage();
  let t = 1_000_000;
  let online = true;
  const f = cachedFetch(async () => {
    if (!online) throw new Error('offline');
    return { ok: true, json: async () => ({ v: 42 }) };
  }, storage, () => t);
  const live = await f(URL1);
  assert.equal(live.cachedAgeH, 0);
  assert.deepEqual(await live.json(), { v: 42 });
  assert.ok(storage.getItem(CACHE_PREFIX + URL1));

  online = false;
  t += 3 * 3.6e6; // 3 hours later
  const replay = await f(URL1);
  assert.ok(Math.abs(replay.cachedAgeH - 3) < 1e-9);
  assert.deepEqual(await replay.json(), { v: 42 });
});

test('cachedFetch evicts expired entries and survives quota pressure',
     async () => {
  const storage = makeStorage();
  let t = 0;
  const ok = cachedFetch(async () => ({ ok: true,
                                        json: async () => ({ v: 1 }) }),
                         storage, () => t);
  await ok('u1');
  await ok('u2');
  t += (CACHE_TTL_H + 1) * 3.6e6;
  await ok('u3'); // routine sweep on write clears the stale pair
  assert.equal(storage.getItem(CACHE_PREFIX + 'u1'), null);
  assert.equal(storage.getItem(CACHE_PREFIX + 'u2'), null);
  assert.ok(storage.getItem(CACHE_PREFIX + 'u3'));

  // Quota pressure: setItem fails for new keys once 2 entries exist —
  // the cache sacrifices everything else for the newest payload.
  const inner = makeStorage();
  const quota = {
    getItem: (k) => inner.getItem(k),
    removeItem: (k) => inner.removeItem(k),
    get length() { return inner.length; },
    key: (i) => inner.key(i),
    setItem: (k, v) => {
      if (inner.length >= 2 && inner.getItem(k) === null) {
        throw new Error('QuotaExceeded');
      }
      inner.setItem(k, v);
    },
  };
  const q = cachedFetch(async () => ({ ok: true,
                                       json: async () => ({ v: 2 }) }),
                        quota, () => t);
  await q('a');
  await q('b');
  await q('c'); // quota hit -> evict-all-but-newest -> retry succeeds
  assert.equal(inner.length, 1);
  assert.ok(inner.getItem(CACHE_PREFIX + 'c'));
});

test('evictCache counts corrupt entries and survives broken storage',
     () => {
  const storage = makeStorage({
    [`${CACHE_PREFIX}fresh`]: JSON.stringify({ t: 0, payload: 1 }),
    [`${CACHE_PREFIX}corrupt`]: '{nope',
    unrelated: 'left alone',
  });
  assert.equal(evictCache(storage, 1000), 1); // corrupt only; fresh kept
  assert.ok(storage.getItem(`${CACHE_PREFIX}fresh`));
  assert.equal(storage.getItem('unrelated'), 'left alone');
  assert.equal(
      evictCache(storage, 0, { all: true,
                               keepKey: `${CACHE_PREFIX}fresh` }),
      0); // nothing but the keeper remains
  const broken = { get length() { throw new Error('blocked'); } };
  assert.equal(evictCache(broken, 0), 0);
});

test('cachedFetch works with the default wall clock', async () => {
  const f = cachedFetch(async () => ({ ok: true, json: async () => ({}) }),
                        makeStorage());
  assert.equal((await f(URL1)).cachedAgeH, 0);
});

test('cachedFetch expires, skips POSTs and tolerates broken storage',
     async () => {
  const storage = makeStorage();
  let t = 0;
  const failing = cachedFetch(async () => { throw new Error('offline'); },
                              storage, () => t);
  await assert.rejects(() => failing(URL1), /offline/); // nothing cached

  // Cache then age past the TTL: the cache no longer answers.
  let online = true;
  const f = cachedFetch(async () => {
    if (!online) throw new Error('offline');
    return { ok: true, json: async () => ({ v: 1 }) };
  }, storage, () => t);
  await f(URL1);
  online = false;
  t += (CACHE_TTL_H + 1) * 3.6e6;
  await assert.rejects(() => f(URL1), /offline/);

  // POST passes straight through, uncached.
  const posts = [];
  const p = cachedFetch(async (url, opts) => {
    posts.push(opts.method);
    return { ok: true, json: async () => ({}) };
  }, storage, () => t);
  await p('http://x/remote', { method: 'POST', body: '{}' });
  assert.deepEqual(posts, ['POST']);

  // HTTP error with no cache rethrows; corrupt cache entries rethrow.
  const err404 = cachedFetch(async () => ({ ok: false, status: 404 }),
                             makeStorage(), () => t);
  await assert.rejects(() => err404(URL1), /HTTP 404/);
  const corrupt = makeStorage({ [CACHE_PREFIX + URL1]: '{nope' });
  const c = cachedFetch(async () => { throw new Error('offline'); },
                        corrupt, () => t);
  await assert.rejects(() => c(URL1), /offline/);
  // Throwing storage: caching is best-effort, reads fail closed.
  const throwing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const tf = cachedFetch(async () => ({ ok: true, json: async () => ({}) }),
                         throwing, () => t);
  assert.equal((await tf(URL1)).ok, true); // setItem failure swallowed
  const tf2 = cachedFetch(async () => { throw new Error('offline'); },
                          throwing, () => t);
  await assert.rejects(() => tf2(URL1), /offline/);
});
