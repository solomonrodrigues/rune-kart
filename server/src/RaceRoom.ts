import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, type } from '@colyseus/schema';
import { MAX_PLAYERS } from 'shared/constants';
import { DT, stepKart, clampInput, newKart, resolveBumps, type KartState } from 'shared/kart';
import type { SeqInput } from 'shared/prediction';
import { createTrack, spawnPoint, type Track } from 'shared/track';
import { GREYBOX } from 'shared/tracks';

// Mirrors KartState field-for-field so stepKart can run directly on the synced object.
export class Kart extends Schema implements KartState {
  @type('number') x = 0; @type('number') y = 0; @type('number') z = 0;
  @type('number') vx = 0; @type('number') vy = 0; @type('number') vz = 0;
  @type('number') yaw = 0;
  @type('number') nx = 0; @type('number') ny = 1; @type('number') nz = 0;
  @type('number') grounded = 0;
  @type('number') offroad = 0;
  @type('number') driftDir = 0;
  @type('number') driftCharge = 0;
  @type('number') driftHeld = 0;
  @type('number') boostTime = 0;
  @type('number') color = 0xffffff;
  @type('number') ack = 0; // last input seq applied — the owning client replays everything after it
}

export class RaceState extends Schema {
  @type({ map: Kart }) karts = new MapSchema<Kart>();
}

const QUEUE_MAX = 20;     // ~330 ms of inputs; beyond that the oldest are dropped
const MAX_IDLE_TICKS = 15; // after this long with no input, coast the kart (unacked) so it still slows down

export class RaceRoom extends Room<RaceState> {
  maxClients = MAX_PLAYERS;
  private queues = new Map<string, SeqInput[]>();
  private idle = new Map<string, number>();
  private slots = new Map<string, number>(); // grid position per session
  private track!: Track;
  private acc = 0;

  onCreate() {
    this.track = createTrack(GREYBOX);
    this.setState(new RaceState());
    this.setPatchRate(1000 / Number(process.env.PATCH_HZ || 30));
    this.onMessage('input', (client, msg: Partial<SeqInput>) => {
      const kart = this.state.karts.get(client.sessionId);
      const q = this.queues.get(client.sessionId);
      const seq = Number(msg?.seq);
      if (!kart || !q || !Number.isInteger(seq)) return;
      const last = q.length ? q[q.length - 1].seq : kart.ack;
      if (seq <= last) return; // stale or duplicate
      q.push({ ...clampInput(msg), seq });
      if (q.length > QUEUE_MAX) q.shift();
    });
    this.setSimulationInterval(ms => {
      this.acc = Math.min(this.acc + ms / 1000, 0.25); // fixed-step sim, whatever the timer jitter
      while (this.acc >= DT) { this.tick(); this.acc -= DT; }
    }, DT * 1000);
  }

  onJoin(client: Client) {
    const used = new Set(this.slots.values());
    let slot = 0;
    while (used.has(slot)) slot++;
    this.slots.set(client.sessionId, slot);
    this.queues.set(client.sessionId, []);
    const kart = Object.assign(new Kart(), newKart(spawnPoint(this.track, slot)));
    kart.color = Math.floor(Math.random() * 0xffffff);
    this.state.karts.set(client.sessionId, kart);
  }

  onLeave(client: Client) {
    this.state.karts.delete(client.sessionId);
    for (const m of [this.queues, this.idle, this.slots]) m.delete(client.sessionId);
  }

  private tick() {
    this.state.karts.forEach((kart, id) => {
      const q = this.queues.get(id)!;
      if (q.length) {
        // One input per tick normally; after a stall, drain the backlog faster so latency doesn't stick.
        for (let n = q.length > 3 ? 3 : 1; n > 0 && q.length; n--) {
          const input = q.shift()!;
          stepKart(kart, input, this.track, DT);
          kart.ack = input.seq;
        }
        this.idle.delete(id);
      } else {
        // Input is late: wait for it rather than guess, so every predicted step is applied exactly once.
        const idle = (this.idle.get(id) ?? 0) + 1;
        this.idle.set(id, idle);
        if (idle > MAX_IDLE_TICKS) stepKart(kart, { steer: 0, throttle: 0, drift: false }, this.track, DT);
      }
    });
    resolveBumps([...this.state.karts.values()]);
  }
}
