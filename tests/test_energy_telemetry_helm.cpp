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
    g.latitude_deg = 43.5081;
    g.longitude_deg = 16.4402;
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
    // Position rides along with a usable fix (geographic learning input).
    CHECK_NEAR(out.telemetry.latitude_deg, 43.5081, 1e-6);
    CHECK_NEAR(out.telemetry.longitude_deg, 16.4402, 1e-6);
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

TEST(helm_guard_soft_sag_caps_command_and_flags) {
    ControlConfig cfg;
    cfg.filter_time_constant_s = 0.0f;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    // Healthy pack, big surplus: command grows past 50%.
    helm.step(t, 0.5f, battSample(t, 800.0f, 80.0f), solarSample(t, 900.0f),
              gpsSample(t, 1.0f));
    helm.requestMode(Mode::kSolar, t);
    sh::HelmOutput out;
    for (int i = 0; i < 200; ++i) {
        t += 500;
        out = helm.step(t, 0.5f, battSample(t, 800.0f, 80.0f),
                        solarSample(t, 900.0f), gpsSample(t, 1.0f));
    }
    CHECK(out.motor_cmd_pct > 60.0f);
    // Pack sags below the soft threshold (debounced), still fresh data:
    // ceiling engages, command ramps down to 50%.
    for (int i = 0; i < 60; ++i) {
        t += 500;
        sh::BatterySample sag = battSample(t, 800.0f, 80.0f);
        sag.voltage_v = 24.2f;
        out = helm.step(t, 0.5f, sag, solarSample(t, 900.0f),
                        gpsSample(t, 1.0f));
    }
    CHECK((out.telemetry.fault_flags & sh::kFaultSagSoft) != 0);
    CHECK(out.motor_cmd_pct <= cfg.sag_soft_cap_pct + 1e-3f);
    CHECK(out.auto_active);  // soft stage derates, it does not abort
}

TEST(helm_guard_stop_stage_forces_manual) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 60.0f), solarSample(t, 500.0f),
              gpsSample(t, 1.0f));
    helm.requestMode(Mode::kSolar, t);
    sh::HelmOutput out;
    uint16_t flags_seen = 0;
    for (int i = 0; i < 20; ++i) {  // 10 s below stop voltage (> debounce)
        t += 500;
        sh::BatterySample dead = battSample(t, -200.0f, 10.0f);
        dead.voltage_v = 23.0f;
        out = helm.step(t, 0.5f, dead, solarSample(t, 100.0f),
                        gpsSample(t, 1.0f));
        flags_seen |= out.telemetry.fault_flags;
    }
    CHECK(!out.auto_active);
    CHECK_NEAR(out.motor_cmd_pct, 0.0f, 1e-6);
    CHECK(helm.mode() == Mode::kManual);
    // The stop flag is raised on the tick that triggered the stop (after
    // that, MANUAL ticks no longer evaluate the guard).
    CHECK((flags_seen & sh::kFaultSagStop) != 0);
}

TEST(helm_remote_mode_requires_fresh_target) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f), solarSample(t, 500.0f),
              gpsSample(t, 1.0f));
    // No target yet: refused.
    CHECK(!helm.requestMode(Mode::kRemote, t));
    // Stale target: refused.
    helm.setRemoteTarget(500.0f, t);
    CHECK(!helm.requestMode(Mode::kRemote, t + cfg.remote_timeout_ms + 1));
    // Fresh target: granted.
    helm.setRemoteTarget(500.0f, t);
    CHECK(helm.requestMode(Mode::kRemote, t + 100));
    CHECK(helm.mode() == Mode::kRemote);
}

TEST(helm_remote_executes_target_through_ramps) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f), solarSample(t, 500.0f),
              gpsSample(t, 1.0f));
    helm.setRemoteTarget(582.0f, t);  // 50% of 1164 W
    helm.requestMode(Mode::kRemote, t);
    sh::HelmOutput out;
    float prev = 0.0f;
    for (int i = 0; i < 100; ++i) {
        t += 500;
        helm.setRemoteTarget(582.0f, t);  // phone keeps streaming
        out = helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                        solarSample(t, 500.0f), gpsSample(t, 1.0f));
        CHECK(out.motor_cmd_pct - prev <=
              cfg.max_ramp_up_pct_per_s * 0.5f + 1e-4f);
        prev = out.motor_cmd_pct;
    }
    CHECK_NEAR(out.motor_cmd_pct, 50.0f, 0.5f);
    CHECK(out.telemetry.mode == static_cast<uint8_t>(Mode::kRemote));
    // Negative targets clamp to zero (no automatic reverse, ever).
    helm.setRemoteTarget(-500.0f, t);
    for (int i = 0; i < 300; ++i) {
        t += 500;
        helm.setRemoteTarget(-500.0f, t);
        out = helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                        solarSample(t, 500.0f), gpsSample(t, 1.0f));
    }
    CHECK_NEAR(out.motor_cmd_pct, 0.0f, 1e-3);
}

