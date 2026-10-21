import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, type } from '@colyseus/schema';
import { COUNTDOWN_SECONDS, FINISH_GRACE_SECONDS, LAPS, MAX_PLAYERS, RESULTS_SECONDS } from 'shared/constants';
import { DT, stepKart, clampInput, newKart, resolveBumps, type KartState } from 'shared/kart';
import type { SeqInput } from 'shared/prediction';
import { hasFinished, lapOf, startProgress, updateProgress, type Progress } from 'shared/race';
import { MANA, spawnEffect, stepEffects, type Effect, type Spell } from 'shared/spells';
import { Bot, randomProfile } from 'shared/bot';
import { createTrack, spawnPoint, type Track } from 'shared/track';
import { DEFAULT_TRACK, TRACKS, trackDef } from 'shared/tracks';

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
  @type('number') boostTier = 0;
  @type('number') steer = 0;
  @type('number') mana = 0;
  @type('number') manaRegenMul = 1;
  @type('number') cd0 = 0; @type('number') cd1 = 0; @type('number') cd2 = 0; @type('number') cd3 = 0;
  @type('number') stunTime = 0;
  @type('number') wardTime = 0;
  @type('number') graceTime = 0;
  @type('number') offroadTime = 0;
  @type('number') lastRoad = -1;
  @type('number') rescue = 0;
  @type('number') color = 0xffffff;
  @type('number') ack = 0; // last input seq applied — the owning client replays everything after it
  // Race standing. `racing` is false for anyone who joined after the start; they free-drive until the next race.
  @type('boolean') ready = false;
  @type('boolean') racing = false;
  @type('number') lap = 1;
  @type('number') place = 0;
  @type('number') finishTime = -1; // race seconds, -1 until finished
  @type('boolean') bot = false;     // driven by the server, not a player
  @type('string') name = '';
}

export class SpellEffect extends Schema implements Effect {
  @type('number') id = 0;
  @type('string') kind: Effect['kind'] = 'smite';
  @type('string') owner = '';
  @type('number') x = 0; @type('number') y = 0; @type('number') z = 0;
  @type('number') vx = 0; @type('number') vz = 0;
  @type('number') age = 0;
  @type('string') target = '';
}

export class RaceState extends Schema {
  @type({ map: Kart }) karts = new MapSchema<Kart>();
  @type({ map: SpellEffect }) effects = new MapSchema<SpellEffect>();
  @type('string') phase: Phase = 'lobby';
  @type('number') timer = 0; // countdown/results: seconds left; racing: seconds elapsed
  @type('number') laps = Number(process.env.LAPS) || LAPS; // env override for quick test races
  @type('string') track = DEFAULT_TRACK;
  @type('string') host = '';      // session id of the player who runs the lobby (bots, laps)
}

export type Phase = 'lobby' | 'countdown' | 'racing' | 'results';

const IDLE_INPUT = { steer: 0, throttle: 0, drift: false };
// Saturated colours that glow well on runes and banners against the dark world, one per grid slot.
const KART_COLOURS = [0xd8343a, 0x2fbf6f, 0x3a72e0, 0xe8a32a, 0xa456e8, 0x28c4c0, 0xe8508f, 0xe9e0c4];
const BOT_NAMES = ['Grimwald', 'Morwen', 'Thorne', 'Vesper', 'Ashka', 'Bramble', 'Corvin'];
/** Trim, strip control characters, cap the length — names are shown to everyone. */
const cleanName = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) : '';
const QUEUE_MAX = 20;     // ~330 ms of inputs; beyond that the oldest are dropped
const MAX_IDLE_TICKS = 15; // after this long with no input, coast the kart (unacked) so it still slows down

export class RaceRoom extends Room<RaceState> {
  maxClients = MAX_PLAYERS;
  private queues = new Map<string, SeqInput[]>();
  private idle = new Map<string, number>();
  private slots = new Map<string, number>(); // grid position per session
  private progress = new Map<string, Progress>();
  private graceEnd = Infinity; // race time at which unfinished karts are cut off
  private track!: Track;
  private acc = 0;
  private nextEffectId = 1;
  private bots = new Map<string, Bot>();
  private botSeq = 0;
  private lobbyName = 'Rune Kart';

