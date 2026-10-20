import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, type } from '@colyseus/schema';
import { MAX_PLAYERS } from 'shared/constants';
import { DT, stepKart, clampInput, newKart, type KartInput, type KartState } from 'shared/kart';
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
}

export class RaceState extends Schema {
  @type({ map: Kart }) karts = new MapSchema<Kart>();
}

const IDLE: KartInput = { steer: 0, throttle: 0, drift: false };

export class RaceRoom extends Room<RaceState> {
  maxClients = MAX_PLAYERS;
  private inputs = new Map<string, KartInput>();
  private slots = new Map<string, number>(); // grid position per session
  private track!: Track;
  private acc = 0;

  onCreate() {
    this.track = createTrack(GREYBOX);
    this.setState(new RaceState());
    this.setPatchRate(1000 / Number(process.env.PATCH_HZ || 30));
    this.onMessage('input', (client, msg: KartInput) => this.inputs.set(client.sessionId, clampInput(msg)));
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
    const kart = Object.assign(new Kart(), newKart(spawnPoint(this.track, slot)));
    kart.color = Math.floor(Math.random() * 0xffffff);
    this.state.karts.set(client.sessionId, kart);
  }

  onLeave(client: Client) {
    this.state.karts.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.slots.delete(client.sessionId);
  }

  private tick() {
    this.state.karts.forEach((kart, id) => stepKart(kart, this.inputs.get(id) ?? IDLE, this.track, DT));
  }
}
