# SolarHelm Control Theory

## The plant

From the controller's point of view the boat is a power-balance node:

```
battery_power = pv_power − motor_power(cmd) − hotel_load
motor_power ≈ (cmd/100) · P_max            (≈ 11.6 W per %-point at 24 V/1164 W)
```

The electrical response to a command change is nearly instantaneous; the
*hydrodynamic* response (hull speed) lags by ~5–15 s but does not feed back
into battery power, so the control plant is effectively a fast first-order
gain with sensor noise. What makes it interesting:

- PV power is the disturbance and moves over three orders of magnitude
  (clouds: −80 % in seconds; day arc: slow ramp over hours).
- The shunt measurement carries switching/propeller ripple → filtering.
- The actuator must be gentle: passengers feel every surge, and aggressive
  oscillation ("cloud hunting") destroys confidence and efficiency.
- Near battery-full, the MPPT curtails: available PV silently exceeds
  measured PV. Holding *battery* power (not "use all solar") makes this a
  non-issue — the loop simply sees its error and trims.

## Sign convention

`battery_power > 0` = charging. `error_w = filtered − target`.
Positive error = charging harder than requested = surplus ⇒ raise command.
This keeps every gain positive.

## The implemented pipeline (Phase 2 of the plan: PI)

```
measured ──► LPF(τ=2s) ──► deadband(±25 W) ──► PI (clamped, tracking AW)
         ──► slew limit (+2/−5 %/s) ──► clamp [0,100] ──► command
```

Each stage exists for a measured reason:

| Stage | Default | Failure it prevents |
|---|---|---|
| Low-pass filter | τ = 2 s | ripple amplification through Kp |
| Deadband | ±25 W, **freezes** the command | limit-cycle hunting around target; the freeze (rather than error-zeroing) also stops the P-term collapse from sagging the command on deadband entry |
| PI gains | Kp = 0.02 %/W, Ki = 0.006 %/(W·s) | Kp alone leaves a standing error ∝ disturbance; Ki removes it slowly enough not to fight the filter |
| Integrator clamp | to [cmd_min, cmd_max] | classic windup at actuator saturation |
| Tracking anti-windup | integrator re-seated to the *rate-limited* output | windup **during ramps** — without it a fast solar rise gives ~4 %-points of command overshoot; with it, 0.0 (Scenario C) |
| Slew limiter | +2 %/s up, −5 %/s down | surging when sun returns (slow up); battery hammering when a cloud hits (faster down) |

Loop cadence 2–4 Hz. The gains give a closed-loop response of ~30–60 s to a
step disturbance — deliberately slower than the hull's own dynamics and
much slower than MPPT tracking (sub-second), so the two controllers cannot
interact: MPPT owns the panel operating point, SolarHelm owns the load, the
battery bus absorbs the difference at all times.

### Tuning guidance

Plant gain g = P_max/100 (W per %-point). Start with
`Kp ≈ 0.25/g`, `Ki ≈ Kp/4 s⁻¹`, deadband ≈ 2× observed power ripple,
filter τ ≈ 4× tick period. On the water: raise the deadband before touching
gains if the boat hunts; halve Ki if the command creeps after gusty clouds.

## Modes

| Mode | Battery-power target | Status |
|---|---|---|
| MANUAL | — (SolarHelm outputs 0, hardware gives helm authority) | implemented |
| SOLAR | 0 W | implemented |
| SOLAR+ | configured ≤ 0 W (e.g. −200 W) | implemented |
| RANGE | choose speed minimising Wh/km from the *learned* efficiency curve, expressed as a battery-power target | M3+ (needs sea-trial data) |
| RESERVE | not a separate mode: the reserve floor applies to every automatic mode | implemented |
| ARRIVAL | distance + desired arrival SOC ⇒ time-varying power budget | future (planner app already does the advisory version) |

**Reserve floor** (all auto modes): at SOC ≤ reserve the target is raised to
`+deadband_w` — the worst-case rest point inside the deadband is then still
≥ 0 W, so the reserve cannot leak away. The floor latches and releases only
at reserve + 2 % (hysteresis), eliminating target chatter while SOC hovers
on the line. Verified in Scenario D: SOC dips 0.02 % below reserve during
the ramp transition, then holds and recovers.

## Where the design deliberately does nothing

- **No derivative term.** The disturbance is steppy and the measurement
  noisy; D would amplify exactly what we filter out.
- **No feed-forward from PV telemetry (yet).** MPPT telemetry is optional
  and 1 Hz-ish; the loop is fast enough without it. A PV-slope feed-forward
  is a candidate Phase-3 refinement, not a need.
- **No predictive/energy-budget control in the firmware.** Phase 4
  (forecast-aware budgets) lives in the planner app first, where a wrong
  prediction costs nothing. Only proven logic migrates down.

## Phased roadmap (from the spec)

1. **P controller** — worked, left a standing error, kept for reference in
   the git history of this document's development.
2. **PI + deadband + asymmetric ramp + double anti-windup** — current,
   validated in `docs/SIMULATION_RESULTS.md` (mean error −1 W across
   300–1500 W swings).
3. **Adaptive**: gain scheduling from the learned plant gain (motor W per %
   measured at sea), deadband auto-set from measured ripple.
4. **Forecast-aware**: energy budget to sunset/destination feeding a
   time-varying `target_battery_power` — the ARRIVAL mode.
