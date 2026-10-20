// Arcade kart physics. Deterministic and free of DOM/Node APIs: the client and the server both run it.
import { Ray, Vector3, DoubleSide } from 'three';
import { nearestIndex, nearestSample, type Track, type TrackSample } from './track.ts';
import { MANA, NO_CAST, SPELLS, stepSpells, type Spell } from './spells.ts';

export interface KartInput {
  steer: number;    // -1 (left) .. 1 (right)
  throttle: number; // -1 (brake/reverse) .. 1 (forward)
  drift: boolean;
  cast?: number;    // spell slot to cast this step (0..3), or NO_CAST
}

// Flat numbers so the state maps 1:1 onto a Colyseus schema.
export interface KartState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
  nx: number; ny: number; nz: number; // ground normal, for visuals
  grounded: number;   // 0 | 1
  offroad: number;    // 0 | 1
  driftDir: number;   // -1 | 0 | 1
  driftCharge: number;
  driftHeld: number;  // drift button: 0 up, 1 held and armed (no drift yet from this press), 2 held and used
  boostTime: number;
  boostTier: number;  // drift tier (1–3) behind the current boost, 0 for Haste — colours the flame
  steer: number;      // smoothed steering actually applied (input eases in, so keyboards aren't twitchy)
  mana: number;
  manaRegenMul: number; // set by the server from race position (catch-up), 1 otherwise
  cd0: number; cd1: number; cd2: number; cd3: number; // spell cooldowns, seconds left
  stunTime: number;   // spun out by a spell: no control until it runs out
  wardTime: number;   // a ward is up: absorbs the next hit
  // Rescue (the crows): stray too far off the road, or sit on the grass too long, and you're carried back.
  offroadTime: number; // seconds on the grass without touching the road
  lastRoad: number;    // sample index where the kart was last on the road (-1 until it has been)
  rescue: number;      // seconds left of being carried back: frozen until it runs out
}

// Tuning lives in one mutable object so it can be tweaked live from the console (window.KART).
export const KART = {
  maxSpeed: 30, accel: 24, brake: 40, reverseMax: 9,
  drag: 0.1, coastDrag: 0.8,
  offroadMax: 14, offroadDrag: 1.5,
  turnRate: 2.4, turnSpeedFull: 8, // speed at which steering reaches full authority
  steerRate: 7, // how fast steering eases towards the input, per second (full lock in ~0.15 s)
  grip: 12, driftGrip: 8, // drift grip keeps the path following the nose; the slide is mostly visual
  // Drift yaw rate (rad/s): neutral matches a typical corner, steering in tightens, steering out nearly straightens.
  driftMinSpeed: 10, driftBase: 0.8, driftTighten: 0.6, driftWiden: 0.55,
  driftTiers: [0.6, 1.2, 2.0], boostTimes: [0.6, 1.1, 1.8], // seconds of charge per spark tier
  boostMax: 40, boostAccel: 45,
  offroadBoostMax: 22, // a boost still helps on the grass, but never makes it faster than the road (maxSpeed)
  gravity: 30, airSteer: 0.35,
  radius: 0.7, probe: 1.5, snap: 0.45,
  wallBounce: 0.25,
  killY: -30,
  rescueAfter: 4, rescueDistance: 25, rescueHold: 1.5, // seconds on grass / metres past the road edge / seconds carried
};

export const DT = 1 / 60;

export function newKart(at: { x: number; y: number; z: number; yaw: number }): KartState {
  return {
    x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, yaw: at.yaw,
    nx: 0, ny: 1, nz: 0, grounded: 0, offroad: 0,
    driftDir: 0, driftCharge: 0, driftHeld: 0, boostTime: 0, boostTier: 0, steer: 0,
    mana: MANA.start, manaRegenMul: 1, cd0: 0, cd1: 0, cd2: 0, cd3: 0, stunTime: 0, wardTime: 0,
    offroadTime: 0, lastRoad: -1, rescue: 0,
  };
}

