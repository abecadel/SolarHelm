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
    kBadBatteryGuard,
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
    // REMOTE mode: the phone planner streams a motor-power target; if it
    // goes stale the boat degrades to self-contained SOLAR mode (the ESP32
    // never depends on the phone for safety).
    uint32_t remote_timeout_ms = 10000;

    // --- Battery protection envelope (docs/MOTOR_PROTECTION_RESEARCH.md) ---
    // Staged voltage-sag backoff for an 8S LFP pack; all thresholds are
    // under-load pack voltages and MUST sit above the BMS undervoltage trip
    // and the motor controller's low-voltage cutback (datasheet-derived).
    float sag_soft_v = 24.4f;    // ~3.05 V/cell: cap command at sag_soft_cap
    float sag_hard_v = 23.6f;    // ~2.95 V/cell: cap command at sag_hard_cap
    float sag_stop_v = 23.2f;    // ~2.90 V/cell: graceful stop (forced MANUAL)
    float sag_release_margin_v = 0.4f;  // hysteresis for stage release
    float sag_debounce_s = 4.0f;        // wave-sag transients don't trigger
    float sag_soft_cap_pct = 50.0f;
    float sag_hard_cap_pct = 15.0f;

    // Discharge current cap: <= 80% of the smallest continuous rating in
    // the chain (controller 60 A -> 48 A for the reference build).
    float max_discharge_current_a = 48.0f;
    float current_debounce_s = 2.0f;

    // Battery temperature policy (applies only when a sensor reports).
    float batt_cold_derate_c = -10.0f;  // below: cap at temp_derate_cap
    float batt_hot_derate_c = 45.0f;    // above: cap at temp_derate_cap
    float batt_stop_c = 60.0f;          // at/above: graceful stop
    float temp_derate_cap_pct = 50.0f;

    // --- Telemetry / estimation ---
    float motor_max_power_w = 1164.0f;  // full-throttle electrical power

    // Returns kNone when the configuration is usable.
    ConfigError validate() const;
};

}  // namespace sh
