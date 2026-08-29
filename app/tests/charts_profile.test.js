import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { esc, hourTicks, legend, lineChart } from '../js/charts.js';
import { clearSkyForecast } from '../js/forecast.js';
import {
  DEFAULT_PROFILE,
  loadProfile,
  profileValid,
} from '../js/profile.js';
import { makeFetch } from './helpers.js';

test('esc escapes markup', () => {
  assert.equal(esc('<a b="c">&'), '&lt;a b=&quot;c&quot;&gt;&amp;');
});

test('lineChart renders series, grid, ticks and labels', () => {
  const svg = lineChart(
      [{ label: 'PV', color: '#e8a013', points: [[0, 0], [1, 50], [2, 100]] },
       { label: 'Motor', color: '#2778c4', points: [[0, 10], [1, 20], [2, 30]] }],
      { xTicks: [[0, '06:00'], [2, '18:00']], width: 300, height: 150 });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox="0 0 300 150"'));
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
  assert.ok(svg.includes('06:00') && svg.includes('18:00'));
  assert.ok(svg.includes('class="grid"'));
});

test('lineChart handles fixed y-domain and degenerate data', () => {
  const svg = lineChart([{ label: 'SOC', color: 'red', points: [[0, 50]] }],
                        { yMin: 0, yMax: 100 });
  assert.ok(svg.includes('<polyline'));  // single point, degenerate x domain
  const flat = lineChart([{ label: 'x', color: 'blue',
                            points: [[0, 5], [1, 5]] }]);
  assert.ok(flat.includes('<polyline'));
});

test('legend lists all series', () => {
  const html = legend([{ label: 'A', color: 'red' },
                       { label: 'B', color: 'blue' }]);
  assert.ok(html.includes('A') && html.includes('B') &&
            html.includes('background:red'));
});

test('hourTicks marks every sixth hour', () => {
  const hours = clearSkyForecast(43.5, 16.4, new Date(Date.UTC(2026, 5, 21)), 1);
  const ticks = hourTicks(hours);
  assert.deepEqual(ticks.map((t) => t[1]),
                   ['00:00', '06:00', '12:00', '18:00']);
});

test('DEFAULT_PROFILE stays in sync with config/boat_profile.json', () => {
  const json = JSON.parse(
      readFileSync(new URL('../../config/boat_profile.json', import.meta.url),
                   'utf8'));
  assert.deepEqual(DEFAULT_PROFILE, json);
});

test('profileValid accepts the default and rejects mutations', () => {
  assert.ok(profileValid(DEFAULT_PROFILE));
  assert.ok(!profileValid(null));
  assert.ok(!profileValid({ ...DEFAULT_PROFILE, schema_version: 2 }));
  assert.ok(!profileValid({ ...DEFAULT_PROFILE,
                            hull_efficiency_curve_kmh_whkm: [[3, 85]] }));
  assert.ok(!profileValid({ ...DEFAULT_PROFILE, pv_kwp: 0 }));
  assert.ok(!profileValid({ ...DEFAULT_PROFILE, pv_derating: 1.5 }));
  assert.ok(!profileValid({ ...DEFAULT_PROFILE, battery_capacity_kwh: 0 }));
  assert.ok(!profileValid({ ...DEFAULT_PROFILE, hotel_load_w: -1 }));
  assert.ok(!profileValid({ ...DEFAULT_PROFILE, motor_max_power_w: 0 }));
});

test('loadProfile: served config wins, anything else falls back', async () => {
  const ok = await loadProfile(makeFetch(DEFAULT_PROFILE));
  assert.equal(ok.source, 'config');
  assert.equal(ok.profile.pv_kwp, DEFAULT_PROFILE.pv_kwp);
  const bad = await loadProfile(makeFetch({ nope: 1 }));
  assert.equal(bad.source, 'builtin');
  const http = await loadProfile(makeFetch(null, { ok: false, status: 404 }));
  assert.equal(http.source, 'builtin');
  const net = await loadProfile(makeFetch(null, { reject: true }));
  assert.equal(net.source, 'builtin');
});
