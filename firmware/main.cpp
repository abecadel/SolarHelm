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
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <LittleFS.h>
#include <Preferences.h>
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

// BLE GATT: the underway link for the HTTPS-served app (Web Bluetooth
// needs a secure context, and a secure page cannot call the boat's plain
// HTTP - so telemetry reads and REMOTE targets also ride BLE). Same
// UUIDs in app/js/ble_link.js.
constexpr char kBleService[] = "0b3d5c00-e8a0-4013-9c60-1c3d5c000001";
constexpr char kBleTelemetryChar[] = "0b3d5c00-e8a0-4013-9c60-1c3d5c000002";
constexpr char kBleRemoteChar[] = "0b3d5c00-e8a0-4013-9c60-1c3d5c000003";

sh::ControlConfig g_config;  // defaults overlaid from NVS in setup()
Preferences g_prefs;         // NVS namespace for the tunable config

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
// 768: worst-case record (10-digit timestamp, negative powers, 5-digit
// daily Wh, %.6f position) stays well inside; overflow is checked anyway.
char g_telemetry_json[768] = "{}";
BLECharacteristic* g_ble_telemetry = nullptr;

// The BLE stack runs on its own FreeRTOS task; the Helm runs on the loop
// task. NOTHING from BLE may touch the Helm directly — writes are queued
// under this lock and consumed by loop(), and telemetry is snapshotted
// under it for GATT reads.
portMUX_TYPE g_link_mux = portMUX_INITIALIZER_UNLOCKED;
char g_ble_remote_body[128];
size_t g_ble_remote_len = 0;  // 0 = no pending command

// NVS keys are index-based ("f0".."fN": NVS caps keys at 15 chars, our
// field names don't fit). The namespace carries a version so a change to
// the whitelist ORDER never reads stale slots as the wrong field.
constexpr char kPrefsNamespace[] = "shcfg1";

void loadConfigFromNvs() {
    g_prefs.begin(kPrefsNamespace, /*readOnly=*/true);
    sh::ControlConfig candidate = g_config;
    for (size_t i = 0; i < sh::kConfigFieldCount; ++i) {
        char key[8];
        snprintf(key, sizeof(key), "f%u", static_cast<unsigned>(i));
        candidate.*(sh::kConfigFields[i].member) =
            g_prefs.getFloat(key, candidate.*(sh::kConfigFields[i].member));
    }
    g_prefs.end();
    // A corrupted store must never brick the controller: defaults win.
    if (candidate.validate() == sh::ConfigError::kNone) {
        g_config = candidate;
    } else {
        Serial.println("WARN: stored config invalid - using defaults");
    }
}

void saveConfigToNvs() {
    g_prefs.begin(kPrefsNamespace, /*readOnly=*/false);
    for (size_t i = 0; i < sh::kConfigFieldCount; ++i) {
        char key[8];
        snprintf(key, sizeof(key), "f%u", static_cast<unsigned>(i));
        g_prefs.putFloat(key, g_config.*(sh::kConfigFields[i].member));
    }
    g_prefs.end();
}

void applyRemoteBody(const char* body, size_t len) {
    const sh::RemoteCommand cmd = sh::parseRemoteCommand(body, len);
    if (!cmd.valid) return;
    const uint32_t now_ms = millis();
    g_helm.setRemoteTarget(cmd.target_w, now_ms);
    if (g_auto_switch_stable && g_helm.mode() != sh::Mode::kRemote) {
        g_helm.requestMode(sh::Mode::kRemote, now_ms);
    }
}

class BleRemoteCallbacks : public BLECharacteristicCallbacks {
public:
    // BLE task context: queue the body for the loop task, never touch
    // the Helm from here (see g_link_mux).
    void onWrite(BLECharacteristic* c) override {
        const std::string v = c->getValue();
        if (v.empty() || v.size() >= sizeof(g_ble_remote_body)) return;
        taskENTER_CRITICAL(&g_link_mux);
        memcpy(g_ble_remote_body, v.data(), v.size());
        g_ble_remote_len = v.size();
        taskEXIT_CRITICAL(&g_link_mux);
    }
};

class BleTelemetryCallbacks : public BLECharacteristicCallbacks {
public:
    // BLE task context: snapshot the JSON under the lock right before
    // the read is served, so the phone never sees a torn record.
    void onRead(BLECharacteristic* c) override {
        char snap[sizeof(g_telemetry_json)];
        taskENTER_CRITICAL(&g_link_mux);
        memcpy(snap, g_telemetry_json, sizeof(snap));
        taskEXIT_CRITICAL(&g_link_mux);
        snap[sizeof(snap) - 1] = '\0';
        c->setValue(reinterpret_cast<uint8_t*>(snap), strlen(snap));
    }
};

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
    // REMOTE only ever engages while the physical AUTO switch grants
    // automatic control; otherwise the target just sits fresh, and the
    // helm stays whatever it was.
    applyRemoteBody(body.c_str(), body.length());
    g_server.send(200, "application/json", "{\"ok\":true}");
}

