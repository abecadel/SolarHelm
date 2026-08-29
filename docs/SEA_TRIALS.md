# Sea Trials Protocol

Goal: replace the placeholder hull curve in `config/boat_profile.json` with
*your boat's* measured efficiency map, and answer the project's core
question — **"what is the most energy-efficient cruising speed for this
boat today?"**

## Prerequisites

- Milestone 3 complete (bench-validated throttle, watchdog, manual
  override).
- Calm conditions for the baseline map: wind < 2 m/s, minimal current,
  normal cruising load on board.
- Telemetry logging running (CSV, ≥ 1 Hz), GPS with a solid fix.

## The power ladder

Hold each point for **at least 5 minutes** after speed settles; run each
point in **two opposite headings** and average, to cancel current/wind:

```
250 W   400 W   500 W   600 W   750 W   1000 W   full power
```

For every point record (the telemetry log already contains all of it):
GPS speed (km/h), battery power (W), motor command (%), estimated motor
power (W), Wh/km.

## Deriving the curve

1. Export the day's CSV (`telemetry` format).
2. Import it in the planner app (Boat → *Import telemetry CSV*): it bins
   samples by speed (0.5 km/h bins), takes per-bin medians and fits the
   `[[speed_kmh, wh_per_km], ...]` curve.
3. Copy the fitted curve into `config/boat_profile.json` (one commit — the
   sync tests then hold simulator, planner and calculator to the new
   truth).
4. Re-run `make scenarios && python3 tools/plot_scenarios.py` — the
   simulation now predicts *your* boat.

## Repeat runs worth logging separately

- headwind/tailwind pairs at one power (calibrates the planner's wind
  penalty factor, currently the 4 %/(m/s) placeholder assumption)
- loaded vs light boat
- clean vs fouled hull (the curve will quantify the fouling penalty)

## Reading the result

Wh/km vs speed is monotonically rising for displacement hulls, but slowly
at first — the "knee" is where cruising is cheap. RANGE mode (Milestone 3+)
will sit just below the knee automatically; until then the planner's
"max range" figure uses the curve's cheapest measured point.
