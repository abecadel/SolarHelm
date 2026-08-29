# Case study: Helios 11 (Lukas Sjöman / True North Yachts)

An ~11 m self-built solar-electric monohull that cruised roughly
3,000 nautical miles from Finland to Ibiza on zero fuel in 2025–2026 —
the most useful real-world dataset available to SolarHelm. This document
records what is known, **who says so, when, and how much to trust it**.
Engineering conclusions live in HELIOS_11_LESSONS.md; the sanity
calculations referenced here are reproducible via
`tools/helios_sanity.py`.

Research date: 2026-08-29. Method constraint: the builder's primary
channels (truenortharchive.net, t.me/s/lukeseaman, YouTube video
content) were unreachable from the research sandbox; nearly everything
below reaches us as press coverage or search-snippet paraphrase of the
builder's own videos. **Confidence tags:**

- `VERIFIED` — consistent across multiple independent sources
- `REPORTED_BY_BUILDER` — the builder's own statement/telemetry, usually
  seen via secondary quotation
- `SECONDARY_SOURCE` — press aggregation of builder content
- `INFERRED` — our deduction
- `UNKNOWN` — could not be established

No number here should be hard-coded into SolarHelm for any other vessel.

## Specifications (baseline)

| Item | Value | Confidence | Source/date |
|---|---|---|---|
| Length | 11 m (~36 ft); "Helios for the sun, 11 for the meters" | VERIFIED | many outlets, 2025–2026 |
| Displacement | ~1.5 t finished; bare hull reportedly < 500 kg | SECONDARY_SOURCE | jalopnik 01/2026, dailygalaxy 08/2026 |
| Beam, draft | beam UNKNOWN; draft ~0.5 m (one source) | UNKNOWN / SECONDARY | — |
| Construction | okoumé marine plywood + biaxial glass + epoxy (wood pre-soaked in epoxy); bulkheads ~1 m; built solo in a shed, ~200 days, materials ~$20.7k | VERIFIED (duration, cost class) | multiple, 2025–2026 |
| Designer | the builder himself; no naval architect named | SECONDARY_SOURCE | pasionporelmar, barcheamotore 2026 |
| Motor | 6 kW electric outboard; one source names ePropulsion | power VERIFIED; brand SECONDARY (single source) | greenenergytimes 04/2026 |
| System voltage | 48 V | VERIFIED | multiple |
| Propeller | UNKNOWN | UNKNOWN | — |
| Auxiliary | small emergency sail; no combustion backup | SECONDARY_SOURCE | multiple |
| Builder identity | "Lukas Sjöman" everywhere except one outlet claiming "Juho Kivimäki"; unresolved | SECONDARY_SOURCE, conflict | greenenergytimes vs rest |

## Configuration timeline (the boat evolved — treat every observation as
belonging to a configuration)

PV figures found, **not reconciled by design** (public sources disagree):

| PV figure | Era/context | Confidence |
|---|---|---|
| 8 panels, "up to 3,000 W produced in peak sun" | Baltic liveaboard era (2025) | SECONDARY_SOURCE |
| "6,000 W of solar is exactly what this yacht needed" | design-phase sizing claim | REPORTED_BY_BUILDER |
| "~6 kW array" | voyage-era descriptions (2026) | SECONDARY_SOURCE |
| "6,200 W raw, 10 residential panels, ~2,000 W on an average day" | Aug 2026 coverage | SECONDARY_SOURCE |
| proposed 8,000 W upgrade (bigger motor + sauna) | forward-looking, 2026 | REPORTED_BY_BUILDER |

The task brief's suggested "4 kWp" and "5.5 kWp" stages did **not**
surface in any indexed source (8 residential panels ≈ 3.2–4.4 kWp is the
closest INFERRED match for an earlier stage). Panel type: rigid
residential modules as the core array (VERIFIED); the builder used some
flexible panels at one stage and reverted — "more expensive and less
durable than basic hard panels" (REPORTED_BY_BUILDER, "six regrets").

Battery timeline (inconsistent press accounting flagged):

| Stage | Figure | Confidence |
|---|---|---|
| Launch config | capacity not found | UNKNOWN |
| Mid-voyage upgrade (+$1,900) | +2 × 48 V 100 Ah (~9.6 kWh) → press says "22 kWh usable" / "24 kWh pack" | REPORTED_BY_BUILDER via press; arithmetic does not fully reconcile |
| Later upgrade | "30 kWh" with a back-to-back test video at 7.5 kn | REPORTED_BY_BUILDER |

Chemistry: 48 V 100 Ah drop-ins strongly suggest LiFePO4 (INFERRED).
Batteries placed below the waterline for stability
(REPORTED_BY_BUILDER). Stability hardware also evolved: none → ~70 kg
rock ballast (abandoned) → twin ~25 L outriggers (~June 2026).

