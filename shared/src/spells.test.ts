import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KART, newKart, stepKart, kartSpeed, type KartState } from './kart.ts';
import { MANA, SPELLS, NO_CAST, cooldownOf, spawnEffect, stepEffects, hitKart, type Effect } from './spells.ts';
import { createTrack, spawnPoint, GROUND_Y } from './track.ts';
import { GREYBOX } from './tracks.ts';

const track = createTrack(GREYBOX);
const slot = (id: string) => SPELLS.findIndex(s => s.id === id);
const idle = (cast = NO_CAST) => ({ steer: 0, throttle: 0, drift: false, cast });
const settled = () => {
  const k = newKart(spawnPoint(track, 0));
  for (let i = 0; i < 10; i++) stepKart(k, idle(), track);
  return k;
};

test('mana regenerates up to the cap, faster with the catch-up multiplier', () => {
  const k = settled();
  k.mana = 0;
  for (let i = 0; i < 60; i++) stepKart(k, idle(), track);
  assert.ok(Math.abs(k.mana - MANA.regen) < 0.2, `mana=${k.mana}`);
  k.mana = 0; k.manaRegenMul = 1.5;
  for (let i = 0; i < 60; i++) stepKart(k, idle(), track);
  assert.ok(Math.abs(k.mana - MANA.regen * 1.5) < 0.2, `mana=${k.mana}`);
  for (let i = 0; i < 60 * 20; i++) stepKart(k, idle(), track);
  assert.equal(k.mana, MANA.max);
});

test('casting spends mana and starts the cooldown; no mana or cooldown means no cast', () => {
  const k = settled();
  k.mana = 100;
  const smite = slot('smite');
  assert.equal(stepKart(k, idle(smite), track)?.id, 'smite');
  assert.ok(Math.abs(k.mana - (100 - SPELLS[smite].cost)) < 0.5);
  assert.ok(cooldownOf(k, smite) > 0);
  assert.equal(stepKart(k, idle(smite), track), null, 'blocked by cooldown');
  k.mana = 5;
  assert.equal(stepKart(k, idle(slot('haste')), track), null, 'blocked by mana');
});

test('haste boosts and ward blocks one hit', () => {
  const k = settled();
  k.mana = 100;
  stepKart(k, idle(slot('haste')), track);
  assert.ok(k.boostTime > 1);
  assert.equal(k.boostTier, 0, 'a Haste boost is not a drift tier');
  stepKart(k, idle(slot('ward')), track);
  assert.ok(k.wardTime > 0);
  assert.equal(hitKart(k), 'warded');
  assert.equal(k.stunTime, 0);
  assert.equal(hitKart(k), 'stunned');
});

test('a stunned kart loses control and speed, then recovers', () => {
  const k = settled();
  for (let i = 0; i < 90; i++) stepKart(k, { steer: 0, throttle: 1, drift: false }, track);
  const before = kartSpeed(k), yaw = k.yaw;
  hitKart(k);
  for (let i = 0; i < 30; i++) stepKart(k, { steer: 1, throttle: 1, drift: false, cast: 0 }, track);
  assert.ok(kartSpeed(k) < before * 0.7, `speed ${before} → ${kartSpeed(k)}`);
  assert.ok(Math.abs(k.yaw - yaw) < 0.05, 'no steering while stunned');
  for (let i = 0; i < 120; i++) stepKart(k, { steer: 0, throttle: 1, drift: false }, track);
  assert.equal(k.stunTime, 0);
  assert.ok(kartSpeed(k) > before * 0.7, 'drives again after the stun');
});

const kartAhead = (from: KartState, metres: number) => {
  const k = newKart({ x: from.x + Math.sin(from.yaw) * metres, y: from.y, z: from.z + Math.cos(from.yaw) * metres, yaw: from.yaw });
  for (let i = 0; i < 10; i++) stepKart(k, idle(), track);
  return k;
};

test('a smite flies forward and stuns the kart ahead, not its caster', () => {
  const caster = settled(), target = kartAhead(caster, 25);
  const e = spawnEffect(1, SPELLS[slot('smite')], 'me', caster)!;
  const effects: Effect[] = [e];
  const karts: [string, KartState][] = [['me', caster], ['them', target]];
  let dead = new Set<Effect>();
  for (let i = 0; i < 60 && !dead.size; i++) dead = stepEffects(effects, karts, track, 1 / 60);
  assert.ok(dead.has(e), 'smite should be used up');
  assert.ok(target.stunTime > 0, 'target stunned');
  assert.equal(caster.stunTime, 0, 'caster unharmed');
});

test('a smite that misses dies on the wall or expires', () => {
  const caster = settled();
  caster.yaw += Math.PI / 2; // aim across the track at a wall or off the edge
  const e = spawnEffect(1, SPELLS[slot('smite')], 'me', caster)!;
  let dead = new Set<Effect>();
  for (let i = 0; i < 60 * MANA.smite.life + 2 && !dead.size; i++) dead = stepEffects([e], [['me', caster]], track, 1 / 60);
  assert.ok(dead.has(e));
});

