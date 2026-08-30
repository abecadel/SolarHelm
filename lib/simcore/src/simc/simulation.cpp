#include "simc/simulation.h"

#include <cmath>

namespace simc {

namespace {

BatteryModelParams batteryParams(const BoatProfile& profile,
                                 const Scenario& scenario) {
    BatteryModelParams p;
    p.capacity_wh = profile.battery_capacity_kwh * 1000.0f;
    p.initial_soc_pct = scenario.start_soc_pct;
    p.max_charge_w = profile.battery_max_charge_w;
    p.max_discharge_w = profile.battery_max_discharge_w;
    return p;
}

SolarModelParams solarParams(const BoatProfile& profile,
                             const Scenario& scenario) {
    SolarModelParams p = scenario.solar;
    if (p.waveform == SolarWaveform::kDayArc) {
        // Day-arc peak derives from the boat's PV array unless the scenario
        // overrides it away from the default.
        p.peak_w = profile.pv_kwp * 1000.0f * profile.pv_derating;
    }
    return p;
}

}  // namespace

Simulation::Simulation(const BoatProfile& profile, const Scenario& scenario,
                       const sh::ControlConfig& config)
    : profile_(profile),
      scenario_(scenario),
      helm_(config, &logger_),
      solar_(solarParams(profile, scenario)),
      battery_(batteryParams(profile, scenario)),
      hull_(profile),
      hotel_w_(scenario.initial_hotel_w >= 0.0f ? scenario.initial_hotel_w
                                                : profile.hotel_load_w) {}

void Simulation::applyDueEvents() {
    while (next_event_ < scenario_.events.size() &&
           scenario_.events[next_event_].t_s <= t_s_) {
        const Event& e = scenario_.events[next_event_];
        switch (e.type) {
            case EventType::kSetCloudFactor:
                solar_.setCloudFactor(e.value);
                break;
            case EventType::kSetPvScale:
                solar_.setPvScale(e.value);
                break;
            case EventType::kFailShunt:
                shunt_.setFailed(true);
                break;
            case EventType::kRestoreShunt:
                shunt_.setFailed(false);
                break;
            case EventType::kFailSolarMon:
                solar_mon_.setFailed(true);
                break;
            case EventType::kFailGps:
                gps_.setFailed(true);
                break;
            case EventType::kRestoreGps:
                gps_.setFailed(false);
                break;
            case EventType::kSetHotelLoadW:
                hotel_w_ = e.value;
                break;
            case EventType::kRequestManual:
                helm_.forceManual("scenario_event", static_cast<uint32_t>(t_s_ * 1000.0f));
                break;
            case EventType::kRequestSolar:
                helm_.requestMode(sh::Mode::kSolar,
                                  static_cast<uint32_t>(t_s_ * 1000.0f));
                break;
            case EventType::kRequestSolarPlus:
                helm_.requestMode(sh::Mode::kSolarPlus,
                                  static_cast<uint32_t>(t_s_ * 1000.0f));
                break;
            case EventType::kRequestRange:
                helm_.requestMode(sh::Mode::kRange,
                                  static_cast<uint32_t>(t_s_ * 1000.0f));
                break;
            case EventType::kRequestArrival:
                helm_.requestMode(sh::Mode::kArrival,
                                  static_cast<uint32_t>(t_s_ * 1000.0f));
                break;
            case EventType::kSetArrivalBudget:
                // The "phone" starts streaming this budget (re-sent every
                // tick until kStopArrivalStream).
                arrival_streaming_ = true;
                arrival_stream_w_ = e.value;
                helm_.setArrivalBudget(e.value,
                                       static_cast<uint32_t>(t_s_ * 1000.0f));
                break;
            case EventType::kStopArrivalStream:
                arrival_streaming_ = false;
                break;
        }
        ++next_event_;
    }
}

TickResult Simulation::step() {
    const float dt_s = scenario_.dt_s;
    t_s_ += dt_s;
    const uint32_t now_ms = static_cast<uint32_t>(t_s_ * 1000.0f);

    applyDueEvents();

    // --- Physics: apply the previous tick's command (actuation lag). ---
    const float pv_available_w =
        solar_.availablePowerW(scenario_.start_time_of_day_s + t_s_);
    const float motor_request_w =
        motor_cmd_pct_ / 100.0f * profile_.motor_max_power_w;
    const BusResult bus =
        battery_.step(pv_available_w, motor_request_w, hotel_w_, dt_s);
    hull_.update(bus.motor_w, dt_s);

    // Dead-reckon position northward for plausible GPS coordinates.
    lat_deg_ += hull_.speedMps() * dt_s / 111320.0;

    // --- Sensors observe the plant. ---
    shunt_.feed(now_ms, battery_.voltageV(), battery_.currentA(),
                bus.battery_w, battery_.socPct());
    solar_mon_.feed(now_ms, bus.pv_w);
    gps_.feed(now_ms, hull_.speedMps(), lat_deg_, lon_deg_);

    // Scenarios begin in MANUAL; the automatic mode is explicitly requested
    // once (like a user pressing the AUTO button after the system is up).
    if (!auto_requested_ && t_s_ >= 2.0f * dt_s) {
        auto_requested_ =
            helm_.requestMode(scenario_.auto_request_mode, now_ms);
    }

    // The streaming phone keeps the ARRIVAL budget fresh every tick.
    if (arrival_streaming_) {
        helm_.setArrivalBudget(arrival_stream_w_, now_ms);
    }

    // --- The real controller decides. ---
    const sh::HelmOutput out = helm_.step(now_ms, dt_s, shunt_.read(),
                                          solar_mon_.read(), gps_.read());
    throttle_.write(out.motor_cmd_pct);
    motor_cmd_pct_ = throttle_.lastCmdPct();

    TickResult r;
    r.t_s = t_s_;
    r.telemetry = out.telemetry;
    r.pv_available_w = pv_available_w;
    r.pv_used_w = bus.pv_w;
    r.motor_true_w = bus.motor_w;
    r.hotel_true_w = bus.hotel_w;
    r.battery_true_w = bus.battery_w;
    r.soc_true_pct = battery_.socPct();
    r.speed_true_kmh = hull_.speedKmh();
    r.auto_active = out.auto_active;
    return r;
}

std::vector<TickResult> Simulation::run() {
    std::vector<TickResult> results;
    results.reserve(static_cast<size_t>(scenario_.duration_s / scenario_.dt_s) +
                    1);
    while (running()) {
        results.push_back(step());
    }
    return results;
}

}  // namespace simc
