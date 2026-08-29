#include "sh/safety/supervisor.h"

namespace sh {

SafetySupervisor::SafetySupervisor(const ControlConfig& cfg) : cfg_(cfg) {}

bool SafetySupervisor::batteryPlausible(const BatterySample& s) {
    if (s.soc_pct < 0.0f || s.soc_pct > 100.0f) {
        return false;
    }
    if (s.voltage_v < 6.0f || s.voltage_v > 70.0f) {
        return false;
    }
    if (s.current_a < -1000.0f || s.current_a > 1000.0f) {
        return false;
    }
    return true;
}

SafetyVerdict SafetySupervisor::evaluate(uint32_t now_ms,
                                         const BatterySample& battery,
                                         const SolarSample& solar,
                                         const GpsSample& gps) const {
    SafetyVerdict v;

    const bool battery_fresh =
        battery.valid && (now_ms - battery.timestamp_ms) <= cfg_.battery_timeout_ms;
    if (!battery_fresh) {
        v.faults |= kFaultBatteryStale;
    } else if (!batteryPlausible(battery)) {
        v.faults |= kFaultBatteryImplausible;
    } else {
        v.battery_ok = true;
    }

    const bool gps_fresh =
        gps.valid && (now_ms - gps.timestamp_ms) <= cfg_.gps_timeout_ms;
    if (gps_fresh) {
        v.gps_ok = true;
    } else {
        v.faults |= kFaultGpsStale;
    }

    const bool solar_fresh =
        solar.valid && (now_ms - solar.timestamp_ms) <= cfg_.solar_timeout_ms;
    if (solar_fresh) {
        v.solar_ok = true;
    } else {
        v.faults |= kFaultSolarStale;
    }

    v.allow_auto = v.battery_ok;
    return v;
}

}  // namespace sh
