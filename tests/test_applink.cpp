// AppLink tests: telemetry JSON serialization and the remote-command
// parser that stands between the phone and the throttle.

#include <cstring>
#include <string>

#include "framework.h"
#include "sh/net/applink.h"

using sh::RemoteCommand;
using sh::TelemetryRecord;

TEST(telemetry_json_carries_every_field) {
    TelemetryRecord r;
    r.timestamp_ms = 123456;
    r.mode = 2;
    r.battery_voltage_v = 25.61f;
    r.battery_current_a = -3.20f;
    r.battery_power_w = -81.9f;
    r.battery_soc_pct = 76.5f;
    r.solar_power_w = 412.0f;
    r.motor_command_pct = 43.5f;
    r.motor_estimated_power_w = 495.0f;
    r.speed_kmh = 5.42f;
    r.distance_today_km = 12.345f;
    r.energy_solar_today_wh = 1500.5f;
    r.energy_motor_today_wh = 1300.0f;
    r.energy_hotel_today_wh = 240.0f;
    r.efficiency_wh_km = 91.3f;
    r.reserve_soc_pct = 25.0f;
    r.fault_flags = 0x1042;

    char buf[512];
    const int n = sh::writeTelemetryJson(r, buf, sizeof(buf));
    CHECK(n > 0);
    CHECK(static_cast<size_t>(n) < sizeof(buf));
    const std::string json(buf);
    CHECK(json.front() == '{');
    CHECK(json.back() == '}');
    CHECK(json.find("\"timestamp_ms\":123456") != std::string::npos);
    CHECK(json.find("\"mode\":2") != std::string::npos);
    CHECK(json.find("\"battery_voltage_v\":25.61") != std::string::npos);
    CHECK(json.find("\"battery_current_a\":-3.20") != std::string::npos);
    CHECK(json.find("\"battery_power_w\":-81.9") != std::string::npos);
    CHECK(json.find("\"speed_kmh\":5.42") != std::string::npos);
    CHECK(json.find("\"distance_today_km\":12.345") != std::string::npos);
    CHECK(json.find("\"fault_flags\":4162") != std::string::npos);
    CHECK(json.find("\"latitude_deg\":0.000000") != std::string::npos);
    r.latitude_deg = 43.5081;
    r.longitude_deg = 16.4402;
    sh::writeTelemetryJson(r, buf, sizeof(buf));
    const std::string json2(buf);
    CHECK(json2.find("\"latitude_deg\":43.508100") != std::string::npos);
    CHECK(json2.find("\"longitude_deg\":16.440200") != std::string::npos);
}

TEST(telemetry_json_reports_truncation) {
    TelemetryRecord r;
    char tiny[32];
    const int n = sh::writeTelemetryJson(r, tiny, sizeof(tiny));
    CHECK(n >= static_cast<int>(sizeof(tiny)));  // snprintf-style contract
}

TEST(telemetry_json_worst_case_fits_the_firmware_buffer) {
    // The firmware serves the record from a 768-byte buffer; a pessimal
    // record (max timestamp, negative multi-digit powers, huge daily Wh,
    // silly efficiency, full-precision position) must fit.
    TelemetryRecord r;
    r.timestamp_ms = 4294967295u;
    r.mode = 255;
    r.battery_voltage_v = -99.99f;
    r.battery_current_a = -999.99f;
    r.battery_power_w = -99999.9f;
    r.battery_soc_pct = 100.0f;
    r.solar_power_w = 99999.9f;
    r.motor_command_pct = 100.0f;
    r.motor_estimated_power_w = 99999.9f;
    r.speed_kmh = 99.99f;
    r.distance_today_km = 9999.9999f;
    r.energy_solar_today_wh = 9999999.0f;
    r.energy_motor_today_wh = 9999999.0f;
    r.energy_hotel_today_wh = 9999999.0f;
    r.efficiency_wh_km = 99999999.0f;
    r.reserve_soc_pct = 100.0f;
    r.fault_flags = 0xFFFF;
    r.latitude_deg = -89.999999;
    r.longitude_deg = -179.999999;
    char buf[768];
    const int n = sh::writeTelemetryJson(r, buf, sizeof(buf));
    CHECK(n > 0);
    CHECK(n < static_cast<int>(sizeof(buf)));
}

TEST(remote_command_accepts_a_plain_target) {
    const char body[] = "{\"target_w\": 350.5}";
    const RemoteCommand c = sh::parseRemoteCommand(body, sizeof(body) - 1);
    CHECK(c.valid);
    CHECK_NEAR(c.target_w, 350.5f, 1e-4);
}

TEST(remote_command_tolerates_extra_keys_and_whitespace) {
    const char body[] =
        "{ \"mode\": \"remote\", \"target_w\" \t: \t042e1 , \"seq\": 9 }";
    const RemoteCommand c = sh::parseRemoteCommand(body, sizeof(body) - 1);
    CHECK(c.valid);
    CHECK_NEAR(c.target_w, 420.0f, 1e-4);
}

