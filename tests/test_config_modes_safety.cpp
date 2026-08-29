// Unit tests: ControlConfig validation, ModeManager rules, SafetySupervisor.

#include <string>
#include <vector>

#include "framework.h"
#include "sh/control/mode_manager.h"
#include "sh/core/config.h"
#include "sh/safety/supervisor.h"

using sh::ConfigError;
using sh::ControlConfig;
using sh::Mode;
using sh::ModeManager;
using sh::SafetySupervisor;
using sh::SafetyVerdict;

TEST(config_default_is_valid) {
    ControlConfig cfg;
    CHECK(cfg.validate() == ConfigError::kNone);
}

TEST(config_rejects_every_bad_field) {
    struct Case {
        void (*mutate)(ControlConfig&);
        ConfigError expected;
    };
    const std::vector<Case> cases = {
        {[](ControlConfig& c) { c.schema_version = 999; },
         ConfigError::kBadSchemaVersion},
        {[](ControlConfig& c) { c.kp_pct_per_w = 0.0f; },
         ConfigError::kBadGains},
        {[](ControlConfig& c) { c.ki_pct_per_ws = -1.0f; },
         ConfigError::kBadGains},
        {[](ControlConfig& c) { c.deadband_w = -1.0f; },
         ConfigError::kBadDeadband},
        {[](ControlConfig& c) { c.filter_time_constant_s = -1.0f; },
         ConfigError::kBadFilter},
        {[](ControlConfig& c) { c.max_ramp_up_pct_per_s = 0.0f; },
         ConfigError::kBadRampRates},
        {[](ControlConfig& c) { c.max_ramp_down_pct_per_s = -2.0f; },
         ConfigError::kBadRampRates},
        {[](ControlConfig& c) { c.min_motor_cmd_pct = -5.0f; },
         ConfigError::kBadCommandLimits},
        {[](ControlConfig& c) { c.max_motor_cmd_pct = 150.0f; },
         ConfigError::kBadCommandLimits},
        {[](ControlConfig& c) {
             c.min_motor_cmd_pct = 60.0f;
             c.max_motor_cmd_pct = 50.0f;
         },
         ConfigError::kBadCommandLimits},
        {[](ControlConfig& c) { c.reserve_soc_pct = -1.0f; },
         ConfigError::kBadReserveSoc},
        {[](ControlConfig& c) { c.reserve_soc_pct = 101.0f; },
         ConfigError::kBadReserveSoc},
        {[](ControlConfig& c) { c.reserve_hysteresis_pct = -1.0f; },
         ConfigError::kBadReserveSoc},
        {[](ControlConfig& c) { c.reserve_hysteresis_pct = 30.0f; },
         ConfigError::kBadReserveSoc},
        {[](ControlConfig& c) { c.solar_plus_target_w = 100.0f; },
         ConfigError::kBadSolarPlusTarget},
        {[](ControlConfig& c) { c.solar_plus_target_w = -9000.0f; },
         ConfigError::kBadSolarPlusTarget},
        {[](ControlConfig& c) { c.battery_timeout_ms = 0; },
         ConfigError::kBadTimeouts},
        {[](ControlConfig& c) { c.gps_timeout_ms = 0; },
         ConfigError::kBadTimeouts},
        {[](ControlConfig& c) { c.solar_timeout_ms = 0; },
         ConfigError::kBadTimeouts},
        {[](ControlConfig& c) { c.motor_max_power_w = 0.0f; },
         ConfigError::kBadMotorPower},
        {[](ControlConfig& c) { c.remote_timeout_ms = 0; },
         ConfigError::kBadTimeouts},
        {[](ControlConfig& c) { c.sag_stop_v = c.sag_hard_v; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.sag_hard_v = c.sag_soft_v; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.sag_release_margin_v = -1.0f; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.sag_debounce_s = -1.0f; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.sag_hard_cap_pct = 0.0f; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.sag_soft_cap_pct = c.sag_hard_cap_pct - 1; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.sag_soft_cap_pct = 101.0f; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.max_discharge_current_a = 0.0f; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.current_debounce_s = -1.0f; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.batt_cold_derate_c = 50.0f; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.batt_hot_derate_c = 70.0f; },
         ConfigError::kBadBatteryGuard},
        {[](ControlConfig& c) { c.temp_derate_cap_pct = 0.0f; },
         ConfigError::kBadBatteryGuard},
    };
    for (const Case& c : cases) {
        ControlConfig cfg;
        c.mutate(cfg);
        CHECK(cfg.validate() == c.expected);
    }
}

