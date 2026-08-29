// ModeManager — cruise-strategy state machine.
//
// V1 modes: MANUAL (SolarHelm hands off), SOLAR (target battery power 0 W),
// SOLAR_PLUS (allow a configured constant battery contribution, e.g. -200 W).
// RANGE / RESERVE-as-mode / ARRIVAL are documented in docs/CONTROL_THEORY.md
// and arrive in later milestones; the reserve-SOC *floor* below applies to
// every automatic mode already.
//
// Safety rules enforced here:
//  - Boot mode is always MANUAL; a previous auto mode is never restored.
//  - Auto modes require an explicit request (requestMode) and are only
//    granted when the caller reports the system is healthy.
//  - forceManual() drops to MANUAL unconditionally (used by the
//    SafetySupervisor on sensor loss).
//  - Reserve floor: at or below reserve SOC the effective battery-power
//    target is clamped to >= 0 W — SolarHelm refuses to consume net battery
//    energy, in any automatic mode.
//  - Every transition is reported to the ITransitionLogger.

#pragma once

#include <cstdint>

#include "sh/core/config.h"

namespace sh {

enum class Mode : uint8_t {
    kManual = 0,
    kSolar = 1,
    kSolarPlus = 2,
};

const char* modeName(Mode m);

class ITransitionLogger {
public:
    virtual ~ITransitionLogger() = default;
    virtual void onModeChange(uint32_t t_ms, Mode from, Mode to,
                              const char* reason) = 0;
};

class ModeManager {
public:
    ModeManager(const ControlConfig& cfg, ITransitionLogger* logger);

    // Explicit user request. Auto modes are granted only when healthy;
    // returns true when the mode was switched (or already active).
    bool requestMode(Mode mode, bool healthy, uint32_t t_ms);

    // Unconditional drop to MANUAL (sensor loss, watchdog, user override).
    void forceManual(const char* reason, uint32_t t_ms);

    // Battery-power target for the active mode, with the reserve-SOC floor
    // applied (latched with hysteresis; see updateReserveLatch). Only
    // meaningful when isAutomatic().
    float targetBatteryPower(float soc_pct);

    bool isAutomatic() const { return mode_ != Mode::kManual; }
    Mode mode() const { return mode_; }

    // True while the reserve floor is latched (surfaced as a telemetry
    // fault flag). Updated by targetBatteryPower().
    bool reserveActive() const { return reserve_latched_; }

private:
    void transition(Mode to, const char* reason, uint32_t t_ms);
    // Latch at soc <= reserve; release only at soc >= reserve + hysteresis,
    // so the target cannot chatter while SOC hovers exactly at the floor.
    void updateReserveLatch(float soc_pct);

    const ControlConfig& cfg_;
    ITransitionLogger* logger_;
    Mode mode_ = Mode::kManual;
    bool reserve_latched_ = false;
};

}  // namespace sh
