/**
 * The reflex family.
 *
 * Four instruments for the same half-second: see it, hear it, name it, dodge
 * it. Everything else in the app is compound — these four are deliberately not,
 * because a reaction number is only meaningful when nothing else is in the way.
 *
 * All four run the same skeleton: arm, cue, respond, feed back, repeat. The
 * differences are what the cue is and what counts as the right answer.
 */

import { audio } from '../engine/audio';
import { clamp } from '../engine/math';
import type { Rng } from '../engine/rng';
import {
  C,
  champ,
  disc,
  easeOut,
  field,
  floatsDraw,
  floatsUpdate,
  glow,
  keycap,
  lineTelegraph,
  median,
  pop,
  pulse,
  rgba,
  ring,
  rippleDraw,
  rippleUpdate,
  stdev,
  text,
  type FloatText,
  type Ripple,
} from './kit';
import type { Frame, TestResult, TestRunner } from './types';

type Phase = 'arm' | 'cue' | 'feedback' | 'done';

/* ======================================================== FLASH REACTION == */

const FLASH_TRIALS = 7;
/** What a trial nobody answered is worth. Off the bottom of the table. */
const FLASH_MISS = 1600;

/**
 * Simple visual reaction, with the one honesty check that matters: you cannot
 * beat it by mashing. A key pressed before the cue is a false start, it costs
 * you the trial, and it is added back onto your score at the end.
 */
export class FlashReactTest implements TestRunner {
  readonly usesKeys = true;
  readonly cursor = 'none' as const;

  private phase: Phase = 'arm';
  private timer = 0;
  private wait = 0;
  private trials: number[] = [];
  private falseStarts = 0;
  /** Consecutive false starts on the current trial — see `keyDown`. */
  private strikes = 0;
  private lastMs = 0;
  private lastGood = true;
  private ripples: Ripple[] = [];
  private floats: FloatText[] = [];
  private flash = 0;
  private t = 0;

  constructor(private rng: Rng) {
    this.arm();
  }

  private arm(): void {
    this.phase = 'arm';
    this.timer = 0;
    // Long enough that anticipation never pays, short enough to stay tense.
    this.wait = this.rng.range(1.3, 3.4);
  }

  prompt(): string {
    if (this.phase === 'arm') return 'HOLD — do not press yet';
    if (this.phase === 'cue') return 'FLASH — NOW';
    if (!this.lastGood) return 'TOO EARLY. That one does not count.';
    return `${Math.round(this.lastMs)}ms`;
  }

  progress(): number {
    return this.trials.length / FLASH_TRIALS;
  }

