// Integration tests: full closed-loop simulation. These encode the four
// Milestone-1 acceptance scenarios (A-D) plus the fail-safe scenarios as
// executable requirements.

#include <cmath>
#include <cstring>
#include <string>

#include "framework.h"
#include "simc/scenario.h"
#include "simc/simulation.h"

using simc::allScenarios;
using simc::findScenario;
using simc::Scenario;
using simc::Simulation;
using simc::TickResult;

namespace {

sh::ControlConfig defaultConfig() {
    sh::ControlConfig cfg;
    cfg.motor_max_power_w = simc::defaultBoatProfile().motor_max_power_w;
    return cfg;
}

std::vector<TickResult> runByName(const char* name) {
    const Scenario* sc = findScenario(name);
    CHECK(sc != nullptr);
    const simc::BoatProfile profile = simc::defaultBoatProfile();
    const sh::ControlConfig cfg = defaultConfig();
    Simulation sim(profile, *sc, cfg);
    return sim.run();
}

}  // namespace

TEST(registry_lists_all_scenarios_and_finds_by_name) {
    CHECK(allScenarios().size() >= 13);
    CHECK(findScenario("DemoA_SolarSwing") != nullptr);
    CHECK(findScenario("NoSuchScenario") == nullptr);
    for (const Scenario& s : allScenarios()) {
        CHECK(std::strlen(s.name) > 0);
        CHECK(std::strlen(s.description) > 0);
        CHECK(s.duration_s > 0.0f);
        CHECK(s.dt_s > 0.0f);
    }
}

TEST(scenario_a_battery_power_tracks_zero_through_solar_swings) {
    const std::vector<TickResult> r = runByName("DemoA_SolarSwing");
    // After the initial ramp-in (first third), battery power stays near 0
    // whenever the motor is not saturated at 100%.
    float worst_underrun = 0.0f;
    double sum = 0.0;
    int n = 0;
    for (size_t i = r.size() / 3; i < r.size(); ++i) {
        if (r[i].telemetry.motor_command_pct < 99.0f) {
            sum += r[i].battery_true_w;
            ++n;
            if (r[i].battery_true_w < worst_underrun) {
                worst_underrun = r[i].battery_true_w;
            }
        }
        CHECK(r[i].auto_active);
    }
    CHECK(n > 100);
    const double mean = sum / n;
    CHECK(std::fabs(mean) < 50.0);       // long-run average close to 0 W
    CHECK(worst_underrun > -200.0);      // transient dips stay modest
}

TEST(scenario_b_sudden_drop_ramps_down_within_limits) {
    const std::vector<TickResult> r = runByName("DemoB_SuddenSolarDrop");
    const sh::ControlConfig cfg = defaultConfig();
    const Scenario* sc = findScenario("DemoB_SuddenSolarDrop");
    float prev_cmd = 0.0f;
    bool first = true;
    for (const TickResult& t : r) {
        if (!first) {
            const float step = t.telemetry.motor_command_pct - prev_cmd;
            CHECK(step <= cfg.max_ramp_up_pct_per_s * sc->dt_s + 1e-3f);
            CHECK(-step <= cfg.max_ramp_down_pct_per_s * sc->dt_s + 1e-3f);
        }
        prev_cmd = t.telemetry.motor_command_pct;
        first = false;
    }
    // After the drop the command must have come down substantially.
    float cmd_before = 0.0f, cmd_after = 0.0f;
    for (const TickResult& t : r) {
        if (t.t_s < 899.0f) cmd_before = t.telemetry.motor_command_pct;
        cmd_after = t.telemetry.motor_command_pct;
    }
    CHECK(cmd_before > 50.0f);
    CHECK(cmd_after < cmd_before / 2.0f);
    // And the battery is not left heavily discharging at the end.
    CHECK(r.back().battery_true_w > -60.0f);
}

TEST(scenario_c_solar_rise_no_overshoot) {
    const std::vector<TickResult> r = runByName("DemoC_SolarRise");
    // Final command = steady state; the peak along the way must not
    // meaningfully exceed it (tracking anti-windup at the rate limiter).
    float peak = 0.0f;
    for (const TickResult& t : r) {
        if (t.telemetry.motor_command_pct > peak) {
            peak = t.telemetry.motor_command_pct;
        }
    }
    const float final_cmd = r.back().telemetry.motor_command_pct;
    CHECK(final_cmd > 60.0f);          // it did spin up
    CHECK(peak - final_cmd < 1.5f);    // < 1.5 %-points overshoot
}

