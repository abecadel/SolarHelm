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
        "\"fault_flags\":%u}",
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
        static_cast<unsigned>(r.fault_flags));
}

RemoteCommand parseRemoteCommand(const char* body, size_t len) {
    RemoteCommand out;
    if (body == nullptr || len == 0) return out;

    static const char kKey[] = "\"target_w\"";
    const size_t key_len = sizeof(kKey) - 1;
    size_t pos = 0;
    bool found = false;
    while (pos + key_len <= len) {
        if (std::memcmp(body + pos, kKey, key_len) == 0) {
            found = true;
            pos += key_len;
            break;
        }
        ++pos;
    }
    if (!found) return out;

    while (pos < len && (body[pos] == ' ' || body[pos] == '\t')) ++pos;
    if (pos >= len || body[pos] != ':') return out;
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
    if (n == 0) return out;
    num[n] = '\0';

    char* end = nullptr;
    const double value = std::strtod(num, &end);
    if (end != num + n) return out;  // trailing junk inside the token
    if (!std::isfinite(value) || value < 0.0 ||
        value > static_cast<double>(kRemoteTargetMaxW)) {
        return out;
    }
    out.valid = true;
    out.target_w = static_cast<float>(value);
    return out;
}

}  // namespace sh
