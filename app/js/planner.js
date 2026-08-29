// Trip prediction engine.
//
// Simulates a planned trip hour by hour against a weather/solar forecast and
// the boat profile: PV production, propulsion consumption (hull curve +
// headwind penalty), hotel load and battery SOC with the same reserve-floor
// philosophy as the firmware. Purely advisory — this code never commands a
// throttle; the C++ core on the boat is the only control authority.
//
// Pure functions only; no DOM, no fetch.

import {
  powerForSpeedW,
  pvPowerW,
  speedForPowerKmh,
  stepSocPct,
  whPerKmAt,
} from './energy_model.js';

export const DEFAULT_OPTIONS = {
  distanceKm: 40,        // planned trip distance
  days: 2,               // planning horizon
  cruiseStartHourUtc: 6, // daily cruising window (UTC)
  cruiseEndHourUtc: 18,
  mode: 'solar',         // 'solar' (float with the sun) | 'fixed'
  fixedSpeedKmh: 5,      // used when mode === 'fixed'
  startSocPct: 90,
  reserveSocPct: 25,
  headwindMs: 0,         // + headwind, - tailwind (route average fallback)
};

const SUBSTEPS_PER_HOUR = 4;

/** Simulates the trip. forecastHours: [{time, ghiWm2, windMs, ...}].
 *  Returns { steps, summary }. */
export function planTrip(profile, options, forecastHours) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const steps = [];
  let socPct = opt.startSocPct;
  let distanceKm = 0;
  let pvWh = 0;
  let motorWh = 0;
  let hotelWh = 0;
  let arrivalTime = null;
  const perDay = [];

  for (let i = 0; i < forecastHours.length; i++) {
    const h = forecastHours[i];
    const hour = h.time.getUTCHours();
    const day = Math.floor(i / 24);
    if (!perDay[day]) {
      perDay[day] = { distanceKm: 0, pvWh: 0, motorWh: 0 };
    }
    const cruising = hour >= opt.cruiseStartHourUtc &&
                     hour < opt.cruiseEndHourUtc &&
                     (arrivalTime === null);
    const dtH = 1 / SUBSTEPS_PER_HOUR;
    let stepMotorW = 0;
    let stepSpeed = 0;
    for (let s = 0; s < SUBSTEPS_PER_HOUR; s++) {
      const pvW = pvPowerW(profile, h.ghiWm2);
      let motorW = 0;
      let speedKmh = 0;
      if (cruising && arrivalTime === null) {
        const atReserve = socPct <= opt.reserveSocPct;
        if (opt.mode === 'fixed' && !atReserve) {
          speedKmh = opt.fixedSpeedKmh;
          motorW = powerForSpeedW(profile.hull_efficiency_curve_kmh_whkm,
                                  speedKmh) *
                   (whPerKmAt(profile.hull_efficiency_curve_kmh_whkm,
                              speedKmh, h.windMs) /
                    whPerKmAt(profile.hull_efficiency_curve_kmh_whkm,
                              speedKmh, 0));
        } else {
          // SOLAR float (also the fallback at the reserve floor): spend
          // what the sun provides after the hotel load.
          motorW = pvW - profile.hotel_load_w;
          if (motorW < 0) motorW = 0;
          if (motorW > profile.motor_max_power_w) {
            motorW = profile.motor_max_power_w;
          }
          // Headwind eats into achieved speed via the adjusted curve.
          const effW = motorW /
              (whPerKmAt(profile.hull_efficiency_curve_kmh_whkm, 5, h.windMs) /
               whPerKmAt(profile.hull_efficiency_curve_kmh_whkm, 5, 0));
          speedKmh = speedForPowerKmh(
              profile.hull_efficiency_curve_kmh_whkm, effW);
        }
        const battW = pvW - motorW - profile.hotel_load_w;
        const nextSoc = stepSocPct(profile, socPct, battW, dtH);
        // Reserve floor: a fixed-speed plan may not draw below reserve —
        // drop to solar float for the rest of this step.
        if (opt.mode === 'fixed' && nextSoc < opt.reserveSocPct &&
            battW < 0) {
          motorW = Math.max(0, Math.min(pvW - profile.hotel_load_w,
                                        profile.motor_max_power_w));
          speedKmh = speedForPowerKmh(
              profile.hull_efficiency_curve_kmh_whkm, motorW);
          socPct = stepSocPct(profile, socPct,
                              pvW - motorW - profile.hotel_load_w, dtH);
        } else {
          socPct = nextSoc;
        }
        distanceKm += speedKmh * dtH;
        perDay[day].distanceKm += speedKmh * dtH;
        if (distanceKm >= opt.distanceKm && arrivalTime === null) {
          arrivalTime = new Date(h.time.getTime() +
                                 (s + 1) * (3600000 / SUBSTEPS_PER_HOUR));
        }
      } else {
        // Moored: PV still charges, hotel still draws.
        const battW = pvW - profile.hotel_load_w;
        socPct = stepSocPct(profile, socPct, battW, dtH);
      }
      pvWh += pvPowerW(profile, h.ghiWm2) * dtH;
      motorWh += motorW * dtH;
      hotelWh += profile.hotel_load_w * dtH;
      perDay[day].pvWh += pvPowerW(profile, h.ghiWm2) * dtH;
      perDay[day].motorWh += motorW * dtH;
      stepMotorW += motorW / SUBSTEPS_PER_HOUR;
      stepSpeed += speedKmh / SUBSTEPS_PER_HOUR;
    }
    steps.push({
      time: h.time,
      pvW: pvPowerW(profile, h.ghiWm2),
      motorW: stepMotorW,
      speedKmh: stepSpeed,
      socPct,
      distanceKm,
      windMs: h.windMs,
      cruising,
    });
  }

  const summary = {
    tripFits: arrivalTime !== null,
    arrivalTime,
    distanceCoveredKm: distanceKm,
    plannedDistanceKm: opt.distanceKm,
    finalSocPct: socPct,
    minSocPct: Math.min(...steps.map((s) => s.socPct)),
    pvKwh: pvWh / 1000,
    motorKwh: motorWh / 1000,
    hotelKwh: hotelWh / 1000,
    perDay: perDay.map((d, i) => ({
      day: i + 1,
      distanceKm: d.distanceKm,
      pvKwh: d.pvWh / 1000,
      motorKwh: d.motorWh / 1000,
    })),
  };
  return { steps, summary };
}

