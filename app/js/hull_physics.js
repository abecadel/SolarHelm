// Parametric hull physics — the JS port of tools/helios_sanity.py.
//
// Order-of-magnitude models for boats that do not exist yet (the Vessel
// Designer): ITTC-57 friction + a slenderness-scaled residuary hump,
// pushed through a load-dependent propulsive efficiency to honest
// battery-side watts. Boats that DO exist use their measured/learned
// hull curve instead (vessel_model.js) — a parametric prior never
// overrides telemetry (Helios lesson §8: the model under-predicted the
// real hull's near-hull-speed wall by ~2x; we document, not tune).

export const RHO_W = 1025.0; // kg/m^3 seawater
const NU = 1.19e-6;          // m^2/s kinematic viscosity
const G = 9.81;
const P_FIXED_W = 25.0;      // controller idle/aux losses

/** Propulsive efficiency vs load: ~0.28 near zero load rising to ~0.52
 *  when the prop works near its design point. */
export function etaProp(towW) {
  return 0.28 + 0.24 * (1.0 - Math.exp(-towW / 400.0));
}

/** Battery-side propulsion power for a given towing power. */
export function electricW(towW) {
  if (towW <= 0) return 0;
  return towW / etaProp(towW) + P_FIXED_W;
}

/** Classic wetted-surface approximation S = c * sqrt(V * L). */
export function wettedSurfaceM2(dispKg, lwlM, c = 2.6) {
  return c * Math.sqrt((dispKg / RHO_W) * lwlM);
}

/** ITTC-57 frictional resistance [N]. */
export function frictionN(speedMs, lwlM, wettedM2, formFactor = 1.12) {
  if (speedMs <= 0) return 0;
  const re = (speedMs * lwlM) / NU;
  const cf = 0.075 / ((Math.log10(re) - 2.0) ** 2);
  return 0.5 * RHO_W * cf * wettedM2 * speedMs * speedMs * formFactor;
}

/** Slenderness L/∇^(1/3) of ONE hull (derived, never entered — the
 *  powercat doc's schema rule). */
export function slenderness(lwlM, dispKg, hullCount = 1) {
  const vol = dispKg / hullCount / RHO_W;
  return lwlM / Math.cbrt(vol);
}

/** Hull Froude number at a given speed. */
export function froudeNumber(speedKmh, lwlM) {
  return speedKmh / 3.6 / Math.sqrt(G * lwlM);
}

/** Crude slenderness-scaled residuary (wave-making) resistance [N]:
 *  ~Fn^4 toward the hump, /slenderness^2 so long-and-light pays less. */
export function residuaryN(speedMs, lwlM, perHullDispKg) {
  const slender = slenderness(lwlM, perHullDispKg);
  const fn = speedMs / Math.sqrt(G * lwlM);
  return ((3.0e5 * perHullDispKg) / 1000.0) * fn ** 4 / (slender * slender);
}

/** Calm-water towing resistance [N], all hulls. */
export function calmTowN(speedMs, lwlM, dispKg, hullCount = 1) {
  const perHull = dispKg / hullCount;
  const s = wettedSurfaceM2(perHull, lwlM);
  return hullCount * (frictionN(speedMs, lwlM, s) +
                      residuaryN(speedMs, lwlM, perHull));
}

/** Battery-side propulsion power [W] in calm water. */
export function calmElectricW(speedKmh, lwlM, dispKg, hullCount = 1) {
  const v = speedKmh / 3.6;
  return electricW(calmTowN(v, lwlM, dispKg, hullCount) * v);
}

/**
 * The parametric hull curve in the app's shared [[km/h, Wh/km]] shape,
 * so a designed-but-unbuilt boat plugs into cruiseBandKmh, the planner
 * and the calculator exactly like a measured one.
 */
export function parametricCurve({ lwlM, displacementKg, hullCount = 1 },
                                speedsKmh = [3, 4, 5, 6, 7, 8, 9]) {
  return speedsKmh.map((v) => {
    const w = calmElectricW(v, lwlM, displacementKg, hullCount);
    return [v, w / v];
  });
}
