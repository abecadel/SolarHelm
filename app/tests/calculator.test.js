import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BOAT_CLASSES,
  COSTS_PLN,
  croatianJuneDayPvWh,
  curveForClass,
  estimate,
} from '../js/calculator_model.js';
import { initCalc, readCalcInputs, resultsHtml } from '../js/calc_ui.js';
import { makeDoc } from './helpers.js';

const CALC_DEFAULTS = {
  'boat-class': 'launch', 'pv-wp': '1000', 'battery-kwh': '2.56',
  'hotel-w': '60',
};

test('curveForClass scales drag and unknown class falls back to launch', () => {
  const launch = curveForClass('launch');
  const dinghy = curveForClass('dinghy');
  const pontoon = curveForClass('pontoon');
  assert.ok(dinghy[2][1] < launch[2][1]);
  assert.ok(pontoon[2][1] > launch[2][1]);
  assert.deepEqual(curveForClass('nonsense'), launch);
  assert.equal(launch[0][1], 85.0);
});

test('croatianJuneDayPvWh: a 1 kWp array harvests several kWh', () => {
  const day = croatianJuneDayPvWh(1000);
  assert.equal(day.hours.length, 24);
  assert.equal(day.hours[0], 0);              // midnight
  assert.ok(Math.max(...day.hours) > 600);    // noon
  assert.ok(day.totalWh > 5000 && day.totalWh < 9000, day.totalWh);
});

test('estimate: the reference build gives plausible outputs', () => {
  const r = estimate({ classKey: 'launch', pvWp: 1000, batteryKwh: 2.56,
                       hotelW: 60 });
  assert.ok(r.cruiseNoonKmh > 4 && r.cruiseNoonKmh < 7, r.cruiseNoonKmh);
  assert.ok(r.kmPerDay > 30 && r.kmPerDay < 80, r.kmPerDay);
  assert.ok(r.usableSunH >= 10 && r.usableSunH <= 16);
  assert.ok(r.batteryRangeKm > 15 && r.batteryRangeKm < 40);
  assert.equal(r.panels, 2);
  assert.ok(r.totalPln > 5000 && r.totalPln < 12000, r.totalPln);
  const sum = r.cost.drive + r.cost.control + r.cost.battery + r.cost.solar +
              r.cost.installation;
  assert.equal(r.totalPln, sum);
});

test('estimate: hotelW defaults; bigger arrays cost more and go faster', () => {
  const small = estimate({ classKey: 'launch', pvWp: 450, batteryKwh: 1.2 });
  const big = estimate({ classKey: 'launch', pvWp: 1800, batteryKwh: 5 });
  assert.ok(big.cruiseNoonKmh > small.cruiseNoonKmh);
  assert.ok(big.totalPln > small.totalPln);
  assert.equal(small.panels, 1);
  assert.equal(big.panels, 4);
});

test('estimate: a heavy boat is slower than a dinghy on the same power', () => {
  const d = estimate({ classKey: 'dinghy', pvWp: 900, batteryKwh: 2.56 });
  const p = estimate({ classKey: 'pontoon', pvWp: 900, batteryKwh: 2.56 });
  assert.ok(d.cruiseNoonKmh > p.cruiseNoonKmh);
  assert.ok(d.kmPerDay > p.kmPerDay);
});

test('readCalcInputs parses and falls back on nonsense', () => {
  const doc = makeDoc({ ...CALC_DEFAULTS, 'pv-wp': '-5',
                        'battery-kwh': 'zzz' });
  const cfg = readCalcInputs(doc);
  assert.equal(cfg.pvWp, 900);
  assert.equal(cfg.batteryKwh, 2.56);
  assert.equal(cfg.hotelW, 60);
  assert.equal(cfg.classKey, 'launch');
});

test('resultsHtml renders every headline number', () => {
  const r = estimate({ classKey: 'launch', pvWp: 1000, batteryKwh: 2.56,
                       hotelW: 60 });
  const html = resultsHtml(r);
  assert.ok(html.includes('id="cruise-speed"'));
  assert.ok(html.includes('per clear June day'));
  assert.ok(html.includes('Total (approx.)'));
  assert.ok(html.includes('PLN'));
});

test('initCalc wires the page and re-renders on input', () => {
  const doc = makeDoc(CALC_DEFAULTS);
  initCalc({ doc });
  const results = doc.getElementById('results');
  assert.ok(results.innerHTML.includes('cruise-speed'));
  assert.ok(doc.getElementById('boat-class').innerHTML
      .includes(BOAT_CLASSES.pontoon.label));
  // Change PV and fire the input listener: results change.
  const before = results.innerHTML;
  doc.getElementById('pv-wp').value = '1800';
  doc.getElementById('pv-wp').listeners['input']();
  assert.notEqual(results.innerHTML, before);
});

test('calc_main boots against a document global', async () => {
  globalThis.document = makeDoc(CALC_DEFAULTS);
  await import('../js/calc_main.js');
  assert.ok(globalThis.document.getElementById('results').innerHTML
      .includes('cruise-speed'));
});

test('cost table constants stay positive', () => {
  for (const [k, v] of Object.entries(COSTS_PLN)) {
    assert.ok(v > 0, k);
  }
});
