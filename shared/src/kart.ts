// Arcade kart physics. Deterministic and free of DOM/Node APIs: the client and the server both run it.
import { Ray, Vector3, DoubleSide } from 'three';
import { nearestSample, type Track } from './track.ts';

export interface KartInput {
  steer: number;    // -1 (left) .. 1 (right)
  throttle: number; // -1 (brake/reverse) .. 1 (forward)
  drift: boolean;
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
  driftHeld: number;  // last tick's drift button, for edge detection
  boostTime: number;
}

// Tuning lives in one mutable object so it can be tweaked live from the console (window.KART).
export const KART = {
  maxSpeed: 30, accel: 24, brake: 40, reverseMax: 9,
  drag: 0.1, coastDrag: 0.8,
  offroadMax: 14, offroadDrag: 1.5,
  turnRate: 2.4, turnSpeedFull: 8, // speed at which steering reaches full authority
  grip: 12, driftGrip: 2.2,
  driftMinSpeed: 10, driftBase: 1.15, driftRange: 0.55,
  driftTiers: [1.0, 2.0, 3.0], boostTimes: [0.6, 1.1, 1.8],
  boostMax: 40, boostAccel: 45,
  gravity: 30, airSteer: 0.35,
  radius: 0.7, probe: 1.5, snap: 0.45,
  wallBounce: 0.25,
  killY: -30,
};

export const DT = 1 / 60;

export function newKart(at: { x: number; y: number; z: number; yaw: number }): KartState {
  return {
    x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, yaw: at.yaw,
    nx: 0, ny: 1, nz: 0, grounded: 0, offroad: 0,
    driftDir: 0, driftCharge: 0, driftHeld: 0, boostTime: 0,
  };
}

export const clampInput = (i: Partial<KartInput> | undefined): KartInput => ({
  steer: Math.max(-1, Math.min(1, Number(i?.steer) || 0)),
  throttle: Math.max(-1, Math.min(1, Number(i?.throttle) || 0)),
  drift: !!i?.drift,
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

export function stepKart(k: KartState, input: KartInput, track: Track, dt = DT): void {
  const K = KART;
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
  fwd.set(Math.sin(k.yaw), 0, Math.cos(k.yaw));
  fwd.addScaledVector(n, -fwd.dot(n)).normalize();
  lat.crossVectors(fwd, n).normalize(); // points right
  let vF = vel.dot(fwd), vL = vel.dot(lat);
  const vN = grounded ? 0 : vel.dot(n);

  // --- Drift state ---
  if (input.drift && !k.driftHeld && grounded && Math.abs(input.steer) > 0.1 && vF > K.driftMinSpeed) {
    k.driftDir = Math.sign(input.steer);
    k.driftCharge = 0;
  }
  if (k.driftDir && (!input.drift || vF < K.driftMinSpeed * 0.5)) {
    const tier = driftTier(k);
    if (tier && input.drift === false) k.boostTime = Math.max(k.boostTime, K.boostTimes[tier - 1]);
    k.driftDir = 0;
    k.driftCharge = 0;
  }
  if (k.driftDir && grounded) k.driftCharge += dt * (0.6 + 0.6 * Math.max(0, input.steer * k.driftDir));
  k.driftHeld = input.drift ? 1 : 0;

  // --- Steering ---
  const authority = Math.min(1, Math.abs(vF) / K.turnSpeedFull) * Math.sign(vF || 1);
  let yawRate: number;
  if (k.driftDir) {
    // Steering into the drift tightens it, steering out widens it, but it always turns.
    yawRate = k.driftDir * (K.driftBase + K.driftRange * input.steer * k.driftDir);
  } else {
    yawRate = input.steer * K.turnRate * authority * (1 - 0.25 * Math.min(1, Math.abs(vF) / K.maxSpeed));
  }
  k.yaw -= yawRate * dt * (grounded ? 1 : K.airSteer);

  // --- Longitudinal / lateral forces (grounded only; in the air momentum carries) ---
  if (grounded) {
    const boosting = k.boostTime > 0;
    const max = boosting ? K.boostMax : k.offroad ? K.offroadMax : K.maxSpeed;
    if (boosting) vF += K.boostAccel * dt;
    // Punchy off the line, tapering towards top speed.
    else if (input.throttle > 0) vF += K.accel * input.throttle * Math.max(0, 1 - (vF / max) ** 2) * dt;
    else if (input.throttle < 0) vF = vF > 0.5 ? vF - K.brake * dt : Math.max(-K.reverseMax, vF + K.accel * 0.5 * input.throttle * dt);
    vF -= vF * (input.throttle === 0 && !boosting ? K.coastDrag : K.drag) * dt;
    if (k.offroad && !boosting) vF -= vF * K.offroadDrag * dt;
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

  if (k.y < K.killY) respawn(k, track);
}

export function respawn(k: KartState, track: Track): void {
  const s = nearestSample(track, k.x, k.z);
  Object.assign(k, newKart({ x: s.x, y: s.y + 1, z: s.z, yaw: s.yaw }));
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