TEST(scenario_d_reserve_soc_is_respected) {
    const std::vector<TickResult> r = runByName("DemoD_ReserveFloor");
    const sh::ControlConfig cfg = defaultConfig();
    float min_soc = 100.0f;
    for (const TickResult& t : r) {
        if (t.soc_true_pct < min_soc) {
            min_soc = t.soc_true_pct;
        }
    }
    // Small controlled dip while the floor engages, never a deep drain.
    CHECK(min_soc > cfg.reserve_soc_pct - 0.5f);
    // Once settled at the floor, battery power sits at/above ~0 W and the
    // reserve flag is raised while SOC hovers at the floor (it may blink
    // off on ticks where charging nudged SOC just above the line).
    const TickResult& last = r.back();
    CHECK(last.battery_true_w > -5.0f);
    bool reserve_flag_seen = false;
    for (size_t i = r.size() * 3 / 4; i < r.size(); ++i) {
        if ((r[i].telemetry.fault_flags & sh::kFaultSocAtReserve) != 0) {
            reserve_flag_seen = true;
        }
    }
    CHECK(reserve_flag_seen);
    CHECK(last.auto_active);  // it holds position, it does not abort
}

TEST(scenario_shunt_failure_forces_manual_zero_throttle) {
    const std::vector<TickResult> r = runByName("ShuntFailure");
    bool was_auto = false;
    for (const TickResult& t : r) {
        if (t.t_s < 890.0f && t.auto_active) {
            was_auto = true;
        }
    }
    CHECK(was_auto);
    const TickResult& last = r.back();
    CHECK(!last.auto_active);
    CHECK_NEAR(last.telemetry.motor_command_pct, 0.0f, 1e-6);
    CHECK_NEAR(last.motor_true_w, 0.0f, 1e-6);
    CHECK((last.telemetry.fault_flags & sh::kFaultBatteryStale) != 0);
}

TEST(scenario_gps_failure_keeps_cruising) {
    const std::vector<TickResult> r = runByName("GPSFailure");
    const TickResult& last = r.back();
    CHECK(last.auto_active);  // GPS is not control-critical
    CHECK((last.telemetry.fault_flags & sh::kFaultGpsStale) != 0);
    // Distance stops accumulating after the failure.
    float dist_at_fail = 0.0f, dist_end = 0.0f;
    for (const TickResult& t : r) {
        if (t.t_s < 905.0f) dist_at_fail = t.telemetry.distance_today_km;
        dist_end = t.telemetry.distance_today_km;
    }
    CHECK_NEAR(dist_end, dist_at_fail, 1e-4);
}

TEST(scenario_sensor_failure_solar_telemetry_only) {
    const std::vector<TickResult> r = runByName("SensorFailure");
    const TickResult& last = r.back();
    CHECK(last.auto_active);  // MPPT telemetry loss must not stop the cruise
    CHECK_NEAR(last.telemetry.solar_power_w, 0.0f, 1e-6);  // stale reads as 0
    CHECK((last.telemetry.fault_flags & sh::kFaultSolarStale) != 0);
    CHECK(last.motor_true_w > 0.0f);  // but the boat keeps moving
}

TEST(scenario_croatia_day_produces_sane_energy_numbers) {
    const std::vector<TickResult> r = runByName("CroatiaClearSummerDay");
    const TickResult& last = r.back();
    // A 780 Wp-effective clear day: several kWh harvested, tens of km made.
    CHECK(last.telemetry.energy_solar_today_wh > 4000.0f);
    CHECK(last.telemetry.energy_solar_today_wh < 9000.0f);
    CHECK(last.telemetry.distance_today_km > 15.0f);
    CHECK(last.telemetry.efficiency_wh_km > 50.0f);
    CHECK(last.telemetry.efficiency_wh_km < 300.0f);
    // SOC ends close to where it started: solar paid for the cruising, and
    // only the dark-hours hotel load (2 h x 60 W ~ 4.7% SOC) plus deadband
    // drift came out of the battery.
    CHECK(last.soc_true_pct > 52.0f);
}

TEST(scenario_events_cover_remaining_types) {
    // Custom scenario: exercises restore + explicit mode-request events.
    Scenario s;
    s.name = "EventKitchenSink";
    s.description = "all event types";
    s.duration_s = 400.0f;
    s.dt_s = 0.5f;
    s.solar.waveform = simc::SolarWaveform::kConstant;
    s.solar.peak_w = 800.0f;
    s.events.push_back({50.0f, simc::EventType::kFailShunt, 0.0f});
    s.events.push_back({60.0f, simc::EventType::kRestoreShunt, 0.0f});
    s.events.push_back({80.0f, simc::EventType::kRequestSolarPlus, 0.0f});
    s.events.push_back({120.0f, simc::EventType::kRequestManual, 0.0f});
    s.events.push_back({150.0f, simc::EventType::kRequestSolar, 0.0f});
    s.events.push_back({200.0f, simc::EventType::kFailGps, 0.0f});
    s.events.push_back({250.0f, simc::EventType::kRestoreGps, 0.0f});
    s.events.push_back({300.0f, simc::EventType::kSetCloudFactor, 0.5f});

    const simc::BoatProfile profile = simc::defaultBoatProfile();
    const sh::ControlConfig cfg = defaultConfig();
    Simulation sim(profile, s, cfg);
    const std::vector<TickResult> r = sim.run();

    // Mode request events took effect.
    bool saw_solar_plus = false, saw_manual_mid = false, saw_solar_again = false;
    for (const TickResult& t : r) {
        const sh::Mode m = static_cast<sh::Mode>(t.telemetry.mode);
        if (t.t_s > 85.0f && t.t_s < 115.0f && m == sh::Mode::kSolarPlus) {
            saw_solar_plus = true;
        }
        if (t.t_s > 125.0f && t.t_s < 145.0f && m == sh::Mode::kManual) {
            saw_manual_mid = true;
        }
        if (t.t_s > 160.0f && m == sh::Mode::kSolar) {
            saw_solar_again = true;
        }
    }
    CHECK(saw_solar_plus);
    CHECK(saw_manual_mid);
    CHECK(saw_solar_again);
    // GPS restored: distance accumulates again at the end.
    CHECK(r.back().telemetry.distance_today_km > 0.0f);
    // Transition log recorded the forced/requested mode changes.
    CHECK(sim.log().entries.size() >= 3);
    CHECK(sim.helm().mode() == sh::Mode::kSolar);
}

