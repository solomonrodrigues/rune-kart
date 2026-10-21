// All game sound. Recorded CC0 clips (Kenney, see public/sfx/LICENSE.txt) for the boost, spells and hits;
// the engine, the drift, the musical race cues (countdown, laps, finish) and the score (music.ts) are synthesised. Browsers only allow audio after a
// user gesture, so nothing loads or plays until `unlock()` runs from a key press or click.

// Every clip in one place, so swapping a sound is a one-word change.
import { Music, type Cue } from './music';

const CLIPS = ['boost', 'smite', 'snare', 'ward', 'chime', 'wall', 'hit', 'denied'] as const;
type Clip = typeof CLIPS[number];

const MUTE_KEY = 'runekart.muted', MUSIC_KEY = 'runekart.music', VOLUME_KEY = 'runekart.volume', MUSIC_VOLUME_KEY = 'runekart.musicVolume';
/** A remembered 0..1 setting (1 if unset or unreadable). */
const stored = (key: string) => { try { const v = Number(localStorage.getItem(key) ?? 1); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; } catch { return 1; } };
const store = (key: string, v: number) => { try { localStorage.setItem(key, String(v)); } catch { /* not remembered */ } };
const VOLUME = 0.7;
const DRIFT_GAIN = 0.03, SPARK_GAIN = 0.015; // measured: the drift "eee" sits level with the engine; sparks a faint shimmer

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private clips = new Map<Clip, AudioBuffer>();
  private noise!: AudioBuffer;
  private engine?: { tones: OscillatorNode[]; purr: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
  private drift?: { tones: OscillatorNode[]; gain: GainNode; sparks: AudioBufferSourceNode; sparkGain: GainNode };
  private sparkTier = 0; // the drift's current spark colour: 0 none, 1 blue, 2 orange, 3 purple
  muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();
  musicOn = (() => { try { return localStorage.getItem(MUSIC_KEY) !== '0'; } catch { return true; } })();
  volume = stored(VOLUME_KEY);           // the menu's Volume setting, 0..1
  musicVolume = stored(MUSIC_VOLUME_KEY); // and its Music setting
  private music?: Music;
  private cue: Cue | null = null; // wanted even before the audio unlocks, so it starts the moment it does

  /** Call from any user gesture; creates the audio graph and starts loading the clips the first time. */
  unlock = () => {
    if (!this.ctx) this.build();
    if (this.ctx!.state === 'suspended') void this.ctx!.resume();
  };

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* not remembered */ }
    if (this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
    return this.muted;
  }

  private level() { return this.muted ? 0 : VOLUME * this.volume; }

  /** Overall volume, 0..1 (remembered). */
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    store(VOLUME_KEY, this.volume);
    if (this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
  }

  /** Music volume, 0..1, on top of the overall volume (remembered). */
  setMusicVolume(v: number) {
    this.musicVolume = Math.min(1, Math.max(0, v));
    store(MUSIC_VOLUME_KEY, this.musicVolume);
    this.music?.setVolume(this.musicVolume);
  }

  /** K: music on or off (remembered); M still mutes everything. */
  toggleMusic() {
    this.musicOn = !this.musicOn;
    try { localStorage.setItem(MUSIC_KEY, this.musicOn ? '1' : '0'); } catch { /* not remembered */ }
    this.music?.setEnabled(this.musicOn);
    return this.musicOn;
  }

  /** Which piece of the score should play: it changes on the next bar. */
  setMusic(cue: Cue | null) {
    this.cue = cue;
    this.music?.set(cue);
  }

  private build() {
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = this.level();
    // Gentle compression so stacked effects don't clip.
    this.master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    this.music = new Music(ctx, this.master, this.musicOn, this.musicVolume);
    this.music.set(this.cue);
    // A second of white noise for the drift.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const name of CLIPS) {
      fetch(`${import.meta.env.BASE_URL}sfx/${name}.ogg`).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b))
        .then(buf => this.clips.set(name, buf))
        .catch(e => console.warn(`sound ${name} failed to load`, e)); // the game plays on without it
    }
  }

  /** Play a clip once. `rate` shifts pitch and speed together. */
  private play(name: Clip, opts: { gain?: number; rate?: number; delay?: number } = {}) {
    const buf = this.clips.get(name);
    if (!this.ctx || this.muted || !buf) return;
    const { gain = 1, rate = 1, delay = 0 } = opts;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate;
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start(this.ctx.currentTime + delay);
  }


  /**
   * A soft magical impact, `v` 0..1 loud: a low rounded "thoom" sweeping down, a muffled puff of air, and a
   * faint high chime — weighty without any harsh crunch.
   */
  private thoom(v: number) {
    if (!this.ctx || this.muted) return;
    if (v > 0.4) this.music?.duck(1 - 0.5 * v); // a close impact dips the music
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.35);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.35 * v, t + 0.015);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.5);
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = this.noise;
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.3);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.12 * v, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    n.connect(f).connect(ng).connect(this.master);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.4);
    this.tone(1046, 0.5, { gain: 0.03 * v, delay: 0.02 }); this.tone(1568, 0.4, { gain: 0.015 * v, delay: 0.05 });
  }

  /** A short synth tone for the race cues, with a quick attack and exponential decay. */
  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number } = {}) {
    if (!this.ctx || this.muted) return;
    const { type = 'sine', gain = 0.2, delay = 0 } = opts;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /**
   * Per frame: the engine hum follows speed (pitch) and throttle (volume) and revs higher through a boost; the
   * drift "eee" and sparks play while drifting. Pass `active: false` to fade them out (menu, results).
   */
  drive(speed: number, throttle: number, boosting: boolean, drifting: boolean, active = true) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime, s = Math.min(1, Math.abs(speed) / 32), t = Math.max(0, throttle);
    const e = this.engine ??= this.buildEngine();
    // Mario Kart style: pitch glides up with speed, and the throttle revs it a little even from a standstill.
    const f = (60 + s * 130 + t * 20) * (boosting ? 1.12 : 1);
    e.tones.forEach((o, i) => o.frequency.setTargetAtTime(f * (i === 2 ? 2 : 1), now, 0.12));
    e.purr.frequency.setTargetAtTime(f / 2, now, 0.12);
    e.filter.frequency.setTargetAtTime(500 + s * 900 + t * 400, now, 0.12);
    // Quieter at cruise than when pushing, with a little lift in a boost.
    e.gain.gain.setTargetAtTime(active ? 0.015 + t * 0.015 + s * 0.007 + (boosting ? 0.007 : 0) : 0, now, 0.12);
    const d = this.drift ??= this.buildDrift();
    if (!drifting) this.sparkTier = 0;
    // A cartoon "eee" that steps up a note with each spark colour.
    const df = (520 + s * 120) * [1, 1, 1.26, 1.5][this.sparkTier];
    d.tones.forEach((o, i) => o.frequency.setTargetAtTime(df * (i ? 1.5 : 1), now, 0.04));
    d.gain.gain.setTargetAtTime(active && drifting ? DRIFT_GAIN * (0.6 + 0.4 * s) : 0, now, drifting ? 0.05 : 0.1);
    // Sparks crackle harder and faster with each colour.
    d.sparks.playbackRate.setTargetAtTime([1, 1, 1.35, 1.75][this.sparkTier], now, 0.1);
    d.sparkGain.gain.setTargetAtTime(active && drifting ? SPARK_GAIN * [0, 0.6, 0.85, 1.1][this.sparkTier] : 0, now, 0.05);
  }

  /**
   * The drift, cartoon kart-racer style: a soft pitched "eee" with vibrato (a triangle and a quieter fifth)
   * plus a sparkly fizz of tiny high pings, which drive() turns up with the spark colour.
   */
  private buildDrift() {
    const ctx = this.ctx!, lp = ctx.createBiquadFilter(), gain = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 2000;
    gain.gain.value = 0;
    lp.connect(gain).connect(this.master);
    const vibrato = ctx.createOscillator(), depth = ctx.createGain();
    vibrato.frequency.value = 7; depth.gain.value = 14; // ±14 Hz
    vibrato.connect(depth); vibrato.start();
    const tones = (['triangle', 'sine'] as const).map((type, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; g.gain.value = i ? 0.35 : 1;
      depth.connect(o.frequency);
      o.connect(g).connect(lp); o.start();
      return o;
    });
    // A second of spark pings: each a tiny, quickly fading high sine at a random pitch — a fizz, not a crackle.
    const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr, sr), d = buf.getChannelData(0);
    for (let k = 0; k < 60; k++) {
      const at = Math.floor(Math.random() * sr), amp = 0.3 + Math.random() * 0.7;
      const hz = 2500 + Math.random() * 2000;
      for (let i = 0; i < 400; i++) d[(at + i) % sr] += amp * Math.sin(2 * Math.PI * hz * i / sr) * Math.exp(-i / 80);
    }
    const sparks = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), sparkGain = ctx.createGain();
    sparks.buffer = buf; sparks.loop = true;
    hp.type = 'highpass'; hp.frequency.value = 2500;
    sparkGain.gain.value = 0;
    sparks.connect(hp).connect(sparkGain).connect(this.master);
    sparks.start();
    return { tones, gain, sparks, sparkGain };
  }

  /**
   * The engine: a warm pitched hum (sawtooth + sine, and a sine an octave up) through a lowpass, with a soft
   * purr — the volume wobbling at half the pitch, a small engine's "brrr".
   */
  private buildEngine() {
    const ctx = this.ctx!, filter = ctx.createBiquadFilter(), purrGain = ctx.createGain(), gain = ctx.createGain();
    filter.type = 'lowpass'; filter.Q.value = 1;
    purrGain.gain.value = 0.65; // the purr swings it between 0.3 and 1
    gain.gain.value = 0;
    filter.connect(purrGain).connect(gain).connect(this.master);
    const tones = (['sawtooth', 'sine', 'sine'] as const).map((type, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; g.gain.value = [0.35, 0.8, 0.25][i];
      o.connect(g).connect(filter); o.start();
      return o;
    });
    const purr = ctx.createOscillator(), depth = ctx.createGain();
    depth.gain.value = 0.35;
    purr.connect(depth).connect(purrGain.gain); purr.start();
    return { tones, purr, filter, gain };
  }

  // --- One-shots ---
  /** A bell per spark tier, higher each time: blue, orange, purple. */
  driftTier(tier: number) { this.sparkTier = Math.min(3, tier); this.play('chime', { gain: 0.5, rate: [1, 1, 1.26, 1.5][tier] ?? 1.5 }); }
  /** A boost firing: a low blast, bigger for higher drift tiers (tier 0 is Haste). */
  boost(tier = 0) {
    const k = [1, 0.8, 1, 1.25][tier] ?? 1;
    this.play('boost', { gain: 0.8 * k, rate: 1.05 - 0.15 * k }); // ×0.9 (as auditioned) for an orange boost
    this.music?.duck();
  }
  wallHit(force: number) { this.play('wall', { gain: Math.min(1, 0.25 + force * 0.06), rate: 0.9 + Math.random() * 0.2 }); }
  denied() { this.play('denied', { gain: 0.4, rate: 0.7 }); }
  hit() { this.play('hit', { gain: 0.9 }); this.thoom(0.6); }
  /** The drift hop: a quick rising "hup", and a soft tap as the kart lands. */
  hop() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(430, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.15);
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = this.noise; f.type = 'lowpass'; f.frequency.value = 500;
    ng.gain.setValueAtTime(0.0001, t + 0.27);
    ng.gain.exponentialRampToValueAtTime(0.08, t + 0.28);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    n.connect(f).connect(ng).connect(this.master);
    n.start(t + 0.27, Math.random() * 0.5); n.stop(t + 0.4);
  }

  /** The crows arrive to carry you back: two raspy caws over a flutter of wings. */
  rescue() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [delay, from, to] of [[0, 560, 380], [0.32, 500, 340]]) {
      const o = ctx.createOscillator(), rasp = ctx.createOscillator(), raspDepth = ctx.createGain(), am = ctx.createGain();
      const band = ctx.createBiquadFilter(), g = ctx.createGain(), at = t + delay;
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(from, at);
      o.frequency.exponentialRampToValueAtTime(to, at + 0.22);
      // A fast wobble in loudness gives the crow its rasp.
      rasp.frequency.value = 55; raspDepth.gain.value = 0.2; am.gain.value = 0.8;
      rasp.connect(raspDepth).connect(am.gain);
      band.type = 'bandpass'; band.frequency.value = 1300; band.Q.value = 1.2;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.45, at + 0.02); // measured: ~3× the engine, so it carries over it
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
      o.connect(am).connect(band).connect(g).connect(this.master);
      for (const osc of [o, rasp]) { osc.start(at); osc.stop(at + 0.3); }
    }
    // Wing beats: soft filtered noise pulsing about 14 times a second, fading out.
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), beat = ctx.createOscillator(), beatDepth = ctx.createGain(), am = ctx.createGain(), g = ctx.createGain();
    n.buffer = this.noise; n.loop = true;
    f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 0.8;
    beat.frequency.value = 14; beatDepth.gain.value = 0.5; am.gain.value = 0.5;
    beat.connect(beatDepth).connect(am.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    n.connect(f).connect(am).connect(g).connect(this.master);
    n.start(t); beat.start(t); n.stop(t + 1.2); beat.stop(t + 1.2);
  }
  spell(id: string) {
    switch (id) {
      case 'haste': this.play('chime', { gain: 0.35, rate: 2 }); break; // the boost plays too; this is the cast
      case 'smite': this.play('smite', { gain: 0.6 }); break;
      case 'snare': this.play('snare', { gain: 0.8, rate: 0.8 }); break;
      case 'ward': this.play('ward', { gain: 0.7 }); break;
    }
  }
  /** A smite landing somewhere; quieter the further away, silent past 80 m. */
  impact(distance: number) {
    const v = Math.max(0, 1 - distance / 80);
    if (v > 0) this.thoom(v);
  }
  countdown(go: boolean) { this.tone(go ? 880 : 440, go ? 0.45 : 0.16, { type: 'triangle', gain: 0.18 }); }
  lap(final: boolean) {
    const notes = final ? [523, 659, 784, 1047] : [659, 784, 988];
    notes.forEach((f, i) => this.tone(f, 0.28, { type: final ? 'sawtooth' : 'triangle', gain: final ? 0.06 : 0.12, delay: i * 0.09 }));
  }
  finish() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, i === 5 ? 0.8 : 0.22, { type: 'triangle', gain: 0.13, delay: i * 0.12 }));
  }
  click() { this.tone(660, 0.05, { gain: 0.05 }); }
}
