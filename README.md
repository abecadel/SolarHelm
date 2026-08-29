# SolarHelm ⛵☀️

**Energy-aware cruise control for solar-electric boats.**

SolarHelm automatically adjusts electric boat propulsion to available solar
energy, battery reserve and real-world efficiency.

Instead of holding a fixed speed, SolarHelm holds a fixed **battery power**
(0 W = pure solar cruising): when the battery is charging, propulsion
increases; when it starts discharging, propulsion eases off. The boat
speeds up and slows down with the sun — deliberately — and can cruise for
many hours a day without shore power. Croatia is the reference use case.

```
error = target_battery_power − measured_battery_power
motor_command ← controller(error)        # filtered, deadbanded, PI,
                                         # ramped, clamped, fail-safe
```

## Status: Milestone 1 complete — simulation-proven core

The identical portable C++ core that will run on the ESP32-S3 already runs
in a deterministic simulator and a 100 %-line-coverage test suite, and
demonstrably:

- holds battery power at **≈ 0 W (mean −1 W)** while solar swings
  300–1500 W ([Scenario A](docs/SIMULATION_RESULTS.md));
- ramps down safely (never faster than the configured slew) when 80 % of
  the solar vanishes (Scenario B);
- rises with **zero overshoot** when the sun returns (Scenario C);
- refuses to consume battery below the reserve SOC — latched floor with
  hysteresis (Scenario D);
- drops to MANUAL with zero automatic throttle within 3 s of losing the
  battery monitor, and never resumes by itself.

![Scenario A](docs/img/DemoA_SolarSwing.png)

Also included: a **companion planner PWA** (forecast-driven range/SOC
prediction, learns your real Wh/km curve from telemetry) and a **project
website** with a feasibility & cost calculator.

## Quickstart (desktop — no hardware needed)

```bash
make test                          # build + run the C++ test suite
make scenarios                     # run all 13 simulation scenarios -> sim/out/*.csv
pip install matplotlib && python3 tools/plot_scenarios.py   # -> docs/img/*.png
tools/check_coverage.sh            # the 100% coverage gate (needs gcovr; JS gate needs node 20+)
cd app && npm test                 # planner app unit tests
tools/build_site.sh                # assemble website+app into _site/
```

Firmware (stub, Milestone 2 begins here): `pio run -e esp32s3`.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | layers, driver plugin model, decision record |
| [docs/CONTROL_THEORY.md](docs/CONTROL_THEORY.md) | the control loop, tuning, modes, phases |
| [docs/SAFETY.md](docs/SAFETY.md) | the 15 fail-safe requirements and the MANUAL-default relay |
| [docs/MOTOR_PROTECTION_RESEARCH.md](docs/MOTOR_PROTECTION_RESEARCH.md) | do frequent power changes wear components? (no) + the protection envelope |
| [docs/SIMULATION_RESULTS.md](docs/SIMULATION_RESULTS.md) | scenario graphs + analysis |
| [docs/RESEARCH.md](docs/RESEARCH.md) | hardware/software ecosystem research |
| [docs/BUYING_GUIDE.md](docs/BUYING_GUIDE.md) | three costed BOMs in PLN with live links |
| [docs/WIRING.md](docs/WIRING.md) | control wiring + high-current topology |
| [docs/SEA_TRIALS.md](docs/SEA_TRIALS.md) | measuring your boat's real efficiency curve |
| [docs/HARDWARE_TEST_PLAN.md](docs/HARDWARE_TEST_PLAN.md) | what to order, in which waves, and the gated bench/water test protocol |
| [docs/GLOBAL_ADAPTIVE_ROUTE_PLANNER_RESEARCH.md](docs/GLOBAL_ADAPTIVE_ROUTE_PLANNER_RESEARCH.md) | the global-first voyage planner: DP optimizer, PWA architecture, SAFE gates |
| [docs/GLOBAL_ENVIRONMENT_PROVIDERS.md](docs/GLOBAL_ENVIRONMENT_PROVIDERS.md) | global environmental data providers, tiers, coverage registry |
| [docs/ADAPTIVE_ENERGY_MODEL_RESEARCH.md](docs/ADAPTIVE_ENERGY_MODEL_RESEARCH.md) | how SolarHelm learns the individual vessel |
| [docs/COMPANION_APP.md](docs/COMPANION_APP.md) | the planner PWA |
| [docs/ROADMAP.md](docs/ROADMAP.md) | milestones 2–4 and the future list |

## Core modes

| Mode | Behaviour |
|---|---|
| **MANUAL** | SolarHelm outputs zero; the physical throttle has authority (hardware-guaranteed default) |
| **SOLAR** | battery power target 0 W — cruise on sunshine alone |
| **SOLAR+** | allow a configured battery contribution (e.g. −200 W) |
| *(reserve floor)* | in any auto mode: at reserve SOC, no further net discharge |
| RANGE / ARRIVAL | designed, arriving after sea-trial data (docs/CONTROL_THEORY.md) |

## Safety, in one paragraph

SolarHelm never switches motor current — it generates a low-power 0–5 V
throttle signal for a commercial motor controller, through a hardware
clamp and a normally-de-energized relay whose resting state is MANUAL. A
crashed MCU, a stale sensor, a reboot, or a pulled plug all mean: zero
automatic throttle, manual helm, independent kill switch untouched.
Details and the full requirement table: [docs/SAFETY.md](docs/SAFETY.md).

## Website & planner

`site/` + `app/` deploy to GitHub Pages via `.github/workflows/pages.yml`.
One-time setup: repo **Settings → Pages → Source: “GitHub Actions”**.
The planner also runs locally: `tools/build_site.sh` then serve `_site/`.

## Contributing / engineering rules

Portable core, dependency inversion for all hardware, explicit units in
names (`battery_power_w`), no dynamic allocation or blocking delays in the
control path, deterministic tests, and a CI-enforced **100 % line-coverage
gate** (`tools/check_coverage.sh`; the only exclusions are the ESP32-only
entry stub and the service worker, both documented there).

License: [MIT](LICENSE).
