# Hardware drivers (Milestone 2)

Real-device drivers land here, each implementing one of the core
interfaces from `lib/solarhelm/src/sh/drivers/interfaces.h`. Milestone 1
ships interfaces + simulated implementations only (`lib/simcore`), so the
core stays uncoupled from any manufacturer.

Planned layout (protocol parsers are pure C++ and desktop-tested with
recorded frames; only the thin UART/I2C bindings are ESP32-specific):

```
drivers/
  victron/    VE.Direct text-protocol parser + SmartShunt IBatteryMonitor
              (also usable for Victron MPPT telemetry -> ISolarMonitor)
  gps/        NMEA 0183 (RMC/VTG) parser + u-blox config -> IGps
  throttle/   GP8403 (DFR0971) I2C DAC -> IThrottleOutput (0-5 V)
              later: VescThrottle (UART), CanThrottle (TWAI), PwmThrottle
  mppt/       EPEVER Modbus RTU over RS485 -> ISolarMonitor
  bms/        JK-BMS / JBD serial integrations (telemetry only)
```

Driver rules (see docs/ARCHITECTURE.md and docs/SAFETY.md):
- `read()` is non-blocking and returns the latest sample + timestamp;
  freshness policy belongs to the SafetySupervisor.
- Throttle outputs power up at zero and clamp defensively.
- Every parser gets desktop unit tests with captured real frames before it
  ever runs on hardware.
