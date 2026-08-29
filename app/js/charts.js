// Tiny SVG chart builders. Pure string-generating functions so charts are
// unit-testable in node without a DOM; the UI just injects the markup.

function scale(v, dMin, dMax, rMin, rMax) {
  if (dMax === dMin) return (rMin + rMax) / 2;
  return rMin + ((v - dMin) / (dMax - dMin)) * (rMax - rMin);
}

export function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Multi-series line chart.
 *  series: [{ label, color, points: [[x, y], ...] }] with shared x domain.
 *  opts: { width, height, yLabel, xTicks: [[x, label]], yMin, yMax } */
export function lineChart(series, opts = {}) {
  const w = opts.width ?? 640;
  const h = opts.height ?? 220;
  const padL = 44;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = opts.yMin ?? Math.min(0, ...ys);
  const yMax = opts.yMax ?? Math.max(...ys) * 1.05 + 1e-9;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${w} ${h}" class="chart" role="img"` +
             ` preserveAspectRatio="none">`);
  // Horizontal gridlines + y labels.
  for (let g = 0; g <= 4; g++) {
    const yv = yMin + ((yMax - yMin) * g) / 4;
    const y = scale(yv, yMin, yMax, h - padB, padT);
    parts.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}"` +
               ` y2="${y.toFixed(1)}" class="grid"/>`);
    parts.push(`<text x="${padL - 4}" y="${(y + 3).toFixed(1)}"` +
               ` class="ylabel">${esc(Math.round(yv))}</text>`);
  }
  // X ticks.
  for (const [xv, label] of opts.xTicks ?? []) {
    const x = scale(xv, xMin, xMax, padL, w - padR);
    parts.push(`<text x="${x.toFixed(1)}" y="${h - 6}" class="xlabel">` +
               `${esc(label)}</text>`);
  }
  // Series.
  for (const s of series) {
    const pts = s.points
        .map((p) => `${scale(p[0], xMin, xMax, padL, w - padR).toFixed(1)},` +
                    `${scale(p[1], yMin, yMax, h - padB, padT).toFixed(1)}`)
        .join(' ');
    parts.push(`<polyline points="${pts}" fill="none"` +
               ` stroke="${esc(s.color)}" stroke-width="1.8"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/** Legend markup matching a lineChart's series. */
export function legend(series) {
  const items = series
      .map((s) => `<span class="legend-item"><span class="swatch"` +
                  ` style="background:${esc(s.color)}"></span>` +
                  `${esc(s.label)}</span>`)
      .join('');
  return `<div class="legend">${items}</div>`;
}

/** Hour ticks (every 6 h) for a forecast-hours x axis. */
export function hourTicks(forecastHours) {
  const ticks = [];
  for (let i = 0; i < forecastHours.length; i++) {
    const t = forecastHours[i].time;
    if (t.getUTCHours() % 6 === 0) {
      ticks.push([i, `${String(t.getUTCHours()).padStart(2, '0')}:00`]);
    }
  }
  return ticks;
}
