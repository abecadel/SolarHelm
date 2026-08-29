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
page.on('requestfailed', (req) => failedUrls.push(req.url()));
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

// --- Voyage planner (planner v2) ---
await page.fill('#waypoints', '43.5081, 16.4402, anchor\n43.5300, 16.4402');
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

// --- Website landing page ---
await page.goto(`${base}/index.html`);
const h1 = await page.textContent('h1');
check(h1.toLowerCase().includes('solarhelm'), 'site landing page renders');

// --- Calculator ---
await page.goto(`${base}/calculator.html`);
await page.waitForSelector('#results .card', { timeout: 15000 });
const cruise = await page.textContent('#cruise-speed');
const cruiseKmh = parseFloat(cruise);
check(cruiseKmh > 3 && cruiseKmh < 8,
      `calculator estimates a plausible solar cruise speed (${cruise.trim()} km/h)`);

const unexpectedFailures =
    failedUrls.filter((u) => !u.includes('api.open-meteo.com'));
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
