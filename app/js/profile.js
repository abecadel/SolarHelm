// Boat profile access for the PWA.
//
// The single source of truth is config/boat_profile.json in the repository
// (served next to the app). DEFAULT_PROFILE below is the offline fallback;
// a unit test asserts it stays byte-equivalent to the JSON file.

export const DEFAULT_PROFILE = {
  schema_version: 1,
  config_revision: 1,
  config_change_note: 'initial reference configuration',
  name: 'SolarHelm reference launch (24 V prototype)',
  hull_efficiency_curve_kmh_whkm: [
    [3.0, 85.0],
    [4.1, 98.0],
    [5.0, 120.0],
    [5.7, 140.0],
    [6.3, 190.0],
    [7.0, 286.0],
  ],
  pv_kwp: 1.0,
  pv_derating: 0.78,
  battery_capacity_kwh: 2.56,
  battery_usable_min_soc_pct: 10.0,
  battery_max_charge_w: 1200.0,
  battery_max_discharge_w: 2500.0,
  hotel_load_w: 60.0,
  motor_max_power_w: 1164.0,
};

/** Minimal sanity check for a (possibly user-modified) profile object. */
export function profileValid(p) {
  return !!p && p.schema_version === 1 &&
         Array.isArray(p.hull_efficiency_curve_kmh_whkm) &&
         p.hull_efficiency_curve_kmh_whkm.length >= 2 &&
         p.pv_kwp > 0 && p.pv_derating > 0 && p.pv_derating <= 1 &&
         p.battery_capacity_kwh > 0 && p.hotel_load_w >= 0 &&
         p.motor_max_power_w > 0;
}

/** Loads the shared profile JSON, falling back to DEFAULT_PROFILE. */
export async function loadProfile(fetchImpl, url = '../config/boat_profile.json') {
  try {
    const resp = await fetchImpl(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const p = await resp.json();
    if (!profileValid(p)) throw new Error('invalid profile');
    return { profile: p, source: 'config' };
  } catch (err) {
    return { profile: DEFAULT_PROFILE, source: 'builtin' };
  }
}
