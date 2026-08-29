// SolarHelm — hardware abstraction interfaces.
//
// The control core talks ONLY to these interfaces. Concrete drivers
// (Victron SmartShunt over VE.Direct, u-blox GNSS, GP8403 DAC, VESC, CAN,
// simulator models, ...) implement them as plugins. This is what lets the
// identical core run in the desktop simulator and on the ESP32.
//
// Implementations must be non-blocking: read() returns the latest known
// sample immediately; freshness is judged by the SafetySupervisor from
// sample timestamps, never by blocking waits.

#pragma once

#include "sh/core/samples.h"

namespace sh {

class IBatteryMonitor {
public:
    virtual ~IBatteryMonitor() = default;
    // Latest battery sample. sample.valid == false means "no data yet".
    virtual BatterySample read() = 0;
};

class ISolarMonitor {
public:
    virtual ~ISolarMonitor() = default;
    virtual SolarSample read() = 0;
};

class IGps {
public:
    virtual ~IGps() = default;
    virtual GpsSample read() = 0;
};

// Low-power throttle command output (never switches motor current itself).
// Implementations: GP8403 0-5 V DAC, VESC UART, CAN, PWM, simulator.
class IThrottleOutput {
public:
    virtual ~IThrottleOutput() = default;
    // cmd_pct in [0, 100]; implementations must clamp defensively and must
    // default to 0 on power-up and after any fault.
    virtual void write(float cmd_pct) = 0;
};

}  // namespace sh
