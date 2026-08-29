// First-order low-pass filter for noisy power measurements.
// Discrete update: y += (x - y) * dt / (tau + dt).
// tau == 0 disables filtering (output follows input exactly).

#pragma once

namespace sh {

class LowPassFilter {
public:
    explicit LowPassFilter(float time_constant_s = 0.0f)
        : tau_s_(time_constant_s) {}

    // Seed the filter so the first sample doesn't ramp from zero.
    void reset(float value) {
        value_ = value;
        initialized_ = true;
    }

    float update(float input, float dt_s);

    float value() const { return value_; }

private:
    float tau_s_;
    float value_ = 0.0f;
    bool initialized_ = false;
};

}  // namespace sh
