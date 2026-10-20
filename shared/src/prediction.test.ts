import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyKart, newKart, resolveBumps, stepKart, type KartState } from './kart.ts';
import { Predictor, type SeqInput } from './prediction.ts';
import { createTrack, spawnPoint } from './track.ts';
import { GREYBOX } from './tracks.ts';

const track = createTrack(GREYBOX);

// Mirrors RaceRoom: FIFO queue, one input per tick (up to 3 when backlogged), wait when empty.
function simulate(latency: (t: number) => number, ticks = 900) {
  const server = newKart(spawnPoint(track, 0));
  const predictor = new Predictor(server, track);
  const toServer: { at: number; input: SeqInput }[] = [];
  const toClient: { at: number; s: KartState; ack: number }[] = [];
  let ack = 0, maxErr = 0, lastOut = 0, lastIn = 0;
  for (let t = 0; t < ticks; t++) {
    const input = predictor.step({ steer: Math.sin(t / 50), throttle: 1, drift: t % 240 > 150 });
    lastOut = Math.max(lastOut, t + latency(t)); // a websocket delivers in order
    toServer.push({ at: lastOut, input });

    const ready = toServer.filter(m => m.at <= t).length;
    for (let n = ready > 3 ? 3 : 1; n > 0 && toServer.length && toServer[0].at <= t; n--) {
      const m = toServer.shift()!;
      stepKart(server, m.input, track);
      ack = m.input.seq;
    }

    if (t % 2 === 0) { // 30 Hz patches
      lastIn = Math.max(lastIn, t + latency(t));
      toClient.push({ at: lastIn, s: copyKart(newKart(server), server), ack });
    }
    while (toClient.length && toClient[0].at <= t) {
      const m = toClient.shift()!;
      const e = predictor.reconcile(m.s, m.ack);
      maxErr = Math.max(maxErr, Math.hypot(e.x, e.y, e.z));
    }
  }
  return maxErr;
}

test('prediction never needs correcting on a steady connection', () => {
  assert.ok(simulate(() => 6) < 1e-9);
});

test('prediction never needs correcting with jitter and stalls', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // 3–10 ticks each way, with an occasional 20-tick stall.
  assert.ok(simulate(t => 3 + Math.floor(rand() * 8) + (t % 300 === 0 ? 20 : 0)) < 1e-9);
});

test('a server-side change is corrected and the replay keeps later inputs', () => {
  const start = newKart(spawnPoint(track, 0));
  const p = new Predictor(start, track);
  for (let i = 0; i < 10; i++) p.step({ steer: 0, throttle: 1, drift: false });
  const server = copyKart(newKart(start), start);
  for (let i = 0; i < 5; i++) stepKart(server, { steer: 0, throttle: 1, drift: false }, track);
  server.x += 1; // e.g. a bump the client didn't see
  const err = p.reconcile(server, 5);
  assert.ok(Math.abs(err.x + 1) < 0.05, `err.x=${err.x}`);
});

const at = (x: number, z: number, vx = 0, vz = 0, y = 0): KartState => Object.assign(newKart({ x, y, z, yaw: 0 }), { vx, vz });

test('overlapping karts are pushed apart', () => {
  const a = at(0, 0), b = at(0.5, 0);
  resolveBumps([a, b]);
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) >= 2 - 1e-9);
});

test('a head-on bump bounces both karts back', () => {
  const a = at(0, 0, 10), b = at(1.8, 0, -10);
  resolveBumps([a, b]);
  assert.ok(a.vx < 0 && b.vx > 0, `a.vx=${a.vx} b.vx=${b.vx}`);
  assert.ok(Math.abs(a.vx + b.vx) < 1e-9); // momentum conserved
});

test('karts at different heights pass over each other', () => {
  const a = at(0, 0), b = at(0.5, 0, 0, 0, 4);
  resolveBumps([a, b]);
  assert.equal(b.x, 0.5);
});
