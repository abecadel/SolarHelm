// Unit tests: EnergyTracker, telemetry CSV, and the Helm orchestrator.

#include <cstring>
#include <string>

#include "framework.h"
#include "sh/core/helm.h"
#include "sh/energy/tracker.h"
#include "sh/telemetry/telemetry.h"

using sh::ControlConfig;
using sh::EnergyTracker;
using sh::Helm;
using sh::Mode;
using sh::TelemetryRecord;

TEST(energy_integration_and_efficiency) {
    EnergyTracker e;
    // 1 hour at 600 W motor, 800 W solar, 60 W hotel, 1.5 m/s.
    for (int i = 0; i < 3600; ++i) {
        e.update(1.0f, 800.0f, 600.0f, 60.0f, 1.5f, true);
    }
    CHECK_NEAR(e.energySolarWh(), 800.0f, 1.0);
    CHECK_NEAR(e.energyMotorWh(), 600.0f, 1.0);
    CHECK_NEAR(e.energyHotelWh(), 60.0f, 0.5);
    CHECK_NEAR(e.distanceKm(), 5.4f, 0.01);
    CHECK_NEAR(e.efficiencyWhPerKm(), 600.0f / 5.4f, 1.0);
}

TEST(energy_efficiency_guard_before_min_distance) {
    EnergyTracker e;
    e.update(10.0f, 0.0f, 500.0f, 0.0f, 0.1f, true);  // 1 m travelled
    CHECK_NEAR(e.efficiencyWhPerKm(), 0.0f, 1e-6);
}

TEST(energy_invalid_or_zero_speed_adds_no_distance) {
    EnergyTracker e;
    e.update(100.0f, 0.0f, 0.0f, 0.0f, 2.0f, false);  // invalid GPS
    e.update(100.0f, 0.0f, 0.0f, 0.0f, 0.0f, true);   // moored
    e.update(100.0f, 0.0f, 0.0f, 0.0f, -1.0f, true);  // nonsense speed
    CHECK_NEAR(e.distanceKm(), 0.0f, 1e-6);
}

TEST(energy_reset_clears_counters) {
    EnergyTracker e;
    e.update(3600.0f, 100.0f, 100.0f, 100.0f, 1.0f, true);
    e.reset();
    CHECK_NEAR(e.energySolarWh(), 0.0f, 1e-6);
    CHECK_NEAR(e.energyMotorWh(), 0.0f, 1e-6);
    CHECK_NEAR(e.energyHotelWh(), 0.0f, 1e-6);
    CHECK_NEAR(e.distanceKm(), 0.0f, 1e-6);
}

TEST(telemetry_header_and_row_agree_on_columns) {
    const std::string header = sh::telemetryCsvHeader();
    size_t header_cols = 1;
    for (char c : header) {
        if (c == ',') ++header_cols;
    }
    TelemetryRecord r;
    r.timestamp_ms = 1234;
    r.mode = 1;
    r.fault_flags = 5;
    char buf[512];
    const int n = sh::writeCsvRow(r, buf, sizeof(buf));
    CHECK(n > 0);
    CHECK(static_cast<size_t>(n) < sizeof(buf));
    size_t row_cols = 1;
    for (const char* p = buf; *p; ++p) {
        if (*p == ',') ++row_cols;
    }
    CHECK(header_cols == row_cols);
    CHECK(std::strncmp(buf, "1234,1,", 7) == 0);
}

TEST(telemetry_truncation_is_reported) {
    TelemetryRecord r;
    char tiny[8];
    const int n = sh::writeCsvRow(r, tiny, sizeof(tiny));
    CHECK(n >= static_cast<int>(sizeof(tiny)));  // snprintf-style truncation
}

namespace {

sh::BatterySample battSample(uint32_t t_ms, float power_w, float soc_pct) {
    sh::BatterySample s;
    s.valid = true;
    s.timestamp_ms = t_ms;
    s.voltage_v = 25.6f;
    s.current_a = power_w / 25.6f;
    s.power_w = power_w;
    s.soc_pct = soc_pct;
    return s;
}

sh::GpsSample gpsSample(uint32_t t_ms, float speed_mps) {
    sh::GpsSample g;
    g.valid = true;
    g.timestamp_ms = t_ms;
    g.speed_mps = speed_mps;
    return g;
}

sh::SolarSample solarSample(uint32_t t_ms, float power_w) {
    sh::SolarSample s;
    s.valid = true;
    s.timestamp_ms = t_ms;
    s.power_w = power_w;
    return s;
}

struct NullLogger : sh::ITransitionLogger {
    void onModeChange(uint32_t, Mode, Mode, const char*) override {}
};

}  // namespace

