// Feasibility & cost calculator model (pure functions; used by the website
// calculator page and unit-tested in node).
//
// Answers: "with X watts of panels, Y kWh of battery and boat class Z, what
// can a SolarHelm boat actually do, and what does the build cost?"
//
// Speeds/energies reuse the same physics as the planner (energy_model.js).
// Costs are reference prices in PLN from docs/BUYING_GUIDE.md (see the date
// there); treat them as budgetary estimates, not quotes.

import {
  clearSkyGhiWm2,
  solarElevationRad,
  speedForPowerKmh,
} from './energy_model.js';
import { DEFAULT_PROFILE } from './profile.js';

/** Boat drag classes: scale factors on the reference hull curve's Wh/km. */
export const BOAT_CLASSES = {
  dinghy: { label: 'Light dinghy / canoe (~150 kg loaded)', dragScale: 0.7 },
  launch: { label: 'Small launch (reference, ~400 kg loaded)', dragScale: 1.0 },
  pontoon: { label: 'Pontoon / heavy daysailer (~900 kg)', dragScale: 1.7 },
};

/** Reference component prices in PLN (docs/BUYING_GUIDE.md, snapshot
 *  2026-08-29; EUR at 4.34 PLN). */
export const COSTS_PLN = {
  motor_drive: 990,        // Storm N86 24 V trolling motor (bezwiosel.pl)
  motor_controller: 879,   // Kelly KDS24100E (kellycontrollers.eu, EUR 202.46)
  controller_kit: 414,     // ESP32-S3 + GP8403 DAC + NEO-M8N + relay + misc
  shunt: 389,              // Victron SmartShunt 500 A IP65 (Ceneo floor)
  safety_kit: 434,         // SW80 contactor + ANL fuse + switch + kill switch
  battery_per_kwh: 750,    // 24 V LFP w/ 100 A BMS (WattCycle..LiTime band)
  panel_450w: 280,         // Jinko Tiger Neo 450 W wholesale (0.62 PLN/W)
  mppt_per_kw: 500,        // Victron SmartSolar 100/30 = 434 PLN per ~0.88 kW
  mounting_per_panel: 150, // rails/clamps/backing per panel
  dcdc_and_wiring: 500,    // DC/DC rails, marine cable, glands, enclosure
};

/** Scales the reference hull curve for a boat class. */
export function curveForClass(classKey) {
  const cls = BOAT_CLASSES[classKey] ?? BOAT_CLASSES.launch;
  return DEFAULT_PROFILE.hull_efficiency_curve_kmh_whkm
      .map(([v, whkm]) => [v, whkm * cls.dragScale]);
}

/** Hour-by-hour clear-sky June day at Split for a given array size. */
export function croatianJuneDayPvWh(pvWp, derating = 0.78) {
  let wh = 0;
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const elev = solarElevationRad(43.5, 172, h + 0.5, 16.4);
    const ghi = clearSkyGhiWm2(elev);
    const pvW = pvWp * derating * (ghi / 1000);
    hours.push(pvW);
    wh += pvW;
  }
  return { totalWh: wh, hours };
}

/** Full feasibility estimate.
 *  cfg: { classKey, pvWp, batteryKwh, hotelW } */
export function estimate(cfg) {
  const curve = curveForClass(cfg.classKey);
  const hotelW = cfg.hotelW ?? DEFAULT_PROFILE.hotel_load_w;
  const day = croatianJuneDayPvWh(cfg.pvWp);

  // Solar-only cruise speed at noon and averaged over usable sun hours.
  const noonPvW = Math.max(...day.hours);
  const cruiseNoonKmh = speedForPowerKmh(
      curve, Math.max(0, noonPvW - hotelW));

  // Distance over the day cruising purely on solar (battery power ~ 0).
  let kmPerDay = 0;
  let usableSunH = 0;
  for (const pvW of day.hours) {
    const motorW = Math.max(0, pvW - hotelW);
    if (motorW > 20) usableSunH += 1;
    kmPerDay += speedForPowerKmh(curve, motorW);
  }

  // Battery-only range at the most efficient speed (reserve 20%).
  let bestWhKm = Infinity;
  for (const [, whkm] of curve) bestWhKm = Math.min(bestWhKm, whkm);
  const batteryRangeKm = (cfg.batteryKwh * 1000 * 0.8) / bestWhKm;

  // Costs.
  const panels = Math.max(1, Math.round(cfg.pvWp / 450));
  const cost = {
    drive: COSTS_PLN.motor_drive + COSTS_PLN.motor_controller,
    control: COSTS_PLN.controller_kit + COSTS_PLN.shunt +
             COSTS_PLN.safety_kit,
    battery: Math.round(cfg.batteryKwh * COSTS_PLN.battery_per_kwh),
    solar: Math.round(panels * COSTS_PLN.panel_450w +
                      (cfg.pvWp / 1000) * COSTS_PLN.mppt_per_kw +
                      panels * COSTS_PLN.mounting_per_panel),
    installation: COSTS_PLN.dcdc_and_wiring,
  };
  const totalPln = cost.drive + cost.control + cost.battery + cost.solar +
                   cost.installation;

  return {
    curve,
    cruiseNoonKmh,
    kmPerDay,
    usableSunH,
    dayPvKwh: day.totalWh / 1000,
    batteryRangeKm,
    panels,
    cost,
    totalPln,
  };
}
