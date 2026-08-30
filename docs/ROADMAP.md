# SolarHelm Roadmap

## Milestone 1 — Simulator + core controller ✅ (this repository state)

Repository scaffolding, research + buying guide, architecture/safety/
control docs, deterministic simulator with 13 scenarios, PI battery-power
controller with MANUAL/SOLAR/SOLAR+ and the reserve floor, 100 %-coverage
test suites (C++ and JS), scenario graphs, companion planner PWA
(Open-Meteo + clear-sky fallback, telemetry-curve learning), project
website with feasibility calculator, CI + Pages deployment.

## Milestone 2 — ESP32-S3 hardware-in-loop

- ✅ `drivers/victron/`: VE.Direct frame parser + checksum + SmartShunt
  and MPPT adapters (desktop-tested to 100% coverage with synthesized
  frames, HEX-frame tolerant).
- ✅ `drivers/gps/`: NMEA 0183 parser (RMC/VTG/GGA, XOR checksum,
  any talker) + GpsMonitor adapter, desktop-tested to 100% coverage.
  Remaining: u-blox 5-10 Hz configuration (u-center or UBX commands).
- ✅ `drivers/throttle/`: GP8403 AnalogThrottle (register protocol from
  DFRobot's library source, injected I2C bus, 100% coverage).
- ✅ `sh/net/applink`: telemetry JSON + strict remote-target parser
  (desktop-tested to 100% coverage) — the phone↔boat protocol core.
- ✅ Firmware bindings written (`firmware/main.cpp` + `pins.h`):
  UART pumps → parsers, Wire → DAC, debounced MANUAL/AUTO switch,
  kill-sense, toggling relay heartbeat, task watchdog, SoftAP HTTP API.
  Compile-verified in CI; **physically untested — bench gates A1–A7 in
  docs/HARDWARE_TEST_PLAN.md are the acceptance tests.**
- ✅ Persisted tunable config: `GET/POST /config` (whitelisted fields,
  core-validated, NVS-stored; envelope thresholds deliberately not
  remotely writable) + BLE GATT link (telemetry read / remote write)
  for the HTTPS-served app — both compile-verified, bench-validated at
  gate A7.
- ✅ GPS position in every telemetry record → positioned logs populate
  the geographic residual store through the app's learner.
- Remaining in M2: power-on-zero verified with a meter (gate A1);
  Wi-Fi+BLE runtime coexistence tuning.
- Target: SolarHelm driving a multimeter from live simulated/replayed
  shunt data. **No propulsion connected.**

## Milestone 3 — Bench motor

24 V battery + Kelly controller + small DC motor (or the Storm lower unit
only if safe out of water — never run a water-cooled leg dry): throttle
calibration, zero-throttle safety, watchdog pull-to-manual, current
limiting, loop stability against a real electrical plant. Wiring per
docs/WIRING.md with calculated fusing.

## Milestone 4 — Sea trials

docs/SEA_TRIALS.md protocol; learned hull curve committed; gain/deadband
tuning; ~~RANGE mode implementation~~ ✅ RANGE mode shipped in the core
(open-loop hold of `range_motor_power_w`, sim-validated in the
`RangeCruise` scenario) — sea trials calibrate the value on the measured
curve via the Setup tab's "Set RANGE power from learned model".

## Future (documented, deliberately not started)

- ~~solar + weather forecast feeding an on-board energy budget (ARRIVAL
  mode with destination SOC)~~ ✅ ARRIVAL mode shipped: the phone's
  voyage plan streams a battery-power budget the boat tracks
  closed-loop, degrading to SOLAR 10 s after the stream stops
  (`ArrivalBudget` scenario) — forecasts stay on the phone by design
- planner app ↔ boat live link (ESP32 Wi-Fi API: telemetry out, curve sync)
- ~~route planning, wind/current compensation~~ ✅ planner v2 in the PWA:
  global-first providers (waves + ocean currents), learned hull model,
  (segment, time) → max-SOC route DP with departure sweep and solar stops,
  SAFE/POSSIBLE/INFEASIBLE gates (see docs/COMPANION_APP.md)
- NMEA 2000 and Signal K integration; autopilot coupling
- VESC / CAN / PWM throttle drivers; multiple motors; regen where supported
- cloud-edge prediction from PV slope; ML hull-efficiency model
- remote telemetry, mobile dashboard refinements
- Phase-2 hardware: the SolarHelm interface PCB (see hardware/README.md)
- **Helios-driven items** (docs/case-studies/HELIOS_11_LESSONS.md):
  hull-count-aware vessel profile (mono/cat/tri + LWL/beam/spacing/bow
  fields, L2/L9); `config_revision` stamped into telemetry with
  learning-state branching (L1); ~~EnergyKnee + SolarEquilibriumSpeed in
  the PWA UI (L5/L6); per-day energy ledger in the voyage summary
  (L7); min-steerage-speed safety gate (L12)~~ ✅ shipped in the app;
  IMU roll/pitch telemetry (L8)
- **SolarHelm Vessel Designer** (concept only, deliberately not
  started): offline multi-objective search over {length, slenderness,
  displacement, PV, battery, motor, speed} maximizing daily autonomous
  distance under payload/comfort/stability/cost/reserve constraints,
  reusing the planner's physics modules — see
  docs/reference-vessels/SOLARHELM_LIGHT_POWERCAT.md
