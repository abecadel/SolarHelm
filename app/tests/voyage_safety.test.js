import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HARD_FLOOR_PCT, assessPlan } from '../js/voyage_safety.js';

const LIVE_COVERAGE = {
  perVar: {
    solar: { confidence: 0.9, label: 'HIGH' },
    wind: { confidence: 0.9, label: 'HIGH' },
    waves: { confidence: 0.9, label: 'HIGH' },
    currents: { confidence: 0.9, label: 'HIGH' },
  },
  overall: 0.9, overallLabel: 'HIGH',
};

const GOOD_SOC_Q = {
  expectedPct: 55, conservativePct: 40, optimisticPct: 70, calibrated: true,
};

function baseInput(over = {}) {
  return {
    feasible: true,
    coverage: LIVE_COVERAGE,
    forecastAgeH: 2,
    currentDataPresent: true,
    socQuantiles: GOOD_SOC_Q,
    reserveSocPct: 25,
    ...over,
  };
}

const gate = (r, id) => r.gates.find((g) => g.id === id);

test('assessPlan labels an infeasible plan without further gates', () => {
  const r = assessPlan({ feasible: false });
  assert.equal(r.label, 'INFEASIBLE');
  assert.equal(r.gates.length, 1);
  assert.equal(r.gates[0].id, 'reachable');
  assert.equal(r.gates[0].pass, false);
});

test('assessPlan returns SAFE when every gate passes', () => {
  const r = assessPlan(baseInput());
  assert.equal(r.label, 'SAFE');
  assert.equal(r.gates.length, 6);
  assert.ok(r.gates.every((g) => g.pass));
  assert.ok(gate(r, 'adverse-arrival').detail.includes(`${HARD_FLOOR_PCT}%`));
});

test('assessPlan defaults: zero age, no penalty flag, standard floor', () => {
  const r = assessPlan({
    feasible: true, coverage: LIVE_COVERAGE, currentDataPresent: true,
    socQuantiles: GOOD_SOC_Q, reserveSocPct: 25,
  });
  assert.equal(r.label, 'SAFE');
  assert.ok(gate(r, 'freshness').detail.startsWith('forecast age 0.0'));
});

test('low wind/wave coverage demotes to POSSIBLE', () => {
  const cov = {
    ...LIVE_COVERAGE,
    perVar: { ...LIVE_COVERAGE.perVar,
              waves: { confidence: 0.35, label: 'LOW' } },
  };
  const r = assessPlan(baseInput({ coverage: cov }));
  assert.equal(r.label, 'POSSIBLE');
  assert.equal(gate(r, 'forecast-coverage').pass, false);
});

test('a stale forecast demotes to POSSIBLE', () => {
  const r = assessPlan(baseInput({ forecastAgeH: 20 }));
  assert.equal(r.label, 'POSSIBLE');
  assert.equal(gate(r, 'freshness').pass, false);
  assert.ok(gate(r, 'freshness').detail.includes('20.0 h'));
});

test('missing current data passes only with an explicit penalty margin', () => {
  const withPenalty = assessPlan(baseInput({
    currentDataPresent: false, currentPenaltyApplied: true,
  }));
  assert.equal(gate(withPenalty, 'current-data').pass, true);
  assert.ok(gate(withPenalty, 'current-data').detail.includes('penalty'));

  const without = assessPlan(baseInput({ currentDataPresent: false }));
  assert.equal(without.label, 'POSSIBLE');
  assert.equal(gate(without, 'current-data').pass, false);
  assert.ok(gate(without, 'current-data').detail.includes('no penalty'));
});

test('adverse arrival below the hard floor demotes to POSSIBLE', () => {
  const r = assessPlan(baseInput({
    socQuantiles: { ...GOOD_SOC_Q, conservativePct: 8 },
  }));
  assert.equal(r.label, 'POSSIBLE');
  assert.equal(gate(r, 'adverse-arrival').pass, false);
  // A caller-supplied floor is honoured.
  const custom = assessPlan(baseInput({
    socQuantiles: { ...GOOD_SOC_Q, conservativePct: 8 }, hardFloorPct: 5,
  }));
  assert.equal(gate(custom, 'adverse-arrival').pass, true);
});

test('uncalibrated uncertainty demotes to POSSIBLE with an explanation', () => {
  const r = assessPlan(baseInput({
    socQuantiles: { ...GOOD_SOC_Q, calibrated: false },
  }));
  assert.equal(r.label, 'POSSIBLE');
  const g = gate(r, 'calibrated-uncertainty');
  assert.equal(g.pass, false);
  assert.ok(g.detail.includes('no voyage history'));
});
