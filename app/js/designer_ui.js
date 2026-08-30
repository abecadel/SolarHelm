// Design tab: the Vessel Designer front-end. Runs the envelope search
// (designer_model.js) against the user's constraints, renders the top
// designs as cards, the cost/distance Pareto front as an SVG chart
// (charts.js), and can prefill the Setup form with a chosen design so a
// paper boat becomes the working profile in two clicks.

import { lineChart } from './charts.js';
import {
  DEFAULT_CONSTRAINTS,
  paretoFront,
  searchDesigns,
} from './designer_model.js';

function readConstraints(doc) {
  const num = (id, fallback) => {
    const v = parseFloat(doc.getElementById(id).value);
    return Number.isFinite(v) ? v : fallback;
  };
  const budget = num('design-budget', 0);
  return {
    ...DEFAULT_CONSTRAINTS,
    payloadKg: num('design-payload', DEFAULT_CONSTRAINTS.payloadKg),
    hotelW: num('design-hotel', DEFAULT_CONSTRAINTS.hotelW),
    budgetPln: budget > 0 ? budget : null,
  };
}

function designCard(d, rank) {
  const kind = d.hullCount === 2 ? 'catamaran' : 'monohull';
  return `
    <div class="card">
      <b>#${rank} — ${d.lwlM} m ${kind}, ${d.displacementKg} kg</b>
      <span>${d.dailyKm} km/day at ${d.cruiseKmh.toFixed(1)} km/h
        (${d.cruiseW} W)</span>
      <span>${d.pvKwp} kWp PV · ${d.batteryKwh} kWh · ${d.motorKw} kW
        motor</span>
      <span>payload ${d.payloadKg} kg · slenderness
        ${d.slenderness.toFixed(1)} · ~${d.costPln} PLN</span>
    </div>`;
}

function designRow(d) {
  return `<tr><td>${d.hullCount === 2 ? 'cat' : 'mono'}
    ${d.lwlM} m</td><td>${d.displacementKg} kg</td>
    <td>${d.pvKwp} kWp</td><td>${d.batteryKwh} kWh</td>
    <td>${d.motorKw} kW</td><td>${d.dailyKm} km</td>
    <td>${d.costPln}</td></tr>`;
}

/** Runs the search and renders results; returns the designs. */
export function runDesigner(deps, state) {
  const doc = deps.doc;
  const constraints = readConstraints(doc);
  const designs = searchDesigns(constraints);
  if (designs.length === 0) {
    doc.getElementById('design-status').textContent =
        'No design in the research envelope satisfies these ' +
        'constraints — relax the payload or budget.';
    doc.getElementById('design-results').innerHTML = '';
    return designs;
  }
  state.designs = designs;
  const front = paretoFront(designs);
  const cards = designs.slice(0, 3)
      .map((d, i) => designCard(d, i + 1)).join('');
  // Pareto front: daily km (y) vs build cost in kPLN (x).
  const chart = lineChart([{
    label: 'Pareto: km/day vs build cost',
    color: '#2778c4',
    points: front.map((d) => [d.costPln / 1000, d.dailyKm]),
  }], { width: 640, height: 200,
        xTicks: front.map((d) =>
            [d.costPln / 1000, `${Math.round(d.costPln / 1000)}k PLN`]) });
  const rows = designs.slice(0, 12).map(designRow).join('');
  doc.getElementById('design-results').innerHTML = `
    <div class="cards">${cards}</div>
    ${chart}
    <table class="days"><tr><th>hull</th><th>displ.</th><th>PV</th>
      <th>battery</th><th>motor</th><th>km/day</th><th>PLN</th></tr>
      ${rows}</table>`;
  const cats = designs.filter((d) => d.hullCount === 2).length;
  doc.getElementById('design-status').textContent =
      `${designs.length} feasible designs (${cats} catamarans, ` +
      `${designs.length - cats} monohulls) — best covers ` +
      `${designs[0].dailyKm} km/day on sun alone. ` +
      (designs.length - cats === 0
        ? 'No monohull passes the comfort constraint in this envelope ' +
          '(the Helios lesson, structurally).'
        : '');
  return designs;
}

/** Copies the best design's parameters into the Setup form fields. */
export function adoptDesign(deps, state) {
  const doc = deps.doc;
  const d = (state.designs ?? [])[0];
  if (!d) {
    doc.getElementById('design-status').textContent =
        'Run the designer first, then adopt its best design.';
    return false;
  }
  doc.getElementById('setup-hull-count').value = String(d.hullCount);
  doc.getElementById('setup-lwl').value = String(d.lwlM);
  doc.getElementById('setup-beam-wl').value = String(d.beamWlM);
  doc.getElementById('setup-spacing').value = d.spacingM.toFixed(1);
  doc.getElementById('setup-displacement').value =
      String(d.displacementKg);
  doc.getElementById('setup-pv').value = String(d.pvKwp);
  doc.getElementById('setup-battery').value = String(d.batteryKwh);
  doc.getElementById('setup-motor').value = String(d.motorKw * 1000);
  doc.getElementById('setup-curve').value = d.curve
      ? [4, 5, 6, 7, 8].map((v) => {
          const w = d.curve.b1 * v + d.curve.b3 * v ** 3;
          return `${v}, ${(w / v).toFixed(1)}`;
        }).join('\n')
      : doc.getElementById('setup-curve').value;
  doc.getElementById('setup-note').value =
      `adopted designer #1: ${d.lwlM} m ` +
      `${d.hullCount === 2 ? 'cat' : 'mono'} ${d.displacementKg} kg`;
  doc.getElementById('design-status').textContent =
      'Best design copied into the Setup form — review and Save there ' +
      'to make it the working profile.';
  return true;
}

export function initDesigner(deps, state) {
  const doc = deps.doc;
  doc.getElementById('design-payload').value =
      String(DEFAULT_CONSTRAINTS.payloadKg);
  doc.getElementById('design-hotel').value =
      String(DEFAULT_CONSTRAINTS.hotelW);
  doc.getElementById('design-run').addEventListener('click',
      () => runDesigner(deps, state));
  doc.getElementById('design-adopt').addEventListener('click',
      () => adoptDesign(deps, state));
}
