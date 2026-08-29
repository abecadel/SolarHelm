// BatteryGuard — the battery-side Motor Protection Envelope
// (docs/MOTOR_PROTECTION_RESEARCH.md §3), enforced in the supervisor so
// the motor controller's and BMS's hard protections stay unreachable:
//
//   - staged voltage-sag backoff: soft cap -> hard cap -> graceful stop,
//     each debounced (a wave-load sag must not trigger) and released with
//     hysteresis (backoff reduces current, voltage recovers, no chatter)
//   - discharge current cap (<= the configured fraction of the smallest
//     continuous rating in the chain), debounced, 20% release hysteresis
//   - battery temperature policy when a sensor reports: derate when too
//     cold/hot, stop when critically hot, and flag charging below 0 degC
//     (lithium plating alert — SolarHelm cannot block MPPT charging, but
//     it must tell the crew)
//
// The guard emits a command CEILING (percent) plus fault flags; it never
// touches the throttle itself. Helm feeds the ceiling into the
// BatteryPowerController, whose slew limiter turns a ceiling drop into a
// smooth ramp-down rather than a step.

#pragma once

#include <cstdint>

#include "sh/core/config.h"
#include "sh/core/samples.h"

namespace sh {

struct GuardOutput {
    float ceiling_pct = 100.0f;  // max allowed automatic command
    bool stop = false;           // graceful stop: Helm must force MANUAL
    uint16_t faults = 0;         // kFaultSag*/kFaultOverCurrent/kFaultBattTemp*
};

class BatteryGuard {
public:
    explicit BatteryGuard(const ControlConfig& cfg);

    // One control tick. Call with a fresh, plausible battery sample (Helm
    // gates on the SafetySupervisor verdict); an invalid sample returns a
    // full ceiling and no faults — staleness is the supervisor's job.
    GuardOutput update(const BatterySample& battery, float dt_s);

private:
    void updateVoltageStage(float v, float dt_s, float threshold_v,
                            float* below_time_s, bool* latched) const;

    const ControlConfig& cfg_;
    float soft_below_s_ = 0.0f;
    float hard_below_s_ = 0.0f;
    float stop_below_s_ = 0.0f;
    float over_current_s_ = 0.0f;
    bool soft_latched_ = false;
    bool hard_latched_ = false;
    bool stop_latched_ = false;
    bool over_current_latched_ = false;
};

}  // namespace sh
