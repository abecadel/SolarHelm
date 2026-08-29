// SolarHelm ESP32-S3-DevKitC-1 pin map — bench wiring reference.
//
// These are working defaults chosen to avoid the S3's strapping pins
// (0, 3, 45, 46), the USB pins (19/20) and the octal-PSRAM pins (35-37).
// Adjust here (one place) if the bench layout differs; docs/WIRING.md is
// the authoritative wiring description, this header the authoritative pin
// numbering. Verified electrically in bench gates A1-A5
// (docs/HARDWARE_TEST_PLAN.md) before any propulsion work.

#pragma once

// I2C bus to the GP8403 throttle DAC (DFRobot DFR0971).
constexpr int kPinI2cSda = 8;
constexpr int kPinI2cScl = 9;

// VE.Direct from the SmartShunt: 3.3 V logic, listen-only.
// (VE.Direct pin 3 "TX" -> this RX; common GND; never 5 V.)
constexpr int kPinVeDirectRx = 18;

// GNSS (NEO-M8N class), 115200 8N1. TX reserved for config commands.
constexpr int kPinGpsRx = 17;
constexpr int kPinGpsTx = 16;

// Heartbeat toward the AC-coupled monostable that holds the AUTO relay:
// the relay stays energized only while this pin keeps TOGGLING (a level,
// high or low, must never hold it — bench gate A5).
constexpr int kPinAutoHeartbeat = 4;

// Physical MANUAL/AUTO switch: INPUT_PULLUP, switch closes to GND.
// LOW = skipper has enabled automatic control.
constexpr int kPinAutoSwitch = 5;

// Kill-switch SENSE (via optocoupler, sense only — the kill switch cuts
// propulsion power directly, docs/WIRING.md). LOW = kill active.
constexpr int kPinKillSense = 6;

// Operator feedback.
constexpr int kPinStatusLed = 2;
constexpr int kPinBuzzer = 7;
