#include "simc/boat_profile.h"

#include <cmath>
#include <cstdlib>

namespace simc {

namespace {

// Finds `"key":` in json and parses the number that follows.
bool findNumber(const std::string& json, const std::string& key, float* out) {
    const std::string needle = "\"" + key + "\"";
    const size_t at = json.find(needle);
    if (at == std::string::npos) {
        return false;
    }
    size_t pos = json.find(':', at + needle.size());
    if (pos == std::string::npos) {
        return false;
    }
    ++pos;
    const char* start = json.c_str() + pos;
    char* end = nullptr;
    const double v = strtod(start, &end);
    if (end == start) {
        return false;
    }
    *out = static_cast<float>(v);
    return true;
}

// Parses the [[speed, whkm], ...] array following `"key":`, tolerating any
// whitespace/newlines (bracket-depth scan, not textual matching).
bool findCurve(const std::string& json, const std::string& key,
               std::vector<CurvePoint>* out) {
    const std::string needle = "\"" + key + "\"";
    const size_t at = json.find(needle);
    if (at == std::string::npos) {
        return false;
    }
    const size_t open = json.find('[', at);
    if (open == std::string::npos) {
        return false;
    }
    out->clear();
    int depth = 0;
    size_t i = open;
    while (i < json.size()) {
        const char c = json[i];
        if (c == '[') {
            ++depth;
            if (depth == 2) {
                const char* start = json.c_str() + i + 1;
                char* end = nullptr;
                const double speed = strtod(start, &end);
                if (end == start || *end != ',') {
                    return false;
                }
                const char* second = end + 1;
                const double whkm = strtod(second, &end);
                if (end == second) {
                    return false;
                }
                out->push_back(
                    {static_cast<float>(speed), static_cast<float>(whkm)});
                i = static_cast<size_t>(end - json.c_str());
                continue;
            }
        } else if (c == ']') {
            --depth;
            if (depth == 0) {
                return !out->empty();
            }
        }
        ++i;
    }
    return false;  // ran off the end before the array closed
}

}  // namespace

bool BoatProfile::valid() const {
    if (schema_version != 1 || hull_curve.size() < 2) {
        return false;
    }
    for (size_t i = 0; i < hull_curve.size(); ++i) {
        if (hull_curve[i].speed_kmh <= 0.0f || hull_curve[i].wh_per_km <= 0.0f) {
            return false;
        }
        if (i > 0 && hull_curve[i].speed_kmh <= hull_curve[i - 1].speed_kmh) {
            return false;
        }
    }
    return pv_kwp > 0.0f && pv_derating > 0.0f && pv_derating <= 1.0f &&
           battery_capacity_kwh > 0.0f && battery_max_charge_w > 0.0f &&
           battery_max_discharge_w > 0.0f && hotel_load_w >= 0.0f &&
           motor_max_power_w > 0.0f &&
           battery_usable_min_soc_pct >= 0.0f &&
           battery_usable_min_soc_pct < 100.0f;
}

float BoatProfile::powerForSpeedW(float speed_kmh) const {
    // P(v) = Wh/km * km/h = W, interpolated on the curve; cubic beyond ends.
    const CurvePoint& first = hull_curve.front();
    const CurvePoint& last = hull_curve.back();
    if (speed_kmh <= first.speed_kmh) {
        const float p0 = first.wh_per_km * first.speed_kmh;
        const float ratio = speed_kmh / first.speed_kmh;
        return p0 * ratio * ratio * ratio;
    }
    if (speed_kmh >= last.speed_kmh) {
        const float pn = last.wh_per_km * last.speed_kmh;
        const float ratio = speed_kmh / last.speed_kmh;
        return pn * ratio * ratio * ratio;
    }
    for (size_t i = 1; i < hull_curve.size(); ++i) {
        if (speed_kmh <= hull_curve[i].speed_kmh) {
            const CurvePoint& a = hull_curve[i - 1];
            const CurvePoint& b = hull_curve[i];
            const float f =
                (speed_kmh - a.speed_kmh) / (b.speed_kmh - a.speed_kmh);
            const float whkm = a.wh_per_km + f * (b.wh_per_km - a.wh_per_km);
            return whkm * speed_kmh;
        }
    }
    return last.wh_per_km * last.speed_kmh;  // LCOV_EXCL_LINE unreachable
}

float BoatProfile::speedForPowerKmh(float power_w) const {
    if (power_w <= 0.0f) {
        return 0.0f;
    }
    const CurvePoint& first = hull_curve.front();
    const CurvePoint& last = hull_curve.back();
    const float p_first = first.wh_per_km * first.speed_kmh;
    const float p_last = last.wh_per_km * last.speed_kmh;
    if (power_w <= p_first) {
        return first.speed_kmh * std::cbrt(power_w / p_first);
    }
    if (power_w >= p_last) {
        return last.speed_kmh * std::cbrt(power_w / p_last);
    }
    for (size_t i = 1; i < hull_curve.size(); ++i) {
        const CurvePoint& a = hull_curve[i - 1];
        const CurvePoint& b = hull_curve[i];
        const float pa = a.wh_per_km * a.speed_kmh;
        const float pb = b.wh_per_km * b.speed_kmh;
        if (power_w <= pb) {
            const float f = (power_w - pa) / (pb - pa);
            return a.speed_kmh + f * (b.speed_kmh - a.speed_kmh);
        }
    }
    return last.speed_kmh;  // LCOV_EXCL_LINE unreachable
}

bool parseBoatProfile(const std::string& json, BoatProfile* out,
                      std::string* error) {
    BoatProfile p;
    float version = 0.0f;
    if (!findNumber(json, "schema_version", &version)) {
        *error = "missing schema_version";
        return false;
    }
    p.schema_version = static_cast<int>(version);

    struct Field {
        const char* key;
        float* dst;
    };
    const Field fields[] = {
        {"pv_kwp", &p.pv_kwp},
        {"pv_derating", &p.pv_derating},
        {"battery_capacity_kwh", &p.battery_capacity_kwh},
        {"battery_usable_min_soc_pct", &p.battery_usable_min_soc_pct},
        {"battery_max_charge_w", &p.battery_max_charge_w},
        {"battery_max_discharge_w", &p.battery_max_discharge_w},
        {"hotel_load_w", &p.hotel_load_w},
        {"motor_max_power_w", &p.motor_max_power_w},
    };
    for (const Field& f : fields) {
        if (!findNumber(json, f.key, f.dst)) {
            *error = std::string("missing field: ") + f.key;
            return false;
        }
    }
    if (!findCurve(json, "hull_efficiency_curve_kmh_whkm", &p.hull_curve)) {
        *error = "missing or malformed hull_efficiency_curve_kmh_whkm";
        return false;
    }
    if (!p.valid()) {
        *error = "profile values out of range";
        return false;
    }
    *out = p;
    return true;
}

BoatProfile defaultBoatProfile() {
    BoatProfile p;
    p.schema_version = 1;
    p.hull_curve = {{3.0f, 85.0f},  {4.1f, 98.0f},  {5.0f, 120.0f},
                    {5.7f, 140.0f}, {6.3f, 190.0f}, {7.0f, 286.0f}};
    p.pv_kwp = 1.0f;
    p.pv_derating = 0.78f;
    p.battery_capacity_kwh = 2.56f;
    p.battery_usable_min_soc_pct = 10.0f;
    p.battery_max_charge_w = 1200.0f;
    p.battery_max_discharge_w = 2500.0f;
    p.hotel_load_w = 60.0f;
    p.motor_max_power_w = 1164.0f;
    return p;
}

}  // namespace simc
