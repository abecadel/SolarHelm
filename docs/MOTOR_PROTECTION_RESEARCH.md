# Motor Protection Research

**Question:** Can frequent automatic power changes — SolarHelm adjusting the
requested throttle every few seconds as solar production changes
(800 W → 950 W → 1100 W → 900 W → 700 W → 1000 W) — damage or shorten the
life of electric boat motors, motor controllers, batteries, or drivetrain
components? The commercial motor controller/ESC still performs all PWM and
current control; SolarHelm only moves the requested throttle.

**Answer up front: No — provided the changes are rate-limited ramps, always
forward, and stay inside continuous ratings.** Every aging mechanism
identified in the literature keys on *average temperature*, *load
magnitude*, *reversals*, and *large-amplitude* swings — none on the count
of small changes. SolarHelm's duty profile (many small, slow, forward-only
corrections that keep average power low and battery throughput near zero)
sits at the *gentle* end of what every component in the chain is designed
and shipped to absorb. The detailed verdict is at the end of this
document, after the evidence.

*Research date 2026-08-29. Method note: the development sandbox's egress
proxy blocked direct fetches of many primary PDFs (Kelly, Curtis,
Infineon, Danfoss, Torqeedo/ePropulsion manuals, most journal full texts);
those are cited via corroborated search extracts of the actual documents
and flagged in Uncertainties. One fully primary source was read directly:
the VESC firmware (github.com/vedderb/bldc, local clone) — those numbers
are exact.*

---

## 1. Findings by component

### 1.1 Brushed PMDC motors (trolling-motor class, e.g. Storm N86)

Brush wear is governed by current density (~55–85 A/in² acceptable for
common grades), sliding speed, spring force, film condition, and — per
Maxon's service-life guidance — *start/stop and reversing duty*. No wear
mechanism in the brush literature keys on dP/dt. Commutation arcing occurs
at every bar transition, thousands of times per second, regardless of
whether the command is constant; *severe* arcing is associated with
overload, over-speed and reversal, not a 5 %/s ramp. Winding thermal time
constants are seconds-to-tens-of-seconds (coil) and minutes (bulk motor),
so a ±200 W swing over tens of seconds moves winding temperature a few
kelvin — thermally near-indistinguishable from constant operation at the
average power. Insulation life follows the Arrhenius 10-K rule
(IEEE/IEC 60085: life halves per ~10 °C above rated hot-spot): what
matters is the *average* temperature, which power-capping lowers. Bearings:
L10 life ∝ (C/P)³ — lower average load = longer life; a slow ramp adds no
shock loading.

- Plant Services, DC motor brush life: https://www.plantservices.com/home/article/11341634/dc-motor-brush-life-plant-services
- Maxon, brushed vs brushless life factors: https://www.maxongroup.com/en/knowledge-and-support/blog/brushed-vs-brushless-dc-motors-17012
- Portescap, DC motor thermal parameters: https://www.portescap.com/en/newsroom/blog/2021/07/motor-selection-tips-understanding-thermal-parameters-of-dc-motors
- IEEE brush/commutation studies: https://ieeexplore.ieee.org/document/10352229/ , https://ieeexplore.ieee.org/document/8088082/
- Insulation 10-K rule: https://industrialmonitordirect.com/blogs/knowledgebase/motor-insulation-life-the-10c-rule-for-longevity

**Risk:** none identified from slow forward-only modulation. **The levers
that do matter:** average current/temperature, reversals, stall events.

### 1.2 BLDC/PMSM motors

No brushes — the largest brushed wear item disappears. Failure statistics
(IEEE-IAS working group, 1141 motors; EPRI, 6312 motors) put bearings at
~40–70 % and stator insulation at ~25–36 % of failures; both age with
temperature and load magnitude (same Arrhenius/L10 laws as above). Magnets
add one constraint: standard NdFeB grades begin irreversible
demagnetization above ~80 °C and during extreme overcurrent — a
temperature/peak phenomenon, not a modulation-rate one. PWM dV/dt
insulation stress is set by the ESC's switching, identical whether the
duty command is constant or slowly varying. BLDC is strictly *less*
sensitive to power cycling than brushed.

