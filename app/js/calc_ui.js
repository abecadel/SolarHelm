// Calculator page glue (dependency-injected like ui.js, node-covered).

import { BOAT_CLASSES, estimate } from './calculator_model.js';

export function readCalcInputs(doc) {
  const num = (id, fallback) => {
    const v = parseFloat(doc.getElementById(id).value);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    classKey: doc.getElementById('boat-class').value,
    pvWp: num('pv-wp', 900),
    batteryKwh: num('battery-kwh', 2.56),
    hotelW: num('hotel-w', 60),
  };
}

export function resultsHtml(r) {
  const pln = (v) => `${Math.round(v).toLocaleString('en')} PLN`;
  return `
    <div class="cards">
      <div class="card"><b id="cruise-speed">${r.cruiseNoonKmh.toFixed(1)}</b>
        <span>km/h solar cruise at noon</span></div>
      <div class="card"><b>${r.kmPerDay.toFixed(0)} km</b>
        <span>per clear June day (solar only)</span></div>
      <div class="card"><b>${r.usableSunH} h</b>
        <span>usable sun hours</span></div>
      <div class="card"><b>${r.dayPvKwh.toFixed(1)} kWh</b>
        <span>PV harvest per day</span></div>
      <div class="card"><b>${r.batteryRangeKm.toFixed(0)} km</b>
        <span>battery-only reserve range</span></div>
      <div class="card"><b>${r.panels}</b>
        <span>× 450 W panels</span></div>
    </div>
    <table class="days">
      <tr><th>Cost group</th><th>PLN</th></tr>
      <tr><td>Drive (motor + controller)</td><td>${pln(r.cost.drive)}</td></tr>
      <tr><td>SolarHelm control &amp; safety</td><td>${pln(r.cost.control)}</td></tr>
      <tr><td>Battery</td><td>${pln(r.cost.battery)}</td></tr>
      <tr><td>Solar array + MPPT</td><td>${pln(r.cost.solar)}</td></tr>
      <tr><td>Wiring / DC-DC / enclosure</td><td>${pln(r.cost.installation)}</td></tr>
      <tr><th>Total (approx.)</th><th>${pln(r.totalPln)}</th></tr>
    </table>
    <p class="note">Reference prices from docs/BUYING_GUIDE.md; excludes the
    boat itself. Speeds assume the reference hull curve scaled by boat class —
    replace with your boat's measured curve after sea trials.</p>`;
}

export function initCalc(deps) {
  const doc = deps.doc;
  const select = doc.getElementById('boat-class');
  select.innerHTML = Object.entries(BOAT_CLASSES)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join('');
  select.value = 'launch';
  const render = () => {
    const r = estimate(readCalcInputs(doc));
    doc.getElementById('results').innerHTML = resultsHtml(r);
  };
  for (const id of ['boat-class', 'pv-wp', 'battery-kwh', 'hotel-w']) {
    doc.getElementById(id).addEventListener('input', render);
  }
  render();
  return { render };
}
