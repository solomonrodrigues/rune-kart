// Race progress along the track centreline. Distance is counted in samples, unwrapped across laps:
// negative on the grid, 0 at the start line, samples.length per lap. It can only move a few samples per
// tick, so cutting across the infield or teleporting doesn't skip ahead.
import { nearestSample, type Track } from './track.ts';
import type { KartInput, KartState } from './kart.ts';

export interface Progress {
  idx: number;   // unwrapped sample index the kart is nearest to
  dist: number;  // idx plus the fraction towards the next sample, for ordering
}

const WINDOW = 12;     // samples searched either side of the last known position each tick
const RESYNC_SQ = 400; // (20 m)² — further than this from the window (e.g. after a respawn), search globally

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function startProgress(track: Track, k: KartState): Progress {
  const n = track.samples.length;
  const i = track.samples.indexOf(nearestSample(track, k.x, k.z));
  const idx = i > n / 2 ? i - n : i; // grid slots sit just behind the line
  return { idx, dist: idx };
}

export function updateProgress(p: Progress, track: Track, k: KartState): void {
  const { samples } = track;
  const n = samples.length;
  let best = p.idx, bestD = Infinity;
  for (let o = -WINDOW; o <= WINDOW; o++) {
    const s = samples[mod(p.idx + o, n)];
    const d = (s.x - k.x) ** 2 + (s.z - k.z) ** 2;
    if (d < bestD) { bestD = d; best = p.idx + o; }
  }
  if (bestD > RESYNC_SQ) {
    const i = samples.indexOf(nearestSample(track, k.x, k.z));
    // Pick the unwrapped index for i closest to where we were.
    best = p.idx + (mod(i - mod(p.idx, n) + n / 2, n) - n / 2);
  }
  p.idx = best;
  // Fraction along the segment to the next sample, so karts on the same sample still order correctly.
  const a = samples[mod(best, n)], b = samples[mod(best + 1, n)];
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = ((k.x - a.x) * dx + (k.z - a.z) * dz) / (dx * dx + dz * dz);
  p.dist = best + Math.max(-0.5, Math.min(1, t));
}

/** 1-based lap the kart is on (1 on the grid). */
export const lapOf = (p: Progress, track: Track) => Math.max(1, Math.floor(p.dist / track.samples.length) + 1);
export const hasFinished = (p: Progress, track: Track, laps: number) => p.dist >= laps * track.samples.length;

/** Steer towards the centreline a few samples ahead. Used by tests and the headless client; bots later. */
export function autopilot(track: Track, k: KartState, lookahead = 4): KartInput {
  const t = track.samples[mod(track.samples.indexOf(nearestSample(track, k.x, k.z)) + lookahead, track.samples.length)];
  const want = Math.atan2(t.x - k.x, t.z - k.z);
  const diff = Math.atan2(Math.sin(want - k.yaw), Math.cos(want - k.yaw));
  return { steer: Math.max(-1, Math.min(1, -diff * 3)), throttle: 1, drift: false };
}