export const clampInput = (i: Partial<KartInput> | undefined): KartInput => ({
  steer: Math.max(-1, Math.min(1, Number(i?.steer) || 0)),
  throttle: Math.max(-1, Math.min(1, Number(i?.throttle) || 0)),
  drift: !!i?.drift,
  cast: Number.isInteger(i?.cast) && i!.cast! >= 0 && i!.cast! < SPELLS.length ? i!.cast : NO_CAST,
});

/** 0 while not drifting / not charged, else 1..3 — the boost tier a release would give. */
export const driftTier = (k: KartState) => KART.driftTiers.filter(t => k.driftCharge >= t).length;

// Scratch objects: step() allocates nothing per tick.
const ray = new Ray(), pos = new Vector3(), vel = new Vector3(), n = new Vector3();
const fwd = new Vector3(), lat = new Vector3(), centre = new Vector3(), push = new Vector3();
const hitInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };

function probeGround(track: Track, reach: number) {
  ray.origin.copy(pos).addScaledVector(n.set(0, 1, 0), KART.probe);
  ray.direction.set(0, -1, 0);
  const road = track.roadBVH.raycastFirst(ray, DoubleSide, 0, KART.probe + reach);
  const ground = track.groundBVH.raycastFirst(ray, DoubleSide, 0, KART.probe + reach);
  if (road && (!ground || road.distance <= ground.distance + 0.05)) return { hit: road, offroad: 0 };
  return ground ? { hit: ground, offroad: 1 } : null;
}

const STUNNED: KartInput = { steer: 0, throttle: 0, drift: false };

