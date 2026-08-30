// Setup tab: the "initially configure the project" role. Edits the boat
// profile (the shared VesselConfiguration), bumps config_revision on
// every save (docs/case-studies/HELIOS_11_LESSONS.md L1 — learned state
// must know which boat produced which data), persists locally.
// Boat-side NVS sync is bench-gated work; the tab says so honestly.

import { httpLink, mixedContentBlocked } from './ble_link.js';
import { profileValid } from './profile.js';

export const PROFILE_STORAGE_KEY = 'solarhelm.profile.v1';
export const DEFAULT_BOAT_URL = 'http://192.168.4.1';

export function curveToText(curve) {
  return curve.map(([v, whkm]) => `${v}, ${whkm}`).join('\n');
}

/** Parses "kmh, whkm" lines; null when unusable (< 2 valid points). */
export function parseCurveText(text) {
  const points = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(',').map((p) => parseFloat(p));
    if (parts.length !== 2 || !Number.isFinite(parts[0]) ||
        !Number.isFinite(parts[1]) || parts[0] <= 0 || parts[1] <= 0) {
      return null;
    }
    points.push([parts[0], parts[1]]);
  }
  points.sort((a, b) => a[0] - b[0]);
  return points.length >= 2 ? points : null;
}

export function fillSetupForm(doc, profile) {
  doc.getElementById('setup-name').value = profile.name ?? 'boat';
  doc.getElementById('setup-pv').value = String(profile.pv_kwp);
  doc.getElementById('setup-derating').value = String(profile.pv_derating);
  doc.getElementById('setup-battery').value =
      String(profile.battery_capacity_kwh);
  doc.getElementById('setup-hotel').value = String(profile.hotel_load_w);
  doc.getElementById('setup-motor').value =
      String(profile.motor_max_power_w);
  doc.getElementById('setup-curve').value =
      curveToText(profile.hull_efficiency_curve_kmh_whkm);
  doc.getElementById('setup-revision').textContent =
      `configuration revision ${profile.config_revision ?? 1}` +
      (profile.config_change_note ? ` — ${profile.config_change_note}` : '');
}

function num(doc, id) {
  return parseFloat(doc.getElementById(id).value);
}

export function saveSetup(deps, state) {
  const doc = deps.doc;
  const curve = parseCurveText(doc.getElementById('setup-curve').value);
  if (!curve) {
    doc.getElementById('setup-status').textContent =
        'Hull curve needs at least two "kmh, Wh/km" lines with positive ' +
        'numbers.';
    return false;
  }
  const candidate = {
    ...state.profile,
    name: doc.getElementById('setup-name').value || 'boat',
    pv_kwp: num(doc, 'setup-pv'),
    pv_derating: num(doc, 'setup-derating'),
    battery_capacity_kwh: num(doc, 'setup-battery'),
    hotel_load_w: num(doc, 'setup-hotel'),
    motor_max_power_w: num(doc, 'setup-motor'),
    hull_efficiency_curve_kmh_whkm: curve,
    config_revision: (state.profile.config_revision ?? 1) + 1,
    config_change_note:
        doc.getElementById('setup-note').value || 'edited in the app',
  };
  if (!profileValid(candidate)) {
    doc.getElementById('setup-status').textContent =
        'Invalid values — PV, derating (0..1], battery and motor must be ' +
        'positive, hotel >= 0.';
    return false;
  }
  state.profile = candidate;
  try {
    deps.storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(candidate));
  } catch (err) { /* per-device persistence only */ }
  fillSetupForm(doc, candidate);
  doc.getElementById('setup-status').textContent =
      `Saved as revision ${candidate.config_revision}. If this reflects a ` +
      'real refit (new panels, added mass), reset the learned model on ' +
      'the Model tab — old residuals describe the old boat.';
  return true;
}

/** Overlays a stored profile onto the loaded one (called at boot). */
export function applyStoredProfile(deps, state) {
  let stored = null;
  try {
    stored = deps.storage.getItem(PROFILE_STORAGE_KEY);
  } catch (err) {
    return false;
  }
  if (!stored) return false;
  try {
    const p = JSON.parse(stored);
    if (!profileValid(p)) return false;
    state.profile = p;
    return true;
  } catch (err) {
    return false;
  }
}

// ---- Boat-side control config over the SoftAP (/config API) ----
// Wi-Fi only, by decision: initial configuration happens at the dock on
// the boat's own network; a mixed-content page gets clear guidance.

function boatConfigLink(deps) {
  const doc = deps.doc;
  const base = (doc.getElementById('setup-boat-url').value ||
                DEFAULT_BOAT_URL).replace(/\/+$/, '');
  if (mixedContentBlocked(deps.pageProtocol, base)) {
    throw new Error('this HTTPS page cannot call the boat over plain ' +
                    `HTTP - open the app from the boat at ${base}/ to ` +
                    'configure it');
  }
  return httpLink(deps.rawFetch ?? deps.fetchImpl, base);
}

export async function loadBoatConfig(deps) {
  const doc = deps.doc;
  try {
    const cfg = await boatConfigLink(deps).readConfig();
    doc.getElementById('setup-boat-config').value =
        JSON.stringify(cfg, null, 1);
    doc.getElementById('setup-boat-status').textContent =
        'Loaded the boat\'s current tunables. Edit and push; the boat ' +
        'validates and persists them (NVS).';
    return true;
  } catch (err) {
    doc.getElementById('setup-boat-status').textContent =
        `Load failed: ${err && err.message ? err.message : err}`;
    return false;
  }
}

export async function pushBoatConfig(deps) {
  const doc = deps.doc;
  let patch = null;
  try {
    patch = JSON.parse(doc.getElementById('setup-boat-config').value);
  } catch (err) {
    doc.getElementById('setup-boat-status').textContent =
        'That is not valid JSON.';
    return false;
  }
  try {
    const out = await boatConfigLink(deps).writeConfig(patch);
    doc.getElementById('setup-boat-status').textContent =
        `Boat accepted and stored ${out.fields} field(s).`;
    return true;
  } catch (err) {
    doc.getElementById('setup-boat-status').textContent =
        `Boat refused the config: ${err && err.message ? err.message
                                                       : err}`;
    return false;
  }
}

export function initSetup(deps, state, defaults) {
  const doc = deps.doc;
  fillSetupForm(doc, state.profile);
  doc.getElementById('setup-save').addEventListener('click',
      () => saveSetup(deps, state));
  doc.getElementById('setup-boat-url').value = DEFAULT_BOAT_URL;
  doc.getElementById('setup-boat-load').addEventListener('click',
      () => loadBoatConfig(deps));
  doc.getElementById('setup-boat-push').addEventListener('click',
      () => pushBoatConfig(deps));
  doc.getElementById('setup-reset').addEventListener('click', () => {
    state.profile = { ...defaults };
    try {
      deps.storage.removeItem(PROFILE_STORAGE_KEY);
    } catch (err) { /* nothing stored */ }
    fillSetupForm(doc, state.profile);
    doc.getElementById('setup-status').textContent =
        'Back to the built-in reference profile.';
  });
}
