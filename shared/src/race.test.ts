import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newKart, respawn, stepKart } from './kart.ts';
import { autopilot, hasFinished, lapOf, startProgress, updateProgress } from './race.ts';
import { createTrack, spawnPoint } from './track.ts';
import { GREYBOX } from './tracks.ts';

const track = createTrack(GREYBOX);
const n = track.samples.length;

test('grid slots start behind the line on lap 1', () => {
  for (let slot = 0; slot < 8; slot++) {
    const p = startProgress(track, newKart(spawnPoint(track, slot)));
    assert.ok(p.dist < 0 && p.dist > -20, `slot ${slot}: ${p.dist}`);
    assert.equal(lapOf(p, track), 1);
  }
});

test('an autopilot drive counts laps and finishes after the right distance', () => {
  const k = newKart(spawnPoint(track, 0));
  const p = startProgress(track, k);
  let lastLap = 1, lapTicks: number[] = [], prev = p.dist;
  for (let t = 0; t < 60 * 120 && !hasFinished(p, track, 2); t++) {
    stepKart(k, autopilot(track, k), track);
    updateProgress(p, track, k);
    assert.ok(p.dist > prev - 0.5, `went backwards at tick ${t}: ${prev} → ${p.dist}`);
    prev = p.dist;
    if (lapOf(p, track) !== lastLap) { lastLap = lapOf(p, track); lapTicks.push(t); }
  }
  assert.ok(hasFinished(p, track, 2), `only reached ${p.dist}`);
  assert.equal(lapTicks.length, 2); // into lap 2, then past the end of lap 2
  const lapSeconds = (lapTicks[1] - lapTicks[0]) / 60;
  assert.ok(lapSeconds > 15 && lapSeconds < 60, `lap took ${lapSeconds}s`);
});

test('driving backwards over the line loses the lap', () => {
  const k = newKart(spawnPoint(track, 0));
  const p = startProgress(track, k);
  for (let t = 0; t < 90; t++) { stepKart(k, { steer: 0, throttle: 1, drift: false }, track); updateProgress(p, track, k); }
  assert.ok(p.dist > 0);
  k.yaw += Math.PI; k.vx = -k.vx; k.vz = -k.vz;
  for (let t = 0; t < 120; t++) { stepKart(k, { steer: 0, throttle: 1, drift: false }, track); updateProgress(p, track, k); }
  assert.ok(p.dist < 0, `dist=${p.dist}`);
});

test('teleporting across the track does not count as progress', () => {
  const k = newKart(spawnPoint(track, 0));
  const p = startProgress(track, k);
  const far = track.samples[n / 2];
  Object.assign(k, { x: far.x, z: far.z });
  updateProgress(p, track, k);
  // Resync picks the nearest unwrapped index, which for the half-way point is ±n/2 — never a whole lap.
  assert.ok(Math.abs(p.dist) <= n / 2 + 1, `dist=${p.dist}`);
});

test('respawning keeps progress where the kart fell off', () => {
  const k = newKart(spawnPoint(track, 0));
  const p = startProgress(track, k);
  for (let t = 0; t < 600; t++) { stepKart(k, autopilot(track, k), track); updateProgress(p, track, k); }
  const before = p.dist;
  respawn(k, track);
  updateProgress(p, track, k);
  assert.ok(Math.abs(p.dist - before) < 3, `${before} → ${p.dist}`);
});
