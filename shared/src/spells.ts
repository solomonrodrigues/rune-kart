// Mana and spells. Casting, mana and self-buffs run inside the deterministic kart step (so the client
// predicts them); spells that touch other karts become effects that only the server simulates.
import { Ray, Vector3, DoubleSide } from 'three';
import type { KartState } from './kart.ts';
import type { Track } from './track.ts';

export type SpellKind = 'self' | 'projectile' | 'dropped';

export interface Spell {
  id: 'haste' | 'smite' | 'snare' | 'ward';
  name: string;
  cost: number;
  cooldown: number; // seconds
  kind: SpellKind;
  color: number;
}

// Balancing happens here. The order is the loadout: keys 1–4.
export const SPELLS: Spell[] = [
  { id: 'haste', name: 'Haste', cost: 30, cooldown: 1.5, kind: 'self', color: 0x4fc3ff },
  { id: 'smite', name: 'Smite', cost: 40, cooldown: 1.0, kind: 'projectile', color: 0xd65cff },
  { id: 'snare', name: 'Snare', cost: 35, cooldown: 2.0, kind: 'dropped', color: 0xff9d2e },
  { id: 'ward', name: 'Ward', cost: 45, cooldown: 4.0, kind: 'self', color: 0x7dffb0 },
];

export const MANA = {
  max: 100,
  start: 50,
  regen: 8,          // per second → empty to full in 12.5 s
  driftRegen: 3,     // extra per second while drifting, rewarding skill
  catchUp: 0.5,      // last place regenerates this much faster than first (server sets the multiplier)
  hasteBoost: 1.2,   // seconds of boost
  wardTime: 6,       // seconds a ward lasts unless it blocks a hit first
  stunTime: 1.0,     // seconds spun out when hit
  smite: { speed: 55, life: 2.0, radius: 1.3, height: 0.6 },
  snare: { life: 20, radius: 1.6, arm: 0.6, behind: 3, maxPerKart: 3 },
};

export const NO_CAST = -1;
const cdKeys = ['cd0', 'cd1', 'cd2', 'cd3'] as const;
export const cooldownOf = (k: KartState, slot: number) => k[cdKeys[slot]];

/**
 * Regenerate mana, tick cooldowns and buffs, and try the requested cast.
 * Returns the spell if it was cast this step (the server spawns its effect; the client plays VFX).
 */
export function stepSpells(k: KartState, cast: number, dt: number): Spell | null {
  k.mana = Math.min(MANA.max, k.mana + (MANA.regen * k.manaRegenMul + (k.driftDir ? MANA.driftRegen : 0)) * dt);
  for (const key of cdKeys) k[key] = Math.max(0, k[key] - dt);
  k.wardTime = Math.max(0, k.wardTime - dt);

  const spell = SPELLS[cast];
  if (!spell || k.stunTime > 0 || k.mana < spell.cost || cooldownOf(k, cast) > 0) return null;
  k.mana -= spell.cost;
  k[cdKeys[cast]] = spell.cooldown;
  if (spell.id === 'haste') { k.boostTime = Math.max(k.boostTime, MANA.hasteBoost); k.boostTier = 0; }
  if (spell.id === 'ward') k.wardTime = MANA.wardTime;
  return spell;
}

// --- Effects (server-simulated, replicated for rendering) ---

export interface Effect {
  id: number;
  kind: 'smite' | 'snare';
  owner: string;
  x: number; y: number; z: number;
  vx: number; vz: number;
  age: number;
}

export function spawnEffect(id: number, spell: Spell, owner: string, k: KartState): Effect | null {
  const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
  if (spell.id === 'smite') {
    const speed = Math.max(0, k.vx * fx + k.vz * fz) + MANA.smite.speed;
    return { id, kind: 'smite', owner, x: k.x + fx * 2, y: k.y + MANA.smite.height, z: k.z + fz * 2, vx: fx * speed, vz: fz * speed, age: 0 };
  }
  if (spell.id === 'snare') {
    const b = MANA.snare.behind;
    return { id, kind: 'snare', owner, x: k.x - fx * b, y: k.y, z: k.z - fz * b, vx: 0, vz: 0, age: 0 };
  }
  return null;
}

const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
const centre = new Vector3();

/** Lands a hit on a kart: a ward absorbs it, otherwise the kart spins out. */
export function hitKart(k: KartState): 'warded' | 'stunned' {
  if (k.wardTime > 0) { k.wardTime = 0; return 'warded'; }
  k.stunTime = MANA.stunTime;
  k.driftDir = 0;
  k.driftCharge = 0;
  k.boostTime = 0;
  return 'stunned';
}

/**
 * Advance effects one step. Returns the ones to remove (expired, hit a wall, fell off, or hit a kart).
 * `karts` is [ownerId, kart] so effects can ignore their caster briefly.
 */
export function stepEffects(effects: Effect[], karts: [string, KartState][], track: Track, dt: number): Set<Effect> {
  const dead = new Set<Effect>();
  for (const e of effects) {
    e.age += dt;
    if (e.kind === 'smite') {
      e.x += e.vx * dt; e.z += e.vz * dt;
      // Hug the road so smites follow ramps; die over a drop or into a wall.
      ray.origin.set(e.x, e.y + 3, e.z);
      const ground = track.roadBVH.raycastFirst(ray, DoubleSide, 0, 8) ?? track.groundBVH.raycastFirst(ray, DoubleSide, 0, 8);
      if (!ground || e.age > MANA.smite.life) { dead.add(e); continue; }
      e.y = ground.point.y + MANA.smite.height;
      const wall = track.wallBVH.closestPointToPoint(centre.set(e.x, e.y, e.z), undefined, 0, 0.4);
      if (wall && wall.distance < 0.4) { dead.add(e); continue; }
    } else if (e.age > MANA.snare.life) { dead.add(e); continue; }

    const radius = e.kind === 'smite' ? MANA.smite.radius : MANA.snare.radius;
    const ownerImmune = e.kind === 'smite' ? 0.3 : MANA.snare.arm;
    if (e.kind === 'snare' && e.age < MANA.snare.arm * 0.5) continue; // still settling
    for (const [id, k] of karts) {
      if (id === e.owner && e.age < ownerImmune) continue;
      if (Math.abs(k.y + 0.5 - e.y) > 2 || (k.x - e.x) ** 2 + (k.z - e.z) ** 2 > radius * radius) continue;
      hitKart(k);
      dead.add(e);
      break;
    }
  }
  return dead;
}
