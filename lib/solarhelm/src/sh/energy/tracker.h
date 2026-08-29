// EnergyTracker — daily energy/distance/efficiency accounting.
//
// Integrates power flows and GPS distance so the boat can answer
// "how many Wh per km am I really using?" — the input for the learned
// hull-efficiency curve (docs/SEA_TRIALS.md). Persisted storage arrives in
// a later milestone; the tracker itself is persistence-agnostic.

#pragma once

namespace sh {

class EnergyTracker {
public:
    // One tick. speed_valid gates distance integration (stale GPS must not
    // corrupt the efficiency statistics).
    void update(float dt_s, float solar_w, float motor_w, float hotel_w,
                float speed_mps, bool speed_valid);

    // Start a new day (or a new measurement leg).
    void reset();

    float energySolarWh() const { return solar_wh_; }
    float energyMotorWh() const { return motor_wh_; }
    float energyHotelWh() const { return hotel_wh_; }
    float distanceKm() const { return distance_km_; }

    // Cumulative motor energy per distance. 0 until enough distance has
    // been covered to make the number meaningful.
    float efficiencyWhPerKm() const;

private:
    static constexpr float kMinDistanceKm = 0.05f;  // ~50 m
    float solar_wh_ = 0.0f;
    float motor_wh_ = 0.0f;
    float hotel_wh_ = 0.0f;
    float distance_km_ = 0.0f;
};

}  // namespace sh
