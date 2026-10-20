import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot, randomProfile, type BotProfile } from './bot.ts';
import { newKart, stepKart, DT, type KartState } from './kart.ts';
import { hasFinished, startProgress, updateProgress } from './race.ts';
import { SPELLS } from './spells.ts';
import { createTrack, spawnPoint } from './track.ts';
import { GREYBOX } from './tracks.ts';

const track = createTrack(GREYBOX);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const steady: BotProfile = { throttle: 1, lookahead: 4, driftThreshold: 0.5, aggression: 1 };

test('a bot drives a clean lap, drifting for boosts', () => {
  const bot = new Bot(steady, seeded(1));
  const k = newKart(spawnPoint(track, 0));
  k.mana = 0; k.manaRegenMul = 0; // driving only, no spells
  const p = startProgress(track, k);
  let ticks = 0, offroad = 0, boosts = 0, wasBoosting = false;
  for (; ticks < 60 * 60 && !hasFinished(p, track, 1); ticks++) {
    stepKart(k, bot.input(k, track, [], DT), track);
    updateProgress(p, track, k);
    offroad += k.offroad;
    if (k.boostTime > 0 && !wasBoosting) boosts++;
    wasBoosting = k.boostTime > 0;
  }
  assert.ok(hasFinished(p, track, 1), 'should finish the lap');
  assert.ok(ticks / 60 < 35, `lap took ${(ticks / 60).toFixed(1)}s`);
  assert.ok(offroad / ticks < 0.05, `offroad ${(100 * offroad / ticks).toFixed(1)}% of the lap`);
  assert.ok(boosts >= 1, 'should earn at least one drift boost');
});

test('a bot smites a kart ahead of it in range', () => {
  const bot = new Bot(steady, seeded(2));
  const k = newKart(spawnPoint(track, 0));
  for (let i = 0; i < 10; i++) stepKart(k, { steer: 0, throttle: 0, drift: false }, track);
  k.mana = 100;
  const target: KartState = { ...k, x: k.x + Math.sin(k.yaw) * 20, z: k.z + Math.cos(k.yaw) * 20 };
  let cast = -1;
  for (let i = 0; i < 120 && cast < 0; i++) cast = bot.input(k, track, [target], DT).cast ?? -1;
  assert.equal(SPELLS[cast]?.id, 'smite');
});

test('bots differ, so a field of them spreads out', () => {
  const r = seeded(3);
  const a = randomProfile(r), b = randomProfile(r);
  assert.notDeepEqual(a, b);
  for (const p of [a, b]) assert.ok(p.throttle > 0.9 && p.throttle <= 1 && p.aggression >= 0.4 && p.aggression <= 1);
});
