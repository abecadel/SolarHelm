# Adaptive Energy Model Research

How SolarHelm learns an individual vessel — the digital energy model that
improves after 1, 10, and 100 voyages. Research date 2026-08-30. Formulas
reconstructed from training knowledge where primary PDFs were unreachable
are tagged *[RECALLED — verify]*. Companions:
[GLOBAL_ENVIRONMENT_PROVIDERS.md](GLOBAL_ENVIRONMENT_PROVIDERS.md),
[GLOBAL_ADAPTIVE_ROUTE_PLANNER_RESEARCH.md](GLOBAL_ADAPTIVE_ROUTE_PLANNER_RESEARCH.md).

**Architecture mandate (from the project brief, confirmed by the
literature): physics where physics is reliable + empirical calibration +
online residual learning. No single black-box network.** Grey-box studies
consistently find hybrid models need far less data, extrapolate better,
and stay debuggable — decisive at phone-scale data volumes.

## 1. The model decomposition

```
P_elec = ( P_calm(STW) + P_aero(V_app, θ_app) + P_wave(Hs, Tp, μ, STW) ) 
         + P_hotel + P_residual(features)
```

| Term | Physics reliability | Treatment |
|---|---|---|
| Calm-water P(STW) | *shape* reliable (monotone, convex, ~cubic, steepening toward hull speed Fr≈0.4); coefficients not | learned monotone curve (§2) |
| Aero ½ρ·CdA·V_app² | form reliable; CdA unknown ±50% | physics form, calibrated CdA (§3) |
| Added wave resistance | semi-empirical at best for <12 m craft | Hs²-scaled baseline + learned residual (§4) |
| Hotel | measurable | measured constant / slow EWMA |
| Drivetrain η | fairly stable | absorbed into P_calm (we learn *electrical* power vs STW — it's what the shunt measures and what the planner needs) |

The strongest prior art is **ISO 19030** (hull/propeller performance
monitoring): a speed–power *reference curve* + tracked *percentage power
deviation*, achieved through **heavy filtering rather than heavy
modeling** (its default method deliberately excludes added-wave
corrections and filters rough weather out), with reference/evaluation
periods bracketing maintenance events. SolarHelm adopts all three ideas
at small-boat scale. The sailboat analog (Expedition/Orca/PredictWind
polar refinement) teaches the same lesson: start from a physically
plausible prior, correct with filtered logged data.

## 2. Monotonic hull-curve learning (Q15)

**Recommendation: non-negative least squares (NNLS) on the basis
{v, v³} (optionally +v², v⁵).** Every non-negative combination is
monotone increasing and convex on v ≥ 0 by construction, extrapolates as
physics says it should, and fits in ~80 lines of dependency-free JS.
Cross-check with PAVA isotonic regression (~30 lines): if the two diverge
beyond a threshold in a well-sampled speed band, flag model inadequacy.
I-splines/SCAM-style shape-constrained splines are the later refinement
if a hull shows a pronounced resistance hump (no mature JS lib — hand-roll
only if needed). Never extrapolate an isotonic step function; outside the
observed speed range use the parametric basis, inflate σ sharply, and
flag OOD (§9).

## 3. Aero calibration and the solar canopy (Q16)

Model `P_aero = ½ρ_air·CdA_eff(θ)·V_app²·STW` with
`CdA_eff(θ) ≈ CdA_front·cos²θ + CdA_side·sin²θ`. Prior from ship wind-load
literature (Blendermann/Fujiwara families): bluff flat-fronted
superstructures — which a solar-canopy boat is — sit near **CX ≈ 0.8–1.0
on frontal area** *[RECALLED magnitude]*. Calibrate by regressing
calm-water residuals on apparent-wind features.

**Identifiability is the hard part**: wind and wind-sea are collinear at
sea. Mitigations in value order: (1) gate aero samples to low-Hs
conditions (dawn calms, sheltered water — common for this boat class);
(2) fit wind and wave terms jointly and accept wide CdA intervals until
the data diversifies; (3) prize segments where swell direction ≠ wind
direction; (4) **reciprocal-heading legs** under steady wind cancel
wave/current terms and isolate aero.

**Canopy findings:** no published CdA data exists for solar-canopy small
craft — genuinely open territory, *measure, don't assume*. Physics
reasoning to carry into design: a big flat roof is a low-aspect plate —
modest frontal drag but real **side force and gust lift**, producing
leeway → induced hull drag → and contamination of the current estimator
(§5): the models are coupled. The **design tension is real**: every m² of
PV ≈ +190–220 Wp but also + windage that grows with V² while harvest
doesn't. SolarHelm should expose learned CdA_front/CdA_side per
`VesselConfiguration` so builders see the windage cost of canopy changes
empirically.

## 4. Wave residual learning (Q17)

Features: Hs, Tp, relative wave heading μ, **encounter frequency
ω_e = ω − (ω²·U/g)·cos μ** (deep water, confirmed), wavelength/LWL
(λ = gTp²/2π; λ/LWL ≈ 1 is the small-boat resonance worst case), and —
best of all when an IMU exists — measured pitch/heave RMS (bypasses
forecast error entirely). Baseline:
`P_wave_base = k_w·ρ g Hs²·B·f(μ)·STW` — STAwave-1's *structure*
(R_aw ∝ ρgHs²B, head-sea taper) with k_w learned. Honest position:
STAwave-1/2 were regressed on large ships in the short-wave regime
(λ ≪ L); a 6–12 m boat in 0.5 m waves is in the *opposite* regime where
motion-induced resistance dominates — **physics contributes the Hs²
scaling, the heading taper, and the ω_e resonance feature; the residual
learner owns the magnitude.** Never a universal "0.5 m = +20 %" rule.

Real-world corroboration (docs/case-studies/HELIOS_11.md, O2): the
Helios 11 builder's field experience — daily range collapsing ~100 →
40–45 nm in rough water while a 25 kn headwind cost only a throttle
bump — matches this section's prediction that wave state, not wind
speed, is the first-order environmental variable for light hulls, and
that the λ/LWL ≈ 1 chop band is where an ultralight suffers most. His
"overgrown hull" efficiency drain is likewise field evidence for the
CUSUM fouling-drift detector (§7). One addition his story forces:
**learned state must branch on configuration revision** — Helios
changed PV, battery mass and appendages mid-voyage, and residuals from
different configurations must never be pooled (see HELIOS_11_LESSONS.md
L1; `config_revision` now lives in the boat profile).

## 5. Current estimation without an STW sensor (Q18, Q19)

Observability analysis: with SOG/COG (GPS), heading, and power only, the
unknowns (current vector, STW, leeway) are **unobservable on a single
steady leg**. With a trusted hull curve, invert STW ≈ f⁻¹(P) and get
`V_current = V_ground − STW·ĥ` — but every hull/aero/wave error aliases
into the current estimate, and the hull curve itself was learned from
current-corrupted data. Breaking the circularity:

- **Reciprocal / multi-heading legs** (the classic navigator's method):
  out-and-back at fixed power cancels hull bias to first order.
  SolarHelm should *prompt* for a 2-minute calibration leg.
- **EKF with the current as a slowly varying (Gauss-Markov, τ~hours)
  state** — the standard AUV technique; heading diversity is the
  excitation that separates current from hull bias. A boat that only
  ever runs one heading cannot tell them apart (hard limit — document).
- **Geographic priors**: per-cell tidal-phase-binned bias (§7).
- **Leeway model** `angle ≈ k_lee·V_app_side²/STW²` or wind side-force
  drift is attributed to current (canopy coupling, §3).

**Honest accuracy expectation (assessment, not citation): ±0.2–0.4 kn**
in benign conditions with a good hull curve + calibrated compass +
heading diversity; ±0.5 kn+ in weather. Useful for routing (0.5–2 kn
currents dominate a 4–6 kn boat) — not survey grade; always publish with
σ.

**Sensors worth adding:** a compass/IMU (~€20–100) is near-mandatory —
without heading, current/leeway/heading are fully entangled, and the IMU
doubles as the wave-motion feature source. An **STW sensor is the single
highest-value optional sensor**: paddlewheel (Airmar DST810 class,
~US$300–400 — fouls, weak at the low speeds solar boats cruise) or
ultrasonic (UST800 class, ~US$900 — no moving parts, mixed field
reports). Support it, don't require it.

## 6. Steady-state learning windows (do not learn from bad telemetry)

Scaled from ISO 19030 practice (10-min blocks, Chauvenet outlier
filtering, weather caps) to small-boat dynamics: **60–120 s blocks**,
accepted only when σ(P)/mean < 3–5 %, σ(SOG) < ~0.15 kn, |rate of turn| <
~2°/s, no throttle step within the block ± 10–20 s settling, first block
after any change discarded; excluded outright: acceleration, docking,
reverse, poor GPS, stale weather, sensor-fault flags. One aggregated row
(means + σ + count) per accepted block is what every learner consumes.
Spirit: **prefer discarding 80 % of data to polluting the model** — a
season still yields thousands of blocks.

## 7. Drift detection and geographic learning (Q12, Q13)

**Drift:** CUSUM (or Page–Hinkley — interchangeable) on per-block relative
residual `(P_meas − P_pred)/P_pred`, k ≈ 2–3 %, tuned for voyages-scale
detection; parallel EWMA (half-life 2–4 voyages) as the user-visible
"hull performance trend" — mirroring ISO 19030's percentage-deviation
indicator. ADWIN is rigorous but overkill for V1.

**Vessel drift vs environment-model error** — the identification logic:
a real vessel change is *persistent across conditions*; a model error is
*condition-correlated*. Stratify residual trackers by condition bins
(calm/windy, flat/wavy, speed bands, region cells): all bins up → vessel
(announce "≈9 % more power than baseline, persisted 5 voyages — hull?
prop? load?"); only wavy bins → wave model; only one region cell → local
environmental bias.

**Geographic learning:** **H3 via h3-js** (hexagons, k-ring smoothing,
built-in parent aggregation; S2 has no healthy JS story; geohash is the
acceptable dependency-free fallback). Learn at res 8 (~0.7 km²),
aggregate to res 6; per-cell record {current-bias vector *binned by tide
phase* in tidal waters, wind speed-up/shelter factor, residual stats,
n, recency}; shrinkage toward the parent cell
(`n/(n+n₀)` weighting, n₀ ≈ 10–20) gives multi-resolution generalization
— knowledge spreads spatially instead of memorizing routes. Learned local
values **never silently replace forecasts**: they are labeled corrections
with sample counts and confidence.

## 8. PV learning

Physics chain (pvlib is the readable oracle; reimplement ~5 functions in
JS, each <100 lines, pvlib as test oracle): sun position → clear-sky GHI →
transposition (near-trivial for a ~flat canopy — a genuine simplification
vs rooftops) → cell temperature (boats get superb wind+water cooling) →
P = P_stc·(POA/1000)·(1 + γ(T−25)), γ ≈ −0.4 %/K.

**The boat-specific twist: heading continuously changes panel azimuth**,
and self-shading (bimini posts, antennas, crew) is heading-dependent.
Learn `K = EWMA(actual/predicted)` **binned by clear-sky index ×
sun-relative heading × sun elevation**. The slow all-bins EWMA doubles as
the **soiling/degradation tracker** (marine salt film: 1–10 % losses in
the floating-PV literature) with the same §7 split logic: all bins down =
dirty panels; one heading bin down = a new shading object.

## 9. Uncertainty and out-of-distribution awareness

- **V1**: calibrated empirical quantiles (5/25/50/75/95 %) of relative
  prediction error from the prediction-vs-actual record, stratified by
  horizon and coarse condition — this *is* split conformal prediction in
  its simplest form (Angelopoulos & Bates). Display "Expected 42 %,
  likely 36–48 %, conservative 31 %" — never a bare point.
- **V1.5**: online/adaptive conformal (Gibbs–Candès; decaying-step-size
  variants) — ~10 lines of JS, keeps coverage under seasonal/fouling
  shift.
- **V2**: Monte Carlo route rollouts with leg-correlated residuals (a
  biased hull curve is biased all day — ρ > 0), feeding
  probability-of-reserve-violation.
- **OOD**: per-feature envelopes + per-bin sample counts ("<5 blocks ever
  in this condition"); UX **widens and explains, never blocks**: "I
  haven't seen this boat in 1.5 m waves — range is a guess (±40 %). I'll
  learn from today." OOD data is excluded from drift detection but
  *included* in learning — it's the most valuable data.

## 10. Online learning architecture (Q14)

**Batch refit at voyage end, with recency weighting — argued with
numbers.** A season ≈ 10⁴–10⁵ aggregated blocks × <20 features: NNLS/ridge
refits in milliseconds on a phone. RLS-with-forgetting adds real
instability risks (covariance blow-up during the low-excitation
constant-speed hours a cruise consists of) for no benefit at this scale.
Recency = exponential sample weights (half-life 10–20 voyages; shortened
after a confirmed vessel-change event). Robustness: Huber loss / MAD
clipping; sanity gates (refuse a refit that moves predicted power >20 %
at any observed speed without drift-detector confirmation); never learn
from OOD-flagged or sensor-implausible blocks. The one legitimate online
learner: a per-voyage 1–3-parameter bias term ("today the boat is 4 %
thirstier"), reset each voyage.

## 11. Configuration versioning

ISO 19030's reference/evaluation-period mechanism, mapped: every declared
hardware change (prop, canopy, battery, major load) starts a
`VesselConfiguration` **branch, not a reset** — the new branch inherits
the old model as a prior with inflated uncertainty, with per-component
carry/relearn tags (a prop swap doesn't change CdA; a canopy change
doesn't change the hull curve). The old branch stays queryable → "hull
cleaning saved you 11 %" is exactly ISO 19030's *maintenance effect*.
Reversible situations (passengers, dinghy) are model *features*
(load input), not branches. The drift detector auto-suggests declaring an
event when the "vessel, all bins" pattern fires undeclared.

## 12. Data retention

Three tiers, all first-class, schema- and model-versioned:
1. **Raw 1 Hz telemetry** (~20 ch): 288 KB/h columnar Float32 → ~173 MB
   per 100 voyages (30–80 MB compressed) — well inside PWA quotas. Keep
   raw for the last ~20 voyages, then downsample to 0.2 Hz; raw is what
   lets improved block detectors re-learn from history.
2. **Steady-block aggregates**: the learning dataset; tiny; keep forever.
3. **Prediction-vs-actual records** {issued, horizon, predicted ±
   interval, conditions, actual, model version}: the fuel for conformal
   calibration, drift detection, and honest reporting; keep forever.

Store: IndexedDB/OPFS, per-voyage per-channel Float32Array +
CompressionStream gzip. Export: CSV always; **Parquet via parquet-wasm as
export only** (viable ecosystem, ~1 MB wasm — not worth the hot path).

## Direct answers Q10–Q19

- **Q10 physics-derived globally:** vector nav math (V_ground = V_water +
  V_current; apparent wind), encounter frequency, aero-drag form,
  monotone/convex calm-water form with hull-speed asymptote, Hs² wave
  scaling + heading taper, solar geometry + PV chain + γ temperature
  effect, coulomb counting, tide harmonic synthesis.
- **Q11 learned per vessel:** hull-curve coefficients, CdA_front/side (+
  leeway k), wave-residual coefficients, hotel profile, PV correction
  bins + soiling EWMA, battery capacity/IR, residual quantiles — all per
  configuration branch.
- **Q12 learned per region:** H3-cell current bias (tide-phase-binned),
  wind speed-up/shelter, wave-exposure correction, PV horizon shading —
  boat-independent in principle, hence the natural candidate for opt-in
  community sharing.
- **Q13:** §7 — CUSUM + EWMA on stratified residuals; all-bins ⇒ vessel,
  condition-correlated ⇒ model.
- **Q14:** §10 — voyage-end batch refit with recency + robust loss;
  RLS only for the per-voyage scalar bias.
- **Q15:** §2 — NNLS on non-negative {v, v³} basis, PAVA cross-check.
- **Q16:** §3 — CX≈0.8 prior, calm-gated regression, reciprocal headings;
  canopy = measure-don't-assume.
- **Q17:** §4 — Hs²·B baseline + learned magnitude; ω_e and λ/LWL
  features; IMU motion RMS best of all.
- **Q18:** yes for serious installations — the highest-value optional
  sensor (DST810-class ~$350 fouling paddlewheel vs UST800-class ~$900
  ultrasonic); compass/IMU is near-mandatory and cheap.
- **Q19:** ±0.2–0.4 kn benign / ±0.5 kn+ rough, only with hull curve +
  heading + heading-diversity; single-heading legs: unobservable
  (assessment — validate against an STW-equipped boat before publishing).

## Verification TODOs

STAwave-1 exact coefficient and ISO 15016 limits (primary docs blocked);
ISO 19030-2 exact table thresholds (ours are re-derived anyway);
canopy CdA measurement campaign; the ±0.2–0.4 kn claim; H3 cell-area
table; parquet-wasm maturity audit.
