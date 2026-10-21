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

// Every crossing on a track that crosses itself: karts stay on their own level, under and over the bridge.
for (const id of ['hollow', 'citadel']) {
  const track = createTrack(TRACKS[id]);
  const S = track.samples, n = S.length;
  // Find the crossings: a low sample with a bridge sample right above it (distinct ones, well apart).
  const crossings: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (S[i].y > 2 || crossings.some(([l]) => Math.abs(l - i) < 60)) continue;
    const j = S.findIndex(o => o.y > S[i].y + 8 && Math.hypot(o.x - S[i].x, o.z - S[i].z) < 6);
    if (j >= 0) crossings.push([i, j]);
  }
  test(`${id}: has its crossings`, () => assert.ok(crossings.length >= (id === 'citadel' ? 2 : 1), `found ${crossings.length}`));
  for (const [low, high] of crossings) test(`${id}: the crossover at ${low}/${high} — karts stay on their own level`, () => {
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
}

// --- The Leap, on Dreadmoor Citadel ---
const citadel = createTrack(TRACKS.citadel);
const leap = citadel.jumps[0];

test('citadel: at speed you fly the Leap and land on the road beyond it', () => {
  const S = citadel.samples, n = S.length, st = S[(leap.lip - 25 + n) % n];
  const k = newKart({ x: st.x, y: st.y + 0.3, z: st.z, yaw: st.yaw });
  k.vx = Math.sin(st.yaw) * 22; k.vz = Math.cos(st.yaw) * 22;
  let air = 0, landed = false;
  for (let t = 0; t < 60 * 4; t++) {
    stepKart(k, autopilot(citadel, k), citadel);
    if (!k.grounded) air++;
    else if (air > 10 && !k.offroad) landed = true;
    assert.equal(k.rescue, 0, 'should not need rescuing');
  }
  assert.ok(air / 60 > 0.3, `airtime ${(air / 60).toFixed(2)} s`);
  assert.ok(landed, 'should land on the road');
});

test('citadel: fall short of the Leap and the crows carry you across, not back to fall again', () => {
  const S = citadel.samples, n = S.length, st = S[(leap.lip - 1 + n) % n];
  const k = newKart({ x: st.x, y: st.y + 0.3, z: st.z, yaw: st.yaw });
  k.vx = Math.sin(st.yaw) * 3; k.vz = Math.cos(st.yaw) * 3; // creeping off the lip
  let rescued = false;
  for (let t = 0; t < 60 * 8 && !rescued; t++) { stepKart(k, { steer: 0, throttle: 0.2, drift: false }, citadel); rescued = k.rescue > 0; }
  assert.ok(rescued, 'should be rescued');
  const ahead = (k.lastRoad - leap.landing + n) % n;
  assert.ok(ahead >= 0 && ahead < 5, `set down at ${k.lastRoad}, landing is ${leap.landing}`);
});

test('citadel: fall off the inside of the spiral and the crows come almost at once', () => {
  // Left the road high up the spiral, landed on the grass inside it — near the spiral's ground-level start,
  // but driving back there would mean climbing it all again.
  const S = citadel.samples, high = S.findIndex(s => s.y > 9 && s.y < 10);
  const a = 300 * Math.PI / 180;
  const k = newKart({ x: 200 + Math.sin(a) * 30, y: 0.4, z: -190 + Math.cos(a) * 30, yaw: 0 });
  k.lastRoad = high;
  let ticks = 0;
  for (; ticks < 60 * 2 && k.rescue === 0; ticks++) stepKart(k, { steer: 0, throttle: 0, drift: false }, citadel);
  assert.ok(k.rescue > 0 && ticks / 60 < 1, `rescued after ${(ticks / 60).toFixed(2)} s`);
  assert.equal(k.lastRoad, high, 'back where it fell off');
});
