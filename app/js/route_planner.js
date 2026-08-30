// Route planner — forward DP over (segment, time bucket) with value =
// max arrival SOC (docs/GLOBAL_ADAPTIVE_ROUTE_PLANNER_RESEARCH.md).
//
// Key structure: at the same (segment, time), more SOC is never worse, so
// one scalar per cell carries the whole Pareto frontier; the destination
// row IS the arrival-time -> best-SOC tradeoff, and waiting (P = 0) at
// anchorable segments makes departure sweeps and solar stops emerge from
// the same pass. Chronological sweep — the graph is a DAG in time.
//
// Physics per transition (V1 — placeholder aero/wave residuals until the
// vessel model has learned its own, see ADAPTIVE_ENERGY_MODEL doc):
//   STW from the learned hull curve at the hull's share of power
//   aero drag from apparent headwind on CdA_front (prior 1.2 m2)
//   wave penalty ~ kWave*Hs^2*headFactor (STAwave-shaped, learned later)
//   SOG from STW (+) current vector with crab compensation
//   SOC from PV - propulsion - hotel with charge efficiency
// Conservative rounding: traverse time rounded UP to buckets, SOC clamped.

import { pvPowerW, stepSocPct } from './energy_model.js';
import { hullPowerW, hullSpeedKmh } from './vessel_model.js';

const DEG = Math.PI / 180;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * DEG) * Math.cos(lat2 * DEG);
  const x = Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
            Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) *
            Math.cos((lon2 - lon1) * DEG);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/** Splits waypoints [{lat, lon, anchorable?}] into segments no longer
 *  than maxSegmentKm. A segment inherits `anchorable` from its start
 *  waypoint. Returns [{lat, lon, lengthKm, bearing, anchorable}]. */
export function segmentRoute(waypoints, maxSegmentKm = 2.0) {
  const segments = [];
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const legKm = haversineKm(a.lat, a.lon, b.lat, b.lon);
    const brg = bearingDeg(a.lat, a.lon, b.lat, b.lon);
    const parts = Math.max(1, Math.ceil(legKm / maxSegmentKm));
    for (let p = 0; p < parts; p++) {
      const f = p / parts;
      segments.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        lengthKm: legKm / parts,
        bearing: brg,
        anchorable: p === 0 ? !!a.anchorable : false,
      });
    }
  }
  return segments;
}

/** SOG along track (km/h) for a boat crabbing to hold `bearing` at STW
 *  through a current (dir = TO, oceanographic). 0 when the boat cannot
 *  stem the cross-current. */
export function groundSpeedKmh(stwKmh, bearing, currentMs, currentDirDeg) {
  const cKmh = currentMs * 3.6;
  const rel = (currentDirDeg - bearing) * DEG;
  const along = cKmh * Math.cos(rel);
  const cross = cKmh * Math.sin(rel);
  const stemmed = stwKmh * stwKmh - cross * cross;
  if (stemmed <= 0) return 0;
  const sog = Math.sqrt(stemmed) + along;
  return sog > 0 ? sog : 0;
}

/** Extra electrical power (W) demanded by apparent headwind. */
export function aeroExtraW(stwKmh, windMs, windDirDeg, bearing,
                           cdaFrontM2 = 1.2) {
  // wind dir = FROM; head component positive when blowing against travel.
  const headMs = windMs * Math.cos((windDirDeg - bearing) * DEG);
  const appAlongMs = stwKmh / 3.6 + headMs;
  if (appAlongMs <= 0) return 0;
  const forceN = 0.5 * 1.225 * cdaFrontM2 * appAlongMs * appAlongMs;
  return forceN * (stwKmh / 3.6);
}

/** STAwave-shaped placeholder wave penalty (W); learned residual later. */
export function waveExtraW(stwKmh, waveHsM, waveDirDeg, bearing,
                           kWave = 400) {
  const headFactor = Math.max(0, Math.cos((waveDirDeg - bearing) * DEG));
  return kWave * waveHsM * waveHsM * headFactor * (stwKmh / 3.6);
}

/** Solves the self-consistent STW at total propulsion power P under wind
 *  and waves (fixed-point on the hull share; a handful of iterations). */
export function solveStwKmh(vessel, powerW, env, bearing) {
  let stw = hullSpeedKmh(vessel.curve, powerW);
  for (let i = 0; i < 6; i++) {
    const extras = aeroExtraW(stw, env.windMs, env.windDirDeg, bearing,
                              vessel.cdaFrontM2 ?? 1.2) +
                   waveExtraW(stw, env.waveHsM, env.waveDirDeg, bearing);
    const hullShare = powerW - extras;
    stw = hullShare > 0 ? hullSpeedKmh(vessel.curve, hullShare) : 0;
    if (stw === 0) break;
  }
  return stw;
}

