// Client-side prediction for the local kart: step locally on every input, and when the server reports
// its authoritative state plus the last input seq it applied, rewind to that state and replay the rest.
import { copyKart, newKart, stepKart, type KartInput, type KartState } from './kart.ts';
import type { Spell } from './spells.ts';
import type { Track } from './track.ts';

export interface SeqInput extends KartInput { seq: number }

const MAX_PENDING = 180; // 3 s at 60 Hz; older inputs the server never acked are dropped

export class Predictor {
  readonly state: KartState;
  private pending: SeqInput[] = [];
  private seq = 0;
  /** Spell cast by the most recent step() (not by replays), for cast VFX. */
  lastCast: Spell | null = null;

  constructor(start: KartState, private track: Track) {
    this.state = copyKart(newKart(start), start);
  }

  /** Advance one fixed step; returns the input stamped with its seq, ready to send. */
  step(input: KartInput): SeqInput {
    const stamped = { ...input, seq: ++this.seq };
    this.lastCast = stepKart(this.state, stamped, this.track);
    this.pending.push(stamped);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return stamped;
  }

  /**
   * Rewind to the server's state at input `ack` and replay newer inputs.
   * Returns how far the predicted position/heading moved, so the renderer can blend the correction out.
   */
  reconcile(server: KartState, ack: number) {
    const bx = this.state.x, by = this.state.y, bz = this.state.z, byaw = this.state.yaw;
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
    copyKart(this.state, server);
    for (const input of this.pending) stepKart(this.state, input, this.track);
    return { x: bx - this.state.x, y: by - this.state.y, z: bz - this.state.z, yaw: byaw - this.state.yaw };
  }
}
