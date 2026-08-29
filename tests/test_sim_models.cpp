// Unit tests: simulator models (solar, battery/bus, hull, drivers, rng).

#include "framework.h"
#include "simc/battery_model.h"
#include "simc/boat_profile.h"
#include "simc/hull_model.h"
#include "simc/rng.h"
#include "simc/sim_drivers.h"
#include "simc/solar_model.h"

using simc::BatteryModel;
using simc::BatteryModelParams;
using simc::BusResult;
using simc::HullModel;
using simc::Rng;
using simc::SolarModel;
using simc::SolarModelParams;
using simc::SolarWaveform;

TEST(rng_is_deterministic_and_bounded) {
    Rng a(7);
    Rng b(7);
    for (int i = 0; i < 100; ++i) {
        CHECK(a.next() == b.next());
    }
    Rng c(0);  // zero seed is remapped, must still produce values
    for (int i = 0; i < 100; ++i) {
        const float f = c.nextFloat();
        CHECK(f >= 0.0f);
        CHECK(f < 1.0f);
    }
}

TEST(solar_constant_and_swing_waveforms) {
    SolarModelParams p;
    p.waveform = SolarWaveform::kConstant;
    p.peak_w = 800.0f;
    SolarModel m(p);
    CHECK_NEAR(m.availablePowerW(0.0f), 800.0f, 1e-3);
    CHECK_NEAR(m.availablePowerW(1000.0f), 800.0f, 1e-3);

    SolarModelParams s;
    s.waveform = SolarWaveform::kSwing;
    s.swing_mean_w = 900.0f;
    s.swing_amplitude_w = 600.0f;
    s.swing_period_s = 600.0f;
    SolarModel sw(s);
    CHECK_NEAR(sw.availablePowerW(0.0f), 900.0f, 1e-2);
    CHECK_NEAR(sw.availablePowerW(150.0f), 1500.0f, 1e-2);  // quarter period
    CHECK_NEAR(sw.availablePowerW(450.0f), 300.0f, 1e-2);
}

TEST(solar_swing_clamps_negative_to_zero) {
    SolarModelParams s;
    s.waveform = SolarWaveform::kSwing;
    s.swing_mean_w = 100.0f;
    s.swing_amplitude_w = 500.0f;
    s.swing_period_s = 600.0f;
    SolarModel sw(s);
    CHECK_NEAR(sw.availablePowerW(450.0f), 0.0f, 1e-3);  // would be -400
}

TEST(solar_day_arc_shape) {
    SolarModelParams p;  // defaults: day arc 06:00-20:00, peak 780
    SolarModel m(p);
    CHECK_NEAR(m.availablePowerW(5.0f * 3600), 0.0f, 1e-3);   // pre-sunrise
    CHECK_NEAR(m.availablePowerW(21.0f * 3600), 0.0f, 1e-3);  // post-sunset
    const float noon = m.availablePowerW(13.0f * 3600);
    CHECK_NEAR(noon, 780.0f, 1.0f);  // solar noon = peak
    const float morning = m.availablePowerW(8.0f * 3600);
    CHECK(morning > 0.0f);
    CHECK(morning < noon);
}

TEST(solar_scale_and_cloud_events) {
    SolarModelParams p;
    p.waveform = SolarWaveform::kConstant;
    p.peak_w = 1000.0f;
    SolarModel m(p);
    m.setPvScale(0.2f);
    CHECK_NEAR(m.availablePowerW(0.0f), 200.0f, 1e-3);
    m.setCloudFactor(0.5f);
    CHECK_NEAR(m.availablePowerW(0.0f), 100.0f, 1e-3);
}

TEST(solar_random_cloud_walk_is_deterministic_and_bounded) {
    SolarModelParams p;
    p.waveform = SolarWaveform::kConstant;
    p.peak_w = 1000.0f;
    p.random_clouds = true;
    p.cloud_seed = 42;
    SolarModel a(p);
    SolarModel b(p);
    for (float t = 0.0f; t < 7200.0f; t += 2.0f) {
        const float pa = a.availablePowerW(t);
        CHECK_NEAR(pa, b.availablePowerW(t), 1e-6);
        CHECK(pa >= 0.0f);
        CHECK(pa <= 1000.0f + 1e-3f);
    }
}