  keyDown(code: string): void {
    if (code !== 'KeyF') return;
    if (this.phase === 'arm') {
      // A press with nothing on screen is a guess, and guessing is the habit
      // this test exists to punish. The first two on a trial are replayed; the
      // third takes the trial, because otherwise mashing would simply prevent
      // the test from ever reaching a cue.
      this.falseStarts++;
      this.strikes++;
      if (this.strikes >= 3) {
        this.trials.push(FLASH_MISS);
        this.strikes = 0;
      }
      this.lastGood = false;
      this.phase = 'feedback';
      this.timer = 0;
      audio.play('castRefuse', 0.9);
      return;
    }
    if (this.phase !== 'cue') return;
    const ms = this.timer * 1000;
    this.trials.push(ms);
    this.strikes = 0;
    this.lastMs = ms;
    this.lastGood = true;
    this.phase = 'feedback';
    this.timer = 0;
    audio.play(ms < 220 ? 'perfect' : 'castSummoner', 0.85);
    pop(this.ripples, 0, 0, ms < 220 ? C.goldHot : C.gold, 260, 0.5);
    this.flash = 0;
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.t = f.t;
    this.timer += f.dt;
    this.flash = Math.max(0, this.flash - f.dt * 3.4);
    rippleUpdate(this.ripples, f.dt);
    floatsUpdate(this.floats, f.dt);

    if (this.phase === 'arm' && this.timer >= this.wait) {
      this.phase = 'cue';
      this.timer = 0;
      this.flash = 1;
      audio.play('telegraph', 1.1);
    } else if (this.phase === 'cue' && this.timer > 1.6) {
      // Nobody is that slow on purpose; treat it as a miss rather than waiting.
      this.trials.push(FLASH_MISS);
      this.strikes = 0;
      this.lastMs = FLASH_MISS;
      this.lastGood = true;
      this.phase = 'feedback';
      this.timer = 0;
    } else if (this.phase === 'feedback' && this.timer > 0.8) {
      if (this.trials.length >= FLASH_TRIALS) this.phase = 'done';
      else this.arm();
    }

    /* ------------------------------------------------------------- draw */
    field(ctx, w, h, this.phase === 'cue' ? C.danger : C.cyan);
    const cx = w / 2;
    const cy = h / 2;

    if (this.phase === 'cue') {
      // The whole field turns hostile at once. There is no gradient into it,
      // because in game there is no gradient into it either.
      ctx.fillStyle = rgba(C.danger, 0.16 + easeOut(this.timer * 6) * 0.1);
      ctx.fillRect(0, 0, w, h);
      glow(ctx, cx, cy, Math.max(w, h) * 0.5, C.danger, 0.42);

      // Four chevrons collapsing inward: the hook, arriving.
      const k = easeOut(clamp(this.timer / 0.42, 0, 1));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const d = 340 - 210 * k;
        ctx.save();
        ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
        ctx.rotate(a + Math.PI);
        ctx.strokeStyle = rgba(C.danger, 0.9);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-22, -22);
        ctx.lineTo(0, 0);
        ctx.lineTo(-22, 22);
        ctx.stroke();
        ctx.restore();
      }
      champ(ctx, cx, cy, 34, { color: C.danger, glyph: '!', hp: 1, hpColor: C.danger });
      text(ctx, 'FLASH', cx, cy + 96, { size: 46, color: C.goldHot, font: 'display', track: 10 });
    } else {
      const breathe = 0.5 + 0.5 * pulse(this.t, 0.5);
      ring(ctx, cx, cy, 74 + breathe * 5, rgba(C.gold, 0.28), 1);
      ring(ctx, cx, cy, 40, rgba(C.gold, 0.5), 2);
      champ(ctx, cx, cy, 26, { color: C.gold, glyph: 'F', alpha: 0.9 });
      if (this.phase === 'arm') {
        text(ctx, 'WAIT', cx, cy + 96, {
          size: 22,
          color: rgba(C.dim, 0.5 + breathe * 0.3),
          track: 12,
        });
      } else {
        const good = this.lastGood;
        text(ctx, good ? `${Math.round(this.lastMs)}` : 'TOO EARLY', cx, cy + 96, {
          size: good ? 54 : 30,
          color: good ? (this.lastMs < 220 ? C.goldHot : C.cyanHot) : C.danger,
          font: good ? 'mono' : 'ui',
          track: good ? 0 : 8,
        });
        if (good) text(ctx, 'MS', cx, cy + 132, { size: 12, color: C.faint, track: 6 });
      }
    }

    ctx.save();
    ctx.translate(cx, cy);
    rippleDraw(ctx, this.ripples);
    ctx.restore();
    floatsDraw(ctx, this.floats);

    // The trial rail: seven pips that fill with the colour of the reaction.
    const pipW = 46;
    const total = FLASH_TRIALS * pipW;
    for (let i = 0; i < FLASH_TRIALS; i++) {
      const x = cx - total / 2 + i * pipW + pipW / 2;
      const y = h - 44;
      const v = this.trials[i];
      const on = v !== undefined;
      ctx.fillStyle = on
        ? v < 230
          ? C.goldHot
          : v < 300
            ? C.cyanHot
            : C.dim
        : 'rgba(255,255,255,0.09)';
      ctx.fillRect(x - 16, y, 32, 3);
      if (on) text(ctx, String(Math.round(v)), x, y - 14, { size: 11, color: C.faint, font: 'mono' });
    }
  }

  finished(): boolean {
    return this.phase === 'done';
  }

  result(): TestResult {
    const t = this.trials;
    const med = median(t);
    // False starts do not vanish just because the trial was replayed.
    const penalty = this.falseStarts * 15;
    const best = t.length ? Math.min(...t) : 0;
    return {
      primary: med + penalty,
      trials: t,
      stats: [
        { label: 'Best', value: best, format: 'ms', direction: 'lower' },
        { label: 'Consistency', value: stdev(t), format: 'ms', direction: 'lower' },
        { label: 'False starts', value: this.falseStarts, format: 'int', direction: 'lower' },
      ],
      notes: [
        this.falseStarts > 0
          ? `${this.falseStarts} false start${this.falseStarts > 1 ? 's' : ''} — ${penalty}ms added. Anticipating is not reacting.`
          : 'No false starts. Every one of those was a real reaction.',
        stdev(t) > 55
          ? 'Your spread is wide. The slow ones cost more games than the fast ones win.'
          : 'Tight spread — you react at the same speed every time, which is the point.',
      ],
    };
  }
}

