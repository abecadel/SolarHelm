# SolarHelm Light Powercat — reference concept (research envelope)

Status: **research ranges, not a design.** This document explores whether
an inexpensive, lightweight DIY solar powercat in the 7–10 m class can
achieve 5–7 km/h on roughly 500–1500 W, informed by the Helios 11 case
study (docs/case-studies/HELIOS_11.md) and by the order-of-magnitude
physics in `tools/helios_sanity.py` (run it to reproduce every number
here). Nothing structural is designed here; any real vessel must be
engineered properly.

## Why a powercat, why now

Helios 11 (docs/case-studies/HELIOS_11_LESSONS.md) demonstrates that the
decisive variable is not battery capacity but **hull efficiency**:
long waterline + very low displacement + modest power + big PV area.
It also demonstrates the two failure modes of taking that recipe to its
monohull extreme: an ultralight, not-especially-slender monohull

1. rolls badly (the builder ended up adding outriggers), and
2. suffers disproportionately in waves.

A catamaran attacks both: form stability comes from hull spacing rather
than beam or ballast, and each hull can be far more slender than any
monohull of the same total displacement. This is exactly the reasoning
behind the Helios builder's own next-generation ~16 m / ~54 cm-hull
powercat design — scaled down here to DIY size.

## Research envelope

| Parameter | Range | Notes |
|---|---|---|
| Length overall | 7–10 m | LWL close to LOA on a cat |
| Beam overall | 2.5–4 m | trailerable at 2.5 m; stability & roof at 4 m |
| Hull waterline beam | 0.4–0.6 m | the headline variable — see slenderness below |
| Construction | plywood/epoxy/glass or equivalent light composite | Helios-proven method class |
| Target displacement (all-up) | 700–1300 kg | crew + battery + PV included |
| System voltage | 48 V | Helios-proven; 48 V parts ecosystem |
| Motor | 3–6 kW | 6 kW only for headwind/wave reserve, not cruise |
| PV | 2.5–4+ kWp | rigid residential modules on a full-length roof |
| Battery | 5–15 kWh LFP | sized as a **buffer**, not a fuel tank (below) |

## Modeled performance (tools/helios_sanity.py §5–6)

Calm-water battery-side power, 8 m LWL, two 0.5 m hulls, load-dependent
propulsive efficiency and fixed losses included:

| All-up mass | 5 km/h | 6 km/h | 7 km/h |
|---|---|---|---|
| 700 kg | ~160 W (32 Wh/km) | ~245 W (41 Wh/km) | ~355 W (50 Wh/km) |
| 1000 kg | ~190 W (38 Wh/km) | ~290 W (48 Wh/km) | ~420 W (60 Wh/km) |
| 1300 kg | ~210 W (42 Wh/km) | ~330 W (55 Wh/km) | ~480 W (69 Wh/km) |

Even with a blanket ×2 "real-world" degradation (chop, fouling,
appendages, instrument error) the 5–7 km/h band stays **well under
1 kW** — the 500–1500 W target from the task brief is met with margin in
this model. Hull-to-hull interference is legitimately neglected here:
5–8 km/h on an 8 m waterline is Fn 0.16–0.25, and the Insel &
Molland-line literature puts wave interference as small for
separation-to-length ratios ≥ ~0.3 and negligible below Fn ~0.2 — so
hull spacing can be chosen for structure, deck and PV area, not
hydrodynamics (an exception noted below for the 2.5 m trailerable
variant). The honest caveat stands: these are ideal-physics bands with a
simple slenderness law that demonstrably **underestimated Helios's
near-hull-speed power by ~2×** (see `tools/helios_sanity.py` §8), and
**the learned vessel model must replace every number here after sea
trials.** That is precisely what the SolarHelm learning loop
(app/js/vessel_store.js) exists to do.

### Solar equilibrium speed (midday, 3.0 kWp, PR 0.75, 150 W hotel)

| All-up mass | ideal | ×1.5 margin | +10 kn wind, 0.5 m seas |
|---|---|---|---|
| 700 kg | ~14 km/h | ~12 km/h | ~10.5 km/h |
| 1000 kg | ~13 km/h | ~11 km/h | ~10 km/h |
| 1300 kg | ~12 km/h | ~10.5 km/h | ~9.5 km/h |

