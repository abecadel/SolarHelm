# SolarHelm Architecture

## The one idea everything serves

SolarHelm holds **battery power at a target** instead of holding boat speed.

```
error_w = filtered_battery_power_w − target_battery_power_w
motor_command ← PI(error_w), rate-limited, clamped
```

With `target = 0 W` (SOLAR mode) the boat propels itself on exactly what the
panels produce: charging surplus raises the throttle, discharge lowers it,
and speed floats with the weather. This is intentionally **not** a
constant-speed cruise control.

Sign convention, project-wide: **battery power > 0 = charging**,
< 0 = discharging (matches the intuitive UI reading `BATTERY +140 W`).

## System overview

```
                        ┌────────────────────────────────────────────────┐
                        │                 SolarHelm core                 │
 Victron SmartShunt ───►│ IBatteryMonitor ─┐                             │
 (VE.Direct, M2)        │                  ▼                             │
 MPPT telemetry ───────►│ ISolarMonitor  SafetySupervisor                │
 (RS485/VE.Direct, M2)  │                  │ verdict                     │
 u-blox GNSS ──────────►│ IGps             ▼                             │
 (UART, M2)             │            ModeManager ──► BatteryPowerCtrl    │
                        │            (MANUAL/SOLAR/    (LPF→deadband→    │
                        │             SOLAR+ + reserve  PI→ramp→clamp)   │
                        │             floor w/ hyst.)      │             │
                        │                  ▼               ▼             │
                        │            EnergyTracker    IThrottleOutput ───┼──► GP8403 DAC
                        │            (Wh, km, Wh/km)  (0..100 %)         │    0–5 V (M2)
                        │                  ▼                             │
                        │            TelemetryRecord (CSV/flash/app)     │
                        └────────────────────────────────────────────────┘
```

Everything inside the box is portable C++17 with **no** Arduino/ESP-IDF
dependency, no dynamic allocation in the control path, no wall-clock reads
(time is passed in). The box runs, byte-for-byte identical, in three places:

| Host | Entry point | Purpose |
|---|---|---|
| Desktop simulator | `sim/main.cpp` | scenario CSVs, plots, development |
| Desktop tests | `tests/*` | 100 %-coverage unit + scenario tests |
| ESP32-S3 firmware | `firmware/main.cpp` | the boat (Milestone 2+) |

## Repository layout

```
lib/solarhelm/src/sh/     the portable core (one PlatformIO library)
  core/       config (validated, versioned), samples, Helm orchestrator
  control/    LowPassFilter, PiController, RateLimiter,
              BatteryPowerController, ModeManager
  safety/     SafetySupervisor (freshness, plausibility, fault flags)
  energy/     EnergyTracker (Wh, km, Wh/km)
  telemetry/  TelemetryRecord + CSV serialisation
  drivers/    interfaces only: IBatteryMonitor, ISolarMonitor, IGps,
              IThrottleOutput
lib/simcore/src/simc/     desktop-only simulation library
  solar/battery/hull/gps models, simulated drivers, scenarios, harness
firmware/                 ESP32-S3 entry point (stub in Milestone 1)
sim/                      simulator CLI
tests/                    C++ tests (framework.h = 70-line harness)
app/                      companion planner PWA (+ its node tests)
site/                     project website + feasibility calculator
config/boat_profile.json  THE shared boat model (see below)
drivers/                  placeholder dirs for Milestone-2 hardware drivers
hardware/                 Phase-2 interface PCB (documented, not designed)
tools/                    coverage gate, plots, site build, browser smoke
```

## Driver plugin model

The core consumes four small interfaces (`sh/drivers/interfaces.h`); every
sensor/actuator is a plugin behind them:

```
IThrottleOutput ── AnalogThrottle (GP8403 DAC, M2)
               ── VescThrottle / CanThrottle / PwmThrottle (later)
               ── SimulatorThrottle (today)
IBatteryMonitor ── VictronSmartShunt via VE.Direct (M2)
               ── generic shunt / BMS integrations (later)
               ── SimulatedShunt (today)
```

Rules the interfaces encode:
- `read()` never blocks; it returns the latest sample with its timestamp.
  Freshness policy belongs to the SafetySupervisor, not the driver.
- Throttle outputs clamp defensively and default to **zero** on power-up
  and after any fault.
- Reverse is out of scope for automatic control (V1 is forward-only).

## Control pipeline (per tick)

1. **SafetySupervisor** judges each sample: battery fresh + plausible ⇒
   auto allowed; GPS/solar stale ⇒ flags only (not control-critical).
2. **ModeManager** resolves the battery-power target: 0 W (SOLAR),
   configured negative value (SOLAR+), and applies the **reserve floor** —
   at/below reserve SOC the target is raised to +deadband and *latched*
   (2 % hysteresis) so no deadband rest point can leak energy and no
   chatter occurs at the boundary.
