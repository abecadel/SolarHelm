#include "simc/sim_drivers.h"

namespace simc {

void SimulatedShunt::feed(uint32_t t_ms, float voltage_v, float current_a,
                          float power_w, float soc_pct) {
    if (failed_) {
        return;  // a dead shunt stops updating; its last sample goes stale
    }
    last_.valid = true;
    last_.timestamp_ms = t_ms;
    last_.voltage_v = voltage_v;
    last_.current_a = current_a;
    last_.power_w = power_w;
    last_.soc_pct = soc_pct;
}

sh::BatterySample SimulatedShunt::read() { return last_; }

void SimulatedSolarMonitor::feed(uint32_t t_ms, float power_w) {
    if (failed_) {
        return;
    }
    last_.valid = true;
    last_.timestamp_ms = t_ms;
    last_.power_w = power_w;
}

sh::SolarSample SimulatedSolarMonitor::read() { return last_; }

void SimulatedGps::feed(uint32_t t_ms, float speed_mps, double lat_deg,
                        double lon_deg) {
    if (failed_) {
        return;
    }
    last_.valid = true;
    last_.timestamp_ms = t_ms;
    last_.speed_mps = speed_mps;
    last_.latitude_deg = lat_deg;
    last_.longitude_deg = lon_deg;
    last_.fix_quality = 1;
    last_.satellites = 10;
}

sh::GpsSample SimulatedGps::read() { return last_; }

void SimulatorThrottle::write(float cmd_pct) {
    // Defensive clamp mirroring what a real DAC driver must do.
    if (cmd_pct < 0.0f) {
        cmd_pct = 0.0f;
    } else if (cmd_pct > 100.0f) {
        cmd_pct = 100.0f;
    }
    last_cmd_pct_ = cmd_pct;
}

}  // namespace simc
