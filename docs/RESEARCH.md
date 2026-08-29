# SolarHelm Research

Hardware and software ecosystem research underpinning the Milestone-1
design decisions. Research dates: 2026-08-29. Companion documents:
[BUYING_GUIDE.md](BUYING_GUIDE.md) (components, prices, BOMs) and
[MOTOR_PROTECTION_RESEARCH.md](MOTOR_PROTECTION_RESEARCH.md) (does
frequent power adjustment wear components? — no; includes the Motor
Protection Envelope).

*Method note: much of this was gathered through a sandbox whose egress
proxy blocks many vendor/journal domains; such sources are cited from
corroborated search extracts and flagged. Two repositories were cloned and
read directly (OpenDTU-OnBattery, VESC firmware) — those findings are
primary. Facts that could not be confirmed are marked UNVERIFIED rather
than guessed.*

---

## 1. Electric boat propulsion power management

The open-source niche SolarHelm targets — *energy-aware cruise control* —
is essentially unoccupied: solar boat racing teams publish telemetry and
power-stage hardware (see §Reference projects) but no released project
closes a throttle loop on battery power. Commercial practice does exist
and validates the actuation pattern: Minn Kota's i-Pilot has shipped GPS
cruise control (continuous automatic prop-power adjustment in 0.1 mph
steps) for over a decade; Torqeedo ships GPS-computed range management;
ePropulsion's manual prescribes battery-state-based power capping.
(Sources in MOTOR_PROTECTION_RESEARCH.md §1.6.)

## 2. Solar-powered boats

Race-class solar boats (Zênite Solar's Guarapuvu II, Moscow Polytech's
Manta Ray, Dutch/BME solar boat teams) converge on the same architecture:
modular power electronics on a CAN bus, per-panel MPPT to fight shading,
and a human throttle with telemetry-informed pacing. Cruising boats
(Torqeedo/ePropulsion ecosystems) converge on lithium + BLDC + app
telemetry. SolarHelm sits between: cruiser hardware, race-style energy
awareness, closed-loop.

## 3. Energy-aware throttle control

The closest working analog is **OpenDTU-OnBattery's Dynamic Power
Limiter** (github.com/hoylabs/OpenDTU-OnBattery, cloned and read):
the identical control problem transposed to a house — adjust an inverter
limit until a meter reads a target (default 0 W, zero export). Its
implemented control law, verified from `src/PowerLimiter.cpp`:

- **feed-forward step controller, not a PID**: `newOutput =
  currentProduction + (meterReading − target)`, one bounded correction,
  then *wait for fresh data* (adaptive 128 ms→1024 ms backoff);
- watt-level deadband (`TargetPowerConsumptionHysteresis`) so the
  actuator isn't chattered;
- **asymmetric slew**: `getMaxIncreaseWatts()` conservative, reductions
  fast — ramp up slowly, cut back quickly;
- two-threshold hysteresis on every boundary (SOC start/stop 80/20 %,
  voltage start/stop 50.0/49.0 V defaults) — never a single trip point;
- **load-corrected voltage** `V + P·k` (k = 0.001 V/W default) so sag
  isn't mistaken for emptiness;
- stale meter ⇒ fall back to a fixed safe level (`BaseLoadLimit`), never
  hold the last computed command; actuator-ack timeout counters (log at
  10, comms reset at 20);
- hard caps outside the control law (`TotalUpperPowerLimit`).

SolarHelm's implemented pipeline (deadband + PI with tracking anti-windup
+ asymmetric ramps + hard clamps, docs/CONTROL_THEORY.md) matches this
field-proven shape; the PI's integrator plays the role of DPL's iterated
feed-forward step with the same slow cadence.

## 4. Zero-export / zero-battery-current power controllers

