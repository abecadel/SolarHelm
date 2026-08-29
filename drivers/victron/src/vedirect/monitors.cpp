#include "vedirect/monitors.h"

namespace vedirect {

size_t SmartShuntMonitor::feed(const uint8_t* data, size_t len,
                               uint32_t now_ms) {
    size_t blocks = 0;
    for (size_t i = 0; i < len; ++i) {
        if (parser_.feed(data[i])) {
            applyBlock(parser_.block(), now_ms);
            ++blocks;
        }
    }
    return blocks;
}

void SmartShuntMonitor::applyBlock(const Block& b, uint32_t now_ms) {
    long v_mv = 0;
    long i_ma = 0;
    // V and I are mandatory: a block without both is not a shunt block
    // (or is corrupt in a way the checksum can't see) — ignore it.
    if (!parseLong(b.find("V"), &v_mv) || !parseLong(b.find("I"), &i_ma)) {
        return;
    }
    sh::BatterySample s;
    s.valid = true;
    s.timestamp_ms = now_ms;
    s.voltage_v = static_cast<float>(v_mv) / 1000.0f;
    s.current_a = static_cast<float>(i_ma) / 1000.0f;  // + charging

    // P [W] is emitted by SmartShunt/BMV; fall back to V*I when absent.
    long p_w = 0;
    if (parseLong(b.find("P"), &p_w)) {
        s.power_w = static_cast<float>(p_w);
    } else {
        s.power_w = s.voltage_v * s.current_a;
    }

    // SOC [promille] is optional (unconfigured monitors omit it); keep the
    // previous value so a temporarily missing field doesn't zero the SOC.
    long soc_pm = 0;
    if (parseLong(b.find("SOC"), &soc_pm)) {
        s.soc_pct = static_cast<float>(soc_pm) / 10.0f;
    } else {
        s.soc_pct = last_.soc_pct;
    }

    // T [degC] appears when the shunt's Aux input is a temperature sensor —
    // it feeds the BatteryGuard's temperature policy.
    long t_c = 0;
    if (parseLong(b.find("T"), &t_c)) {
        s.has_temperature = true;
        s.temperature_c = static_cast<float>(t_c);
    }
    last_ = s;
}

size_t VictronMpptMonitor::feed(const uint8_t* data, size_t len,
                                uint32_t now_ms) {
    size_t blocks = 0;
    for (size_t i = 0; i < len; ++i) {
        if (parser_.feed(data[i])) {
            applyBlock(parser_.block(), now_ms);
            ++blocks;
        }
    }
    return blocks;
}

void VictronMpptMonitor::applyBlock(const Block& b, uint32_t now_ms) {
    long ppv_w = 0;
    if (!parseLong(b.find("PPV"), &ppv_w)) {
        return;  // not an MPPT block
    }
    last_.valid = true;
    last_.timestamp_ms = now_ms;
    last_.power_w = static_cast<float>(ppv_w);

    long cs = 0;
    if (parseLong(b.find("CS"), &cs)) {
        charge_state_ = static_cast<int>(cs);
    }
}

}  // namespace vedirect
