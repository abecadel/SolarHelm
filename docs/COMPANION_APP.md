# SolarHelm Companion Planner (PWA)

A phone-installable web app that answers, before you cast off:
**does this trip fit, how fast can I go, and how much energy will be left?**

Live at `<pages-url>/app/` once GitHub Pages is enabled; also works opened
from a local checkout (`tools/build_site.sh` + any static server) and fully
offline once installed (service worker caches the shell).

## What it does today

- **Trip input**: start position (phone GPS via the Geolocation API, or
  typed), trip distance, 1–3 day horizon, cruising window, SOLAR-float or
  fixed-speed strategy, start + reserve SOC.
- **Forecast**: hourly shortwave radiation, cloud, wind and temperature
  from **Open-Meteo** (keyless, CORS-friendly). Offline or on any fetch
  problem it falls back to a clear-sky model computed from sun geometry —
  the same maths family as the C++ simulator — and labels the result
  accordingly.
- **Prediction**: 15-minute-substep simulation of the trip — PV production
  (kWp × derating × GHI), propulsion from the hull Wh/km curve with a
  headwind penalty, hotel load, SOC integration with the same
  reserve-floor philosophy as the firmware (propulsion never drags SOC
  below reserve; the hotel load, like on a real boat, still runs at
  night). Outputs: fits/doesn't fit, arrival time, SOC timeline, per-day
  distance/solar/motor energy, and an optimistic max-range bound.
- **Learning**: import a telemetry CSV (simulator or boat log format) and
  the app fits your real Wh/km curve (median per 0.5 km/h speed bin),
  overrides the profile, and persists it in `localStorage`.
- **Charts**: dependency-free inline SVG (power, SOC, distance/speed).

## Architecture

```
app/js/
  energy_model.js      pure physics twin of the C++ boat model
  forecast.js          Open-Meteo client + clear-sky fallback
  planner.js           trip engine + CSV curve fitting + max-range
  charts.js            SVG string builders (no DOM)
  calculator_model.js  website calculator maths (shares energy_model)
  ui.js / calc_ui.js   DOM glue with an injected `document`
  main.js / calc_main.js  browser bootstraps
  profile.js           shared boat profile (synced to config/boat_profile.json by test)
  sw.js                service worker (cache-first shell) — the one unit-test exclusion
```

Every module above except `sw.js` is unit-tested in plain node to 100 %
line/function/statement coverage (`cd app && npm run coverage`); the DOM
glue runs under a 40-line document stub. Real-browser behaviour (module
loading, service worker, calculator page) is verified by
`tools/browser_smoke.mjs` in headless Chromium with the forecast API
deliberately blocked, proving the offline path.

The planner is **advisory only**: it never talks to the throttle. The C++
core on the boat is the single control authority.

## Assumptions to revisit with sea-trial data

- Wind penalty: +4 % consumption per m/s headwind, half credit for
  tailwind — a placeholder until headwind/tailwind ladder runs exist.
- PV derating 0.78 (flat-mounted, warm panels, wiring losses).
- Charge efficiency 0.97; hotel load constant.
- The Open-Meteo request shape follows their published v1 API
  (`hourly=shortwave_radiation,cloud_cover,wind_speed_10m,temperature_2m`,
  `wind_speed_unit=ms`) and is unit-tested against a representative
  payload; the development sandbox's egress policy blocked a live call, so
  the first live fetch should be sanity-checked in the browser — any
  mismatch degrades gracefully to the labelled clear-sky fallback.

## Planner v2 — A→B voyages (implemented)

The "Voyage A→B" section implements the V1 slice of
docs/GLOBAL_ADAPTIVE_ROUTE_PLANNER_RESEARCH.md on top of four new
modules, all pure and unit-tested to the same 100 % gate:

- `js/providers.js` — global-first environment layer. A provider
  registry (Tier 0: Open-Meteo weather + Open-Meteo Marine + a clear-sky
  model) feeds `getVoyageEnvironment()`, which merges hourly solar, wind,
  wave and ocean-current series with per-variable source metadata and a
  coverage score. Every capability degrades independently: losing the
  marine API keeps live wind; losing everything still yields clear-sky
  solar so the planner always runs — the safety gates just say so.
  Currents are unit-converted (km/h → m/s) and sanity-clamped.
- `js/vessel_model.js` — the learning vessel model: NNLS-fitted monotone
  hull curve (P = b1·v + b3·v³), PAVA isotonic cross-check, steady-state
  block gating for trustworthy samples, CUSUM drift detection, and
  calibrated error quantiles (conservative defaults until ≥10 logged
  prediction-vs-actual records exist).
- `js/route_planner.js` — waypoint segmentation (≤2 km), crab-compensated
  speed-over-ground through current vectors, apparent-wind and wave-height
  power penalties (placeholder priors until the residual model learns),
  and the (segment, time-bucket) → max-SOC dynamic program. Waiting (P=0)
  at the dock or any `anchor` waypoint makes departure-window sweeps and
  solar stops emerge from the same pass; the destination row is the full
  arrival-time ↔ arrival-SOC Pareto curve.
