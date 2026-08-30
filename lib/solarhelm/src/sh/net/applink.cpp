#include "sh/net/applink.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace sh {

int writeTelemetryJson(const TelemetryRecord& r, char* buf, size_t buf_len) {
    return std::snprintf(
        buf, buf_len,
        "{\"timestamp_ms\":%lu,\"mode\":%u,"
        "\"battery_voltage_v\":%.2f,\"battery_current_a\":%.2f,"
        "\"battery_power_w\":%.1f,\"battery_soc_pct\":%.1f,"
        "\"solar_power_w\":%.1f,\"motor_command_pct\":%.1f,"
        "\"motor_estimated_power_w\":%.1f,\"speed_kmh\":%.2f,"
        "\"distance_today_km\":%.3f,\"energy_solar_today_wh\":%.1f,"
        "\"energy_motor_today_wh\":%.1f,\"energy_hotel_today_wh\":%.1f,"
        "\"efficiency_wh_km\":%.1f,\"reserve_soc_pct\":%.1f,"
        "\"fault_flags\":%u,\"latitude_deg\":%.6f,\"longitude_deg\":%.6f,"
        "\"config_revision\":%.0f,\"roll_deg\":%.1f,\"pitch_deg\":%.1f}",
        static_cast<unsigned long>(r.timestamp_ms),
        static_cast<unsigned>(r.mode),
        static_cast<double>(r.battery_voltage_v),
        static_cast<double>(r.battery_current_a),
        static_cast<double>(r.battery_power_w),
        static_cast<double>(r.battery_soc_pct),
        static_cast<double>(r.solar_power_w),
        static_cast<double>(r.motor_command_pct),
        static_cast<double>(r.motor_estimated_power_w),
        static_cast<double>(r.speed_kmh),
        static_cast<double>(r.distance_today_km),
        static_cast<double>(r.energy_solar_today_wh),
        static_cast<double>(r.energy_motor_today_wh),
        static_cast<double>(r.energy_hotel_today_wh),
        static_cast<double>(r.efficiency_wh_km),
        static_cast<double>(r.reserve_soc_pct),
        static_cast<unsigned>(r.fault_flags), r.latitude_deg,
        r.longitude_deg, static_cast<double>(r.config_revision),
        static_cast<double>(r.roll_deg), static_cast<double>(r.pitch_deg));
}

static int findNumberField(const char* body, size_t len, const char* name,
                           double* value);
static int findStringField(const char* body, size_t len, const char* name,
                           char* out, size_t out_len);

// Maps a wire mode name onto sh::Mode; false for anything unknown.
static bool modeFromName(const char* name, Mode* out) {
    if (std::strcmp(name, "manual") == 0) { *out = Mode::kManual; }
    else if (std::strcmp(name, "solar") == 0) { *out = Mode::kSolar; }
    else if (std::strcmp(name, "solar+") == 0) { *out = Mode::kSolarPlus; }
    else if (std::strcmp(name, "range") == 0) { *out = Mode::kRange; }
    else if (std::strcmp(name, "arrival") == 0) { *out = Mode::kArrival; }
    else if (std::strcmp(name, "remote") == 0) { *out = Mode::kRemote; }
    else { return false; }
    return true;
}

RemoteCommand parseRemoteCommand(const char* body, size_t len) {
    RemoteCommand out;
    const RemoteCommand invalid;
    if (body == nullptr || len == 0) return out;

    double v = 0.0;
    int rc = findNumberField(body, len, "target_w", &v);
    if (rc < 0) return invalid;
    if (rc == 1) {
        if (v < 0.0 || v > static_cast<double>(kRemoteTargetMaxW)) {
            return invalid;
        }
        out.has_target = true;
        out.target_w = static_cast<float>(v);
    }

    rc = findNumberField(body, len, "arrival_battery_w", &v);
    if (rc < 0) return invalid;
    if (rc == 1) {
        if (v < -static_cast<double>(kArrivalBudgetMaxW) ||
            v > static_cast<double>(kArrivalBudgetMaxW)) {
            return invalid;
        }
        out.has_arrival = true;
        out.arrival_battery_w = static_cast<float>(v);
    }

    char mode_name[16];
    rc = findStringField(body, len, "mode", mode_name, sizeof(mode_name));
    if (rc < 0) return invalid;
    if (rc == 1) {
        if (!modeFromName(mode_name, &out.mode)) return invalid;
        out.has_mode = true;
    }

    out.valid = out.has_target || out.has_arrival || out.has_mode;
    return out;
}

const ConfigField kConfigFields[] = {
    {"kp_pct_per_w", &ControlConfig::kp_pct_per_w},
    {"ki_pct_per_ws", &ControlConfig::ki_pct_per_ws},
    {"deadband_w", &ControlConfig::deadband_w},
    {"filter_time_constant_s", &ControlConfig::filter_time_constant_s},
    {"max_ramp_up_pct_per_s", &ControlConfig::max_ramp_up_pct_per_s},
    {"max_ramp_down_pct_per_s", &ControlConfig::max_ramp_down_pct_per_s},
    {"max_motor_cmd_pct", &ControlConfig::max_motor_cmd_pct},
    {"solar_plus_target_w", &ControlConfig::solar_plus_target_w},
    {"reserve_soc_pct", &ControlConfig::reserve_soc_pct},
    {"reserve_hysteresis_pct", &ControlConfig::reserve_hysteresis_pct},
    {"motor_max_power_w", &ControlConfig::motor_max_power_w},
    // APPEND ONLY: NVS persists these by index (f0..fN, firmware/main.cpp).
    {"range_motor_power_w", &ControlConfig::range_motor_power_w},
    {"config_revision", &ControlConfig::config_revision},
};
const size_t kConfigFieldCount =
    sizeof(kConfigFields) / sizeof(kConfigFields[0]);