Deployed zero-export systems agree on the recipe and the reasons:
Victron ESS runs a ~1–5 s loop with a hard ramp-rate cap (e.g. 400 W/s
for some grid codes) and tolerates famously slow meters (ET112) —
correctness over speed; Home-Assistant zero-export blueprints all
converge on *smooth the measurement, deadband, slow setpoint cadence*;
a documented ESS failure mode is charge/discharge oscillation when
sitting on a single threshold — the argument for wide hysteresis
everywhere. Reasons slow loops win universally: sensor latency (1–10 s)
makes fast loops double-correct on stale data; actuators respond
asynchronously; steps are felt (by the grid, or the helmsman).
Sources: victronenergy.com ESS mode 2/3 docs, Victron community threads
128826/51697/51308, github.com/viseradius/ha-pv-zero-export.

## 5. MPPT behaviour under rapidly changing load

Two findings shape SolarHelm:

- **Timescale separation makes the loops orthogonal.** An MPPT's tracker
  re-converges in well under a second; a rate-limited outer loop at
  0.2–0.5 Hz is quasi-static to it (cascaded-control rule: outer ≥5–10×
  slower than inner settling). SolarHelm's slow ramps are thus an MPPT
  stability feature, not just comfort.
- **The absorption/float caveat:** when the battery is full the charger
  regulates voltage and curtails PV, so "available solar" is
  *unobservable* from PV telemetry. Controlling **battery power**
  sidesteps this entirely: as SolarHelm raises the throttle, the charger
  un-curtails, battery power returns to ~0, and the loop implicitly walks
  up to the array's true MPP with no PV-side modeling. This is the
  deepest justification for the project's core control variable. Surface
  the MPPT charge-state (`CS` field) in telemetry so users see why
  PV watts ≠ potential.

## 6. PID/PI controllers for power balancing

