// Unit tests: GP8403 AnalogThrottle against a recording fake I2C bus.
// Expected wire bytes are hard-coded from the register protocol in
// DFRobot's library source (12-bit code <<4, low byte first).

#include <cstring>
#include <vector>

#include "framework.h"
#include "gp8403/throttle.h"

using gp8403::AnalogThrottle;
using gp8403::II2cBus;

namespace {

struct Txn {
    uint8_t device;
    uint8_t reg;
    std::vector<uint8_t> data;
};

class FakeBus : public II2cBus {
public:
    bool write(uint8_t device, uint8_t reg, const uint8_t* data,
               size_t len) override {
        txns.push_back({device, reg, {data, data + len}});
        if (fail_next > 0) {
            --fail_next;
            return false;
        }
        return !fail_all;
    }
    std::vector<Txn> txns;
    int fail_next = 0;
    bool fail_all = false;
};

// The exact code the DAC receives for a given millivolt value.
uint16_t wireWord(uint16_t mv) {
    const uint16_t code =
        static_cast<uint16_t>((static_cast<float>(mv) / 5000.0f) * 4095.0f);
    return static_cast<uint16_t>(code << 4);
}

}  // namespace

TEST(begin_configures_range_then_asserts_zero) {
    FakeBus bus;
    AnalogThrottle t(bus);
    CHECK(t.begin());
    CHECK(bus.txns.size() == 2);
    // 1) range register 0x01 <- 0x00 (0-5 V)
    CHECK(bus.txns[0].device == 0x58);
    CHECK(bus.txns[0].reg == gp8403::kRegOutputRange);
    CHECK(bus.txns[0].data.size() == 1);
    CHECK(bus.txns[0].data[0] == gp8403::kRangeCode0to5V);
    // 2) channel 0 <- 0 V
    CHECK(bus.txns[1].reg == gp8403::kRegChannel0);
    CHECK(bus.txns[1].data.size() == 2);
    CHECK(bus.txns[1].data[0] == 0x00);
    CHECK(bus.txns[1].data[1] == 0x00);
    CHECK(t.healthy());
    CHECK(t.lastOutputMv() == 0);
}

TEST(begin_fails_on_nack_of_either_write) {
    // Range-register write NACKs.
    FakeBus bus;
    bus.fail_next = 1;
    AnalogThrottle t(bus);
    CHECK(!t.begin());
    CHECK(!t.healthy());

    // Range succeeds, the zero-assert write NACKs.
    class ZeroFailBus : public II2cBus {
    public:
        bool write(uint8_t, uint8_t reg, const uint8_t*, size_t) override {
            return reg != gp8403::kRegChannel0;
        }
    } zfb;
    AnalogThrottle t2(zfb);
    CHECK(!t2.begin());
    CHECK(!t2.healthy());
}

TEST(write_scales_percent_onto_ceiling) {
    FakeBus bus;
    AnalogThrottle t(bus, 0x58, 4500);
    CHECK(t.begin());
    t.write(50.0f);  // 2250 mV
    const uint16_t w = wireWord(2250);
    const Txn& txn = bus.txns.back();
    CHECK(txn.reg == gp8403::kRegChannel0);
    CHECK(txn.data[0] == (w & 0xFF));
    CHECK(txn.data[1] == ((w >> 8) & 0xFF));
    CHECK(t.lastOutputMv() == 2250);

    t.write(100.0f);  // ceiling: 4500 mV, not 5000
    CHECK(t.lastOutputMv() == 4500);
    const uint16_t full = wireWord(4500);
    CHECK(bus.txns.back().data[1] == ((full >> 8) & 0xFF));
}

TEST(write_clamps_out_of_range_commands) {
    FakeBus bus;
    AnalogThrottle t(bus);
    t.begin();
    t.write(250.0f);
    CHECK(t.lastOutputMv() == 4500);  // clamped to 100% of ceiling
    t.write(-40.0f);
    CHECK(t.lastOutputMv() == 0);
}

TEST(ceiling_is_capped_at_the_5v_range) {
    FakeBus bus;
    AnalogThrottle t(bus, 0x58, 9999);  // absurd ceiling requested
    t.begin();
    t.write(100.0f);
    CHECK(t.lastOutputMv() == 5000);  // capped to the range
}

TEST(write_before_begin_emits_only_zero) {
    FakeBus bus;
    AnalogThrottle t(bus);
    t.write(80.0f);  // not initialized
    CHECK(bus.txns.size() == 1);
    CHECK(bus.txns[0].reg == gp8403::kRegChannel0);
    CHECK(bus.txns[0].data[0] == 0x00);
    CHECK(bus.txns[0].data[1] == 0x00);
}

TEST(nack_marks_unhealthy_and_recovers) {
    FakeBus bus;
    AnalogThrottle t(bus);
    CHECK(t.begin());
    bus.fail_next = 1;
    t.write(30.0f);
    CHECK(!t.healthy());
    CHECK(t.lastOutputMv() == 0);  // failed write doesn't update last value
    t.write(30.0f);
    CHECK(t.healthy());
    CHECK(t.lastOutputMv() == 1350);
}

TEST(driver_never_touches_other_registers) {
    FakeBus bus;
    AnalogThrottle t(bus);
    t.begin();
    for (float c = 0.0f; c <= 100.0f; c += 7.3f) {
        t.write(c);
    }
    for (const Txn& txn : bus.txns) {
        CHECK(txn.reg == gp8403::kRegOutputRange ||
              txn.reg == gp8403::kRegChannel0);
    }
}

TEST_MAIN()
