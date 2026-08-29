#include "sh/core/helm.h"

namespace sh {

Helm::Helm(const ControlConfig& cfg, ITransitionLogger* logger)
    : cfg_(cfg),
      config_valid_(cfg.validate() == ConfigError::kNone),
      safety_(cfg),
      modes_(cfg, logger),
      controller_(cfg) {}

bool Helm::requestMode(Mode mode, uint32_t now_ms) {
    if (mode != Mode::kManual && !config_valid_) {
        return false;
    }
    const bool healthy = last_verdict_.allow_auto;
    const bool was_auto = modes_.isAutomatic();
    const bool granted = modes_.requestMode(mode, healthy, now_ms);
    if (granted && modes_.isAutomatic() && !was_auto) {
        controller_.reset();  // throttle always ramps from zero on activation
    }
    return granted;
}

void Helm::forceManual(const char* reason, uint32_t now_ms) {
    modes_.forceManual(reason, now_ms);
    controller_.reset();
}

HelmOutput Helm::step(uint32_t now_ms, float dt_s,
                      const BatterySample& battery, const SolarSample& solar,
                      const GpsSample& gps) {
    HelmOutput out;

    last_verdict_ = safety_.evaluate(now_ms, battery, solar, gps);
    uint16_t faults = last_verdict_.faults;
    if (!config_valid_) {
        faults |= kFaultConfigInvalid;
    }

    // Sensor loss or invalid config while cruising automatically -> MANUAL.
    if (modes_.isAutomatic() && (!last_verdict_.allow_auto || !config_valid_)) {
        forceManual("safety_dropout", now_ms);
    }

    float target_w = 0.0f;
    if (modes_.isAutomatic()) {
        target_w = modes_.targetBatteryPower(battery.soc_pct);
        if (modes_.reserveActive()) {
            faults |= kFaultSocAtReserve;
        }
        out.motor_cmd_pct =
            controller_.update(battery.power_w, target_w, dt_s);
        out.auto_active = true;
    } else {
        out.motor_cmd_pct = 0.0f;  // MANUAL: automatic output is always zero
        out.auto_active = false;
    }

    const float motor_est_w =
        out.motor_cmd_pct / 100.0f * cfg_.motor_max_power_w;
    const float solar_w = last_verdict_.solar_ok ? solar.power_w : 0.0f;
    // Hotel load is the bus balance residual: PV - motor - battery charge.
    float hotel_w = solar_w - motor_est_w - battery.power_w;
    if (hotel_w < 0.0f) {
        hotel_w = 0.0f;  // estimation noise; hotel load can't be negative
    }
    const bool speed_usable = last_verdict_.gps_ok;
    energy_.update(dt_s, solar_w, motor_est_w, hotel_w, gps.speed_mps,
                   speed_usable);

    TelemetryRecord& t = out.telemetry;
    t.timestamp_ms = now_ms;
    t.mode = static_cast<uint8_t>(modes_.mode());
    t.battery_voltage_v = battery.voltage_v;
    t.battery_current_a = battery.current_a;
    t.battery_power_w = battery.power_w;
    t.battery_soc_pct = battery.soc_pct;
    t.solar_power_w = solar_w;
    t.motor_command_pct = out.motor_cmd_pct;
    t.motor_estimated_power_w = motor_est_w;
    t.speed_kmh = speed_usable ? gps.speed_mps * 3.6f : 0.0f;
    t.distance_today_km = energy_.distanceKm();
    t.energy_solar_today_wh = energy_.energySolarWh();
    t.energy_motor_today_wh = energy_.energyMotorWh();
    t.energy_hotel_today_wh = energy_.energyHotelWh();
    t.efficiency_wh_km = energy_.efficiencyWhPerKm();
    t.reserve_soc_pct = cfg_.reserve_soc_pct;
    t.fault_flags = faults;
    return out;
}

}  // namespace sh
