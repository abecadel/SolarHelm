# Global Adaptive Route Planner — Research

The umbrella research document for SolarHelm's voyage planner: the skipper
selects **A → B** (plus departure window, arrival time, reserve, route,
max duration) and SolarHelm answers *"can I realistically reach B?"* —
then best departure time, power schedule, expected SOG/solar/SOC,
uncertainty, risks, and whether waiting for more sun improves the trip,
recalculating continuously under way. Research date 2026-08-30.
Companions: [GLOBAL_ENVIRONMENT_PROVIDERS.md](GLOBAL_ENVIRONMENT_PROVIDERS.md)
(data layer) and [ADAPTIVE_ENERGY_MODEL_RESEARCH.md](ADAPTIVE_ENERGY_MODEL_RESEARCH.md)
(vessel learning). Status: **research — implementation follows the V1
stack at the end.**

## First principles (the contract)

1. **Global-first.** Nothing is architected for Croatia, the
   Mediterranean, or any single provider or ocean model. Croatia/Adriatic
   is one validation case; the same code must work in the Baltic, the
   Caribbean, a Canadian lake, or a German river — wherever data exists,
   at whatever quality, *explicitly labeled*.
2. **The stack:** global forecasts are priors → regional models override
   where objectively better → physics converts environment into expected
   vessel performance → the boat's telemetry corrects physics → repeated
   voyages teach the vessel model, regional biases, and provider error
   statistics. Every voyage improves both the prediction and its
   confidence interval.
3. **Compute split:** the smartphone/PWA owns everything heavy (providers,
   model fitting, route optimization, maps, uncertainty, history); the
   **ESP32 owns realtime control, protection and fail-safety** and treats
   the phone's power target as an advisory input with a staleness timeout
   (already implemented: `Mode::kRemote` degrades to SOLAR when the phone
   goes quiet).
4. **Never false precision.** "Expected 42 %, likely 36–48 %,
   conservative 31 %" — intervals always, calibrated from the boat's own
   prediction-vs-actual history.
5. **Decision support, not navigation.** SolarHelm is an energy planner;
   charts, lookout and COLREGS remain the skipper's. The UI carries this
   disclaimer permanently.

## Prior art (studied from source)

- **OpenCPN `weather_routing_pi`** (cloned, C++): the reference
  open-source isochrone router. Mature polars/GRIB/current handling and
  GSHHG land tests worth mining; its `Anchoring` flag already implements
  "waiting merges isochrones" — precedent for our wait action. Its
  `ChargeSource.h` is a **non-compiling solar/battery stub**: energy-state
  routing was contemplated there and never built. The niche is empty.
- **qtVlm**: freeware but *not* open source — feature reference only.
- **dakk/libweatherrouting** (cloned, Python): a 137-line isochrone core
  using parent pointers, no polygon surgery — proof of how small the
  frontier method can be.
- **PredictWind** (feature level): departure planning = 4 discrete
  departure candidates, cloud-routed; multi-model runs as uncertainty.
  Our DP makes the departure sweep intrinsic instead.
- **EV routing literature** (Baum et al., arXiv:2011.10400): constrained
  shortest path with battery via labels/tradeoff functions and dominance
  pruning — the formal frame our simpler tabular DP instantiates.

## The optimizer

### Why not isochrones

