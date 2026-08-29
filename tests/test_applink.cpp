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
}

TEST(telemetry_json_reports_truncation) {
    TelemetryRecord r;
    char tiny[32];
    const int n = sh::writeTelemetryJson(r, tiny, sizeof(tiny));
    CHECK(n >= static_cast<int>(sizeof(tiny)));  // snprintf-style contract
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

TEST_MAIN()
