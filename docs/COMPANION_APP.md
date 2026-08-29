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

## Next steps (see docs/ROADMAP.md)

Live boat link (ESP32 Wi-Fi API) for real telemetry and automatic curve
sync; route legs with per-leg bearings so wind becomes directional; solar
forecast blending (cloud cover × clear-sky when radiation is missing).
