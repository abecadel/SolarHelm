# Helios 11 — engineering lessons for SolarHelm

Companion to HELIOS_11.md (facts + sources + confidence) — this file
turns the case study into SolarHelm requirements. Format per lesson:
**OBSERVATION → PHYSICAL EXPLANATION → EVIDENCE QUALITY → SOLARHELM
IMPLICATION → MODEL/TELEMETRY CHANGE REQUIRED.** Sanity numbers:
`tools/helios_sanity.py`.

---

## L1 — Real boats mutate: configuration must be versioned

**Observation.** Helios's PV (8 panels → 10; press: 3/6/6.2 kWp),
battery (? → "22 usable"/"24" → "30 kWh"), and hull appendages
(none → ballast → outriggers) all changed mid-voyage; press numbers for
the *same* boat disagree because they describe different moments.
**Physics.** None — this is epistemology: an observation without its
configuration is unusable for learning.
**Evidence.** VERIFIED (the disagreement itself is the evidence).
**Implication.** Every telemetry record and every learned parameter must
bind to a configuration revision, or the residual learner will blend
different boats into one wrong model.
**Change.** Add `config_revision` (monotonic integer + free-text change
note) to `config/boat_profile.json` and to the telemetry record;
`vessel_store.js` must reset/branch CUSUM and quantiles on revision
change (drift after a battery+200 kg refit is a new boat, not fouling).

## L2 — Efficiency comes from the hull, not the battery

**Observation.** ~1.5 t on an 11 m waterline cruises 6–7 kn on a 6 kW
motor and crossed Europe on sunshine; the pack (≤ ~30 kWh) could never
have done it as "fuel".
**Physics.** Residuary resistance falls steeply with slenderness
L/∇^(1/3) (Helios ≈ 9.2 vs ~5.3 for a conventional 6.5 m/1.5 t hull);
at 5–7 km/h friction dominates and wetted surface per tonne is what you
pay. Long + light beats short + heavy on *both* Wh/km and PV area.
**Evidence.** VERIFIED (performance class) + model §4.
**Implication.** SolarHelm must model displacement, waterline length
and slenderness — length alone is meaningless; and the buying-guide
donor-boat strategy must weigh hull quality above battery size.
**Change.** Extend the vessel profile with `displacement_kg`, `lwl_m`,
`beam_waterline_m`, `hull_count`, `hull_spacing_m`, `bow_type`;
derive slenderness and Froude number in the model layer
(docs/reference-vessels/SOLARHELM_LIGHT_POWERCAT.md carries the
schema).

## L3 — Strong wind alone is survivable; the aero model validates

**Observation.** Documented: 6–6.7 kn at 3,500–4,000 W into 20–25 kn
wind, small waves (the brief's "2,700 W at 5 kn" variant: unverified).
**Physics.** Aero penalty is drag × **boat** speed. Apparent wind ~16
m/s on CdA 2–3 m² is ~400–600 N of drag but only ~1.3–2 kW of towing
power at 3.3 m/s. Model §2 brackets the documented band with CdA
2.0–3.0 — an ordinary, physical CdA.
**Evidence.** REPORTED_BY_BUILDER via press; model agreement good.
**Implication.** Our physics-first aero model (`aeroExtraW`, CdA prior
1.2 m² for a small launch — Helios-class boats need 2–3) is the right
architecture; wind needs no empirical fudge, only a learned effective
CdA per boat and heading.
**Change.** Make `cda_front_m2` a profile field (prior) + learned
parameter; validate against this observation as a regression case; add
crosswind CdA growth as a learn-later term.

## L4 — Waves are the first-order threat; multipliers are banned

**Observation.** Range collapses ~100 → 40–45 nm/day in rough water;
flat sections are regret #1; the (unverified verbatim, well-supported
direction) claim that ~8 kn wind WITH waves beats ~25 kn wind with
small waves.
**Physics.** Wave-added resistance scales ~Hs² and, for a 1.5 t boat,
short chop (T ≈ 3 s → λ ≈ 14 m ≈ LWL) sits at pitch resonance with
almost no inertia to carry through. Model §3: 0.7 m head seas ≈ +860 W
at 5 kn vs +330 W for 8 kn wind — and STAWAVE-1 *underestimates* light
hulls.
**Evidence.** Direction VERIFIED-adjacent; magnitudes model-only.
**Implication.** Confirms the architecture decision already in
docs/ADAPTIVE_ENERGY_MODEL_RESEARCH.md: waves get physics-informed
features + a strong learned residual; `wind → multiplier` and
`Hs → multiplier` are both unacceptable.
**Change.** Route-planner features per segment: relative wave angle,
head/beam/following components, λ/LWL, encounter frequency from
(Tp, STW, heading). `waveExtraW`'s kWave placeholder must become a
learned, heading-aware term; interaction terms (waves×speed,
waves×heading, waves×hull) go to the residual learner, never assumed
independent.

