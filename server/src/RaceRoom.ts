import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, type } from '@colyseus/schema';
import { TICK_HZ, MAX_PLAYERS } from 'shared/constants';
import { stepKart, clampInput, type KartInput } from 'shared/kart';

export class Kart extends Schema {
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') yaw = 0;
  @type('number') speed = 0;
  @type('number') color = 0xffffff;
}

export class RaceState extends Schema {
  @type({ map: Kart }) karts = new MapSchema<Kart>();
}

export class RaceRoom extends Room<RaceState> {
  maxClients = MAX_PLAYERS;
  private inputs = new Map<string, KartInput>();

  onCreate() {
    this.setState(new RaceState());
    this.setPatchRate(1000 / Number(process.env.PATCH_HZ || 30));
    this.onMessage('input', (client, msg: KartInput) => this.inputs.set(client.sessionId, clampInput(msg)));
    this.setSimulationInterval(() => this.tick(1 / TICK_HZ), 1000 / TICK_HZ);
  }

  onJoin(client: Client) {
    const kart = new Kart();
    kart.x = (this.state.karts.size % 4) * 4 - 6; // spread joiners across a grid row
    kart.color = Math.floor(Math.random() * 0xffffff);
    this.state.karts.set(client.sessionId, kart);
  }

  onLeave(client: Client) {
    this.state.karts.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
  }

  // shortcut: fixed dt per interval callback, no accumulator; add one with prediction in milestone 3.
  private tick(dt: number) {
    this.state.karts.forEach((kart, id) => stepKart(kart, this.inputs.get(id) ?? { steer: 0, throttle: 0 }, dt));
  }
}
