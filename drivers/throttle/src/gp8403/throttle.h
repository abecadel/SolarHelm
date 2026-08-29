// AnalogThrottle — GP8403 (DFRobot DFR0971) I2C DAC as the 0-5 V throttle
// output for Kelly-class motor controllers.
//
// Register protocol taken from DFRobot's own library source
// (github.com/DFRobot/DFRobot_GP8403, MIT), read directly:
//   - reg 0x01: output range; byte 0x00 = 0-5 V, 0x11 = 0-10 V
//   - reg 0x02 (ch0) / 0x04 (ch1): 12-bit code = mv/range_mv*4095,
//     shifted <<4, written low byte first
//   - default I2C address 0x58 (DIP-selectable)
//
// Safety rules this driver enforces (docs/SAFETY.md):
//   - the chip powers up at 0 V; begin() re-asserts 0 V before anything else
//   - the chip's EEPROM "store" feature is deliberately NOT implemented —
//     a persisted non-zero throttle would defeat power-on-zero
//   - a software output ceiling (default 4500 mV) keeps the command under
//     the hardware clamp's knee; the clamp itself (divider+zener) remains
//     the independent bound
//   - commands are clamped to [0, 100] %; before a successful begin() any
//     write() emits 0 V regardless of the requested command
//
// The I2C bus is injected (II2cBus) so every code path is unit-tested on
// the desktop; the ESP32 Wire binding is a ~10-line Milestone-2 adapter.

#pragma once

#include <cstddef>
#include <cstdint>

#include "sh/drivers/interfaces.h"

namespace gp8403 {

// Minimal write-only I2C surface (the GP8403 is write-only in normal use).
class II2cBus {
public:
    virtual ~II2cBus() = default;
    // Write `len` payload bytes to `reg` of 7-bit `device`; true on ACK.
    virtual bool write(uint8_t device, uint8_t reg, const uint8_t* data,
                       size_t len) = 0;
};

constexpr uint8_t kDefaultAddress = 0x58;
constexpr uint8_t kRegOutputRange = 0x01;
constexpr uint8_t kRegChannel0 = 0x02;
constexpr uint8_t kRangeCode0to5V = 0x00;
constexpr uint16_t kRangeMv = 5000;  // driver always runs the 0-5 V range

class AnalogThrottle : public sh::IThrottleOutput {
public:
    // max_output_mv: software full-scale ceiling (100% command), <= 5000.
    AnalogThrottle(II2cBus& bus, uint8_t address = kDefaultAddress,
                   uint16_t max_output_mv = 4500);

    // Selects the 0-5 V range and forces the output to 0 V.
    // Must return true before write() will emit non-zero commands.
    bool begin();

    // sh::IThrottleOutput: cmd_pct clamped to [0, 100], scaled onto
    // [0, max_output_mv].
    void write(float cmd_pct) override;

    // False after any failed I2C transaction (until one succeeds again);
    // the supervisor treats an unhealthy throttle as a safety fault.
    bool healthy() const { return healthy_; }
    uint16_t lastOutputMv() const { return last_mv_; }

private:
    bool writeMillivolts(uint16_t mv);

    II2cBus& bus_;
    uint8_t address_;
    uint16_t max_mv_;
    bool initialized_ = false;
    bool healthy_ = false;
    uint16_t last_mv_ = 0;
};

}  // namespace gp8403
