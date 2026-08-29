# Hardware drivers (Milestone 2)

Real-device drivers land here, each implementing one of the core
interfaces from `lib/solarhelm/src/sh/drivers/interfaces.h`. Milestone 1
ships interfaces + simulated implementations only (`lib/simcore`), so the
core stays uncoupled from any manufacturer.

Planned layout (protocol parsers are pure C++ and desktop-tested with
recorded frames; only the thin UART/I2C bindings are ESP32-specific):

```
drivers/
  victron/    ✅ IMPLEMENTED: VE.Direct text-protocol parser (byte-fed
              state machine, checksum-validated, HEX-frame tolerant, no
              dynamic allocation) + SmartShuntMonitor (IBatteryMonitor)
              and VictronMpptMonitor (ISolarMonitor). Desktop-tested to
              100% line coverage with synthesized protocol frames
              (tests/test_vedirect.cpp); the ESP32 UART binding is the
              remaining Milestone-2 hardware step.
  gps/        ✅ IMPLEMENTED: NMEA 0183 parser (RMC/VTG/GGA, XOR
              checksum, any talker, fixed buffers) + GpsMonitor (IGps)
              using Doppler SOG. 100% coverage (tests/test_nmea.cpp).
              Remaining: ESP32 UART binding + u-blox 5-10 Hz config.
  throttle/   ✅ IMPLEMENTED: GP8403 (DFR0971) AnalogThrottle
              (IThrottleOutput, 0-5 V) over an injected I2C bus; register
              protocol read from DFRobot's own library source; power-on
              zero re-asserted, EEPROM store deliberately unimplemented,
              software ceiling under the hardware clamp. 100% coverage
              (tests/test_gp8403.cpp). Remaining: ESP32 Wire binding +
              the cold-boot 0 V bench verification.
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