/** Fits an empirical Wh/km curve from telemetry CSV text (the simulator /
 *  firmware log format). Buckets samples by speed (0.5 km/h bins), takes the
 *  median Wh/km per bin, and returns [[speedKmh, whPerKm], ...] usable as a
 *  hull_efficiency_curve. Returns null when there is not enough data. */
export function fitCurveFromTelemetryCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].split(',');
  const iSpeed = header.indexOf('speed_kmh');
  const iMotor = header.indexOf('motor_estimated_power_w');
  if (iSpeed < 0 || iMotor < 0) return null;
  const bins = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const speed = parseFloat(cols[iSpeed]);
    const motorW = parseFloat(cols[iMotor]);
    if (!(speed > 1.0) || !(motorW > 10)) continue; // ignore drift/idle
    const bin = Math.round(speed * 2) / 2;
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin).push(motorW / speed);
  }
  const points = [];
  for (const [speed, samples] of [...bins.entries()].sort((a, b) => a[0] - b[0])) {
    if (samples.length < 5) continue; // too little data in this bin
    samples.sort((a, b) => a - b);
    points.push([speed, samples[Math.floor(samples.length / 2)]]);
  }
  return points.length >= 2 ? points : null;
}

/** Maximum distance achievable in the horizon if the whole battery margin
 *  above reserve plus all forecast PV goes into propulsion at the boat's
 *  best-efficiency speed. An optimistic bound shown next to the plan. */
export function maxRangeEstimateKm(profile, options, forecastHours) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const capWh = profile.battery_capacity_kwh * 1000;
  const battWh = Math.max(0, (opt.startSocPct - opt.reserveSocPct) / 100) *
                 capWh;
  let pvWh = 0;
  let cruiseHours = 0;
  for (const h of forecastHours) {
    const hour = h.time.getUTCHours();
    if (hour >= opt.cruiseStartHourUtc && hour < opt.cruiseEndHourUtc) {
      pvWh += pvPowerW(profile, h.ghiWm2);
      cruiseHours += 1;
    }
  }
  const hotelWh = profile.hotel_load_w * forecastHours.length;
  const curve = profile.hull_efficiency_curve_kmh_whkm;
  let bestWhKm = Infinity;
  let bestSpeed = 0;
  for (const [speed, whkm] of curve) {
    if (whkm < bestWhKm) {
      bestWhKm = whkm;
      bestSpeed = speed;
    }
  }
  const usableWh = Math.max(0, battWh + pvWh - hotelWh);
  const byEnergyKm = usableWh / bestWhKm;
  const byTimeKm = cruiseHours * bestSpeed;
  return Math.min(byEnergyKm, byTimeKm);
}
