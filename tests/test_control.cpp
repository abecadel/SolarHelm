// Unit tests: control building blocks (filter, PI, rate limiter,
// BatteryPowerController).

#include "framework.h"
#include "sh/control/lowpass.h"
#include "sh/control/pi.h"
#include "sh/control/power_controller.h"
#include "sh/control/ratelimit.h"

using sh::BatteryPowerController;
using sh::ControlConfig;
using sh::LowPassFilter;
using sh::PiController;
using sh::RateLimiter;

TEST(lowpass_first_sample_seeds_filter) {
    LowPassFilter f(2.0f);
    CHECK_NEAR(f.update(100.0f, 0.5f), 100.0f, 1e-6);
    CHECK_NEAR(f.value(), 100.0f, 1e-6);
}

TEST(lowpass_converges_toward_input) {
    LowPassFilter f(2.0f);
    f.update(0.0f, 0.5f);
    float y = 0.0f;
    for (int i = 0; i < 100; ++i) {
        y = f.update(100.0f, 0.5f);
    }
    CHECK_NEAR(y, 100.0f, 1.0);
    // Single step moves a fraction dt/(tau+dt).
    LowPassFilter g(2.0f);
    g.update(0.0f, 0.5f);
    CHECK_NEAR(g.update(100.0f, 0.5f), 100.0f * 0.5f / 2.5f, 1e-4);
}

TEST(lowpass_zero_tau_passes_through) {
    LowPassFilter f(0.0f);
    f.update(5.0f, 0.5f);
    CHECK_NEAR(f.update(42.0f, 0.5f), 42.0f, 1e-6);
}

TEST(lowpass_zero_dt_passes_through) {
    LowPassFilter f(2.0f);
    f.update(5.0f, 0.5f);
    CHECK_NEAR(f.update(42.0f, 0.0f), 42.0f, 1e-6);
}

TEST(lowpass_reset_seeds_value) {
    LowPassFilter f(2.0f);
    f.reset(77.0f);
    CHECK_NEAR(f.value(), 77.0f, 1e-6);
}

TEST(pi_proportional_and_integral_action) {
    PiController pi;
    pi.configure(0.1f, 0.01f, 0.0f, 100.0f);
    pi.reset(0.0f);
    const float u1 = pi.update(100.0f, 1.0f);  // integ 1, p 10
    CHECK_NEAR(u1, 11.0f, 1e-4);
    const float u2 = pi.update(100.0f, 1.0f);  // integ 2, p 10
    CHECK_NEAR(u2, 12.0f, 1e-4);
    CHECK_NEAR(pi.integrator(), 2.0f, 1e-4);
}

TEST(pi_output_clamps_high_and_low) {
    PiController pi;
    pi.configure(1.0f, 0.0f, 0.0f, 100.0f);
    pi.reset(0.0f);
    CHECK_NEAR(pi.update(1000.0f, 1.0f), 100.0f, 1e-6);
    CHECK_NEAR(pi.update(-1000.0f, 1.0f), 0.0f, 1e-6);
}

TEST(pi_integrator_clamps_no_windup) {
    PiController pi;
    pi.configure(0.0f, 1.0f, 0.0f, 100.0f);
    pi.reset(0.0f);
    for (int i = 0; i < 50; ++i) {
        pi.update(1000.0f, 1.0f);  // would integrate to 50000 unclamped
    }
    CHECK_NEAR(pi.integrator(), 100.0f, 1e-6);
    // Recovery is immediate: one negative-error step pulls output down.
    const float u = pi.update(-50.0f, 1.0f);
    CHECK(u < 100.0f);
}

TEST(pi_reset_clamps_seed) {
    PiController pi;
    pi.configure(0.1f, 0.01f, 10.0f, 90.0f);
    pi.reset(500.0f);
    CHECK_NEAR(pi.integrator(), 90.0f, 1e-6);
    pi.reset(-500.0f);
    CHECK_NEAR(pi.integrator(), 10.0f, 1e-6);
}

TEST(pi_track_output_reseats_integrator) {
    PiController pi;
    pi.configure(0.1f, 0.01f, 0.0f, 100.0f);
    pi.reset(50.0f);
    pi.trackOutput(20.0f, 100.0f);  // integ = 20 - 0.1*100 = 10
    CHECK_NEAR(pi.integrator(), 10.0f, 1e-4);
}