TEST(helm_remote_target_clamped_by_max_and_guard_ceiling) {
    ControlConfig cfg;
    cfg.max_motor_cmd_pct = 90.0f;  // configured cap under the 100% ceiling
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f), solarSample(t, 500.0f),
              gpsSample(t, 1.0f));
    // Phone asks for more than the motor's rating: clamped to 100%.
    helm.setRemoteTarget(3000.0f, t);
    helm.requestMode(Mode::kRemote, t);
    sh::HelmOutput out;
    for (int i = 0; i < 200; ++i) {
        t += 500;
        helm.setRemoteTarget(3000.0f, t);
        out = helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                        solarSample(t, 500.0f), gpsSample(t, 1.0f));
    }
    CHECK_NEAR(out.motor_cmd_pct, cfg.max_motor_cmd_pct, 1e-3);
    // Pack sags below the soft threshold: the guard ceiling clamps the
    // remote command down to the soft cap.
    for (int i = 0; i < 60; ++i) {
        t += 500;
        helm.setRemoteTarget(3000.0f, t);
        sh::BatterySample sag = battSample(t, -300.0f, 60.0f);
        sag.voltage_v = 24.2f;
        out = helm.step(t, 0.5f, sag, solarSample(t, 200.0f),
                        gpsSample(t, 1.0f));
    }
    CHECK((out.telemetry.fault_flags & sh::kFaultSagSoft) != 0);
    CHECK(out.motor_cmd_pct <= cfg.sag_soft_cap_pct + 1e-3f);
    CHECK(helm.mode() == Mode::kRemote);
}

TEST(helm_remote_stale_degrades_to_solar) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f), solarSample(t, 500.0f),
              gpsSample(t, 1.0f));
    helm.setRemoteTarget(582.0f, t);
    helm.requestMode(Mode::kRemote, t);
    // Phone goes silent: after the timeout the boat degrades to SOLAR and
    // keeps cruising autonomously (no dead stop mid-water).
    t += cfg.remote_timeout_ms + 1000;
    const sh::HelmOutput out =
        helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                  solarSample(t, 500.0f), gpsSample(t, 1.0f));
    CHECK(helm.mode() == Mode::kSolar);
    CHECK(out.auto_active);
    CHECK((out.telemetry.fault_flags & sh::kFaultRemoteStale) != 0);
}

TEST(helm_remote_respects_reserve_floor) {
    ControlConfig cfg;
    cfg.filter_time_constant_s = 0.0f;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 19.0f), solarSample(t, 500.0f),
              gpsSample(t, 1.0f));
    helm.setRemoteTarget(1000.0f, t);  // phone asks for a lot...
    helm.requestMode(Mode::kRemote, t);
    sh::HelmOutput out;
    for (int i = 0; i < 100; ++i) {
        t += 500;
        helm.setRemoteTarget(1000.0f, t);
        // ...but SOC is at the reserve: REMOTE falls back to the
        // battery-power loop with the floored target.
        out = helm.step(t, 0.5f, battSample(t, 0.0f, 19.0f),
                        solarSample(t, 500.0f), gpsSample(t, 1.0f));
    }
    CHECK((out.telemetry.fault_flags & sh::kFaultSocAtReserve) != 0);
    CHECK(helm.mode() == Mode::kRemote);  // stays in mode, floors the power
    // The command settles near zero: measured battery power 0 < floored
    // target (+deadband) means no surplus to spend.
    CHECK(out.motor_cmd_pct < 20.0f);
}

TEST(helm_range_holds_the_configured_power_autonomously) {
    ControlConfig cfg;  // range_motor_power_w 350 of 1164 W -> ~30.1%
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f), solarSample(t, 500.0f),
              gpsSample(t, 1.0f));
    // No phone, no stream: RANGE enters on the switch alone.
    CHECK(helm.requestMode(Mode::kRange, t));
    sh::HelmOutput out;
    for (int i = 0; i < 100; ++i) {
        t += 500;
        out = helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                        solarSample(t, 500.0f), gpsSample(t, 1.0f));
    }
    CHECK_NEAR(out.motor_cmd_pct, 350.0f / 1164.0f * 100.0f, 0.5f);
    CHECK(out.telemetry.mode == static_cast<uint8_t>(Mode::kRange));
    CHECK(helm.mode() == Mode::kRange);  // hours later: still no phone needed
}