TEST(helm_boots_manual_and_requires_healthy_tick_before_auto) {
    ControlConfig cfg;
    NullLogger log;
    Helm helm(cfg, &log);
    CHECK(helm.mode() == Mode::kManual);
    CHECK(helm.configValid());
    // No healthy tick yet: auto refused.
    CHECK(!helm.requestMode(Mode::kSolar, 0));
    // One healthy tick.
    helm.step(1000, 0.5f, battSample(1000, 100.0f, 80.0f),
              solarSample(1000, 500.0f), gpsSample(1000, 1.0f));
    CHECK(helm.requestMode(Mode::kSolar, 1500));
    CHECK(helm.mode() == Mode::kSolar);
}

TEST(helm_auto_output_active_and_bounded) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    helm.step(1000, 0.5f, battSample(1000, 400.0f, 80.0f),
              solarSample(1000, 900.0f), gpsSample(1000, 1.0f));
    helm.requestMode(Mode::kSolar, 1000);
    uint32_t t = 1000;
    sh::HelmOutput out;
    for (int i = 0; i < 200; ++i) {
        t += 500;
        out = helm.step(t, 0.5f, battSample(t, 400.0f, 80.0f),
                        solarSample(t, 900.0f), gpsSample(t, 1.5f));
        CHECK(out.auto_active);
        CHECK(out.motor_cmd_pct >= cfg.min_motor_cmd_pct);
        CHECK(out.motor_cmd_pct <= cfg.max_motor_cmd_pct);
    }
    // Persistent +400 W surplus -> command should have grown.
    CHECK(out.motor_cmd_pct > 10.0f);
    CHECK(out.telemetry.mode == static_cast<uint8_t>(Mode::kSolar));
    CHECK(out.telemetry.speed_kmh > 5.0f);  // 1.5 m/s = 5.4 km/h
    CHECK(out.telemetry.motor_estimated_power_w > 0.0f);
}

TEST(helm_shunt_loss_forces_manual_with_zero_command) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 300.0f, 80.0f), solarSample(t, 800.0f),
              gpsSample(t, 1.0f));
    helm.requestMode(Mode::kSolar, t);
    for (int i = 0; i < 50; ++i) {
        t += 500;
        helm.step(t, 0.5f, battSample(t, 300.0f, 80.0f),
                  solarSample(t, 800.0f), gpsSample(t, 1.0f));
    }
    // Shunt stops updating: same last sample, time marches past timeout.
    const sh::BatterySample stale = battSample(t, 300.0f, 80.0f);
    t += cfg.battery_timeout_ms + 1000;
    const sh::HelmOutput out = helm.step(t, 0.5f, stale, solarSample(t, 800.0f),
                                         gpsSample(t, 1.0f));
    CHECK(!out.auto_active);
    CHECK_NEAR(out.motor_cmd_pct, 0.0f, 1e-6);
    CHECK(helm.mode() == Mode::kManual);
    CHECK((out.telemetry.fault_flags & sh::kFaultBatteryStale) != 0);
    // And auto does NOT resume by itself on data return (no auto-restore).
    t += 500;
    const sh::HelmOutput out2 =
        helm.step(t, 0.5f, battSample(t, 300.0f, 80.0f),
                  solarSample(t, 800.0f), gpsSample(t, 1.0f));
    CHECK(!out2.auto_active);
}

TEST(helm_invalid_config_locks_manual) {
    ControlConfig cfg;
    cfg.kp_pct_per_w = -1.0f;  // invalid
    Helm helm(cfg, nullptr);
    CHECK(!helm.configValid());
    const uint32_t t = 1000;
    sh::HelmOutput out =
        helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                  solarSample(t, 500.0f), gpsSample(t, 1.0f));
    CHECK((out.telemetry.fault_flags & sh::kFaultConfigInvalid) != 0);
    CHECK(!helm.requestMode(Mode::kSolar, t));
    CHECK(helm.mode() == Mode::kManual);
    CHECK(!out.auto_active);
}

