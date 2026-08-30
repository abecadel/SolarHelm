#include "simc/scenario.h"

#include <cstring>

namespace simc {

namespace {

std::vector<Scenario> buildScenarios() {
    std::vector<Scenario> list;

    {
        Scenario s;
        s.name = "DemoA_SolarSwing";
        s.description =
            "Solar oscillates 300-1500 W; battery power must hold ~0 W";
        s.duration_s = 3600.0f;
        s.solar.waveform = SolarWaveform::kSwing;
        s.solar.swing_mean_w = 900.0f;
        s.solar.swing_amplitude_w = 600.0f;
        s.solar.swing_period_s = 600.0f;
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "DemoB_SuddenSolarDrop";
        s.description = "Solar collapses by 80%; motor ramps down safely";
        s.duration_s = 1800.0f;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 1200.0f;
        s.events.push_back({900.0f, EventType::kSetPvScale, 0.2f});
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "DemoC_SolarRise";
        s.description = "Solar jumps 300->1000 W; motor rises gradually, "
                        "no overshoot";
        s.duration_s = 1800.0f;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 1000.0f;
        s.events.push_back({0.0f, EventType::kSetPvScale, 0.3f});
        s.events.push_back({900.0f, EventType::kSetPvScale, 1.0f});
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "DemoD_ReserveFloor";
        s.description = "SOLAR+ drains to reserve SOC; SolarHelm then "
                        "refuses further battery energy";
        s.duration_s = 5400.0f;
        s.start_soc_pct = 20.6f;
        s.auto_request_mode = sh::Mode::kSolarPlus;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 500.0f;
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "CroatiaClearSummerDay";
        s.description = "Full clear day, 06:00-20:00 sun arc";
        s.duration_s = 16.0f * 3600.0f;
        s.start_time_of_day_s = 5.0f * 3600.0f;
        s.dt_s = 2.0f;
        s.start_soc_pct = 60.0f;
        s.solar.waveform = SolarWaveform::kDayArc;
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "CroatiaPassingClouds";
        s.description = "Clear day with a deterministic random cloud walk";
        s.duration_s = 16.0f * 3600.0f;
        s.start_time_of_day_s = 5.0f * 3600.0f;
        s.dt_s = 2.0f;
        s.start_soc_pct = 60.0f;
        s.solar.waveform = SolarWaveform::kDayArc;
        s.solar.random_clouds = true;
        s.solar.cloud_seed = 42;
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "CloudyDay";
        s.description = "Overcast day at ~30% irradiance";
        s.duration_s = 16.0f * 3600.0f;
        s.start_time_of_day_s = 5.0f * 3600.0f;
        s.dt_s = 2.0f;
        s.start_soc_pct = 70.0f;
        s.solar.waveform = SolarWaveform::kDayArc;
        s.events.push_back({0.0f, EventType::kSetCloudFactor, 0.3f});
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "LowBatteryMorning";
        s.description = "Morning start at 25% SOC near the reserve";
        s.duration_s = 6.0f * 3600.0f;
        s.start_time_of_day_s = 7.0f * 3600.0f;
        s.dt_s = 2.0f;
        s.start_soc_pct = 25.0f;
        s.solar.waveform = SolarWaveform::kDayArc;
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "SuddenSolarLoss";
        s.description = "Total PV loss mid-cruise (wiring/MPPT failure)";
        s.duration_s = 1800.0f;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 1000.0f;
        s.events.push_back({900.0f, EventType::kSetPvScale, 0.0f});
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "HeavyHotelLoad";
        s.description = "Fridge + electronics: 300 W hotel load all day";
        s.duration_s = 3600.0f;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 900.0f;
        s.events.push_back({0.0f, EventType::kSetHotelLoadW, 300.0f});
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "SensorFailure";
        s.description = "MPPT telemetry dies; control continues on the shunt";
        s.duration_s = 1800.0f;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 1000.0f;
        s.events.push_back({900.0f, EventType::kFailSolarMon, 0.0f});
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "GPSFailure";
        s.description = "GPS lost; cruise continues, efficiency data pauses";
        s.duration_s = 1800.0f;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 1000.0f;
        s.events.push_back({900.0f, EventType::kFailGps, 0.0f});
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "ShuntFailure";
        s.description =
            "Battery monitor dies mid-cruise; SolarHelm must drop to MANUAL "
            "with zero automatic throttle";
        s.duration_s = 1800.0f;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 1000.0f;
        s.events.push_back({900.0f, EventType::kFailShunt, 0.0f});
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "RangeCruise";
        s.description =
            "RANGE holds the configured best-efficiency motor power all "
            "leg, no phone attached; the reserve floor still applies";
        s.duration_s = 5400.0f;
        s.start_soc_pct = 70.0f;
        s.auto_request_mode = sh::Mode::kRange;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 350.0f;
        list.push_back(s);
    }
    {
        Scenario s;
        s.name = "ArrivalBudget";
        s.description =
            "Phone streams a -150 W arrival battery budget, then goes "
            "quiet mid-leg: SolarHelm degrades to SOLAR on its own";
        s.duration_s = 3600.0f;
        s.start_soc_pct = 80.0f;
        s.solar.waveform = SolarWaveform::kConstant;
        s.solar.peak_w = 300.0f;
        // Budget first, then the mode request in the same tick (a fresh
        // stream is required to enter ARRIVAL).
        s.events.push_back({600.0f, EventType::kSetArrivalBudget, -150.0f});
        s.events.push_back({600.0f, EventType::kRequestArrival, 0.0f});
        s.events.push_back({1800.0f, EventType::kStopArrivalStream, 0.0f});
        list.push_back(s);
    }
    return list;
}

}  // namespace

const std::vector<Scenario>& allScenarios() {
    static const std::vector<Scenario> scenarios = buildScenarios();
    return scenarios;
}

const Scenario* findScenario(const char* name) {
    for (const Scenario& s : allScenarios()) {
        if (std::strcmp(s.name, name) == 0) {
            return &s;
        }
    }
    return nullptr;
}

}  // namespace simc
