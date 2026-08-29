#include "sh/telemetry/telemetry.h"

#include <cstdio>

namespace sh {

const char* telemetryCsvHeader() {
    return "timestamp_ms,mode,battery_voltage_v,battery_current_a,"
           "battery_power_w,battery_soc_pct,solar_power_w,motor_command_pct,"
           "motor_estimated_power_w,speed_kmh,distance_today_km,"
           "energy_solar_today_wh,energy_motor_today_wh,energy_hotel_today_wh,"
           "efficiency_wh_km,reserve_soc_pct,fault_flags";
}

int writeCsvRow(const TelemetryRecord& r, char* buf, size_t buf_len) {
    return snprintf(
        buf, buf_len,
        "%lu,%u,%.2f,%.2f,%.1f,%.2f,%.1f,%.2f,%.1f,%.2f,%.4f,%.1f,%.1f,%.1f,"
        "%.1f,%.1f,%u",
        static_cast<unsigned long>(r.timestamp_ms),
        static_cast<unsigned>(r.mode), static_cast<double>(r.battery_voltage_v),
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

}  // namespace sh
