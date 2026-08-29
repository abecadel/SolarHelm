#include "sh/control/lowpass.h"

namespace sh {

float LowPassFilter::update(float input, float dt_s) {
    if (!initialized_) {
        reset(input);
        return value_;
    }
    if (tau_s_ <= 0.0f || dt_s <= 0.0f) {
        value_ = input;
        return value_;
    }
    value_ += (input - value_) * (dt_s / (tau_s_ + dt_s));
    return value_;
}

}  // namespace sh
