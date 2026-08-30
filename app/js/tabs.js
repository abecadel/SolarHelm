// Tab shell for the control-panel PWA. Hash-routed so views are
// linkable/bookmarkable (#voyage, #boat, ...); dependencies injected
// (doc + hash accessors) per the app's DI pattern.

export const TABS = ['plan', 'voyage', 'boat', 'model', 'setup'];

export function currentTab(hash) {
  const t = (hash || '').replace(/^#/, '');
  return TABS.includes(t) ? t : 'plan';
}

export function showTab(doc, tab) {
  for (const t of TABS) {
    doc.getElementById(`tab-${t}`).hidden = t !== tab;
    doc.getElementById(`tabbtn-${t}`).className =
        t === tab ? 'tabbtn active' : 'tabbtn';
  }
}

/** deps: {doc, getHash, setHash, onHashChange}. onShow(tab) fires after
 *  every switch (lazy view refreshes hook here). Returns the apply fn. */
export function initTabs(deps, onShow = null) {
  const apply = () => {
    const tab = currentTab(deps.getHash());
    showTab(deps.doc, tab);
    if (onShow) onShow(tab);
  };
  for (const t of TABS) {
    deps.doc.getElementById(`tabbtn-${t}`).addEventListener('click', () => {
      deps.setHash(t);
      apply();
    });
  }
  deps.onHashChange(apply);
  apply();
  return apply;
}