## L5 — The EnergyKnee is real, boat-specific, and must be learned

**Observation.** ~2,000 W holds 4–4.5 kn; ~6,000 W buys 7.5 kn. The
last 3 knots cost triple the power.
**Physics.** Displacement hulls approach a wave-making wall near
Fn ≈ 0.35–0.40; where it bites depends on hull details our parametric
model provably misses (model §8 under-predicts Helios's 7.5 kn power by
~2× — documented, not tuned away; the builder's flat sections and
compromised bow are the likely cause).
**Evidence.** REPORTED_BY_BUILDER anchors; model disagreement honest.
**Implication.** Speed is the energy-control variable; SolarHelm should
continuously present Wh/km and km/day across candidate speeds and mark
where dP/dV steepens ("recommended cruise band") — from telemetry, not
theory. This is what the NNLS hull curve already learns; the knee is a
derived UI quantity.
**Change.** Add an EnergyKnee computation (max of d²P/dV², or where
marginal Wh/km exceeds the minimum by X%) over the learned curve;
surface it in the PWA speed table; feed the planner's power ladder with
speeds below the knee by default.

## L6 — SOLAR mode = SolarEquilibriumSpeed; SOLAR+ = SolarSurplusCruise

**Observation.** The builder hand-flies "battery-neutral ~4–4.5 kn on
an average day" and "6.5 kn on panels alone in peak sun" — he is
manually doing what SolarHelm automates.
**Physics.** Solve P_PV(t) = P_prop(v, env) + P_hotel for v; it moves
with the sun, minute by minute.
**Evidence.** REPORTED_BY_BUILDER.
**Implication.** Our existing modes are exactly this: SOLAR (battery
power target 0 W) *is* the equilibrium seeker — it finds the speed
without needing the equation solved; SOLAR+ (negative battery-power
target, e.g. −500 W) *is* SolarSurplusCruise with a guaranteed charge
floor. Helios is field evidence the operating regime matters enough
that a human does it by throttle all day. Naming: keep
**EnergyPositiveCruise** for the regime (P_PV > P_prop + P_hotel), and
expose **SolarEquilibriumSpeed** as the *predicted* v from the learned
model (UI: "sustainable STW now: X km/h") next to the *actual*
equilibrium the controller holds.
**Change.** PWA: compute and display SolarEquilibriumSpeed from live
PV estimate + learned hull curve + current env features; firmware:
none (modes already implemented and tested).

## L7 — The battery is a buffer; plan the day, not the pack

**Observation.** ~100 nm typical days on ≤ ~30 kWh of battery: daily
solar (~15 kWh) plus buffered morning/evening/cloud energy does the
work. Battery upgrades changed *comfort and margin*, not the mission.
**Physics.** Daily balance = E_solar − E_prop − E_hotel; range-style
kWh/kW thinking answers the wrong question for a solar cruiser.
**Evidence.** SECONDARY_SOURCE, internally consistent.
**Implication.** Voyage planning must present day-level accounting —
which our route DP already produces (SOC timeline, arrival SOC,
emergent solar stops); the missing piece is the explicit per-day
energy ledger in the UI.
**Change.** PWA voyage summary: add per-day rows {distance, E_solar,
E_prop, E_hotel, net, SOC start/end} derived from the DP plan (the
data already exists in the plan steps); powercat doc records
buffer-sizing method (night hotel + cloudy morning + reserve).

## L8 — Wh/km-only optimization builds a bad boat (stability lesson)

