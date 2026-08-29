// VE.Direct text-protocol parser (Victron SmartShunt, BMV, MPPT).
//
// Protocol (VE.Direct Protocol v3.34, victronenergy.com): 19200 8N1,
// 3.3 V logic. The device autonomously emits a block of records every ~1 s:
//
//   <CR><LF><label><TAB><value> ... <CR><LF>Checksum<TAB><byte>
//
// The block is valid when the modulo-256 sum of every byte in it (from the
// first record's <CR> through the checksum byte) equals zero. A separate
// request/response HEX protocol may interleave frames (':' ... '\n') at
// almost any point; those bytes belong to the HEX layer and are excluded
// from the text checksum.
//
// This parser is a byte-fed state machine with fixed buffers — no dynamic
// allocation, no dependencies — so it runs identically in desktop tests
// (fed recorded frames) and on the ESP32 UART. Malformed input (oversized
// labels/values, too many records, bad checksums) abandons the current
// block and resynchronises on the next one; joining mid-stream simply
// costs the first (partial) block.
//
// Field semantics for SolarHelm (sign conventions match sh::BatterySample):
//   V   battery voltage [mV]
//   I   battery current [mA], positive = charging
//   P   instantaneous power [W], positive = charging
//   SOC state of charge [promille]
//   PPV panel power [W] (MPPT), CS charge state (MPPT)

#pragma once

#include <cstddef>
#include <cstdint>

namespace vedirect {

// Sizes follow Victron's reference implementation.
constexpr size_t kMaxLabelLen = 8;
constexpr size_t kMaxValueLen = 32;
constexpr size_t kMaxRecords = 22;

struct Record {
    char label[kMaxLabelLen + 1];
    char value[kMaxValueLen + 1];
};

struct Block {
    Record records[kMaxRecords];
    size_t count = 0;

    // Value for a label, or nullptr when absent.
    const char* find(const char* label) const;
};

// Parses a numeric VE.Direct value ("25600", "-1500"). Returns false for
// non-numeric values ("---", "ON", empty).
bool parseLong(const char* value, long* out);

class Parser {
public:
    // Feed one byte from the UART. Returns true when a complete,
    // checksum-valid block has just been published (read it via block()).
    bool feed(uint8_t byte);

    // Convenience: feed a buffer; returns the number of complete valid
    // blocks published while consuming it.
    size_t feed(const uint8_t* data, size_t len);

    // The most recently published valid block.
    const Block& block() const { return published_; }

    uint32_t validBlocks() const { return valid_blocks_; }
    uint32_t checksumErrors() const { return checksum_errors_; }
    uint32_t formatErrors() const { return format_errors_; }

private:
    enum class State : uint8_t {
        kWaitStart,   // hunting for '\n' that begins a record
        kLabel,       // collecting label until '\t'
        kValue,       // collecting value until '\r'
        kChecksum,    // next byte is the checksum byte
        kHex,         // inside an interleaved HEX frame (until '\n')
    };

    void abandonBlock();

    State state_ = State::kWaitStart;
    State resume_state_ = State::kWaitStart;  // state stashed during kHex
    uint8_t checksum_ = 0;
    Block staging_;
    Block published_;
    size_t label_len_ = 0;
    size_t value_len_ = 0;
    uint32_t valid_blocks_ = 0;
    uint32_t checksum_errors_ = 0;
    uint32_t format_errors_ = 0;
};

}  // namespace vedirect
