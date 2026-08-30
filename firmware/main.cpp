// SolarHelm ESP32-S3 firmware — Milestone 2 hardware bindings.
//
// Everything with logic lives in the desktop-tested libraries (lib/,
// drivers/); this file only moves bytes between peripherals and those
// libraries:
//
//   Serial1 (VE.Direct 19200) -> vedirect::SmartShuntMonitor -> Helm
//   Serial2 (NMEA 115200)     -> nmea::GpsMonitor            -> Helm
//   Helm command              -> gp8403::AnalogThrottle over Wire
//   SoftAP "SolarHelm" + HTTP JSON API (sh/net/applink):
//       GET  /telemetry  -> latest telemetry record
//       POST /remote     -> {"target_w": N} for REMOTE mode
//
// Fail-safe rules enforced here (docs/SAFETY.md; bench gates A1-A7):
//  - boots in MANUAL, automatic throttle asserted to 0 V in setup()
//  - the AUTO relay is held by a TOGGLING heartbeat, emitted only while
//    Helm reports an active automatic mode — a crash/hang stops the edges
//    and the monostable drops the boat to MANUAL in hardware
//  - the physical AUTO switch is the explicit activation the safety rules
//    require; the phone can steer REMOTE only while it is on
//  - kill-switch sense or an unhealthy throttle DAC forces MANUAL
//  - the task watchdog reboots a hung loop; reboot lands back in MANUAL
//
// NOT unit-testable on the desktop by design (excluded from the coverage
// gate); every behaviour above has a physical acceptance test in
// docs/HARDWARE_TEST_PLAN.md and must pass there before Wave-2 ordering.

#include <Arduino.h>
#include <LittleFS.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Wire.h>

#include <esp_task_wdt.h>

#include "gp8403/throttle.h"
#include "nmea/parser.h"
#include "pins.h"
#include "sh/core/config.h"
#include "sh/core/helm.h"
#include "sh/net/applink.h"
#include "vedirect/monitors.h"

