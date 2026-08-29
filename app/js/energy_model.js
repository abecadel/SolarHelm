// SolarHelm energy model — the JavaScript twin of the C++ boat model.
//
// Shared by the companion planner PWA and the website calculator so both
// agree with the simulator about what the boat is. The boat profile comes
// from config/boat_profile.json (single source of truth); the hull curve
// maths mirrors lib/simcore/src/simc/boat_profile.cpp.
//
// All functions are pure — no DOM, no fetch, no globals.

/** Electrical power (W) needed to hold speed (km/h) on the hull curve. */
export function powerForSpeedW(curve, speedKmh) {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (speedKmh <= 0) return 0;
  if (speedKmh <= first[0]) {
    const p0 = first[1] * first[0];
    const r = speedKmh / first[0];
    return p0 * r * r * r;
  }
  if (speedKmh >= last[0]) {
    const pn = last[1] * last[0];
    const r = speedKmh / last[0];
    return pn * r * r * r;
  }
  for (let i = 1; i < curve.length; i++) {
    if (speedKmh <= curve[i][0]) {
      const [va, wa] = curve[i - 1];
      const [vb, wb] = curve[i];
      const f = (speedKmh - va) / (vb - va);
      const whkm = wa + f * (wb - wa);
      return whkm * speedKmh;
    }
  }
  /* c8 ignore next -- unreachable: loop always returns for interior speeds */
  return last[1] * last[0];
}

/** Steady-state speed (km/h) for a given electrical power (W). */
export function speedForPowerKmh(curve, powerW) {
  if (powerW <= 0) return 0;
  const first = curve[0];
  const last = curve[curve.length - 1];
  const pFirst = first[1] * first[0];
  const pLast = last[1] * last[0];
  if (powerW <= pFirst) return first[0] * Math.cbrt(powerW / pFirst);
  if (powerW >= pLast) return last[0] * Math.cbrt(powerW / pLast);
  for (let i = 1; i < curve.length; i++) {
    const pa = curve[i - 1][1] * curve[i - 1][0];
    const pb = curve[i][1] * curve[i][0];
    if (powerW <= pb) {
      const f = (powerW - pa) / (pb - pa);
      return curve[i - 1][0] + f * (curve[i][0] - curve[i - 1][0]);
    }
  }
  /* c8 ignore next -- unreachable: loop always returns for interior powers */
  return last[0];
}

/** Wh/km at a given speed, headwind-adjusted.
 *  ASSUMPTION (placeholder until sea-trial data): each m/s of headwind adds
 *  ~4% to consumption; tailwind is credited at half that rate. */
export function whPerKmAt(curve, speedKmh, headwindMs = 0) {
  if (speedKmh <= 0) return 0;
  const base = powerForSpeedW(curve, speedKmh) / speedKmh;
  const factor = headwindMs >= 0 ? 1 + 0.04 * headwindMs
                                 : 1 / (1 + 0.02 * -headwindMs);
  return base * factor;
}

/** PV power (W) from global horizontal irradiance (W/m^2). */
export function pvPowerW(profile, ghiWm2) {
  if (ghiWm2 <= 0) return 0;
  return profile.pv_kwp * 1000 * profile.pv_derating * (ghiWm2 / 1000);
}

/** Solar elevation angle (radians, <= 0 means below horizon).
 *  Standard declination + hour-angle formula; good to ~1 degree, plenty for
 *  an offline clear-sky fallback. hourUtc is fractional. */
export function solarElevationRad(latDeg, dayOfYear, hourUtc, lonDeg) {
  const rad = Math.PI / 180;
  const decl = -23.44 * rad * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const solarHour = hourUtc + lonDeg / 15; // approximate local solar time
  const hourAngle = (solarHour - 12) * 15 * rad;
  const lat = latDeg * rad;
  const sinElev = Math.sin(lat) * Math.sin(decl) +
                  Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  return Math.asin(sinElev);
}

/** Clear-sky GHI estimate (W/m^2) from solar elevation. */
export function clearSkyGhiWm2(elevationRad) {
  if (elevationRad <= 0) return 0;
  const s = Math.sin(elevationRad);
  // ~1050 W/m^2 peak with a gentle air-mass attenuation exponent.
  return 1050 * Math.pow(s, 1.15);
}

/** One battery step. Returns the new SOC (%), clamped to [0, 100].
 *  netW: + charging, - discharging (project-wide sign convention). */
export function stepSocPct(profile, socPct, netW, dtH) {
  const capWh = profile.battery_capacity_kwh * 1000;
  const eff = netW > 0 ? 0.97 : 1.0;
  let soc = socPct + (netW * eff * dtH / capWh) * 100;
  if (soc > 100) soc = 100;
  if (soc < 0) soc = 0;
  return soc;
}

/** Usable energy (Wh) above a reserve SOC. */
export function usableWhAboveReserve(profile, socPct, reservePct) {
  const capWh = profile.battery_capacity_kwh * 1000;
  const margin = (socPct - reservePct) / 100;
  return margin > 0 ? margin * capWh : 0;
}

/** The most efficient cruising speed on the curve (lowest Wh/km). */
export function bestEfficiencySpeedKmh(curve) {
  let best = curve[0];
  for (const p of curve) {
    if (p[1] < best[1]) best = p;
  }
  return best[0];
}
