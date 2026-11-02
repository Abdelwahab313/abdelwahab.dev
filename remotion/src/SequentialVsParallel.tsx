import React from "react";
import {AbsoluteFill, interpolate, useCurrentFrame} from "remotion";
import {Frame, Mono, useTheme, type ThemeProps} from "./theme";

// Measured on Node 22 against Postgres 17 in Docker. Each query is a
// pg_sleep stand-in wrapped in BEGIN / set_config / COMMIT; the extra round
// trips are what the muted part of every bar stands for.
const OVERHEAD_MS = 11;
const QUERIES = [
  {name: "plan", ms: 5},
  {name: "recent items", ms: 5},
  {name: "totals", ms: 40},
  {name: "label counts", ms: 15}
];
const SEQUENTIAL_MEASURED = "about 110 ms";
const PARALLEL_MEASURED = "about 60 ms";

const AXIS_X = 300;
const AXIS_W = 820;
const MS_SPAN = 120;
const PX_PER_MS = AXIS_W / MS_SPAN;
const BAR_H = 26;

// Playhead: 0 ms at frame 20, MS_SPAN ms at frame 260.
const msAt = (frame: number) =>
  interpolate(frame, [20, 260], [0, MS_SPAN], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

type Bar = {name: string; start: number; ms: number};

const schedule = (parallel: boolean): Bar[] => {
  const gate = {name: QUERIES[0].name, start: 0, ms: QUERIES[0].ms};
  const after = gate.start + OVERHEAD_MS + gate.ms;
  const rest: Bar[] = [];
  let cursor = after;
  for (const q of QUERIES.slice(1)) {
    rest.push({name: q.name, start: parallel ? after : cursor, ms: q.ms});
    cursor += OVERHEAD_MS + q.ms;
  }
  return [gate, ...rest];
};

const Lane: React.FC<{
  title: string;
  code: string;
  y: number;
  bars: Bar[];
  measured: string;
  now: number;
}> = ({title, code, y, bars, measured, now}) => {
  const t = useTheme();
  const end = Math.max(...bars.map(b => b.start + OVERHEAD_MS + b.ms));
  const done = now >= end;
  return (
    <>
      <Mono x={60} y={y - 62} size={21} color={t.ink}>
        {title}
      </Mono>
      <Mono x={60} y={y - 34} size={16} color={t.muted}>
        {code}
      </Mono>
      {bars.map((b, i) => {
        const rowY = y + i * (BAR_H + 10);
        const visibleEnd = Math.min(now, b.start + OVERHEAD_MS + b.ms);
        const overheadEnd = Math.min(visibleEnd, b.start + OVERHEAD_MS);
        const overheadW = Math.max(0, (overheadEnd - b.start) * PX_PER_MS);
        const queryW = Math.max(0, (visibleEnd - b.start - OVERHEAD_MS) * PX_PER_MS);
        if (now < b.start) return null;
        return (
          <React.Fragment key={b.name}>
            <Mono
              x={AXIS_X - 12}
              y={rowY + 3}
              size={15}
              color={t.muted}
              align="right"
            >
              {b.name}
            </Mono>
            <div
              style={{
                position: "absolute",
                left: AXIS_X + b.start * PX_PER_MS,
                top: rowY,
                width: overheadW,
                height: BAR_H,
                background: t.border
              }}
            />
            <div
              style={{
                position: "absolute",
                left: AXIS_X + (b.start + OVERHEAD_MS) * PX_PER_MS,
                top: rowY,
                width: queryW,
                height: BAR_H,
                background: t.accent
              }}
            />
          </React.Fragment>
        );
      })}
      <div
        style={{
          position: "absolute",
          right: 1200 - (AXIS_X + AXIS_W),
          top: y - 62,
          opacity: done ? 1 : 0
        }}
      >
        <Mono size={21} color={t.ink}>
          {measured}
        </Mono>
      </div>
    </>
  );
};

export const SequentialVsParallel: React.FC<ThemeProps> = props => (
  <Frame {...props}>
    <Body />
  </Frame>
);

const Body: React.FC = () => {
  const frame = useCurrentFrame();
  const t = useTheme();
  const now = msAt(frame);
  const seqY = 140;
  const parY = 370;

  return (
    <AbsoluteFill>
      <Mono x={60} y={22} size={22} color={t.muted}>
        four tenant-scoped queries on one request, local Postgres
      </Mono>

      {/* axis */}
      <div
        style={{
          position: "absolute",
          left: AXIS_X,
          top: 535,
          width: AXIS_W,
          height: 1.5,
          background: t.border
        }}
      />
      {[0, 40, 80, 120].map(ms => (
        <Mono
          key={ms}
          x={AXIS_X + ms * PX_PER_MS}
          y={546}
          size={14}
          color={t.muted}
          align="center"
        >
          {ms} ms
        </Mono>
      ))}

      {/* playhead */}
      <div
        style={{
          position: "absolute",
          left: AXIS_X + now * PX_PER_MS,
          top: seqY - 10,
          width: 1.5,
          height: 535 - seqY + 10,
          background: t.muted,
          opacity: 0.6
        }}
      />

      <Lane
        title="one after another"
        code="await a(); await b(); await c(); await d();"
        y={seqY}
        bars={schedule(false)}
        measured={SEQUENTIAL_MEASURED}
        now={now}
      />
      <Lane
        title="gate first, then Promise.all"
        code="await a(); await Promise.all([b(), c(), d()]);"
        y={parY}
        bars={schedule(true)}
        measured={PARALLEL_MEASURED}
        now={now}
      />

      {/* legend */}
      <div style={{position: "absolute", left: 60, top: 560, display: "flex", gap: 24}}>
        <Swatch color={t.border} label="BEGIN, set_config, COMMIT round trips" />
        <Swatch color={t.accent} label="the query" />
      </div>
    </AbsoluteFill>
  );
};

const Swatch: React.FC<{color: string; label: string}> = ({color, label}) => {
  const t = useTheme();
  return (
    <div style={{display: "flex", alignItems: "center", gap: 8}}>
      <div style={{width: 18, height: 12, background: color}} />
      <Mono size={14} color={t.muted}>
        {label}
      </Mono>
    </div>
  );
};