- IEEE/EPRI failure shares: https://www.researchgate.net/figure/Percentage-component-of-induction-motor-failure-per-IEEE-and-EPRI_fig1_349715003
- Machine insulation thermal aging review: https://www.mdpi.com/1996-1073/18/3/576
- NdFeB temperature grades: https://e-magnetsuk.com/introduction-to-neodymium-magnets/grades-of-neodymium/

### 1.3 Motor controllers / ESCs (Kelly, Curtis, VESC class)

MOSFET losses (I²·R conduction + switching) depend on the *operating
point*, not on how recently it changed; a 6-second ramp between 800 W and
1100 W is just a move between two steady points. The genuine cycling
wear-out in power silicon is thermo-mechanical fatigue (bond-wire lift,
solder fatigue) driven by junction temperature swings ΔTj with
Coffin–Manson laws Nf ∝ ΔTj^(−4…−5): LESIT-class data gives ~9×10⁵ cycles
at ΔTj = 40 K but ~3×10⁴ at 80 K — and below ΔTj ≈ 20–30 K the models
*over-predict* damage relative to field experience (IET 2021). A 300 W
output change on a 1 kW ESC shifts dissipation by single-digit watts →
**ΔTj of a few kelvin**, orders of magnitude below any published wear-out
regime, and far below the start/stop cycles forklift and e-bike
controllers absorb daily for years.

Professional controllers *already ramp throttle by design* — evidence that
supervised ramping is the intended operating mode:

| Controller | Throttle ramp (full scale) | ≈ rate |
|---|---|---|
| VESC default, ADC throttle (firmware `appconf_default.h`, read directly) | 0.3 s up / 0.1 s down | 333 %/s |
| VESC default, PPM | 0.4 s / 0.2 s | 250 %/s |
| Curtis 1228, accel/decel adjustable range | 0.2 – 8.0 s | 12.5–500 %/s |
| Kelly KDS "accel time" / smooth-control params | present (units unpublished) | — |
| **SolarHelm** (current firmware defaults) | **50 s up / 20 s down** | **2 %/s / 5 %/s** |

SolarHelm's ramps are ~6× slower than even the *slowest* industrial
setting. Kelly KDS additionally provides its own current loop with
overcurrent protection, thermal cutback (~90 °C case → shutdown 100 °C),
low-voltage current cutback, and high-pedal-disable; VESC folds current
linearly from 85 °C to zero at 100 °C (FET and motor) and limits current
against a battery-voltage cutoff band.

- VESC firmware (primary): github.com/vedderb/bldc — `applications/appconf_default.h`, `motor/mcconf_default.h`
- Kelly KDS manual: https://media.kellycontroller.com/new/Kelly-KDSUserManualV2.9.pdf (proxy-blocked; content via search extracts) + ratings https://kellycontroller.com/shop/kds/
- Curtis 1228 manual: https://cdn.curtisinstruments.com/products/manuals/1228_manual_en.pdf (blocked; ranges via extracts)
- Infineon AN2019-05 (power/thermal cycling): https://www.infineon.com/dgdl/Infineon-AN2019-05_PC_and_TC_Diagrams-ApplicationNotes-v02_01-EN.pdf
- Danfoss IGBT power-cycle model: https://assets.danfoss.com/documents/latest/444233/AB501650017495en-000201.pdf
- Low-ΔTj power cycling: https://ietresearch.onlinelibrary.wiley.com/doi/full/10.1049/pel2.12083
- PV-inverter bond-wire fatigue under irradiance cycles (closest analog to solar-tracking duty): https://www.researchgate.net/publication/280112415

### 1.4 LiFePO4 batteries and BMS