namespace {

constexpr uint32_t kControlPeriodMs = 100;  // 10 Hz, same as the simulator
constexpr uint32_t kWdtTimeoutS = 5;
constexpr char kApSsid[] = "SolarHelm";
constexpr char kApPassword[] = "solarhelm";  // bench default; change on boat

sh::ControlConfig g_config;  // validated defaults; NVS config is later work

class SerialTransitionLogger : public sh::ITransitionLogger {
public:
    void onModeChange(uint32_t t_ms, sh::Mode from, sh::Mode to,
                      const char* reason) override {
        Serial.printf("[%lu] mode %s -> %s (%s)\n",
                      static_cast<unsigned long>(t_ms), sh::modeName(from),
                      sh::modeName(to), reason);
    }
};

// ~10-line Wire adapter the throttle driver was designed around.
class WireBus : public gp8403::II2cBus {
public:
    bool write(uint8_t device, uint8_t reg, const uint8_t* data,
               size_t len) override {
        Wire.beginTransmission(device);
        Wire.write(reg);
        Wire.write(data, len);
        return Wire.endTransmission() == 0;
    }
};

SerialTransitionLogger g_logger;
sh::Helm g_helm(g_config, &g_logger);
vedirect::SmartShuntMonitor g_shunt;
nmea::GpsMonitor g_gps;
WireBus g_bus;
gp8403::AnalogThrottle g_throttle(g_bus);
WebServer g_server(80);

uint32_t g_last_tick_ms = 0;
bool g_heartbeat_level = false;
bool g_auto_switch_stable = false;  // debounced: true = AUTO enabled
bool g_auto_switch_last_raw = false;
char g_telemetry_json[512] = "{}";

void pumpSerialInputs(uint32_t now_ms) {
    uint8_t buf[128];
    while (Serial1.available() > 0) {
        const size_t n = Serial1.read(buf, sizeof(buf));
        g_shunt.feed(buf, n, now_ms);
    }
    while (Serial2.available() > 0) {
        const size_t n = Serial2.read(buf, sizeof(buf));
        g_gps.feed(buf, n, now_ms);
    }
}

void sendCors() {
    g_server.sendHeader("Access-Control-Allow-Origin", "*");
    g_server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    g_server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleTelemetry() {
    sendCors();
    g_server.send(200, "application/json", g_telemetry_json);
}

void handleRemote() {
    sendCors();
    const String body = g_server.arg("plain");
    const sh::RemoteCommand cmd =
        sh::parseRemoteCommand(body.c_str(), body.length());
    if (!cmd.valid) {
        g_server.send(400, "application/json",
                      "{\"ok\":false,\"error\":\"need target_w in "
                      "[0,100000]\"}");
        return;
    }
    const uint32_t now_ms = millis();
    g_helm.setRemoteTarget(cmd.target_w, now_ms);
    // REMOTE only ever engages while the physical AUTO switch grants
    // automatic control; otherwise the target just sits fresh, and the
    // helm stays whatever it was.
    if (g_auto_switch_stable && g_helm.mode() != sh::Mode::kRemote) {
        g_helm.requestMode(sh::Mode::kRemote, now_ms);
    }
    g_server.send(200, "application/json", "{\"ok\":true}");
}

void handleOptions() {
    sendCors();
    g_server.send(204);
}

void controlTick(uint32_t now_ms, float dt_s) {
    // Debounce the AUTO switch at tick rate: two consecutive samples.
    const bool auto_raw = digitalRead(kPinAutoSwitch) == LOW;
    if (auto_raw == g_auto_switch_last_raw &&
        auto_raw != g_auto_switch_stable) {
        g_auto_switch_stable = auto_raw;
        if (g_auto_switch_stable) {
            // Explicit activation: enter SOLAR (REMOTE upgrades via HTTP).
            g_helm.requestMode(sh::Mode::kSolar, now_ms);
        } else {
            g_helm.forceManual("AUTO switch off", now_ms);
        }
    }
    g_auto_switch_last_raw = auto_raw;

    if (digitalRead(kPinKillSense) == LOW) {
        g_helm.forceManual("kill switch", now_ms);
    }
    if (!g_throttle.healthy() && g_helm.mode() != sh::Mode::kManual) {
        g_helm.forceManual("throttle I2C fault", now_ms);
    }

    const sh::BatterySample battery = g_shunt.read();
    sh::SolarSample solar;  // MPPT VE.Direct arrives with Wave 3
    const sh::GpsSample gps = g_gps.read();
    const sh::HelmOutput out = g_helm.step(now_ms, dt_s, battery, solar, gps);

    // The automatic throttle output: exactly the Helm command while an
    // automatic mode is active, hard 0 otherwise.
    g_throttle.write(out.auto_active ? out.motor_cmd_pct : 0.0f);

    // Relay heartbeat: edges only while auto is truly active.
    if (out.auto_active) {
        g_heartbeat_level = !g_heartbeat_level;
        digitalWrite(kPinAutoHeartbeat, g_heartbeat_level ? HIGH : LOW);
    } else {
        digitalWrite(kPinAutoHeartbeat, LOW);
    }
    digitalWrite(kPinStatusLed, out.auto_active ? HIGH : LOW);

    sh::writeTelemetryJson(out.telemetry, g_telemetry_json,
                           sizeof(g_telemetry_json));
}

}  // namespace

void setup() {
    // Outputs first, all safe: no throttle, no heartbeat.
    pinMode(kPinAutoHeartbeat, OUTPUT);
    digitalWrite(kPinAutoHeartbeat, LOW);
    pinMode(kPinStatusLed, OUTPUT);
    digitalWrite(kPinStatusLed, LOW);
    pinMode(kPinBuzzer, OUTPUT);
    digitalWrite(kPinBuzzer, LOW);
    pinMode(kPinAutoSwitch, INPUT_PULLUP);
    pinMode(kPinKillSense, INPUT_PULLUP);

    Serial.begin(115200);
    Serial1.begin(19200, SERIAL_8N1, kPinVeDirectRx, -1);
    Serial2.begin(115200, SERIAL_8N1, kPinGpsRx, kPinGpsTx);

    Wire.begin(kPinI2cSda, kPinI2cScl);
    // Re-asserts 0 V before anything else may run (gate A1 behaviour).
    if (!g_throttle.begin()) {
        Serial.println("WARN: throttle DAC not responding (I2C)");
    }

    WiFi.mode(WIFI_AP);
    WiFi.softAP(kApSsid, kApPassword);
    g_server.on("/telemetry", HTTP_GET, handleTelemetry);
    g_server.on("/remote", HTTP_POST, handleRemote);
    g_server.on("/remote", HTTP_OPTIONS, handleOptions);
    // The companion app itself, served from flash so the phone needs
    // nothing but this access point (tools/pack_fs.sh + uploadfs).
    if (LittleFS.begin()) {
        g_server.serveStatic("/", LittleFS, "/www/", "max-age=600");
    } else {
        Serial.println("WARN: LittleFS not mounted - app not served "
                       "(run pack_fs.sh + uploadfs)");
    }
    g_server.begin();

    esp_task_wdt_init(kWdtTimeoutS, true);
    esp_task_wdt_add(nullptr);

    g_last_tick_ms = millis();
    Serial.printf("SolarHelm up: MANUAL, throttle 0 V, AP \"%s\" at %s\n",
                  kApSsid, WiFi.softAPIP().toString().c_str());
}

void loop() {
    esp_task_wdt_reset();
    const uint32_t now_ms = millis();
    pumpSerialInputs(now_ms);
    g_server.handleClient();
    if (now_ms - g_last_tick_ms < kControlPeriodMs) {
        return;
    }
    const float dt_s = (now_ms - g_last_tick_ms) / 1000.0f;
    g_last_tick_ms = now_ms;
    controlTick(now_ms, dt_s);
}