TEST(config_error_names_are_distinct) {
    const ConfigError all[] = {
        ConfigError::kNone,          ConfigError::kBadSchemaVersion,
        ConfigError::kBadGains,      ConfigError::kBadDeadband,
        ConfigError::kBadFilter,     ConfigError::kBadRampRates,
        ConfigError::kBadCommandLimits, ConfigError::kBadReserveSoc,
        ConfigError::kBadSolarPlusTarget, ConfigError::kBadTimeouts,
        ConfigError::kBadMotorPower, ConfigError::kBadBatteryGuard,
    };
    std::vector<std::string> names;
    for (ConfigError e : all) {
        names.push_back(sh::configErrorName(e));
    }
    for (size_t i = 0; i < names.size(); ++i) {
        for (size_t j = i + 1; j < names.size(); ++j) {
            CHECK(names[i] != names[j]);
        }
    }
    CHECK(std::string(sh::configErrorName(static_cast<ConfigError>(200))) ==
          "unknown");
}

namespace {

struct CapturingLogger : sh::ITransitionLogger {
    struct Entry {
        Mode from;
        Mode to;
        std::string reason;
    };
    std::vector<Entry> entries;
    void onModeChange(uint32_t, Mode from, Mode to,
                      const char* reason) override {
        entries.push_back({from, to, reason});
    }
};

}  // namespace

TEST(mode_names) {
    CHECK(std::string(sh::modeName(Mode::kManual)) == "MANUAL");
    CHECK(std::string(sh::modeName(Mode::kSolar)) == "SOLAR");
    CHECK(std::string(sh::modeName(Mode::kSolarPlus)) == "SOLAR+");
    CHECK(std::string(sh::modeName(Mode::kRemote)) == "REMOTE");
    CHECK(std::string(sh::modeName(static_cast<Mode>(99))) == "UNKNOWN");
}

TEST(mode_degrade_between_auto_modes_only) {
    ControlConfig cfg;
    CapturingLogger log;
    ModeManager mm(cfg, &log);
    // From MANUAL: degrade is a no-op (never escalates).
    mm.degrade(Mode::kSolar, "x", 0);
    CHECK(mm.mode() == Mode::kManual);
    // From REMOTE to SOLAR: allowed and logged with its reason.
    mm.requestMode(Mode::kRemote, true, 10);
    mm.degrade(Mode::kSolar, "remote_stale", 20);
    CHECK(mm.mode() == Mode::kSolar);
    CHECK(log.entries.back().reason == "remote_stale");
    // Degrading to MANUAL is refused (that's forceManual's job).
    mm.degrade(Mode::kManual, "x", 30);
    CHECK(mm.mode() == Mode::kSolar);
}

TEST(mode_boot_is_manual_and_auto_needs_health) {
    ControlConfig cfg;
    CapturingLogger log;
    ModeManager mm(cfg, &log);
    CHECK(mm.mode() == Mode::kManual);
    CHECK(!mm.isAutomatic());
    // Unhealthy: refused, stays MANUAL.
    CHECK(!mm.requestMode(Mode::kSolar, false, 100));
    CHECK(mm.mode() == Mode::kManual);
    // Healthy: granted and logged.
    CHECK(mm.requestMode(Mode::kSolar, true, 200));
    CHECK(mm.mode() == Mode::kSolar);
    CHECK(mm.isAutomatic());
    CHECK(log.entries.size() == 1);
    CHECK(log.entries[0].from == Mode::kManual);
    CHECK(log.entries[0].to == Mode::kSolar);
}

TEST(mode_same_mode_request_is_noop) {
    ControlConfig cfg;
    CapturingLogger log;
    ModeManager mm(cfg, &log);
    CHECK(mm.requestMode(Mode::kManual, false, 0));  // manual is always OK
    CHECK(log.entries.empty());  // no transition logged for same mode
}

TEST(mode_force_manual_logs_reason) {
    ControlConfig cfg;
    CapturingLogger log;
    ModeManager mm(cfg, &log);
    mm.requestMode(Mode::kSolarPlus, true, 10);
    mm.forceManual("sensor_loss", 20);
    CHECK(mm.mode() == Mode::kManual);
    CHECK(log.entries.size() == 2);
    CHECK(log.entries[1].reason == "sensor_loss");
}

TEST(mode_null_logger_is_safe) {
    ControlConfig cfg;
    ModeManager mm(cfg, nullptr);
    CHECK(mm.requestMode(Mode::kSolar, true, 0));
    mm.forceManual("x", 1);
    CHECK(mm.mode() == Mode::kManual);
}

TEST(mode_targets_solar_and_solar_plus) {
    ControlConfig cfg;
    ModeManager mm(cfg, nullptr);
    mm.requestMode(Mode::kSolar, true, 0);
    CHECK_NEAR(mm.targetBatteryPower(80.0f), 0.0f, 1e-6);
    mm.requestMode(Mode::kSolarPlus, true, 0);
    CHECK_NEAR(mm.targetBatteryPower(80.0f), cfg.solar_plus_target_w, 1e-6);
}

