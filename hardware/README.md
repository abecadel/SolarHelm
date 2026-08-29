# SolarHelm interface PCB (Phase 2 — documented, deliberately not designed yet)

Milestones 1-3 run on an ESP32-S3-DevKitC-1 plus breakout modules, wired
per docs/WIRING.md. Once that prototype has proven itself at sea, a single
interface PCB replaces the module stack. Designing it earlier would freeze
mistakes we haven't discovered yet.

## Planned feature set

- ESP32-S3 module (WROOM-1)
- 12/24/48 V input -> isolated/protected 5 V + 3.3 V supplies
- VE.Direct input (3.3 V UART, ESD-protected)
- RS485 transceiver (MPPT Modbus)
- CAN/TWAI transceiver (future motor controllers)
- GNSS connector (UART + backup supply)
- I2C header + on-board GP8403-class 0-5 V DAC
- hardware throttle clamp (divider + zener) on the DAC output
- MANUAL/AUTO relay (normally de-energized = MANUAL) driven by a
  heartbeat/monostable circuit, physical mode switch input in series
- external watchdog supervisor able to drop the relay independently
- kill-switch/enable sensing via optocoupler
- status LEDs (mode, faults) + buzzer
- microSD (telemetry) — optional
- IP65-ready enclosure footprint, screw terminals for field wiring

## Design constraints carried over from docs/SAFETY.md

Loss of the MCU, its supply, or the heartbeat must leave the manual
throttle path closed; the DAC path must be voltage-bounded in hardware; no
propulsion current ever flows through this board.