**Frequent gentle changes are neutral-to-beneficial.** The dedicated
micro-cycling study (J. Energy Storage 2022) finds partial cycles < 2 %
DoD have a "negligible, or even positive" aging effect; an earlier
high-power-cell study found fade "substantially unaltered" over hundreds
of thousands of micro-cycles; the Stanford/SLAC *Nature Energy* 2024 paper
found minutes-scale dynamic load profiles **extended lifetime by up to
38 %** vs constant current at the same average (NMC cells — direction, not
magnitude, transfers to LFP). Current-gradient effects appear only around
1.8 C/s; SolarHelm's 5 %/s ramp is ~0.023 C/s, two orders of magnitude
below. Low-frequency current-ripple studies show ≤1–2 % effect at worst.
Rate-driven LFP damage mechanisms appear at ≥2–4 C; the reference build's
worst case is 0.47 C.

**The throughput argument is decisive:** LFP cycle aging integrates Wh
cycled and cycle depth. By holding net battery power near 0 W, SolarHelm
converts a continuous ~0.3–0.5 C discharge into near-zero throughput plus
benign shallow ripple — **SolarHelm's core behavior actively extends
battery life.** (Caveat: parking the pack at 100 % SOC in the sun all day
trades a little calendar life; a future "charge-to-90 %" policy is worth
considering.)

**BMS:** discharge MOSFETs in JBD/JK/Daly-class BMSs conduct continuously;
dissipation follows current magnitude, not setpoint-change frequency —
load-change cadence is thermally invisible. What stresses a BMS (and the
whole boat) is a **protection disconnect under load**: breaking tens of
amps into cable inductance produces load-dump spikes (a documented TI E2E
case: 50 V system → 80 V on disconnect at speed) and instant loss of
propulsion. The supervisor's whole battery job is to make BMS protection
unreachable: current cap below the BMS rating, staged voltage-sag backoff
above the BMS undervoltage trip, ramp down rather than off.

**Temperature is the real battery lever:** charging below 0 °C causes
irreversible lithium plating — and on a solar boat "charging" includes
solar surplus flowing into the pack, so the supervisor must gate charge
current on temperature. Cycle life roughly halves at sustained 45 °C vs
25 °C (EVE LF105: 4000 → 2000 cycles).

- Micro-cycles: https://www.sciencedirect.com/science/article/pii/S2352152X2201338X ; https://www.sciencedirect.com/science/article/abs/pii/S2352152X16300482
- Dynamic cycling extends lifetime: https://www.nature.com/articles/s41560-024-01675-8 (open: https://www.osti.gov/pages/biblio/2479252)
- Current gradients: https://www.sciencedirect.com/science/article/abs/pii/S2352152X21006757
- Current ripple: https://ieeexplore.ieee.org/document/6914791/ ; https://ieeexplore.ieee.org/document/8463540/
- C-rate aging (LFP 0.5–5 C): https://pubs.rsc.org/en/content/articlepdf/2018/ra/c8ra04074e
- EVE LF105 specs: https://www.evemall.eu/industry-news/revealing-the-eve-lf105-a-105ah-lifepo4-battery-solutions-secrets
- Sub-zero charging / plating: https://us.support.redarcelectronics.com/hc/en-us/articles/13856244101007
- Load-dump hazard: https://e2e.ti.com/support/power-management-group/power-management/f/power-management-forum/1285230 ; https://www.morganscloud.com/2022/04/25/why-lithium-battery-load-dumps-matter/

### 1.5 Propeller, shaft, gearbox, mounts, transom

Drivetrain damage comes from **shock/transient events** (rapid reversals,
jams, impacts, resonance) and from high-cycle fatigue at stress amplitudes
near the material's endurance limit (~10⁶–10⁷ cycles for shaft steels —
below that limit, cycles cause *no* damage regardless of count). A ≤5 %/s
always-forward power ramp on a ~1 kW motor changes shaft torque a few
percent per second — quasi-static by any mechanical definition (the
ISO 6336 application factor K_A ≈ 1.0 case). For calibration: gear teeth
already see a full load cycle per engagement every revolution; **waves
impose thrust/torque cycling at seconds-scale encounter frequency that is
both larger and faster than SolarHelm's ramps** (propeller emergence in
chop causes near-total torque loss and racing — and drivetrains are
designed for it); a human hand does 0→100 % in a second routinely. Modern
trolling motors (Minn Kota, Torqeedo Travel line) are direct drive — no
gearbox at all.