Field systems (§3–4) either avoid PID (DPL's step controller) or wrap it
in the same protections SolarHelm implements: measurement filtering,
deadband, slew limits, anti-windup, hysteresis at boundaries. A
practitioner post-mortem of naive PID zero-export (medium.com/random-post-mortems,
"A PID controller for zero grid export") lists exactly the pitfalls
SolarHelm's design addresses: filter-vs-lag tradeoff, actuator
quantization, meter latency. SolarHelm's tuning analysis and the
two-stage anti-windup are in docs/CONTROL_THEORY.md; simulation evidence
(mean −1 W tracking, zero overshoot) in docs/SIMULATION_RESULTS.md.

## 7. Marine throttle-by-wire safety

Recreational-craft practice: independent lanyard kill switch acting on
the drive's enable/contactor path; helm authority always recoverable;
controllers implement high-pedal-disable (refuse to start with throttle
applied — Kelly ships this) and direction interlocks (throttle release
required before reverse). SolarHelm adopts all of it and adds the
normally-de-energized MANUAL-default relay (docs/SAFETY.md): automatic
control exists only while software actively asserts a heartbeat.

## 8. Fail-safe motor control

Patterns adopted from controller vendors and the zero-export field:
default-to-zero outputs at power-up (GP8403 DAC powers up at 0 V —
verified from library docs, bench-test before trusting); command
refresh timeouts as failsafes (VESC releases the motor if commands stop
streaming — a free dead-man's switch for a future VescThrottle);
stale-sensor ⇒ safe fallback, never hold-last; watchdog-forced resets
landing in MANUAL. SolarHelm's supervisor implements the slow-policy
layer of this split; the fast layer stays in the commercial controller
(full table: MOTOR_PROTECTION_RESEARCH.md §2 answer 14).

## 9. ESP32 reliability in embedded control

Concrete practices for a control device (sources: ESP-IDF docs,
esp32.com threads, ESPHome PR #11669):

- **Watchdogs layered**: task watchdog fed by the control task each
  cycle; interrupt WDT default; optional external hardware watchdog able
  to drop the AUTO relay independently (our Phase-2 PCB plans one).
- **Brownout detector ON** — a motor transient sagging 3.3 V must cause
  a clean reset into MANUAL, not undefined execution.
- **Core pinning**: WiFi/LwIP own core 0; pin the control task + UART
  parsing to core 1 at higher priority (measured: HTTP on core 0
  stretches unpinned task timing from ~500 µs to 800 µs+; ESPHome moved
  its loop to core 1 for this reason).
- **NVS wear**: log-structured with wear leveling (~126 writes/erase
  amortization) but never write per control cycle — batch energy
  counters to minutes or events.
- **OTA**: two app partitions + rollback; mark-valid only after a
  self-test (sensors readable, loop running); policy: no OTA while the
  motor is engaged.

## 10. Victron VE.Direct protocol

Primary doc: VE.Direct Protocol v3.34 PDF (victronenergy.com/upload/documents/VE.Direct-Protocol-3.34.pdf).
Serial 19200 8N1, **3.3 V logic** (ESP32-direct, never 5 V; not
isolated — mind grounds on a boat). Devices emit a text frame ~every 1 s:
`\r\n<label>\t<value>` records ending in a `Checksum` record; block is
valid when the modulo-256 sum of all bytes is 0. Fields SolarHelm uses —
SmartShunt: `V` (mV), `I` (mA signed), `P` (W), `SOC` (‰), `CE`, `TTG`;
Victron MPPT: `V`, `I`, `VPV`, `PPV`, `CS` (charge state), `ERR`. A HEX
request/response protocol multiplexes on the same UART — parse
defensively around it. **Parser choice: OpenDTU-OnBattery's in-tree
`lib/VeDirectFrameHandler`** (actively maintained, checksum-validating,
split shunt/MPPT controllers) over the dormant original
cterwilliger/VeDirectFrameHandler. This parser is Milestone 2's first
deliverable, as a desktop-testable pure-C++ module.

## 11. JK-BMS / JBD / generic BMS integrations

De-facto open register maps: **github.com/syssi/esphome-jk-bms** and
**esphome-jbd-bms** (frame formats for pack V/I, per-cell voltages, SOC,
protection flags; vendor protocol PDFs in the repos' docs/). Prefer wired
UART (115200) over BLE for anything control-adjacent. SolarHelm role:
BMS data is a *cross-check* and its protection flags are hard
throttle-inhibit inputs — the control input stays the shunt.
OpenDTU-OnBattery also ships non-ESPHome C++ JK-BMS serial providers
worth cribbing.

## 12. Modbus/RS485 MPPT integrations (EPEVER)

EPEVER's register map is public ("B-Series MODBUS Specification V2.3";
practical maps: github.com/kasbert/epsolar-tracer `registers.py`).
RS485 Modbus RTU, 115200 baud on Tracer-AN, addr 1; real-time input
registers at 0x3100+ (PV V/I/P, battery V/I/P, SOC at 0x311A, ×100
scaling), read with function 0x04. A ~12 PLN RS485-TTL module gives the
ESP32 budget PV telemetry. Note from the hardware research: the 150 V
Tracer **4215AN has no confirmed Polish stock** — PL shops sell the
100 V 4210AN; with 2s strings of 450 W panels (Voc ≈ 83 V) 100 V works
*only* after a cold-weather Voc margin check, and Victron 100/30 units
(VE.Direct, one per panel) are the smoother integration at nearly the
same price.

## 13. CAN-based motor controllers

VESC (github.com/vedderb/bldc, read directly): framed protocol identical
over UART/CAN — start `0x02`/`0x03`, payload = command id + big-endian
scaled ints (`COMM_SET_DUTY` id 5, duty×100000; `COMM_SET_CURRENT`,
`COMM_SET_RPM`), CRC16 over payload; `COMM_GET_VALUES` returns V, I,
RPM, temperatures — so a VESC can *also serve as the power sensor*.
Commands time out and release the motor if not refreshed — a built-in
failsafe SolarHelm's future `VescThrottle` driver must stream against.
Zênite Solar's `CAN_IDS` repo (code-generated message dictionary shared
by all nodes) is the model for growing SolarHelm beyond one box.
ESP32-S3 has a TWAI controller; an SN65HVD230 transceiver (~19 PLN)
completes the physical layer.

## 14. Analog 0–5 V / Hall throttle interfaces

Kelly KDS-class controllers accept 0–5 V resistive/analog and 1–4 V
hall-active throttles, supply 5 V for the pot, validate the input
(high-pedal-disable, out-of-range faults), and (per the community
translation of Kelly's config tool) run KD/KDS throttle in torque/current
mode. Design consequences adopted: SolarHelm drives the analog input
through a DAC (GP8403: 2-channel, 0–5 V/0–10 V ranges, I2C, powers up at
0 V) behind a hardware clamp and the MANUAL/AUTO relay; it never bypasses
the controller's throttle validation; broken-wire safety comes from the
pull-down defining 0 V. The 1–4 V hall convention matters for
calibration: map SolarHelm's 0–100 % onto the controller's *effective*
throttle window, leaving clamp headroom (docs/WIRING.md).

## 15. GPS-based Wh/km efficiency measurement

Use Doppler-derived speed over ground from `RMC`/`VTG` — never
differentiated positions. At 1 Hz, SOG noise dominates instantaneous
Wh/km on a slow boat; 5–10 Hz lets speed be averaged over the same
window as the 1 s power frames. u-blox config: UBX-CFG-RATE (M8) /
CFG-RATE-* keys (M10), raise UART baud and trim the sentence set to
RMC(+VTG) or the receiver drops sentences; persist with UBX-CFG-CFG.
Constellation caveat: M8N falls back to 5 Hz with multi-GNSS enabled —
fine for our purpose. Old NEO-6M modules (1–5 Hz, GPS-only, −161 dBm,
2006-era engine) are rejected; a generic NEO-M8N board costs ~70 PLN
(docs/BUYING_GUIDE.md).

---

## Reference projects examined

| Project | What it is | Take for SolarHelm |
|---|---|---|
| **OpenDTU-OnBattery** (hoylabs) | ESP32 zero-export battery-power limiter | the control-law blueprint (§3); the VE.Direct parser; stale-data and timeout patterns. Avoid: its inverter-class complexity explosion — SolarHelm keeps one control path |
| **Open-Source-Autonomous-Boat PMS-Prototype** | board-level power-management hardware for small autonomous boats | shunt placement: measure *net battery* power at one point of truth |
| **SEM32** (gropi75) | ESP32 home-energy hub speaking RS485×2 + CAN | realistic picture of SolarHelm's protocol load (VE.Direct + BMS + GNSS + throttle concurrently); threshold-steering not PID |
| **Zênite Solar** (~89 repos, Guarapuvu II) | modular CAN-node solar race boat (per-panel MPPT, motor module, steering) | the `CAN_IDS` code-generated message dictionary; separation of energy manager from dumb throttle node. Avoid: per-year repo forks |
| **Moscow Polytech Solar Regatta** | boat telemetry (`solar-monitor`) | confirms the energy-aware-cruise-control niche is empty in open source |
| **VESC ecosystem** | open ESC + protocol | future VescThrottle driver; command-timeout failsafe; VESC as power sensor |
| **Victron VE.Direct ecosystem** | text protocol + parsers | primary battery-power source; one parser covers shunt and MPPT |

## Assumptions and open questions

1. **Storm N86 internals** (brushed PM, resistor-tap speed head,
   polarity-swap reverse, ~48–50 A full power) are class-level inferences
   with high confidence but UNVERIFIED for this exact unit — confirm by
   disassembly before recommending the conversion (docs/BUYING_GUIDE.md
   flags this; the electrical topology check is a Milestone-3 gate).
2. **GP8403 powers up at 0 V** per library documentation; one cold-boot
   scope test is mandatory before it ever drives a live controller, and
   its `store()` function must never persist a non-zero output.
3. Kelly KDS **torque-mode throttle mapping** comes from a community
   translation of the config tool; verify against the owned unit.
4. Proxy-blocked primary documents (Kelly/Curtis manuals, Victron PDFs'
   fine print, panel datasheets) should be re-read from an unrestricted
   network before values are hard-coded.
5. The planner's wind penalty (4 %/(m/s)) and the placeholder hull curve
   remain assumptions until sea trials (docs/SEA_TRIALS.md).
