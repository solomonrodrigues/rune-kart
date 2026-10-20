import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newKart, stepKart, kartSpeed, type KartState } from './kart.ts';
import { MANA, SPELLS, NO_CAST, cooldownOf, spawnEffect, stepEffects, hitKart, type Effect } from './spells.ts';
import { createTrack, spawnPoint } from './track.ts';
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
  const bolt = slot('bolt');
  assert.equal(stepKart(k, idle(bolt), track)?.id, 'bolt');
  assert.ok(Math.abs(k.mana - (100 - SPELLS[bolt].cost)) < 0.5);
  assert.ok(cooldownOf(k, bolt) > 0);
  assert.equal(stepKart(k, idle(bolt), track), null, 'blocked by cooldown');
  k.mana = 5;
  assert.equal(stepKart(k, idle(slot('surge')), track), null, 'blocked by mana');
});

test('surge boosts and ward blocks one hit', () => {
  const k = settled();
  k.mana = 100;
  stepKart(k, idle(slot('surge')), track);
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

test('an arcane bolt flies forward and stuns the kart ahead, not its caster', () => {
  const caster = settled(), target = kartAhead(caster, 25);
  const e = spawnEffect(1, SPELLS[slot('bolt')], 'me', caster)!;
  const effects: Effect[] = [e];
  const karts: [string, KartState][] = [['me', caster], ['them', target]];
  let dead = new Set<Effect>();
  for (let i = 0; i < 60 && !dead.size; i++) dead = stepEffects(effects, karts, track, 1 / 60);
  assert.ok(dead.has(e), 'bolt should be used up');
  assert.ok(target.stunTime > 0, 'target stunned');
  assert.equal(caster.stunTime, 0, 'caster unharmed');
});

test('a bolt that misses dies on the wall or expires', () => {
  const caster = settled();
  caster.yaw += Math.PI / 2; // aim across the track at a wall or off the edge
  const e = spawnEffect(1, SPELLS[slot('bolt')], 'me', caster)!;
  let dead = new Set<Effect>();
  for (let i = 0; i < 60 * MANA.bolt.life + 2 && !dead.size; i++) dead = stepEffects([e], [['me', caster]], track, 1 / 60);
  assert.ok(dead.has(e));
});

test('a rune trap arms, then stuns whoever drives over it', () => {
  const caster = settled();
  const e = spawnEffect(1, SPELLS[slot('rune')], 'me', caster)!;
  const victim = newKart({ x: e.x, y: e.y, z: e.z, yaw: 0 });
  let dead = stepEffects([e], [['them', victim]], track, 1 / 60);
  assert.equal(dead.size, 0, 'not armed yet');
  for (let i = 0; i < 60 && !dead.size; i++) dead = stepEffects([e], [['them', victim]], track, 1 / 60);
  assert.ok(dead.has(e) && victim.stunTime > 0);
});