namespace {
BatteryModelParams smallBattery(float soc) {
    BatteryModelParams p;
    p.capacity_wh = 1000.0f;
    p.initial_soc_pct = soc;
    p.max_charge_w = 500.0f;
    p.max_discharge_w = 800.0f;
    return p;
}
}  // namespace

TEST(battery_charges_from_surplus) {
    BatteryModel b(smallBattery(50.0f));
    const BusResult r = b.step(600.0f, 100.0f, 50.0f, 3600.0f);
    CHECK_NEAR(r.battery_w, 450.0f, 1e-3);
    CHECK_NEAR(r.curtailed_w, 0.0f, 1e-3);
    CHECK_NEAR(r.pv_w, 600.0f, 1e-3);
    // 450 Wh * 0.97 into 1000 Wh from 50% -> ~93.65%
    CHECK_NEAR(b.socPct(), 50.0f + 45.0f * 0.97f, 0.1f);
}

TEST(battery_curtails_beyond_charge_limit) {
    BatteryModel b(smallBattery(50.0f));
    const BusResult r = b.step(1000.0f, 100.0f, 0.0f, 1.0f);
    CHECK_NEAR(r.battery_w, 500.0f, 1e-3);  // charge limit
    CHECK_NEAR(r.curtailed_w, 400.0f, 1e-3);
    CHECK_NEAR(r.pv_w, 600.0f, 1e-3);
}

TEST(battery_full_curtails_everything) {
    BatteryModel b(smallBattery(100.0f));
    const BusResult r = b.step(800.0f, 100.0f, 0.0f, 1.0f);
    CHECK_NEAR(r.battery_w, 0.0f, 1e-3);
    CHECK_NEAR(r.curtailed_w, 700.0f, 1e-3);
    CHECK_NEAR(b.socPct(), 100.0f, 1e-3);
}

TEST(battery_soc_caps_at_100) {
    BatteryModelParams p = smallBattery(99.99f);
    BatteryModel b(p);
    b.step(600.0f, 0.0f, 0.0f, 3600.0f);
    CHECK_NEAR(b.socPct(), 100.0f, 1e-3);
}

TEST(battery_discharges_to_cover_deficit) {
    BatteryModel b(smallBattery(50.0f));
    const BusResult r = b.step(100.0f, 500.0f, 100.0f, 3600.0f);
    CHECK_NEAR(r.battery_w, -500.0f, 1e-3);
    CHECK_NEAR(r.motor_w, 500.0f, 1e-3);
    CHECK_NEAR(r.hotel_w, 100.0f, 1e-3);
    CHECK_NEAR(b.socPct(), 0.0f, 1e-3);  // 500 Wh out of the remaining 500
}

TEST(battery_brownout_cuts_motor_then_hotel) {
    // Discharge limit 800 W; ask for far more.
    BatteryModel b(smallBattery(50.0f));
    const BusResult r = b.step(0.0f, 1500.0f, 200.0f, 1.0f);
    CHECK_NEAR(r.battery_w, -800.0f, 1e-3);
    // Deficit 900 W comes out of the motor first.
    CHECK_NEAR(r.motor_w, 600.0f, 1e-3);
    CHECK_NEAR(r.hotel_w, 200.0f, 1e-3);
}

TEST(battery_brownout_reaches_hotel_when_motor_exhausted) {
    BatteryModel b(smallBattery(50.0f));
    const BusResult r = b.step(0.0f, 100.0f, 1200.0f, 1.0f);
    CHECK_NEAR(r.battery_w, -800.0f, 1e-3);
    CHECK_NEAR(r.motor_w, 0.0f, 1e-3);   // fully cut
    CHECK_NEAR(r.hotel_w, 800.0f, 1e-3);  // partially served
}

TEST(battery_soc_clamps_at_zero_when_overdrawn) {
    BatteryModel b(smallBattery(1.0f));  // 10 Wh left
    b.step(0.0f, 700.0f, 0.0f, 3600.0f);  // try to pull 700 Wh
    CHECK_NEAR(b.socPct(), 0.0f, 1e-6);
}

