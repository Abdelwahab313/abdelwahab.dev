import React from "react";
import {Composition} from "remotion";
import {ConnectionsRemember} from "./ConnectionsRemember";
import {SequentialVsParallel} from "./SequentialVsParallel";
import {defaultProps} from "./theme";

export const FPS = 30;
export const WIDTH = 1200;
export const HEIGHT = 600;

export const Root: React.FC = () => (
  <>
    <Composition
      id="pgbouncer-connections-remember"
      component={ConnectionsRemember}
      durationInFrames={FPS * 16}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultProps}
    />
    <Composition
      id="pgbouncer-sequential-vs-parallel"
      component={SequentialVsParallel}
      durationInFrames={FPS * 12}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultProps}
    />
  </>
);
