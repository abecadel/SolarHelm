# Hardware Buying & Test Plan

The concrete path from "software done" to "boat cruising on sunshine":
what to order, in which waves, and the bench/water test protocol with
acceptance criteria for each step. Prices and links: docs/BUYING_GUIDE.md
(snapshot 2026-08-29 — re-check listings before ordering). Safety rules:
docs/SAFETY.md. Wiring: docs/WIRING.md.

Software status feeding this plan: the control core, protection envelope,
and REMOTE mode are implemented and simulation-tested; the VE.Direct,
NMEA and GP8403 drivers are implemented with 100 % coverage, and the
ESP32 firmware bindings (UART pumps, Wire-backed DAC, heartbeat/switch
GPIO logic, SoftAP HTTP JSON API — see firmware/main.cpp + firmware/
pins.h) are **written and compile-verified in CI but physically
untested: every gate below is the test.** Pin numbers live in
firmware/pins.h.

## Order waves

### Wave 1 — Bench electronics (order now) ≈ 900 PLN

| Item | ~PLN | Why now |
|---|---|---|
| ESP32-S3-DevKitC-1-N8R8 (or Waveshare clone) | 85 | everything runs on it |
| DFRobot DFR0971 (GP8403) DAC | 56 | throttle path |
| NEO-M8N GNSS board | 70 | GPS driver bring-up |
| Victron **SmartShunt 500 A IP65** | 389 | the control input; works on a bench PSU — do not wait for the boat |
| Isolated 24→5 V module, relay + socket, toggle switch, LEDs, buzzer, breadboard/wires | ~150 | MANUAL/AUTO logic + supply |
| USB-UART adapter (VE.Direct replay + spare) | ~25 | test harness |
| GY-91 / MPU-9250-class 9-DOF IMU module | ~40 | heading + wave-motion features (adaptive model wants it; cheap — add now) |
| ANL fuse + holder (bench-scale fusing discipline from day 1) | ~69 | habits |

Also needed on the bench (assumed owned, else +250–400 PLN): multimeter,
bench PSU (or any 24 V source for the shunt), oscilloscope or a
scope-capable meter for the cold-boot test (a cheap DSO138-class scope
suffices).

### Wave 2 — Propulsion (order after Gate B2 passes) ≈ 3900–4400 PLN

| Item | ~PLN | Gate before ordering |
|---|---|---|
| STORM N86 24 V motor | 990 | order FIRST within this wave |
| **Open the motor head and verify** brushed PM + resistor-tap speed switch + polarity-swap reverse + measure conductor count | — | **hard gate for the next row** |
| Kelly KDS24100E | 879 | only after the motor's topology is confirmed (fallback: Haswing D80 MAX with built-in PWM) |
| WattCycle 24 V 100 Ah LFP (or LiTime +516 PLN for 0 °C cutoff + Bluetooth) | 1684–2200 | with Wave-2 shipping |
| Albright SW80 24 V contactor, battery switch, lanyard kill switch | ~365 | safety chain |
| 25 mm² cable ~6 m + lugs + glands + IP65 enclosure + 5 kΩ helm pot | ~330 | assembly |

### Wave 3 — Solar (order after Gate C4) ≈ 2300–2500 PLN

2× Jinko Tiger Neo 450 W (556 + shipping 150–250), 2× Victron SmartSolar
100/30 (868), mounting (~300), Mean Well 24→12 V (288), PV wiring/MC4/
fuses (~150).

### Optional, any time (adaptive-model accelerators)

Airmar DST810-class STW sensor (~1400–1600 PLN eq.) — the single
highest-value optional sensor for current estimation; defer until the
planner is in daily use.

## Test protocol

Every gate = do the steps, meet every acceptance criterion, log the
results in `docs/testlog/` (date, firmware commit, measurements). Never
proceed on a failed gate. The motor never turns near people or lines; the
prop never runs in air at speed; a water-cooled leg never runs dry.

### Phase A — Bench, no propulsion (Milestone 2)

