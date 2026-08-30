// Helm — the SolarHelm orchestrator.
//
// One instance owns the whole decision chain for a control tick:
//
//   sensor samples -> SafetySupervisor -> ModeManager -> BatteryPowerController
//                 -> throttle command + telemetry record
//
// Helm is hardware-free: it consumes samples and RETURNS the command; the
// caller (simulator harness or ESP32 firmware) pushes the command into an
// IThrottleOutput. That keeps this file byte-for-byte identical between
// desktop and embedded builds.
//
// Fail-safe behaviour built in (docs/SAFETY.md):
//  - constructed in MANUAL with zero command; auto never resumes after boot
//  - auto activation requires an explicit requestMode() AND healthy sensors
//  - losing battery data mid-cruise -> forced MANUAL, command 0
//  - at/below reserve SOC the battery-power target is floored at 0 W
//  - the returned command is always inside [min,max] config limits

#pragma once

#include <cstdint>

#include "sh/control/mode_manager.h"
#include "sh/control/power_controller.h"
#include "sh/control/ratelimit.h"
#include "sh/core/config.h"
#include "sh/core/samples.h"
#include "sh/energy/tracker.h"
#include "sh/safety/battery_guard.h"
#include "sh/safety/supervisor.h"
#include "sh/telemetry/telemetry.h"

namespace sh {

struct HelmOutput {
    // True when SolarHelm is in an automatic mode and its command is valid.
    // False means MANUAL: the hardware layer must give the physical throttle
    // authority and drive the automatic output to zero.
    bool auto_active = false;
    float motor_cmd_pct = 0.0f;
    TelemetryRecord telemetry;
};

class Helm {
public:
    // The config must outlive the Helm. An invalid config permanently locks
    // the Helm in MANUAL (kFaultConfigInvalid is raised every tick).
    Helm(const ControlConfig& cfg, ITransitionLogger* logger);

    // Explicit user mode request (fail-safe rule: automatic control must be
    // explicitly activated). Returns false when refused.
    bool requestMode(Mode mode, uint32_t now_ms);

    // Immediate drop to MANUAL (user override, kill switch sensed, ...).
    void forceManual(const char* reason, uint32_t now_ms);

    // REMOTE mode: the phone planner streams a motor-power target here.
    // Entering kRemote is refused without a fresh target; a target older
    // than cfg.remote_timeout_ms degrades the mode to SOLAR (the ESP32
    // never depends on the phone for safety). The target passes through
    // the same ramps, protection-envelope ceiling and reserve-SOC floor
    // as every other automatic mode.
    void setRemoteTarget(float motor_power_w, uint32_t now_ms);

    // ARRIVAL mode: the phone's voyage plan streams a battery-power budget
    // (negative = permitted net discharge, clamped to +/-5000 W). Same
    // freshness contract as REMOTE: entering kArrival is refused without a
    // fresh budget, and a budget older than cfg.remote_timeout_ms degrades
    // the mode to SOLAR. The budget is tracked closed-loop and the
    // reserve-SOC floor still applies.
    void setArrivalBudget(float battery_power_w, uint32_t now_ms);

    // Attitude feed (Helios L8): advisory only — stamped into telemetry
    // for wave-state/stability learning, never in the safety path. Call
    // whenever the IMU produces a sample; absent an IMU, telemetry
    // carries 0.0.
    void setImuSample(const ImuSample& imu) { imu_ = imu; }

    // One control tick: dt_s since the previous step; samples may be stale
    // or invalid — Helm decides what is trustworthy.
    HelmOutput step(uint32_t now_ms, float dt_s, const BatterySample& battery,
                    const SolarSample& solar, const GpsSample& gps);

    Mode mode() const { return modes_.mode(); }
    bool configValid() const { return config_valid_; }
    const EnergyTracker& energy() const { return energy_; }
    void resetDailyCounters() { energy_.reset(); }

private:
    const ControlConfig& cfg_;
    bool config_valid_;
    SafetySupervisor safety_;
    ModeManager modes_;
    BatteryPowerController controller_;
    BatteryGuard guard_;
    EnergyTracker energy_;
    SafetyVerdict last_verdict_;
    // REMOTE/RANGE open-loop ramp + REMOTE target state.
    RateLimiter remote_ramp_;
    float remote_target_w_ = 0.0f;
    uint32_t remote_target_ms_ = 0;
    bool remote_target_seen_ = false;
    // ARRIVAL budget stream state.
    float arrival_budget_w_ = 0.0f;
    uint32_t arrival_budget_ms_ = 0;
    bool arrival_budget_seen_ = false;
    // Latest attitude sample (telemetry only).
    ImuSample imu_;
};

}  // namespace sh