TEST(mode_reserve_floor_clamps_target_with_hysteresis) {
    ControlConfig cfg;  // reserve 20%, hysteresis 2%, deadband 25 W
    ModeManager mm(cfg, nullptr);
    mm.requestMode(Mode::kSolarPlus, true, 0);
    // Above reserve: SOLAR+ target passes through, latch off.
    CHECK_NEAR(mm.targetBatteryPower(20.1f), cfg.solar_plus_target_w, 1e-6);
    CHECK(!mm.reserveActive());
    // Touching reserve: floored to +deadband so the deadband rest point
    // can never leak battery energy.
    CHECK_NEAR(mm.targetBatteryPower(20.0f), cfg.deadband_w, 1e-6);
    CHECK(mm.reserveActive());
    CHECK_NEAR(mm.targetBatteryPower(5.0f), cfg.deadband_w, 1e-6);
    // Hovering just above reserve: the latch HOLDS (no chatter).
    CHECK_NEAR(mm.targetBatteryPower(20.5f), cfg.deadband_w, 1e-6);
    CHECK(mm.reserveActive());
    // Recovered past reserve + hysteresis: released.
    CHECK_NEAR(mm.targetBatteryPower(22.0f), cfg.solar_plus_target_w, 1e-6);
    CHECK(!mm.reserveActive());
    // SOLAR at reserve gets the same floor.
    mm.requestMode(Mode::kSolar, true, 0);
    CHECK_NEAR(mm.targetBatteryPower(19.0f), cfg.deadband_w, 1e-6);
    CHECK(mm.reserveActive());
}

TEST(safety_battery_plausibility) {
    sh::BatterySample s;
    s.valid = true;
    s.voltage_v = 25.0f;
    s.soc_pct = 50.0f;
    s.current_a = 10.0f;
    CHECK(SafetySupervisor::batteryPlausible(s));
    s.soc_pct = -1.0f;
    CHECK(!SafetySupervisor::batteryPlausible(s));
    s.soc_pct = 101.0f;
    CHECK(!SafetySupervisor::batteryPlausible(s));
    s.soc_pct = 50.0f;
    s.voltage_v = 5.0f;
    CHECK(!SafetySupervisor::batteryPlausible(s));
    s.voltage_v = 71.0f;
    CHECK(!SafetySupervisor::batteryPlausible(s));
    s.voltage_v = 25.0f;
    s.current_a = -1001.0f;
    CHECK(!SafetySupervisor::batteryPlausible(s));
    s.current_a = 1001.0f;
    CHECK(!SafetySupervisor::batteryPlausible(s));
}

TEST(safety_verdicts) {
    ControlConfig cfg;
    SafetySupervisor sup(cfg);

    sh::BatterySample batt;
    batt.valid = true;
    batt.timestamp_ms = 10000;
    batt.voltage_v = 25.0f;
    batt.soc_pct = 60.0f;
    sh::GpsSample gps;
    gps.valid = true;
    gps.timestamp_ms = 10000;
    sh::SolarSample sol;
    sol.valid = true;
    sol.timestamp_ms = 10000;
    sol.power_w = 500.0f;

    // Everything fresh.
    SafetyVerdict v = sup.evaluate(10500, batt, sol, gps);
    CHECK(v.allow_auto);
    CHECK(v.battery_ok);
    CHECK(v.gps_ok);
    CHECK(v.solar_ok);
    CHECK(v.faults == 0);

    // Battery stale.
    v = sup.evaluate(10000 + cfg.battery_timeout_ms + 1, batt, sol, gps);
    CHECK(!v.allow_auto);
    CHECK((v.faults & sh::kFaultBatteryStale) != 0);

    // Battery never seen.
    sh::BatterySample none;
    v = sup.evaluate(10500, none, sol, gps);
    CHECK(!v.allow_auto);
    CHECK((v.faults & sh::kFaultBatteryStale) != 0);

    // Battery fresh but implausible.
    sh::BatterySample bad = batt;
    bad.soc_pct = 500.0f;
    v = sup.evaluate(10500, bad, sol, gps);
    CHECK(!v.allow_auto);
    CHECK((v.faults & sh::kFaultBatteryImplausible) != 0);

    // GPS stale: auto still allowed, flag raised.
    sh::GpsSample old_gps = gps;
    old_gps.timestamp_ms = 1;
    v = sup.evaluate(10500, batt, sol, old_gps);
    CHECK(v.allow_auto);
    CHECK(!v.gps_ok);
    CHECK((v.faults & sh::kFaultGpsStale) != 0);

    // Solar telemetry stale: auto still allowed, flag raised.
    sh::SolarSample old_sol = sol;
    old_sol.timestamp_ms = 1;
    v = sup.evaluate(10500, batt, old_sol, gps);
    CHECK(v.allow_auto);
    CHECK(!v.solar_ok);
    CHECK((v.faults & sh::kFaultSolarStale) != 0);
    // Solar never seen at all.
    sh::SolarSample no_sol;
    v = sup.evaluate(10500, batt, no_sol, gps);
    CHECK(!v.solar_ok);
}

TEST_MAIN()