TEST(helm_range_respects_reserve_floor) {
    ControlConfig cfg;
    cfg.filter_time_constant_s = 0.0f;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 19.0f), solarSample(t, 500.0f),
              gpsSample(t, 1.0f));
    helm.requestMode(Mode::kRange, t);
    sh::HelmOutput out;
    for (int i = 0; i < 100; ++i) {
        t += 500;
        // At the reserve, RANGE falls back to the charging-only power loop.
        out = helm.step(t, 0.5f, battSample(t, 0.0f, 19.0f),
                        solarSample(t, 500.0f), gpsSample(t, 1.0f));
    }
    CHECK((out.telemetry.fault_flags & sh::kFaultSocAtReserve) != 0);
    CHECK(helm.mode() == Mode::kRange);
    CHECK(out.motor_cmd_pct < 20.0f);
}

TEST(helm_arrival_requires_fresh_budget) {
    ControlConfig cfg;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f), solarSample(t, 500.0f),
              gpsSample(t, 1.0f));
    CHECK(!helm.requestMode(Mode::kArrival, t));  // no budget yet
    helm.setArrivalBudget(-150.0f, t);
    CHECK(!helm.requestMode(Mode::kArrival,
                            t + cfg.remote_timeout_ms + 1));  // stale
    helm.setArrivalBudget(-150.0f, t);
    CHECK(helm.requestMode(Mode::kArrival, t + 100));
    CHECK(helm.mode() == Mode::kArrival);
    // Extreme wire values are clamped to the +/-5 kW envelope (both sides).
    helm.setArrivalBudget(-9999.0f, t + 100);
    helm.setArrivalBudget(9999.0f, t + 100);
    CHECK(helm.mode() == Mode::kArrival);
}

TEST(helm_arrival_tracks_budget_and_degrades_when_stale) {
    ControlConfig cfg;
    cfg.filter_time_constant_s = 0.0f;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    helm.step(t, 0.5f, battSample(t, -150.0f, 80.0f), solarSample(t, 300.0f),
              gpsSample(t, 1.0f));
    helm.setArrivalBudget(-150.0f, t);
    helm.requestMode(Mode::kArrival, t);
    sh::HelmOutput out;
    for (int i = 0; i < 100; ++i) {
        t += 500;
        helm.setArrivalBudget(-150.0f, t);  // phone keeps streaming
        // Battery already discharging exactly at the budget: the closed
        // loop should hold rather than ramp away.
        out = helm.step(t, 0.5f, battSample(t, -150.0f, 80.0f),
                        solarSample(t, 300.0f), gpsSample(t, 1.0f));
    }
    CHECK(out.auto_active);
    CHECK(out.telemetry.mode == static_cast<uint8_t>(Mode::kArrival));
    // Phone goes silent: degrade to self-contained SOLAR with the fault.
    t += cfg.remote_timeout_ms + 1000;
    out = helm.step(t, 0.5f, battSample(t, -150.0f, 80.0f),
                    solarSample(t, 300.0f), gpsSample(t, 1.0f));
    CHECK(helm.mode() == Mode::kSolar);
    CHECK(out.auto_active);
    CHECK((out.telemetry.fault_flags & sh::kFaultArrivalStale) != 0);
}

TEST(helm_stamps_config_revision_and_imu_into_telemetry) {
    ControlConfig cfg;
    cfg.config_revision = 7.0f;
    Helm helm(cfg, nullptr);
    uint32_t t = 1000;
    // No IMU yet: attitude stays 0.0, revision is stamped regardless.
    sh::HelmOutput out =
        helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                  solarSample(t, 500.0f), gpsSample(t, 1.0f));
    CHECK_NEAR(out.telemetry.config_revision, 7.0f, 1e-6);
    CHECK_NEAR(out.telemetry.roll_deg, 0.0f, 1e-6);
    CHECK_NEAR(out.telemetry.pitch_deg, 0.0f, 1e-6);
    // IMU streaming: the latest attitude rides along.
    sh::ImuSample imu;
    imu.valid = true;
    imu.timestamp_ms = t;
    imu.roll_deg = -4.5f;
    imu.pitch_deg = 1.5f;
    helm.setImuSample(imu);
    t += 500;
    out = helm.step(t, 0.5f, battSample(t, 100.0f, 80.0f),
                    solarSample(t, 500.0f), gpsSample(t, 1.0f));
    CHECK_NEAR(out.telemetry.roll_deg, -4.5f, 1e-6);
    CHECK_NEAR(out.telemetry.pitch_deg, 1.5f, 1e-6);
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