**Observation.** The efficiency-optimal ultralight rolled 40–50% worse
than a sailboat, swung 45° at anchor, cost ~70 kg of failed ballast, a
constant anchor-thrust energy tax, and finally outriggers — and the
rolling even cut PV yield.
**Physics.** Light displacement + roof mass = low roll inertia and
high CG; form stability must come from beam or hull spacing; dead
ballast fights the efficiency premise. Note the coupling: comfort
failures feed back into energy (panel angle churn, 200–500 W anchor
thrust).
**Evidence.** REPORTED_BY_BUILDER (rich arc).
**Implication.** The future Vessel Designer must optimize daily
autonomous distance **subject to** stability/comfort/payload/cost
constraints, never Wh/km alone. For control: "spend watts for comfort"
(anchor thrust) is a legitimate, user-authorized power sink SolarHelm
should meter rather than fight.
**Change.** ROADMAP: SolarHelm Vessel Designer concept (multi-objective,
reuses planner physics — not implemented yet, by decision). Telemetry:
log roll/pitch once the IMU lands (Wave 1 bench list already includes
one) — wave-state features AND stability evidence from the same sensor.

## L9 — Multihulls are the structural answer to L2+L8 together

**Observation.** After the monohull, the builder's next boat is a 16 m
powercat (build started); brief-supplied hull width ~54 cm
(unconfirmed publicly).
**Physics.** Two slender hulls give slenderness ~10+ per hull with form
stability from spacing; at 5–8 km/h (Fn 0.11–0.25) hull-interference
literature (Insel & Molland line) says spacing can serve structure and
PV, not hydrodynamics (small for s/L ≥ 0.3, negligible below
Fn ≈ 0.2).
**Evidence.** SECONDARY_SOURCE + literature synthesis.
**Implication.** SolarHelm becomes hull-count aware
(MONOHULL/CATAMARAN/TRIMARAN) — a profile/schema matter, not a
control-loop change. The DIY powercat replaces "buy any donor" as the
platform target (docs/reference-vessels/SOLARHELM_LIGHT_POWERCAT.md).
**Change.** Profile schema fields per L2; simulator gains a cat
reference profile; hull model treats per-hull displacement.

## L10 — Fouling and degradation are detectable drift

**Observation.** "Overgrown hull" listed among efficiency drains by
mid-2026; cleaning planned.
**Physics.** Fouling raises Cf smoothly over weeks — a one-sided,
condition-independent shift of measured-vs-predicted power.
**Evidence.** SECONDARY_SOURCE (low detail).
**Implication.** Long-term prediction-vs-actual monitoring detects
fouling/prop damage *during* a voyage — Helios shows the effect is
large enough to notice by eye, so CUSUM will see it far earlier. This
is question 18 answered affirmatively by field evidence.
**Change.** Already implemented (CusumDrift, vessel-vs-model
stratification in the research doc); add the L1 configuration-branch
rule so refits don't masquerade as fouling.

## L11 — Cheap rigid PV wins; panels are architecture

**Observation.** Rigid residential panels power the boat; the flexible
detour cost more and died sooner; ~10 × ~21 kg lives on the roof and
moves the CG, windage and shade picture.
**Physics/market.** €0.10–0.35/Wp and 25-year warranties vs €2.5–3.5/Wp
and 3–8 honest years; glass sheds heat, polymer laminates don't.
**Evidence.** REPORTED_BY_BUILDER + market research (case study Topic 3).
**Implication.** Buying guide stays on rigid residential modules (IEC
61701 datasheet check); vessel modeling must treat the PV roof as
structure: mass, windage/CdA contribution, height, shade.
**Change.** Profile: `pv_roof {area_m2, mass_kg, rated_wp, height_m}`;
BUYING_GUIDE note on IEC 61701; powercat doc carries the economics.

## L12 — Safety envelope outranks the optimizer

**Observation.** 32 kn beam gusts forced the builder to cut the motor;
"always have backups" is his stated lesson; slow-for-energy or
wait-for-solar can be exactly wrong when weather is deteriorating.
**Evidence.** REPORTED_BY_BUILDER.
**Implication.** Energy optimization operates inside a
NavigationSafetyEnvelope: minimum-steerage speed in waves/current,
weather-window hard gates, skipper authority absolute. Our stack
already encodes the skeleton (MANUAL-default relay, skipper-explicit
mode entry, SAFE/POSSIBLE gates, reserve floors); the planner side
gains explicit minimum-speed and deteriorating-weather gates.
**Change.** voyage_safety.js: document (and later implement) a
min-steerage-speed gate fed by wave/current state; SAFETY.md already
states SolarHelm is not a certified navigation system — repeat it in
the planner UI footer.

---

## The 18 questions, answered

