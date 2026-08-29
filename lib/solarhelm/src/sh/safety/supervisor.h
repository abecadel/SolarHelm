// SafetySupervisor — data-freshness and plausibility watchdog for the
// control loop. It never touches the throttle itself; it produces a verdict
// the Helm orchestrator must obey: when allow_auto is false, automatic mode
// is exited and the automatic throttle command is forced to zero.
//
// Design notes (see docs/SAFETY.md for the full fail-safe list):
//  - Battery (shunt) data is the control input. Stale or invalid battery
//    data -> auto modes are not allowed (fail-safe requirement 5/6).
//  - GPS is NOT control-critical; stale GPS only raises a flag and pauses
//    distance/efficiency accounting.
//  - Plausibility: obviously impossible battery samples (negative SOC,
//    absurd voltage) are rejected even when fresh.

#pragma once

#include <cstdint>

#include "sh/core/config.h"
#include "sh/core/samples.h"

namespace sh {

// Telemetry fault bits (uint16 in the telemetry record).
enum FaultFlag : uint16_t {
    kFaultBatteryStale = 1u << 0,
    kFaultBatteryImplausible = 1u << 1,
    kFaultGpsStale = 1u << 2,
    kFaultSocAtReserve = 1u << 3,   // informational: reserve floor active
    kFaultConfigInvalid = 1u << 4,
    kFaultSolarStale = 1u << 5,     // MPPT telemetry stale; PV treated as 0
    // Battery protection envelope (BatteryGuard):
    kFaultSagSoft = 1u << 6,        // voltage sag: soft command cap active
    kFaultSagHard = 1u << 7,        // voltage sag: hard command cap active
    kFaultSagStop = 1u << 8,        // voltage sag: graceful stop issued
    kFaultOverCurrent = 1u << 9,    // discharge current cap engaged
    kFaultBattTempDerate = 1u << 10,   // battery too cold/hot: derated
    kFaultChargeBelowFreezing = 1u << 11,  // charging while <= 0 degC (alert)
    kFaultRemoteStale = 1u << 12,   // phone target stale -> degraded to SOLAR
};

struct SafetyVerdict {
    bool allow_auto = false;   // false -> Helm must drop to MANUAL, cmd 0
    bool battery_ok = false;   // battery sample fresh and plausible
    bool gps_ok = false;       // GPS fresh (efficiency tracking allowed)
    bool solar_ok = false;     // MPPT telemetry fresh (PV readable)
    uint16_t faults = 0;       // FaultFlag bitmask
};

class SafetySupervisor {
public:
    explicit SafetySupervisor(const ControlConfig& cfg);

    SafetyVerdict evaluate(uint32_t now_ms, const BatterySample& battery,
                           const SolarSample& solar,
                           const GpsSample& gps) const;

    // Plausibility limits for a 12-58 V marine system; wide on purpose,
    // they only reject physically impossible readings.
    static bool batteryPlausible(const BatterySample& s);

private:
    const ControlConfig& cfg_;
};

}  // namespace sh
