#include "nmea/parser.h"

#include <cmath>
#include <cstdlib>
#include <cstring>

namespace nmea {

namespace {
constexpr float kKnotsToMps = 0.514444f;

int hexVal(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}
}  // namespace

bool Sentence::isType(const char* type) const {
    if (count == 0) {
        return false;
    }
    const size_t addr_len = std::strlen(fields[0]);
    const size_t type_len = std::strlen(type);
    if (addr_len < type_len) {
        return false;
    }
    return std::strcmp(fields[0] + (addr_len - type_len), type) == 0;
}

bool parseDouble(const char* value, double* out) {
    if (value == nullptr || *value == '\0') {
        return false;
    }
    char* end = nullptr;
    const double v = std::strtod(value, &end);
    if (end == value || *end != '\0') {
        return false;
    }
    *out = v;
    return true;
}

bool parseLatLon(const char* value, const char* hemisphere, double* out_deg) {
    double raw = 0.0;
    if (!parseDouble(value, &raw) || hemisphere == nullptr) {
        return false;
    }
    const char h = hemisphere[0];
    if (h != 'N' && h != 'S' && h != 'E' && h != 'W') {
        return false;
    }
    const double deg = std::floor(raw / 100.0);
    const double minutes = raw - deg * 100.0;
    double result = deg + minutes / 60.0;
    if (h == 'S' || h == 'W') {
        result = -result;
    }
    *out_deg = result;
    return true;
}

bool Parser::finishLine() {
    line_[len_] = '\0';
    // Locate "*hh" checksum.
    char* star = std::strrchr(line_, '*');
    if (star == nullptr || star[1] == '\0' || star[2] == '\0') {
        ++checksum_errors_;
        return false;
    }
    const int hi = hexVal(star[1]);
    const int lo = hexVal(star[2]);
    if (hi < 0 || lo < 0) {
        ++checksum_errors_;
        return false;
    }
    uint8_t sum = 0;
    for (const char* p = line_; p != star; ++p) {
        sum ^= static_cast<uint8_t>(*p);
    }
    if (sum != static_cast<uint8_t>((hi << 4) | lo)) {
        ++checksum_errors_;
        return false;
    }
    *star = '\0';

    // Split on ',' in place.
    sentence_.count = 0;
    char* p = line_;
    sentence_.fields[sentence_.count++] = p;
    while (*p != '\0' && sentence_.count < kMaxFields) {
        if (*p == ',') {
            *p = '\0';
            sentence_.fields[sentence_.count++] = p + 1;
        }
        ++p;
    }
    ++valid_;
    return true;
}

bool Parser::feed(uint8_t byte) {
    if (byte == '$') {
        collecting_ = true;
        len_ = 0;
        return false;
    }
    if (!collecting_) {
        return false;
    }
    if (byte == '\r' || byte == '\n') {
        collecting_ = false;
        return finishLine();
    }
    if (len_ >= kMaxSentenceLen) {
        collecting_ = false;
        ++overflows_;
        return false;
    }
    line_[len_++] = static_cast<char>(byte);
    return false;
}

size_t GpsMonitor::feed(const uint8_t* data, size_t len, uint32_t now_ms) {
    size_t sentences = 0;
    for (size_t i = 0; i < len; ++i) {
        if (parser_.feed(data[i])) {
            apply(parser_.sentence(), now_ms);
            ++sentences;
        }
    }
    return sentences;
}

void GpsMonitor::apply(const Sentence& s, uint32_t now_ms) {
    if (s.isType("RMC")) {
        // RMC: 1 time, 2 status, 3/4 lat, 5/6 lon, 7 SOG kn, 8 COG, 9 date
        if (std::strcmp(s.field(2), "A") != 0) {
            return;  // void fix: don't refresh, let the sample go stale
        }
        double sog_kn = 0.0;
        double lat = 0.0;
        double lon = 0.0;
        if (!parseDouble(s.field(7), &sog_kn) ||
            !parseLatLon(s.field(3), s.field(4), &lat) ||
            !parseLatLon(s.field(5), s.field(6), &lon)) {
            return;
        }
        last_.valid = true;
        last_.timestamp_ms = now_ms;
        last_.speed_mps = static_cast<float>(sog_kn) * kKnotsToMps;
        last_.latitude_deg = lat;
        last_.longitude_deg = lon;
        if (last_.fix_quality == 0) {
            last_.fix_quality = 1;  // until a GGA refines it
        }
        double cog = 0.0;
        if (parseDouble(s.field(8), &cog)) {
            last_.course_deg = static_cast<float>(cog);
        }
        return;
    }
    if (s.isType("VTG")) {
        // VTG: 1 COG true, 5 SOG knots. No validity flag — only refresh an
        // already-valid fix (receivers emit empty VTG fields with no fix).
        double sog_kn = 0.0;
        if (!last_.valid || !parseDouble(s.field(5), &sog_kn)) {
            return;
        }
        last_.timestamp_ms = now_ms;
        last_.speed_mps = static_cast<float>(sog_kn) * kKnotsToMps;
        double cog = 0.0;
        if (parseDouble(s.field(1), &cog)) {
            last_.course_deg = static_cast<float>(cog);
        }
        return;
    }
    if (s.isType("GGA")) {
        // GGA: 6 fix quality, 7 satellites in use.
        double fq = 0.0;
        if (parseDouble(s.field(6), &fq)) {
            last_.fix_quality = static_cast<uint8_t>(fq);
            if (last_.fix_quality == 0) {
                last_.valid = false;  // receiver reports fix lost
            }
        }
        double sats = 0.0;
        if (parseDouble(s.field(7), &sats)) {
            last_.satellites = static_cast<uint8_t>(sats);
        }
    }
}

}  // namespace nmea