/* ============================================================ SOUND CUE == */

const SOUND_TRIALS = 7;
const SOUND_MISS = 1500;

/**
 * Auditory discrimination. Three sounds are noise and one is the ultimate
 * landing on your head; only the last one deserves a key. The screen shows
 * nothing at cue time on purpose — the moment you can see it, it stops being
 * an ear test.
 */
export class SoundCueTest implements TestRunner {
  readonly usesKeys = true;
  readonly cursor = 'none' as const;

  private phase: Phase = 'arm';
  private timer = 0;
  private wait = 0;
  private trials: number[] = [];
  private falseCalls = 0;
  private strikes = 0;
  private missed = 0;
  private lastMs = 0;
  private lastKind: 'good' | 'false' | 'miss' | null = null;
  private decoyPending = false;
  private wave = 0;

  constructor(private rng: Rng) {
    this.arm();
  }

  private arm(): void {
    this.phase = 'arm';
    this.timer = 0;
    this.wait = this.rng.range(1.1, 2.9);
    // Roughly two decoys per real cue, so "something happened" is not enough.
    this.decoyPending = this.rng.chance(0.62);
  }

  prompt(): string {
    if (audio.muted) return 'AUDIO IS MUTED — this test needs sound';
    // 'arm' and 'cue' deliberately read identically. The moment the banner or
    // the field changes at the cue, this stops being an ear test and becomes a
    // slower version of Flash Reaction.
    if (this.phase === 'arm' || this.phase === 'cue') return 'LISTEN — only the deep impact counts';
    if (this.lastKind === 'false') return 'That was not it. Wrong sound.';
    if (this.lastKind === 'miss') return 'Missed it.';
    return `${Math.round(this.lastMs)}ms`;
  }

  progress(): number {
    return this.trials.length / SOUND_TRIALS;
  }

