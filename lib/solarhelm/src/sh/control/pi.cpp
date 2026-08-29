#include "sh/control/pi.h"

namespace sh {

void PiController::configure(float kp, float ki, float out_min, float out_max) {
    kp_ = kp;
    ki_ = ki;
    out_min_ = out_min;
    out_max_ = out_max;
    integrator_ = clampOutput(integrator_);
}

void PiController::reset(float output) {
    integrator_ = clampOutput(output);
}

float PiController::clampOutput(float v) const {
    if (v < out_min_) {
        return out_min_;
    }
    if (v > out_max_) {
        return out_max_;
    }
    return v;
}

float PiController::update(float error, float dt_s) {
    integrator_ = clampOutput(integrator_ + ki_ * error * dt_s);
    return clampOutput(kp_ * error + integrator_);
}

void PiController::trackOutput(float actual_output, float error) {
    integrator_ = clampOutput(actual_output - kp_ * error);
}

}  // namespace sh
