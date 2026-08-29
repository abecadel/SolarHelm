// Simulation — the closed loop: models + simulated drivers + the REAL
// SolarHelm core (sh::Helm), stepped deterministically.
//
// Exactly the code that will run on the ESP32 makes every control decision
// here; the harness only replaces hardware with models. Tests drive
// Simulation directly; the sim CLI streams each tick to CSV.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "sh/core/helm.h"
#include "simc/battery_model.h"
#include "simc/boat_profile.h"
#include "simc/hull_model.h"
#include "simc/scenario.h"
#include "simc/sim_drivers.h"
#include "simc/solar_model.h"

namespace simc {

// One tick of ground truth + what the controller saw/did.
struct TickResult {
    float t_s = 0.0f;
    sh::TelemetryRecord telemetry;   // what SolarHelm reports
    // Simulation ground truth (the telemetry may lag or be blind to these):
    float pv_available_w = 0.0f;
    float pv_used_w = 0.0f;
    float motor_true_w = 0.0f;
    float hotel_true_w = 0.0f;
    float battery_true_w = 0.0f;
    float soc_true_pct = 0.0f;
    float speed_true_kmh = 0.0f;
    bool auto_active = false;
};

// Captures mode transitions for logs/tests.
class RecordingLogger : public sh::ITransitionLogger {
public:
    struct Entry {
        uint32_t t_ms;
        sh::Mode from;
        sh::Mode to;
        std::string reason;
    };
    void onModeChange(uint32_t t_ms, sh::Mode from, sh::Mode to,
                      const char* reason) override {
        entries.push_back({t_ms, from, to, reason});
    }
    std::vector<Entry> entries;
};

class Simulation {
public:
    Simulation(const BoatProfile& profile, const Scenario& scenario,
               const sh::ControlConfig& config);

    // Advance one tick; returns the tick's result.
    TickResult step();

    // True while t < scenario duration.
    bool running() const { return t_s_ < scenario_.duration_s; }

    // Run to completion, collecting every tick.
    std::vector<TickResult> run();

    const RecordingLogger& log() const { return logger_; }
    const sh::Helm& helm() const { return helm_; }

private:
    void applyDueEvents();

    const BoatProfile& profile_;
    const Scenario& scenario_;
    RecordingLogger logger_;
    sh::Helm helm_;
    SolarModel solar_;
    BatteryModel battery_;
    HullModel hull_;
    SimulatedShunt shunt_;
    SimulatedSolarMonitor solar_mon_;
    SimulatedGps gps_;
    SimulatorThrottle throttle_;

    float t_s_ = 0.0f;
    size_t next_event_ = 0;
    float hotel_w_;
    float motor_cmd_pct_ = 0.0f;  // command applied next tick (actuation lag)
    bool auto_requested_ = false;
    double lat_deg_ = 43.5081;   // Split, Croatia
    double lon_deg_ = 16.4402;
};

}  // namespace simc
