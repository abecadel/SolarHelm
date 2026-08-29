// Simulated drivers — the sh:: hardware interfaces backed by sim models.
//
// These are the "plugins" the desktop build injects into the core instead
// of real hardware: SimulatedShunt plays the Victron SmartShunt,
// SimulatedSolarMonitor the MPPT telemetry, SimulatedGps the GNSS module
// and SimulatorThrottle the DAC output. Each supports failure injection so
// scenarios can prove the fail-safe behaviour.

#pragma once

#include "sh/drivers/interfaces.h"

namespace simc {

class SimulatedShunt : public sh::IBatteryMonitor {
public:
    void feed(uint32_t t_ms, float voltage_v, float current_a, float power_w,
              float soc_pct);
    void setFailed(bool failed) { failed_ = failed; }
    sh::BatterySample read() override;

private:
    sh::BatterySample last_;
    bool failed_ = false;
};

class SimulatedSolarMonitor : public sh::ISolarMonitor {
public:
    void feed(uint32_t t_ms, float power_w);
    void setFailed(bool failed) { failed_ = failed; }
    sh::SolarSample read() override;

private:
    sh::SolarSample last_;
    bool failed_ = false;
};

class SimulatedGps : public sh::IGps {
public:
    void feed(uint32_t t_ms, float speed_mps, double lat_deg, double lon_deg);
    void setFailed(bool failed) { failed_ = failed; }
    sh::GpsSample read() override;

private:
    sh::GpsSample last_;
    bool failed_ = false;
};

// Captures the automatic throttle command like a DAC would receive it.
class SimulatorThrottle : public sh::IThrottleOutput {
public:
    void write(float cmd_pct) override;
    float lastCmdPct() const { return last_cmd_pct_; }

private:
    float last_cmd_pct_ = 0.0f;
};

}  // namespace simc
