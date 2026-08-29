#include "sh/control/power_controller.h"

namespace sh {

BatteryPowerController::BatteryPowerController(const ControlConfig& cfg)
    : cfg_(cfg), filter_(cfg.filter_time_constant_s) {
    pi_.configure(cfg_.kp_pct_per_w, cfg_.ki_pct_per_ws, cfg_.min_motor_cmd_pct,
                  cfg_.max_motor_cmd_pct);
    ramp_.configure(cfg_.max_ramp_up_pct_per_s, cfg_.max_ramp_down_pct_per_s);
    reset();
}

void BatteryPowerController::reset() {
    filter_ = LowPassFilter(cfg_.filter_time_constant_s);
    pi_.reset(cfg_.min_motor_cmd_pct);
    ramp_.reset(cfg_.min_motor_cmd_pct);
    command_pct_ = cfg_.min_motor_cmd_pct;
}

float BatteryPowerController::update(float measured_battery_power_w,
                                     float target_battery_power_w, float dt_s,
                                     float ceiling_pct) {
    float eff_max_pct = cfg_.max_motor_cmd_pct;
    if (ceiling_pct < eff_max_pct) {
        eff_max_pct = ceiling_pct;
    }
    if (eff_max_pct < cfg_.min_motor_cmd_pct) {
        eff_max_pct = cfg_.min_motor_cmd_pct;
    }

    const float filtered_w = filter_.update(measured_battery_power_w, dt_s);
    const float error_w = filtered_w - target_battery_power_w;
    if (error_w > -cfg_.deadband_w && error_w < cfg_.deadband_w &&
        command_pct_ <= eff_max_pct) {
        // Inside the deadband: freeze the command entirely (no hunting) and
        // keep the integrator seated on it for a clean exit.
        pi_.trackOutput(command_pct_, 0.0f);
        return command_pct_;
    }
    float desired_pct;
    if (error_w > -cfg_.deadband_w && error_w < cfg_.deadband_w) {
        // In the deadband but above a lowered ceiling: ramp down to it.
        desired_pct = eff_max_pct;
    } else {
        desired_pct = pi_.update(error_w, dt_s);
        if (desired_pct > eff_max_pct) {
            desired_pct = eff_max_pct;
        }
    }
    command_pct_ = ramp_.update(desired_pct, dt_s);
    if (command_pct_ != desired_pct) {
        // Rate limiter is holding the actuator back: keep the integrator
        // seated on reality so it cannot wind up during the ramp.
        pi_.trackOutput(command_pct_, error_w);
    } else if (desired_pct == eff_max_pct && eff_max_pct < cfg_.max_motor_cmd_pct) {
        // Sitting on a lowered ceiling: seat the integrator there too so
        // lifting the ceiling later ramps up cleanly instead of jumping.
        pi_.trackOutput(command_pct_, error_w);
    }
    return command_pct_;
}

}  // namespace sh