The striking implication: for a genuinely slender light cat, midday
solar equilibrium is **above** the comfortable cruise band — the boat is
energy-positive at 5–7 km/h whenever the sun is meaningfully out, and
speed becomes a choice about comfort and schedule, not survival.
(Treat the absolute numbers skeptically; treat the *ordering* — cat
comfortably energy-positive where a conventional hull is marginal — as
the robust conclusion.)

### Daily energy balance (June, 1000 kg, 6 km/h × 10 h)

```
solar ~10.1 kWh  −  propulsion ~2.9 kWh  −  hotel ~3.6 kWh  =  +3.6 kWh
```

≈60 km/day with the battery **gaining** charge — the
EnergyPositiveCruise regime. In SolarHelm terms this boat lives almost
permanently in SOLAR/SOLAR+ mode.

### Battery as buffer

With daily balance ≥ 0 the pack only has to bridge: night hotel
(~1.8 kWh), a cloudy cruising morning (~2–3 kWh), and a
maneuvering/headwind reserve (~2 kWh). **8–12 kWh usable is generous**;
Helios's expansion toward the ~22 kWh class reflects an 11 m boat with
higher hotel and cloudier passages, not a requirement of the concept.
This is the "battery is a buffer, not a fuel tank" lesson made concrete.

### Sensitivity (from the same script)

- **Wind**: modest. Even 25 kn on the nose costs a Helios-class hull
  only ~1.7–2 kW of *electrical* power at 5 kn because aero power scales
  with boat speed; the cat's smaller CdA (~2 m² with a low roof) costs
  less. Windage of the tall PV roof is the design variable to watch —
  the roof is architecture, not an accessory (mass, windage, CdA,
  center of pressure, shade, stability).
- **Waves**: the dominant threat, exactly as Helios experienced. Head
  seas of 0.7 m cost this class of boat more than a 25 kn headwind.
  Slender wave-piercing bows and the cat's higher pitch damping help,
  but the model must stay physics + learned residual — never a fixed
  multiplier (docs/ADAPTIVE_ENERGY_MODEL_RESEARCH.md).

## Hull-count-aware VesselProfile (software implication)

The boat profile schema must grow (versioned — see
docs/case-studies/HELIOS_11_LESSONS.md lesson 1):

```
hull_count            1 | 2 | 3
lwl_m                 per-hull waterline length
beam_waterline_m      per-hull waterline beam
hull_spacing_m        multihull centerline spacing
displacement_kg       total (per-hull derived)
bow_type              enum: conventional / wave-piercing / scow (coarse)
cda_front_m2          aero prior (learned thereafter)
pv_roof: {area_m2, mass_kg, rated_wp, height_m}
```

Slenderness L/∇^(1/3) and hull Froude number are then derived, not
entered. The planner already learns hull curves and residuals per
configuration; hull-count awareness is a profile/schema change, not a
control-loop change.

## Comparison that motivates the strategy (script §4)

| | 6.5 m / 1500 kg conventional | 8 m / 800 kg slender cat | 11 m / 1500 kg Helios-style |
|---|---|---|---|
| slenderness L/∇^(1/3) | 5.3 | 10.4 | 9.2 |
| 5 km/h | 222 W / 44 Wh/km | 170 W / 34 Wh/km | 181 W / 36 Wh/km |
| 6 km/h | 383 W / 64 Wh/km | 261 W / 43 Wh/km | 279 W / 46 Wh/km |
| 7 km/h | 617 W / 88 Wh/km | 376 W / 54 Wh/km | 404 W / 58 Wh/km |
| 8 km/h | 942 W / 118 Wh/km | 518 W / 65 Wh/km | 556 W / 70 Wh/km |
| PV roof potential | ~1.5–2 kWp | ~2.5–3.5 kWp | ~4–6 kWp |

The short heavy donor boat loses on **both** axes: it burns more per km
*and* carries less PV. The gap widens exactly in the 6–8 km/h band where
cruising becomes pleasant. **"Long and light beats short and heavy"** —
and the 8 m cat matches the 11 m mono's hydrodynamics at 73 m² less
boat, with form stability the mono lacks.

### Donor conversion vs purpose-built (strategy impact)

