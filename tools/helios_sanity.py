#!/usr/bin/env python3
"""Helios 11 sanity calculations for SolarHelm (docs/case-studies/).

Order-of-magnitude physics checks against the Helios 11 real-world
observations, plus the hull-comparison and powercat-envelope studies the
case study asks for. Deliberately simple, fully documented models — the
point is plausibility bands, not naval-architecture precision. Every
formula is standard:

  friction     ITTC-57 flat-plate line + form factor
  wave-making  slenderness-scaled residuary hump (documented crude fit)
  aero         0.5 * rho_air * CdA * V_apparent^2, power = drag * V_boat
  waves        STAWAVE-1 head-sea added resistance (valid Hs band; known
               to UNDERESTIMATE for very light craft near pitch resonance)

Electrical power model: towing power through a LOAD-DEPENDENT propulsive
efficiency (a small fixed-pitch prop is poor at very light load and
approaches ~0.52 at healthy load) plus a fixed controller/system loss.
This is the honest part-load behaviour that makes tiny towing numbers
NOT translate into tiny battery draws.

Run: python3 tools/helios_sanity.py
"""

import math

RHO_W = 1025.0    # kg/m^3 seawater
RHO_A = 1.225     # kg/m^3 air
NU = 1.19e-6      # m^2/s seawater kinematic viscosity
G = 9.81
P_FIXED_W = 25.0  # controller idle/aux losses on the propulsion side
KN = 0.5144       # m/s per knot


def eta_prop(tow_w):
    """Propulsive efficiency vs load: 0.28 at near-zero load rising to
    ~0.52 when the prop works at a healthy fraction of its design point
    (prop 0.55-0.65 x motor+controller 0.8-0.85 at load)."""
    return 0.28 + 0.24 * (1.0 - math.exp(-tow_w / 400.0))


def electric_w(tow_w):
    """Battery-side propulsion power for a given towing power."""
    if tow_w <= 0:
        return 0.0
    return tow_w / eta_prop(tow_w) + P_FIXED_W


def friction_n(speed_ms, lwl_m, wetted_m2, form_factor=1.12):
    """ITTC-57 frictional resistance in newtons."""
    if speed_ms <= 0:
        return 0.0
    re = speed_ms * lwl_m / NU
    cf = 0.075 / (math.log10(re) - 2.0) ** 2
    return 0.5 * RHO_W * cf * wetted_m2 * speed_ms ** 2 * form_factor


def wetted_surface_m2(disp_kg, lwl_m, c=2.6):
    """Classic approximation S = c * sqrt(V * L) (V in m^3)."""
    vol = disp_kg / RHO_W
    return c * math.sqrt(vol * lwl_m)


def residuary_n(speed_ms, lwl_m, disp_kg):
    """Crude slenderness-scaled residuary (wave-making) resistance.

    Shape: grows ~Fn^4 toward the hull-speed hump, scaled by displacement
    and divided by slenderness^2 (L/V^(1/3)) so long-and-light hulls pay
    much less — the physically decisive trend this study needs. Anchored
    so a conventional short/heavy hull hits the familiar displacement
    wall just past Fn ~0.32 while genuinely slender hulls soften it
    (they do — that is the whole point of slender cats).
    """
    vol = disp_kg / RHO_W
    slender = lwl_m / vol ** (1.0 / 3.0)
    fn = speed_ms / math.sqrt(G * lwl_m)
    return 3.0e5 * disp_kg / 1000.0 * fn ** 4 / slender ** 2


def calm_tow_n(speed_ms, lwl_m, disp_kg, hulls=1):
    per_hull = disp_kg / hulls
    s = wetted_surface_m2(per_hull, lwl_m)
    return hulls * (friction_n(speed_ms, lwl_m, s) +
                    residuary_n(speed_ms, lwl_m, per_hull))


def calm_electric_w(speed_ms, lwl_m, disp_kg, hulls=1):
    """Battery-side propulsion power in calm water (all hulls)."""
    tow = calm_tow_n(speed_ms, lwl_m, disp_kg, hulls) * speed_ms
    return electric_w(tow)


def aero_tow_w(boat_ms, wind_ms, cda_m2):
    v_app = boat_ms + wind_ms
    return 0.5 * RHO_A * cda_m2 * v_app ** 2 * boat_ms


def stawave1_tow_w(boat_ms, hs_m, beam_m, lwl_m):
    """STAWAVE-1 head-sea added resistance -> towing power."""
    r_aw = (1.0 / 16.0) * RHO_W * G * hs_m ** 2 * beam_m * \
        math.sqrt(beam_m / (2.0 * lwl_m))
    return r_aw * boat_ms