  keyDown(code: string): void {
    if (code !== 'Space') return;
    if (this.phase === 'arm') {
      // Bounded exactly as in Flash Reaction: three calls on the wrong sound
      // and the trial is spent, so a run cannot be stalled by mashing.
      this.falseCalls++;
      this.strikes++;
      if (this.strikes >= 3) {
        this.trials.push(SOUND_MISS);
        this.missed++;
        this.strikes = 0;
      }
      this.lastKind = 'false';
      this.phase = 'feedback';
      this.timer = 0;
      audio.play('castRefuse', 0.9);
      return;
    }
    if (this.phase !== 'cue') return;
    const ms = this.timer * 1000;
    this.trials.push(ms);
    this.strikes = 0;
    this.lastMs = ms;
    this.lastKind = 'good';
    this.phase = 'feedback';
    this.timer = 0;
    this.wave = 1;
    audio.play('perfect', 0.7);
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.timer += f.dt;
    this.wave = Math.max(0, this.wave - f.dt * 1.6);

    if (this.phase === 'arm') {
      // A decoy fires partway through the wait — same loudness, wrong meaning.
      if (this.decoyPending && this.timer >= this.wait * 0.45) {
        this.decoyPending = false;
        audio.play(this.rng.pick(['step', 'attackWindup', 'tick', 'uiHover'] as const), 1);
      }
      if (this.timer >= this.wait) {
        this.phase = 'cue';
        this.timer = 0;
        audio.play('hazardFire', 1.25);
      }
    } else if (this.phase === 'cue' && this.timer > 1.5) {
      this.missed++;
      this.trials.push(SOUND_MISS);
      this.strikes = 0;
      this.lastKind = 'miss';
      this.phase = 'feedback';
      this.timer = 0;
    } else if (this.phase === 'feedback' && this.timer > 0.8) {
      if (this.trials.length >= SOUND_TRIALS) this.phase = 'done';
      else this.arm();
    }

    /* ------------------------------------------------------------- draw */
    field(ctx, w, h, C.violet);
    const cx = w / 2;
    const cy = h / 2;

    // A sonar dish that idles identically whatever the speakers are doing, so
    // the picture never leaks the cue.
    const base = 60;
    for (let i = 0; i < 4; i++) {
      const k = (f.t * 0.45 + i / 4) % 1;
      ring(ctx, cx, cy, base + k * 170, rgba(C.violet, (1 - k) * 0.28), 1.5);
    }
    if (this.wave > 0) {
      ring(ctx, cx, cy, base + (1 - this.wave) * 330, rgba(C.goldHot, this.wave * 0.8), 3);
    }
    disc(ctx, cx, cy, base * 0.5, 'rgba(6,10,20,0.9)');
    ring(ctx, cx, cy, base * 0.5, rgba(C.violet, 0.7), 2);
    text(ctx, '🔊', cx, cy + 1, { size: 26 });

    if (this.phase === 'feedback') {
      const good = this.lastKind === 'good';
      text(
        ctx,
        good ? `${Math.round(this.lastMs)}` : this.lastKind === 'false' ? 'WRONG SOUND' : 'MISSED',
        cx,
        cy + 132,
        {
          size: good ? 48 : 26,
          color: good ? C.cyanHot : C.danger,
          font: good ? 'mono' : 'ui',
          track: good ? 0 : 8,
        },
      );
    } else {
      // Same word, same size, same colour whether the cue has fired or not.
      text(ctx, 'LISTEN', cx, cy + 132, { size: 20, color: rgba(C.dim, 0.55), track: 10 });
    }

    if (audio.muted) {
      text(ctx, 'SOUND IS OFF — UNMUTE IN SETTINGS', cx, 44, { size: 13, color: C.danger, track: 3 });
    }

    const pipW = 46;
    const total = SOUND_TRIALS * pipW;
    for (let i = 0; i < SOUND_TRIALS; i++) {
      const x = cx - total / 2 + i * pipW + pipW / 2;
      const v = this.trials[i];
      ctx.fillStyle = v === undefined ? 'rgba(255,255,255,0.09)' : v >= 1500 ? C.danger : C.violet;
      ctx.fillRect(x - 16, h - 44, 32, 3);
      if (v !== undefined && v < 1500) {
        text(ctx, String(Math.round(v)), x, h - 58, { size: 11, color: C.faint, font: 'mono' });
      }
    }
  }

  finished(): boolean {
    return this.phase === 'done';
  }

