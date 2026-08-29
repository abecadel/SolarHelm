#include "sh/control/mode_manager.h"

namespace sh {

const char* modeName(Mode m) {
    switch (m) {
        case Mode::kManual: return "MANUAL";
        case Mode::kSolar: return "SOLAR";
        case Mode::kSolarPlus: return "SOLAR+";
        default: return "UNKNOWN";
    }
}

ModeManager::ModeManager(const ControlConfig& cfg, ITransitionLogger* logger)
    : cfg_(cfg), logger_(logger) {}

void ModeManager::transition(Mode to, const char* reason, uint32_t t_ms) {
    if (to == mode_) {
        return;
    }
    const Mode from = mode_;
    mode_ = to;
    if (logger_ != nullptr) {
        logger_->onModeChange(t_ms, from, to, reason);
    }
}

bool ModeManager::requestMode(Mode mode, bool healthy, uint32_t t_ms) {
    if (mode != Mode::kManual && !healthy) {
        return false;  // auto modes need healthy sensors at activation
    }
    transition(mode, "user_request", t_ms);
    return true;
}

void ModeManager::forceManual(const char* reason, uint32_t t_ms) {
    transition(Mode::kManual, reason, t_ms);
}

void ModeManager::updateReserveLatch(float soc_pct) {
    if (!reserve_latched_) {
        if (soc_pct <= cfg_.reserve_soc_pct) {
            reserve_latched_ = true;
        }
    } else if (soc_pct >= cfg_.reserve_soc_pct + cfg_.reserve_hysteresis_pct) {
        reserve_latched_ = false;
    }
}

float ModeManager::targetBatteryPower(float soc_pct) {
    updateReserveLatch(soc_pct);
    float target_w = 0.0f;
    if (mode_ == Mode::kSolarPlus) {
        target_w = cfg_.solar_plus_target_w;
    }
    // Reserve floor: at/below reserve SOC net discharge is forbidden. The
    // target is raised to +deadband so that even the worst-case rest point
    // inside the controller deadband is still >= 0 W (no slow leak past the
    // reserve).
    if (reserve_latched_) {
        const float floor_w = cfg_.deadband_w;
        if (target_w < floor_w) {
            target_w = floor_w;
        }
    }
    return target_w;
}

}  // namespace sh
