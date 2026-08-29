// BoatProfile — the shared boat model (config/boat_profile.json).
//
// The same JSON file feeds the C++ simulator, the companion planner PWA and
// the website calculator, so all three agree on what the boat is. The
// hull_efficiency_curve values are PLACEHOLDERS from the project spec until
// real sea-trial data replaces them (docs/SEA_TRIALS.md).
//
// The parser below handles exactly this schema (flat numeric fields + one
// array of [speed_kmh, wh_per_km] pairs). It is intentionally not a general
// JSON parser — the desktop build has no third-party dependencies.
//
// Efficiency values are ELECTRICAL Wh per km at the motor input (propeller,
// gearbox and motor losses included), because that is what a shunt actually
// measures on the water.

#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace simc {

struct CurvePoint {
    float speed_kmh = 0.0f;
    float wh_per_km = 0.0f;
};

struct BoatProfile {
    int schema_version = 0;
    std::vector<CurvePoint> hull_curve;  // ascending speed_kmh
    float pv_kwp = 0.0f;
    float pv_derating = 0.0f;
    float battery_capacity_kwh = 0.0f;
    float battery_usable_min_soc_pct = 0.0f;
    float battery_max_charge_w = 0.0f;
    float battery_max_discharge_w = 0.0f;
    float hotel_load_w = 0.0f;
    float motor_max_power_w = 0.0f;

    bool valid() const;

    // Electrical power (W) needed to hold `speed_kmh`, from the hull curve.
    float powerForSpeedW(float speed_kmh) const;

    // Inverse: steady-state speed (km/h) for a given electrical power (W).
    // Cubic-drag extrapolation beyond the measured curve ends.
    float speedForPowerKmh(float power_w) const;
};

// Parses the boat_profile.json schema. Returns false (and fills `error`)
// on malformed input or an unusable profile.
bool parseBoatProfile(const std::string& json, BoatProfile* out,
                      std::string* error);

// Built-in default matching config/boat_profile.json (used when the file is
// absent, and by tests).
BoatProfile defaultBoatProfile();

}  // namespace simc
