#include "sh/control/ratelimit.h"

namespace sh {

void RateLimiter::configure(float max_up_per_s, float max_down_per_s) {
    max_up_per_s_ = max_up_per_s;
    max_down_per_s_ = max_down_per_s;
}

void RateLimiter::reset(float value) {
    value_ = value;
}

float RateLimiter::update(float target, float dt_s) {
    const float max_step_up = max_up_per_s_ * dt_s;
    const float max_step_down = max_down_per_s_ * dt_s;
    const float delta = target - value_;
    if (delta > max_step_up) {
        value_ += max_step_up;
    } else if (delta < -max_step_down) {
        value_ -= max_step_down;
    } else {
        value_ = target;
    }
    return value_;
}

}  // namespace sh
