// HullModel — boat speed response to motor power.
//
// Steady-state speed comes from the boat profile's hull efficiency curve
// (electrical W -> km/h); the transient is a first-order lag so the hull
// takes seconds to accelerate/decelerate like a real displacement boat.

#pragma once

#include "simc/boat_profile.h"

namespace simc {

class HullModel {
public:
    HullModel(const BoatProfile& profile, float time_constant_s = 8.0f)
        : profile_(profile), tau_s_(time_constant_s) {}

    // Advance by dt with the given delivered electrical motor power.
    float update(float motor_power_w, float dt_s);

    float speedKmh() const { return speed_kmh_; }
    float speedMps() const { return speed_kmh_ / 3.6f; }

private:
    const BoatProfile& profile_;
    float tau_s_;
    float speed_kmh_ = 0.0f;
};

}  // namespace simc
