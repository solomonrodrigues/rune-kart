import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepKart, clampInput, type KartState } from './kart.ts';

const run = () => {
  const k: KartState = { x: 0, z: 0, yaw: 0, speed: 0 };
  for (let i = 0; i < 600; i++) stepKart(k, { steer: Math.sin(i / 30), throttle: 1 }, 1 / 60);
  return k;
};

test('stepKart is deterministic', () => assert.deepEqual(run(), run()));

test('clampInput rejects garbage from the wire', () => {
  assert.deepEqual(clampInput({ steer: 9, throttle: NaN } as any), { steer: 1, throttle: 0 });
  assert.deepEqual(clampInput(undefined as any), { steer: 0, throttle: 0 });
});
