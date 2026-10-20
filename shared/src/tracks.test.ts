// Every track must be raceable: karts settle on the grid, a driver can lap it cleanly, walls hold, and
// edges don't snag. New tracks get these checks for free by being added to TRACKS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newKart, stepKart, kartSpeed } from './kart.ts';
import { autopilot, hasFinished, lapOf, startProgress, updateProgress } from './race.ts';
import { createTrack, spawnPoint } from './track.ts';
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
