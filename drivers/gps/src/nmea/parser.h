// NMEA 0183 parser for GNSS speed/position (u-blox NEO-M8N class).
//
// Scope: the sentences SolarHelm needs for Wh/km and telemetry —
//   RMC  position, Doppler speed-over-ground, course, validity
//   VTG  course + speed (updates speed/course between RMC fixes)
//   GGA  fix quality + satellites in use
//
// Design mirrors the VE.Direct driver: a byte-fed, fixed-buffer,
// no-allocation line parser validating the "$...*hh" XOR checksum, plus a
// GpsMonitor adapter implementing sh::IGps. Speed comes from the
// receiver's Doppler SOG — never from differentiated positions
// (docs/RESEARCH.md §15). Any talker is accepted ($GPRMC, $GNRMC, ...).

#pragma once

#include <cstddef>
#include <cstdint>

#include "sh/drivers/interfaces.h"

namespace nmea {

constexpr size_t kMaxSentenceLen = 120;  // NMEA caps lines at 82; margin
constexpr size_t kMaxFields = 24;

// One parsed, checksum-valid sentence, split into fields.
// fields[0] is the address ("GPRMC"); empty fields are "".
struct Sentence {
    const char* fields[kMaxFields];
    size_t count = 0;

    // Field by index, or "" when out of range.
    const char* field(size_t i) const { return i < count ? fields[i] : ""; }

    // True when the address ends with the 3-letter type ("RMC").
    bool isType(const char* type) const;
};

// "4807.038","N" -> 48.1173; false on empty/malformed input.
bool parseLatLon(const char* value, const char* hemisphere, double* out_deg);

// Decimal number field; false on empty/malformed.
bool parseDouble(const char* value, double* out);

class Parser {
public:
    // Feed one byte; returns true when a complete, checksum-valid sentence
    // is available via sentence(). The Sentence's pointers are valid until
    // the next feed() call.
    bool feed(uint8_t byte);

    const Sentence& sentence() const { return sentence_; }

    uint32_t validSentences() const { return valid_; }
    uint32_t checksumErrors() const { return checksum_errors_; }
    uint32_t overflows() const { return overflows_; }

private:
    bool finishLine();

    char line_[kMaxSentenceLen + 1];
    size_t len_ = 0;
    bool collecting_ = false;
    Sentence sentence_;
    uint32_t valid_ = 0;
    uint32_t checksum_errors_ = 0;
    uint32_t overflows_ = 0;
};

// sh::IGps backed by the NMEA stream.
class GpsMonitor : public sh::IGps {
public:
    // Consume raw serial bytes; now_ms timestamps fixes completed while
    // consuming them. Returns the number of valid sentences seen.
    size_t feed(const uint8_t* data, size_t len, uint32_t now_ms);

    sh::GpsSample read() override { return last_; }

    const Parser& parser() const { return parser_; }

private:
    void apply(const Sentence& s, uint32_t now_ms);

    Parser parser_;
    sh::GpsSample last_;
};

}  // namespace nmea
