/**
 * Procedural audio.
 *
 * Every sound in the trainer is synthesised on the fly. No asset loading, no
 * first-play stutter, and — the reason it is worth doing at all — pitch,
 * timbre and space can track gameplay state directly. The combo chain
 * literally rises in pitch as it climbs; a hit on your left is on your left;
 * the arena has a tail because it is a stone bowl.
 *
 * The chain is:
 *
 *     voice ──┬─────────────────────────────► sfx bus ──┐
 *             └── send ─► convolver (arena) ─► wet ─────┤
 *                                                        ├─► master ─► comp ─► out
 *     music voices ─────────────────────────► music bus ─┘
 *
 * The convolver's impulse response is generated too: noise under an
 * exponential decay with a few early reflections stamped into the head, which
 * is enough to read as a large stone room without shipping a WAV.
 */

type SfxName =
  | 'attackWindup'
  | 'attackRelease'
  | 'attackLand'
  | 'attackCancel'
  | 'moveCommand'
  | 'dodge'
  | 'nearMiss'
  | 'hurt'
  | 'kill'
  | 'perfect'
  | 'pickup'
  | 'countdown'
  | 'go'
  | 'fail'
  | 'uiHover'
  | 'uiClick'
  | 'uiBack'
  | 'uiTab'
  | 'personalBest'
  | 'rankUpBuild'
  | 'rankUpHit'
  | 'resultsReveal'
  | 'step'
  | 'tick'
  /* ---- ability voices. One per slot, so your hands learn the sound ---- */
  | 'castQ'
  | 'castW'
  | 'castE'
  | 'castR'
  | 'castSummoner'
  | 'castArm'
  | 'castRefuse'
  | 'abilityReady'
  /* ---- what the other side is doing ---- */
  | 'telegraph'
  | 'hazardFire'
  | 'enemyCast'
  /* ---- ceremony ---- */
  | 'gateEnter'
  | 'announce';

export interface PlayOpts {
  /** 0..2-ish loudness multiplier. */
  intensity?: number;
  /** -1 hard left … +1 hard right. Usually the source's screen position. */
  pan?: number;
  /** 0..1 extra reverb send for this voice. */
  space?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private wetBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private comboPitch = 0;
  private musicNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private musicOn = false;
  private bedNodes: AudioNode[] = [];
  private bedGain: GainNode | null = null;
  private bedIntensity: GainNode | null = null;

  masterVolume = 0.75;
  sfxVolume = 0.9;
  musicVolume = 0.35;
  muted = false;

  /** Lazily created on the first gesture — browsers require it. */
  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.masterVolume;
      // A gentle limiter keeps dense fights from clipping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -11;
      comp.knee.value = 14;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.16;
      master.connect(comp).connect(ctx.destination);

      const sfx = ctx.createGain();
      sfx.gain.value = this.sfxVolume;
      sfx.connect(master);
      const music = ctx.createGain();
      music.gain.value = this.musicVolume;
      music.connect(master);

      this.master = master;
      this.sfxBus = sfx;
      this.musicBus = music;

      // --- noise source shared by every percussive layer ---------------
      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      // --- the room ----------------------------------------------------
      const conv = ctx.createConvolver();
      conv.buffer = this.impulse(ctx, 1.9, 3.1);
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      // Roll the tail off so reverb adds size, never mud in the mids you
      // need to hear a windup through.
      const tilt = ctx.createBiquadFilter();
      tilt.type = 'highpass';
      tilt.frequency.value = 240;
      const tilt2 = ctx.createBiquadFilter();
      tilt2.type = 'lowpass';
      tilt2.frequency.value = 5200;
      wet.connect(conv).connect(tilt).connect(tilt2).connect(master);
      this.wetBus = wet;