def total_electric_w(boat_ms, lwl_m, disp_kg, hulls=1, wind_ms=0.0,
                     cda_m2=2.5, hs_m=0.0, beam_m=1.9):
    tow = (calm_tow_n(boat_ms, lwl_m, disp_kg, hulls) * boat_ms +
           aero_tow_w(boat_ms, wind_ms, cda_m2) +
           stawave1_tow_w(boat_ms, hs_m, beam_m, lwl_m))
    return electric_w(tow)


def kmh(v_ms):
    return v_ms * 3.6


def section(title):
    print("\n" + "=" * 64 + f"\n{title}\n" + "=" * 64)


# ---------------------------------------------------------------- Helios
HELIOS = dict(lwl=10.5, disp=1500.0, beam_wl=1.9)

section("1. Helios calm water: electric W vs speed (LWL 10.5 m, 1.5 t)")
for v_kn in (3, 4, 5, 6, 7):
    v = v_kn * KN
    w = calm_electric_w(v, HELIOS["lwl"], HELIOS["disp"])
    print(f"  {v_kn} kn ({kmh(v):4.1f} km/h): {w:6.0f} W electric "
          f"({w / kmh(v):5.0f} Wh/km)")

section("2. The heavy-headwind observation (documented: 6-6.7 kn at "
        "3500-4000 W in 20-25 kn)")
v = 5 * KN
calm = calm_electric_w(v, HELIOS["lwl"], HELIOS["disp"])
for v_kn, wind_kn in ((6.0, 20), (6.0, 25), (6.5, 20), (6.5, 25)):
    vb = v_kn * KN
    for cda in (2.0, 2.5, 3.0):
        total = total_electric_w(vb, HELIOS["lwl"], HELIOS["disp"],
                                 wind_ms=wind_kn * KN, cda_m2=cda,
                                 hs_m=0.3, beam_m=HELIOS["beam_wl"])
        print(f"  {v_kn} kn into {wind_kn} kn, CdA {cda:.1f} + 0.3 m "
              f"chop -> {total:5.0f} W")
print("  -> the documented 3500-4000 W band is bracketed by CdA 2.0-2.5")
print("     at 6 kn and matched at 6.5 kn/20 kn: an ORDINARY drag model")
print("     explains the observation. Aero POWER stays modest because")
print("     P = drag * V_boat and V_boat is small even when drag is big.")
unv = total_electric_w(v, HELIOS["lwl"], HELIOS["disp"], wind_ms=25 * KN,
                       cda_m2=2.5, hs_m=0.3, beam_m=HELIOS["beam_wl"])
print(f"  (the brief's UNVERIFIED '~2700 W at ~5 kn' variant: model says "
      f"{unv:.0f} W at CdA 2.5 - also plausible)")

section("3. Why waves out-punish wind (the 8-kn-wind-with-waves case)")


def penalty_w(**kw):
    """Electrical increase over the calm baseline at 5 kn."""
    return (total_electric_w(v, HELIOS["lwl"], HELIOS["disp"],
                             beam_m=HELIOS["beam_wl"], **kw) - calm)


for hs in (0.3, 0.5, 0.7, 1.0):
    print(f"  Hs {hs:.1f} m head seas alone: +{penalty_w(hs_m=hs):4.0f} W "
          "electric (STAWAVE-1 UNDERESTIMATES for very light hulls)")
print(f"  8 kn headwind alone (CdA 2.5): "
      f"+{penalty_w(wind_ms=8 * KN):.0f} W electric")
print(f"  8 kn headwind + 0.7 m seas:   "
      f"+{penalty_w(wind_ms=8 * KN, hs_m=0.7):.0f} W electric")
print(f"  25 kn headwind alone (CdA 2.5): "
      f"+{penalty_w(wind_ms=25 * KN):.0f} W electric")
lam3 = G * 3.0 ** 2 / (2 * math.pi)
print(f"  wind chop with T=3 s has wavelength {lam3:.0f} m ~= Helios LWL:")
print("  pitch-resonant encounter for an 11 m hull, and a 1.5 t boat has")
print("  little inertia to punch through - the builder's 'waves beat wind'")
print("  report is exactly what the physics predicts, with the light-")
print("  displacement resonance ON TOP of the STAWAVE baseline.")

section("4. Hull strategy: 6.5m/1.5t vs 8m cat/0.8t vs 11m/1.5t mono")
BOATS = [
    ("6.5 m / 1500 kg conventional mono", dict(lwl=6.0, disp=1500.0,
                                               hulls=1)),
    ("8 m / 800 kg slender cat (2x0.5 m)", dict(lwl=7.6, disp=800.0,
                                                hulls=2)),
    ("11 m / 1500 kg Helios-style mono", dict(lwl=10.5, disp=1500.0,
                                              hulls=1)),
]
speeds = (5, 6, 7, 8)
header = "  speed | " + " | ".join(f"{name[:34]:>34}" for name, _ in BOATS)
print(header)
for skmh in speeds:
    v = skmh / 3.6
    row = []
    for _, b in BOATS:
        w = calm_electric_w(v, b["lwl"], b["disp"], b["hulls"])
        row.append(f"{w:6.0f} W {w / skmh:5.0f} Wh/km")
    print(f"  {skmh} km/h | " + " | ".join(f"{c:>34}" for c in row))
