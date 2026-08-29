// BatteryPowerController — the heart of SolarHelm.
//
// Drives the motor command so measured battery power tracks a target
// (0 W = pure solar cruising). Pipeline per control tick:
//
//   measured battery power
//     -> low-pass filter          (ignore ripple/noise)
//     -> deadband                 (no hunting around the target)
//     -> clamped PI               (anti-windup)
//     -> slew-rate limiter        (asymmetric: slow up, fast down)
//     -> command clamp            (min/max motor command)
//
// error_w = filtered_power_w - target_w. Positive error means the battery
// is charging harder than requested — surplus solar — so the motor command
// increases. Negative error (unwanted discharge) reduces it.

#pragma once

#include "sh/control/lowpass.h"
#include "sh/control/pi.h"
#include "sh/control/ratelimit.h"
#include "sh/core/config.h"

namespace sh {

class BatteryPowerController {
public:
    explicit BatteryPowerController(const ControlConfig& cfg);

    // Restart the loop with zero command (used on auto-mode activation:
    // the throttle always ramps from zero, never from a remembered value).
    void reset();

    // One control tick. Returns the motor command in percent.
    // ceiling_pct: dynamic upper bound from the BatteryGuard envelope
    // (100 = unconstrained). A ceiling below the held command overrides the
    // deadband freeze and ramps the command down at the configured rate.
    float update(float measured_battery_power_w, float target_battery_power_w,
                 float dt_s, float ceiling_pct = 100.0f);

    float command_pct() const { return command_pct_; }
    float filtered_power_w() const { return filter_.value(); }

private:
    const ControlConfig& cfg_;
    LowPassFilter filter_;
    PiController pi_;
    RateLimiter ramp_;
    float command_pct_ = 0.0f;
};

}  // namespace sh
