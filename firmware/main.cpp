// SolarHelm ESP32-S3 firmware — Milestone 2 entry point (compiling stub).
//
// Milestone 1 deliberately ships no hardware behaviour: this stub exists to
// prove the portable core (lib/solarhelm) compiles for the ESP32-S3 target
// unchanged. Milestone 2 adds: VE.Direct SmartShunt driver, GNSS driver,
// GP8403 DAC ThrottleDriver, MANUAL/AUTO input, hardware watchdog wiring.
//
// NOTE for reviewers: per docs/SAFETY.md, nothing here may ever command
// propulsion at boot. The stub keeps the (future) automatic throttle output
// at exactly 0 and stays in MANUAL.

#include <Arduino.h>

#include "sh/core/config.h"
#include "sh/core/helm.h"
#include "vedirect/monitors.h"

namespace {

constexpr uint32_t kControlPeriodMs = 250;  // 4 Hz control tick

sh::ControlConfig g_config;  // defaults; NVS-backed config is Milestone 2

class SerialTransitionLogger : public sh::ITransitionLogger {
public:
    void onModeChange(uint32_t t_ms, sh::Mode from, sh::Mode to,
                      const char* reason) override {
        Serial.printf("[%lu] mode %s -> %s (%s)\n",
                      static_cast<unsigned long>(t_ms), sh::modeName(from),
                      sh::modeName(to), reason);
    }
};

SerialTransitionLogger g_logger;
sh::Helm g_helm(g_config, &g_logger);
// SmartShunt over VE.Direct (UART wiring lands with Milestone 2's HIL
// step; the desktop-tested parser is already the battery source).
vedirect::SmartShuntMonitor g_shunt;
uint32_t g_last_tick_ms = 0;

}  // namespace

void setup() {
    Serial.begin(115200);
    Serial.println("SolarHelm stub: MANUAL mode, automatic throttle = 0");
}

void loop() {
    const uint32_t now_ms = millis();
    if (now_ms - g_last_tick_ms < kControlPeriodMs) {
        return;
    }
    const float dt_s = (now_ms - g_last_tick_ms) / 1000.0f;
    g_last_tick_ms = now_ms;

    // Milestone 2 HIL: pump Serial1 bytes into g_shunt here
    // (g_shunt.feed(buf, n, now_ms)). Until the UART is wired, the sample
    // stays invalid and the SafetySupervisor keeps automatic mode locked
    // out — exactly the fail-safe default we want.
    const sh::BatterySample battery = g_shunt.read();
    sh::SolarSample solar;
    sh::GpsSample gps;
    const sh::HelmOutput out = g_helm.step(now_ms, dt_s, battery, solar, gps);
    (void)out;  // Milestone 2: out.motor_cmd_pct -> IThrottleOutput (DAC)
}
