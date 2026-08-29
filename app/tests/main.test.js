// Covers the browser bootstrap (main.js) by providing browser globals in
// node before importing it. Runs in its own process (node --test isolates
// test files), so the globals leak nowhere.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FORM_DEFAULTS, fire, makeDoc, makeStorage } from './helpers.js';

test('main.js boots the app against browser globals', async () => {
  const doc = makeDoc(FORM_DEFAULTS);
  let registered = null;
  globalThis.document = doc;
  globalThis.fetch = async () => { throw new Error('offline'); };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition: (ok) =>
            ok({ coords: { latitude: 43.1, longitude: 16.2 } }),
      },
      serviceWorker: {
        register: (url) => {
          registered = url;
          return Promise.reject(new Error('not a real browser'));
        },
      },
    },
  });
  globalThis.window = { localStorage: makeStorage() };

  await import('../js/main.js');
  // initApp is async; give it a tick to resolve the profile load.
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(doc.getElementById('profile-name').textContent
      .includes('built-in profile'));
  assert.equal(registered, './sw.js');

  // The bound deps are live: plan click renders an offline plan and the
  // injected now()/fetch() arrows execute.
  await fire(doc, 'plan', 'click');
  assert.ok(doc.getElementById('summary').innerHTML.includes('forecast'));
  fire(doc, 'locate', 'click');
  assert.equal(doc.getElementById('lat').value, '43.1000');
});
