#include "sh/core/helm.h"

namespace sh {

Helm::Helm(const ControlConfig& cfg, ITransitionLogger* logger)
    : cfg_(cfg),
      config_valid_(cfg.validate() == ConfigError::kNone),
      safety_(cfg),
      modes_(cfg, logger),
      controller_(cfg),
      guard_(cfg) {
    remote_ramp_.configure(cfg.max_ramp_up_pct_per_s,
                           cfg.max_ramp_down_pct_per_s);
    remote_ramp_.reset(0.0f);
}

bool Helm::requestMode(Mode mode, uint32_t now_ms) {
    if (mode != Mode::kManual && !config_valid_) {
        return false;
    }
    if (mode == Mode::kRemote &&
        (!remote_target_seen_ ||
         (now_ms - remote_target_ms_) > cfg_.remote_timeout_ms)) {
        return false;  // no fresh phone target: nothing to execute
    }
    const bool healthy = last_verdict_.allow_auto;
    const bool was_auto = modes_.isAutomatic();
    const bool granted = modes_.requestMode(mode, healthy, now_ms);
    if (granted && modes_.isAutomatic() && !was_auto) {
        controller_.reset();  // throttle always ramps from zero on activation
        remote_ramp_.reset(0.0f);
    }
    return granted;
}

void Helm::forceManual(const char* reason, uint32_t now_ms) {
    modes_.forceManual(reason, now_ms);
    controller_.reset();
    remote_ramp_.reset(0.0f);
}

void Helm::setRemoteTarget(float motor_power_w, uint32_t now_ms) {
    if (motor_power_w < 0.0f) {
        motor_power_w = 0.0f;  // reverse/negative never comes from the phone
    }
    remote_target_w_ = motor_power_w;
    remote_target_ms_ = now_ms;
    remote_target_seen_ = true;
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
    GuardOutput guard;  // defaults to a full ceiling when not automatic
    if (modes_.isAutomatic()) {
        // REMOTE degrades to self-contained SOLAR when the phone goes quiet.
        if (modes_.mode() == Mode::kRemote &&
            (now_ms - remote_target_ms_) > cfg_.remote_timeout_ms) {
            faults |= kFaultRemoteStale;
            modes_.degrade(Mode::kSolar, "remote_stale", now_ms);
            controller_.reset();
        }

        // The battery-side protection envelope produces a command ceiling
        // and, at the stop stages, a graceful drop to MANUAL.
        guard = guard_.update(battery, dt_s);
        faults |= guard.faults;
        if (guard.stop) {
            forceManual("battery_protect", now_ms);
        }
    }
    if (modes_.isAutomatic()) {
        target_w = modes_.targetBatteryPower(battery.soc_pct);
        if (modes_.reserveActive()) {
            faults |= kFaultSocAtReserve;
        }
        if (modes_.mode() == Mode::kRemote && !modes_.reserveActive()) {
            // Execute the phone's power target open-loop through the same
            // ramps and ceiling; at the reserve floor REMOTE behaves like
            // SOLAR (net battery discharge is refused).
            float desired_pct =
                remote_target_w_ / cfg_.motor_max_power_w * 100.0f;
            if (desired_pct > guard.ceiling_pct) {
                desired_pct = guard.ceiling_pct;
            }
            if (desired_pct > cfg_.max_motor_cmd_pct) {
                desired_pct = cfg_.max_motor_cmd_pct;
            }
            out.motor_cmd_pct = remote_ramp_.update(desired_pct, dt_s);
        } else {
            out.motor_cmd_pct = controller_.update(
                battery.power_w, target_w, dt_s, guard.ceiling_pct);
            remote_ramp_.reset(out.motor_cmd_pct);
        }
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
    if (speed_usable) {
        t.latitude_deg = gps.latitude_deg;
        t.longitude_deg = gps.longitude_deg;
    }
    return out;
}

}  // namespace sh
