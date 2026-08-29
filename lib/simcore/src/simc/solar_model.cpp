#include "simc/solar_model.h"

#include <cmath>

namespace simc {

namespace {
constexpr float kPi = 3.14159265358979f;
}

SolarModel::SolarModel(const SolarModelParams& params)
    : params_(params), rng_(params.cloud_seed) {}

float SolarModel::waveformPowerW(float t_s) const {
    switch (params_.waveform) {
        case SolarWaveform::kConstant:
            return params_.peak_w;
        case SolarWaveform::kSwing: {
            const float phase = 2.0f * kPi * t_s / params_.swing_period_s;
            return params_.swing_mean_w +
                   params_.swing_amplitude_w * std::sin(phase);
        }
        case SolarWaveform::kDayArc:
        default: {
            if (t_s <= params_.sunrise_s || t_s >= params_.sunset_s) {
                return 0.0f;
            }
            const float day_len = params_.sunset_s - params_.sunrise_s;
            const float x = (t_s - params_.sunrise_s) / day_len;
            const float arc = std::sin(kPi * x);
            // ^1.3 narrows the arc slightly: closer to real GHI curves than
            // a pure sine.
            return params_.peak_w * std::pow(arc, 1.3f);
        }
    }
}

void SolarModel::updateClouds(float t_s) {
    if (!params_.random_clouds) {
        return;
    }
    if (t_s >= next_cloud_change_s_) {
        // A new cloud state every 2-10 minutes: transmission 0.25..1.0.
        cloud_walk_target_ = 0.25f + 0.75f * rng_.nextFloat();
        next_cloud_change_s_ = t_s + 120.0f + 480.0f * rng_.nextFloat();
    }
    // Move gently toward the target so edges aren't unphysical steps.
    cloud_factor_ += (cloud_walk_target_ - cloud_factor_) * 0.02f;
}

float SolarModel::availablePowerW(float t_s) {
    updateClouds(t_s);
    float p = waveformPowerW(t_s) * cloud_factor_ * pv_scale_;
    if (p < 0.0f) {
        p = 0.0f;
    }
    return p;
}

}  // namespace simc
