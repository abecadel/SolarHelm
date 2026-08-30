// Vessel Designer search — Helios lesson L8 made executable: maximize
// DAILY AUTONOMOUS DISTANCE subject to payload / stability / cost /
// reserve constraints, never Wh/km alone (the Wh/km-optimal boat rolled
// its builder into ballast and outriggers).
//
// Deterministic grid search over the powercat research envelope
// (docs/reference-vessels/SOLARHELM_LIGHT_POWERCAT.md §Research
// envelope), evaluated with the parametric hull law (hull_physics.js)
// through the SAME model chain a real boat uses: parametric curve →
// NNLS fit → EnergyKnee cruise speed → Split June solar day.
//
// Monohulls compete under the Helios comfort verdict encoded as a HARD
// constraint: a monohull above slenderness ~6 has no form stability at
// these displacements (Helios at 9.2 rolled into ballast and
// outriggers), and dead ballast fights the efficiency premise — so the
// search demonstrates L9's "multihulls are the structural answer"
// instead of assuming it: in the 700–1300 kg envelope no monohull is
// both slender enough to be efficient and beamy enough to be livable.

import { croatianJuneDayPvWh, COSTS_PLN } from './calculator_model.js';
import { parametricCurve, slenderness } from './hull_physics.js';
import { cruiseBandKmh, fitHullCurveNNLS,
         hullPowerW } from './vessel_model.js';
import { MIN_STEERAGE_KMH } from './voyage_safety.js';

// The research envelope (per-hull beam for cats is the headline
// variable; monohulls get form-stability beams instead).
export const ENVELOPE = {
  lwlM: [7, 8, 9, 10],
  displacementKg: [700, 1000, 1300],
  pvKwp: [2.5, 3.0, 3.5, 4.0],
  batteryKwh: [5, 10, 15],
  motorKw: [3, 4, 5, 6],
  hullCount: [1, 2],
};

// Waterline beam is DERIVED, not searched — it never enters the calm
// drag law (slenderness does), it only names the hull form: the cat's
// 0.5 m headline hull vs a conventional mono.
export const BEAM_WL_M = { 1: 1.9, 2: 0.5 };
export const MAX_MONO_COMFORT_SLENDERNESS = 6.0;

export const DEFAULT_CONSTRAINTS = {
  payloadKg: 250,   // crew + stores the boat must still carry
  budgetPln: null,  // no cap unless the user sets one
  hotelW: 150,
  cruiseWindowH: 10,  // hours underway per day
};

// Mass model (documented estimates, plywood/epoxy class — a bare
// slender cat hull is light; the bridgedeck/cabin/roof carries most of
// the structure):
const HULL_KG_PER_M = 25;       // one slender ply/epoxy hull
const PLATFORM_KG_PER_M = 35;   // cat bridgedeck + cabin + PV roof
const MONO_EXTRA_KG_PER_M = 45; // a beamy mono hull + roof, per metre
const BATTERY_KG_PER_KWH = 8;   // LFP pack
const PV_KG_PER_KWP = 55;       // rigid residential modules + rails
const MOTOR_KG_PER_KW = 3;

/** Everything that is not payload. */
export function structureMassKg(c) {
  const hulls = c.hullCount * c.lwlM * HULL_KG_PER_M;
  const deck = c.lwlM * (c.hullCount === 2 ? PLATFORM_KG_PER_M
                                           : MONO_EXTRA_KG_PER_M);
  return hulls + deck + c.batteryKwh * BATTERY_KG_PER_KWH +
         c.pvKwp * PV_KG_PER_KWP + c.motorKw * MOTOR_KG_PER_KW + 15;
}

/** Build cost from the buying-guide component prices, scaled. */
export function costPln(c) {
  const panels = Math.max(1, Math.round((c.pvKwp * 1000) / 450));
  return Math.round(
      (COSTS_PLN.motor_drive + COSTS_PLN.motor_controller) *
          (c.motorKw / 1.0) * 0.5 +
      COSTS_PLN.controller_kit + COSTS_PLN.shunt + COSTS_PLN.safety_kit +
      c.batteryKwh * COSTS_PLN.battery_per_kwh +
      panels * (COSTS_PLN.panel_450w + COSTS_PLN.mounting_per_panel) +
      c.pvKwp * COSTS_PLN.mppt_per_kw +
      COSTS_PLN.dcdc_and_wiring +
      c.hullCount * c.lwlM * 450);  // plywood/epoxy/glass materials per m
}

