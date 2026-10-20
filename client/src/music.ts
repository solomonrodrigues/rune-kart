// The score, synthesised live: the Hollow Hymn (menu and lobby), Rune Gallop (racing), Blood Moon (the final
// lap) and a Requiem (results, then back to the Hymn). All in D harmonic minor, built from a few instruments —
// a drone, a formant "aah" choir, a tolling bell, war drums, a plucky bass, a harpsichord-ish pluck and a brass
// swell — through a generated cathedral reverb. A cue change waits for the next bar, so the beat never breaks.

export type Cue = 'hymn' | 'gallop' | 'blood' | 'requiem';

const MUSIC_LEVEL = 0.6; // as auditioned, against the game's own engine level

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** A voice: the song's dry fader and its reverb send. */
interface Voice { out: GainNode; wet: GainNode }

interface Chord { choir: number[]; bass: number; arp: number[] }
// Choir voicings (MIDI), bass roots and arpeggios for the loop Dm – B♭ – Gm – A (A major: the harmonic-minor C♯).
const CHORDS: Chord[] = [
  { choir: [62, 65, 69], bass: 38, arp: [74, 77, 81, 77] },
  { choir: [58, 62, 65], bass: 34, arp: [70, 74, 77, 74] },
  { choir: [62, 67, 70], bass: 31, arp: [67, 70, 74, 70] },
  { choir: [61, 64, 69], bass: 33, arp: [69, 73, 76, 73] },
];
const lift = (c: Chord, k: number): Chord => ({ choir: c.choir.map(m => m + k), bass: c.bass + k, arp: c.arp.map(m => m + k) });

interface Song {
  bpm: number;
  hold?: (v: Voice) => (() => void)[]; // held layers (drones), started with the song; returns their stops
  bar: (v: Voice, t: number, i: number, beat: number) => void; // schedule bar i, starting at time t
  once?: { seconds: number; then: Cue }; // a one-shot that hands over to another cue
  free?: boolean; // no beat to keep: hand over at once rather than on the next bar
}

export class Music {
  private bus: GainNode;
  private duckGain: GainNode;
  private reverb: ConvolverNode;
  private noise: AudioBuffer;
  private playing: { cue: Cue; v: Voice; holds: (() => void)[]; next: number; i: number; started: number; stopAt?: number } | null = null;
  private queued: Cue | null | undefined; // undefined: no change pending; null: fade to silence
  private requested: Cue | null | undefined; // the last cue asked for: only a change of request does anything
  private timer: number;
  private songs: Record<Cue, Song>;

