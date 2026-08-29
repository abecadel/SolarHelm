// Clamped PI controller with anti-windup.
//
// Output is an absolute actuator value in [out_min, out_max]. The integrator
// is clamped to the same range (clamping anti-windup), so the output never
// winds up beyond what the actuator can do — recovery after saturation is
// immediate.

#pragma once

namespace sh {

class PiController {
public:
    void configure(float kp, float ki, float out_min, float out_max);

    // Restart from a known output (0 for "ramp from zero" activation).
    void reset(float output);

    // error convention: positive error -> increase output.
    float update(float error, float dt_s);

    // Tracking anti-windup: when a downstream limiter (rate limiter) held
    // the actuator at `actual_output`, re-seat the integrator so the PI
    // output matches reality and cannot wind up past it.
    void trackOutput(float actual_output, float error);

    float integrator() const { return integrator_; }

private:
    float clampOutput(float v) const;

    float kp_ = 0.0f;
    float ki_ = 0.0f;
    float out_min_ = 0.0f;
    float out_max_ = 0.0f;
    float integrator_ = 0.0f;
};

}  // namespace sh