void handleConfigGet() {
    sendCors();
    char buf[768];
    sh::writeConfigJson(g_config, buf, sizeof(buf));
    g_server.send(200, "application/json", buf);
}

void handleConfigPost() {
    sendCors();
    const String body = g_server.arg("plain");
    sh::ControlConfig next;
    const sh::ConfigPatchResult r =
        sh::applyConfigPatch(g_config, body.c_str(), body.length(), &next);
    if (!r.valid) {
        const char* why = r.malformed ? "malformed-value"
            : r.fields_applied == 0 ? "no-known-fields"
                                    : sh::configErrorName(r.error);
        char err[128];
        snprintf(err, sizeof(err),
                 "{\"ok\":false,\"error\":\"%s\",\"fields\":%d}",
                 why, r.fields_applied);
        g_server.send(400, "application/json", err);
        return;
    }
    g_config = next;  // Helm reads this object by reference each tick
    saveConfigToNvs();
    char ok[64];
    snprintf(ok, sizeof(ok), "{\"ok\":true,\"fields\":%d}",
             r.fields_applied);
    g_server.send(200, "application/json", ok);
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

    char json[sizeof(g_telemetry_json)];
    const int n = sh::writeTelemetryJson(out.telemetry, json, sizeof(json));
    if (n <= 0 || static_cast<size_t>(n) >= sizeof(json)) {
        snprintf(json, sizeof(json), "{\"error\":\"telemetry-overflow\"}");
    }
    taskENTER_CRITICAL(&g_link_mux);
    memcpy(g_telemetry_json, json, sizeof(g_telemetry_json));
    taskEXIT_CRITICAL(&g_link_mux);
    // BLE reads snapshot g_telemetry_json in their own onRead callback.
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

    // Tunable config from NVS (validated; defaults on any corruption).
    loadConfigFromNvs();

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
    g_server.on("/config", HTTP_GET, handleConfigGet);
    g_server.on("/config", HTTP_POST, handleConfigPost);
    g_server.on("/config", HTTP_OPTIONS, handleOptions);
    // The companion app itself, served from flash so the phone needs
    // nothing but this access point (tools/pack_fs.sh + uploadfs).
    if (LittleFS.begin()) {
        g_server.serveStatic("/", LittleFS, "/www/", "max-age=600");
    } else {
        Serial.println("WARN: LittleFS not mounted - app not served "
                       "(run pack_fs.sh + uploadfs)");
    }
    g_server.begin();

    // BLE GATT: telemetry (read) + remote target (write). Runtime
    // coexistence of AP WiFi + BLE is tuned at bench gate A7.
    BLEDevice::init(kApSsid);
    BLEServer* ble_server = BLEDevice::createServer();
    BLEService* ble_service = ble_server->createService(kBleService);
    g_ble_telemetry = ble_service->createCharacteristic(
        kBleTelemetryChar, BLECharacteristic::PROPERTY_READ);
    g_ble_telemetry->setCallbacks(new BleTelemetryCallbacks());
    g_ble_telemetry->setValue(g_telemetry_json);
    BLECharacteristic* ble_remote = ble_service->createCharacteristic(
        kBleRemoteChar, BLECharacteristic::PROPERTY_WRITE);
    ble_remote->setCallbacks(new BleRemoteCallbacks());
    ble_service->start();
    BLEDevice::getAdvertising()->addServiceUUID(kBleService);
    BLEDevice::startAdvertising();

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
    // Consume a BLE-queued REMOTE command on THIS task (see g_link_mux).
    char remote[sizeof(g_ble_remote_body)];
    size_t remote_len = 0;
    taskENTER_CRITICAL(&g_link_mux);
    if (g_ble_remote_len > 0) {
        remote_len = g_ble_remote_len;
        memcpy(remote, g_ble_remote_body, remote_len);
        g_ble_remote_len = 0;
    }
    taskEXIT_CRITICAL(&g_link_mux);
    if (remote_len > 0) {
        applyRemoteBody(remote, remote_len);
    }
    if (now_ms - g_last_tick_ms < kControlPeriodMs) {
        return;
    }
    const float dt_s = (now_ms - g_last_tick_ms) / 1000.0f;
    g_last_tick_ms = now_ms;
    controlTick(now_ms, dt_s);
}