- `js/voyage_safety.js` — the SAFE / POSSIBLE / INFEASIBLE verdict as six
  explicit pass/fail gates (forecast coverage, freshness, current data,
  reserve-by-construction, adverse-case arrival vs a 10 % hard floor,
  calibrated uncertainty), always rendered with the plan.

The voyage UI (`js/voyage_ui.js`) reads waypoints as `lat, lon[, anchor]`
lines, fetches the environment along the route, and renders verdict,
gates, summary cards and the Pareto table.

## Planner v2.1 — learning and long routes (implemented)

- **Per-segment environment** (`providers.routeSamplePoints` /
  `getRouteEnvironment`): long routes get a forecast column roughly every
  25 km (bounded fetch count); coverage aggregates pessimistically so the
  verdict reflects the worst-covered stretch of the passage.
- **Learning loop closed** (`js/vessel_store.js` + the "learn from a
  voyage log" input): a telemetry CSV runs through steady-block gating,
  scores residuals against the model *as it was* (honest
  prediction-vs-actual), raises a CUSUM drift warning (fouling runs one
  way, an easier boat the other), refits the NNLS hull curve weighted by
  block evidence, recalibrates the error quantiles — and the SAFE gate
  "calibrated-uncertainty" turns green at 10 scored blocks. Persisted in
  localStorage; the next voyage plan uses the learned model.
- **Geographic residuals** (`js/geo_residuals.js`): 0.2°-binned EWMA bias
  applied as a per-segment power factor in the DP (clamped ±30%, needs 3+
  samples per bin). The store and planner hook are live; population
  starts when ESP32 telemetry carries GPS positions.
- **Provider skill** (`js/provider_stats.js`): forecast-vs-observed
  errors per provider/variable shade the static confidences feeding the
  coverage score, after 10+ comparisons.

## The control-panel UX (current)

The app is the boat's own control panel, served from GitHub Pages for
armchair planning and **from the ESP32's flash over its SoftAP** for use
on the water (`tools/pack_fs.sh` + `pio run -t uploadfs`;
`firmware/main.cpp` serves `/www/` via LittleFS). Five hash-routed tabs
(`js/tabs.js`), every view dependency-injected and unit-tested:

- **Plan** — the original day planner: forecast (clear-sky offline),
  hour-by-hour simulation, charts.
- **Voyage** — the OpenStreetMap route editor (`js/map_ui.js`, vendored
  Leaflet in `app/vendor/leaflet/` so no CDN is needed offline; tiles
  gray out without internet but editing keeps working; the waypoint
  textarea stays the synced source of truth). Verdict, six gates,
  arrival-SOC quantiles, Pareto row, and the per-day energy ledger
  (`planLedger`).
- **Boat** — the live link (`js/boat_ui.js`) over either transport
  (`js/ble_link.js`): **Wi-Fi HTTP** when the app is served by the boat
  (same-origin, unrestricted) or **Bluetooth GATT** when the app comes
  from the web (an HTTPS page cannot call plain-HTTP — mixed content —
  and Web Bluetooth requires exactly the secure context the hosted app
  has; the phone keeps its internet for forecasts and tiles). iOS has no
  Web Bluetooth and uses the boat-served app. 1 Hz telemetry with
  decoded fault flags, REMOTE power-target sender, and a session
  recorder exporting the exact firmware CSV (positions included) for
  the learner.
- **Model** — everything learned (`js/model_ui.js`): hull curve,
  recommended cruise band (EnergyKnee), solar-equilibrium speed,
  calibration state, CUSUM drift, geo/provider store counts, the
  learn-from-CSV input, and a reset.
- **Setup** — initial configuration (`js/setup_ui.js`): profile editor
  with `config_revision` bump + change note on every save (persisted
  locally), plus **boat-side control tunables over the SoftAP**
  (`GET/POST /config`): a whitelisted parameter set the boat validates
  and stores in NVS — deliberately Wi-Fi-only, at the dock.

Online data is offline-first: forecast fetches go through
`js/net_cache.js`, so payloads downloaded while the phone had internet
replay on the water — with their real age feeding the voyage
freshness gate honestly. Telemetry now carries GPS positions, so a
learned log also populates the geographic residual store
(places where the boat needs more power than modelled).

**Offline map tiles** (`js/tile_math.js`, `js/tile_store.js`): the map's
base layer caches through IndexedDB — every tile viewed renders offline
afterwards — and the Voyage tab's *Download maps for this route* button
prefetches a one-tile-wide corridor around the route at zooms 8/10/12.
The pack is hard-capped at **200 tiles per route, coarse zooms first**
and fetched at under 2 requests/second, because OSM's tile usage policy
forbids bulk scraping: a capped pack still shows the whole route at
overview zooms and simply thins out at the detailed ones. Without
IndexedDB (private mode) the map stays online-only and says so.

## Next steps (see docs/ROADMAP.md)

Bench gate A7 validates both links (Wi-Fi and BLE), the flash-served
app, and `/config` persistence physically. Then: provider-skill
recording from live PV observations, H3 bins for the geo store, FES2022
offline tide packs.
