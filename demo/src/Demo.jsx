import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import { assessment, chartsSvg, learned, socQ, trip, voyage } from './data.js';

export const FPS = 30;
// Scene boundaries (frames).
const S1 = [0, 75];        // title
const S2 = [75, 265];      // trip form + plan tap
const S3 = [265, 505];     // charts reveal
const S4 = [505, 665];     // summary cards
const S5 = [665, 955];     // voyage A→B + gates
const S6 = [955, 1105];    // learning from a log
const S7 = [1105, 1180];   // outro
export const DURATION_FRAMES = S7[1];

const INK = '#16283a';
const PAPER = '#f4f7f9';
const ACCENT = '#0b3d5c';
const SUN = '#e8a013';
const OK = '#2e7d4f';
const LINE = '#d8e2ea';

const ease = (frame, from, to, outFrom = 1e9, outTo = 1e9 + 1) =>
  interpolate(frame, [from, to, outFrom, outTo], [0, 1, 1, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

const Caption = ({ frame, at, title, lines }) => {
  const a = ease(frame, at, at + 14);
  return (
    <div style={{ opacity: a, transform: `translateY(${(1 - a) * 14}px)` }}>
      <div style={{ fontSize: 34, fontWeight: 700, color: '#fff',
                    marginBottom: 12 }}>{title}</div>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: 21, lineHeight: 1.5,
                              color: 'rgba(255,255,255,.85)' }}>{l}</div>
      ))}
    </div>
  );
};

const Field = ({ label, value, frame, typeAt }) => {
  const n = Math.max(0, Math.min(value.length,
      Math.floor((frame - typeAt) / 2)));
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: '#4a5c6b' }}>{label}</div>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 6,
                    padding: '5px 8px', fontSize: 13, background: '#fff',
                    minHeight: 18 }}>
        {value.slice(0, n)}
        {frame >= typeAt && n < value.length && (
          <span style={{ color: ACCENT }}>|</span>
        )}
      </div>
    </div>
  );
};

const Cursor = ({ x, y, tap }) => (
  <div style={{ position: 'absolute', left: x - 10, top: y - 10,
                width: 20, height: 20, borderRadius: 12,
                background: 'rgba(11,61,92,.55)',
                border: '2px solid #fff',
                transform: `scale(${tap ? 1.5 : 1})`,
                boxShadow: tap ? '0 0 0 10px rgba(232,160,19,.35)' : 'none',
                transition: 'none', zIndex: 40 }} />
);

const Phone = ({ children }) => (
  <div style={{ width: 360, height: 640, background: PAPER, borderRadius: 28,
                border: '10px solid #10222f', overflow: 'hidden',
                position: 'relative', boxShadow: '0 24px 60px rgba(0,0,0,.45)',
                color: INK,
                fontFamily: 'system-ui, sans-serif' }}>
    <div style={{ background: ACCENT, color: '#fff', padding: '10px 14px' }}>
      <div style={{ fontSize: 14, fontWeight: 700,
                    letterSpacing: '.05em' }}>SOLARHELM PLANNER</div>
      <div style={{ fontSize: 9, opacity: 0.85 }}>
        Predict range, energy and SOC for a solar-electric cruise</div>
    </div>
    <div style={{ padding: 12 }}>{children}</div>
  </div>
);

const Stage = ({ children, caption }) => (
  <AbsoluteFill style={{
    background: 'linear-gradient(160deg, #0b3d5c 0%, #14568a 70%, #1d6ba8)',
    fontFamily: 'system-ui, sans-serif',
    flexDirection: 'row', alignItems: 'center', padding: '0 70px' }}>
    <div style={{ width: 620 }}>{caption}</div>
    <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
      {children}
    </div>
  </AbsoluteFill>
);

// --- Scenes --------------------------------------------------------------

const Title = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{
      background: 'linear-gradient(160deg, #0b3d5c, #14568a)',
      justifyContent: 'center', alignItems: 'center',
      fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ transform: `scale(${s})`, textAlign: 'center' }}>
        <div style={{ fontSize: 64, fontWeight: 800, color: '#fff',
                      letterSpacing: '.08em' }}>SOLARHELM</div>
        <div style={{ fontSize: 26, color: SUN, marginTop: 10 }}>
          The companion planner — a 60-second tour</div>
        <div style={{ fontSize: 17, color: 'rgba(255,255,255,.75)',
                      marginTop: 16 }}>
          Every number in this demo is computed by the app's real code.</div>
      </div>
    </AbsoluteFill>
  );
};

