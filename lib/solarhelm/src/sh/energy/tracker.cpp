#include "sh/energy/tracker.h"

namespace sh {

void EnergyTracker::update(float dt_s, float solar_w, float motor_w,
                           float hotel_w, float speed_mps, bool speed_valid) {
    const float dt_h = dt_s / 3600.0f;
    solar_wh_ += solar_w * dt_h;
    motor_wh_ += motor_w * dt_h;
    hotel_wh_ += hotel_w * dt_h;
    if (speed_valid && speed_mps > 0.0f) {
        distance_km_ += speed_mps * dt_s / 1000.0f;
    }
}

void EnergyTracker::reset() {
    solar_wh_ = 0.0f;
    motor_wh_ = 0.0f;
    hotel_wh_ = 0.0f;
    distance_km_ = 0.0f;
}

float EnergyTracker::efficiencyWhPerKm() const {
    if (distance_km_ < kMinDistanceKm) {
        return 0.0f;
    }
    return motor_wh_ / distance_km_;
}

}  // namespace sh