TEST(scenario_range_cruise_holds_the_configured_power) {
    const std::vector<TickResult> r = runByName("RangeCruise");
    // Settled portion: the motor holds the configured RANGE power
    // (default 350 W of 1164 W -> ~30%) without any streamed target.
    const TickResult& last = r.back();
    CHECK(static_cast<sh::Mode>(last.telemetry.mode) == sh::Mode::kRange);
    CHECK_NEAR(last.telemetry.motor_estimated_power_w, 350.0f, 15.0f);
    CHECK(last.telemetry.distance_today_km > 1.0f);
}

TEST(scenario_arrival_budget_streams_then_degrades) {
    const std::vector<TickResult> r = runByName("ArrivalBudget");
    bool saw_arrival = false;
    bool saw_stale_fault = false;
    for (const TickResult& t : r) {
        const sh::Mode m = static_cast<sh::Mode>(t.telemetry.mode);
        if (t.t_s > 700.0f && t.t_s < 1700.0f && m == sh::Mode::kArrival) {
            saw_arrival = true;
        }
        if ((t.telemetry.fault_flags & sh::kFaultArrivalStale) != 0) {
            saw_stale_fault = true;
        }
    }
    CHECK(saw_arrival);
    CHECK(saw_stale_fault);
    // After the phone went quiet the boat cruises on in SOLAR.
    CHECK(static_cast<sh::Mode>(r.back().telemetry.mode) == sh::Mode::kSolar);
}

TEST(scenario_events_cover_range_and_arrival_requests) {
    Scenario s;
    s.name = "ModeEventKitchenSink";
    s.description = "range/arrival event coverage";
    s.duration_s = 300.0f;
    s.dt_s = 0.5f;
    s.solar.waveform = simc::SolarWaveform::kConstant;
    s.solar.peak_w = 600.0f;
    s.events.push_back({50.0f, simc::EventType::kRequestRange, 0.0f});
    s.events.push_back({100.0f, simc::EventType::kSetArrivalBudget, -100.0f});
    s.events.push_back({100.0f, simc::EventType::kRequestArrival, 0.0f});
    s.events.push_back({200.0f, simc::EventType::kStopArrivalStream, 0.0f});

    const simc::BoatProfile profile = simc::defaultBoatProfile();
    const sh::ControlConfig cfg = defaultConfig();
    Simulation sim(profile, s, cfg);
    const std::vector<TickResult> r = sim.run();

    bool saw_range = false;
    for (const TickResult& t : r) {
        const sh::Mode m = static_cast<sh::Mode>(t.telemetry.mode);
        if (t.t_s > 55.0f && t.t_s < 95.0f && m == sh::Mode::kRange) {
            saw_range = true;
        }
    }
    CHECK(saw_range);
    // Stream stopped at 200 s; by the end (10 s+ later) ARRIVAL degraded.
    CHECK(sim.helm().mode() == sh::Mode::kSolar);
}

TEST(simulation_is_deterministic) {
    const Scenario* sc = findScenario("CroatiaPassingClouds");
    CHECK(sc != nullptr);
    const simc::BoatProfile profile = simc::defaultBoatProfile();
    const sh::ControlConfig cfg = defaultConfig();
    Simulation a(profile, *sc, cfg);
    Simulation b(profile, *sc, cfg);
    for (int i = 0; i < 2000; ++i) {
        const TickResult ra = a.step();
        const TickResult rb = b.step();
        CHECK_NEAR(ra.battery_true_w, rb.battery_true_w, 1e-9);
        CHECK_NEAR(ra.telemetry.motor_command_pct,
                   rb.telemetry.motor_command_pct, 1e-9);
    }
}

TEST_MAIN()
