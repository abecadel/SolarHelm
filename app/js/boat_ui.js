// Boat tab: the live link to the ESP32 over its SoftAP HTTP API
// (firmware/main.cpp + sh/net/applink — GET /telemetry, POST /remote).
//
// Everything injectable: fetch, timers, download. The recorder captures
// each telemetry sample; Export produces the exact CSV the C++ core logs
// (sh::telemetryCsvHeader order) so the Model tab's learner — and the
// desktop tools — consume it unchanged.

export const DEFAULT_BOAT_URL = 'http://192.168.4.1';
export const POLL_MS = 1000;

export const MODE_NAMES = ['MANUAL', 'SOLAR', 'SOLAR+', 'REMOTE'];

export const FAULT_NAMES = [
  'battery-stale', 'battery-implausible', 'gps-stale', 'soc-at-reserve',
  'config-invalid', 'solar-stale', 'sag-soft', 'sag-hard', 'sag-stop',
  'over-current', 'batt-temp-derate', 'charge-below-freezing',
  'remote-stale',
];

export function decodeFaults(flags) {
  const out = [];
  for (let i = 0; i < FAULT_NAMES.length; i++) {
    if (flags & (1 << i)) out.push(FAULT_NAMES[i]);
  }
  return out;
}

export const CSV_HEADER =
    'timestamp_ms,mode,battery_voltage_v,battery_current_a,' +
    'battery_power_w,battery_soc_pct,solar_power_w,motor_command_pct,' +
    'motor_estimated_power_w,speed_kmh,distance_today_km,' +
    'energy_solar_today_wh,energy_motor_today_wh,energy_hotel_today_wh,' +
    'efficiency_wh_km,reserve_soc_pct,fault_flags';

export function toCsv(samples) {
  const rows = samples.map((t) => [
    t.timestamp_ms, t.mode, t.battery_voltage_v, t.battery_current_a,
    t.battery_power_w, t.battery_soc_pct, t.solar_power_w,
    t.motor_command_pct, t.motor_estimated_power_w, t.speed_kmh,
    t.distance_today_km, t.energy_solar_today_wh, t.energy_motor_today_wh,
    t.energy_hotel_today_wh, t.efficiency_wh_km, t.reserve_soc_pct,
    t.fault_flags,
  ].join(','));
  return [CSV_HEADER, ...rows].join('\n');
}

export function renderTelemetry(doc, t) {
  const faults = decodeFaults(t.fault_flags);
  doc.getElementById('boat-cards').innerHTML = `
    <div class="cards">
      <div class="card"><b>${MODE_NAMES[t.mode] ?? `#${t.mode}`}</b>
        <span>mode</span></div>
      <div class="card"><b>${t.battery_power_w.toFixed(0)} W</b>
        <span>battery power</span></div>
      <div class="card"><b>${t.battery_soc_pct.toFixed(0)}%</b>
        <span>SOC</span></div>
      <div class="card"><b>${t.battery_voltage_v.toFixed(2)} V</b>
        <span>${t.battery_current_a.toFixed(1)} A</span></div>
      <div class="card"><b>${t.solar_power_w.toFixed(0)} W</b>
        <span>solar</span></div>
      <div class="card"><b>${t.motor_estimated_power_w.toFixed(0)} W</b>
        <span>motor (${t.motor_command_pct.toFixed(0)}%)</span></div>
      <div class="card"><b>${t.speed_kmh.toFixed(1)} km/h</b>
        <span>${t.distance_today_km.toFixed(1)} km today</span></div>
      <div class="card"><b>${t.efficiency_wh_km.toFixed(0)} Wh/km</b>
        <span>efficiency</span></div>
    </div>
    ${faults.length
      ? `<div class="verdict warn">faults: ${faults.join(', ')}</div>`
      : '<div class="verdict ok">no faults</div>'}`;
}

export async function pollOnce(deps, state) {
  const doc = deps.doc;
  try {
    const resp = await deps.fetchImpl(`${state.boatUrl}/telemetry`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const t = await resp.json();
    state.samples.push(t);
    renderTelemetry(doc, t);
    doc.getElementById('boat-status').textContent =
        `Live — ${state.samples.length} samples recorded this session`;
    return true;
  } catch (err) {
    doc.getElementById('boat-status').textContent =
        `No boat at ${state.boatUrl} (${err && err.message ? err.message
                                                          : err}). ` +
        'Join the SolarHelm Wi-Fi and retry.';
    return false;
  }
}

export async function sendRemote(deps, state) {
  const doc = deps.doc;
  const target = parseFloat(doc.getElementById('boat-target').value);
  if (!Number.isFinite(target) || target < 0) {
    doc.getElementById('boat-remote-status').textContent =
        'Enter a motor power target in watts (>= 0).';
    return false;
  }
  try {
    const resp = await deps.fetchImpl(`${state.boatUrl}/remote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_w: target }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    doc.getElementById('boat-remote-status').textContent =
        `REMOTE target ${target.toFixed(0)} W sent. The boat degrades to ` +
        'SOLAR 10 s after targets stop.';
    return true;
  } catch (err) {
    doc.getElementById('boat-remote-status').textContent =
        `Send failed: ${err && err.message ? err.message : err}`;
    return false;
  }
}

/** Wires the Boat tab. deps adds: setIntervalFn, clearIntervalFn,
 *  download(filename, text). Returns the tab state (for tests). */
export function initBoat(deps) {
  const doc = deps.doc;
  const state = { boatUrl: DEFAULT_BOAT_URL, samples: [], timer: null };
  doc.getElementById('boat-url').value = DEFAULT_BOAT_URL;

  const stop = () => {
    if (state.timer !== null) {
      deps.clearIntervalFn(state.timer);
      state.timer = null;
    }
    doc.getElementById('boat-connect').textContent = 'Connect';
  };

  doc.getElementById('boat-connect').addEventListener('click', () => {
    if (state.timer !== null) {
      stop();
      doc.getElementById('boat-status').textContent =
          `Disconnected — ${state.samples.length} samples kept.`;
      return;
    }
    state.boatUrl =
        (doc.getElementById('boat-url').value || DEFAULT_BOAT_URL)
            .replace(/\/+$/, '');
    doc.getElementById('boat-connect').textContent = 'Disconnect';
    doc.getElementById('boat-status').textContent = 'Connecting…';
    pollOnce(deps, state);
    state.timer = deps.setIntervalFn(() => pollOnce(deps, state), POLL_MS);
  });

  doc.getElementById('boat-send').addEventListener('click',
      () => sendRemote(deps, state));

  doc.getElementById('boat-export').addEventListener('click', () => {
    if (state.samples.length === 0) {
      doc.getElementById('boat-status').textContent =
          'Nothing recorded yet — connect to the boat first.';
      return;
    }
    deps.download(`solarhelm-log-${Date.now()}.csv`, toCsv(state.samples));
    doc.getElementById('boat-status').textContent =
        `Exported ${state.samples.length} samples. Feed the CSV to the ` +
        'Model tab to refit the hull curve.';
  });

  return state;
}