| | Cheap donor conversion | Purpose-built light cat |
|---|---|---|
| CAPEX | low entry (hull ~free) but batteries grow to cover inefficiency | more materials/labour, smaller battery + PV do more |
| Build time | weeks (installation) | months (amateur plywood/epoxy build) |
| Wh/km | 2–3× worse typical | the table above |
| PV area | limited by existing deck | designed-in full roof |
| Stability | inherited (usually fine) | by geometry (spacing), no ballast |
| Legal/insurance | existing hull ID helps | homebuilt rules vary by country — verify locally |
| Repairability | depends on donor | plywood/epoxy is the most amateur-repairable system there is |

Recommendation from this analysis: keep the donor-conversion path for
**Milestones 2–4** (it is the fastest way to real telemetry and proves
the controller), but treat the light powercat as the serious **platform
target** the learned models and the eventual SolarHelm Vessel Designer
(docs/ROADMAP.md) should aim at. The bench and control electronics carry
over unchanged — 48 V, SmartShunt, same firmware.

## Construction reality (from the Helios case research)

Plywood/epoxy/glass is the proven method class for exactly this boat
(sources and confidence tags: docs/case-studies/HELIOS_11.md):

- **Panel mass**: sheathed 9–12 mm okoume runs ~5.5–9 kg/m²; Helios
  back-calculates to a ~50–65% structure mass fraction, ~60–90 kg of
  structure per hull-metre for an ultralight build. An 8 m cat's
  700–1300 kg all-up envelope is consistent with that (structure
  ~450–700 kg, leaving battery ~100 kg, PV ~150 kg, motor, outfit,
  crew).
- **Cost class**: ~€5–12 per kg of finished structure at retail epoxy/
  ply prices; Helios completed the whole 11 m boat (drivetrain and PV
  included) for ~$20.7k in materials over ~200 solo build days. A
  simplified stitch-and-glue 8 m cat with developable panels sits well
  inside that: expect a low-five-figure materials bill and a
  1000–2000 h amateur build — months, not weeks, which is the honest
  price of the performance table above.
- **Repairability**: the same three materials build and repair the boat
  with hand tools — the most amateur-repairable system available.

### PV economics (why the roof is rigid residential glass)

| Class | €/Wp | kg/Wp | Marine reality |
|---|---|---|---|
| Residential glass 430–450 W | ~0.10 (wholesale) – 0.35 (retail) | ~0.047 | pick IEC 61701 (salt mist) certified datasheets; frame corrosion is the weak point, not the laminate |
| Glass-glass bifacial | similar | ~0.06 | +25% weight, best moisture robustness |
| Lightweight composite rigid (eArc class) | mid (unconfirmed) | ~0.02 | the option if roof weight aloft becomes limiting |
| Marine-branded rigid | 1.5–4 | ≥ residential | packaging premium, same cells |
| Premium flexible | 2.5–3.5 | ~0.02 | hot spots/delamination; 3–8 year honest life |

Helios itself went rigid → flexible → **back to rigid** and the builder
lists the flexible detour among his regrets. For a 3 kWp roof: ~7 modules
of 430 W, ~150 kg, well under €1k wholesale — the cheapest energy on the
boat by an order of magnitude. The 150+ kg aloft is why the roof must be
designed as structure (mass, windage, CdA, center of pressure) from day
one, and why the ~0.02 kg/Wp composite rigids stay on the menu.

## Open questions this envelope does not settle

1. How narrow before other problems dominate? Below ~0.45 m waterline
   beam, interior volume vanishes, point-loads (beaching, docking) get
   structurally expensive, and payload sensitivity grows — displacement
   per cm of immersion shrinks with waterplane area. The 0.4–0.6 m range
   needs a build study, not more hydrodynamics.
2. Bridge-deck height vs slamming in the wave band that hurt Helios.
3. Real hull-interference penalty at 2.5 m overall beam (spacing ratio
   ~0.28) — the trailerable variant may pay a measurable hump penalty.
4. Roof CdA and its stability contribution in beam gusts.

These belong to the future **SolarHelm Vessel Designer** study
(docs/ROADMAP.md) — same physics modules, offline search over
{length, slenderness, displacement, PV, battery, motor, speed}
maximizing daily autonomous distance under payload/comfort/stability/
cost/reserve constraints. Not implemented yet, by decision.