  /**
   * Options come from whoever creates the room: { track, laps, lobby (its name), private }.
   * Everything is validated — it's client input.
   */
  onCreate(options: Record<string, unknown> = {}) {
    this.setState(new RaceState());
    this.state.track = typeof options.track === 'string' && TRACKS[options.track] ? options.track : DEFAULT_TRACK;
    this.track = createTrack(trackDef(this.state.track));
    const laps = Math.round(Number(options.laps));
    if (laps >= 1 && laps <= 9 && !process.env.LAPS) this.state.laps = laps;
    this.lobbyName = cleanName(options.lobby, 32) || 'Rune Kart';
    if (options.private === true) this.setPrivate(true);
    this.syncMeta();
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
    // Lobby, host only: add (+1) or remove (-1) a bot; change the lap count.
    this.onMessage('laps', (client, delta: unknown) => {
      if (this.state.phase !== 'lobby' || client.sessionId !== this.state.host || (delta !== 1 && delta !== -1)) return;
      this.state.laps = Math.max(1, Math.min(9, this.state.laps + delta));
      this.syncMeta();
    });
    this.onMessage('bots', (client, delta: unknown) => {
      if (this.state.phase !== 'lobby' || client.sessionId !== this.state.host) return;
      if (delta === 1 && this.state.karts.size < MAX_PLAYERS) this.addBot();
      if (delta === -1) { const last = [...this.bots.keys()].pop(); if (last) this.removeKart(last); }
    });
    this.onMessage('ready', (client, ready: unknown) => {
      const kart = this.state.karts.get(client.sessionId);
      if (kart && this.state.phase === 'lobby') kart.ready = ready === true;
    });
    this.setSimulationInterval(ms => {
      this.acc = Math.min(this.acc + ms / 1000, 0.25); // fixed-step sim, whatever the timer jitter
      while (this.acc >= DT) { this.tick(); this.acc -= DT; }
    }, DT * 1000);
  }

  onJoin(client: Client, options: Record<string, unknown> = {}) {
    this.queues.set(client.sessionId, []);
    const kart = this.addKart(client.sessionId);
    kart.name = cleanName(options.player, 16) || `Racer ${this.slots.get(client.sessionId)! + 1}`;
    if (!this.state.host) this.state.host = client.sessionId; // first in runs the lobby
  }

  onLeave(client: Client) {
    this.removeKart(client.sessionId);
    if (this.state.host === client.sessionId) {
      // Hand the lobby to the next human, if any.
      this.state.host = [...this.state.karts.entries()].find(([, k]) => !k.bot)?.[0] ?? '';
    }
  }

  /** What the lobby browser shows for this room. */
  private syncMeta() {
    this.setMetadata({ name: this.lobbyName, track: this.state.track, laps: this.state.laps, phase: this.state.phase });
  }

  /** A kart on the next free grid slot. */
  private addKart(id: string) {
    const used = new Set(this.slots.values());
    let slot = 0;
    while (used.has(slot)) slot++;
    this.slots.set(id, slot);
    const kart = Object.assign(new Kart(), newKart(spawnPoint(this.track, slot)));
    kart.lap = 1;
    kart.color = KART_COLOURS[slot % KART_COLOURS.length];
    this.state.karts.set(id, kart);
    return kart;
  }

  private addBot() {
    const id = `bot-${++this.botSeq}`;
    const kart = this.addKart(id);
    Object.assign(kart, { bot: true, ready: true, name: BOT_NAMES[(this.botSeq - 1) % BOT_NAMES.length] }); // bots never hold up the start
    this.bots.set(id, new Bot(randomProfile()));
    this.maxClients = MAX_PLAYERS - this.bots.size;  // bots take player slots
  }

  private removeKart(id: string) {
    this.state.karts.delete(id);
    for (const m of [this.queues, this.idle, this.slots, this.progress, this.bots]) m.delete(id);
    this.maxClients = MAX_PLAYERS - this.bots.size;
  }

  private tick() {
    const frozen = this.state.phase === 'countdown';
    const all = [...this.state.karts.values()];
    this.state.karts.forEach((kart, id) => {
      const bot = this.bots.get(id);
      if (bot) {
        const input = frozen ? IDLE_INPUT : bot.input(kart, this.track, all.filter(o => o !== kart), DT);
        const spell = stepKart(kart, input, this.track, DT);
        if (spell) this.cast(id, kart, spell);
        return;
      }
      const q = this.queues.get(id)!;
      if (q.length) {
        // One input per tick normally; after a stall, drain the backlog faster so latency doesn't stick.
        for (let n = q.length > 3 ? 3 : 1; n > 0 && q.length; n--) {
          const input = q.shift()!;
          // Inputs are still consumed and acked while frozen, so the client's replay stays in step.
          const spell = stepKart(kart, frozen ? IDLE_INPUT : input, this.track, DT);
          if (spell) this.cast(id, kart, spell);
          kart.ack = input.seq;
        }
        this.idle.delete(id);
      } else {
        // Input is late: wait for it rather than guess, so every predicted step is applied exactly once.
        const idle = (this.idle.get(id) ?? 0) + 1;
        this.idle.set(id, idle);
        if (idle > MAX_IDLE_TICKS) stepKart(kart, IDLE_INPUT, this.track, DT);
      }
    });
    resolveBumps([...this.state.karts.values()]);
    const effects = [...this.state.effects.values()];
    for (const dead of stepEffects(effects, [...this.state.karts.entries()], this.track, DT)) {
      this.state.effects.delete(String(dead.id));
    }
    this.updateRace();
  }

