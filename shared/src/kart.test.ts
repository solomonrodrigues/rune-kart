import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepKart, clampInput, newKart, driftTier, kartSpeed, KART, type KartInput, type KartState } from './kart.ts';
import { createTrack, spawnPoint, GROUND_Y } from './track.ts';
import { GREYBOX } from './tracks.ts';
import { autopilot as followTrack } from './race.ts';

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

const autopilot = (k: KartState) => followTrack(track, k);

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
  const tier = driftTier(k);
  assert.ok(tier >= 1, `charge=${k.driftCharge}`);
  drive(1, () => gas, k);
  assert.ok(k.boostTime > 0);
  assert.equal(k.boostTier, tier, 'the boost remembers its tier (it colours the flame)');
  assert.equal(k.driftDir, 0);
  Object.assign(KART, saved);
});

const distToCentreline = (x: number, z: number) => Math.min(...track.samples.map((a, i) => {
  const b = track.samples[(i + 1) % track.samples.length];
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}));

// Start a drift at racing speed on open ground (offroad slowdown off) and hold it with a given steer.
function heldDrift(steer: number, ticks: number) {
  const saved = { ...KART };
  Object.assign(KART, { offroadMax: KART.maxSpeed, offroadDrag: 0 });
  const k = newKart({ x: 300, y: GROUND_Y, z: 300, yaw: 0 });
  drive(5, () => ({ steer: 0, throttle: 0, drift: false }), k);
  k.vz = 28;
  drive(1, () => ({ steer: 1, throttle: 1, drift: true }), k);
  let maxSlip = 0;
  for (let t = 0; t < ticks; t++) {
    stepKart(k, { steer, throttle: 1, drift: true }, track);
    const slip = Math.abs(Math.atan2(Math.sin(Math.atan2(k.vx, k.vz) - k.yaw), Math.cos(Math.atan2(k.vx, k.vz) - k.yaw)));
    maxSlip = Math.max(maxSlip, slip);
  }
  Object.assign(KART, saved);
  return { k, maxSlip: maxSlip * 180 / Math.PI };
}

test('a held drift follows the nose and keeps its speed', () => {
  // Regression: low drift grip let the kart slide 30–40° wide and bleed half its speed, flinging it off the road.
  for (const steer of [-1, 0, 1]) {
    const { k, maxSlip } = heldDrift(steer, 90);
    assert.equal(k.driftDir, 1, 'drift should still be held');
    assert.ok(maxSlip < 20, `steer ${steer}: slipped ${maxSlip.toFixed(0)}°`);
    assert.ok(kartSpeed(k) > 28 * 0.8, `steer ${steer}: slowed to ${kartSpeed(k).toFixed(1)}`);
  }
});

test('a drift through a typical corner earns a boost', () => {
  const { k } = heldDrift(0.5, 42); // ~0.7 s
  assert.ok(driftTier(k) >= 1, `charge ${k.driftCharge.toFixed(2)}`);
});

test('releasing a drift points the kart and its boost along the direction of travel', () => {
  // Regression: the boost fired along the over-rotated nose, shoving karts off the inside of the corner.
  const { k } = heldDrift(1, 42);
  drive(1, () => ({ steer: 1, throttle: 1, drift: false }), k);
  assert.ok(k.boostTime > 0, 'should boost');
  const travel = Math.atan2(k.vx, k.vz);
  const off = Math.abs(Math.atan2(Math.sin(travel - k.yaw), Math.cos(travel - k.yaw))) * 180 / Math.PI;
  assert.ok(off < 3, `nose is ${off.toFixed(1)}° off the direction of travel`);
});

test('steering out of a drift nearly straightens it', () => {
  const start = heldDrift(-1, 0).k.yaw;
  const { k } = heldDrift(-1, 60);
  assert.ok(Math.abs(k.yaw - start) < 0.4, `still turned ${(k.yaw - start).toFixed(2)} rad in 1 s`);
});

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
    const h = GREYBOX.width / 2;
    for (const off of [-(h - 0.5), -(h - 2), h - 2, h - 0.5]) {
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
  assert.deepEqual(clampInput({ steer: 9, throttle: NaN } as any), { steer: 1, throttle: 0, drift: false, cast: -1 });
  assert.deepEqual(clampInput(undefined), { steer: 0, throttle: 0, drift: false, cast: -1 });
});