// Open ground away from the track, so walls don't get in the way of homing tests.
const onGrass = (x: number, z: number) => {
  const k = newKart({ x, y: GROUND_Y, z, yaw: 0 });
  const saved = KART.rescueDistance; // a test bench far from the road: don't let the crows carry it off
  KART.rescueDistance = Infinity;
  for (let i = 0; i < 10; i++) stepKart(k, idle(), track);
  KART.rescueDistance = saved;
  return k;
};
const fly = (e: Effect, karts: [string, KartState][], seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) if (stepEffects([e], karts, track, 1 / 60).size) return true;
  return false;
};

test('smite homes onto a kart slightly off its line', () => {
  const caster = onGrass(300, 300), target = onGrass(308, 330); // ~15° off the nose, 31 m away
  const e = spawnEffect(1, SPELLS[slot('smite')], 'me', caster)!;
  assert.ok(fly(e, [['me', caster], ['them', target]], 2), 'should connect');
  assert.ok(target.stunTime > 0);
});

test('smite ignores karts well outside its cone, and never homes on its caster', () => {
  const caster = onGrass(300, 300), side = onGrass(330, 305); // ~80° off the nose
  const e = spawnEffect(1, SPELLS[slot('smite')], 'me', caster)!;
  fly(e, [['me', caster], ['them', side]], 0.5);
  assert.equal(e.target, '');
  assert.ok(Math.abs(e.vx) < 1e-9, 'flies straight');
  assert.equal(side.stunTime, 0);
});

test('smite turns at a limited rate, so a sharp dodge can escape it', () => {
  const caster = onGrass(300, 300), target = onGrass(306, 316); // ~20° off, very close: needs a hard turn
  const e = spawnEffect(1, SPELLS[slot('smite')], 'me', caster)!;
  e.target = 'them';
  stepEffects([e], [['me', caster], ['them', target]], track, 1 / 60);
  const turned = Math.atan2(e.vx, e.vz);
  assert.ok(turned > 0 && turned <= MANA.smite.turnRate / 60 + 1e-9, `turned ${turned} rad in one tick`);
});

test('a snare arms, then stuns whoever drives over it', () => {
  const caster = settled();
  const e = spawnEffect(1, SPELLS[slot('snare')], 'me', caster)!;
  const victim = newKart({ x: e.x, y: e.y, z: e.z, yaw: 0 });
  let dead = stepEffects([e], [['them', victim]], track, 1 / 60);
  assert.equal(dead.size, 0, 'not armed yet');
  for (let i = 0; i < 60 && !dead.size; i++) dead = stepEffects([e], [['them', victim]], track, 1 / 60);
  assert.ok(dead.has(e) && victim.stunTime > 0);
});

// --- After a spin-out: a grace period, so nobody gets stun-locked ---
test('a kart that just spun out cannot be hit again until its grace runs out', () => {
  const k = settled();
  assert.equal(hitKart(k), 'stunned');
  assert.ok(k.graceTime > MANA.stunTime, 'grace outlasts the spin');
  // A second smite straight at it during the grace: passes harmlessly through.
  const caster = settled(); caster.yaw = k.yaw;
  Object.assign(caster, { x: k.x - Math.sin(k.yaw) * 20, z: k.z - Math.cos(k.yaw) * 20 });
  const stunBefore = k.stunTime;
  const e = spawnEffect(1, SPELLS[slot('smite')], 'me', caster)!;
  for (let i = 0; i < 30; i++) stepEffects([e], [['me', caster], ['them', k]], track, 1 / 60);
  assert.ok(k.stunTime <= stunBefore, 'not stunned again');
  // Tick the grace away; then it can be hit.
  for (let i = 0; i < 60 * (MANA.stunTime + MANA.grace) + 2; i++) stepKart(k, idle(), track);
  assert.equal(k.graceTime, 0);
  assert.equal(hitKart(k), 'stunned');
});

test('a snare waits out a kart in its grace period, then catches it', () => {
  const caster = settled();
  const e = spawnEffect(1, SPELLS[slot('snare')], 'me', caster)!;
  const victim = newKart({ x: e.x, y: e.y, z: e.z, yaw: 0 });
  victim.graceTime = 0.5;
  let dead = new Set<Effect>();
  for (let i = 0; i < 60 && !dead.size; i++) dead = stepEffects([e], [['them', victim]], track, 1 / 60);
  assert.equal(dead.size, 0, 'the snare stays armed');
  assert.equal(victim.stunTime, 0);
  victim.graceTime = 0;
  dead = stepEffects([e], [['them', victim]], track, 1 / 60);
  assert.ok(dead.has(e) && victim.stunTime > 0, 'caught once the grace is over');
});

test('a homing smite ignores a kart in its grace period', () => {
  const caster = onGrass(300, 300), target = onGrass(308, 330); // the kart the homing test locks on to
  target.graceTime = 2;
  const e = spawnEffect(1, SPELLS[slot('smite')], 'me', caster)!;
  fly(e, [['me', caster], ['them', target]], 1);
  assert.equal(e.target, '');
  assert.equal(target.stunTime, 0);
});
