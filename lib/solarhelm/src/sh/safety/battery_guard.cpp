#include "sh/safety/battery_guard.h"

#include "sh/safety/supervisor.h"

namespace sh {

BatteryGuard::BatteryGuard(const ControlConfig& cfg) : cfg_(cfg) {}

void BatteryGuard::updateVoltageStage(float v, float dt_s, float threshold_v,
                                      float* below_time_s,
                                      bool* latched) const {
    if (v < threshold_v) {
        *below_time_s += dt_s;
        if (*below_time_s >= cfg_.sag_debounce_s) {
            *latched = true;
        }
    } else {
        *below_time_s = 0.0f;
        if (*latched && v >= threshold_v + cfg_.sag_release_margin_v) {
            *latched = false;
        }
    }
}

GuardOutput BatteryGuard::update(const BatterySample& battery, float dt_s) {
    GuardOutput out;
    if (!battery.valid) {
        return out;  // freshness/validity policing belongs to the supervisor
    }

    // --- Voltage-sag stages (soft -> hard -> stop) ---
    const float v = battery.voltage_v;
    updateVoltageStage(v, dt_s, cfg_.sag_soft_v, &soft_below_s_,
                       &soft_latched_);
    updateVoltageStage(v, dt_s, cfg_.sag_hard_v, &hard_below_s_,
                       &hard_latched_);
    updateVoltageStage(v, dt_s, cfg_.sag_stop_v, &stop_below_s_,
                       &stop_latched_);
    if (soft_latched_) {
        out.faults |= kFaultSagSoft;
        if (out.ceiling_pct > cfg_.sag_soft_cap_pct) {
            out.ceiling_pct = cfg_.sag_soft_cap_pct;
        }
    }
    if (hard_latched_) {
        out.faults |= kFaultSagHard;
        if (out.ceiling_pct > cfg_.sag_hard_cap_pct) {
            out.ceiling_pct = cfg_.sag_hard_cap_pct;
        }
    }
    if (stop_latched_) {
        out.faults |= kFaultSagStop;
        out.stop = true;
    }

    // --- Discharge current cap ---
    const float discharge_a =
        battery.current_a < 0.0f ? -battery.current_a : 0.0f;
    if (discharge_a > cfg_.max_discharge_current_a) {
        over_current_s_ += dt_s;
        if (over_current_s_ >= cfg_.current_debounce_s) {
            over_current_latched_ = true;
        }
    } else {
        over_current_s_ = 0.0f;
        if (over_current_latched_ &&
            discharge_a < 0.8f * cfg_.max_discharge_current_a) {
            over_current_latched_ = false;
        }
    }
    if (over_current_latched_) {
        out.faults |= kFaultOverCurrent;
        if (out.ceiling_pct > cfg_.sag_hard_cap_pct) {
            out.ceiling_pct = cfg_.sag_hard_cap_pct;
        }
    }

    // --- Temperature policy (only with a reporting sensor) ---
    if (battery.has_temperature) {
        const float t = battery.temperature_c;
        if (t <= 0.0f && battery.power_w > 1.0f) {
            // Charging below freezing plates lithium; SolarHelm cannot
            // block the charger, but it must alert loudly.
            out.faults |= kFaultChargeBelowFreezing;
        }
        if (t >= cfg_.batt_stop_c) {
            out.faults |= kFaultBattTempDerate;
            out.stop = true;
        } else if (t < cfg_.batt_cold_derate_c || t > cfg_.batt_hot_derate_c) {
            out.faults |= kFaultBattTempDerate;
            if (out.ceiling_pct > cfg_.temp_derate_cap_pct) {
                out.ceiling_pct = cfg_.temp_derate_cap_pct;
            }
        }
    }
    return out;
}

}  // namespace sh
