// Unit tests: BatteryGuard — the battery-side Motor Protection Envelope.

#include "framework.h"
#include "sh/safety/battery_guard.h"
#include "sh/safety/supervisor.h"

using sh::BatteryGuard;
using sh::ControlConfig;
using sh::GuardOutput;

namespace {

sh::BatterySample sample(float v, float current_a = 0.0f, float power_w = 0.0f) {
    sh::BatterySample s;
    s.valid = true;
    s.voltage_v = v;
    s.current_a = current_a;
    s.power_w = power_w;
    s.soc_pct = 50.0f;
    return s;
}

// Run N ticks of dt seconds at a fixed sample; return the last output.
GuardOutput run(BatteryGuard& g, const sh::BatterySample& s, int n,
                float dt = 1.0f) {
    GuardOutput out;
    for (int i = 0; i < n; ++i) {
        out = g.update(s, dt);
    }
    return out;
}

}  // namespace

TEST(guard_invalid_sample_is_transparent) {
    ControlConfig cfg;
    BatteryGuard g(cfg);
    sh::BatterySample invalid;
    const GuardOutput out = g.update(invalid, 1.0f);
    CHECK_NEAR(out.ceiling_pct, 100.0f, 1e-6);
    CHECK(!out.stop);
    CHECK(out.faults == 0);
}

TEST(guard_healthy_pack_full_ceiling) {
    ControlConfig cfg;
    BatteryGuard g(cfg);
    const GuardOutput out = run(g, sample(25.6f, -20.0f), 10);
    CHECK_NEAR(out.ceiling_pct, 100.0f, 1e-6);
    CHECK(out.faults == 0);
}

TEST(guard_soft_sag_needs_debounce_then_caps) {
    ControlConfig cfg;  // soft 24.4 V, debounce 4 s, cap 50%
    BatteryGuard g(cfg);
    // 3 s below soft: not yet (debounce).
    GuardOutput out = run(g, sample(24.3f), 3);
    CHECK(out.faults == 0);
    CHECK_NEAR(out.ceiling_pct, 100.0f, 1e-6);
    // 4th second: latched.
    out = g.update(sample(24.3f), 1.0f);
    CHECK((out.faults & sh::kFaultSagSoft) != 0);
    CHECK_NEAR(out.ceiling_pct, cfg.sag_soft_cap_pct, 1e-6);
    CHECK(!out.stop);
}

TEST(guard_soft_sag_transient_dip_is_ignored) {
    ControlConfig cfg;
    BatteryGuard g(cfg);
    // Alternate: 2 s below, 1 s above — timer resets, never latches.
    for (int i = 0; i < 10; ++i) {
        run(g, sample(24.3f), 2);
        const GuardOutput out = g.update(sample(24.9f), 1.0f);
        CHECK(out.faults == 0);
    }
}

TEST(guard_soft_release_requires_margin) {
    ControlConfig cfg;  // release at soft + 0.4 = 24.8 V
    BatteryGuard g(cfg);
    run(g, sample(24.3f), 5);  // latched
    // Recovery to just above threshold: still latched (hysteresis).
    GuardOutput out = g.update(sample(24.5f), 1.0f);
    CHECK((out.faults & sh::kFaultSagSoft) != 0);
    // Recovery past threshold + margin: released.
    out = g.update(sample(24.8f), 1.0f);
    CHECK(out.faults == 0);
    CHECK_NEAR(out.ceiling_pct, 100.0f, 1e-6);
}

TEST(guard_hard_sag_caps_harder) {
    ControlConfig cfg;  // hard 23.6 V, cap 15%
    BatteryGuard g(cfg);
    const GuardOutput out = run(g, sample(23.5f), 5);
    CHECK((out.faults & sh::kFaultSagSoft) != 0);  // soft stage also below
    CHECK((out.faults & sh::kFaultSagHard) != 0);
    CHECK_NEAR(out.ceiling_pct, cfg.sag_hard_cap_pct, 1e-6);
    CHECK(!out.stop);
}

TEST(guard_stop_stage_issues_graceful_stop) {
    ControlConfig cfg;  // stop 23.2 V
    BatteryGuard g(cfg);
    const GuardOutput out = run(g, sample(23.0f), 5);
    CHECK((out.faults & sh::kFaultSagStop) != 0);
    CHECK(out.stop);
}