**SolarHelm lesson embedded in this table's existence: a real
experimental boat changes under you. VesselConfiguration must be
versioned, and every telemetry record must bind to the configuration
that produced it** (our boat_profile.json carries `schema_version`; a
`config_revision` field joins it — see HELIOS_11_LESSONS.md lesson 1).

## Voyage timeline

- Build ~200 days in Finland; first voyage video 2025-11-03; first
  season on the Baltic (Finland → Åland → Sweden). SECONDARY_SOURCE.
- Departure south in late season 2025 ("curved bow built out of
  convenience to escape winter"): Sweden → Denmark → Lübeck → German
  waterways → French canals — found **frozen** (briefly ice-locked,
  winter 2025–26) → Mediterranean spring 2026 → Spain → **Ibiza by
  ~June 2026**. SECONDARY_SOURCE (route VERIFIED in outline).
- Total distance: reported variously as 3,000+ nm / 3,106 mi / 3,500 mi
  / ~5,500–5,700 km (unit and cutoff confusion); **zero fuel is
  consistent everywhere**. VERIFIED (fact of voyage), numbers
  SECONDARY.
- 2026 (after arrival): battery and stability upgrades, continued
  liveaboard; **next-generation 16 m solar powercat announced, build
  started in Sweden** ("bigger, heavier, faster"; press "40 kW battery"
  — almost certainly 40 kWh). SECONDARY_SOURCE.

## Performance observations (the validation dataset)

### O1 — Heavy headwind, Mediterranean (2026-04-03 video)

> 20–25 kn headwind, gusts to ~32 kn on the beam; **6–6.7 kn sustained
> at ~3,500–4,000 W**; solar input 1,200–1,500 W that day; ~16 nm in
> ~3 h for ~9.5 kWh. Pre-outrigger monohull.
> REPORTED_BY_BUILDER via press.

The task brief's "~2,700 W at ~5 kn" variant of this observation was
**not found in any indexed source** — treat as UNKNOWN pending the
actual video (it plausibly describes a lower-throttle moment of the same
test). Sanity check (`tools/helios_sanity.py` §2): an ordinary drag
model — ITTC friction + slenderness residuary + CdA 2.0–3.0 m² frontal
aero + 0.3 m chop — **brackets the documented band** (3,200–4,100 W at
6 kn into 25 kn; 3,500 W at 6.5 kn into 20 kn). No exotic physics
needed. The deep reason strong wind is survivable: aero **power** is
drag × boat speed, and boat speed is small even when drag is not.

### O2 — Waves hurt more than wind

The verbatim "8 kn of wind with waves beats 25 kn with small waves"
comparison was not found (UNKNOWN — likely inside the 2026-07-17 "Big
Waves" video or Telegram). What is documented and points the same way:

- daily range collapses from ~100 nm to ~40–45 nm in rough water +
  cloud (SECONDARY_SOURCE);
- the builder's #1 regret: flat underwater sections behave poorly and
  noisily in waves (REPORTED_BY_BUILDER);
- choppy water submerges the outriggers and slows the boat
  (REPORTED_BY_BUILDER).

Sanity check (§3): STAWAVE-1 head seas of 0.7 m cost this hull class
more electrical power (~+860 W at 5 kn) than an 8 kn headwind (~+330 W)
— and STAWAVE-1 is a known **underestimate** for very light hulls,
whose short-chop encounter band (T ≈ 3 s → λ ≈ 14 m ≈ LWL) sits at
pitch resonance. Physics and observation agree: **wave state, not wind
speed, is the first-order environmental variable** for light solar
boats.

### O3 — Long leg finishing at 65% battery

Best-documented version: **55 nm at ~6 kn arriving with 65% battery**
in "challenging but manageable" conditions, likely post-battery-upgrade
2026 (SECONDARY_SOURCE, boat-and-yacht.com). The brief's "48 nm,
~10 kn headwind, open Atlantic" version was not found; a true
open-Atlantic leg is geographically doubtful given the canal route
(INFERRED). Usable as a validation case only in the 55 nm form, with
configuration uncertainty noted.

### O4 — Solar-only / battery-neutral points

- ~4–4.5 kn battery-neutral on ~2,000 W average-day solar
  (REPORTED_BY_BUILDER) — this is a live **SolarEquilibriumSpeed**
  measurement, precisely what SolarHelm's SOLAR mode holds by
  construction.
- ~6.5 kn on panels alone at 0% battery in peak sun
  (REPORTED_BY_BUILDER; best-case).
- Cruise 6–7 kn in daylight; observed peak ~8.5 kn.

### O5 — The 7.5 kn test: the EnergyKnee, live

> ~6,000 W at 7.5 kn (both before and after the 30 kWh upgrade; what
> changed was solar input, 1,000 → 3,500 W, and hence net drain).
> REPORTED_BY_BUILDER.

Our model (§8) predicts only ~2,900 W at 7.5 kn for a heavier Helios —
a **~2× under-prediction that we document rather than tune away**: the
builder's own regrets (flat sections, compromised bow) say this hull
pays more than a clean slender form near hull speed, and the gap is
exactly the per-boat dP/dV knee SolarHelm must **learn from telemetry,
not derive from priors**. Between the documented anchors
(~2,000 W → 4–4.5 kn; ~6,000 W → 7.5 kn) the marginal cost of the last
three knots is brutal — the strongest possible argument that **speed is
the energy-control variable**.

### O6 — Daily energy envelope (Finland → Ibiza)

~100 nm typical day / ~150 nm best (sail-assisted) / ~40–45 nm worst;
~15 kWh harvested on a good day. SECONDARY_SOURCE. Note what this is:
**day-level energy accounting**, not battery range — the pack (≤ ~30
kWh) could never move the boat 100 nm alone. The battery is a buffer;
the sun is the fuel.

### O7 — Stability arc

Rolls ~40–50% more than a comparable sailboat at anchor; up to ~45°
swings at anchor in >30 kn. Mitigations tried: ~70 kg rock ballast
("worked only to a point", abandoned — dead mass fights the whole
concept); 200–500 W reverse thrust at anchor (~70% less swinging — an
energy-for-comfort trade SolarHelm could automate); twin ~25 L
outriggers (~50% improvement, kept; submerge and slow the boat in
chop; foam-fill planned). REPORTED_BY_BUILDER via press.

## Failures and problems (CAUSE / OBSERVATION / FIX)

1. **Flat underwater sections** — build-simplicity geometry → poor,
   noisy wave behavior; regret #1 → unfixable on this hull; next design.
2. **Curved bow chosen to escape winter** — schedule pressure → reduced
   effective waterline and wave-piercing → next design.
3. **Rolling** — light hull + roof mass, no form stability → the O7 arc.
4. **Outrigger drag in chop** — 25 L is too little buoyancy → foam-fill
   planned.
5. **Waves + clouds crush range** — 100 → 40 nm/day → weather timing and
   slower battery-neutral speeds (exactly the planner's job).
6. **Flexible panels** — cost more, lasted worse → rigid residential.
7. **Cabin entry 150 cm** — habitability regret (hinged panels would
   have fixed it).
8. **Dead-length swim platform** — windage/length without waterline.
9. **Monohull choice** — "double the work" avoided during the build,
   regretted after; the successor is a catamaran.
10. **Hull fouling** — months of cruising sapped efficiency; cleaning
    planned — a drift signature SolarHelm's CUSUM detector is built to
    catch (app/js/vessel_model.js).
11. **"Always have backups"** — stated after ~1,553 nm; Helios carries
    only an emergency sail and anchor; next boat gets real redundancy.
12. **No battery/motor/electrical failures surfaced** in any snippet —
    absence of evidence only (primary channels unreachable). UNKNOWN.

## What Helios did NOT publish (telemetry SolarHelm must collect)

Systematically absent from all coverage, and exactly what the learning
loop needs: calm-water power-vs-speed curves per configuration;
positions bound to power samples (geographic residuals); wave
height/period alongside consumption; per-day PV harvest vs plane-of-
array conditions; SOC accounting that reconciles; configuration
revision stamped on every number. Our telemetry record + versioned
profile is designed to be the dataset Helios's story makes you wish
existed.

## Source register

Builder-primary (unreachable from sandbox; titles/dates via search):
True North Yachts YouTube (@Lukas-TrueNorthYachts) incl. videos
quKFaPMhoAQ (25 kn test, 2026-04-03), AbqxSZpbkv8 (+22 kn),
YessPb4lFcQ (Big Waves, 2026-07-17), rbCS5bFNLgQ (30 kWh test),
m3BwnptL4Tg, AO6ht2dsmno; truenortharchive.net; t.me/s/lukeseaman;
instagram.com/lukas.seaman.

Secondary press (all read as search snippets, 2025-11 → 2026-08):
supercarblondie.com (≈18 articles), jalopnik.com, slashgear.com,
luxurylaunches.com, greenenergytimes.org, greenmatters.com,
dailygalaxy.com, modernetdigital.cat, barcheamotore.com,
pasionporelmar.com, greenmemag.com, bijliwaligaadi.com, autonocion.com,
boat-and-yacht.com (55 nm/65% leg), en.clickpetroleoegas.com.br
(8-panel Baltic era), featured.inquisitr.com (frozen canals), now.solar,
webpronews.com, X posts (outrigger timing, 3,000 nm milestone).

## Open gaps

Beam/draft/propeller; launch-config battery kWh; exact leg dates and
positions; the 2,700 W/5 kn and 8-kn-wind-with-waves verbatims; battery
arithmetic reconciliation (22/24/30 kWh); builder's legal name; hull
design lineage; powercat specs beyond 16 m/"40 kW"/build-started. The
builder's archive site and Telegram are the likely closers — revisit
from an unrestricted network.
