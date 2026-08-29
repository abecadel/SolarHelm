// VE.Direct device adapters: turn parsed text blocks into SolarHelm
// driver-interface samples.
//
//   SmartShuntMonitor  -> sh::IBatteryMonitor (SmartShunt / BMV-71x)
//   VictronMpptMonitor -> sh::ISolarMonitor   (SmartSolar / BlueSolar)
//
// Feed raw UART bytes with a timestamp; read() returns the latest sample.
// Freshness policy stays with the SafetySupervisor (the sample carries the
// timestamp of the last valid block) — these adapters never block and
// never invent data: fields missing from a block leave the previous field
// value in place only when the block clearly belongs to the same device
// class; a block without the mandatory fields is ignored entirely.

#pragma once

#include "sh/drivers/interfaces.h"
#include "vedirect/parser.h"

namespace vedirect {

class SmartShuntMonitor : public sh::IBatteryMonitor {
public:
    // Consume raw serial bytes; now_ms timestamps any block completed
    // while consuming them. Returns the number of valid blocks seen.
    size_t feed(const uint8_t* data, size_t len, uint32_t now_ms);

    sh::BatterySample read() override { return last_; }

    const Parser& parser() const { return parser_; }

private:
    void applyBlock(const Block& b, uint32_t now_ms);

    Parser parser_;
    sh::BatterySample last_;
};

class VictronMpptMonitor : public sh::ISolarMonitor {
public:
    size_t feed(const uint8_t* data, size_t len, uint32_t now_ms);

    sh::SolarSample read() override { return last_; }

    // Charger state (VE.Direct `CS`): 0 off, 3 bulk, 4 absorption,
    // 5 float, ... -1 until first seen. Absorption/float mean the charger
    // is curtailing: measured PV underestimates the array's potential
    // (see docs/RESEARCH.md §5) — surfaced for telemetry/UI.
    int chargeState() const { return charge_state_; }

    const Parser& parser() const { return parser_; }

private:
    void applyBlock(const Block& b, uint32_t now_ms);

    Parser parser_;
    sh::SolarSample last_;
    int charge_state_ = -1;
};

}  // namespace vedirect
