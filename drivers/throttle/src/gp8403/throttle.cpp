#include "gp8403/throttle.h"

namespace gp8403 {

AnalogThrottle::AnalogThrottle(II2cBus& bus, uint8_t address,
                               uint16_t max_output_mv)
    : bus_(bus),
      address_(address),
      max_mv_(max_output_mv > kRangeMv ? kRangeMv : max_output_mv) {}

bool AnalogThrottle::begin() {
    const uint8_t range = kRangeCode0to5V;
    if (!bus_.write(address_, kRegOutputRange, &range, 1)) {
        healthy_ = false;
        return false;
    }
    // Assert zero output explicitly — the chip powers up at 0 V, but after
    // an MCU-only reboot the DAC may still hold a stale voltage.
    if (!writeMillivolts(0)) {
        return false;
    }
    initialized_ = true;
    return true;
}

bool AnalogThrottle::writeMillivolts(uint16_t mv) {
    // 12-bit code, <<4, low byte first — per DFRobot_GP8403::sendData.
    const uint16_t code = static_cast<uint16_t>(
        (static_cast<float>(mv) / static_cast<float>(kRangeMv)) * 4095.0f);
    const uint16_t shifted = static_cast<uint16_t>(code << 4);
    const uint8_t payload[2] = {
        static_cast<uint8_t>(shifted & 0xFF),
        static_cast<uint8_t>((shifted >> 8) & 0xFF),
    };
    healthy_ = bus_.write(address_, kRegChannel0, payload, sizeof(payload));
    if (healthy_) {
        last_mv_ = mv;
    }
    return healthy_;
}

void AnalogThrottle::write(float cmd_pct) {
    if (cmd_pct < 0.0f) {
        cmd_pct = 0.0f;
    } else if (cmd_pct > 100.0f) {
        cmd_pct = 100.0f;
    }
    if (!initialized_) {
        // Never emit a command before begin() succeeded; keep asserting
        // zero so a half-configured DAC cannot hold a stale voltage.
        writeMillivolts(0);
        return;
    }
    const uint16_t mv =
        static_cast<uint16_t>(cmd_pct / 100.0f * static_cast<float>(max_mv_));
    writeMillivolts(mv);
}

}  // namespace gp8403