  result(): TestResult {
    const good = this.trials.filter((v) => v < SOUND_MISS);
    const med = median(good);
    const penalty = this.falseCalls * 20;
    return {
      primary: (good.length ? med : SOUND_MISS) + penalty,
      trials: this.trials,
      stats: [
        { label: 'Best', value: good.length ? Math.min(...good) : 0, format: 'ms', direction: 'lower' },
        { label: 'Wrong sound', value: this.falseCalls, format: 'int', direction: 'lower' },
        { label: 'Missed', value: this.missed, format: 'int', direction: 'lower' },
      ],
      notes: [
        this.falseCalls > 0
          ? `${this.falseCalls} reaction${this.falseCalls > 1 ? 's' : ''} to the wrong sound. In game that is a Flash spent on a minion dying.`
          : 'You never reacted to a decoy. That is the harder half of this test.',
        good.length && median(good) < 260
          ? 'Your ears are ahead of your eyes — most people are, and most people never use it.'
          : 'Audio cues arrive earlier than visual ones. Learning them is free reaction time.',
      ],
    };
  }
}

/* =========================================================== CAST REFLEX == */

const CAST_TRIALS = 12;
const CAST_MISS = 1800;
const CAST_KEYS = ['Q', 'W', 'E', 'R', 'D', 'F'] as const;
const CAST_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyD', 'KeyF'];

/** Choice reaction across the real ability row. Wrong key hurts more than slow. */
export class KeyCastTest implements TestRunner {
  readonly usesKeys = true;
  readonly cursor = 'none' as const;

  private phase: Phase = 'arm';
  private timer = 0;
  private wait = 0;
  private target = 0;
  private trials: number[] = [];
  private wrong = 0;
  private strikes = 0;
  private lastMs = 0;
  private lastWrong = false;
  private litFade: number[] = CAST_KEYS.map(() => 0);
  private floats: FloatText[] = [];

  constructor(private rng: Rng) {
    this.arm();
  }

  private arm(): void {
    this.phase = 'arm';
    this.timer = 0;
    this.wait = this.rng.range(0.65, 1.9);
    this.target = this.rng.int(0, CAST_KEYS.length);
  }

  prompt(): string {
    if (this.phase === 'cue') return `CAST ${CAST_KEYS[this.target]}`;
    if (this.phase === 'feedback') return this.lastWrong ? 'WRONG KEY' : `${Math.round(this.lastMs)}ms`;
    return 'READY — watch the bar';
  }

  progress(): number {
    return this.trials.length / CAST_TRIALS;
  }