TEST(battery_empty_supplies_nothing) {
    BatteryModel b(smallBattery(0.0f));
    const BusResult r = b.step(0.0f, 300.0f, 100.0f, 1.0f);
    CHECK_NEAR(r.battery_w, 0.0f, 1e-3);
    CHECK_NEAR(r.motor_w, 0.0f, 1e-3);
    CHECK_NEAR(r.hotel_w, 0.0f, 1e-3);
}

TEST(battery_voltage_and_current_model) {
    BatteryModel b(smallBattery(50.0f));
    CHECK_NEAR(b.voltageV(), 25.0f, 1e-3);  // idle at 50% SOC
    CHECK_NEAR(b.currentA(), 0.0f, 1e-3);
    b.step(600.0f, 0.0f, 0.0f, 1.0f);  // charging 500 W (limit)
    CHECK(b.currentA() > 0.0f);
    CHECK(b.voltageV() > 25.0f);  // charge pushes terminal voltage up
    b.step(0.0f, 700.0f, 0.0f, 1.0f);  // discharging
    CHECK(b.currentA() < 0.0f);
}

TEST(hull_steady_state_and_lag) {
    const simc::BoatProfile profile = simc::defaultBoatProfile();
    HullModel lagless(profile, 0.0f);
    // 5 km/h costs 600 W on the default curve.
    CHECK_NEAR(lagless.update(600.0f, 1.0f), 5.0f, 0.05f);
    CHECK_NEAR(lagless.speedMps(), 5.0f / 3.6f, 0.02f);

    HullModel lagged(profile, 8.0f);
    const float v1 = lagged.update(600.0f, 1.0f);
    CHECK(v1 > 0.0f);
    CHECK(v1 < 1.0f);  // far from steady state after 1 s
    float v = v1;
    for (int i = 0; i < 300; ++i) {
        v = lagged.update(600.0f, 1.0f);
    }
    CHECK_NEAR(v, 5.0f, 0.1f);
    CHECK_NEAR(lagged.speedKmh(), v, 1e-6);
}

TEST(sim_drivers_feed_read_and_fail) {
    simc::SimulatedShunt shunt;
    CHECK(!shunt.read().valid);
    shunt.feed(1000, 25.0f, 4.0f, 100.0f, 80.0f);
    sh::BatterySample s = shunt.read();
    CHECK(s.valid);
    CHECK(s.timestamp_ms == 1000);
    CHECK_NEAR(s.power_w, 100.0f, 1e-6);
    shunt.setFailed(true);
    shunt.feed(2000, 25.0f, 4.0f, 100.0f, 80.0f);
    CHECK(shunt.read().timestamp_ms == 1000);  // frozen -> goes stale

    simc::SimulatedSolarMonitor sol;
    CHECK(!sol.read().valid);
    sol.feed(500, 700.0f);
    CHECK_NEAR(sol.read().power_w, 700.0f, 1e-6);
    sol.setFailed(true);
    sol.feed(900, 900.0f);
    CHECK_NEAR(sol.read().power_w, 700.0f, 1e-6);

    simc::SimulatedGps gps;
    CHECK(!gps.read().valid);
    gps.feed(100, 2.0f, 43.5, 16.4);
    sh::GpsSample g = gps.read();
    CHECK(g.valid);
    CHECK_NEAR(g.speed_mps, 2.0f, 1e-6);
    CHECK(g.satellites > 0);
    gps.setFailed(true);
    gps.feed(200, 3.0f, 43.6, 16.5);
    CHECK(gps.read().timestamp_ms == 100);
}

TEST(sim_throttle_clamps) {
    simc::SimulatorThrottle t;
    t.write(50.0f);
    CHECK_NEAR(t.lastCmdPct(), 50.0f, 1e-6);
    t.write(-10.0f);
    CHECK_NEAR(t.lastCmdPct(), 0.0f, 1e-6);
    t.write(150.0f);
    CHECK_NEAR(t.lastCmdPct(), 100.0f, 1e-6);
}

TEST_MAIN()
