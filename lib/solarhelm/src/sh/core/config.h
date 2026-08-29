// SolarHelm — control configuration with validation and versioning.
//
// The configuration is a plain struct so it can live in flash/NVS on the
// ESP32 and be filled from JSON on the desktop. `validate()` must pass
// before a config is accepted; an invalid config keeps the controller in
// MANUAL (fail safe).

#pragma once

#include <cstdint>

namespace sh {

// Bump when the persisted layout changes; loaders must migrate or reject.
constexpr uint16_t kConfigSchemaVersion = 1;

enum class ConfigError : uint8_t {
    kNone = 0,
    kBadSchemaVersion,
    kBadGains,
    kBadDeadband,
    kBadFilter,
    kBadRampRates,
    kBadCommandLimits,
    kBadReserveSoc,
    kBadSolarPlusTarget,
    kBadTimeouts,
    kBadMotorPower,
};

const char* configErrorName(ConfigError e);

struct ControlConfig {
    uint16_t schema_version = kConfigSchemaVersion;

    // --- Battery power loop (positive battery power = charging) ---
    // error_w = filtered_battery_power_w - target_battery_power_w
    // (positive error = surplus charge -> raise motor command)
    float kp_pct_per_w = 0.02f;       // proportional gain
    float ki_pct_per_ws = 0.006f;     // integral gain
    float deadband_w = 25.0f;         // |error| below this is treated as 0
    float filter_time_constant_s = 2.0f;  // low-pass on measured battery power

    // --- Actuation limits ---
    float max_ramp_up_pct_per_s = 2.0f;    // gentle throttle-up (clouds clear)
    float max_ramp_down_pct_per_s = 5.0f;  // faster throttle-down (cloud hits)
    float min_motor_cmd_pct = 0.0f;
    float max_motor_cmd_pct = 100.0f;

    // --- Modes ---
    // SOLAR+ battery contribution: target battery power while in SOLAR_PLUS.
    // Must be <= 0 (a discharge allowance, e.g. -200 W).
    float solar_plus_target_w = -200.0f;
    float reserve_soc_pct = 20.0f;  // below this, no net discharge is allowed
    // The reserve floor latches on at reserve_soc_pct and releases only when
    // SOC has recovered by this much (prevents target chatter right at the
    // floor).
    float reserve_hysteresis_pct = 2.0f;

    // --- Safety ---
    uint32_t battery_timeout_ms = 3000;  // stale shunt data -> leave auto mode
    uint32_t gps_timeout_ms = 5000;      // stale GPS -> pause distance/efficiency
    uint32_t solar_timeout_ms = 5000;    // stale MPPT telemetry -> treat PV as 0

    // --- Telemetry / estimation ---
    float motor_max_power_w = 1164.0f;  // full-throttle electrical power

    // Returns kNone when the configuration is usable.
    ConfigError validate() const;
};

}  // namespace sh
