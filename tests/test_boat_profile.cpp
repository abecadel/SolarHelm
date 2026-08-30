// Unit tests: BoatProfile parsing + hull curve maths, including that the
// repository's config/boat_profile.json stays in sync with the built-in
// default profile.

#include <fstream>
#include <sstream>
#include <string>

#include "framework.h"
#include "simc/boat_profile.h"

using simc::BoatProfile;
using simc::defaultBoatProfile;
using simc::parseBoatProfile;

namespace {

std::string readFile(const char* path) {
    std::ifstream in(path);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

}  // namespace

TEST(profile_repo_json_parses_and_matches_default) {
    const std::string json = readFile("config/boat_profile.json");
    CHECK(!json.empty());
    BoatProfile p;
    std::string err;
    CHECK(parseBoatProfile(json, &p, &err));
    const BoatProfile d = defaultBoatProfile();
    CHECK(p.schema_version == d.schema_version);
    CHECK(p.hull_curve.size() == d.hull_curve.size());
    for (size_t i = 0; i < d.hull_curve.size() && i < p.hull_curve.size();
         ++i) {
        CHECK_NEAR(p.hull_curve[i].speed_kmh, d.hull_curve[i].speed_kmh, 1e-4);
        CHECK_NEAR(p.hull_curve[i].wh_per_km, d.hull_curve[i].wh_per_km, 1e-4);
    }
    CHECK_NEAR(p.pv_kwp, d.pv_kwp, 1e-4);
    CHECK_NEAR(p.pv_derating, d.pv_derating, 1e-4);
    CHECK_NEAR(p.battery_capacity_kwh, d.battery_capacity_kwh, 1e-4);
    CHECK_NEAR(p.battery_usable_min_soc_pct, d.battery_usable_min_soc_pct, 1e-4);
    CHECK_NEAR(p.battery_max_charge_w, d.battery_max_charge_w, 1e-2);
    CHECK_NEAR(p.battery_max_discharge_w, d.battery_max_discharge_w, 1e-2);
    CHECK_NEAR(p.hotel_load_w, d.hotel_load_w, 1e-4);
    CHECK_NEAR(p.motor_max_power_w, d.motor_max_power_w, 1e-2);
    CHECK(p.hull_count == d.hull_count);
    CHECK_NEAR(p.lwl_m, d.lwl_m, 1e-4);
    CHECK_NEAR(p.beam_waterline_m, d.beam_waterline_m, 1e-4);
    CHECK_NEAR(p.hull_spacing_m, d.hull_spacing_m, 1e-4);
    CHECK_NEAR(p.displacement_kg, d.displacement_kg, 1e-2);
    CHECK_NEAR(p.cda_front_m2, d.cda_front_m2, 1e-4);
}

TEST(profile_repo_powercat_json_is_a_valid_catamaran) {
    const std::string json = readFile("config/powercat_profile.json");
    CHECK(!json.empty());
    BoatProfile p;
    std::string err;
    CHECK(parseBoatProfile(json, &p, &err));
    CHECK(p.hull_count == 2);
    CHECK_NEAR(p.lwl_m, 8.0f, 1e-4);
    CHECK_NEAR(p.beam_waterline_m, 0.5f, 1e-4);
    CHECK_NEAR(p.hull_spacing_m, 2.5f, 1e-4);
    CHECK_NEAR(p.displacement_kg, 1000.0f, 1e-2);
    CHECK_NEAR(p.motor_max_power_w, 4000.0f, 1e-2);
    // The reference cat cruises far cheaper than the reference launch.
    CHECK(p.powerForSpeedW(6.0f) < 350.0f);
}

TEST(profile_hull_geometry_is_optional_with_safe_defaults) {
    // A pre-L2 profile without any geometry keys parses and keeps the
    // monohull defaults.
    const std::string old_json =
        "{\"schema_version\":1,\"pv_kwp\":1,\"pv_derating\":0.8,"
        "\"battery_capacity_kwh\":2.5,\"battery_usable_min_soc_pct\":10,"
        "\"battery_max_charge_w\":1000,\"battery_max_discharge_w\":2000,"
        "\"hotel_load_w\":50,\"motor_max_power_w\":1000,"
        "\"hull_efficiency_curve_kmh_whkm\":[[3.0,85.0],[5.0,120.0]]}";
    BoatProfile p;
    std::string err;
    CHECK(parseBoatProfile(old_json, &p, &err));
    CHECK(p.hull_count == 1);
    CHECK_NEAR(p.lwl_m, 0.0f, 1e-6);
    CHECK_NEAR(p.cda_front_m2, 1.2f, 1e-6);
    // Present-but-insane geometry is rejected by valid().
    BoatProfile bad = defaultBoatProfile();
    bad.hull_count = 4;
    CHECK(!bad.valid());
    bad = defaultBoatProfile();
    bad.hull_count = 0;
    CHECK(!bad.valid());
    bad = defaultBoatProfile();
    bad.cda_front_m2 = 0.0f;
    CHECK(!bad.valid());
    bad = defaultBoatProfile();
    bad.displacement_kg = -1.0f;
    CHECK(!bad.valid());
}

TEST(profile_parse_errors) {
    BoatProfile p;
    std::string err;
    CHECK(!parseBoatProfile("{}", &p, &err));
    CHECK(err == "missing schema_version");

    CHECK(!parseBoatProfile("{\"schema_version\": 1}", &p, &err));
    CHECK(err.find("missing field") != std::string::npos);

    // All numeric fields present but no curve.
    std::string base =
        "{\"schema_version\":1,\"pv_kwp\":1,\"pv_derating\":0.8,"
        "\"battery_capacity_kwh\":2.5,\"battery_usable_min_soc_pct\":10,"
        "\"battery_max_charge_w\":1000,\"battery_max_discharge_w\":2000,"
        "\"hotel_load_w\":50,\"motor_max_power_w\":1000";
    CHECK(!parseBoatProfile(base + "}", &p, &err));
    CHECK(err.find("hull_efficiency_curve") != std::string::npos);

    // Curve present but out-of-range profile value.
    std::string curve =
        ",\"hull_efficiency_curve_kmh_whkm\":[[3.0,85.0],[5.0,120.0]]";
    std::string bad = base + curve + "}";
    bad.replace(bad.find("\"pv_kwp\":1"), 10, "\"pv_kwp\":0");
    CHECK(!parseBoatProfile(bad, &p, &err));
    CHECK(err == "profile values out of range");

    // Fully valid.
    CHECK(parseBoatProfile(base + curve + "}", &p, &err));
    CHECK(p.valid());
}

TEST(profile_parse_malformed_values) {
    BoatProfile p;
    std::string err;
    // schema_version present but not a number.
    CHECK(!parseBoatProfile("{\"schema_version\": true}", &p, &err));
    // Key without a colon/value.
    CHECK(!parseBoatProfile("{\"schema_version\"", &p, &err));
    // Malformed curve entries.
    std::string base =
        "{\"schema_version\":1,\"pv_kwp\":1,\"pv_derating\":0.8,"
        "\"battery_capacity_kwh\":2.5,\"battery_usable_min_soc_pct\":10,"
        "\"battery_max_charge_w\":1000,\"battery_max_discharge_w\":2000,"
        "\"hotel_load_w\":50,\"motor_max_power_w\":1000,"
        "\"hull_efficiency_curve_kmh_whkm\":";
    CHECK(!parseBoatProfile(base + "[[3.0;85.0]]}", &p, &err));   // bad sep
    CHECK(!parseBoatProfile(base + "[[3.0,]]}", &p, &err));       // no second
    CHECK(!parseBoatProfile(base + "42}", &p, &err));             // not array
    CHECK(!parseBoatProfile(base + "[[]}", &p, &err));            // no pair
    CHECK(!parseBoatProfile(base + "[[3.0,85.0]", &p, &err));     // truncated
}

TEST(profile_validity_rules) {
    BoatProfile p = defaultBoatProfile();
    CHECK(p.valid());
    BoatProfile bad = p;
    bad.schema_version = 2;
    CHECK(!bad.valid());
    bad = p;
    bad.hull_curve.resize(1);
    CHECK(!bad.valid());
    bad = p;
    bad.hull_curve[0].speed_kmh = -1.0f;
    CHECK(!bad.valid());
    bad = p;
    bad.hull_curve[1].wh_per_km = 0.0f;
    CHECK(!bad.valid());
    bad = p;
    bad.hull_curve[1].speed_kmh = bad.hull_curve[0].speed_kmh;  // not ascending
    CHECK(!bad.valid());
    bad = p;
    bad.pv_derating = 1.5f;
    CHECK(!bad.valid());
    bad = p;
    bad.battery_usable_min_soc_pct = 100.0f;
    CHECK(!bad.valid());
}

TEST(profile_power_for_speed) {
    const BoatProfile p = defaultBoatProfile();
    // On a curve point: P = Wh/km * km/h.
    CHECK_NEAR(p.powerForSpeedW(5.0f), 120.0f * 5.0f, 1e-2);
    CHECK_NEAR(p.powerForSpeedW(7.0f), 286.0f * 7.0f, 1e-2);
    // Interpolated between 5.0 and 5.7.
    const float mid = p.powerForSpeedW(5.35f);
    CHECK(mid > 120.0f * 5.0f);
    CHECK(mid < 140.0f * 5.7f);
    // Below the curve: cubic scaling from the first point.
    const float p0 = 85.0f * 3.0f;
    CHECK_NEAR(p.powerForSpeedW(1.5f), p0 * 0.5f * 0.5f * 0.5f, 1e-2);
    // Above the curve: cubic scaling from the last point.
    const float pn = 286.0f * 7.0f;
    CHECK_NEAR(p.powerForSpeedW(14.0f), pn * 8.0f, 1e-1);
}

TEST(profile_speed_for_power_and_roundtrip) {
    const BoatProfile p = defaultBoatProfile();
    CHECK_NEAR(p.speedForPowerKmh(0.0f), 0.0f, 1e-6);
    CHECK_NEAR(p.speedForPowerKmh(-50.0f), 0.0f, 1e-6);
    // Below first point.
    CHECK(p.speedForPowerKmh(100.0f) < 3.0f);
    // Above last point.
    CHECK(p.speedForPowerKmh(3000.0f) > 7.0f);
    // Round-trip on curve points and between them.
    for (float v = 3.0f; v <= 7.0f; v += 0.35f) {
        const float watts = p.powerForSpeedW(v);
        const float back = p.speedForPowerKmh(watts);
        CHECK_NEAR(back, v, 0.15f);
    }
}

TEST_MAIN()
