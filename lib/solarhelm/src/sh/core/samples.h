// SolarHelm — sensor sample types shared by drivers, control and telemetry.
//
// Sign convention (project-wide): battery power/current is POSITIVE when the
// battery is CHARGING and NEGATIVE when it is DISCHARGING.
// All fields carry explicit units in their names.

#pragma once

#include <cstdint>

namespace sh {

// One reading from a battery monitor (shunt / BMS).
struct BatterySample {
    bool valid = false;         // false: no usable data (never trust the rest)
    uint32_t timestamp_ms = 0;  // monotonic time the sample was taken
    float voltage_v = 0.0f;
    float current_a = 0.0f;     // + charging, - discharging
    float power_w = 0.0f;       // + charging, - discharging
    float soc_pct = 0.0f;       // 0..100
    bool has_temperature = false;  // battery temp sensor present & reporting
    float temperature_c = 0.0f;
};

// One reading from a solar production source (MPPT telemetry).
// Optional for control; used for telemetry and diagnostics.
struct SolarSample {
    bool valid = false;
    uint32_t timestamp_ms = 0;
    float power_w = 0.0f;  // PV power delivered to the DC bus (>= 0)
};

// One GNSS reading. Not safety-critical for the power loop; feeds
// distance/efficiency tracking and the UI.
struct GpsSample {
    bool valid = false;  // true only with a usable position/velocity fix
    uint32_t timestamp_ms = 0;
    float speed_mps = 0.0f;
    float course_deg = 0.0f;
    double latitude_deg = 0.0;
    double longitude_deg = 0.0;
    uint8_t fix_quality = 0;
    uint8_t satellites = 0;
};

// One attitude reading (IMU, Helios L8): wave-state features and
// stability evidence from the same sensor. Advisory only — never in the
// safety path.
struct ImuSample {
    bool valid = false;
    uint32_t timestamp_ms = 0;
    float roll_deg = 0.0f;   // + starboard down
    float pitch_deg = 0.0f;  // + bow up
};

}  // namespace sh
