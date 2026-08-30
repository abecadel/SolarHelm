import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calmElectricW,
  electricW,
  etaProp,
  froudeNumber,
  parametricCurve,
  slenderness,
} from '../js/hull_physics.js';
import {
  BEAM_WL_M,
  DEFAULT_CONSTRAINTS,
  ENVELOPE,
  costPln,
  evaluateCandidate,
  paretoFront,
  searchDesigns,
  structureMassKg,
} from '../js/designer_model.js';
import {
  adoptDesign,
  initDesigner,
  runDesigner,
} from '../js/designer_ui.js';
import { fire, makeDoc } from './helpers.js';

// --- hull physics: calibrated against tools/helios_sanity.py ------------

test('calmElectricW reproduces the powercat reference grid (±10%)', () => {
  // docs/reference-vessels/SOLARHELM_LIGHT_POWERCAT.md §Modeled
  // performance (8 m LWL as 7.6 m waterline, two 0.5 m hulls).
  const grid = {
    700: { 5: 160, 6: 245, 7: 355 },
    1000: { 5: 190, 6: 290, 7: 420 },
    1300: { 5: 210, 6: 330, 7: 480 },
  };
  for (const [disp, byV] of Object.entries(grid)) {
    for (const [v, ref] of Object.entries(byV)) {
      const w = calmElectricW(Number(v), 7.6, Number(disp), 2);
      assert.ok(Math.abs(w - ref) / ref < 0.10,
                `${disp} kg @ ${v} km/h: ${w.toFixed(0)} vs ${ref}`);
    }
  }
});

test('hull physics primitives behave at the edges', () => {
  assert.equal(electricW(0), 0);
  assert.equal(electricW(-5), 0);
  assert.ok(etaProp(0) < etaProp(2000)); // efficiency rises with load
  assert.ok(etaProp(5000) < 0.53);
  assert.equal(calmElectricW(0, 8, 1000, 2), 0); // friction guard
  // Slenderness matches the case-study reference values.
  assert.ok(Math.abs(slenderness(6, 1500, 1) - 5.3) < 0.1);
  assert.ok(Math.abs(slenderness(8, 1000, 2) - 10.2) < 0.1);
  assert.ok(Math.abs(slenderness(10.5, 1500, 1) - 9.2) < 0.1);
  // Froude number: ~0.20 at 6.3 km/h on an 8 m hull.
  assert.ok(Math.abs(froudeNumber(6.3, 8) - 0.197) < 0.01);
  // The parametric curve has the shared [[kmh, whkm]] shape, rising.
  const curve = parametricCurve({ lwlM: 8, displacementKg: 1000,
                                  hullCount: 2 });
  assert.equal(curve.length, 7);
  assert.ok(curve[0][1] > 0);
  assert.ok(curve.at(-1)[1] > curve[0][1]); // Wh/km grows with speed
});

// --- designer search -----------------------------------------------------

test('searchDesigns finds catamarans only (the Helios lesson, encoded)',
     () => {
  const designs = searchDesigns();
  assert.ok(designs.length > 50, `${designs.length} designs`);
  assert.ok(designs.every((d) => d.hullCount === 2));
  // Sorted by daily distance; the winner does serious daily kilometres.
  assert.ok(designs[0].dailyKm >= designs.at(-1).dailyKm);
  assert.ok(designs[0].dailyKm > 55, `${designs[0].dailyKm} km`);
  assert.ok(designs[0].payloadKg >= DEFAULT_CONSTRAINTS.payloadKg);
  // Derived fields ride along for the UI/adoption.
  assert.equal(designs[0].beamWlM, BEAM_WL_M[2]);
  assert.ok(designs[0].spacingM > 2);
  assert.ok(designs[0].slenderness > 7);
});

test('every constraint can individually reject a candidate', () => {
  const base = { hullCount: 2, lwlM: 8, displacementKg: 1300,
                 pvKwp: 3, batteryKwh: 10, motorKw: 4 };
  assert.ok(evaluateCandidate(base)); // feasible reference
  // Payload: giant battery eats the displacement.
  assert.equal(evaluateCandidate({ ...base, displacementKg: 700,
                                   batteryKwh: 15, pvKwp: 4 }), null);
  // Comfort: any in-envelope monohull is too slender to be livable...
  assert.equal(evaluateCandidate({ ...base, hullCount: 1 }), null);
  // ...but a conventional heavy mono (outside the envelope) passes and
  // simply covers less ground than the cats.
  const heavyMono = evaluateCandidate(
      { hullCount: 1, lwlM: 6, displacementKg: 1300, pvKwp: 3,
        batteryKwh: 10, motorKw: 4 });
  assert.ok(heavyMono);
  assert.ok(heavyMono.slenderness < 6);
  assert.ok(heavyMono.dailyKm < searchDesigns()[0].dailyKm);
  // Budget cap.
  assert.equal(evaluateCandidate(base, { ...DEFAULT_CONSTRAINTS,
                                         budgetPln: 1000 }), null);
  // Motor must carry the cruise power with a 2x reserve.
  assert.equal(evaluateCandidate({ ...base, motorKw: 0.5 }), null);
  // Solar must at least pay the hotel.
  assert.equal(evaluateCandidate(base, { ...DEFAULT_CONSTRAINTS,
                                         hotelW: 3000 }), null);
  // Battery reserve: night hotel + two cloudy cruise hours.
  assert.equal(evaluateCandidate({ ...base, batteryKwh: 1 }), null);
});