- Marine shaft fatigue: https://doi.org/10.3390/machines13050384 ; https://becht.com/becht-blog/entry/shaft-fatigue-failures-part-ii/
- Gearbox failure causes: https://www.stober.com/blog/what-causes-gearbox-failure/
- Waves vs propulsion loads: https://www.researchgate.net/publication/305309069 ; https://www.sciencedirect.com/science/article/abs/pii/S0029801820312671
- Torqeedo's move to direct drive: https://plugboats.com/torqeedos-new-direct-drive-3hp-and-11kg-25lbs/

### 1.6 Commercial precedent

Continuous automatic power adjustment is shipped, mainstream practice:
**Minn Kota i-Pilot "Cruise Control"** continuously and automatically
adjusts trolling-motor prop power in 0.1 mph increments against wind,
waves and current — exactly SolarHelm's actuation pattern with a speed
target instead of a power target, sold for a decade with no duty-cycle
caveats. Minn Kota markets continuous power modulation ("deliver only as
much power as you need") as a *feature* extending runtime; ePropulsion's
own manual prescribes supervisor-style power capping tied to battery
state. No manufacturer statement warning against frequent or automatic
throttle changes on electric outboards was found.

- https://minnkota.johnsonoutdoors.com/us/learn/technology/trolling-motors/i-pilot
- https://www.trollingmotors.net/blogs/selection/86962503-minn-kota-i-pilot-gps-overview
- ePropulsion Spirit 1.0 manual (via https://www.manualslib.com/manual/1508557/Epropulsion-Spirit-1-0-Series.html)

## 2. Answers to the specific questions

**1–2. Does frequent change affect lifespan / increase wear?** No
mechanism in the motor, ESC, battery, or mechanical literature keys on the
*count or frequency* of small changes. Winding temperature: ±few K
(thermal time constants filter it). Brush/commutator: wear follows current
magnitude and reversals, not dP/dt. Bearings: L10 follows load magnitude;
slow ramps add no shock. ESC/MOSFET: ΔTj of a few kelvin, below the ≥20 K
regime where cycling fatigue is measurable. Battery/BMS: micro-cycling is
benign-to-beneficial; the BMS doesn't switch on load changes. Mechanical:
quasi-static, below endurance-limit amplitudes, dwarfed by waves.

**3. Frequent small vs rare large changes?** Frequent-small strictly wins.
Fatigue laws are steeply superlinear in amplitude (Nf ∝ ΔT^−4…−5 for
power silicon, S³–S⁵ regimes for steel/gears): halving amplitude buys
~16× the cycles at β = 4. Rare large steps also mean deeper battery
excursions and larger sag. Rate-limit everything, then adjust as often as
the target moves.

**4. Ramp rates?** Industry ships 0.1–8 s full-scale. SolarHelm's
+2 %/s / −5 %/s (≈ +23 / −58 W/s at 1164 W) is ultra-conservative — keep
it. Envelope: 2–10 %/s up, down faster than up, plus an instant-to-zero
path reserved for safety stops (which the ESC handles gracefully).

**5. Current limits/margins?** Plan steady operation at ≤80 % of the
*smallest continuous rating in the chain* (motor, controller, wiring,
battery/BMS); at 80 % current the I²R heat is 64 %. Burst ratings
(Kelly's 100 A/1 min) are emergency reserve, never budget. For the BMS
specifically, cap commanded discharge at ≤70–80 % of its continuous
rating so its protection is unreachable.

**6. Control power, torque/current, RPM, or throttle %?** Command
**throttle %** through the controller's validated throttle interface, and
close SolarHelm's **outer loop on measured battery power** (shunt V×I) —
which is exactly what the implemented `BatteryPowerController` does. This
is self-calibrating against the controller's internal mapping (Kelly KDS
runs throttle→current "torque mode" per community documentation; others
map throttle→duty), robust to voltage sag, and needs no RPM sensor.
Never bypass the throttle input — it carries the controller's high-pedal
and fault validation. Keep the outer loop ≥10× slower than the
controller's inner loops (trivially true: ms vs s).

**7. Filter solar fluctuations rather than react immediately?** Yes —
that is the design. Cloud-edge flicker (1–30 s) should be *absorbed by the
battery* (benign micro-cycling, per §1.4) rather than chased by the motor.
Two paths: a **slow tracking path** (filtered battery power + deadband +
gentle ramps — the setpoint follows minutes-scale irradiance trends) and a
**fast protection path** (~1 s, unfiltered: voltage-sag backoff,
overcurrent cap, sensor staleness). Over-smoothing wastes energy acting on
stale data; the PV-smoothing literature and our simulations both land in
the same window (next question).

**8. Control-loop frequency?** 2–5 Hz for the tick (SolarHelm uses 4 Hz on
hardware, 2 Hz in long sims). Faster buys nothing — the plant is
seconds-scale; slower degrades the protection path's reaction time.

**9. Battery-power averaging period?** ~10 s effective smoothing on the
tracking input (first-order τ ≈ 5–15 s or equivalent moving average),
*not* applied to the protection path. SolarHelm's current τ = 2 s filter
plus the ±25 W deadband plus 2 %/s ramps already yields an effective
response of tens of seconds (the ramp limiter dominates); raising the
filter τ toward ~10 s is a recommended M2 tuning change that further
decouples the motor from cloud flicker at no cost.

**10. Thermal derating?** Don't duplicate the controller's — Kelly folds
back from ~90 °C case, VESC from 85 °C, protecting *themselves*. The
supervisor's strategy: (a) keep steady-state power ≤80 % of continuous so
cutback never engages; (b) with a motor/battery temp sensor: linear power
cutback over a configured band (mirroring the 85→100 °C pattern) starting
well below the hard limit; (c) without motor temp sensing (typical
trolling motor): the 80 % cap *is* the derating, plus back-off-and-hold
whenever commanded vs measured power diverge (the signature of the
controller limiting internally).

**11. Voltage sag / overcurrent?** Layered, supervisor-first:
supervisor (smooth, seconds) → controller cutback (fast) → BMS (last
resort, must never fire). Staged sag backoff for an 8S LFP pack: soft
power cap at ~3.05 V/cell under load (24.4 V), hard ramp-down at
~2.95 V/cell (23.6 V), graceful stop at ~2.90 V/cell (23.2 V), all with a
few seconds' debounce — comfortably above typical 2.5–2.8 V/cell BMS
trips and above the controller's low-voltage cutback. Backoff reduces
current, which lifts voltage: the loop is self-stabilizing.

**12. Brushed vs BLDC differences?** Brushed adds brush/commutator wear
(driven by current, speed, reversals — not modulation) and arcs on
reversal; BLDC adds magnet temperature limits and moves all commutation
into the ESC. For SolarHelm's question the difference is immaterial: both
are indifferent to slow forward-only modulation. Brushed motors are the
stronger reason to prohibit automatic reverse (plugging, §13).

**13. Automatic reverse?** **Prohibited, absolutely.** Reversing a
spinning PMDC ("plugging") adds back-EMF to supply voltage — roughly 2×
worst-case armature current, severe arcing, winding damage — and risks
driver overstress; Kelly requires throttle release before direction
change. V1 already clamps SolarHelm's output to [0, +max]; direction
remains a human-only, near-zero-throttle action, and any sensed direction
change must disengage auto mode.
(https://www.electricalvolt.com/plugging-or-reverse-current-braking-in-dc-motor-braking-torque-its-application/ ,
https://www.motioncontroltips.com/what-is-plugging-for-electric-motors/)

**14. Software vs controller responsibility split?**

| Layer | Owns |
|---|---|
| **ESC/controller** (µs–ms, vendor-certified) | hardware current loop, short-circuit/stall protection, gate drive/shoot-through/dead-time, its own thermal fold-back (+ motor's if a sensor is wired), low-voltage cutback, throttle validation incl. high-pedal-disable, sub-second smoothing |
| **BMS** (last resort only) | cell over/under-voltage, cell overtemperature, pack overcurrent disconnect — engineered to be *unreachable* in normal operation |
| **SolarHelm** (seconds, policy) | multi-second ramps toward the solar target, energy budget/SOC reserve, ≤80 % continuous caps, soft voltage floor above the controller's, sensor-staleness failsafes and its own watchdog, mode safety (explicit engage, human override wins, no auto-reverse, no auto-resume), detection of controller cutback → back off rather than fight |

Anti-pattern: re-implementing fast protection on the ESP32 (it cannot beat
a hardware current loop and will only oscillate against it) or defeating
vendor throttle validation.

## 3. The SolarHelm Motor Protection Envelope

Initial defaults for the reference build (24 V / 1164 W Storm-class motor,
Kelly KDS24100E-class controller, 8S 100 Ah LFP with 100 A BMS). **No
universal value fits every motor** — the table marks what is a universal
SolarHelm rule (U) versus what must be derived from the specific
motor/controller/battery datasheet (D).

| Parameter | Default (reference build) | U/D | Basis |
|---|---|---|---|
| `control_loop_hz` | 4 Hz (accept 2–5) | U | plant is seconds-scale; protection path needs ~1 s reaction |
| `battery_power_filter_seconds` | 10 s tracking path (τ); protection path unfiltered at loop rate | U | micro-cycling benign ⇒ let the battery absorb flicker; PV-smoothing practice |
| `power_deadband_w` | 25 W (rule: ≥2× measured power ripple, ~2 % of rated) | U(value D) | anti-hunting; freezing deadband implemented |
| `max_ramp_up_w_per_s` | 25 W/s (2 %/s of rated) | U(scale D) | 6× slower than slowest industrial ramp; W/s value scales with motor rating |
| `max_ramp_down_w_per_s` | 60 W/s (5 %/s) + unrestricted instant-zero for safety stops | U(scale D) | down faster than up, per universal controller practice |
| `auto_max_power_percent` | 80 % of the smallest continuous rating in the chain (here: motor 1164 W ⇒ ~930 W cap) | D | 80 % current = 64 % heat; burst ratings are reserve |
| `auto_max_current_percent` | ≤80 % of controller continuous (48 A of Kelly's 60 A) and ≤75 % of BMS continuous (75 A of 100 A) — binding limit: 48 A | D | make controller cutback and BMS trip unreachable |
| `motor_temp_derating` | no sensor: the 80 % power cap + back-off-and-hold on commanded/measured divergence (>15 % for >5 s). With sensor: linear cutback to zero across [T_start, T_stop] from the insulation class, e.g. 85→100 °C | D | controllers protect themselves, not the motor, unless a sensor is wired |
| `controller_temp_derating` | delegated to the controller (Kelly 90→100 °C); supervisor treats detected cutback as a signal to reduce target and hold | D | never fight the inner limiter |
| `battery_temp_derating` | charge (incl. solar surplus) blocked < 0 °C with 3 K release hysteresis; discharge derated below −10 °C and above 45 °C; stop at 60 °C; no sensor ⇒ cold-cautious policy in winter | D | lithium plating; 45 °C halves cycle life |
| `voltage_sag_limit` | soft cap (50 % power) at 3.05 V/cell under load (24.4 V); hard ramp-down at 2.95 V/cell (23.6 V); graceful stop 2.90 V/cell (23.2 V); 3–5 s debounce. Must sit above BMS trip and controller cutback | D | staged, self-stabilizing backoff; BMS disconnect under load is *the* event to prevent |
| `sensor_timeout` | battery 3 s ⇒ forced MANUAL, zero auto throttle (implemented); solar/GPS 5 s ⇒ flags only | U | shunt is the control input; already tested (`ShuntFailure`) |
| `startup_behavior` | boot MANUAL; auto requires explicit request + one healthy sensor tick; command always ramps from zero; never restore pre-reboot throttle; respect controller high-pedal-disable | U | implemented and tested |
| `reverse_behavior` | never commanded automatically; output clamped [0, +max]; any sensed direction change disengages auto; direction is a human action at near-zero throttle | U | plugging currents ≈2×, arcing, driver stress |

Already implemented in `lib/solarhelm` and simulation-tested: the loop
rate, deadband, ramps (as %/s — a W/s expression is a trivial M2 config
addition), battery sensor timeout, startup and reverse rules, and the
reserve-SOC floor. New obligations for Milestone 2 from this research:
the staged voltage-sag backoff, temperature gating (charge lockout
< 0 °C), the current cap expressed against controller/BMS ratings,
cutback detection (commanded vs measured divergence), and raising the
tracking filter toward τ ≈ 10 s.

## 4. Risks and uncertainties

**Real risks (none of them "frequent changes"):** BMS disconnect under
load (load-dump spike + propulsion loss) — engineered away by the layered
limits above; charging the pack below 0 °C; sustained operation at high
temperature (battery box in the sun, sustained near-rating currents);
automatic reversal (prohibited); a supervisory loop fast enough to fight
the controller's cutback (avoided by the ≥10× timescale separation and
back-off-on-divergence rule).

**Uncertainties:**
1. Many primary PDFs (Kelly/Curtis manuals, Infineon/Danfoss app notes,
   Torqeedo/ePropulsion manuals, journal full texts, EVE datasheet) were
   egress-blocked in the research sandbox; their figures were verified
   across multiple independent search extracts but should be re-checked
   against the documents before values are hard-coded. VESC numbers are
   exact (read from source).
2. Curtis factory *defaults* (vs adjustable ranges) unverified; Kelly
   KD/KDS "torque mode" mapping comes from a community translation of
   Kelly's config tool — verify against the owned unit.
3. The Nature Energy +38 % dynamic-cycling result is from NMC cells;
   direction transfers to LFP, magnitude is chemistry-specific.
4. ΔTj estimates for this class of ESC are engineering estimates from
   typical Rth, not measurements; sub-20 K lifetime models are themselves
   poorly validated (which errs in SolarHelm's favor).
5. Voltage/temperature thresholds above are engineering syntheses, not
   published standards — validate against the actual pack's measured sag
   and the actual BMS's configured trips during Milestone 3 bench work.
6. No controlled study isolates *slow modulation* brush wear; the
   conclusion rests on the absence of any dP/dt-keyed mechanism in the
   brush literature.

## 5. Conclusions for SolarHelm

1. **Frequent, small, rate-limited, forward-only power adjustments do not
   measurably wear any component in the chain.** Every aging law found is
   driven by averages, peaks, amplitudes, temperature, and reversals.
2. **Frequent-small beats rare-large** on every axis (superlinear fatigue
   laws, shallower battery excursions, smaller sag).
3. **SolarHelm's target-0 W behavior actively extends battery life** by
   minimizing throughput — the literature's gentlest LFP duty profile.
4. The genuine hazards are elsewhere: BMS disconnect under load, sub-zero
   charging, sustained heat, and reversal — all addressed by the envelope.
5. Commercial precedent is direct: Minn Kota ships GPS cruise control
   that does continuous automatic power adjustment on trolling motors.
6. Architecture confirmed: outer loop on measured battery power, actuated
   as throttle %, ≥10× slower than the controller, with all fast
   protection left to the ESC/BMS layers beneath.

## Final question, answered explicitly

**Is SolarHelm's idea of continuously adjusting motor power according to
available solar energy fundamentally safe for modern electric propulsion
systems, assuming proper ramping, current limiting, thermal protection,
and a commercial motor controller?**

**Yes.** Under those four assumptions — all of which are SolarHelm design
requirements, not afterthoughts — continuous solar-following power
adjustment is not merely safe but *gentler than normal manual operation*:
it produces slower ramps than every shipped controller default, smaller
thermal swings than a single human throttle push, near-zero battery
throughput instead of continuous discharge, quasi-static mechanical loads
dwarfed by ordinary waves, and it is the same actuation pattern Minn Kota
has sold on trolling motors for over a decade. The engineering effort
belongs exactly where this document's envelope puts it: layered limits
that keep the controller's and BMS's hard protections unreachable, thermal
and voltage policy, and the absolute prohibition of automatic reverse.