/** One fixed physics step. Returns the spell cast this step, if any. */
export function stepKart(k: KartState, input: KartInput, track: Track, dt = DT): Spell | null {
  const K = KART;
  if (k.rescue > 0) { // being carried back: held still, no control; mana and cooldowns keep ticking
    k.rescue = Math.max(0, k.rescue - dt);
    k.vx = k.vy = k.vz = 0;
    stepSpells(k, NO_CAST, dt);
    return null;
  }
  const stunned = k.stunTime > 0;
  k.stunTime = Math.max(0, k.stunTime - dt);
  const cast = stepSpells(k, stunned ? NO_CAST : input.cast ?? NO_CAST, dt);
  if (stunned) input = STUNNED;
  pos.set(k.x, k.y, k.z);
  vel.set(k.vx, k.vy, k.vz);

  // --- Ground contact ---
  const reach = k.grounded ? K.snap : Math.max(0.05, -vel.y * dt);
  // Stay glued while grounded (slopes give positive vy); when airborne only land while falling.
  const g = k.grounded || vel.y <= 0 ? probeGround(track, reach) : null;
  const grounded = !!g;
  if (g) {
    n.copy(g.hit.face!.normal!);
    if (n.y < 0) n.negate();
    pos.y = g.hit.point.y;
    vel.addScaledVector(n, -vel.dot(n)); // no velocity into or away from the surface
    k.offroad = g.offroad;
  } else {
    n.set(0, 1, 0);
    vel.y -= K.gravity * dt;
  }

  // Heading projected onto the ground plane.
  const basis = () => {
    fwd.set(Math.sin(k.yaw), 0, Math.cos(k.yaw));
    fwd.addScaledVector(n, -fwd.dot(n)).normalize();
    lat.crossVectors(fwd, n).normalize(); // points right
  };
  basis();
  let vF = vel.dot(fwd), vL = vel.dot(lat);
  const vN = grounded ? 0 : vel.dot(n);

  // --- Drift state ---
  // A press arms the drift until it's let go, so it starts whichever comes first — the button or the steering —
  // as soon as the kart is steering, grounded and quick enough. One press, one drift: a drift that ends while
  // the button's still down doesn't restart until it's pressed again.
  let started = false;
  if (input.drift && k.driftHeld !== 2 && !k.driftDir && grounded && Math.abs(input.steer) > 0.1 && vF > K.driftMinSpeed) {
    k.driftDir = Math.sign(input.steer);
    k.driftCharge = 0;
    started = true;
  }
  if (k.driftDir && (!input.drift || vF < K.driftMinSpeed * 0.5)) {
    const tier = driftTier(k);
    if (tier && input.drift === false) {
      k.boostTime = Math.max(k.boostTime, K.boostTimes[tier - 1]);
      k.boostTier = tier;
    }
    k.driftDir = 0;
    k.driftCharge = 0;
    // Mid-drift the nose points into the corner; on release face where the kart is actually going,
    // so the boost carries it along its path instead of into the inside of the corner.
    if (grounded && Math.hypot(vel.x, vel.z) > 1) {
      k.yaw = Math.atan2(vel.x, vel.z);
      basis();
      vF = vel.dot(fwd); vL = vel.dot(lat);
    }
  }
  if (k.driftDir && grounded) k.driftCharge += dt * (0.8 + 0.5 * Math.max(0, k.steer * k.driftDir));
  k.driftHeld = !input.drift ? 0 : started || k.driftHeld === 2 ? 2 : 1;

  // --- Steering ---
  k.steer += Math.max(-K.steerRate * dt, Math.min(K.steerRate * dt, input.steer - k.steer));
  const authority = Math.min(1, Math.abs(vF) / K.turnSpeedFull) * Math.sign(vF || 1);
  let yawRate: number;
  if (k.driftDir) {
    const into = k.steer * k.driftDir; // +1 steering into the drift, -1 steering out
    yawRate = k.driftDir * (K.driftBase + into * (into > 0 ? K.driftTighten : K.driftWiden));
  } else {
    yawRate = k.steer * K.turnRate * authority * (1 - 0.25 * Math.min(1, Math.abs(vF) / K.maxSpeed));
  }
  k.yaw -= yawRate * dt * (grounded ? 1 : K.airSteer);

  // --- Longitudinal / lateral forces (grounded only; in the air momentum carries) ---
  if (grounded) {
    const boosting = k.boostTime > 0;
    const max = boosting ? (k.offroad ? K.offroadBoostMax : K.boostMax) : k.offroad ? K.offroadMax : K.maxSpeed;
    // On the road a boost overshoots boostMax for a moment (the soft cap below reins it in); on the grass it
    // stops pushing at offroadBoostMax, so it helps you recover without ever making the grass a shortcut.
    if (boosting) { if (!k.offroad || vF < max) vF += K.boostAccel * dt; }
    // Punchy off the line, tapering towards top speed.
    else if (input.throttle > 0) vF += K.accel * input.throttle * Math.max(0, 1 - (vF / max) ** 2) * dt;
    else if (input.throttle < 0) vF = vF > 0.5 ? vF - K.brake * dt : Math.max(-K.reverseMax, vF + K.accel * 0.5 * input.throttle * dt);
    vF -= vF * (input.throttle === 0 && !boosting ? K.coastDrag : K.drag) * dt;
    if (k.offroad && !boosting) vF -= vF * K.offroadDrag * dt;
    if (stunned) vF -= vF * 2.5 * dt; // spinning out scrubs speed
    if (vF > max) vF -= (vF - max) * Math.min(1, 3 * dt); // soft cap so boosts bleed off smoothly
    vL *= Math.exp(-(k.driftDir ? K.driftGrip : K.grip) * dt);
    // Gravity along the slope, so hills slow you and descents speed you up.
    vF -= K.gravity * fwd.y * dt;
  }
  k.boostTime = Math.max(0, k.boostTime - dt);
  vel.copy(fwd).multiplyScalar(vF).addScaledVector(lat, vL).addScaledVector(n, vN);

  pos.addScaledVector(vel, dt);

  // --- Walls: push the kart's sphere out of any wall triangle ---
  for (let iter = 0; iter < 2; iter++) {
    centre.copy(pos).y += K.radius;
    // maxThreshold only stops the search early — the BVH can still return a farther point, so check it.
    const hit = track.wallBVH.closestPointToPoint(centre, hitInfo, 0, K.radius);
    if (!hit || hit.distance >= K.radius) break;
    push.subVectors(centre, hit.point);
    const dy = push.y;
    push.y = 0;
    const d = push.length();
    if (d < 1e-6) break;
    push.divideScalar(d);
    // Walls are vertical, so resolve horizontally: move out until the sphere just touches the contact.
    pos.addScaledVector(push, Math.sqrt(K.radius * K.radius - dy * dy) - d);
    const into = vel.x * push.x + vel.z * push.z;
    if (into < 0) {
      vel.x -= push.x * into * (1 + K.wallBounce);
      vel.z -= push.z * into * (1 + K.wallBounce);
    }
  }

  k.x = pos.x; k.y = pos.y; k.z = pos.z;
  k.vx = vel.x; k.vy = vel.y; k.vz = vel.z;
  k.nx = n.x; k.ny = n.y; k.nz = n.z;
  k.grounded = grounded ? 1 : 0;

  // Rescue: too long on the grass, too far from the road, or fallen off the world.
  if (grounded && !k.offroad) {
    k.offroadTime = 0;
    k.lastRoad = nearestIndex(track, k.x, k.z, k.y);
  } else {
    if (grounded) k.offroadTime += dt;
    const s = nearestSample(track, k.x, k.z);
    const far = (s.x - k.x) ** 2 + (s.z - k.z) ** 2 > (track.def.width / 2 + K.rescueDistance) ** 2;
    if (k.offroadTime > K.rescueAfter || far || k.y < K.killY) rescue(k, track);
  }
  return cast;
}