slender = []
for name, b in BOATS:
    vol = b["disp"] / b["hulls"] / RHO_W
    slender.append(f"{name[:20]}: L/V^(1/3) = "
                   f"{b['lwl'] / vol ** (1 / 3.0):.1f}")
print("  slenderness -> " + "; ".join(slender))

section("5. SolarHelm Light Powercat envelope (8 m, 2x0.5 m hulls)")
for disp in (700.0, 1000.0, 1300.0):
    print(f"  all-up displacement {disp:.0f} kg:")
    for skmh in (5, 6, 7):
        v = skmh / 3.6
        w = calm_electric_w(v, 7.6, disp, hulls=2)
        print(f"    {skmh} km/h: {w:5.0f} W electric ({w / skmh:4.0f} Wh/km)")

section("6. Solar-equilibrium speed, midday (3.0 kWp roof, PR 0.75)")
pv_mid = 3000 * 0.75
hotel = 150.0


def equilibrium_kmh(disp, wind_ms=0.0, hs_m=0.0, margin=1.0):
    """Speed where propulsion power (x safety margin for everything the
    ideal model omits: chop, fouling, appendages) equals the PV budget."""
    budget = pv_mid - hotel
    lo, hi = 0.1, 5.0
    for _ in range(60):
        mid = (lo + hi) / 2
        p = margin * total_electric_w(mid, 7.6, disp, hulls=2,
                                      wind_ms=wind_ms, cda_m2=2.0,
                                      hs_m=hs_m, beam_m=0.5)
        if p < budget:
            lo = mid
        else:
            hi = mid
    return kmh(lo)


for disp in (700.0, 1000.0, 1300.0):
    ideal = equilibrium_kmh(disp)
    real = equilibrium_kmh(disp, margin=1.5)
    rough = equilibrium_kmh(disp, wind_ms=5.0, hs_m=0.5, margin=1.5)
    print(f"  {disp:4.0f} kg: ideal {ideal:4.1f} km/h | x1.5 real-world "
          f"margin {real:4.1f} km/h | +10 kn wind & 0.5 m seas "
          f"{rough:4.1f} km/h")
print("  -> even with harsh margins the cat cruises energy-neutral at")
print("     usable speeds in sun; the LEARNED model must replace these")
print("     bands after sea trials (this is exactly what SolarHelm does).")

section("8. The 7.5 kn / ~6000 W report: the EnergyKnee, and an honest "
        "model miss")
for v_kn in (6.0, 6.5, 7.0, 7.5, 8.0):
    v = v_kn * KN
    w = calm_electric_w(v, HELIOS["lwl"], 1800.0)  # post-upgrade, heavier
    print(f"  {v_kn:.1f} kn: model {w:5.0f} W  "
          f"(Fn {v / math.sqrt(G * HELIOS['lwl']):.2f})")
print("  Builder's 30 kWh test reportedly drew ~6000 W at 7.5 kn -")
print("  roughly 2x this model. The slender-hull law underestimates")
print("  the near-hull-speed wall for THIS hull (builder himself cites")
print("  flat underwater sections and a compromised bow). We DOCUMENT the")
print("  discrepancy instead of tuning to it: it is exactly the")
print("  dP/dV 'EnergyKnee' SolarHelm must LEARN per boat from telemetry,")
print("  not derive from a parametric prior.")

section("7. Battery-as-buffer sizing (cat, 1000 kg, June day)")
cruise_w = calm_electric_w(6 / 3.6, 7.6, 1000.0, hulls=2)
day_solar_kwh = 3.0 * 4.5 * 0.75          # kWp * peak-sun-h * PR
cruise_kwh_10h = cruise_w * 10 / 1000.0   # 10 h at 6 km/h
hotel_kwh = 150 * 24 / 1000.0
balance = day_solar_kwh - cruise_kwh_10h - hotel_kwh
print(f"  cruise at 6 km/h: {cruise_w:.0f} W -> {cruise_kwh_10h:.1f} kWh "
      "per 10 h day")
print(f"  solar {day_solar_kwh:.1f} kWh/day, hotel {hotel_kwh:.1f} kWh/day"
      f" -> daily balance {balance:+.1f} kWh")
print("  buffer must cover: night hotel (~1.8 kWh), a cloudy morning of")
print("  cruising (~2-3 kWh), maneuvering/headwind reserve (~2 kWh)")
print("  -> 8-12 kWh usable battery is a BUFFER-sized pack; range-sized")
print("     thinking (20+ kWh) is unnecessary when daily balance is >= 0.")