int writeConfigJson(const ControlConfig& cfg, char* buf, size_t buf_len) {
    size_t pos = 0;
    int n = std::snprintf(buf, buf_len, "{");
    pos += static_cast<size_t>(n);
    for (size_t i = 0; i < kConfigFieldCount; ++i) {
        n = std::snprintf(pos < buf_len ? buf + pos : nullptr,
                          pos < buf_len ? buf_len - pos : 0,
                          "%s\"%s\":%.4f", i == 0 ? "" : ",",
                          kConfigFields[i].name,
                          static_cast<double>(cfg.*(kConfigFields[i].member)));
        pos += static_cast<size_t>(n);
    }
    n = std::snprintf(pos < buf_len ? buf + pos : nullptr,
                      pos < buf_len ? buf_len - pos : 0, "}");
    pos += static_cast<size_t>(n);
    return static_cast<int>(pos);
}

// Finds `"name"` in body and parses the number after the colon into
// *value. Returns 0 when absent, 1 on success, -1 on a malformed value.
static int findNumberField(const char* body, size_t len, const char* name,
                           double* value) {
    // Whitelist names are short; the buffer is bounded either way, and a
    // (theoretically) truncated key simply never matches -> field absent.
    char key[64];
    std::snprintf(key, sizeof(key), "\"%s\"", name);
    const size_t key_len = std::strlen(key);
    size_t pos = 0;
    bool found = false;
    while (pos + key_len <= len) {
        if (std::memcmp(body + pos, key, key_len) == 0) {
            found = true;
            pos += key_len;
            break;
        }
        ++pos;
    }
    if (!found) return 0;
    while (pos < len && (body[pos] == ' ' || body[pos] == '\t')) ++pos;
    if (pos >= len || body[pos] != ':') return -1;
    ++pos;
    while (pos < len && (body[pos] == ' ' || body[pos] == '\t')) ++pos;
    char num[32];
    size_t n = 0;
    while (pos < len && n + 1 < sizeof(num)) {
        const char c = body[pos];
        const bool number_char =
            (c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' ||
            c == 'e' || c == 'E';
        if (!number_char) break;
        num[n++] = c;
        ++pos;
    }
    if (n == 0) return -1;
    num[n] = '\0';
    char* end = nullptr;
    const double v = std::strtod(num, &end);
    if (end != num + n || !std::isfinite(v)) return -1;
    *value = v;
    return 1;
}

// Finds `"name"` in body and copies the quoted string value after the
// colon into out. Returns 0 when absent, 1 on success, -1 when the value
// is not a quoted string that fits out_len.
static int findStringField(const char* body, size_t len, const char* name,
                           char* out, size_t out_len) {
    char key[64];
    std::snprintf(key, sizeof(key), "\"%s\"", name);
    const size_t key_len = std::strlen(key);
    size_t pos = 0;
    bool found = false;
    while (pos + key_len <= len) {
        if (std::memcmp(body + pos, key, key_len) == 0) {
            found = true;
            pos += key_len;
            break;
        }
        ++pos;
    }
    if (!found) return 0;
    while (pos < len && (body[pos] == ' ' || body[pos] == '\t')) ++pos;
    if (pos >= len || body[pos] != ':') return -1;
    ++pos;
    while (pos < len && (body[pos] == ' ' || body[pos] == '\t')) ++pos;
    if (pos >= len || body[pos] != '"') return -1;
    ++pos;
    size_t n = 0;
    while (pos < len && body[pos] != '"') {
        if (n + 1 >= out_len) return -1;  // longer than any known value
        out[n++] = body[pos++];
    }
    if (pos >= len) return -1;  // unterminated string
    out[n] = '\0';
    return 1;
}

ConfigPatchResult applyConfigPatch(const ControlConfig& current,
                                   const char* body, size_t len,
                                   ControlConfig* out) {
    ConfigPatchResult result;
    if (body == nullptr || len == 0) return result;
    ControlConfig candidate = current;
    for (size_t i = 0; i < kConfigFieldCount; ++i) {
        double value = 0.0;
        const int rc = findNumberField(body, len, kConfigFields[i].name,
                                       &value);
        if (rc < 0) {  // present but malformed: reject the whole patch
            result.malformed = true;
            return result;
        }
        if (rc == 1) {
            candidate.*(kConfigFields[i].member) = static_cast<float>(value);
            ++result.fields_applied;
        }
    }
    if (result.fields_applied == 0) return result;
    result.error = candidate.validate();
    if (result.error != ConfigError::kNone) return result;
    result.valid = true;
    *out = candidate;
    return result;
}

}  // namespace sh