TEST(helm_invalid_config_dropout_when_forced_into_auto) {
    // Defence in depth: even if an automatic mode were somehow active with a
    // broken config, the next tick drops out. Simulate by requesting with a
    // valid config path being bypassed — here we just verify the manual path
    // keeps command at zero every tick.
    ControlConfig cfg;
    cfg.kp_pct_per_w = -1.0f;
    Helm helm(cfg, nullptr);
    for (uint32_t t = 0; t < 5000; t += 500) {
        const sh::HelmOutput out =
            helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                      solarSample(t, 500.0f), gpsSample(t, 1.0f));
        CHECK_NEAR(out.motor_cmd_pct, 0.0f, 1e-6);
    }
}

TEST(helm_reserve_flag_and_floor_in_solar_plus) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, -100.0f, 21.0f), solarSample(t, 300.0f),
              gpsSample(t, 1.0f));
    helm.requestMode(Mode::kSolarPlus, t);
    // Above reserve: no reserve flag.
    t += 500;
    sh::HelmOutput out = helm.step(t, 0.5f, battSample(t, -100.0f, 21.0f),
                                   solarSample(t, 300.0f), gpsSample(t, 1.0f));
    CHECK((out.telemetry.fault_flags & sh::kFaultSocAtReserve) == 0);
    // At reserve: flagged, still automatic (it holds, not aborts).
    t += 500;
    out = helm.step(t, 0.5f, battSample(t, -100.0f, 19.5f),
                    solarSample(t, 300.0f), gpsSample(t, 1.0f));
    CHECK((out.telemetry.fault_flags & sh::kFaultSocAtReserve) != 0);
    CHECK(out.auto_active);
}

TEST(helm_gps_loss_pauses_distance_but_not_cruise) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f), solarSample(t, 500.0f),
              gpsSample(t, 2.0f));
    helm.requestMode(Mode::kSolar, t);
    for (int i = 0; i < 20; ++i) {
        t += 500;
        helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                  solarSample(t, 500.0f), gpsSample(t, 2.0f));
    }
    const float dist_before = helm.energy().distanceKm();
    CHECK(dist_before > 0.0f);
    // GPS dies (stale sample), cruise continues.
    const sh::GpsSample dead = gpsSample(t, 2.0f);
    for (int i = 0; i < 20; ++i) {
        t += 500;
        const sh::HelmOutput out = helm.step(
            t + cfg.gps_timeout_ms, 0.5f,
            battSample(t + cfg.gps_timeout_ms, 100.0f, 80.0f),
            solarSample(t + cfg.gps_timeout_ms, 500.0f), dead);
        CHECK(out.auto_active);
        CHECK_NEAR(out.telemetry.speed_kmh, 0.0f, 1e-6);
    }
    CHECK_NEAR(helm.energy().distanceKm(), dist_before, 1e-5);
}

TEST(helm_hotel_estimate_never_negative_and_solar_invalid_is_zero) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    // Invalid solar sample + charging battery => raw hotel estimate would be
    // negative; must clamp to 0.
    sh::SolarSample no_solar;  // invalid
    const sh::HelmOutput out =
        helm.step(1000, 0.5f, battSample(1000, 500.0f, 80.0f), no_solar,
                  gpsSample(1000, 1.0f));
    CHECK_NEAR(out.telemetry.solar_power_w, 0.0f, 1e-6);
    CHECK(helm.energy().energyHotelWh() >= 0.0f);
}

TEST(helm_daily_reset) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    helm.step(1000, 3600.0f, battSample(1000, 100.0f, 80.0f),
              solarSample(1000, 500.0f), gpsSample(1000, 2.0f));
    CHECK(helm.energy().energySolarWh() > 0.0f);
    helm.resetDailyCounters();
    CHECK_NEAR(helm.energy().energySolarWh(), 0.0f, 1e-6);
}

TEST(helm_force_manual_from_auto) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    helm.step(1000, 0.5f, battSample(1000, 100.0f, 80.0f),
              solarSample(1000, 500.0f), gpsSample(1000, 1.0f));
    helm.requestMode(Mode::kSolarPlus, 1000);
    CHECK(helm.mode() == Mode::kSolarPlus);
    helm.forceManual("user_kill", 2000);
    CHECK(helm.mode() == Mode::kManual);
}

TEST_MAIN()
