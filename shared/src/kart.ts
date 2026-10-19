// Placeholder kart model for milestone 1. Milestone 2 replaces this with the real arcade physics.
// Must stay deterministic and free of DOM/Node APIs: the client and server both run it.

export interface KartInput {
  steer: number;    // -1 (left) .. 1 (right)
  throttle: number; // -1 (reverse) .. 1 (forward)
}

export interface KartState {
  x: number;
  z: number;
  yaw: number;
  speed: number;
}

const ACCEL = 30;
const MAX_SPEED = 25;
const DRAG = 2;
const TURN_RATE = 2.5;

export const clampInput = (i: KartInput): KartInput => ({
  steer: Math.max(-1, Math.min(1, Number(i?.steer) || 0)),
  throttle: Math.max(-1, Math.min(1, Number(i?.throttle) || 0)),
});

export function stepKart(k: KartState, input: KartInput, dt: number): void {
  k.speed += input.throttle * ACCEL * dt;
  k.speed -= k.speed * DRAG * dt;
  k.speed = Math.max(-MAX_SPEED / 2, Math.min(MAX_SPEED, k.speed));
  // Steering scales with speed so a stationary kart can't spin in place.
  k.yaw -= input.steer * TURN_RATE * dt * Math.min(1, Math.abs(k.speed) / 5) * Math.sign(k.speed || 1);
  k.x += Math.sin(k.yaw) * k.speed * dt;
  k.z += Math.cos(k.yaw) * k.speed * dt;
}
