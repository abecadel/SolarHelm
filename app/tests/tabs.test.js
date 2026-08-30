import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TABS, currentTab, initTabs, showTab } from '../js/tabs.js';
import { fire, makeDoc } from './helpers.js';

test('currentTab maps hashes to tabs with a plan fallback', () => {
  assert.equal(currentTab('#voyage'), 'voyage');
  assert.equal(currentTab('boat'), 'boat');
  assert.equal(currentTab(''), 'plan');
  assert.equal(currentTab(undefined), 'plan');
  assert.equal(currentTab('#nonsense'), 'plan');
});

test('showTab hides every panel but the active one', () => {
  const doc = makeDoc();
  showTab(doc, 'model');
  for (const t of TABS) {
    assert.equal(doc.getElementById(`tab-${t}`).hidden, t !== 'model');
    assert.equal(doc.getElementById(`tabbtn-${t}`).className,
                 t === 'model' ? 'tabbtn active' : 'tabbtn');
  }
});

test('initTabs routes clicks and hash changes through onShow', () => {
  const doc = makeDoc();
  let hash = '#setup';
  let hashListener = null;
  const shown = [];
  initTabs({
    doc,
    getHash: () => hash,
    setHash: (t) => { hash = `#${t}`; },
    onHashChange: (fn) => { hashListener = fn; },
  }, (t) => shown.push(t));
  assert.deepEqual(shown, ['setup']); // initial apply honours the hash
  fire(doc, 'tabbtn-voyage', 'click');
  assert.equal(hash, '#voyage');
  assert.equal(doc.getElementById('tab-voyage').hidden, false);
  hash = '#boat';
  hashListener();
  assert.deepEqual(shown, ['setup', 'voyage', 'boat']);
});

test('initTabs works without an onShow hook', () => {
  const doc = makeDoc();
  const apply = initTabs({
    doc, getHash: () => '', setHash: () => {}, onHashChange: () => {},
  });
  apply();
  assert.equal(doc.getElementById('tab-plan').hidden, false);
});