  keyDown(code: string): void {
    const idx = CAST_CODES.indexOf(code);
    if (idx < 0) return;
    if (this.phase !== 'cue') {
      if (this.phase === 'arm') {
        // Casting before the bar lights is the same mistake as casting the
        // wrong key, and after three in a row it costs the trial rather than
        // resetting it forever.
        this.wrong++;
        this.strikes++;
        if (this.strikes >= 3) {
          this.trials.push(CAST_MISS);
          this.strikes = 0;
        }
        this.lastWrong = true;
        this.phase = 'feedback';
        this.timer = 0;
        audio.play('castRefuse', 0.8);
      }
      return;
    }
    this.litFade[idx] = 1;
    if (idx !== this.target) {
      this.wrong++;
      this.lastWrong = true;
      this.trials.push(this.timer * 1000 + 250);
      this.strikes = 0;
      this.phase = 'feedback';
      this.timer = 0;
      audio.play('castRefuse', 0.95);
      return;
    }
    const ms = this.timer * 1000;
    this.trials.push(ms);
    this.strikes = 0;
    this.lastMs = ms;
    this.lastWrong = false;
    this.phase = 'feedback';
    this.timer = 0;
    audio.play((['castQ', 'castW', 'castE', 'castR', 'castSummoner', 'castSummoner'] as const)[idx], 0.9);
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.timer += f.dt;
    for (let i = 0; i < this.litFade.length; i++) {
      this.litFade[i] = Math.max(0, this.litFade[i] - f.dt * 2.6);
    }
    floatsUpdate(this.floats, f.dt);

    if (this.phase === 'arm' && this.timer >= this.wait) {
      this.phase = 'cue';
      this.timer = 0;
      audio.play('abilityReady', 0.7);
    } else if (this.phase === 'cue' && this.timer > 1.8) {
      this.trials.push(CAST_MISS);
      this.strikes = 0;
      this.lastWrong = false;
      this.lastMs = CAST_MISS;
      this.phase = 'feedback';
      this.timer = 0;
    } else if (this.phase === 'feedback' && this.timer > 0.55) {
      if (this.trials.length >= CAST_TRIALS) this.phase = 'done';
      else this.arm();
    }

    /* ------------------------------------------------------------- draw */
    field(ctx, w, h, C.cyanHot);
    const cx = w / 2;
    const cy = h / 2;

    // The champion whose bar this is — gives the keycaps somewhere to belong.
    champ(ctx, cx, cy - 96, 30, { color: C.cyanHot, glyph: '△', hp: 0.72 });

    const size = 62;
    const gap = 14;
    const total = CAST_KEYS.length * size + (CAST_KEYS.length - 1) * gap;
    CAST_KEYS.forEach((k, i) => {
      const x = cx - total / 2 + i * (size + gap) + size / 2;
      const cued = this.phase === 'cue' && i === this.target;
      keycap(ctx, x, cy + 30, size, k, {
        lit: Math.max(cued ? 1 : 0, this.litFade[i]),
        color: i < 4 ? C.cyanHot : C.gold,
        sub: i < 4 ? 'ABILITY' : 'SUMM',
      });
    });

    if (this.phase === 'feedback') {
      text(ctx, this.lastWrong ? 'WRONG KEY' : `${Math.round(this.lastMs)}`, cx, cy + 128, {
        size: this.lastWrong ? 26 : 44,
        color: this.lastWrong ? C.danger : C.cyanHot,
        font: this.lastWrong ? 'ui' : 'mono',
        track: this.lastWrong ? 8 : 0,
      });
    }

    floatsDraw(ctx, this.floats);

    const pipW = 30;
    const total2 = CAST_TRIALS * pipW;
    for (let i = 0; i < CAST_TRIALS; i++) {
      const x = cx - total2 / 2 + i * pipW + pipW / 2;
      const v = this.trials[i];
      ctx.fillStyle = v === undefined ? 'rgba(255,255,255,0.09)' : v < 420 ? C.cyanHot : C.dim;
      ctx.fillRect(x - 11, h - 40, 22, 3);
    }
  }

  finished(): boolean {
    return this.phase === 'done';
  }

  result(): TestResult {
    const med = median(this.trials);
    const acc = this.trials.length ? 1 - this.wrong / (this.trials.length + this.wrong) : 0;
    return {
      primary: med,
      trials: this.trials,
      stats: [
        { label: 'Best', value: this.trials.length ? Math.min(...this.trials) : 0, format: 'ms', direction: 'lower' },
        { label: 'Key accuracy', value: acc, format: 'pct', direction: 'higher' },
        { label: 'Wrong keys', value: this.wrong, format: 'int', direction: 'lower' },
      ],
      notes: [
        this.wrong > 2
          ? 'Wrong keys, not slow keys, are what is costing you here. Slow down two hundred milliseconds and the score goes up.'
          : 'Clean key discrimination — you are pressing what you read.',
        'Choice reaction runs roughly 100ms behind simple reaction. That gap is exactly why binds should be muscle memory.',
      ],
    };
  }
}

/* ============================================================ DODGE READ == */

const DODGE_TRIALS = 10;
/** What being hit costs, whether you stood still or ran the wrong way. */
const DODGE_HIT = 1100;
/** Which way the skillshot is travelling, and therefore which keys are safe. */
const AXES = [
  { name: 'W', from: Math.PI, safe: ['KeyW', 'KeyS'] },
  { name: 'E', from: 0, safe: ['KeyW', 'KeyS'] },
  { name: 'N', from: -Math.PI / 2, safe: ['KeyA', 'KeyD'] },
  { name: 'S', from: Math.PI / 2, safe: ['KeyA', 'KeyD'] },
] as const;