test('cost and mass models scale with the candidate', () => {
  const small = { hullCount: 2, lwlM: 7, displacementKg: 1000,
                  pvKwp: 2.5, batteryKwh: 5, motorKw: 3 };
  const big = { hullCount: 2, lwlM: 10, displacementKg: 1000,
                pvKwp: 4, batteryKwh: 15, motorKw: 6 };
  assert.ok(costPln(big) > costPln(small));
  assert.ok(structureMassKg(big) > structureMassKg(small));
  assert.ok(structureMassKg({ ...small, hullCount: 1 }) !==
            structureMassKg(small));
});

test('paretoFront keeps only cost-effective designs', () => {
  const designs = [
    { costPln: 10, dailyKm: 50 },
    { costPln: 20, dailyKm: 40 },  // dominated: dearer AND slower
    { costPln: 30, dailyKm: 70 },
    { costPln: 40, dailyKm: 70 },  // dominated: same km, dearer
  ];
  const front = paretoFront(designs);
  assert.deepEqual(front.map((d) => d.costPln), [10, 30]);
  assert.deepEqual(paretoFront([]), []);
});

test('ENVELOPE matches the research document ranges', () => {
  assert.deepEqual(ENVELOPE.lwlM, [7, 8, 9, 10]);
  assert.deepEqual(ENVELOPE.displacementKg, [700, 1000, 1300]);
  assert.deepEqual(ENVELOPE.motorKw, [3, 4, 5, 6]);
});

// --- designer UI ---------------------------------------------------------

function designerDeps() {
  return { doc: makeDoc() };
}

test('runDesigner renders cards, the Pareto chart and the table', () => {
  const deps = designerDeps();
  const state = {};
  initDesigner(deps, state);
  assert.equal(deps.doc.getElementById('design-payload').value, '250');
  fire(deps.doc, 'design-run', 'click');
  const html = deps.doc.getElementById('design-results').innerHTML;
  assert.ok(html.includes('catamaran'));
  assert.ok(html.includes('km/day'));
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('<table'));
  assert.ok(deps.doc.getElementById('design-status').textContent
      .includes('No monohull passes the comfort constraint'));
  assert.ok(state.designs.length > 0);

  // Constraints that nothing satisfies -> guidance, cleared results.
  deps.doc.getElementById('design-payload').value = '2000';
  fire(deps.doc, 'design-run', 'click');
  assert.ok(deps.doc.getElementById('design-status').textContent
      .includes('No design'));
  assert.equal(deps.doc.getElementById('design-results').innerHTML, '');

  // A budget cap thins the field but still returns designs.
  deps.doc.getElementById('design-payload').value = '250';
  deps.doc.getElementById('design-budget').value = '20000';
  const capped = runDesigner(deps, state);
  assert.ok(capped.length > 0);
  assert.ok(capped.every((d) => d.costPln <= 20000));

  // Garbage inputs fall back to defaults.
  deps.doc.getElementById('design-payload').value = 'abc';
  deps.doc.getElementById('design-budget').value = '0';
  assert.ok(runDesigner(deps, state).length > 0);
});

test('adoptDesign copies the best design into the Setup form', () => {
  const deps = designerDeps();
  const state = {};
  initDesigner(deps, state);
  // Before any run: guidance only.
  assert.equal(adoptDesign(deps, state), false);
  assert.ok(deps.doc.getElementById('design-status').textContent
      .includes('Run the designer first'));

  fire(deps.doc, 'design-run', 'click');
  assert.equal(fire(deps.doc, 'design-adopt', 'click'), true);
  const d = state.designs[0];
  assert.equal(deps.doc.getElementById('setup-hull-count').value, '2');
  assert.equal(deps.doc.getElementById('setup-lwl').value,
               String(d.lwlM));
  assert.equal(deps.doc.getElementById('setup-motor').value,
               String(d.motorKw * 1000));
  assert.ok(deps.doc.getElementById('setup-curve').value
      .split('\n').length >= 4);
  assert.ok(deps.doc.getElementById('setup-note').value
      .includes('adopted designer #1'));
});
