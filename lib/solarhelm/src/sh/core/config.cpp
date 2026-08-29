#include "sh/core/config.h"

namespace sh {

const char* configErrorName(ConfigError e) {
    switch (e) {
        case ConfigError::kNone: return "none";
        case ConfigError::kBadSchemaVersion: return "bad_schema_version";
        case ConfigError::kBadGains: return "bad_gains";
        case ConfigError::kBadDeadband: return "bad_deadband";
        case ConfigError::kBadFilter: return "bad_filter";
        case ConfigError::kBadRampRates: return "bad_ramp_rates";
        case ConfigError::kBadCommandLimits: return "bad_command_limits";
        case ConfigError::kBadReserveSoc: return "bad_reserve_soc";
        case ConfigError::kBadSolarPlusTarget: return "bad_solar_plus_target";
        case ConfigError::kBadTimeouts: return "bad_timeouts";
        case ConfigError::kBadMotorPower: return "bad_motor_power";
        case ConfigError::kBadBatteryGuard: return "bad_battery_guard";
        default: return "unknown";
    }
}

ConfigError ControlConfig::validate() const {
    if (schema_version != kConfigSchemaVersion) {
        return ConfigError::kBadSchemaVersion;
    }
    if (!(kp_pct_per_w > 0.0f) || !(ki_pct_per_ws >= 0.0f)) {
        return ConfigError::kBadGains;
    }
    if (!(deadband_w >= 0.0f)) {
        return ConfigError::kBadDeadband;
    }
    if (!(filter_time_constant_s >= 0.0f)) {
        return ConfigError::kBadFilter;
    }
    if (!(max_ramp_up_pct_per_s > 0.0f) || !(max_ramp_down_pct_per_s > 0.0f)) {
        return ConfigError::kBadRampRates;
    }
    if (!(min_motor_cmd_pct >= 0.0f) || !(max_motor_cmd_pct <= 100.0f) ||
        !(min_motor_cmd_pct < max_motor_cmd_pct)) {
        return ConfigError::kBadCommandLimits;
    }
    if (!(reserve_soc_pct >= 0.0f) || !(reserve_soc_pct <= 100.0f) ||
        !(reserve_hysteresis_pct >= 0.0f) ||
        !(reserve_hysteresis_pct <= 20.0f)) {
        return ConfigError::kBadReserveSoc;
    }
    if (!(solar_plus_target_w <= 0.0f) || !(solar_plus_target_w >= -5000.0f)) {
        return ConfigError::kBadSolarPlusTarget;
    }
    if (battery_timeout_ms == 0 || gps_timeout_ms == 0 ||
        solar_timeout_ms == 0 || remote_timeout_ms == 0) {
        return ConfigError::kBadTimeouts;
    }
    if (!(motor_max_power_w > 0.0f)) {
        return ConfigError::kBadMotorPower;
    }
    if (!(sag_stop_v > 0.0f) || !(sag_stop_v < sag_hard_v) ||
        !(sag_hard_v < sag_soft_v) || !(sag_release_margin_v >= 0.0f) ||
        !(sag_debounce_s >= 0.0f) || !(current_debounce_s >= 0.0f) ||
        !(sag_hard_cap_pct > 0.0f) ||
        !(sag_hard_cap_pct <= sag_soft_cap_pct) ||
        !(sag_soft_cap_pct <= 100.0f) ||
        !(max_discharge_current_a > 0.0f) ||
        !(batt_cold_derate_c < batt_hot_derate_c) ||
        !(batt_hot_derate_c < batt_stop_c) ||
        !(temp_derate_cap_pct > 0.0f) || !(temp_derate_cap_pct <= 100.0f)) {
        return ConfigError::kBadBatteryGuard;
    }
    return ConfigError::kNone;
}

}  // namespace sh