/** Carried back by the crows to where the kart left the road (so cutting across the grass gains nothing). */
export function rescue(k: KartState, track: Track): void {
  let at = k.lastRoad >= 0 ? k.lastRoad : nearestIndex(track, k.x, k.z, k.y);
  // Fell short of a jump: carried across to the landing, not back to the lip to fall in again.
  const n = track.samples.length;
  for (const { lip, landing } of track.jumps) if ((lip - at + n) % n <= 10) at = (landing + 2) % n;
  placeAt(k, track.samples[at]);
  k.lastRoad = at;
  k.rescue = KART.rescueHold;
}

export function respawn(k: KartState, track: Track): void {
  placeAt(k, nearestSample(track, k.x, k.z, k.y));
}

/** A fresh kart just above sample `s`, facing along the track; mana and cooldowns carry over. */
function placeAt(k: KartState, s: TrackSample) {
  const { mana, manaRegenMul, cd0, cd1, cd2, cd3 } = k; // a respawn doesn't refund or drain mana
  Object.assign(k, newKart({ x: s.x, y: s.y + 1, z: s.z, yaw: s.yaw }), { mana, manaRegenMul, cd0, cd1, cd2, cd3 });
}

/** Forward speed in m/s, for HUD and visuals. */
export const kartSpeed = (k: KartState) => k.vx * Math.sin(k.yaw) + k.vz * Math.cos(k.yaw);

// Explicit field copy: Colyseus schema fields are accessors, so Object.assign/spread would miss them.
export const KART_FIELDS = Object.keys(newKart({ x: 0, y: 0, z: 0, yaw: 0 })) as (keyof KartState)[];
export function copyKart<T extends KartState>(to: T, from: KartState): T {
  for (const f of KART_FIELDS) to[f] = from[f];
  return to;
}

const BUMP_RADIUS = 1.0;      // per kart, in the ground plane
const BUMP_HEIGHT = 1.5;      // karts further apart vertically pass over/under each other
const BUMP_RESTITUTION = 0.6;

/** Server-side kart-vs-kart collisions: separate overlapping karts and bounce their velocities. */
export function resolveBumps(karts: KartState[]): void {
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      if (Math.abs(a.y - b.y) > BUMP_HEIGHT) continue;
      let dx = b.x - a.x, dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d >= BUMP_RADIUS * 2) continue;
      if (d < 1e-6) { dx = 1; dz = 0; d = 1e-6; } // exactly stacked: split along x
      const nx = dx / d, nz = dz / d;
      const overlap = (BUMP_RADIUS * 2 - d) / 2;
      a.x -= nx * overlap; a.z -= nz * overlap;
      b.x += nx * overlap; b.z += nz * overlap;
      // Equal masses: exchange the closing part of the velocity along the contact normal.
      const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (closing > 0) {
        const imp = closing * (1 + BUMP_RESTITUTION) / 2;
        a.vx -= nx * imp; a.vz -= nz * imp;
        b.vx += nx * imp; b.vz += nz * imp;
      }
    }
  }
}
