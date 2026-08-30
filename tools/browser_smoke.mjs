#!/usr/bin/env node
// Headless-browser smoke test: serves the repo root, opens the planner PWA
// and the website pages in Chromium, plans a 2-day trip offline (Open-Meteo
// is blocked so the clear-sky fallback must kick in), and verifies the
// pages render. This is the check that covers what node unit tests cannot:
// real module loading, the service worker file parsing, and the calculator.
//
// Usage: tools/build_site.sh && node tools/browser_smoke.mjs   (repo root)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png',
  '.mp4': 'video/mp4',
};

const root = join(process.cwd(), '_site');
const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error('traversal');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'text/plain' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

const { chromium } = await import('playwright');

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

// PLAYWRIGHT_CHROMIUM points at a specific binary when the environment's
// preinstalled browser revision differs from the npm package's pin.
const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
      : {});
const page = await browser.newPage();
const errors = [];
const failedUrls = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (req) => {
  // Media elements with preload=metadata deliberately abort the stream
  // once they have the headers — that is not a failure.
  const err = req.failure()?.errorText ?? '';
  if (err.includes('ERR_ABORTED')) return;
  failedUrls.push(`${req.url()} (${err})`);
});
page.on('console', (m) => {
  // 'Failed to load resource' from the deliberately blocked forecast API is
  // expected; anything else is a real problem.
  if (m.type() === 'error' &&
      !m.text().includes('Failed to load resource')) {
    errors.push(`console: ${m.text()}`);
  }
});
// Block the real forecast APIs: the app must fall back to clear-sky.
await page.route('**/api.open-meteo.com/**', (r) => r.abort());
await page.route('**/marine-api.open-meteo.com/**', (r) => r.abort());
// Block OSM tiles: the map must initialize and stay editable without them.
await page.route('**/tile.openstreetmap.org/**', (r) => r.abort());

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
};

// --- Planner PWA ---
await page.goto(`${base}/app/index.html`);
await page.waitForSelector('#profile-name');
const profileText = await page.textContent('#profile-name');
check(profileText.includes('kWp'), `planner loads boat profile (“${profileText.trim()}”)`);
await page.click('#plan');
await page.waitForFunction(
    () => document.querySelector('#summary').innerHTML.length > 100,
    null, { timeout: 15000 });
const summary = await page.innerHTML('#summary');
check(summary.includes('SOC at end'), 'planner renders a plan summary');
const chartCount = await page.locator('#charts svg').count();
check(chartCount === 3, `planner renders 3 charts (got ${chartCount})`);
const status = await page.textContent('#status');
check(status.includes('clear-sky') || status.includes('Offline'),
      `offline fallback engaged (“${status.trim()}”)`);

// --- Voyage planner (planner v2, OSM map tab) ---
await page.click('#tabbtn-voyage');
const leafletUp = await page.evaluate(
    () => !!window.L && document.querySelector('#map .leaflet-container,' +
                                               '#map.leaflet-container') !== null);
check(leafletUp, 'Leaflet map initializes on the Voyage tab');
await page.fill('#waypoints', '43.5081, 16.4402, anchor\n43.5300, 16.4402');
await page.dispatchEvent('#waypoints', 'change');
const markerCount = await page.locator('#map path.leaflet-interactive')
    .count();
check(markerCount >= 2, `textarea waypoints appear on the map (${markerCount} shapes)`);
await page.click('#voyage-plan');
await page.waitForFunction(
    () => document.querySelector('#voyage-summary').innerHTML.length > 100,
    null, { timeout: 30000 });
const voyage = await page.innerHTML('#voyage-summary');
check(voyage.includes('verdict'), 'voyage planner renders a verdict');
check(voyage.includes('forecast-coverage'),
      'voyage planner renders the safety gates');
const voyageStatus = await page.textContent('#voyage-status');
check(voyageStatus.includes('wind'),
      `voyage environment status shown (“${voyageStatus.trim()}”)`);

// --- Boat + Model + Setup tabs ---
await page.click('#tabbtn-boat');
check(await page.inputValue('#boat-url') === 'http://192.168.4.1',
      'boat tab shows the SoftAP default address');
await page.click('#tabbtn-model');
const model = await page.innerHTML('#model-summary');
check(model.includes('recommended cruise band') &&
      model.includes('solar equilibrium'),
      'model tab renders band, equilibrium and curve');
await page.click('#tabbtn-setup');
const setupPv = await page.inputValue('#setup-pv');
check(parseFloat(setupPv) > 0, 'setup tab is filled from the profile');

// --- Website: one page, everything on it ---
await page.goto(`${base}/index.html`);
const landing = await page.content();
check(landing.includes('SOLARHELM') && landing.includes('statband') &&
      landing.includes('id="how"') && landing.includes('id="buying"') &&
      landing.includes('id="install"'),
      'single-page site renders hero and all sections');
check(landing.includes('deadband') && landing.includes('SmartShunt') &&
      landing.includes('BOM A'),
      'how-it-works, install rules and BOMs are on the page');
const demoVideo = await page.locator('video.demo source').getAttribute('src');
check(demoVideo === 'assets/demo.mp4', 'the demo video is embedded');
await page.waitForSelector('#results .card', { timeout: 15000 });
const cruise = await page.textContent('#cruise-speed');
const cruiseKmh = parseFloat(cruise);
check(cruiseKmh > 3 && cruiseKmh < 8,
      `calculator estimates a plausible solar cruise speed (${cruise.trim()} km/h)`);

const unexpectedFailures =
    failedUrls.filter((u) => !u.includes('api.open-meteo.com') &&
                             !u.includes('tile.openstreetmap.org'));
check(errors.length === 0,
      `no page errors (${errors.length ? errors.join(' | ') : 'clean'})`);
check(unexpectedFailures.length === 0,
      `no unexpected failed requests (${unexpectedFailures.join(' | ') || 'clean'})`);

await browser.close();
server.close();
if (failures > 0) {
  console.error(`${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('BROWSER SMOKE PASSED');
