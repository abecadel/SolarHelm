// SAFE / POSSIBLE / INFEASIBLE plan labeling
// (docs/GLOBAL_ADAPTIVE_ROUTE_PLANNER_RESEARCH.md §SAFE vs POSSIBLE).
// V1 implements the gates whose inputs exist today; the report of gates
// passed/failed IS the label's explanation and is always shown.

export const HARD_FLOOR_PCT = 10;
// Below this speed-through-water the rudder loses authority in waves and
// current — energy optimization must never plan a leg it cannot steer
// (docs/case-studies/HELIOS_11_LESSONS.md L12).
export const MIN_STEERAGE_KMH = 2.5;

export function assessPlan(input) {
  const {
    feasible,
    coverage,            // from providers.coverageScore()
    forecastAgeH = 0,    // age of the cached forecast at planning time
    currentDataPresent,  // currents from a live provider?
    currentPenaltyApplied = false, // explicit adverse-current margin used?
    socQuantiles,        // from arrivalSocQuantiles()
    reserveSocPct,
    hardFloorPct = HARD_FLOOR_PCT,
    minStwKmh,           // slowest planned moving STW; undefined = no plan
    minSteerageKmh = MIN_STEERAGE_KMH,
  } = input;

  if (!feasible) {
    return {
      label: 'INFEASIBLE',
      gates: [{ id: 'reachable', pass: false,
                detail: 'destination unreachable within the window' }],
    };
  }

  const gates = [];
  const windWaves = Math.min(coverage.perVar.wind.confidence,
                             coverage.perVar.waves.confidence);
  gates.push({
    id: 'forecast-coverage', pass: windWaves >= 0.8,
    detail: `wind ${coverage.perVar.wind.label}, ` +
            `waves ${coverage.perVar.waves.label}`,
  });
  gates.push({
    id: 'freshness', pass: forecastAgeH <= 12,
    detail: `forecast age ${forecastAgeH.toFixed(1)} h (limit 12 h)`,
  });
  gates.push({
    id: 'current-data', pass: !!currentDataPresent || currentPenaltyApplied,
    detail: currentDataPresent
        ? `currents ${coverage.perVar.currents.label}`
        : currentPenaltyApplied
            ? 'no current data; adverse-current penalty applied'
            : 'no current data and no penalty margin',
  });
  gates.push({
    id: 'reserve', pass: true, // the DP refuses sub-reserve nominal plans
    detail: `nominal plan holds SOC >= ${reserveSocPct}% by construction`,
  });
  gates.push({
    id: 'adverse-arrival',
    pass: socQuantiles.conservativePct >= hardFloorPct,
    detail: `conservative arrival ${socQuantiles.conservativePct.toFixed(0)}%` +
            ` vs hard floor ${hardFloorPct}%`,
  });
  gates.push({
    id: 'steerage',
    pass: minStwKmh === undefined || minStwKmh >= minSteerageKmh,
    detail: minStwKmh === undefined
        ? 'not evaluated (no motion data in the plan)'
        : `slowest planned leg ${minStwKmh.toFixed(1)} km/h vs minimum ` +
          `steerage ${minSteerageKmh.toFixed(1)} km/h`,
  });
  gates.push({
    id: 'calibrated-uncertainty', pass: !!socQuantiles.calibrated,
    detail: socQuantiles.calibrated
        ? 'error quantiles calibrated from logged voyages'
        : 'no voyage history yet - conservative defaults in use',
  });

  const allPass = gates.every((g) => g.pass);
  return { label: allPass ? 'SAFE' : 'POSSIBLE', gates };
}