      return ctx;
    } catch {
      return null;
    }
  }

  /**
   * A stone amphitheatre, in one buffer. Exponential decay over noise, with
   * a handful of discrete early reflections stamped into the first 80ms —
   * those are what make it read as *a place* rather than as a reverb effect.
   */
  private impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const n = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, n, rate);
    const early = [0.011, 0.019, 0.027, 0.041, 0.058, 0.073];
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
      early.forEach((tap, k) => {
        // Offset one channel so the reflections are not identical: mono
        // early reflections collapse the image and sound like a filter.
        const idx = Math.floor((tap + (ch ? 0.0033 : 0)) * rate);
        if (idx < n) data[idx] += (k % 2 ? -1 : 1) * (0.55 - k * 0.07);
      });
    }
    return buf;
  }

  unlock(): void {
    this.ensure();
  }

  applyVolumes(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.masterVolume;
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxVolume;
    if (this.musicBus) this.musicBus.gain.value = this.musicVolume;
  }

  setComboPitch(chain: number): void {
    // Chain 0..12 maps to a rising pentatonic-ish offset in semitones.
    const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
    this.comboPitch = steps[Math.min(chain, steps.length - 1)];
  }

  /**
   * How hard the arena bed is pushing, 0..1. Driven by the combo chain, so a
   * streak is audible before it is legible — the room itself gets louder.
   */
  setIntensity(v: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bedIntensity) return;
    this.bedIntensity.gain.setTargetAtTime(0.5 + v * 0.85, ctx.currentTime, 0.35);
  }

  // ---------------------------------------------------------------- voices

  /** Per-voice output: pan, dry, and a reverb send. */
  private out(pan: number, space: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 1;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.sfxBus!);
      if (this.wetBus && space > 0) {
        const s = ctx.createGain();
        s.gain.value = space;
        p.connect(s).connect(this.wetBus);
      }
    } else {
      g.connect(this.sfxBus!);
      if (this.wetBus && space > 0) {
        const s = ctx.createGain();
        s.gain.value = space;
        g.connect(s).connect(this.wetBus);
      }
    }
    return g;
  }

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: OscillatorType;
      gain?: number;
      attack?: number;
      slideTo?: number;
      delay?: number;
      filter?: number;
      filterEnd?: number;
      q?: number;
      detune?: number;
      bus?: 'sfx' | 'music';
      pan?: number;
      space?: number;
    } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || !this.musicBus) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    const atk = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = osc;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(opts.filter, t0);
      if (opts.filterEnd) f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.filterEnd), t0 + dur);
      f.Q.value = opts.q ?? 1;
      node.connect(f);
      node = f;
    }
    if (opts.bus === 'music') node.connect(g).connect(this.musicBus);
    else node.connect(g).connect(this.out(opts.pan ?? 0, opts.space ?? 0.16));
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(
    dur: number,
    opts: {
      gain?: number;
      hp?: number;
      lp?: number;
      lpEnd?: number;
      delay?: number;
      q?: number;
      pan?: number;
      space?: number;
    } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    // Start at a random offset so repeated hits never phase into a tone.
    const off = Math.random() * 0.4;
    let node: AudioNode = src;
    if (opts.hp) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = opts.hp;
      node.connect(hp);
      node = hp;
    }
    if (opts.lp) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(opts.lp, t0);
      if (opts.lpEnd) lp.frequency.exponentialRampToValueAtTime(Math.max(60, opts.lpEnd), t0 + dur);
      lp.Q.value = opts.q ?? 0.7;
      node.connect(lp);
      node = lp;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.15, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g).connect(this.out(opts.pan ?? 0, opts.space ?? 0.2));
    src.start(t0, off);
    src.stop(t0 + dur + 0.05);
  }

  /**
   * A struck metal body: a short cluster of inharmonic partials under one
   * envelope. This is the timbre the whole interface is built from — every
   * click, every ability, every rank-up is some tuning of this.
   */
  private metal(
    freq: number,
    dur: number,
    opts: { gain?: number; ratios?: number[]; pan?: number; space?: number; delay?: number; type?: OscillatorType } = {},
  ): void {
    const ratios = opts.ratios ?? [1, 2.37, 3.41, 4.83];
    const g = opts.gain ?? 0.08;
    ratios.forEach((r, i) => {
      this.tone(freq * r, dur * (1 - i * 0.15), {
        type: opts.type ?? 'sine',
        gain: g / (1 + i * 1.25),
        delay: (opts.delay ?? 0) + i * 0.002,
        pan: opts.pan,
        space: opts.space ?? 0.3,
      });
    });
  }

  play(name: SfxName, intensityOrOpts: number | PlayOpts = 1, panArg = 0): void {
    if (this.muted) return;
    const o: PlayOpts = typeof intensityOrOpts === 'number' ? { intensity: intensityOrOpts, pan: panArg } : intensityOrOpts;
    const intensity = o.intensity ?? 1;
    const pan = o.pan ?? 0;
    const space = o.space;
    const semi = (n: number) => Math.pow(2, n / 12);
    // A few cents of drift on every voice. Without it, twenty basic attacks
    // in a row sound like a machine gun rather than like twenty swings.
    const vary = (amount = 0.03) => 1 + (Math.random() * 2 - 1) * amount;

    switch (name) {
      // ----------------------------------------------------- basic attack
      case 'attackWindup':
        // A short rising breath. The windup is the most important thing in
        // the game to feel, so it gets its own sound rather than silence.
        this.noise(0.13, { gain: 0.035 * intensity, hp: 700, lp: 2600, lpEnd: 5200, pan, space: space ?? 0.12 });
        this.tone(240 * vary(), 0.12, { type: 'triangle', gain: 0.03 * intensity, slideTo: 430, filter: 2400, pan });
        break;
      case 'attackRelease':
        this.tone(520 * semi(this.comboPitch * 0.35) * vary(), 0.07, {
          type: 'triangle',
          gain: 0.1 * intensity,
          slideTo: 700,
          pan,
        });
        this.noise(0.055, { gain: 0.07 * intensity, hp: 1500, lp: 9000, lpEnd: 2600, pan });
        break;
      case 'attackLand':
        // Four layers: a body thump you feel, a mid crack you hear, a high
        // transient that puts it on the exact frame, and a tuned partial
        // that climbs with the chain.
        this.tone(150 * vary(0.05), 0.14, { type: 'sine', gain: 0.22 * intensity, slideTo: 62, pan, space: 0.22 });
        this.tone(96, 0.2, { type: 'sine', gain: 0.14 * intensity, slideTo: 44, pan, space: 0.28 });
        this.noise(0.075, { gain: 0.13 * intensity, hp: 700, lp: 7000, lpEnd: 900, pan, space: 0.24 });
        this.noise(0.022, { gain: 0.1 * intensity, hp: 3600, lp: 14000, pan, space: 0.1 });
        this.tone(900 * semi(this.comboPitch) * vary(0.02), 0.06, {
          type: 'square',
          gain: 0.04 * intensity,
          filter: 4200,
          pan,
        });
        break;
      case 'attackCancel':
        // Deliberately ugly: a cancel is the one thing the trainer wants you
        // to flinch at.
        this.tone(300, 0.13, { type: 'sawtooth', gain: 0.07, slideTo: 140, filter: 900, pan });
        this.noise(0.09, { gain: 0.04, hp: 200, lp: 1400, lpEnd: 260, pan });
        break;

      // ------------------------------------------------------- commands
      case 'moveCommand':
        this.tone(1400 * vary(0.04), 0.03, { type: 'sine', gain: 0.03, pan, space: 0.05 });
        break;
      case 'dodge':
        this.noise(0.16, { gain: 0.075, hp: 500, lp: 3200, lpEnd: 700, pan });
        this.tone(340, 0.14, { type: 'sine', gain: 0.05, slideTo: 620, pan });
        break;
      case 'nearMiss':
        // A whip past the ear. The doppler is what sells "that nearly hit me".
        this.noise(0.2, { gain: 0.1, hp: 1200, lp: 7000, lpEnd: 900, pan });
        this.tone(1800, 0.12, { type: 'sine', gain: 0.05, slideTo: 500, pan });
        break;
      case 'hurt':
        this.tone(120, 0.22, { type: 'sawtooth', gain: 0.14 * intensity, slideTo: 55, filter: 700, pan });
        this.noise(0.14, { gain: 0.1 * intensity, hp: 200, lp: 2200, lpEnd: 300, pan, space: 0.3 });
        break;
      case 'kill':
        // Impact, then a bloom. The low end is what makes a kill feel earned.
        this.tone(70, 0.42, { type: 'sine', gain: 0.26, slideTo: 34, pan, space: 0.4 });
        this.tone(300, 0.3, { type: 'triangle', gain: 0.15, slideTo: 900, pan });
        this.tone(600, 0.34, { type: 'sine', gain: 0.1, slideTo: 1500, delay: 0.03, pan });
        this.noise(0.34, { gain: 0.12, hp: 400, lp: 11000, lpEnd: 500, pan, space: 0.45 });
        break;
      case 'perfect':
        this.tone(1046, 0.14, { type: 'sine', gain: 0.09, pan, space: 0.35 });
        this.tone(1568, 0.16, { type: 'sine', gain: 0.06, delay: 0.045, pan, space: 0.35 });
        break;
      case 'pickup':
        this.tone(700 * semi(this.comboPitch), 0.09, {
          type: 'triangle',
          gain: 0.11,
          slideTo: 1200 * semi(this.comboPitch),
          pan,
        });
        break;

      // -------------------------------------------------------- abilities
      //
      // Q W E R are one instrument played at four pitches with four
      // characters, so a player learns "that was my E" without looking at
      // the bar — which is the entire point of a mechanics trainer.
      case 'castQ':
        // Q: a clean struck bell. Short, bright, the workhorse.
        this.metal(660 * vary(0.01), 0.34, { gain: 0.1 * intensity, pan, space: 0.35 });
        this.noise(0.09, { gain: 0.05 * intensity, hp: 2200, lp: 12000, lpEnd: 3000, pan });
        break;
      case 'castW':
        // W: a swelling pad with a soft attack. Shields and zones.
        this.tone(196, 0.55, { type: 'triangle', gain: 0.09 * intensity, slideTo: 392, attack: 0.05, filter: 1800, filterEnd: 5200, pan, space: 0.5 });
        this.tone(294, 0.5, { type: 'sine', gain: 0.06 * intensity, attack: 0.06, delay: 0.03, pan, space: 0.5 });
        break;
      case 'castE':
        // E: a fast rising sweep. Dashes and repositions.
        this.noise(0.22, { gain: 0.07 * intensity, hp: 400, lp: 900, lpEnd: 9000, pan });
        this.tone(300, 0.24, { type: 'sawtooth', gain: 0.07 * intensity, slideTo: 1200, filter: 2600, filterEnd: 7000, pan });
        break;
      case 'castR':
        // R: the ultimate. A downward gong under a rising choir — the only
        // ability sound with a low end, so it can never be mistaken.
        this.tone(58, 0.9, { type: 'sine', gain: 0.24 * intensity, slideTo: 38, pan, space: 0.6 });
        this.metal(220, 1.1, { gain: 0.11 * intensity, ratios: [1, 1.51, 2.02, 2.98, 4.11], pan, space: 0.65 });
        this.noise(0.7, { gain: 0.07 * intensity, hp: 300, lp: 600, lpEnd: 8000, pan, space: 0.6 });
        this.tone(440, 0.8, { type: 'sine', gain: 0.05 * intensity, slideTo: 880, attack: 0.12, delay: 0.06, pan, space: 0.7 });
        break;
      case 'castSummoner':
        // D / F: airier and further away than an ability. It is not yours,
        // it is lent to you.
        this.tone(880, 0.4, { type: 'sine', gain: 0.07 * intensity, slideTo: 1760, attack: 0.02, pan, space: 0.55 });
        this.noise(0.36, { gain: 0.05 * intensity, hp: 1800, lp: 14000, lpEnd: 2000, pan, space: 0.5 });
        break;
      case 'castArm':
        // Non-quickcast: the ability is armed and waiting for a click.
        this.tone(1200, 0.05, { type: 'sine', gain: 0.035, slideTo: 1600, pan });
        break;
      case 'castRefuse':
        // On cooldown. A dull, closed thud — nothing left the champion.
        this.tone(180, 0.1, { type: 'square', gain: 0.045, slideTo: 120, filter: 500, pan });
        break;
      case 'abilityReady':
        // The little chime as a cooldown finishes. Quiet enough to live under
        // a fight, distinct enough to notice in one.
        this.tone(1320, 0.14, { type: 'sine', gain: 0.03, pan, space: 0.4 });
        this.tone(1980, 0.1, { type: 'sine', gain: 0.016, delay: 0.03, pan, space: 0.4 });
        break;

      // ------------------------------------------------- incoming danger
      //
      // A telegraph you can only see is a telegraph you miss while looking
      // somewhere else. These three are quiet, panned to where the danger
      // actually is, and pitched well away from your own ability voices so a
      // fight never becomes one texture.
      case 'telegraph':
        this.tone(180, 0.42, { type: 'sawtooth', gain: 0.05 * intensity, slideTo: 340, filter: 900, filterEnd: 2200, attack: 0.06, pan, space: 0.45 });
        this.noise(0.36, { gain: 0.03 * intensity, hp: 200, lp: 700, lpEnd: 2600, pan, space: 0.4 });
        break;
      case 'hazardFire':
        this.tone(110, 0.3, { type: 'sine', gain: 0.15 * intensity, slideTo: 52, pan, space: 0.45 });
        this.noise(0.26, { gain: 0.09 * intensity, hp: 260, lp: 6000, lpEnd: 500, pan, space: 0.45 });
        break;
      case 'enemyCast':
        this.noise(0.16, { gain: 0.045 * intensity, hp: 900, lp: 5200, lpEnd: 1400, pan, space: 0.4 });
        this.tone(420, 0.16, { type: 'triangle', gain: 0.04 * intensity, slideTo: 760, pan, space: 0.4 });
        break;

      // ----------------------------------------------------------- clock
      case 'countdown':
        this.metal(440, 0.34, { gain: 0.07, ratios: [1, 2.02, 3.03], space: 0.4 });
        break;
      case 'go':
        this.tone(660, 0.16, { type: 'triangle', gain: 0.14, slideTo: 990, space: 0.35 });
        this.metal(880, 0.5, { gain: 0.08, space: 0.5 });
        this.noise(0.25, { gain: 0.06, hp: 300, lp: 6000, lpEnd: 500, space: 0.4 });
        break;
      case 'fail':
        this.tone(220, 0.4, { type: 'sawtooth', gain: 0.1, slideTo: 90, filter: 800, space: 0.4 });
        this.tone(110, 0.7, { type: 'sine', gain: 0.12, slideTo: 55, space: 0.5 });
        break;

      // -------------------------------------------------------------- ui
      //
      // The interface is glass over stone: a high tick with a short metal
      // tail. It should be felt more than heard.
      case 'uiHover':
        this.tone(2400 * vary(0.02), 0.022, { type: 'sine', gain: 0.014, space: 0.2 });
        break;
      case 'uiClick':
        this.metal(1180, 0.16, { gain: 0.05, ratios: [1, 2.41, 4.2], space: 0.3 });
        this.noise(0.02, { gain: 0.03, hp: 4000, lp: 15000 });
        break;
      case 'uiBack':
        this.metal(620, 0.18, { gain: 0.045, ratios: [1, 2.41, 3.9], space: 0.3 });
        break;
      case 'uiTab':
        this.metal(1560, 0.12, { gain: 0.035, ratios: [1, 2.76], space: 0.25 });
        break;

      // -------------------------------------------------------- ceremony
      case 'gateEnter':
        // The one moment the app is allowed to be loud. A sub drop, a struck
        // gong, and a long rising shimmer that lands as the client appears.
        this.tone(44, 2.4, { type: 'sine', gain: 0.34, slideTo: 30, space: 0.8 });
        this.metal(146.83, 2.8, { gain: 0.14, ratios: [1, 1.48, 2.01, 2.97, 4.09, 5.51], space: 0.9 });
        this.noise(2.2, { gain: 0.075, hp: 200, lp: 500, lpEnd: 11000, space: 0.85 });
        [0, 7, 12, 16, 19].forEach((n, i) =>
          this.tone(261.63 * semi(n), 2.6 - i * 0.12, {
            type: 'sine',
            gain: 0.055,
            attack: 0.45 + i * 0.09,
            delay: i * 0.055,
            space: 0.9,
          }),
        );
        break;
      case 'announce':
        this.metal(392, 1.2, { gain: 0.1, ratios: [1, 1.5, 2, 3], space: 0.7 });
        this.tone(98, 0.9, { type: 'sine', gain: 0.14, slideTo: 65, space: 0.6 });
        break;
      case 'personalBest':
        [0, 4, 7, 12].forEach((n, i) =>
          this.tone(523.25 * semi(n), 0.3, { type: 'sine', gain: 0.075, delay: i * 0.07, space: 0.5 }),
        );
        break;
      case 'resultsReveal':
        this.tone(330, 0.5, { type: 'sine', gain: 0.06, slideTo: 660, space: 0.5 });
        this.noise(0.6, { gain: 0.035, hp: 200, lp: 5000, lpEnd: 400, space: 0.5 });
        break;
      case 'rankUpBuild':
        this.tone(110, 1.7, { type: 'sawtooth', gain: 0.07, slideTo: 440, filter: 1400, space: 0.6 });
        this.tone(110.5, 1.7, { type: 'sawtooth', gain: 0.05, slideTo: 441, detune: 8, filter: 1400, space: 0.6 });
        this.noise(1.7, { gain: 0.05, hp: 300, lp: 400, lpEnd: 9000, space: 0.7 });
        break;
      case 'rankUpHit':
        [0, 7, 12, 19].forEach((n, i) =>
          this.tone(261.63 * semi(n), 1.5, { type: 'sine', gain: 0.11, delay: i * 0.015, space: 0.8 }),
        );
        this.tone(65, 1.0, { type: 'sine', gain: 0.2, slideTo: 40, space: 0.7 });
        this.noise(1.1, { gain: 0.11, hp: 600, lp: 12000, lpEnd: 500, space: 0.8 });
        break;

      // -------------------------------------------------------- ambient
      case 'step':
        this.noise(0.045, { gain: 0.022 * intensity, hp: 260, lp: 1500, lpEnd: 420, pan, space: 0.25 });
        break;
      case 'tick':
        this.tone(2200, 0.02, { type: 'sine', gain: 0.02, pan });
        break;
    }
  }

  /** The ability voice for a slot, so callers don't switch on the letter. */
  castVoice(slot: string): SfxName {
    switch (slot) {
      case 'q':
        return 'castQ';
      case 'w':
        return 'castW';
      case 'e':
        return 'castE';
      case 'r':
        return 'castR';
      default:
        return 'castSummoner';
    }
  }

  /**
   * The arena's own sound: wind moving through an open stone bowl, a
   * sub-bass drone, and a slow ring of the room itself. It is nearly
   * inaudible on its own and immediately missed when it stops — which is
   * exactly what a room tone should be.
   */
  startArenaBed(): void {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || !this.noiseBuf || this.bedGain || this.muted) return;

    const bed = ctx.createGain();
    bed.gain.value = 0;
    bed.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2.5);
    // A second stage the combo chain rides, so the room swells with a streak.
    const drive = ctx.createGain();
    drive.gain.value = 0.5;
    bed.connect(drive).connect(this.musicBus);
    this.bedGain = bed;
    this.bedIntensity = drive;

    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.09;
    wind.connect(band).connect(windGain).connect(bed);
    wind.start();

    // A slow sweep on the band keeps the wind from reading as static hiss.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 230;
    lfo.connect(lfoGain).connect(band.frequency);
    lfo.start();

    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 41.2;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.09;
    drone.connect(droneGain).connect(bed);
    drone.start();

    // The room's fifth, barely there. Two tones a fifth apart is the whole
    // harmonic content of the arena — anything more becomes music, and music
    // under a reaction-time drill is a distraction.
    const fifth = ctx.createOscillator();
    fifth.type = 'sine';
    fifth.frequency.value = 61.7;
    fifth.detune.value = 5;
    const fifthGain = ctx.createGain();
    fifthGain.gain.value = 0.035;
    fifth.connect(fifthGain).connect(bed);
    fifth.start();

    this.bedNodes = [wind, lfo, drone, fifth];
  }

  stopArenaBed(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bedGain) return;
    const g = this.bedGain;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    for (const n of this.bedNodes) {
      const src = n as OscillatorNode & AudioBufferSourceNode;
      try {
        src.stop(ctx.currentTime + 0.6);
      } catch {
        /* already stopped */
      }
    }
    this.bedNodes = [];
    this.bedGain = null;
    this.bedIntensity = null;
  }

  /**
   * The menu pad. A stacked fifth with a very slow tremolo, plus a single
   * high partial that drifts in and out — sparse on purpose, because you
   * will hear it every time you open the client.
   */
  startAmbience(): void {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || this.musicOn || this.muted) return;
    this.musicOn = true;
    const roots = [55, 82.41, 110, 164.81, 329.63];
    roots.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === roots.length - 1 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(i === roots.length - 1 ? 0.012 : 0.05, ctx.currentTime + 3);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.05;
      const lg = ctx.createGain();
      lg.gain.value = i === roots.length - 1 ? 0.011 : 0.03;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      // The pad goes through the room too, which is what ties the menus to
      // the arena rendered behind them.
      osc.connect(g).connect(this.musicBus!);
      if (this.wetBus) {
        const send = ctx.createGain();
        send.gain.value = 0.35;
        g.connect(send).connect(this.wetBus);
      }
      osc.start();
      this.musicNodes.push({ osc, gain: g });
    });
  }

  stopAmbience(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const { osc, gain } of this.musicNodes) {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      osc.stop(ctx.currentTime + 0.7);
    }
    this.musicNodes = [];
    this.musicOn = false;
  }
}

export const audio = new AudioEngine();
