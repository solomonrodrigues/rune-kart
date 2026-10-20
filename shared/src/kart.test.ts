import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepKart, clampInput, newKart, driftTier, kartSpeed, KART, type KartInput, type KartState } from './kart.ts';
import { createTrack, spawnPoint } from './track.ts';
import { GREYBOX } from './tracks.ts';

const track = createTrack(GREYBOX);
const drive = (ticks: number, input: (i: number) => KartInput, k: KartState = newKart(spawnPoint(track, 0))) => {
  for (let i = 0; i < ticks; i++) stepKart(k, input(i), track);
  return k;
};
const gas: KartInput = { steer: 0, throttle: 1, drift: false };

test('stepKart is deterministic', () => {
  const lap = (i: number): KartInput => ({ steer: Math.sin(i / 40), throttle: 1, drift: i % 200 > 120 });
  assert.deepEqual(drive(1200, lap), drive(1200, lap));
});

test('a spawned kart settles on the road', () => {
  const s = spawnPoint(track, 0);
  const k = drive(30, () => ({ steer: 0, throttle: 0, drift: false }));
  assert.equal(k.grounded, 1);
  assert.equal(k.offroad, 0);
  assert.ok(Math.abs(k.y - s.y) < 0.2, `y=${k.y}`);
});

// Steer towards the centreline a few samples ahead — enough of a driver to stay on the road.
const autopilot = (k: KartState): KartInput => {
  let best = 0, bestD = Infinity;
  track.samples.forEach((s, i) => { const d = (s.x - k.x) ** 2 + (s.z - k.z) ** 2; if (d < bestD) { bestD = d; best = i; } });
  const t = track.samples[(best + 4) % track.samples.length];
  const diff = Math.atan2(Math.sin(Math.atan2(t.x - k.x, t.z - k.z) - k.yaw), Math.cos(Math.atan2(t.x - k.x, t.z - k.z) - k.yaw));
  return { steer: Math.max(-1, Math.min(1, -diff * 3)), throttle: 1, drift: false };
};

test('an autopilot lap stays on the road near top speed', () => {
  const k = newKart(spawnPoint(track, 0));
  let offroadTicks = 0, topSpeed = 0;
  for (let i = 0; i < 60 * 30; i++) {
    stepKart(k, autopilot(k), track);
    offroadTicks += k.offroad;
    topSpeed = Math.max(topSpeed, kartSpeed(k));
  }
  assert.ok(topSpeed > KART.maxSpeed * 0.85 && topSpeed < KART.maxSpeed * 1.05, `top=${topSpeed}`);
  assert.ok(offroadTicks < 60, `offroad=${offroadTicks}`); // the autopilot clips a few inside kerbs
});

test('holding a drift charges a tier and releasing it boosts', () => {
  // Open grass well away from the track, already moving; offroad slowdown disabled to isolate the drift.
  const saved = { ...KART };
  KART.offroadMax = KART.maxSpeed; KART.offroadDrag = 0;
  const k = newKart({ x: 300, y: 0, z: 300, yaw: 0 });
  k.vz = 20;
  drive(5, () => ({ steer: 0, throttle: 1, drift: false }), k);
  drive(100, () => ({ steer: 1, throttle: 1, drift: true }), k);
  assert.ok(driftTier(k) >= 1, `charge=${k.driftCharge}`);
  drive(1, () => gas, k);
  assert.ok(k.boostTime > 0);
  assert.equal(k.driftDir, 0);
  Object.assign(KART, saved);
});

const distToCentreline = (x: number, z: number) => Math.min(...track.samples.map((a, i) => {
  const b = track.samples[(i + 1) % track.samples.length];
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}));

test('karts cannot drive through the outer wall', () => {
  // Fire a kart sideways at both edges all round the loop: it either leaves via the open infield
  // (offroad) or is stopped by the wall within the road's half-width.
  for (let i = 0; i < track.samples.length; i += 10) {
    for (const side of [-1, 1]) {
      const s = track.samples[i];
      const k = newKart({ ...s, yaw: s.yaw + side * Math.PI / 2 });
      k.vx = Math.sin(k.yaw) * 30; k.vz = Math.cos(k.yaw) * 30;
      drive(60, () => ({ steer: 0, throttle: 1, drift: false }), k);
      if (k.offroad || k.y < s.y - 1) continue;
      const d = distToCentreline(k.x, k.z);
      assert.ok(d < GREYBOX.width / 2, `sample ${i} side ${side}: d=${d}`);
    }
  }
});

test('driving along the road edges never snags on the barrier or embankment', () => {
  // Regression: walls just beyond the kart's radius used to pull it in and reflect its velocity.
  const snags: string[] = [];
  track.samples.forEach((s, i) => {
    if (i % 3) return;
    for (const off of [-6.5, -5, 5, 6.5]) {
      const k = newKart({ x: s.x - Math.cos(s.yaw) * off, y: s.y + 0.2, z: s.z + Math.sin(s.yaw) * off, yaw: s.yaw });
      drive(10, () => ({ steer: 0, throttle: 0, drift: false }), k);
      if (k.offroad) continue;
      k.vx = Math.sin(s.yaw) * 22; k.vz = Math.cos(s.yaw) * 22;
      let minV = Infinity;
      for (let t = 0; t < 45; t++) { stepKart(k, gas, track); minV = Math.min(minV, kartSpeed(k)); }
      if (minV < 8) snags.push(`sample ${i} offset ${off}: speed fell to ${minV.toFixed(1)}`);
    }
  });
  assert.deepEqual(snags, []);
});

test('clampInput rejects garbage from the wire', () => {
  assert.deepEqual(clampInput({ steer: 9, throttle: NaN } as any), { steer: 1, throttle: 0, drift: false });
  assert.deepEqual(clampInput(undefined), { steer: 0, throttle: 0, drift: false });
});