export const DEFAULT_PLAN_OPTIONS = {
  timeStepMin: 10,
  windowH: 48,
  startSocPct: 90,
  reserveSocPct: 25,
  requiredArrivalSocPct: 30,
  objective: 'maxSoc', // 'maxSoc' | 'earliest'
  powerFractions: [0.2, 0.35, 0.5, 0.65, 0.85, 1.0],
  // Optional (segment, index) -> multiplier from geographic residual
  // learning: >1 means the boat historically needs more power here, so
  // less of the drawn power turns into speed.
  segPowerFactor: null,
};

/**
 * The DP. segments from segmentRoute(); envAt(segIdx, hourIndexFloat) must
 * return an environment sample (planner interpolates hour index from time);
 * departTime is the t=0 wall clock. Returns {feasible, plan, arrivalRow,
 * summary} — see tests for the shapes.
 */
export function planVoyage(vessel, segments, envAt, departTime, options) {
  const opt = { ...DEFAULT_PLAN_OPTIONS, ...options };
  const S = segments.length;         // node S = destination
  const stepH = opt.timeStepMin / 60;
  const T = Math.ceil(opt.windowH / stepH);
  const powers = opt.powerFractions.map((f) => f * vessel.motorMaxW);
  const profile = { pv_kwp: vessel.pvKwp, pv_derating: vessel.pvDerating,
                    battery_capacity_kwh: vessel.batteryKwh };

  // maxSOC[node][t]; node 0..S.
  const soc = Array.from({ length: S + 1 },
                         () => new Float64Array(T + 1).fill(-1));
  const back = Array.from({ length: S + 1 }, () => new Array(T + 1));
  soc[0][0] = opt.startSocPct;

  const hourAt = (t) => t * stepH;

  for (let t = 0; t < T; t++) {
    for (let s = 0; s <= S; s++) {
      const cur = soc[s][t];
      if (cur < 0) continue;
      const env = envAt(Math.min(s, S - 1), hourAt(t));

      // Wait (P=0): allowed at the dock (s=0, departure sweep) and at
      // anchorable segments; solar charges, hotel draws.
      const canWait = s === 0 || (s < S && segments[s].anchorable);
      if (canWait) {
        const pvW = pvPowerW(profile, env.ghiWm2);
        const next = Math.min(100, stepSocPct(profile, cur,
                                              pvW - vessel.hotelW, stepH));
        if (next > soc[s][t + 1]) {
          soc[s][t + 1] = next;
          back[s][t + 1] = { fromS: s, fromT: t, powerW: 0 };
        }
      }

      if (s === S) continue; // destination: nothing further to expand

      const geoFactor =
          opt.segPowerFactor ? opt.segPowerFactor(segments[s], s) : 1.0;
      for (const powerW of powers) {
        const stw = solveStwKmh(vessel, powerW / geoFactor, env,
                                segments[s].bearing);
        const sog = groundSpeedKmh(stw, segments[s].bearing, env.currentMs,
                                   env.currentDirDeg);
        if (sog < 0.3) continue; // cannot make way against the water
        const travelH = segments[s].lengthKm / sog;
        const dt = Math.max(1, Math.ceil(travelH / stepH)); // round UP
        const t2 = t + dt;
        if (t2 > T) continue;
        const pvW = pvPowerW(profile, env.ghiWm2);
        const netW = pvW - powerW - vessel.hotelW;
        const next = stepSocPct(profile, cur, netW, travelH);
        if (next < opt.reserveSocPct) continue; // nominal plan keeps reserve
        if (next > soc[s + 1][t2]) {
          soc[s + 1][t2] = next;
          back[s + 1][t2] = { fromS: s, fromT: t, powerW, sogKmh: sog,
                              stwKmh: stw };
        }
      }
    }
  }

  // Arrival row = the Pareto curve arrival-time -> best SOC.
  const arrivalRow = [];
  for (let t = 0; t <= T; t++) {
    if (soc[S][t] >= 0) {
      arrivalRow.push({ t, timeMs: departTime.getTime() + t * stepH * 3.6e6,
                        socPct: soc[S][t] });
    }
  }
  if (arrivalRow.length === 0) {
    return { feasible: false, arrivalRow, plan: null,
             summary: { reason: 'destination unreachable within window' } };
  }

  // Objective selection.
  let pick = arrivalRow[0];
  if (opt.objective === 'earliest') {
    pick = arrivalRow.find((a) => a.socPct >= opt.requiredArrivalSocPct) ??
           arrivalRow.reduce((b, a) => (a.socPct > b.socPct ? a : b));
  } else {
    pick = arrivalRow.reduce((b, a) => (a.socPct > b.socPct ? a : b));
  }

  // Reconstruct the plan.
  const steps = [];
  let s = S;
  let t = pick.t;
  while (!(s === 0 && t === 0)) {
    const b = back[s][t];
    steps.push({
      fromS: b.fromS, toS: s, tStart: b.fromT, tEnd: t, powerW: b.powerW,
      sogKmh: b.sogKmh ?? 0, stwKmh: b.stwKmh ?? 0,
      socAfterPct: soc[s][t], wait: b.powerW === 0,
    });
    s = b.fromS;
    t = b.fromT;
  }
  steps.reverse();

  const departStep = steps.find((st) => !st.wait || st.fromS !== 0);
  const solarStops = steps.filter((st) => st.wait && st.fromS !== 0);
  const summary = {
    arrivalSocPct: pick.socPct,
    arrivalTimeMs: pick.timeMs,
    bestDepartureBucket: departStep ? departStep.tStart : 0,
    departureDelayH: (departStep ? departStep.tStart : 0) * stepH,
    solarStopBuckets: solarStops.length,
    distanceKm: segments.reduce((a, g) => a + g.lengthKm, 0),
  };
  return { feasible: true, plan: steps, arrivalRow, summary };
}

