# SolarHelm Roadmap

## Milestone 1 — Simulator + core controller ✅ (this repository state)

Repository scaffolding, research + buying guide, architecture/safety/
control docs, deterministic simulator with 13 scenarios, PI battery-power
controller with MANUAL/SOLAR/SOLAR+ and the reserve floor, 100 %-coverage
test suites (C++ and JS), scenario graphs, companion planner PWA
(Open-Meteo + clear-sky fallback, telemetry-curve learning), project
website with feasibility calculator, CI + Pages deployment.

## Milestone 2 — ESP32-S3 hardware-in-loop

The next smallest useful step is the **VE.Direct text-protocol parser** as
a pure-C++ desktop-testable module — it unlocks the real SmartShunt with
zero risk. Then:

- `drivers/victron/`: VE.Direct frame parser + checksum (desktop tests with
  recorded frames), UART driver on ESP32.
- `drivers/gps/`: NMEA RMC/VTG parser (desktop-testable), u-blox UART
  config for 5 Hz.
- `drivers/throttle/`: GP8403 I2C driver implementing `IThrottleOutput`
  (power-on-zero verified with a meter).
- MANUAL/AUTO input, AUTO-assert heartbeat output, watchdogs enabled.
- Persisted, versioned config in NVS + validation on load.
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
tuning; RANGE mode implementation on the measured curve.

## Future (documented, deliberately not started)

- solar + weather forecast feeding an on-board energy budget (ARRIVAL mode
  with destination SOC, "energy budget by sunset")
- planner app ↔ boat live link (ESP32 Wi-Fi API: telemetry out, curve sync)
- route planning, wind/current compensation
- NMEA 2000 and Signal K integration; autopilot coupling
- VESC / CAN / PWM throttle drivers; multiple motors; regen where supported
- cloud-edge prediction from PV slope; ML hull-efficiency model
- remote telemetry, mobile dashboard refinements
- Phase-2 hardware: the SolarHelm interface PCB (see hardware/README.md)
