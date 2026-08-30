import React from 'react';
import { Composition } from 'remotion';

import { DURATION_FRAMES, Demo, FPS } from './Demo.jsx';

export const Root = () => (
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={DURATION_FRAMES}
    fps={FPS}
    width={1280}
    height={720}
  />
);
