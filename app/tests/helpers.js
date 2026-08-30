// Test helpers: a minimal DOM stub covering exactly the surface ui.js uses,
// so the whole UI module runs (and is covered) under plain node.

export function makeElement(id) {
  return {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    files: null,
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
}

export function makeDoc(values = {}) {
  const els = new Map();
  const doc = {
    getElementById(id) {
      if (!els.has(id)) {
        const el = makeElement(id);
        if (id in values) el.value = String(values[id]);
        els.set(id, el);
      }
      return els.get(id);
    },
    _els: els,
  };
  return doc;
}

export const FORM_DEFAULTS = {
  lat: '43.5081', lon: '16.4402', distance: '40', days: '2',
  mode: 'solar', speed: '5', soc: '90', reserve: '25',
  'cruise-start': '6', 'cruise-end': '18',
};

export function fire(doc, id, type, event = {}) {
  return doc.getElementById(id).listeners[type](event);
}

export function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

/** A recording fake of the Leaflet surface map_ui.js uses. */
export function makeLeaflet() {
  const calls = { markers: [], lines: [], removed: [], views: [],
                  tiles: [] };
  const L = {
    _calls: calls,
    map(el, opts) {
      calls.mapEl = el;
      calls.mapOpts = opts;
      calls.map = {
        handlers: {},
        on(ev, fn) { calls.map.handlers[ev] = fn; },
        removeLayer(layer) { calls.removed.push(layer); },
        setView(center, zoom) { calls.views.push([center, zoom]); },
      };
      return calls.map;
    },
    tileLayer(url, opts) {
      calls.tiles.push({ url, opts });
      return { addTo() { return this; } };
    },
    circleMarker(latlng, style) {
      const mk = { latlng, style, handlers: {},
                   on(ev, fn) { mk.handlers[ev] = fn; },
                   addTo() { return mk; } };
      calls.markers.push(mk);
      return mk;
    },
    polyline(points, style) {
      const pl = { points, style, addTo() { return pl; } };
      calls.lines.push(pl);
      return pl;
    },
  };
  return L;
}

/** fetch stub returning a fixed JSON payload (or failing). */
export function makeFetch(payload, { ok = true, status = 200, reject = false } = {}) {
  return async () => {
    if (reject) throw new Error('network down');
    return {
      ok,
      status,
      json: async () => payload,
    };
  };
}

/** A plausible Open-Meteo hourly payload for `days` days. */
export function openMeteoPayload(days = 1) {
  const time = [];
  const rad = [];
  const cloud = [];
  const wind = [];
  const temp = [];
  for (let h = 0; h < days * 24; h++) {
    const d = new Date(Date.UTC(2026, 5, 21, 0, 0)); // June 21
    d.setUTCHours(h);
    time.push(d.toISOString().slice(0, 16));
    const hh = h % 24;
    rad.push(hh >= 5 && hh <= 19 ? Math.sin(((hh - 5) / 14) * Math.PI) * 800 : 0);
    cloud.push(20);
    wind.push(3);
    temp.push(24);
  }
  return {
    hourly: {
      time,
      shortwave_radiation: rad,
      cloud_cover: cloud,
      wind_speed_10m: wind,
      temperature_2m: temp,
    },
  };
}

/** Open-Meteo weather payload including the planner-v2 wind fields. */
export function windPayload(days = 1) {
  const p = openMeteoPayload(days);
  const n = p.hourly.time.length;
  p.hourly.wind_direction_10m = new Array(n).fill(270);
  p.hourly.wind_gusts_10m = new Array(n).fill(6);
  return p;
}

/** A SolarHelm telemetry CSV with steady 90 s cruise blocks at the given
 *  [speedKmh, powerW] settings (1 Hz rows; matches sh::telemetryCsvHeader
 *  column names the learner needs). */
export function telemetryCsv(settings) {
  const lines = ['timestamp_ms,speed_kmh,motor_estimated_power_w'];
  let t = 0;
  for (const [v, p] of settings) {
    for (let s = 0; s < 90; s++) {
      lines.push(`${t * 1000},${v},${p}`);
      t += 1;
    }
  }
  return lines.join('\n');
}

/** A plausible Open-Meteo Marine hourly payload for `days` days. */
export function marinePayload(days = 1, { currentKmh = 1.8 } = {}) {
  const time = [];
  for (let h = 0; h < days * 24; h++) {
    const d = new Date(Date.UTC(2026, 5, 21, 0, 0));
    d.setUTCHours(h);
    time.push(d.toISOString().slice(0, 16));
  }
  const n = time.length;
  return {
    hourly: {
      time,
      wave_height: new Array(n).fill(0.4),
      wave_direction: new Array(n).fill(315),
      wave_period: new Array(n).fill(4),
      wind_wave_height: new Array(n).fill(0.3),
      ocean_current_velocity: new Array(n).fill(currentKmh),
      ocean_current_direction: new Array(n).fill(90),
    },
  };
}
