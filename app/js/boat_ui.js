// Boat tab: the live link to the ESP32 — over HTTP (SoftAP / boat-served
// app) or Web Bluetooth (HTTPS-served app; see js/ble_link.js for why
// both exist). The recorder captures each telemetry sample; Export
// produces the exact CSV the C++ core logs (sh::telemetryCsvHeader
// order) so the Model tab's learner consumes it unchanged.

import {
  DEFAULT_BOAT_URL,
  bleSupported,
  connectBle,
  guardedHttpLink,
} from './ble_link.js';

export { DEFAULT_BOAT_URL };
export const POLL_MS = 1000;

export const MODE_NAMES = ['MANUAL', 'SOLAR', 'SOLAR+', 'REMOTE', 'RANGE',
                           'ARRIVAL'];

export const FAULT_NAMES = [
  'battery-stale', 'battery-implausible', 'gps-stale', 'soc-at-reserve',
  'config-invalid', 'solar-stale', 'sag-soft', 'sag-hard', 'sag-stop',
  'over-current', 'batt-temp-derate', 'charge-below-freezing',
  'remote-stale', 'arrival-stale',
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
    'efficiency_wh_km,reserve_soc_pct,fault_flags,latitude_deg,' +
    'longitude_deg,config_revision,roll_deg,pitch_deg';

export function toCsv(samples) {
  const rows = samples.map((t) => [
    t.timestamp_ms, t.mode, t.battery_voltage_v, t.battery_current_a,
    t.battery_power_w, t.battery_soc_pct, t.solar_power_w,
    t.motor_command_pct, t.motor_estimated_power_w, t.speed_kmh,
    t.distance_today_km, t.energy_solar_today_wh, t.energy_motor_today_wh,
    t.energy_hotel_today_wh, t.efficiency_wh_km, t.reserve_soc_pct,
    t.fault_flags, t.latitude_deg ?? 0, t.longitude_deg ?? 0,
    t.config_revision ?? 1, t.roll_deg ?? 0, t.pitch_deg ?? 0,
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
      <div class="card"><b>${(t.roll_deg ?? 0).toFixed(1)}° /
        ${(t.pitch_deg ?? 0).toFixed(1)}°</b>
        <span>roll / pitch (rev ${t.config_revision ?? 1})</span></div>
    </div>
    ${faults.length
      ? `<div class="verdict warn">faults: ${faults.join(', ')}</div>`
      : '<div class="verdict ok">no faults</div>'}`;
}

export async function pollOnce(deps, state) {
  const doc = deps.doc;
  try {
    const t = await state.link.readTelemetry();
    // While ARRIVAL is engaged, every poll re-streams the budget so the
    // boat's 10 s staleness watchdog stays fed (1 s cadence).
    if (state.arrivalBudget !== null && state.arrivalBudget !== undefined) {
      await state.link.sendCommand({
        arrival_battery_w: state.arrivalBudget });
    }
    state.samples.push(t);
    renderTelemetry(doc, t);
    doc.getElementById('boat-status').textContent =
        `Live via ${state.link.label} — ${state.samples.length} samples ` +
        'recorded this session';
    return true;
  } catch (err) {
    doc.getElementById('boat-status').textContent =
        `Link down (${err && err.message ? err.message : err}). ` +
        'Check the connection and retry.';
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
  if (!state.link) {
    doc.getElementById('boat-remote-status').textContent =
        'Connect to the boat first.';
    return false;
  }
  try {
    await state.link.sendRemote(target);
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

/** Requests a cruise mode; ARRIVAL also starts the budget stream. */
export async function sendMode(deps, state) {
  const doc = deps.doc;
  const status = doc.getElementById('boat-mode-status');
  if (!state.link) {
    status.textContent = 'Connect to the boat first.';
    return false;
  }
  const mode = doc.getElementById('boat-mode').value;
  const cmd = { mode };
  if (mode === 'arrival') {
    const budget = parseFloat(doc.getElementById('boat-budget').value);
    if (!Number.isFinite(budget) || Math.abs(budget) > 5000) {
      status.textContent =
          'Enter an arrival battery budget in watts (negative = allowed ' +
          'net discharge, within ±5000).';
      return false;
    }
    cmd.arrival_battery_w = budget;
  }
  try {
    await state.link.sendCommand(cmd);
    state.arrivalBudget = mode === 'arrival' ? cmd.arrival_battery_w : null;
    status.textContent = mode === 'arrival'
        ? `ARRIVAL engaged: ${cmd.arrival_battery_w.toFixed(0)} W battery ` +
          'budget, re-streamed every second while connected. The boat ' +
          'degrades to SOLAR 10 s after the stream stops.'
        : `Mode ${mode.toUpperCase()} requested.`;
    return true;
  } catch (err) {
    status.textContent =
        `Send failed: ${err && err.message ? err.message : err}`;
    return false;
  }
}

async function buildLink(deps) {
  const doc = deps.doc;
  const transport = doc.getElementById('boat-transport').value;
  if (transport === 'ble') {
    if (!bleSupported(deps.bluetooth)) {
      throw new Error('this browser has no Web Bluetooth - use the app ' +
                      'served by the boat over Wi-Fi instead');
    }
    return connectBle(deps.bluetooth);
  }
  // The boat link must NEVER go through the offline cache: stale
  // telemetry is worse than none.
  return guardedHttpLink(deps.rawFetch ?? deps.fetchImpl,
                         doc.getElementById('boat-url').value,
                         deps.pageProtocol);
}

/** Wires the Boat tab. deps adds: bluetooth, pageProtocol, setIntervalFn,
 *  clearIntervalFn, download(filename, text). Returns the tab state. */
export function initBoat(deps) {
  const doc = deps.doc;
  const state = { link: null, samples: [], timer: null,
                  connecting: false, arrivalBudget: null };
  doc.getElementById('boat-url').value = DEFAULT_BOAT_URL;

  const stop = () => {
    if (state.timer !== null) {
      deps.clearIntervalFn(state.timer);
      state.timer = null;
    }
    if (state.link) {
      state.link.disconnect();
      state.link = null;
    }
    state.arrivalBudget = null;  // never stream into a dead link
    doc.getElementById('boat-connect').textContent = 'Connect';
  };

  doc.getElementById('boat-connect').addEventListener('click', async () => {
    if (state.connecting) return; // a connect is already in flight
    if (state.timer !== null || state.link) {
      stop();
      doc.getElementById('boat-status').textContent =
          `Disconnected — ${state.samples.length} samples kept.`;
      return;
    }
    doc.getElementById('boat-status').textContent = 'Connecting…';
    state.connecting = true;
    try {
      state.link = await buildLink(deps);
    } catch (err) {
      doc.getElementById('boat-status').textContent =
          `${err && err.message ? err.message : err}`;
      return;
    } finally {
      state.connecting = false;
    }
    doc.getElementById('boat-connect').textContent = 'Disconnect';
    await pollOnce(deps, state);
    // The user may have hit Disconnect during the first poll.
    if (state.link) {
      state.timer = deps.setIntervalFn(() => pollOnce(deps, state),
                                       POLL_MS);
    }
  });

  doc.getElementById('boat-send').addEventListener('click',
      () => sendRemote(deps, state));

  doc.getElementById('boat-mode-set').addEventListener('click',
      () => sendMode(deps, state));

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