3. **BatteryPowerController**: low-pass filter (τ = 2 s) → deadband
   (±25 W freezes the command entirely — no hunting) → clamped PI with two
   anti-windup mechanisms (integrator clamping + tracking against the
   rate-limited output) → asymmetric slew limiter (+2 %/s up, −5 %/s down)
   → min/max clamp.
4. **Helm** assembles the telemetry record and returns
   `{auto_active, motor_cmd_pct}`. When `auto_active == false` the hardware
   layer must give the physical throttle authority (see docs/SAFETY.md).

Control cadence: ~4 Hz on hardware, 2 Hz in scenario sims. The plant
(hull + battery bus) responds over seconds, so nothing faster is useful;
the loop is dt-driven and tolerates jitter.

## The shared boat model

`config/boat_profile.json` is consumed by **three** implementations that
tests keep in lock-step:

- C++ simulator (`simc::BoatProfile`, minimal schema-specific parser —
  no JSON library dependency); test asserts file ⇔ built-in default.
- Planner PWA + calculator (`app/js/profile.js`); test asserts
  `DEFAULT_PROFILE` deep-equals the JSON file.

The hull efficiency curve in it is the spec's placeholder. Sea trials
(docs/SEA_TRIALS.md) replace it with measured data; the planner can also
fit a curve directly from telemetry CSV.

## Companion planner PWA (`app/`)

Static, build-free, installable, offline-capable. Pure-logic modules
(`energy_model`, `forecast`, `planner`, `charts`, `calculator_model`) are
node-tested to 100 %; DOM glue (`ui.js`, `calc_ui.js`) takes an injected
`document` so even it runs under node; only `sw.js` is browser-lifecycle
code (smoke-tested in headless Chromium). Forecast: Open-Meteo (keyless,
CORS) with a clear-sky sun-geometry fallback so the app is useful offshore.
The planner is **advisory only** — it never commands the throttle.

## Decision record

| Decision | Choice | Why |
|---|---|---|
| Core language | C++17, freestanding-friendly, `-fno-exceptions` | must run identically on ESP32 and desktop; exceptions have no place in a control loop |
| ESP32 framework | Arduino (PlatformIO) initially | fastest path for M2 drivers; the core has zero Arduino includes, so ESP-IDF migration stays a Makefile-level change. Revisit when we need TWAI/CAN or tighter watchdog control — both are available from Arduino via ESP-IDF calls anyway |
| Desktop builds | plain `make` + g++, no PlatformIO | zero-dependency contributor experience; PlatformIO stays for firmware only |
| Test framework | own 70-line harness | no third-party dependency for the desktop gate; Unity adds nothing we use |
| JSON parsing (C++) | minimal schema-specific parser | a general JSON lib is dead weight on the MCU and in review |
| Charts (app) | hand-rolled SVG strings | testable as pure functions; no chart library, no build step |
| Coverage | 100 % lines, gcovr (C++) + c8 (JS), CI-gated | see `tools/check_coverage.sh` header for the two documented exclusions |
| Phone↔boat link | **Dual transport.** Wi-Fi SoftAP + HTTP JSON (`/telemetry`, `/remote`, `/config`) for setup, bulk log download and the boat-served app; **BLE GATT** (read telemetry char, write remote char, same payloads) for underway use from the HTTPS-hosted app | a secure (https) page cannot call the boat's plain HTTP — mixed content is blocked by every browser — while Web Bluetooth *requires* a secure context: the two transports are complementary by construction. BLE keeps the phone's own internet for forecasts/tiles. iOS Safari has no Web Bluetooth → iOS uses the boat-served (http) app, where same-origin HTTP is unrestricted. Online data is always downloaded by the phone and cached in the app (`js/net_cache.js`) — the boat never needs internet and safety never depends on any link |
| Remote config | whitelisted tunables only (`sh/net/applink` `kConfigFields`), validated by `ControlConfig::validate()` boat-side, persisted in NVS; protection-envelope thresholds are NOT remotely writable | tuning gains from a phone is useful; re-rating the battery from a phone is how packs die. Envelope values change with a screwdriver and a datasheet |
| Link protocol logic | portable `sh/net/applink` (JSON serializer + strict `target_w` parser), firmware only moves bytes | keeps the phone-facing attack/failure surface inside the 100 % desktop-tested gate |

## Milestones

1. **(this repo state)** Simulator + core + tests + planner + site.
2. ESP32-S3 hardware-in-loop: VE.Direct parser (desktop-testable text
   protocol), GP8403 driver, GNSS NMEA parser, MANUAL/AUTO input, watchdog;
   drive a multimeter, not a motor.
3. Bench: Kelly controller + 24 V battery + small motor; calibration,
   zero-throttle and override validation.
4. Sea trials: efficiency map capture (docs/SEA_TRIALS.md), tuning.
   See docs/ROADMAP.md for the long view.
