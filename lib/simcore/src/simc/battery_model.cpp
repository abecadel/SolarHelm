#include "simc/battery_model.h"

namespace simc {

BatteryModel::BatteryModel(const BatteryModelParams& params)
    : params_(params), soc_pct_(params.initial_soc_pct) {}

BusResult BatteryModel::step(float pv_available_w, float motor_request_w,
                             float hotel_request_w, float dt_s) {
    BusResult r;
    r.pv_w = pv_available_w;
    r.motor_w = motor_request_w;
    r.hotel_w = hotel_request_w;

    const float max_charge_w = (soc_pct_ >= 100.0f) ? 0.0f : params_.max_charge_w;
    const float max_discharge_w =
        (soc_pct_ <= 0.0f) ? 0.0f : params_.max_discharge_w;

    const float net_w = pv_available_w - motor_request_w - hotel_request_w;
    if (net_w >= 0.0f) {
        // Surplus: charge what the battery accepts, curtail the rest (MPPT
        // backs off exactly like a real charger at absorption/full).
        const float charge_w = (net_w > max_charge_w) ? max_charge_w : net_w;
        r.battery_w = charge_w;
        r.curtailed_w = net_w - charge_w;
        r.pv_w = pv_available_w - r.curtailed_w;
        soc_pct_ += charge_w * params_.charge_efficiency * dt_s / 3600.0f /
                    params_.capacity_wh * 100.0f;
        if (soc_pct_ > 100.0f) {
            soc_pct_ = 100.0f;
        }
    } else {
        // Deficit: discharge up to the limit; beyond it, loads brown out —
        // motor first, hotel last.
        const float needed_w = -net_w;
        const float supply_w =
            (needed_w > max_discharge_w) ? max_discharge_w : needed_w;
        r.battery_w = -supply_w;
        float deficit_w = needed_w - supply_w;
        if (deficit_w > 0.0f) {
            const float motor_cut_w =
                (deficit_w > motor_request_w) ? motor_request_w : deficit_w;
            r.motor_w = motor_request_w - motor_cut_w;
            deficit_w -= motor_cut_w;
            if (deficit_w > 0.0f) {
                r.hotel_w = (deficit_w > hotel_request_w)
                                ? 0.0f
                                : hotel_request_w - deficit_w;
            }
        }
        soc_pct_ -=
            supply_w * dt_s / 3600.0f / params_.capacity_wh * 100.0f;
        if (soc_pct_ < 0.0f) {
            soc_pct_ = 0.0f;
        }
    }
    last_power_w_ = r.battery_w;
    return r;
}

float BatteryModel::voltageV() const {
    // 24 V LiFePO4-ish: 23.5 V near empty, 26.5 V near full, plus IR sag.
    const float open_circuit_v = 25.0f + (soc_pct_ - 50.0f) * 0.03f;
    const float ir_drop_v = -currentA() * 0.008f;
    return open_circuit_v - ir_drop_v;
}

float BatteryModel::currentA() const {
    const float nominal_v = 25.0f + (soc_pct_ - 50.0f) * 0.03f;
    return last_power_w_ / nominal_v;
}

}  // namespace simc