TEST(ratelimiter_limits_up_and_down) {
    RateLimiter r;
    r.configure(2.0f, 5.0f);
    r.reset(50.0f);
    CHECK_NEAR(r.update(100.0f, 1.0f), 52.0f, 1e-6);  // +2/s cap
    CHECK_NEAR(r.update(0.0f, 1.0f), 47.0f, 1e-6);    // -5/s cap
    CHECK_NEAR(r.update(47.5f, 1.0f), 47.5f, 1e-6);   // within limits
    CHECK_NEAR(r.value(), 47.5f, 1e-6);
}

namespace {

// Idealised plant: PV fixed, motor draw proportional to command, battery
// absorbs the rest. battery_w = pv - hotel - cmd/100*motor_max.
float plantBatteryPowerW(float pv_w, float hotel_w, float cmd_pct,
                         float motor_max_w) {
    return pv_w - hotel_w - cmd_pct / 100.0f * motor_max_w;
}

}  // namespace

TEST(power_controller_converges_to_zero_battery_power) {
    ControlConfig cfg;
    BatteryPowerController ctl(cfg);
    float cmd = 0.0f;
    float batt = plantBatteryPowerW(800.0f, 60.0f, cmd, cfg.motor_max_power_w);
    for (int i = 0; i < 2000; ++i) {
        cmd = ctl.update(batt, 0.0f, 0.5f);
        batt = plantBatteryPowerW(800.0f, 60.0f, cmd, cfg.motor_max_power_w);
    }
    // Settles inside the deadband around 0 W.
    CHECK(batt > -cfg.deadband_w - 1.0f);
    CHECK(batt < cfg.deadband_w + 1.0f);
    CHECK_NEAR(cmd, (800.0f - 60.0f) / cfg.motor_max_power_w * 100.0f,
               cfg.deadband_w / cfg.motor_max_power_w * 100.0f + 0.5f);
}

TEST(power_controller_deadband_freezes_command) {
    ControlConfig cfg;
    cfg.filter_time_constant_s = 0.0f;
    BatteryPowerController ctl(cfg);
    // Drive to some command first.
    for (int i = 0; i < 100; ++i) {
        ctl.update(500.0f, 0.0f, 0.5f);
    }
    const float held = ctl.command_pct();
    // Error inside deadband: command must not move.
    const float cmd = ctl.update(cfg.deadband_w * 0.5f, 0.0f, 0.5f);
    CHECK_NEAR(cmd, held, 1e-5);
}

TEST(power_controller_respects_ramp_limits) {
    ControlConfig cfg;
    cfg.filter_time_constant_s = 0.0f;
    BatteryPowerController ctl(cfg);
    float prev = ctl.command_pct();
    for (int i = 0; i < 50; ++i) {
        const float cmd = ctl.update(1000.0f, 0.0f, 0.5f);  // huge surplus
        CHECK(cmd - prev <= cfg.max_ramp_up_pct_per_s * 0.5f + 1e-4f);
        prev = cmd;
    }
    for (int i = 0; i < 50; ++i) {
        const float cmd = ctl.update(-1000.0f, 0.0f, 0.5f);  // huge deficit
        CHECK(prev - cmd <= cfg.max_ramp_down_pct_per_s * 0.5f + 1e-4f);
        prev = cmd;
    }
}

TEST(power_controller_reset_returns_to_zero) {
    ControlConfig cfg;
    BatteryPowerController ctl(cfg);
    for (int i = 0; i < 100; ++i) {
        ctl.update(500.0f, 0.0f, 0.5f);
    }
    CHECK(ctl.command_pct() > 0.0f);
    ctl.reset();
    CHECK_NEAR(ctl.command_pct(), cfg.min_motor_cmd_pct, 1e-6);
    CHECK_NEAR(ctl.filtered_power_w(), 0.0f, 1e-6);
}

TEST(power_controller_filtered_power_accessor) {
    ControlConfig cfg;
    cfg.filter_time_constant_s = 0.0f;
    BatteryPowerController ctl(cfg);
    ctl.update(123.0f, 0.0f, 0.5f);
    CHECK_NEAR(ctl.filtered_power_w(), 123.0f, 1e-4);
}

TEST_MAIN()
