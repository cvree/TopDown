/**
 * Procedural audio. Every sound is synthesised on the fly — no asset loading,
 * no first-play stutter, and pitch can track gameplay state (the combo chain
 * literally rises in pitch as it climbs, which is most of why kiting well
 * *feels* good).
 */

type SfxName =
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
  | 'personalBest'
  | 'rankUpBuild'
  | 'rankUpHit'
  | 'resultsReveal'
  | 'tick';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private comboPitch = 0;
  private musicNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private musicOn = false;

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
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.masterVolume;
      // A gentle limiter keeps dense fights from clipping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.15;
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

      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      return ctx;
    } catch {
      return null;
    }
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
      q?: number;
      detune?: number;
      bus?: 'sfx' | 'music';
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
      f.frequency.value = opts.filter;
      f.Q.value = opts.q ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(opts.bus === 'music' ? this.musicBus : this.sfxBus);
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
    } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
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
    node.connect(g).connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  play(name: SfxName, intensity = 1): void {
    if (this.muted) return;
    const semi = (n: number) => Math.pow(2, n / 12);
    switch (name) {
      case 'attackRelease':
        this.tone(520 * semi(this.comboPitch * 0.35), 0.07, { type: 'triangle', gain: 0.1 * intensity, slideTo: 700 });
        this.noise(0.05, { gain: 0.05 * intensity, hp: 1800, lp: 8000 });
        break;
      case 'attackLand':
        this.tone(180, 0.11, { type: 'sine', gain: 0.16 * intensity, slideTo: 90 });
        this.noise(0.06, { gain: 0.09 * intensity, hp: 900, lp: 6000, lpEnd: 1200 });
        this.tone(900 * semi(this.comboPitch), 0.06, { type: 'square', gain: 0.035 * intensity, filter: 4000 });
        break;
      case 'attackCancel':
        this.tone(300, 0.13, { type: 'sawtooth', gain: 0.07, slideTo: 140, filter: 900 });
        break;
      case 'moveCommand':
        this.tone(1400, 0.03, { type: 'sine', gain: 0.03 });
        break;
      case 'dodge':
        this.noise(0.16, { gain: 0.075, hp: 500, lp: 3200, lpEnd: 700 });
        this.tone(340, 0.14, { type: 'sine', gain: 0.05, slideTo: 620 });
        break;
      case 'nearMiss':
        this.noise(0.2, { gain: 0.1, hp: 1200, lp: 7000, lpEnd: 900 });
        this.tone(1800, 0.12, { type: 'sine', gain: 0.05, slideTo: 500 });
        break;
      case 'hurt':
        this.tone(120, 0.22, { type: 'sawtooth', gain: 0.14, slideTo: 55, filter: 700 });
        this.noise(0.14, { gain: 0.1, hp: 200, lp: 2200, lpEnd: 300 });
        break;
      case 'kill':
        this.tone(300, 0.3, { type: 'triangle', gain: 0.14, slideTo: 900 });
        this.tone(600, 0.34, { type: 'sine', gain: 0.09, slideTo: 1500, delay: 0.03 });
        this.noise(0.3, { gain: 0.09, hp: 400, lp: 9000, lpEnd: 600 });
        break;
      case 'perfect':
        this.tone(1046, 0.14, { type: 'sine', gain: 0.09 });
        this.tone(1568, 0.16, { type: 'sine', gain: 0.06, delay: 0.045 });
        break;
      case 'pickup':
        this.tone(700 * semi(this.comboPitch), 0.09, { type: 'triangle', gain: 0.11, slideTo: 1200 * semi(this.comboPitch) });
        break;
      case 'countdown':
        this.tone(440, 0.1, { type: 'sine', gain: 0.1 });
        break;
      case 'go':
        this.tone(660, 0.16, { type: 'triangle', gain: 0.14, slideTo: 990 });
        this.noise(0.25, { gain: 0.06, hp: 300, lp: 6000, lpEnd: 500 });
        break;
      case 'fail':
        this.tone(220, 0.4, { type: 'sawtooth', gain: 0.1, slideTo: 90, filter: 800 });
        break;
      case 'uiHover':
        this.tone(1500, 0.025, { type: 'sine', gain: 0.018 });
        break;
      case 'uiClick':
        this.tone(880, 0.05, { type: 'triangle', gain: 0.05, slideTo: 1320 });
        break;
      case 'uiBack':
        this.tone(620, 0.07, { type: 'triangle', gain: 0.045, slideTo: 380 });
        break;
      case 'personalBest':
        [0, 4, 7, 12].forEach((n, i) =>
          this.tone(523.25 * semi(n), 0.3, { type: 'sine', gain: 0.075, delay: i * 0.07 }),
        );
        break;
      case 'resultsReveal':
        this.tone(330, 0.5, { type: 'sine', gain: 0.06, slideTo: 660 });
        this.noise(0.6, { gain: 0.035, hp: 200, lp: 5000, lpEnd: 400 });
        break;
      case 'rankUpBuild':
        this.tone(110, 1.7, { type: 'sawtooth', gain: 0.07, slideTo: 440, filter: 1400 });
        this.tone(110.5, 1.7, { type: 'sawtooth', gain: 0.05, slideTo: 441, detune: 8, filter: 1400 });
        this.noise(1.7, { gain: 0.05, hp: 300, lp: 400, lpEnd: 9000 });
        break;
      case 'rankUpHit':
        [0, 7, 12, 19].forEach((n, i) =>
          this.tone(261.63 * semi(n), 1.5, { type: 'sine', gain: 0.11, delay: i * 0.015 }),
        );
        this.tone(65, 1.0, { type: 'sine', gain: 0.2, slideTo: 40 });
        this.noise(1.1, { gain: 0.11, hp: 600, lp: 12000, lpEnd: 500 });
        break;
      case 'tick':
        this.tone(2200, 0.02, { type: 'sine', gain: 0.02 });
        break;
    }
  }

  /** A slow two-note pad that sits under the menus. Deliberately sparse. */
  startAmbience(): void {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || this.musicOn || this.muted) return;
    this.musicOn = true;
    const roots = [55, 82.41, 110, 164.81];
    for (const f of roots) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 3);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.05;
      const lg = ctx.createGain();
      lg.gain.value = 0.03;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      osc.connect(g).connect(this.musicBus);
      osc.start();
      this.musicNodes.push({ osc, gain: g });
    }
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
