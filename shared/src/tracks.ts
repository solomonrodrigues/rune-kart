import type { TrackDef } from './track.ts';

// A ~600 m loop: long straight, sweeping right-handers, a raised hairpin section and a crest to catch air.
export const GREYBOX: TrackDef = {
  name: 'Greybox Loop',
  width: 18,
  wallHeight: 1.5,
  samples: 240,
  points: [
    [0, 0, 0], [70, 0, 0], [115, 15, 0], [130, 60, 0], [110, 100, 2.5],
    [70, 115, 5], [30, 100, 5], [10, 70, 2.5], [-20, 60, 0], [-60, 85, 0],
    [-100, 70, 1.5], [-110, 30, 3.5], [-90, -10, 0], [-45, -15, 0],
  ],
};