The isochrone method *is* DP over a time-reachable frontier — correct
when time is the only state. SOC breaks its dominance rule (a slower
arrival with more battery may win later), turning the frontier into a
Pareto surface over (position, time, SOC) — exactly what an explicit DP
table represents without ~450 lines of polygon normalization surgery
(weather_routing_pi's most fragile part).

### The key structural insight

**At the same (segment, time), more SOC is never worse** (energy dynamics
are monotone in SOC; the 100 % clamp preserves it). So the 3-D state
collapses: store one value per cell —

```
maxSOC[segment][time_bucket]  = best achievable SOC arriving there then
```

The destination row `maxSOC[B][·]` is then the **entire Pareto curve
arrival-time → best arrival SOC**: feasibility, best departure, fastest
safe arrival, and max-reserve arrival are all read off a single forward
pass. SOC bucketing (1–5 %) becomes value quantization (round down =
conservative), not a dimension.

### V1 algorithm (recommended)

**Forward tabular DP over (segment, time bucket), chronological order
(the graph is a DAG in time — no priority queue), actions = discrete
power levels {0, 400, 600, 800, 1000, 1250, 1500, 2000 W} + wait(P=0)
at anchorable segments.** Per transition: interpolate environment
(bilinear space / linear time), power → STW via the learned monotone hull
curve, STW ⊕ current vector → SOG, PV model → charge, SOC update with
reserve floor. Backpointers reconstruct the power schedule.

Sizing (50 km corridor): 25–100 segments × 96–576 time buckets × 6–10
power levels ≈ 10⁴–10⁶ transition evaluations ≈ **well under 1–2 s in a
Web Worker, <1 MB memory** (back-of-envelope — add a benchmark to CI
early). A* / label-correcting with dominance is the V2 upgrade path for
free-2-D auto-routing (10⁸+ evaluations), per the EV literature.

### Departure-time optimization & solar stops

Both fall out of the DP:
- Seed every candidate departure bucket (or just "now" — dock waiting is
  itself the wait action at segment 0): **one pass yields the arrival
  curves for all departures**, strictly dominating PredictWind-style
  discrete re-runs. "Depart 09:15 instead of 07:00 → arrival SOC 43 %
  vs 28 %" is a table lookup.
- **Wait(P=0) at anchorable nodes** makes *solar stops emerge from the
  optimizer*: it parks the boat over solar noon whenever "anchor 1 h 40 m,
  +1.3 kWh" beats slogging at low power. Guard: waiting is only allowed
  where anchoring is actually safe — anchorable flags are safety-relevant
  input (user-marked in V1).

### Route geometry: corridor-first (V1)

**The skipper draws the route (or imports GPX); SolarHelm optimizes power
and timing along it.** Strongly endorsed by the research: it removes the
land-avoidance/chart-quality liability entirely (consistent with
decision-support-not-navigation), cuts the state space ~100×, and matches
reality — the coastal route is usually obvious; energy and timing are the
hard part. Multiple drawn corridors are simply scored in parallel
("the 45 km sheltered route beats the 37 km slog into wind").
V2 auto-routing: OSM water polygons (more current than GSHHG inshore) /
GSHHG masks, H3 water-grid or corridor-ladder graphs, safety buffer
distance-to-land, label-correcting search.

### Segmentation

500 m–2 km spatial (finer near harbours/tidal gates), 5–15 min temporal;
adaptive splitting where environmental gradients are steep or a
high-res-model domain boundary is crossed; conservative rounding (SOC
down, time up); sample env at segment midpoint at entry time.

### Replanning under way

The V1 DP is sub-second, so **re-run it fully every 2–5 min** from the
measured (segment, now, SOC) — warm-starting is just re-seeding; no
incremental machinery. Immediate-replan triggers: SOC / realized-Wh-per-km
/ PV / SOG / ETA deltas beyond thresholds, route edits, fresh forecasts.
Display hysteresis: don't flap power targets for <5 % gains. Online
correction: rolling Wh/km and PV derating factors feed back as
multiplicative corrections into the DP dynamics (the per-voyage bias term
of the adaptive-model doc). When connectivity returns: diff forecast
revisions, replan if material, **tell the skipper the plan changed
because the forecast changed**, and archive both for calibration.

### Uncertainty through a route

V1: calibrated aggregate quantiles (per-voyage energy/time error
quantiles applied to the DP's nominal outcome → SOC quantiles). V1.5:
online/adaptive conformal (Gibbs–Candès; Zaffran ICML'22;
decaying-step-size variants) for coverage under drift. V2: Monte Carlo
rollouts of the *fixed* plan with leg-correlated residuals — 10⁴ rollouts
≈ milliseconds; multi-model forecast spread (Open-Meteo `models=`)
provides structured scenarios free. Re-optimizing per sample is the only
expensive variant and is unnecessary.

## Smartphone-first architecture (Q20)

**Verdict: yes — the whole planning/learning workload runs comfortably in
a modern phone PWA.** The platform facts that shape the design:

- **Compute**: DP + MC in a Web Worker; typed-array JS first, WASM only
  if benchmarks demand; SharedArrayBuffer (COOP/COEP headers) only if
  threading is ever needed (V1 doesn't).
- **Storage**: GBs are available (Chromium ~60 % of disk/origin; Safari
  17+ similar for browser + home-screen apps). Use OPFS for forecast/map
  packs, IndexedDB for records, `navigator.storage.persist()`. Safari's
  7-day eviction **does not apply to home-screen-installed apps** — Add
  to Home Screen is the canonical iOS install path.
- **Background execution: none on iOS.** The voyage screen is a
  wake-locked foreground app (Wake Lock API: iOS ≥16.4; the
  installed-app bug was fixed in 18.4; re-acquire on `visibilitychange`).
  This is why the **ESP32 must be the continuously running authority** —
  which it already is.
- **Phone↔ESP32 link: ESP32 SoftAP Wi-Fi + HTTP/WebSocket**, not
  Bluetooth — **Web Bluetooth does not exist on iOS** (Apple has stated
  no intent) but SoftAP+WS works identically on both platforms and is the
  battle-tested marine-DIY pattern (SignalK, esp32-nmea2000, SensESP).
  Open item (ADR needed): HTTPS-PWA ↔ local-ws mixed-content rules — the
  safe fallback is serving the control page from the ESP32 itself.
- **Control contract**: the phone *suggests* `{target_power_w, valid_for}`;
  the ESP32 enforces staleness timeout, envelope ceilings and reserve
  floor, and degrades to self-contained SOLAR on silence (implemented and
  tested in `Mode::kRemote`). Phone disconnect is a normal, safe event.
- **GPS**: prefer the boat's GNSS via the link; phone `watchPosition` as
  fallback (foreground-only).

## Offline-first (Q21)

Cache before departure (per voyage):
1. Corridor forecast pack — wind, gusts, GHI/cloud, waves (partitioned),
   current u/v, temp, pressure, precip; hourly; window + ≥50 % margin
   (~1–10 MB as typed arrays; §GLOBAL_ENVIRONMENT_PROVIDERS for sizing).
2. A second forecast model of the same variables (spread/uncertainty).
3. Tidal constituents for route stations/nodes (KBs, never expire).
4. Basemap PMTiles extract (MapLibre GL + OPFS, ~50–300 MB) + optional
   OpenSeaMap context overlay.
5. Coastline/water-mask extract for sanity checks (MBs).
6. Anchorage list with anchorable flags.
7. Boat model (hull curve, PV, battery, hotel — KBs) and 8. the current
   plan + DP snapshot + voyage log. 9. App shell (service worker).
Budget < 500 MB with maps, ~20–50 MB without. Loss of internet never
disables the voyage; reconnection refreshes, diffs, and re-optimizes.
GRIB2-in-browser (pure-JS decoders exist; no production ecCodes WASM
found) is deliberately V2+ — V1 uses REST-shaped tiles.

## SAFE vs POSSIBLE (Q22)

A plan is labeled **SAFE** only when *all* gates pass; otherwise
**POSSIBLE** (failed gates listed) or **NOT ADVISED/INFEASIBLE**. The gate
report *is* the explanation — always shown, never a bare badge:

1. Wind AND wave forecasts cover 100 % of corridor × window + margin
   ≥ max(6 h, 25 % of duration); no silent climatology fallback inside.
2. Freshness: model run ≤ 12 h old at departure (≤ 24 h under way); plan
   recomputed ≤ 15 min before labeling.
3. Current data present, OR an explicit unknown-current penalty applied
   (default ≥ 0.5–1 kn adverse) — "no data, no margin" can never be SAFE.
4. Reserve: nominal SOC ≥ reserve floor everywhere; P90-adverse arrival
   SOC ≥ hard floor.
5. Calibrated uncertainty (enough logged voyages or conservative
   defaults), P90 arrival time within skipper constraints (daylight,
   tidal gates) — else cap at POSSIBLE.
6. Forecast wind/gust/waves within the boat's configured limits, with
   multi-model spread also inside them; advisory-class weather ⇒ never
   SAFE.
7. Robustness: a reachable bail-out/anchorable point with SOC ≥ hard
   floor exists from every segment under the adverse scenario (nearly
   free to check from the DP table).
8. Data integrity: cache checksums/expiry valid, clocks sane, boat model
   user-verified at least once against measured Wh/km.

**Environmental coverage score**: per variable, availability →
confidence weight (fresh hi-res regional 1.0 · global 0.8 · stale ×0.6 ·
climatology 0.3 · none 0), scaled by resolution-adequacy vs coastal
complexity; aggregated energy-weighted over the corridor; overall score
uses **min across safety-critical variables** (wind, waves), shown as a
per-variable bar chart ("Wind HIGH · Solar HIGH · Current LOW → overall
MEDIUM-HIGH") and feeding gates 1/3.

## Model hierarchy (how the three documents compose)

```
GlobalPhysicsModel        (universal equations — Q10)
   ├── VesselModel        (per boat, per configuration — Q11)
   ├── PVModel            (per array; heading-aware — Q11)
   └── EnvironmentalResidualModel
         ├── Global       (provider error statistics)
         ├── Regional     (H3-cell biases — Q12)
         └── Local        (learned river reaches, channels)
```

No giant learned model; each box is small, inspectable, separately
versioned, and separately confident. The model-confidence screen
("Voyages 43 · Hull HIGH · Wave MEDIUM · Current correction LOW ·
MAE 4.8 %") reads directly off these components and varies by region.

## The 22 questions — index

Q1–Q5, Q7, Q8, Q21 → GLOBAL_ENVIRONMENT_PROVIDERS.md.
Q10–Q19 → ADAPTIVE_ENERGY_MODEL_RESEARCH.md.
**Q6 (local bias for global ocean models): yes** — H3-cell,
tide-phase-binned current-bias vectors with sample counts and shrinkage,
labeled as corrections, never silently replacing forecasts.
**Q9 (river current learned from repeated telemetry): yes** — per-reach
rating current(stage/discharge) seeded by hydraulic heuristics, refined
from SOG−STW residuals; explicitly distinguished from forecast and
realtime-inferred current.
**Q20** → §Smartphone-first (yes, with the two iOS limits and their
mitigations). **Q22** → §SAFE vs POSSIBLE.

## Global-first V1 stack (the smallest useful planner)

- **Weather/solar**: Open-Meteo (already integrated) with `models=`
  second opinion.
- **Waves + currents**: Open-Meteo Marine (CMEMS/MFWAM-sourced); provider
  registry + metadata from day one.
- **Tides**: constituent packs + on-device harmonic synthesis (licensing
  check pending; NOAA constituents for US as the proven path).
- **Boat model**: learned per ADAPTIVE_ENERGY_MODEL (NNLS hull curve +
  residuals + conformal quantiles).
- **Route**: skipper-drawn corridor; **(segment, time) → maxSOC DP** with
  wait actions; departure sweep; replan loop.
- **Position**: boat GNSS via SoftAP link, phone GPS fallback.
- **Map**: MapLibre GL + PMTiles offline packs.
- Higher-resolution provider adapters (CMEMS regional, NOAA OFS, NorKyst)
  arrive incrementally as corridor-pack builders behind the same
  interfaces.

## Open items / uncertainties

DP compute benchmarks (add to CI); FES2022/GSHHG licensing for bundled
packs; HTTPS↔local-ESP32 mixed-content ADR; ecCodes-WASM maturity;
Open-Meteo current provenance for gate 3; iOS storage behavior drifts
with Safari releases — re-verify at implementation time.
