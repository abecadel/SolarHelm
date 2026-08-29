// SolarModel — PV production available from the array over a scenario.
//
// Waveforms:
//   kDayArc   — sun elevation arc between sunrise/sunset, peak at solar noon
//   kConstant — fixed power (bench-style demo scenarios)
//   kSwing    — sinusoidal oscillation (demo scenario A: 300..1500 W)
//
// On top of the waveform: a scenario-controlled cloud factor (0..1, set by
// events or by a deterministic random cloud walk) and a global PV scale
// (events like "sudden 80% solar loss" flip this).
//
// Output is the power the array COULD deliver; the battery/bus model decides
// how much is actually used (MPPT curtailment when the battery is full).

#pragma once

#include <cstdint>

#include "simc/rng.h"

namespace simc {

enum class SolarWaveform : uint8_t {
    kDayArc = 0,
    kConstant = 1,
    kSwing = 2,
};

struct SolarModelParams {
    SolarWaveform waveform = SolarWaveform::kDayArc;
    float peak_w = 780.0f;          // clear-sky peak at solar noon
    float sunrise_s = 6.0f * 3600;  // scenario time of sunrise
    float sunset_s = 20.0f * 3600;
    float swing_mean_w = 900.0f;    // kSwing parameters
    float swing_amplitude_w = 600.0f;
    float swing_period_s = 600.0f;
    bool random_clouds = false;     // deterministic cloud walk (seeded)
    uint32_t cloud_seed = 1;
};

class SolarModel {
public:
    explicit SolarModel(const SolarModelParams& params);

    // Available PV power at scenario time t (>= 0).
    float availablePowerW(float t_s);

    // Event hooks.
    void setCloudFactor(float factor01) { cloud_factor_ = factor01; }
    void setPvScale(float scale01) { pv_scale_ = scale01; }

private:
    float waveformPowerW(float t_s) const;
    void updateClouds(float t_s);

    SolarModelParams params_;
    Rng rng_;
    float cloud_factor_ = 1.0f;
    float pv_scale_ = 1.0f;
    float next_cloud_change_s_ = 0.0f;
    float cloud_walk_target_ = 1.0f;
};

}  // namespace simc