1. **Why useful speed on a few kW?** Slenderness ~9 and 1.5 t on 11 m:
   at 5–7 kn the boat is friction-dominated; ~130 N of drag at 5 kn is
   ~800 W electric (§1). Power buys speed until the knee, and the knee
   sits usefully high on a long hull.
2. **Waterline vs displacement?** Coupled through L/∇^(1/3) — neither
   alone explains it. 11 m at 4 t or 6.5 m at 1.5 t both lose the
   slenderness (and the knee moves down); the comparison table (§4)
   quantifies it.
3. **25 kn headwind explainable?** Yes — CdA 2.0–3.0 m² brackets the
   documented 3.5–4 kW at 6–6.7 kn (§2). L3.
4. **Why waves ≫ wind?** Hs² scaling + pitch resonance at λ ≈ LWL +
   almost no displacement inertia; wind power is throttled by low boat
   speed while wave drag is not (§3). L4.
5. **Would a slender cat help materially?** Yes on all three axes:
   slenderness per hull, form stability without ballast/outriggers, and
   more PV area; interference negligible at these Froude numbers. L9.
6. **How narrow before other problems dominate?** Below ~0.45 m
   waterline beam: payload sensitivity, point-load structure, interior
   volume, and beaching robustness dominate — a build study, not
   hydrodynamics (powercat doc, open question 1).
7. **Energy sweet spot for a 7–10 m light cat?** Modeled ~5–7 km/h at
   160–480 W depending on mass — comfortably inside the knee; the
   ×2-margined band still clears the 500–1500 W target.
8. **Sub-1 kW at 5–6 km/h plausibly?** Yes, with roughly 2× margin in
   the model even at 1300 kg (powercat doc table).
9. **PV area for midday energy-positive?** ~3 kWp (≈7 residential
   modules, ~15 m² roof) yields midday equilibrium far above cruise
   speed; even ~1.5 kWp clears 5–6 km/h cruise + hotel at noon.
10. **Battery size as buffer?** 8–12 kWh usable (night hotel + cloudy
    morning + reserve); Helios's 22–30 kWh reflects an 11 m liveaboard,
    not the concept's floor. L7.
11. **Observations usable as validation cases?** O1 (headwind band),
    O4 (equilibrium speeds), O5 (6 kW @ 7.5 kn knee anchor), O6 (daily
    envelope), O7 (stability arc, qualitatively).
12. **Too poorly documented?** The 2,700 W/5 kn variant, the 8-kn-wind
    verbatim, the "48 nm Atlantic" leg (use the 55 nm form), launch
    battery size, all exact leg dates, anything requiring beam/draft.
13. **Telemetry SolarHelm must collect that Helios didn't publish?**
    Configuration-stamped power-speed curves, positioned samples, wave
    height/period alongside consumption, reconciled SOC ledgers,
    per-day PV vs conditions (case study, "What Helios did NOT
    publish").
14. **How would SolarHelm have helped on Finland→Ibiza?** Holding
    battery-neutral automatically (no throttle-hand vigilance), day-
    level departure/route energy planning through cloudy weeks,
    quantified wave-vs-wind routing, drift alarms for fouling, and a
    growing per-boat model instead of intuition.
15. **Learn waves-worse-than-wind in real time?** Yes — steady-block
    residuals stratified by wave features vs wind features separate the
    two within days of mixed-condition logging (the interaction terms
    are exactly what the residual learner fits).
16. **Auto-learn the optimal cruise-power region?** Yes — the NNLS
    curve + EnergyKnee (L5) needs only the power ladder the sea-trial
    protocol already prescribes.
17. **Predict best departure times?** Yes — implemented: the route DP's
    departure sweep over sun/wind/wave/current forecasts is precisely
    this (app/js/route_planner.js).
18. **Detect fouling/prop degradation en route?** Yes — CUSUM on
    condition-stratified residuals; Helios's own "overgrown hull"
    episode is the field proof the signal is large. L10.

## Core lesson

Solar cruising is an **energy-flow and vessel-efficiency problem**, not
a battery-capacity problem. The governing ledger is
`daily solar + battery buffer − propulsion − hotel`, with propulsion
set by hull, speed, waves, wind, current, loading. SolarHelm's job is
to hold the operating point where sun, boat, battery, environment and
destination balance — and to make every real voyage improve the next
prediction. Helios 11 is the existence proof that the regime works and
the cautionary tale for every simplification we might have been tempted
to keep.
