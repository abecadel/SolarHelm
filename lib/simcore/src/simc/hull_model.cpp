#include "simc/hull_model.h"

namespace simc {

float HullModel::update(float motor_power_w, float dt_s) {
    const float target_kmh = profile_.speedForPowerKmh(motor_power_w);
    if (tau_s_ <= 0.0f) {
        speed_kmh_ = target_kmh;
        return speed_kmh_;
    }
    speed_kmh_ += (target_kmh - speed_kmh_) * (dt_s / (tau_s_ + dt_s));
    return speed_kmh_;
}

}  // namespace simc