/**
 * Evaluates one candidate. Returns null when a constraint fails, else
 * the design with its daily-distance figure of merit and derived stats.
 */
export function evaluateCandidate(c, constraints = DEFAULT_CONSTRAINTS) {
  // Payload: the boat must float its mission, not just itself.
  const structKg = structureMassKg(c);
  const payloadKg = c.displacementKg - structKg;
  if (payloadKg < constraints.payloadKg) return null;

  // Stability/comfort (L8): a monohull's form stability comes from NOT
  // being slender; above ~6 it rolls (Helios: 9.2, 40–50% worse than a
  // sailboat, failed ballast, outriggers). Cats buy stability with hull
  // spacing instead, keeping per-hull slenderness 10+.
  const slender = slenderness(c.lwlM, c.displacementKg, c.hullCount);
  if (c.hullCount === 1 && slender > MAX_MONO_COMFORT_SLENDERNESS) {
    return null;
  }
  const spacingM = c.hullCount === 2 ? 0.35 * c.lwlM : 0;
  const beamWlM = BEAM_WL_M[c.hullCount];

  // Cost cap (optional).
  const cost = costPln(c);
  if (constraints.budgetPln && cost > constraints.budgetPln) return null;

  // The same model chain as a real boat: parametric curve -> NNLS ->
  // EnergyKnee, floored at steerage.
  const samples = parametricCurve(c).map(([v, whkm]) => ({
    stwKmh: v, powerW: whkm * v }));
  const curve = fitHullCurveNNLS(samples);
  const hotelW = constraints.hotelW;
  const band = cruiseBandKmh(curve, hotelW);
  const cruiseKmh = Math.max(band.kneeKmh, MIN_STEERAGE_KMH);
  const cruiseW = hullPowerW(curve, cruiseKmh);

  // Motor sizing: cruise power with a 2x headwind/wave reserve.
  if (c.motorKw * 1000 < 2 * cruiseW) return null;

  // Energy day (Split, June): solar pays hotel first; what remains
  // drives the boat inside the cruise window — daily balance >= 0, the
  // battery is a buffer, not a fuel tank.
  const day = croatianJuneDayPvWh(c.pvKwp * 1000);
  const dayPvWh = day.totalWh;
  const hotelWhDay = hotelW * 24;
  const budgetWh = dayPvWh - hotelWhDay;
  if (budgetWh <= 0) return null;
  const cruiseH = Math.min(constraints.cruiseWindowH, budgetWh / cruiseW);
  const dailyKm = cruiseKmh * cruiseH;

  // Reserve: 80% of the pack must cover the dark hours' hotel plus two
  // cloudy-morning cruise hours.
  const reserveWh = hotelW * 14 + 2 * cruiseW;
  if (c.batteryKwh * 1000 * 0.8 < reserveWh) return null;

  return {
    ...c, beamWlM, spacingM, payloadKg: Math.round(payloadKg),
    costPln: cost, slenderness: slender,
    cruiseKmh, cruiseW: Math.round(cruiseW),
    cruiseH, dailyKm: Math.round(dailyKm),
    dayPvKwh: dayPvWh / 1000, curve,
  };
}

/** All feasible designs in the envelope, best daily distance first. */
export function searchDesigns(constraints = DEFAULT_CONSTRAINTS) {
  const out = [];
  for (const hullCount of ENVELOPE.hullCount) {
    for (const lwlM of ENVELOPE.lwlM) {
      for (const displacementKg of ENVELOPE.displacementKg) {
        for (const pvKwp of ENVELOPE.pvKwp) {
          for (const batteryKwh of ENVELOPE.batteryKwh) {
            for (const motorKw of ENVELOPE.motorKw) {
              const d = evaluateCandidate(
                  { hullCount, lwlM, displacementKg, pvKwp,
                    batteryKwh, motorKw }, constraints);
              if (d) out.push(d);
            }
          }
        }
      }
    }
  }
  out.sort((a, b) => b.dailyKm - a.dailyKm || a.costPln - b.costPln);
  return out;
}

/** Cost/distance Pareto front (cheapest first, each strictly better). */
export function paretoFront(designs) {
  const byCost = designs.slice().sort(
      (a, b) => a.costPln - b.costPln || b.dailyKm - a.dailyKm);
  const front = [];
  let best = -Infinity;
  for (const d of byCost) {
    if (d.dailyKm > best) {
      front.push(d);
      best = d.dailyKm;
    }
  }
  return front;
}
