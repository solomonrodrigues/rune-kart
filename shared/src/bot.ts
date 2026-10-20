// Bot drivers: follow the track like the autopilot, drift big corners for boosts, and cast spells by simple
// rules. Runs on the server (bots have no client); the rand source is injectable so tests are deterministic.
import { driftTier, kartSpeed, type KartInput, type KartState } from './kart.ts';
import { autopilot } from './race.ts';
import { NO_CAST, SPELLS, cooldownOf } from './spells.ts';
import type { Track } from './track.ts';

export interface BotProfile {
  throttle: number;       // < 1 makes a bot a little slower; spreads the field out
  lookahead: number;      // samples ahead it steers at: bigger = smoother, wider lines
  driftThreshold: number; // how hard a corner has to be before it drifts it
  aggression: number;     // 0..1: how keen it is to use attack spells
}

export function randomProfile(rand: () => number = Math.random): BotProfile {
  return {
    throttle: 0.93 + rand() * 0.07,
    lookahead: 3 + Math.floor(rand() * 4),
    driftThreshold: 0.45 + rand() * 0.2,
    aggression: 0.4 + rand() * 0.6,
  };
}

const slot = (id: string) => SPELLS.findIndex(s => s.id === id);
const HASTE = slot('haste'), SMITE = slot('smite'), SNARE = slot('snare'), WARD = slot('ward');

export class Bot {
  private think = 0; // seconds until it next considers casting

  constructor(readonly profile: BotProfile, private rand: () => number = Math.random) {}

  input(k: KartState, track: Track, others: KartState[], dt: number): KartInput {
    const line = autopilot(track, k, this.profile.lookahead);
    // Drift: start into any corner sharper than its threshold; hold while the corner keeps turning that way,
    // and let go at the top tier (or when the corner flips) to cash in the boost.
    const drift = k.driftDir
      ? line.steer * k.driftDir > -0.15 && driftTier(k) < 3
      : Math.abs(line.steer) > this.profile.driftThreshold && kartSpeed(k) > 15;
    let cast = NO_CAST;
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.4 + this.rand() * 0.6;
      cast = this.chooseSpell(k, line, others);
    }
    return { steer: line.steer, throttle: this.profile.throttle, drift, cast };
  }

  private chooseSpell(k: KartState, line: KartInput, others: KartState[]): number {
    const can = (i: number) => k.mana >= SPELLS[i].cost && cooldownOf(k, i) <= 0;
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    let ahead = false, behind = false;
    for (const o of others) {
      const dx = o.x - k.x, dz = o.z - k.z, d = Math.hypot(dx, dz);
      if (d < 0.1) continue;
      const along = (dx * fx + dz * fz) / d; // cosine of the angle off the nose
      if (along > Math.cos(0.45) && d < 40) ahead = true;   // in Smite's homing cone and range
      if (along < -0.5 && d < 15) behind = true;            // close on its tail
    }
    const r = this.rand(), aggro = this.profile.aggression;
    if (ahead && can(SMITE) && r < aggro) return SMITE;
    if (behind && can(SNARE) && r < aggro * 0.7) return SNARE;
    if (behind && can(WARD) && k.wardTime <= 0 && k.mana > 70 && r < 0.3) return WARD;
    if (Math.abs(line.steer) < 0.15 && can(HASTE) && k.mana > 75 && r < 0.5) return HASTE; // straights only
    return NO_CAST;
  }
}
