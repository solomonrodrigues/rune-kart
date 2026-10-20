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

/**
 * Control points round a climbing spiral, turning clockwise (seen from above) about (cx, cz): `from`° to `to`°
 * measured clockwise from north (+z), rising evenly from y0 to y1, one point every 45°.
 */
function spiral(cx: number, cz: number, r: number, from: number, to: number, y0: number, y1: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let a = from; a <= to; a += 45) {
    const t = (a - from) / (to - from), rad = (a * Math.PI) / 180;
    pts.push([cx + Math.sin(rad) * r, cz + Math.cos(rad) * r, y0 + (y1 - y0) * t]);
  }
  return pts;
}

/** The rock the Dreadmoor Citadel's spiral climbs round (the client builds the spire here). */
export const DREAD_SPIRE = { x: 200, z: -190, r: 45 };

// The most ambitious course: out of the start into an S, then a 540° spiral up the Dread Spire, passing over
// its own first loop (and the road in). From the top, the Sky Bridge runs back north right over the start
// straight and down into the citadel — through the gatehouse, the courtyard and the roofed great hall — then a
// hairpin, a kicker that launches you over a gap (fall short and the crows carry you across), and S-bends home.
export const CITADEL: TrackDef = {
  name: 'Dreadmoor Citadel',
  blurb: 'The most ambitious yet: a spiral up the Dread Spire, a sky bridge over the start, and straight through the castle.',
  width: 26,
  wallHeight: 1.5,
  samples: 720,
  bridgeAbove: 7,
  walled: [[27, 29]], // gatehouse to rear gate: the castle (control point indices)
  jumps: [[36, 37]],  // the Leap: a 12 m gap off a kicker
  points: [
    [0, 0, 0], [80, 0, 0],
    [130, -20, 0], [150, -65, 1.5], [125, -110, 1], [158, -143, 0],                  // the S down to the crag
    ...spiral(DREAD_SPIRE.x, DREAD_SPIRE.z, DREAD_SPIRE.r, 0, 540, 0, 16),            // the Dread Spire: points 6–18
    [140, -250, 16], [70, -235, 15.5], [25, -180, 15], [15, -100, 14], [30, 0, 13], // the Sky Bridge, over the start
    [38, 60, 12], [40, 115, 7.5], [40, 155, 2.5],
    [40, 190, 0.3], [40, 250, 0.3], [40, 320, 0.3],                                  // the citadel: points 27–29
    [30, 357, 0], [0, 380, 0], [-45, 372, 0], [-70, 335, 0],                         // hairpin
    [-80, 285, 1.5], [-84, 264, 5], [-87, 252, 6.8], [-90, 240, 4], [-95, 218, 2.5], [-100, 190, 0], // the Leap: lip 36, landing 37
    [-140, 150, 0], [-125, 108, 0], [-150, 65, 0], [-195, 35, 0], [-200, -8, 0],     // S-bends
    [-140, -8, 0], [-75, 0, 0],                                                       // home straight
  ],
};

/** Every track, by id. The id goes over the network and in URLs; the name is for people. */
export const TRACKS: Record<string, TrackDef> = { loop: GREYBOX, hollow: HOLLOW, serpent: SERPENT, citadel: CITADEL };
export const DEFAULT_TRACK = 'loop';
export const trackDef = (id: unknown) => TRACKS[String(id)] ?? TRACKS[DEFAULT_TRACK];
