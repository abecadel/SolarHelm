// Scenario — a declarative description of one simulation run.
//
// A scenario is a solar waveform + initial conditions + a timed event list
// (cloud steps, PV collapses, sensor failures, mode/target requests, hotel
// load changes). Scenarios are fully deterministic; the registry below is
// the single list the CLI, the tests and the plotting pipeline share.

#pragma once

#include <cstdint>
#include <vector>

#include "sh/control/mode_manager.h"
#include "simc/solar_model.h"

namespace simc {

enum class EventType : uint8_t {
    kSetCloudFactor,   // value = transmission 0..1
    kSetPvScale,       // value = scale 0..1 (0.2 = "80% solar loss")
    kFailShunt,        // battery monitor stops updating
    kRestoreShunt,
    kFailSolarMon,     // MPPT telemetry stops updating
    kFailGps,
    kRestoreGps,
    kSetHotelLoadW,    // value = watts
    kRequestManual,
    kRequestSolar,
    kRequestSolarPlus,
    kRequestRange,
    kRequestArrival,
    kSetArrivalBudget,   // value = battery W; starts the phone budget stream
    kStopArrivalStream,  // phone goes quiet -> staleness degradation
};

struct Event {
    float t_s = 0.0f;
    EventType type = EventType::kSetCloudFactor;
    float value = 0.0f;
};

struct Scenario {
    const char* name = "";
    const char* description = "";
    float duration_s = 3600.0f;
    float dt_s = 0.5f;
    // Time-of-day at t=0, fed to the solar day-arc only (a scenario starting
    // at 05:00 sees sunrise one simulated hour in).
    float start_time_of_day_s = 0.0f;
    float start_soc_pct = 80.0f;
    float initial_hotel_w = -1.0f;  // <0: use boat profile's hotel load
    SolarModelParams solar;
    // Mode automatically requested once sensors are healthy (scenarios all
    // start in MANUAL, honouring the explicit-activation rule).
    sh::Mode auto_request_mode = sh::Mode::kSolar;
    std::vector<Event> events;
};

// All scenarios, demo (A-D) and robustness ones. Stable order.
const std::vector<Scenario>& allScenarios();

// nullptr when no scenario has that name.
const Scenario* findScenario(const char* name);

}  // namespace simc
