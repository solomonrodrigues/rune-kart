// Every track must be raceable: karts settle on the grid, a driver can lap it cleanly, walls hold, and
// edges don't snag. New tracks get these checks for free by being added to TRACKS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newKart, stepKart, kartSpeed } from './kart.ts';
import { autopilot, hasFinished, lapOf, startProgress, updateProgress } from './race.ts';
import { createTrack, nearestSample, spawnPoint } from './track.ts';
import { TRACKS } from './tracks.ts';

for (const [id, def] of Object.entries(TRACKS)) {
  const track = createTrack(def);

  test(`${id}: all 8 grid slots settle on the road behind the line`, () => {
    for (let slot = 0; slot < 8; slot++) {
      const k = newKart(spawnPoint(track, slot));
      for (let i = 0; i < 30; i++) stepKart(k, { steer: 0, throttle: 0, drift: false }, track);
      assert.equal(k.grounded, 1, `slot ${slot} not grounded`);
      assert.equal(k.offroad, 0, `slot ${slot} spawned offroad`);
      const p = startProgress(track, k);
      assert.ok(p.dist < 0 && lapOf(p, track) === 1, `slot ${slot} dist ${p.dist}`);
    }
  });

  test(`${id}: an autopilot laps it cleanly and the lap counts`, () => {
    const k = newKart(spawnPoint(track, 0));
    const p = startProgress(track, k);
    let ticks = 0, offroad = 0;
    for (; ticks < 60 * 90 && !hasFinished(p, track, 1); ticks++) {
      stepKart(k, autopilot(track, k), track);
      updateProgress(p, track, k);
      offroad += k.offroad;
    }
    assert.ok(hasFinished(p, track, 1), `${id}: lap not finished in 90 s`);
    assert.ok(offroad / ticks < 0.05, `${id}: offroad ${(100 * offroad / ticks).toFixed(1)}%`);
  });

  test(`${id}: driving along either edge never snags`, () => {
    const snags: string[] = [];
    const h = def.width / 2;
    track.samples.forEach((s, i) => {
      if (i % 5) return;
      for (const off of [-(h - 0.5), h - 0.5]) {
        const k = newKart({ x: s.x - Math.cos(s.yaw) * off, y: s.y + 0.2, z: s.z + Math.sin(s.yaw) * off, yaw: s.yaw });
        for (let t = 0; t < 10; t++) stepKart(k, { steer: 0, throttle: 0, drift: false }, track);
        if (k.offroad) continue;
        k.vx = Math.sin(s.yaw) * 22; k.vz = Math.cos(s.yaw) * 22;
        let minV = Infinity;
        for (let t = 0; t < 45; t++) { stepKart(k, { steer: 0, throttle: 1, drift: false }, track); minV = Math.min(minV, kartSpeed(k)); }
        if (minV < 8) snags.push(`sample ${i} offset ${off}: ${minV.toFixed(1)}`);
      }
    });
    assert.deepEqual(snags, []);
  });
}

test('hollow: the crossover — karts stay on their own level, under and over the bridge', () => {
  const track = createTrack(TRACKS.hollow);
  const S = track.samples, n = S.length;
  // Find the crossing: a low sample with a bridge sample right above it.
  let low = -1, high = -1;
  for (let i = 0; i < n && low < 0; i++) {
    if (S[i].y > 2) continue;
    const j = S.findIndex(o => o.y > 10 && Math.hypot(o.x - S[i].x, o.z - S[i].z) < 6);
    if (j >= 0) { low = i; high = j; }
  }
  assert.ok(low >= 0, 'no crossover found');
  // Right at the crossing, both levels share (x, z): matching must go by height.
  // Test from points on each road that are horizontally *closer to the other road's sample* — the case a
  // flat (x, z) match gets wrong.
  for (const [own, other] of [[low, high], [high, low]]) {
    const a = S[own], b = S[other];
    const x = a.x + (b.x - a.x) * 0.7, z = a.z + (b.z - a.z) * 0.7;
    // (Bots, respawns and lap tracking all match through this, so the right level here is what matters.)
    assert.ok(Math.abs(nearestSample(track, x, z, a.y).y - a.y) < 2, `near sample ${own}: matched the other level`);
  }
  for (const [idx, label] of [[low, 'under'], [high, 'over']] as const) {
    // Start 40 samples back and drive through the crossing with the autopilot.
    const s = S[(idx - 40 + n) % n];
    const k = newKart({ x: s.x, y: s.y + 0.3, z: s.z, yaw: s.yaw });
    const p = startProgress(track, k);
    const startDist = p.dist;
    let minY = Infinity, maxY = -Infinity, minV = Infinity;
    for (let t = 0; t < 60 * 4; t++) {
      stepKart(k, autopilot(track, k), track);
      updateProgress(p, track, k);
      if (t > 60) { minY = Math.min(minY, k.y); maxY = Math.max(maxY, k.y); minV = Math.min(minV, kartSpeed(k)); }
    }
    const level = S[idx].y;
    assert.ok(Math.abs(minY - level) < 6 && Math.abs(maxY - level) < 6, `${label}: left its level (y ${minY.toFixed(1)}..${maxY.toFixed(1)}, crossing at ${level.toFixed(1)})`);
    assert.ok(minV > 8, `${label}: snagged (speed fell to ${minV.toFixed(1)})`);
    // From a standing start it covers ~25 samples in 4 s; a jump to the other level would be ~hundreds.
    assert.ok(p.dist - startDist > 15 && p.dist - startDist < 80, `${label}: progress jumped (${(p.dist - startDist).toFixed(0)} samples)`);
  }
});
