// Bot drivers: take a racing line that cuts to the inside of corners, drift big corners for boosts (letting go
// once the corner's done), Haste down the straights, and cast attack spells by simple rules. Runs on the server (bots have no client); the rand source is injectable so tests are deterministic.
import { driftTier, kartSpeed, type KartInput, type KartState } from './kart.ts';
import { NO_CAST, SPELLS, cooldownOf } from './spells.ts';
import { nearestIndex, type Track } from './track.ts';

export interface BotProfile {
  throttle: number;       // < 1 makes a bot a little slower; spreads the field out
  lookahead: number;      // samples ahead it steers at: bigger = smoother, wider lines
  apex: number;           // 0..1: how far towards the inside of a corner it cuts
  driftThreshold: number; // how hard a corner has to be before it drifts it
  aggression: number;     // 0..1: how keen it is to use attack spells
}

export function randomProfile(rand: () => number = Math.random): BotProfile {
  return {
    throttle: 0.97 + rand() * 0.03,
    lookahead: 3 + Math.floor(rand() * 4),
    apex: 0.6 + rand() * 0.4,
    driftThreshold: 0.35 + rand() * 0.15,
    aggression: 0.4 + rand() * 0.6,
  };
}

const slot = (id: string) => SPELLS.findIndex(s => s.id === id);
const HASTE = slot('haste'), SMITE = slot('smite'), SNARE = slot('snare'), WARD = slot('ward');

export class Bot {
  private think = 0; // seconds until it next considers casting

  constructor(readonly profile: BotProfile, private rand: () => number = Math.random) {}

  input(k: KartState, track: Track, others: KartState[], dt: number): KartInput {
    // Faster means looking further ahead (a sample is ~3 m), so a boost doesn't carry it blind into a corner.
    const speed = kartSpeed(k), look = this.profile.lookahead + Math.floor(Math.max(0, speed) / 12);
    const line = racingLine(track, k, look, this.profile.apex);
    // Drift: start into any corner sharper than its threshold; hold while the corner keeps turning that way,
    // and let go to cash in the boost at the top tier, when the corner flips, or once it's over with a tier banked
    // (drifting on down the straight only curves you towards a wall).
    const drift = k.driftDir
      ? line.steer * k.driftDir > -0.15 && driftTier(k) < 3 && !(driftTier(k) >= 1 && Math.abs(line.steer) < 0.2)
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
    // Haste down the straights, keeping enough mana back for a smite if it's the attacking sort.
    if (Math.abs(line.steer) < 0.15 && can(HASTE) && k.mana >= SPELLS[HASTE].cost + 20 * aggro && r < 0.8) return HASTE;
    return NO_CAST;
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));


/**
 * Steer for a point `lookahead` samples ahead, shifted towards the inside of the corner coming up (by up to
 * `apex` of the room between the centreline and 3 m in from the edge), so the bot cuts corners like a racer.
 */
export function racingLine(track: Track, k: KartState, lookahead: number, apex: number): KartInput {
  const { samples } = track, n = samples.length, i = nearestIndex(track, k.x, k.z, k.y);
  const t = samples[(i + lookahead) % n];
  const turn = wrap(samples[(i + lookahead + 8) % n].yaw - t.yaw); // > 0: the road bends left ahead
  const room = track.def.width / 2 - 3;
  const shift = Math.max(-room, Math.min(room, turn * room)) * apex; // a ~60° bend uses all the room
  // Left of the road is −right = (cos yaw, −sin yaw).
  const x = t.x + Math.cos(t.yaw) * shift, z = t.z - Math.sin(t.yaw) * shift;
  const diff = wrap(Math.atan2(x - k.x, z - k.z) - k.yaw);
  return { steer: Math.max(-1, Math.min(1, -diff * 3)), throttle: 1, drift: false };
}