/** Day-level energy ledger for a plan (docs/HELIOS_11_LESSONS.md L7:
 *  "the day is the unit of energy"). Buckets plan steps into 24 h days
 *  from departure; returns [{day, distanceKm, solarKwh, propKwh,
 *  hotelKwh, netKwh}]. */
export function planLedger(vessel, segments, plan, envAt,
                           timeStepMin = 10) {
  const stepH = timeStepMin / 60;
  const profile = { pv_kwp: vessel.pvKwp, pv_derating: vessel.pvDerating };
  const days = [];
  for (const st of plan) {
    const midH = ((st.tStart + st.tEnd) / 2) * stepH;
    const day = Math.floor((st.tStart * stepH) / 24);
    if (!days[day]) {
      days[day] = { day: day + 1, distanceKm: 0, solarWh: 0, propWh: 0,
                    hotelWh: 0 };
    }
    const durH = (st.tEnd - st.tStart) * stepH;
    const env = envAt(Math.min(st.fromS, segments.length - 1), midH);
    days[day].solarWh += pvPowerW(profile, env.ghiWm2) * durH;
    days[day].propWh += st.powerW * durH;
    days[day].hotelWh += vessel.hotelW * durH;
    if (!st.wait) days[day].distanceKm += segments[st.fromS].lengthKm;
  }
  return days.filter(Boolean).map((d) => ({
    day: d.day,
    distanceKm: d.distanceKm,
    solarKwh: d.solarWh / 1000,
    propKwh: d.propWh / 1000,
    hotelKwh: d.hotelWh / 1000,
    netKwh: (d.solarWh - d.propWh - d.hotelWh) / 1000,
  }));
}

/** Applies calibrated error quantiles to the nominal arrival SOC.
 *  Adverse case: propulsion consumes quantiles.p90 relative energy more
 *  than predicted; optimistic: p10 less. Bucketed durations are already
 *  rounded up, so propulsion energy is a conservative overestimate. */
export function arrivalSocQuantiles(vessel, plan, summary, quantiles,
                                    timeStepMin = 10) {
  const capWh = vessel.batteryKwh * 1000;
  const stepH = timeStepMin / 60;
  const propWh = plan.reduce(
      (a, st) => a + st.powerW * (st.tEnd - st.tStart) * stepH, 0);
  const expected = summary.arrivalSocPct;
  const adverseDropPct =
      Math.max(0, quantiles.p90) * (propWh / capWh) * 100;
  const optimisticGainPct =
      Math.max(0, -quantiles.p10) * (propWh / capWh) * 100;
  return {
    expectedPct: expected,
    conservativePct: Math.max(0, expected - adverseDropPct),
    optimisticPct: Math.min(100, expected + optimisticGainPct),
    calibrated: quantiles.calibrated,
  };
}