const FormScene = () => {
  const frame = useCurrentFrame();
  const tapAt = 150;
  const cx = interpolate(frame, [110, tapAt], [720, 585],
                         { extrapolateLeft: 'clamp',
                           extrapolateRight: 'clamp' });
  const cy = interpolate(frame, [110, tapAt], [200, 470],
                         { extrapolateLeft: 'clamp',
                           extrapolateRight: 'clamp' });
  return (
    <Stage caption={
      <Caption frame={frame} at={6} title="1 · Describe the trip"
        lines={[
          'Where you are (or one tap on “Use my GPS”),',
          'how far you want to go, and for how many days.',
          '',
          'Cruise strategy: float with the sun (SOLAR)',
          'or hold a fixed speed.',
        ]} />}>
      <div style={{ position: 'relative' }}>
        <Phone>
          <Field label="Latitude" value="43.5081" frame={frame} typeAt={15} />
          <Field label="Longitude" value="16.4402" frame={frame} typeAt={32} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Field label="Distance [km]" value="40" frame={frame}
                     typeAt={52} />
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Days (1–3)" value="2" frame={frame} typeAt={60} />
            </div>
          </div>
          <Field label="Cruise strategy" value="Float with solar (SOLAR)"
                 frame={frame} typeAt={68} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Field label="Start SOC [%]" value="90" frame={frame}
                     typeAt={92} />
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Reserve SOC [%]" value="25" frame={frame}
                     typeAt={98} />
            </div>
          </div>
          <div style={{ background: SUN, color: '#3a2800', borderRadius: 8,
                        textAlign: 'center', padding: '10px 0',
                        fontWeight: 700, fontSize: 14, marginTop: 14,
                        transform: `scale(${frame >= tapAt && frame < tapAt + 8
                          ? 0.94 : 1})` }}>
            Plan trip
          </div>
          {frame > tapAt + 10 && (
            <div style={{ fontSize: 11, color: '#4a5c6b', marginTop: 10 }}>
              Fetching forecast…
            </div>
          )}
        </Phone>
        {frame >= 110 && (
          <Cursor x={cx - 460} y={cy - 130}
                  tap={frame >= tapAt && frame < tapAt + 10} />
        )}
      </div>
    </Stage>
  );
};

const svgWrap = (html) =>
  `<style>
     .chart{width:100%;height:auto;background:#fff;border:1px solid ${LINE};
            border-radius:8px;margin:2px 0 8px}
     .chart .grid{stroke:${LINE};stroke-width:1}
     .chart .ylabel{font-size:9px;fill:#62778a;text-anchor:end}
     .chart .xlabel{font-size:9px;fill:#62778a;text-anchor:middle}
     .legend{display:flex;gap:10px;font-size:10px;color:#4a5c6b;margin:4px 0}
     .legend .swatch{display:inline-block;width:9px;height:9px;
                     border-radius:2px;margin-right:3px}
   </style>` + html;

const ChartsScene = () => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [20, 150], [0, 100],
                             { extrapolateLeft: 'clamp',
                               extrapolateRight: 'clamp' });
  return (
    <Stage caption={
      <Caption frame={frame} at={6} title="2 · The plan, hour by hour"
        lines={[
          'The engine simulates the whole trip against the',
          'solar forecast: PV production, propulsion,',
          'hotel load, battery SOC — with the same reserve',
          'philosophy as the firmware on the boat.',
          '',
          'Speed floats with the sun. The battery stays a buffer.',
        ]} />}>
      <Phone>
        <div style={{ fontSize: 11, color: '#4a5c6b', marginBottom: 6 }}>
          Forecast loaded — 48 h horizon
        </div>
        <div style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}
             dangerouslySetInnerHTML={{ __html: svgWrap(chartsSvg.power) }} />
        <div style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}
             dangerouslySetInnerHTML={{ __html: svgWrap(chartsSvg.soc) }} />
      </Phone>
    </Stage>
  );
};

