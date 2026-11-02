import React from "react";
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame} from "remotion";
import {Frame, Box, Link, Mono, useTheme, type ThemeProps} from "./theme";

// Geometry shared by both acts.
const CLIENT_X = 70;
const CLIENT_W = 300;
const BOUNCER_X = 470;
const BOUNCER_W = 260;
const BACKEND_X = 830;
const BACKEND_W = 300;
const A_Y = 125;
const B_Y = 300;
const BACKEND_Y = 125;
const BOX_H = 110;

const fade = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

type ActProps = {
  scope: "session" | "transaction";
};

const Act: React.FC<ActProps> = ({scope}) => {
  const frame = useCurrentFrame();
  const t = useTheme();
  const local = scope === "transaction";

  // Timeline (frames at 30 fps)
  const aLinks = 20; // A gets a backend
  const aSets = 45; // set_config runs, backend takes the label
  const aEnds = local ? 125 : 100; // A's transaction ends, backend handed back
  const bLinks = aEnds + 35; // B gets the same backend
  const bReads = bLinks + 30; // B's count(*) comes back
  const verdict = bReads + 40;

  const aLinked = frame >= aLinks && frame < aEnds;
  const bLinked = frame >= bLinks && frame < bReads + 60;
  const labelOn = frame >= aSets && (!local || frame < aEnds);

  const statement = local
    ? "BEGIN;\nset_config('app.tenant_id', 'acme', true);\nselect count(*) from items;\nCOMMIT;"
    : "set_config('app.tenant_id', 'acme', false);\nselect count(*) from items;";

  const bResult = local ? "0 rows" : "5000 rows";
  const verdictText = local
    ? "transaction scope: B saw acme in 0 of 20 rounds"
    : "session scope: B saw acme in 20 of 20 rounds";

  return (
    <AbsoluteFill>
      <Mono x={CLIENT_X} y={56} size={22} color={t.muted}>
        {local
          ? "second run: set_config(..., true), inside a transaction"
          : "first run: set_config(..., false), session scope"}
      </Mono>

      {/* Clients */}
      <Box x={CLIENT_X} y={A_Y} w={CLIENT_W} h={BOX_H} stroke={t.ink}>
        <Mono size={22} color={t.ink}>
          request A
        </Mono>
        <Mono size={18} color={t.muted}>
          tenant acme
        </Mono>
      </Box>
      <Box x={CLIENT_X} y={B_Y} w={CLIENT_W} h={BOX_H} stroke={t.ink}>
        <Mono size={22} color={t.ink}>
          request B
        </Mono>
        <Mono size={18} color={t.muted}>
          never sets a tenant
        </Mono>
      </Box>

      {/* PgBouncer */}
      <Box
        x={BOUNCER_X}
        y={A_Y}
        w={BOUNCER_W}
        h={B_Y + BOX_H - A_Y}
        stroke={t.ink}
        dashed
      >
        <Mono size={22} color={t.ink}>
          PgBouncer
        </Mono>
        <Mono size={18} color={t.muted}>
          pool_mode = transaction
        </Mono>
        <Mono size={18} color={t.muted}>
          default_pool_size = 2
        </Mono>
      </Box>

      {/* Backend */}
      <Box
        x={BACKEND_X}
        y={BACKEND_Y}
        w={BACKEND_W}
        h={BOX_H}
        stroke={labelOn ? t.accent : t.ink}
        fill={labelOn ? t.accentSoft : undefined}
      >
        <Mono size={22} color={t.ink}>
          backend 1
        </Mono>
        <Mono size={18} color={labelOn ? t.accent : t.muted}>
          {labelOn ? "app.tenant_id = acme" : "app.tenant_id unset"}
        </Mono>
      </Box>
      <Box
        x={BACKEND_X}
        y={B_Y}
        w={BACKEND_W}
        h={BOX_H}
        stroke={t.border}
      >
        <Mono size={22} color={t.muted}>
          backend 2
        </Mono>
        <Mono size={18} color={t.muted}>
          idle
        </Mono>
      </Box>

      {/* Links: client -> bouncer -> backend 1 */}
      <Link
        x1={CLIENT_X + CLIENT_W}
        y1={A_Y + BOX_H / 2}
        x2={BOUNCER_X}
        y2={A_Y + BOX_H / 2}
        color={t.accent}
        opacity={aLinked ? 1 : 0}
      />
      <Link
        x1={CLIENT_X + CLIENT_W}
        y1={B_Y + BOX_H / 2}
        x2={BOUNCER_X}
        y2={B_Y + BOX_H / 2}
        color={t.accent}
        opacity={bLinked ? 1 : 0}
      />
      <Link
        x1={BOUNCER_X + BOUNCER_W}
        y1={aLinked ? A_Y + BOX_H / 2 : B_Y + BOX_H / 2}
        x2={BACKEND_X}
        y2={BACKEND_Y + BOX_H / 2}
        color={t.accent}
        opacity={aLinked || bLinked ? 1 : 0}
      />

      {/* A's statement */}
      <div
        style={{
          position: "absolute",
          left: CLIENT_X,
          top: 440,
          opacity: fade(frame, aLinks, aLinks + 10) * (frame < bLinks ? 1 : 0.35)
        }}
      >
        <Mono size={15} color={t.body} pre>
          {statement}
        </Mono>
      </div>

      {/* Handback note */}
      <div
        style={{
          position: "absolute",
          left: BOUNCER_X,
          top: 440,
          opacity: fade(frame, aEnds, aEnds + 10)
        }}
      >
        <Mono size={17} color={t.muted}>
          A's transaction ended.
        </Mono>
        <Mono size={17} color={local ? t.muted : t.accent}>
          {local ? "The setting ended with it." : "The setting stayed on backend 1."}
        </Mono>
      </div>

      {/* B's read */}
      <div
        style={{
          position: "absolute",
          left: BACKEND_X,
          top: 440,
          opacity: fade(frame, bReads, bReads + 10)
        }}
      >
        <Mono size={17} color={t.body}>
          B: select count(*) from items
        </Mono>
        <Mono size={26} color={local ? t.ink : t.accent}>
          {bResult}
        </Mono>
      </div>

      {/* Verdict */}
      <div
        style={{
          position: "absolute",
          left: CLIENT_X,
          top: 556,
          opacity: fade(frame, verdict, verdict + 12)
        }}
      >
        <Mono size={19} color={t.ink}>
          {verdictText}
        </Mono>
      </div>
    </AbsoluteFill>
  );
};

export const ConnectionsRemember: React.FC<ThemeProps> = props => (
  <Frame {...props}>
    <Sequence from={0} durationInFrames={240} premountFor={0}>
      <Act scope="session" />
    </Sequence>
    <Sequence from={240} durationInFrames={240}>
      <Act scope="transaction" />
    </Sequence>
  </Frame>
);
