// Telemetry — the common record emitted every control tick.
//
// The same structure is written to the simulator CSV, will be logged to
// flash/SD on the ESP32, and is the import format the companion planner
// app uses to learn the real hull-efficiency curve. Field set matches
// docs/ARCHITECTURE.md §Telemetry.

#pragma once

#include <cstddef>
#include <cstdint>

namespace sh {

struct TelemetryRecord {
    uint32_t timestamp_ms = 0;
    uint8_t mode = 0;  // sh::Mode as integer
    float battery_voltage_v = 0.0f;
    float battery_current_a = 0.0f;
    float battery_power_w = 0.0f;  // + charging, - discharging
    float battery_soc_pct = 0.0f;
    float solar_power_w = 0.0f;
    float motor_command_pct = 0.0f;
    float motor_estimated_power_w = 0.0f;
    float speed_kmh = 0.0f;
    float distance_today_km = 0.0f;
    float energy_solar_today_wh = 0.0f;
    float energy_motor_today_wh = 0.0f;
    float energy_hotel_today_wh = 0.0f;
    float efficiency_wh_km = 0.0f;
    float reserve_soc_pct = 0.0f;
    uint16_t fault_flags = 0;
    // Position of the sample (0,0 = no fix — the null-island sentinel is
    // documented; kFaultGpsStale says why). Positions make the log usable
    // for geographic residual learning.
    double latitude_deg = 0.0;
    double longitude_deg = 0.0;
    // Configuration identity (Helios L1): which boat configuration
    // produced this record — the learner branches on changes.
    float config_revision = 1.0f;
    // Attitude (Helios L8): 0.0 until an IMU is fitted and streaming.
    float roll_deg = 0.0f;
    float pitch_deg = 0.0f;
};

// CSV header matching writeCsvRow's column order.
const char* telemetryCsvHeader();

// Writes one CSV row (no trailing newline) into buf. Returns the number of
// characters that were (or would have been) written, snprintf-style; a
// return >= buf_len means the row was truncated.
int writeCsvRow(const TelemetryRecord& r, char* buf, size_t buf_len);

}  // namespace sh