const Card = ({ big, small, frame, at }) => {
  const a = ease(frame, at, at + 12);
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`,
                  borderRadius: 8, padding: '8px 6px', textAlign: 'center',
                  opacity: a, transform: `translateY(${(1 - a) * 10}px)` }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{big}</div>
      <div style={{ fontSize: 8.5, color: '#62778a' }}>{small}</div>
    </div>
  );
};

const SummaryScene = () => {
  const frame = useCurrentFrame();
  const s = trip.summary;
  const arrive = s.arrivalTime
      ? s.arrivalTime.toISOString().slice(5, 16).replace('T', ' ') + 'Z'
      : '—';
  return (
    <Stage caption={
      <Caption frame={frame} at={6} title="3 · A verdict, not a guess"
        lines={[
          'Does the trip fit? When do you arrive, and with',
          'how much battery? How much of the energy came',
          'from the sun?',
          '',
          'Day-level energy accounting — the number that',
          'actually governs a solar cruise.',
        ]} />}>
      <Phone>
        <div style={{ background: '#e2f2e8', color: OK, borderRadius: 8,
                      padding: '9px 10px', fontWeight: 700, fontSize: 12.5,
                      marginBottom: 10,
                      opacity: ease(frame, 8, 20) }}>
          Trip fits: {s.plannedDistanceKm.toFixed(0)} km reached
          by {arrive}
        </div>
        <div style={{ display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
          <Card frame={frame} at={26} big={`${s.finalSocPct.toFixed(0)}%`}
                small="SOC at end" />
          <Card frame={frame} at={34} big={`${s.minSocPct.toFixed(0)}%`}
                small="lowest SOC" />
          <Card frame={frame} at={42}
                big={`${s.pvKwh.toFixed(1)} kWh`} small="solar harvested" />
          <Card frame={frame} at={50}
                big={`${s.motorKwh.toFixed(1)} kWh`} small="propulsion" />
          <Card frame={frame} at={58}
                big={`${s.hotelKwh.toFixed(1)} kWh`} small="hotel" />
          <Card frame={frame} at={66}
                big={`${s.perDay[0].distanceKm.toFixed(0)} km`}
                small="day 1 distance" />
        </div>
      </Phone>
    </Stage>
  );
};

const Gate = ({ g, frame, at }) => {
  const a = ease(frame, at, at + 10);
  return (
    <div style={{ background: g.pass ? '#e2f2e8' : '#fbe9dd',
                  color: g.pass ? OK : '#b3541e', borderRadius: 6,
                  padding: '4px 8px', fontSize: 9.5, marginBottom: 4,
                  opacity: a, transform: `translateX(${(1 - a) * 16}px)` }}>
      {g.pass ? 'PASS' : 'FAIL'} · {g.id}
    </div>
  );
};

const VoyageScene = () => {
  const frame = useCurrentFrame();
  const s = voyage.summary;
  return (
    <Stage caption={
      <Caption frame={frame} at={6} title="4 · Voyage A→B"
        lines={[
          'Waypoints in, verdict out. The route planner runs',
          'a dynamic program over every departure time and',
          'power setting — waves, wind and currents included.',
          '',
          'Six explicit safety gates explain the verdict.',
          'No black boxes: every gate names its reason.',
        ]} />}>
      <Phone>
        <Field label="Waypoints (lat, lon[, anchor])"
               value="43.5081, 16.4402, anchor" frame={frame} typeAt={12} />
        <Field label="" value="43.39, 16.29" frame={frame} typeAt={48} />
        <div style={{ background: ACCENT, color: '#fff', borderRadius: 8,
                      textAlign: 'center', padding: '8px 0', fontWeight: 700,
                      fontSize: 13, margin: '6px 0 10px',
                      transform: `scale(${frame >= 78 && frame < 86
                        ? 0.94 : 1})` }}>
          Plan voyage
        </div>
        {frame > 92 && (
          <div style={{ background: '#e2f2e8', color: OK, borderRadius: 8,
                        padding: '7px 10px', fontWeight: 800, fontSize: 15,
                        marginBottom: 8,
                        opacity: ease(frame, 92, 104) }}>
            {assessment.label}
          </div>
        )}
        <div>
          {assessment.gates.map((g, i) => (
            <Gate key={g.id} g={g} frame={frame} at={110 + i * 14} />
          ))}
        </div>
        {frame > 205 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                        gap: 7, marginTop: 8 }}>
            <Card frame={frame} at={205}
                  big={`${s.arrivalSocPct.toFixed(0)}%`}
                  small="arrival SOC (expected)" />
            <Card frame={frame} at={213}
                  big={`${socQ.conservativePct.toFixed(0)}–${
                    socQ.optimisticPct.toFixed(0)}%`}
                  small="arrival SOC (p90–p10)" />
            <Card frame={frame} at={221}
                  big={`${s.distanceKm.toFixed(1)} km`}
                  small="route distance" />
          </div>
        )}
      </Phone>
    </Stage>
  );
};

const LearnScene = () => {
  const frame = useCurrentFrame();
  const r = learned.report;
  return (
    <Stage caption={
      <Caption frame={frame} at={6} title="5 · Every voyage teaches it"
        lines={[
          'Import a telemetry log from the boat: steady',
          'cruise blocks refit the hull curve, calibrate the',
          'uncertainty bands, and watch for drift —',
          'a fouled hull shows up in the numbers.',
        ]} />}>
      <Phone>
        <div style={{ fontSize: 10, color: '#4a5c6b' }}>
          Learn from a voyage log (telemetry CSV)</div>
        <div style={{ border: `1px dashed ${ACCENT}`, borderRadius: 8,
                      padding: '10px 10px', fontSize: 12, margin: '6px 0',
                      background: '#fff',
                      opacity: ease(frame, 10, 22) }}>
          voyage-2026-06-21.csv
        </div>
        {frame > 40 && (
          <div style={{ fontSize: 11.5, lineHeight: 1.6, color: INK,
                        background: '#e2f2e8', borderRadius: 8,
                        padding: '10px 12px',
                        opacity: ease(frame, 40, 54) }}>
            Learned from {r.blocks} steady blocks (voyage #1).<br />
            Curve P = {r.curve.b1.toFixed(1)}·v +
            {' '}{r.curve.b3.toFixed(2)}·v³<br />
            error p10..p90: {(r.quantiles.p10 * 100).toFixed(0)}..
            {(r.quantiles.p90 * 100).toFixed(0)}%<br />
            drift: none detected
          </div>
        )}
        {frame > 80 && (
          <div style={{ fontSize: 10.5, color: '#4a5c6b', marginTop: 10,
                        opacity: ease(frame, 80, 92) }}>
            The next plan uses the learned model automatically.
          </div>
        )}
      </Phone>
    </Stage>
  );
};

const Outro = () => {
  const frame = useCurrentFrame();
  const a = ease(frame, 5, 20);
  return (
    <AbsoluteFill style={{
      background: 'linear-gradient(160deg, #0b3d5c, #14568a)',
      justifyContent: 'center', alignItems: 'center', textAlign: 'center',
      fontFamily: 'system-ui, sans-serif', opacity: a }}>
      <div>
        <div style={{ fontSize: 44, fontWeight: 800, color: '#fff',
                      letterSpacing: '.06em' }}>SOLARHELM</div>
        <div style={{ fontSize: 22, color: SUN, margin: '12px 0' }}>
          abecadel.github.io/SolarHelm — try the planner yourself</div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,.7)' }}>
          Advisory only — it never controls the boat. Open source (MIT).
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Demo = () => (
  <AbsoluteFill style={{ background: '#0b3d5c' }}>
    <Sequence from={S1[0]} durationInFrames={S1[1] - S1[0]}>
      <Title />
    </Sequence>
    <Sequence from={S2[0]} durationInFrames={S2[1] - S2[0]}>
      <FormScene />
    </Sequence>
    <Sequence from={S3[0]} durationInFrames={S3[1] - S3[0]}>
      <ChartsScene />
    </Sequence>
    <Sequence from={S4[0]} durationInFrames={S4[1] - S4[0]}>
      <SummaryScene />
    </Sequence>
    <Sequence from={S5[0]} durationInFrames={S5[1] - S5[0]}>
      <VoyageScene />
    </Sequence>
    <Sequence from={S6[0]} durationInFrames={S6[1] - S6[0]}>
      <LearnScene />
    </Sequence>
    <Sequence from={S7[0]} durationInFrames={S7[1] - S7[0]}>
      <Outro />
    </Sequence>
  </AbsoluteFill>
);