TEST(remote_command_accepts_zero_and_the_cap) {
    const char zero[] = "{\"target_w\":0}";
    CHECK(sh::parseRemoteCommand(zero, sizeof(zero) - 1).valid);
    const char cap[] = "{\"target_w\":100000}";
    CHECK(sh::parseRemoteCommand(cap, sizeof(cap) - 1).valid);
}

TEST(remote_command_rejects_garbage) {
    const struct { const char* body; } cases[] = {
        {""},                                  // empty
        {"{}"},                                // no key
        {"{\"target\": 300}"},                 // wrong key
        {"{\"target_w\"}"},                    // no colon
        {"{\"target_w\": }"},                  // no value
        {"{\"target_w\": \"350\"}"},           // quoted string, not a number
        {"{\"target_w\": nan}"},               // not a number token
        {"{\"target_w\": -5}"},                // negative
        {"{\"target_w\": 100001}"},            // above the cap
        {"{\"target_w\": 1e400}"},             // overflows to infinity
        {"{\"target_w\": 1.2.3}"},             // junk inside the token
        {"{\"target_w\":"},                    // truncated body
        {"{\"target_w\" x: 3}"},               // junk before the colon
    };
    for (const auto& tc : cases) {
        const RemoteCommand c =
            sh::parseRemoteCommand(tc.body, std::strlen(tc.body));
        CHECK(!c.valid);
    }
    CHECK(!sh::parseRemoteCommand(nullptr, 5).valid);
}

TEST(remote_command_number_token_is_length_bounded) {
    // A number token longer than the internal buffer parses from the
    // bounded prefix only if that prefix is itself a complete number; a
    // 40-digit integer prefix is valid but over the cap -> rejected.
    std::string body = "{\"target_w\": ";
    body.append(40, '9');
    body += "}";
    CHECK(!sh::parseRemoteCommand(body.c_str(), body.size()).valid);
}

TEST(config_json_serializes_every_whitelisted_field) {
    sh::ControlConfig cfg;
    char buf[768];
    const int n = sh::writeConfigJson(cfg, buf, sizeof(buf));
    CHECK(n > 0);
    CHECK(static_cast<size_t>(n) < sizeof(buf));
    const std::string json(buf);
    CHECK(json.front() == '{');
    CHECK(json.back() == '}');
    for (size_t i = 0; i < sh::kConfigFieldCount; ++i) {
        CHECK(json.find(std::string("\"") + sh::kConfigFields[i].name +
                        "\":") != std::string::npos);
    }
    // The protection envelope is deliberately absent from the wire.
    CHECK(json.find("sag_soft_v") == std::string::npos);
    CHECK(json.find("max_discharge_current_a") == std::string::npos);
}

TEST(config_json_reports_truncation) {
    sh::ControlConfig cfg;
    char tiny[16];
    const int n = sh::writeConfigJson(cfg, tiny, sizeof(tiny));
    CHECK(n >= static_cast<int>(sizeof(tiny)));
}

TEST(config_patch_applies_and_validates) {
    sh::ControlConfig cfg;
    sh::ControlConfig out;
    const char body[] =
        "{\"deadband_w\": 40, \"reserve_soc_pct\": 30, \"ignored\": 1}";
    const auto r = sh::applyConfigPatch(cfg, body, sizeof(body) - 1, &out);
    CHECK(r.valid);
    CHECK(r.fields_applied == 2);
    CHECK_NEAR(out.deadband_w, 40.0f, 1e-6);
    CHECK_NEAR(out.reserve_soc_pct, 30.0f, 1e-6);
    CHECK_NEAR(out.kp_pct_per_w, cfg.kp_pct_per_w, 1e-9);  // untouched
}

TEST(config_patch_rejects_bad_input) {
    sh::ControlConfig cfg;
    sh::ControlConfig out;
    // Nothing recognized.
    CHECK(!sh::applyConfigPatch(cfg, "{}", 2, &out).valid);
    CHECK(!sh::applyConfigPatch(cfg, nullptr, 4, &out).valid);
    CHECK(!sh::applyConfigPatch(cfg, "{\"sag_soft_v\": 20}", 18,
                                &out).valid);  // envelope not writable
    // Recognized key, malformed value: whole patch rejected, and the
    // rejection says WHY (the firmware surfaces `malformed`).
    const char bad[] = "{\"deadband_w\": nan}";
    const auto mal = sh::applyConfigPatch(cfg, bad, sizeof(bad) - 1, &out);
    CHECK(!mal.valid);
    CHECK(mal.malformed);
    const char nocolon[] = "{\"deadband_w\" 40}";
    CHECK(sh::applyConfigPatch(cfg, nocolon, sizeof(nocolon) - 1,
                               &out).malformed);
    // Empty/unknown patches are invalid but NOT malformed.
    CHECK(!sh::applyConfigPatch(cfg, "{}", 2, &out).malformed);
    // Valid syntax, invalid semantics: core validation is the gate.
    const char invalid[] = "{\"deadband_w\": -5}";
    const auto r = sh::applyConfigPatch(cfg, invalid, sizeof(invalid) - 1,
                                        &out);
    CHECK(!r.valid);
    CHECK(r.error != sh::ConfigError::kNone);
}

TEST_MAIN()