TEST(guard_over_current_latches_and_releases_with_hysteresis) {
    ControlConfig cfg;  // 48 A cap, 2 s debounce
    BatteryGuard g(cfg);
    // 1 s over: not yet.
    GuardOutput out = g.update(sample(25.5f, -60.0f), 1.0f);
    CHECK((out.faults & sh::kFaultOverCurrent) == 0);
    // 2nd second: latched, capped at the hard cap.
    out = g.update(sample(25.5f, -60.0f), 1.0f);
    CHECK((out.faults & sh::kFaultOverCurrent) != 0);
    CHECK_NEAR(out.ceiling_pct, cfg.sag_hard_cap_pct, 1e-6);
    // Just under the limit: still latched (release at 80% = 38.4 A).
    out = g.update(sample(25.5f, -45.0f), 1.0f);
    CHECK((out.faults & sh::kFaultOverCurrent) != 0);
    // Under the release threshold: cleared.
    out = g.update(sample(25.5f, -30.0f), 1.0f);
    CHECK((out.faults & sh::kFaultOverCurrent) == 0);
    CHECK_NEAR(out.ceiling_pct, 100.0f, 1e-6);
    // Charging current never counts as discharge.
    out = run(g, sample(25.5f, 80.0f), 5);
    CHECK((out.faults & sh::kFaultOverCurrent) == 0);
}

TEST(guard_temperature_policy) {
    ControlConfig cfg;  // cold -10, hot 45, stop 60, cap 50%
    BatteryGuard g(cfg);
    sh::BatterySample s = sample(25.6f);
    s.has_temperature = true;

    s.temperature_c = 20.0f;
    GuardOutput out = g.update(s, 1.0f);
    CHECK(out.faults == 0);

    s.temperature_c = -15.0f;  // too cold: derate
    out = g.update(s, 1.0f);
    CHECK((out.faults & sh::kFaultBattTempDerate) != 0);
    CHECK_NEAR(out.ceiling_pct, cfg.temp_derate_cap_pct, 1e-6);

    s.temperature_c = 50.0f;  // too hot: derate
    out = g.update(s, 1.0f);
    CHECK((out.faults & sh::kFaultBattTempDerate) != 0);

    s.temperature_c = 60.0f;  // critical: stop
    out = g.update(s, 1.0f);
    CHECK(out.stop);
    CHECK((out.faults & sh::kFaultBattTempDerate) != 0);
}

TEST(guard_charge_below_freezing_flag) {
    ControlConfig cfg;
    BatteryGuard g(cfg);
    sh::BatterySample s = sample(26.0f, 10.0f, 260.0f);  // charging
    s.has_temperature = true;
    s.temperature_c = -2.0f;
    GuardOutput out = g.update(s, 1.0f);
    CHECK((out.faults & sh::kFaultChargeBelowFreezing) != 0);
    // Discharging below freezing: allowed (derate only below -10).
    s.power_w = -100.0f;
    out = g.update(s, 1.0f);
    CHECK((out.faults & sh::kFaultChargeBelowFreezing) == 0);
    // No temperature sensor: no temperature faults at all.
    sh::BatterySample no_temp = sample(26.0f, 10.0f, 260.0f);
    BatteryGuard g2(cfg);
    out = g2.update(no_temp, 1.0f);
    CHECK(out.faults == 0);
}

TEST(guard_combines_worst_ceiling) {
    ControlConfig cfg;
    BatteryGuard g(cfg);
    // Cold derate (50%) + soft sag (50%) + over-current (15%): worst wins.
    sh::BatterySample s = sample(24.3f, -60.0f);
    s.has_temperature = true;
    s.temperature_c = -15.0f;
    const GuardOutput out = run(g, s, 6);
    CHECK((out.faults & sh::kFaultSagSoft) != 0);
    CHECK((out.faults & sh::kFaultOverCurrent) != 0);
    CHECK((out.faults & sh::kFaultBattTempDerate) != 0);
    CHECK_NEAR(out.ceiling_pct, cfg.sag_hard_cap_pct, 1e-6);
}

TEST_MAIN()