/**
 * Spatial choice reaction with one League-specific rule baked in: you dodge
 * *across* a skillshot, never along it. Pressing a key that moves you down the
 * line of the missile is scored as a hit even though you moved.
 */
export class DodgeReadTest implements TestRunner {
  readonly usesKeys = true;
  readonly cursor = 'none' as const;

  private phase: Phase = 'arm';
  private timer = 0;
  private wait = 0;
  private axis = 0;
  private trials: number[] = [];
  /** Reaction times of the dodges that actually worked. */
  private clean: number[] = [];
  private wrongWay = 0;
  private hit = 0;
  private lastMs = 0;
  private lastVerdict: 'clean' | 'wrong' | 'hit' = 'clean';
  private slide = { x: 0, y: 0 };
  private ripples: Ripple[] = [];

  constructor(private rng: Rng) {
    this.arm();
  }

  /** The window shrinks as the run goes on: late trials are Diamond speed. */
  private get window(): number {
    return 0.62 - 0.26 * (this.trials.length / DODGE_TRIALS);
  }

  private arm(): void {
    this.phase = 'arm';
    this.timer = 0;
    this.wait = this.rng.range(0.7, 2.1);
    this.axis = this.rng.int(0, AXES.length);
    this.slide = { x: 0, y: 0 };
  }

  prompt(): string {
    if (this.phase === 'cue') return 'SIDESTEP';
    if (this.phase === 'feedback') {
      if (this.lastVerdict === 'wrong') return 'You moved along the skillshot, not across it.';
      if (this.lastVerdict === 'hit') return 'HIT — too slow';
      return `${Math.round(this.lastMs)}ms`;
    }
    return 'HOLD — read the angle';
  }

  progress(): number {
    return this.trials.length / DODGE_TRIALS;
  }

