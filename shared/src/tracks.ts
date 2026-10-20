import type { TrackDef } from './track.ts';

// A ~600 m loop: long straight, sweeping right-handers, a raised hairpin section and a crest to catch air.
export const GREYBOX: TrackDef = {
  name: 'Moonlit Loop',
  blurb: 'A long straight, sweeping bends and a raised hairpin under the castle.',
  width: 26,
  wallHeight: 1.5,
  samples: 240,
  points: [
    [0, 0, 0], [70, 0, 0], [115, 15, 0], [130, 60, 0], [110, 100, 2.5],
    [70, 115, 5], [30, 100, 5], [10, 70, 2.5], [-20, 60, 0], [-60, 85, 0],
    [-100, 70, 1.5], [-110, 30, 3.5], [-90, -10, 0], [-45, -15, 0],
  ],
};

// The grand course: a figure-of-eight over a high stone viaduct. It climbs out of the start into a
// hairpin, crosses back over its own road on the bridge, drops into a second hairpin, then winds through
// a hilly chicane in the west before the run home.
export const HOLLOW: TrackDef = {
  name: 'Hollow Crown',
  blurb: 'The grand course: a figure-of-eight over a high viaduct, two hairpins and a hilly chicane.',
  width: 26,
  wallHeight: 1.5,
  samples: 470,
  bridgeAbove: 8,
  points: [
    [0, 0, 0], [70, -5, 0], [120, 20, 0], [150, 70, 0], [185, 115, 1],
    [225, 140, 3], [255, 190, 6], [225, 240, 9], [165, 235, 11], [115, 190, 13],
    [150, 70, 14], [190, 10, 12], [225, -40, 8], [195, -95, 4], [130, -100, 2],
    [70, -75, 0], [10, -70, 0], [-55, -75, 0], [-95, -70, 1], [-112, -38, 3], [-106, 2, 5],
    [-138, 45, 6], [-105, 88, 4], [-50, 60, 2], [-45, 15, 0],
  ],
};

// A twisting pass: tight S-bends climbing over a ridge and back down. Rewards short, sharp drifts.
export const SERPENT: TrackDef = {
  name: "Serpent's Pass",
  blurb: 'The longest run: tight S-bends over a ridge. Short, sharp drifts.',
  width: 26,
  wallHeight: 1.5,
  samples: 380, // longest track: more samples keep the spacing like the others
  points: [
    [0, 0, 0], [70, 0, 0], [120, 30, 0], [125, 85, 2], [85, 120, 4.5],
    [80, 170, 6], [130, 205, 4.5], [195, 190, 2], [225, 135, 0], [225, 65, 0],
    [200, 5, 1.5], [145, -40, 0], [75, -58, 0], [5, -66, 0], [-55, -58, 0], [-82, -44, 0], [-88, -14, 0], [-55, 2, 0],
  ],
};

/** Every track, by id. The id goes over the network and in URLs; the name is for people. */
export const TRACKS: Record<string, TrackDef> = { loop: GREYBOX, hollow: HOLLOW, serpent: SERPENT };
export const DEFAULT_TRACK = 'loop';
export const trackDef = (id: unknown) => TRACKS[String(id)] ?? TRACKS[DEFAULT_TRACK];
