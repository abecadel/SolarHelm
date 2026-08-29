// BatteryModel — LiFePO4 battery + DC bus power balance.
//
// Each step resolves the bus: PV feeds loads first; the battery absorbs the
// surplus (up to its charge limit / until full — beyond that the MPPT
// curtails PV) or covers the deficit (up to its discharge limit / until
// empty — beyond that loads brown out, motor first).
//
// SOC is coulomb-counted with a charge efficiency factor. Voltage is a
// simple SOC-linear model with IR sag — enough to exercise the controller
// and telemetry, not an electrochemical model.

#pragma once

namespace simc {

struct BusResult {
    float pv_w = 0.0f;       // PV actually used (after curtailment)
    float motor_w = 0.0f;    // motor power actually delivered
    float hotel_w = 0.0f;    // hotel load actually served
    float battery_w = 0.0f;  // + charging, - discharging
    float curtailed_w = 0.0f;
};

struct BatteryModelParams {
    float capacity_wh = 2560.0f;
    float initial_soc_pct = 80.0f;
    float max_charge_w = 1200.0f;
    float max_discharge_w = 2500.0f;
    float charge_efficiency = 0.97f;
};

class BatteryModel {
public:
    explicit BatteryModel(const BatteryModelParams& params);

    BusResult step(float pv_available_w, float motor_request_w,
                   float hotel_request_w, float dt_s);

    float socPct() const { return soc_pct_; }
    float voltageV() const;
    // Battery current for the last step (+ charging, - discharging).
    float currentA() const;
    float lastPowerW() const { return last_power_w_; }

private:
    BatteryModelParams params_;
    float soc_pct_;
    float last_power_w_ = 0.0f;
};

}  // namespace simc