  keyDown(code: string): void {
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)) return;
    if (this.phase !== 'cue') return;
    const a = AXES[this.axis];
    const ms = this.timer * 1000;
    const dir: Record<string, [number, number]> = {
      KeyW: [0, -1],
      KeyS: [0, 1],
      KeyA: [-1, 0],
      KeyD: [1, 0],
    };
    this.slide = { x: dir[code][0], y: dir[code][1] };

    if ((a.safe as readonly string[]).includes(code)) {
      this.trials.push(ms);
      this.clean.push(ms);
      this.lastMs = ms;
      this.lastVerdict = 'clean';
      audio.play('dodge', 0.95);
    } else {
      // Moving down the line of the missile is not a slow dodge. It is a hit,
      // and it is worth exactly what standing still is worth.
      this.wrongWay++;
      this.trials.push(DODGE_HIT);
      this.lastVerdict = 'wrong';
      audio.play('hurt', 0.8);
    }
    this.phase = 'feedback';
    this.timer = 0;
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.timer += f.dt;
    rippleUpdate(this.ripples, f.dt);

    if (this.phase === 'arm' && this.timer >= this.wait) {
      this.phase = 'cue';
      this.timer = 0;
      audio.play('enemyCast', 0.85);
    } else if (this.phase === 'cue' && this.timer > this.window + 0.5) {
      this.hit++;
      this.trials.push(DODGE_HIT);
      this.lastVerdict = 'hit';
      this.phase = 'feedback';
      this.timer = 0;
      audio.play('hurt', 1);
    } else if (this.phase === 'feedback' && this.timer > 0.7) {
      if (this.trials.length >= DODGE_TRIALS) this.phase = 'done';
      else this.arm();
    }

    /* ------------------------------------------------------------- draw */
    field(ctx, w, h, C.good);
    const cx = w / 2;
    const cy = h / 2;
    const a = AXES[this.axis];

    const px = cx + this.slide.x * easeOut(this.timer * 4) * 74;
    const py = cy + this.slide.y * easeOut(this.timer * 4) * 74;

    if (this.phase === 'cue' || this.phase === 'feedback') {
      const charge = clamp(this.timer / this.window, 0, 1);
      const reach = Math.max(w, h);
      const ox = cx - Math.cos(a.from) * reach * 0.5;
      const oy = cy - Math.sin(a.from) * reach * 0.5;
      lineTelegraph(ctx, ox, oy, a.from, reach, 96, this.phase === 'cue' ? charge : 1);

      if (this.phase === 'feedback' && this.lastVerdict !== 'clean') {
        ctx.fillStyle = rgba(C.danger, 0.14);
        ctx.fillRect(0, 0, w, h);
      }
    }

    // The safe axis, drawn only after the fact — showing it live would answer
    // the question the test is asking.
    if (this.phase === 'feedback') {
      const horiz = (a.safe as readonly string[]).includes('KeyA');
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = rgba(C.good, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (horiz) {
        ctx.moveTo(cx - 190, cy);
        ctx.lineTo(cx + 190, cy);
      } else {
        ctx.moveTo(cx, cy - 190);
        ctx.lineTo(cx, cy + 190);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    champ(ctx, px, py, 26, {
      color: this.lastVerdict === 'clean' || this.phase !== 'feedback' ? C.cyanHot : C.danger,
      glyph: '◆',
    });

    // WASD rose, so the mapping is never in question.
    const kp = 34;
    const bx = w - 108;
    const by = h - 92;
    keycap(ctx, bx, by - kp - 4, kp, 'W', { dim: true });
    keycap(ctx, bx - kp - 4, by, kp, 'A', { dim: true });
    keycap(ctx, bx, by, kp, 'S', { dim: true });
    keycap(ctx, bx + kp + 4, by, kp, 'D', { dim: true });

    if (this.phase === 'feedback') {
      text(
        ctx,
        this.lastVerdict === 'clean' ? `${Math.round(this.lastMs)}` : this.lastVerdict === 'wrong' ? 'ALONG THE LINE' : 'HIT',
        cx,
        h - 78,
        {
          size: this.lastVerdict === 'clean' ? 40 : 24,
          color: this.lastVerdict === 'clean' ? C.good : C.danger,
          font: this.lastVerdict === 'clean' ? 'mono' : 'ui',
          track: this.lastVerdict === 'clean' ? 0 : 8,
        },
      );
    }
    rippleDraw(ctx, this.ripples);

    const pipW = 34;
    const total = DODGE_TRIALS * pipW;
    for (let i = 0; i < DODGE_TRIALS; i++) {
      const x = cx - total / 2 + i * pipW + pipW / 2;
      const v = this.trials[i];
      ctx.fillStyle = v === undefined ? 'rgba(255,255,255,0.09)' : v < 500 ? C.good : C.dim;
      ctx.fillRect(x - 13, h - 40, 26, 3);
    }
  }

  finished(): boolean {
    return this.phase === 'done';
  }

  result(): TestResult {
    const clean = this.clean.length;
    // Milliseconds per clean dodge, not median reaction: a run is the whole
    // cost of getting through ten skillshots, and a trial you were hit on is
    // part of that cost. Answering fast in the wrong direction has to be worse
    // than answering slowly in the right one, or the fastest way to a good
    // score is to guess.
    const spent = this.clean.reduce((a, b) => a + b, 0) + (this.wrongWay + this.hit) * DODGE_HIT;
    return {
      primary: clean > 0 ? spent / clean : DODGE_HIT,
      trials: this.trials,
      stats: [
        { label: 'Clean dodges', value: clean, format: 'int', direction: 'higher' },
        { label: 'Dodged into it', value: this.wrongWay, format: 'int', direction: 'lower' },
        { label: 'Hit', value: this.hit, format: 'int', direction: 'lower' },
      ],
      notes: [
        this.wrongWay > 1
          ? 'You are moving away from the caster instead of across the missile. Away is the direction the skillshot is already going.'
          : 'You sidestepped rather than ran. That is the whole skill.',
        'The window shrinks through the run — the last trials are cast at speeds you meet in Diamond.',
      ],
    };
  }
}