  constructor(private ctx: AudioContext, out: AudioNode, private enabled: boolean, private volume = 1) {
    this.bus = ctx.createGain();
    this.bus.gain.value = this.level();
    this.duckGain = ctx.createGain();
    this.bus.connect(this.duckGain).connect(out);
    // A cathedral-ish reverb: three seconds of decaying noise as the impulse response.
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.reverb.buffer = ir;
    this.reverb.connect(this.bus);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.songs = this.score();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private level() { return this.enabled ? MUSIC_LEVEL * this.volume : 0; }
  setEnabled(on: boolean) { this.enabled = on; this.bus.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.3); }
  setVolume(v: number) { this.volume = v; this.bus.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05); }

  /** Dip the music under a big sound effect (a boost, an impact), then let it swell back. */
  duck(depth = 0.5) {
    const g = this.duckGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(depth, t + 0.05);
    g.linearRampToValueAtTime(1, t + 0.7);
  }

  /** Switch to `cue` (or silence) at the next bar of whatever's playing. */
  set(cue: Cue | null) {
    if (cue === this.requested) return; // asked for every frame; a finished one-shot mustn't restart
    this.requested = cue;
    if (cue === (this.playing?.cue ?? null)) { this.queued = undefined; return; } // already playing it
    this.queued = cue;
    if (!this.playing) this.begin(cue, this.ctx.currentTime + 0.1);
    else if (this.songs[this.playing.cue].free) { this.retire(this.playing, this.ctx.currentTime); this.begin(cue, this.ctx.currentTime + 0.05); }
  }

  private begin(cue: Cue | null, at: number) {
    this.queued = undefined;
    if (!cue) { this.playing = null; return; }
    const ctx = this.ctx, v: Voice = { out: ctx.createGain(), wet: ctx.createGain() };
    v.out.gain.value = 0;
    v.out.gain.setTargetAtTime(1, at, 0.25); // fade in
    v.out.connect(this.bus);
    v.wet.connect(this.reverb);
    const song = this.songs[cue];
    this.playing = { cue, v, holds: song.hold?.(v) ?? [], next: at, i: 0, started: at };
  }

  private schedule() {
    const p = this.playing, t = this.ctx.currentTime;
    if (!p) return;
    const song = this.songs[p.cue];
    if (song.once && this.queued === undefined && t > p.started + song.once.seconds - 0.4) this.queued = song.once.then;
    const beat = 60 / song.bpm;
    while (p.next < t + 0.3) {
      if (this.queued !== undefined) { // hand over on this bar line: fade this song, start the next on the beat
        this.retire(p, p.next);
        this.begin(this.queued, p.next);
        return;
      }
      song.bar(p.v, p.next, p.i++, beat);
      p.next += beat * 4;
    }
  }

  private retire(p: NonNullable<Music['playing']>, at: number) {
    p.holds.forEach(stop => stop());
    for (const g of [p.v.out, p.v.wet]) g.gain.setTargetAtTime(0, at, 0.35);
    setTimeout(() => { p.v.out.disconnect(); p.v.wet.disconnect(); }, (at - this.ctx.currentTime + 4) * 1000);
  }

  dispose() { clearInterval(this.timer); }

  // ---------- Instruments ----------
  private env(g: GainNode, t: number, attack: number, peak: number, hold: number, release: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return t + attack + hold + release;
  }
  private route(node: AudioNode, v: Voice, wet: number) {
    node.connect(v.out);
    const s = this.ctx.createGain();
    s.gain.value = wet;
    node.connect(s).connect(v.wet);
  }
  private osc(type: OscillatorType, f: number, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    return o;
  }

  /** A held, slowly breathing drone. Returns its stop. */
  private drone(v: Voice, notes: number[], level: number) {
    const ctx = this.ctx, lp = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = this.osc('sine', 0.07), depth = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 2;
    depth.gain.value = 160; lfo.connect(depth).connect(lp.frequency);
    g.gain.value = 0; g.gain.setTargetAtTime(level, ctx.currentTime, 1.5);
    const oscs = notes.flatMap(m => [-7, 7].map(d => { const o = this.osc('sawtooth', mtof(m), d); o.connect(lp); return o; }));
    const sub = this.osc('sine', mtof(notes[0] - 12)), sg = ctx.createGain();
    sg.gain.value = 0.6; sub.connect(sg).connect(g);
    lp.connect(g);
    this.route(g, v, 0.5);
    [...oscs, sub, lfo].forEach(o => o.start());
    return () => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.4); [...oscs, sub, lfo].forEach(o => o.stop(ctx.currentTime + 2)); };
  }

  /** A wordless "aah" choir chord: detuned saws through two vowel formants, with vibrato. */
  private choir(v: Voice, t: number, notes: number[], dur: number, level: number, wet = 0.6) {
    const ctx = this.ctx;
    for (const m of notes) {
      const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), g = ctx.createGain(), sum = ctx.createGain();
      f1.type = f2.type = 'bandpass'; f1.frequency.value = 720; f1.Q.value = 5; f2.frequency.value = 1150; f2.Q.value = 7;
      sum.connect(f1).connect(g); sum.connect(f2).connect(g);
      const end = this.env(g, t, Math.min(1.4, dur * 0.4), level, Math.max(0, dur - 2.2), 1.6);
      const vib = this.osc('sine', 5.2), vd = ctx.createGain();
      vd.gain.value = 6; vib.connect(vd);
      for (const d of [-10, 0, 10]) { const o = this.osc('sawtooth', mtof(m), d); vd.connect(o.detune); o.connect(sum); o.start(t); o.stop(end + 0.1); }
      vib.start(t); vib.stop(end + 0.1);
      this.route(g, v, wet);
    }
  }

  /** A tolling bell: inharmonic partials with long decays, mostly reverb. */
  private bell(v: Voice, t: number, m: number, level: number) {
    for (const [r, a, d] of [[1, 1, 6], [2, 0.5, 4], [2.76, 0.4, 3], [5.4, 0.22, 1.6], [8.93, 0.12, 0.8]]) {
      const o = this.osc('sine', mtof(m) * r), g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level * a, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); this.route(g, v, 0.9); o.start(t); o.stop(t + d + 0.1);
    }
  }

  /** A war drum: a pitch-dropping thud with a little skin noise. */
  private drum(v: Voice, t: number, from: number, to: number, decay: number, level: number) {
    const ctx = this.ctx, o = this.osc('sine', from), g = ctx.createGain();
    o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
    this.env(g, t, 0.003, level, 0, decay); o.connect(g); this.route(g, v, 0.35); o.start(t); o.stop(t + decay + 0.1);
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = this.noise; f.type = 'lowpass'; f.frequency.value = 1400;
    this.env(ng, t, 0.002, level * 0.25, 0, 0.06); n.connect(f).connect(ng); this.route(ng, v, 0.2); n.start(t, Math.random()); n.stop(t + 0.1);
  }

  /** A plucky low bass note. */
  private bass(v: Voice, t: number, m: number, dur: number, level: number) {
    const ctx = this.ctx, o = this.osc('sawtooth', mtof(m)), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    this.env(g, t, 0.005, level, dur * 0.4, dur * 0.6); o.connect(lp).connect(g); this.route(g, v, 0.1); o.start(t); o.stop(t + dur + 0.1);
  }

  /** A harpsichord-ish pluck: bright, quickly darkening. */
  private harp(v: Voice, t: number, m: number, level: number) {
    const ctx = this.ctx, a = this.osc('sawtooth', mtof(m)), b = this.osc('square', mtof(m), 4), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    this.env(g, t, 0.002, level, 0, 0.45); a.connect(lp); b.connect(lp); lp.connect(g); this.route(g, v, 0.35);
    for (const o of [a, b]) { o.start(t); o.stop(t + 0.5); }
  }

  /** A low brass-like swell. */
  private brass(v: Voice, t: number, notes: number[], dur: number, level: number) {
    const ctx = this.ctx;
    for (const m of notes) {
      const lp = ctx.createBiquadFilter(), g = ctx.createGain();
      lp.type = 'lowpass'; lp.Q.value = 1.5; lp.frequency.setValueAtTime(250, t); lp.frequency.exponentialRampToValueAtTime(1500, t + dur * 0.8);
      this.env(g, t, dur * 0.6, level, 0, dur * 0.5);
      for (const d of [-6, 6]) { const o = this.osc('sawtooth', mtof(m), d); o.connect(lp); o.start(t); o.stop(t + dur * 1.2); }
      lp.connect(g); this.route(g, v, 0.4);
    }
  }

  /** The gallop's bar, shared by the race and final-lap cues. */
  private gallopBar(v: Voice, t: number, i: number, beat: number, c: Chord, hard: boolean) {
    if (i % 2 === 0) {
      this.choir(v, t, c.choir, beat * 8, hard ? 0.032 : 0.022);
      if (hard) this.brass(v, t, [c.bass + 12, c.bass + 19], beat * 8, 0.035);
    }
    for (let b = 0; b < 4; b++) {
      const at = t + b * beat;
      // The gallop: an eighth and two sixteenths on every beat, up to the fifth on the last beat.
      for (const [o, len] of [[0, 0.5], [0.5, 0.25], [0.75, 0.25]]) this.bass(v, at + o * beat, b === 3 && o ? c.bass + 7 : c.bass, len * beat, hard ? 0.065 : 0.06);
      if (hard) { this.drum(v, at, 95, 40, 0.55, 0.45); this.drum(v, at + beat / 2, 170, 95, 0.2, 0.18); }
      else if (b % 2 === 0) this.drum(v, at, 95, 42, 0.6, 0.4);
      else this.drum(v, at, 170, 95, 0.22, 0.14);
      for (let s = 0; s < 4; s++) this.harp(v, at + s * beat / 4, c.arp[(b * 4 + s) % 4], 0.022);
    }
  }

  private score(): Record<Cue, Song> {
    return {
      // H1: slow chords breathing over the drone, a bell every 4 bars.
      hymn: {
        bpm: 60, free: true,
        hold: v => [this.drone(v, [38, 45], 0.06)],
        bar: (v, t, i, beat) => {
          const c = CHORDS[[0, 1, 0, 3][Math.floor(i / 2) % 4]];
          if (i % 2 === 0) this.choir(v, t, c.choir, beat * 8, 0.035);
          if (i % 4 === 0) this.bell(v, t + 0.3, 74, 0.07);
        },
      },
      // G1: war drums, galloping bass, harpsichord arpeggios and choir at 100 BPM.
      gallop: { bpm: 100, bar: (v, t, i, beat) => this.gallopBar(v, t, i, beat, CHORDS[Math.floor(i / 2) % 4], false) },
      // B2: the gallop faster, doubled drums, louder choir and brass — lifted a semitone into E♭ minor.
      blood: { bpm: 108, bar: (v, t, i, beat) => this.gallopBar(v, t, i, beat, lift(CHORDS[Math.floor(i / 2) % 4], 1), true) },
      // R2: the cadence Dm – B♭ – A – Dm as rolled harpsichord chords, then the bell; then back to the Hymn.
      requiem: {
        bpm: 60, free: true,
        once: { seconds: 11, then: 'hymn' },
        bar: (v, t, i) => {
          if (i) return;
          ([[CHORDS[0], 0], [CHORDS[1], 1.6], [CHORDS[3], 3.2], [CHORDS[0], 5]] as [Chord, number][]).forEach(([c, at], k) => {
            [...c.choir, c.choir[0] + 12].forEach((m, j) => this.harp(v, t + at + j * 0.07, m, 0.035));
            this.bass(v, t + at, c.bass + 12, k === 3 ? 3 : 1.5, 0.045);
          });
          this.bell(v, t + 5, 74, 0.08);
        },
      },
    };
  }
}