**A1 — GP8403 cold-boot zero (safety-critical).**
Scope on OUT0. Power the DAC with the ESP32 held in reset; power-cycle
10×. *Accept:* output ≤ 50 mV at all times before firmware writes;
`store()` never called anywhere in firmware (grep + code review).
**A2 — Throttle chain.** ESP32 → `AnalogThrottle` → meter. Sweep
0→100→0 %. *Accept:* 0 % = 0.00 V ± 20 mV; 100 % = software ceiling
(4.50 V ± 50 mV) never the 5 V rail; monotonic; I2C NACK (unplug SDA)
drives `healthy()==false` and a logged fault within one tick.
**A3 — VE.Direct live.** Dry-run first without the shunt: a USB-serial
dongle (3.3 V TTL) on Serial1 fed by
`tools/hil_replay.py --stream shunt --port /dev/ttyUSB0` proves the
wiring and parser before real hardware. Then SmartShunt on bench PSU +
dummy load, TX→ESP32 RX (3.3 V!, GND common). *Accept:* valid blocks at
~1 Hz; V within ±0.05 V of meter; sign correct (charge +/discharge −);
pulling the wire (or killing the replay) forces MANUAL within
`battery_timeout_ms` (3 s) and auto never self-resumes.
**A4 — GNSS.** Dry-run on Serial2 with
`tools/hil_replay.py --stream gps --port /dev/ttyUSB1` (5 Hz RMC+VTG,
1 Hz GGA at 115200 — the NEO-M8N's target config): telemetry must show
the replayed position/speed, and `GPSFailure.csv` must raise
`kFaultGpsStale` without touching cruise logic. Then configure the real
NEO-M8N (115200, 5 Hz, RMC+VTG+GGA), window/outdoor test. *Accept:*
5 Hz fixes; stationary SOG < 0.3 kn; walking speed plausible; antenna
disconnect → `kFaultGpsStale` only, cruise logic unaffected.
**A5 — MANUAL/AUTO relay logic.** Relay + heartbeat monostable on
breadboard. *Accept:* relay NEVER energized without a live heartbeat
(static GPIO high must NOT hold it — AC-coupling verified); ESP32 reset/
hang (kill the task) drops to MANUAL ≤ 500 ms; physical switch overrides
in both directions.
**A6 — Watchdogs + brownout.** Enable task WDT; induce a deliberate hang;
sag the 5 V rail. *Accept:* reboot lands in MANUAL, DAC at 0 V (A1
behavior), event logged to flash.
**A7 — HIL end-to-end.** Replay a full simulator day into both UARTs
while the DAC drives the meter — two dongles, one scenario:
`tools/hil_replay.py sim/out/CroatiaClearSummerDay.csv --stream shunt
--port /dev/ttyUSB0` and the same CSV with `--stream gps --port
/dev/ttyUSB1` (regenerate CSVs with `make scenarios`; `--rate 10` for a
fast pass, `--selftest` if a frame looks suspect). Run SOLAR mode
against the replayed battery power. *Accept:* meter voltage tracks the simulated surplus as in
docs/SIMULATION_RESULTS.md; REMOTE mode accepts a target from a laptop
via `POST /remote {"target_w": N}` on the ESP32's SoftAP HTTP API
(`GET /telemetry` streams state back) and degrades to SOLAR 10 s after
the stream stops. Flash the companion app into LittleFS first
(`tools/pack_fs.sh` then `pio run -e esp32s3 -t uploadfs`) and verify
the ESP32 serves it at `http://192.168.4.1/` — the phone's Boat tab must
show live telemetry with no internet anywhere. Also verify: the **BLE
link** (Android Chrome on the HTTPS app: connect, live telemetry, a
REMOTE target, all while the phone keeps LTE internet); **Wi-Fi+BLE
coexistence** (no watchdog resets, control tick stays 10 Hz under both
links active); and **/config** (change `deadband_w` from the Setup tab,
power-cycle, confirm it persisted via NVS and an out-of-range value is
refused with the validation error name).
**Milestone-2 exit:** A1–A7 green ⇒ order Wave 2.

### Phase B — Motor bench (Milestone 3)

**B1 — Motor autopsy (before buying the Kelly).** Head opened: confirm
brushed PM, tap-resistor switch, polarity reverse; measure winding
resistance; document with photos into `hardware/`. *Accept:* topology
confirmed OR fallback motor decision taken.
**B2 — Controller alone.** Kelly + battery + helm pot, motor on the bench
**prop removed**. Calibrate throttle-effective range; set current limit
80 A, verify high-pedal-disable. *Accept:* smooth 0→max; controller
faults on shorted throttle wire; current limit trips into cutback, not
smoke.
**B3 — Full chain, manual.** Add contactor + kill switch + shunt in the
real harness (docs/WIRING.md), fuse sized from measured current.
*Accept:* kill switch cuts propulsion with SolarHelm unpowered; every
ampere returns through the shunt (loads off ⇒ shunt reads 0.0 A).
**B4 — Full chain, AUTO.** SolarHelm in the loop, motor unloaded (prop
off). *Accept:* AUTO engage requires explicit request + healthy data;
ramps match config (+2/−5 %/s); relay drop test (A5) at full command →
manual pot has instant authority; zero-throttle on every fault path
re-verified in hardware.
**B5 — Load test (bucket/test tank or flooded leg per manufacturer).**
30-min soak at 50 % + steps to the 48 A cap. *Accept:* envelope caps
engage exactly at configured thresholds (sag stages simulated by PSU
droop or a discharged pack); temperatures stable; measured A/W within
10 % of telemetry.
**Milestone-3 exit:** B1–B5 green ⇒ boat installation allowed.

### Phase C — On the water (Milestone 4)

**C1 — Dock trials.** Full harness on the boat, lines on. Repeat B4
essentials + kill-switch-from-helm. **C2 — MANUAL sea trial.** Baseline
handling, current draw at each head speed. **C3 — SOLAR-mode maiden.**
Calm day, two crew, MANUAL↔AUTO handoffs, deliberate shunt-cable pull at
low speed. *Accept:* every fail-safe behaves as on the bench.
**C4 — Power-ladder efficiency runs** per docs/SEA_TRIALS.md (250→1000 W,
reciprocal headings) → fitted hull curve committed to
`config/boat_profile.json`; planner + simulator re-baselined. ⇒ order
Wave 3 (solar).
**C5 — Solar system commissioning.** Panels + MPPTs, PV telemetry into
telemetry stream; a full SOLAR day; compare harvest against planner
prediction (first prediction-vs-actual records!).
**C6 — REMOTE/voyage rehearsal.** Phone planner streams targets over
SoftAP on a short route; kill the link mid-leg → boat degrades to SOLAR;
finish on plan.

## Standing safety rules for all phases

Lanyard kill switch worn during every powered test from B3 on; battery
main switch within reach; fuse before experiment; one change at a time;
never bypass a failed gate "just to see"; log everything (the test log is
also the adaptive model's first dataset).