  private cast(owner: string, kart: Kart, spell: Spell) {
    const e = spawnEffect(this.nextEffectId++, spell, owner, kart);
    if (!e) return; // self-only spells already applied in the kart step
    if (e.kind === 'snare') {
      // Cap each kart's live traps; the oldest goes first.
      const mine = [...this.state.effects.values()].filter(f => f.kind === 'snare' && f.owner === owner);
      if (mine.length >= MANA.snare.maxPerKart) this.state.effects.delete(String(mine[0].id));
    }
    this.state.effects.set(String(e.id), Object.assign(new SpellEffect(), e));
  }

  private updateRace() {
    const st = this.state;
    const racers = [...st.karts.entries()].filter(([, k]) => k.racing);
    switch (st.phase) {
      case 'lobby':
        { // Start once every human is ready (bots are always ready).
          const humans = [...st.karts.values()].filter(k => !k.bot);
          if (humans.length && humans.every(k => k.ready)) this.startCountdown();
        }
        break;
      case 'countdown':
        st.timer -= DT;
        st.karts.forEach(k => { k.mana = 0; }); // the orb stays empty on the grid: everyone starts the race with none
        if (st.timer <= 0) { st.phase = 'racing'; this.syncMeta(); st.timer = 0; }
        break;
      case 'racing': {
        st.timer += DT;
        for (const [id, k] of racers) {
          if (k.finishTime >= 0) continue;
          const p = this.progress.get(id)!;
          updateProgress(p, this.track, k);
          k.lap = Math.min(lapOf(p, this.track), st.laps);
          if (hasFinished(p, this.track, st.laps)) {
            k.finishTime = st.timer;
            this.graceEnd = Math.min(this.graceEnd, st.timer + FINISH_GRACE_SECONDS);
          }
        }
        this.assignPlaces(racers);
        // Catch-up: trailing karts regenerate mana faster, instead of item-box luck.
        for (const [, k] of racers) k.manaRegenMul = 1 + MANA.catchUp * (k.place - 1) / Math.max(1, racers.length - 1);
        if (!racers.length || racers.every(([, k]) => k.finishTime >= 0) || st.timer >= this.graceEnd) {
          st.phase = 'results'; this.syncMeta();
          st.timer = RESULTS_SECONDS;
        }
        break;
      }
      case 'results':
        st.timer -= DT;
        if (st.timer <= 0) {
          st.phase = 'lobby'; this.syncMeta();
          st.timer = 0;
          st.karts.forEach(k => { k.ready = k.bot; k.racing = false; k.manaRegenMul = 1; });
        }
        break;
    }
  }

  private startCountdown() {
    const st = this.state;
    st.phase = 'countdown'; this.syncMeta();
    st.timer = COUNTDOWN_SECONDS;
    this.graceEnd = Infinity;
    st.effects.clear();
    st.karts.forEach((kart, id) => {
      Object.assign(kart, newKart(spawnPoint(this.track, this.slots.get(id) ?? 0)));
      Object.assign(kart, { ready: false, racing: true, lap: 1, place: 0, finishTime: -1 });
      this.progress.set(id, startProgress(this.track, kart));
    });
    this.assignPlaces([...st.karts.entries()]);
  }

  /** Finished karts by time, then everyone else by distance covered. */
  private assignPlaces(racers: [string, Kart][]) {
    const dist = (id: string) => this.progress.get(id)?.dist ?? -Infinity;
    racers
      .sort(([ia, a], [ib, b]) =>
        (a.finishTime >= 0) !== (b.finishTime >= 0) ? (a.finishTime >= 0 ? -1 : 1)
        : a.finishTime >= 0 ? a.finishTime - b.finishTime
        : dist(ib) - dist(ia))
      .forEach(([, k], i) => { k.place = i + 1; });
  }
}
