// Boat-link transports.
//
// Why two: a page served over HTTPS (GitHub Pages) may NOT call the
// boat's plain-HTTP API — browsers block mixed content. Web Bluetooth,
// which REQUIRES a secure context, is the underway link for that case:
// the phone keeps its normal internet (forecasts, tiles) and talks GATT
// to the boat. The HTTP transport remains for the app served from the
// ESP32 itself (http://192.168.4.1 — same-origin, no restriction) and
// for initial configuration over the SoftAP.
//
// UUIDs mirror firmware/main.cpp. Everything injected (bluetooth, fetch)
// per the app's DI pattern.

export const BLE_SERVICE = '0b3d5c00-e8a0-4013-9c60-1c3d5c000001';
export const BLE_TELEMETRY = '0b3d5c00-e8a0-4013-9c60-1c3d5c000002';
export const BLE_REMOTE = '0b3d5c00-e8a0-4013-9c60-1c3d5c000003';

export function bleSupported(bluetooth) {
  return !!bluetooth;
}

/** True when the browser will refuse the HTTP link (secure page, plain
 *  boat) — the case Bluetooth exists to solve. */
export function mixedContentBlocked(pageProtocol, baseUrl) {
  return pageProtocol === 'https:' && baseUrl.startsWith('http://');
}

/** HTTP transport against the boat's SoftAP API. */
export function httpLink(fetchImpl, baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    kind: 'http',
    label: base,
    async readTelemetry() {
      const resp = await fetchImpl(`${base}/telemetry`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    async sendRemote(targetW) {
      const resp = await fetchImpl(`${base}/remote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_w: targetW }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    },
    async readConfig() {
      const resp = await fetchImpl(`${base}/config`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    async writeConfig(patch) {
      const resp = await fetchImpl(`${base}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await resp.json();
      if (!resp.ok || !body.ok) {
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      return body;
    },
    disconnect() {},
  };
}

/** Web Bluetooth transport (Android Chrome class browsers; iOS Safari
 *  has no Web Bluetooth — it uses the SoftAP-served app instead). */
export async function connectBle(bluetooth) {
  const device = await bluetooth.requestDevice({
    filters: [{ services: [BLE_SERVICE] }],
  });
  const gatt = await device.gatt.connect();
  const service = await gatt.getPrimaryService(BLE_SERVICE);
  const telemetryChar = await service.getCharacteristic(BLE_TELEMETRY);
  const remoteChar = await service.getCharacteristic(BLE_REMOTE);
  return {
    kind: 'ble',
    label: `BLE: ${device.name ?? 'SolarHelm'}`,
    async readTelemetry() {
      const view = await telemetryChar.readValue();
      return JSON.parse(new TextDecoder().decode(view));
    },
    async sendRemote(targetW) {
      await remoteChar.writeValue(
          new TextEncoder().encode(JSON.stringify({ target_w: targetW })));
    },
    disconnect() {
      if (device.gatt.connected) device.gatt.disconnect();
    },
  };
}
