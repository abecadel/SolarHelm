// Slew-rate limiter for the motor command.
//
// Separate up/down rates: throttle-up is deliberately slower than
// throttle-down so a passing cloud sheds load quickly while returning sun
// never causes an aggressive surge.

#pragma once

namespace sh {

class RateLimiter {
public:
    void configure(float max_up_per_s, float max_down_per_s);

    void reset(float value);

    float update(float target, float dt_s);

    float value() const { return value_; }

private:
    float max_up_per_s_ = 0.0f;
    float max_down_per_s_ = 0.0f;
    float value_ = 0.0f;
};

}  // namespace sh
