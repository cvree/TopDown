/**
 * The precision family.
 *
 * Where the cursor lands, and when the key goes down. These four are the tests
 * that most directly rehearse the two motor skills a MOBA actually taxes:
 * putting a point on a moving thing, and putting an input on a moment.
 */

import { audio } from '../engine/audio';
import { clamp, damp } from '../engine/math';
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
  hpBar,
  keycap,
  median,
  pop,
  rgba,
  ring,
  rippleDraw,
  rippleUpdate,
  say,
  stdev,
  text,
  type FloatText,
  type Ripple,
} from './kit';
import type { Frame, TestResult, TestRunner } from './types';

/* ================================================================ FLICK == */

const FLICK_TARGETS = 18;

/** Target acquisition. One target at a time, always a real distance away. */
export class FlickTest implements TestRunner {
  readonly cursor = 'crosshair' as const;

  private target = { x: 0, y: 0, r: 22 };
  private spawnedAt = 0;
  private hits: number[] = [];
  private misses = 0;
  private ripples: Ripple[] = [];
  private floats: FloatText[] = [];
  private t = 0;
  private placed = false;
  private lastMs = 0;

  constructor(private rng: Rng) {}

  private place(w: number, h: number): void {
    const m = 70;
    // The bottom strip carries the counter; a target under it would be a
    // target you have to read text through.
    const bottom = h - 82;
    const prev = { ...this.target };
    for (let i = 0; i < 60; i++) {
      const x = this.rng.range(m, w - m);
      const y = this.rng.range(m, bottom);
      // A target that spawns under the cursor measures nothing, so every
      // target is a real flick away from the last one.
      if (!this.placed || Math.hypot(x - prev.x, y - prev.y) > Math.min(w, h) * 0.34) {
        this.target = { x, y, r: this.rng.range(15, 27) };
        this.placed = true;
        this.spawnedAt = this.t;
        return;
      }
    }
    this.target = { x: w / 2, y: h / 2, r: 20 };
    this.spawnedAt = this.t;
    this.placed = true;
  }

  prompt(): string {
    if (this.hits.length === 0 && this.misses === 0) return 'CLICK THE CHAMPION';
    return `${this.hits.length} / ${FLICK_TARGETS} · ${Math.round(this.lastMs)}ms`;
  }

  progress(): number {
    return this.hits.length / FLICK_TARGETS;
  }

  pointerDown(x: number, y: number): void {
    if (!this.placed || this.finished()) return;
    const d = Math.hypot(x - this.target.x, y - this.target.y);
    if (d <= this.target.r + 4) {
      const ms = (this.t - this.spawnedAt) * 1000;
      this.hits.push(ms);
      this.lastMs = ms;
      pop(this.ripples, this.target.x, this.target.y, C.cyanHot, 62, 0.4);
      say(this.floats, this.target.x, this.target.y - 26, `${Math.round(ms)}`, C.cyanHot, 15);
      audio.play('kill', 0.55);
      this.placed = false;
    } else {
      this.misses++;
      pop(this.ripples, x, y, C.danger, 34, 0.3);
      audio.play('attackCancel', 0.5);
    }
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.t = f.t;
    rippleUpdate(this.ripples, f.dt);
    floatsUpdate(this.floats, f.dt);
    if (!this.placed && !this.finished()) this.place(w, h);

    field(ctx, w, h, C.cyanHot);

    if (this.placed && !this.finished()) {
      const age = this.t - this.spawnedAt;
      const grow = easeOut(clamp(age / 0.12, 0, 1));
      const tgt = this.target;
      // A closing lock ring: the longer it takes you, the tighter it gets, so
      // slowness is visible rather than merely recorded.
      ring(ctx, tgt.x, tgt.y, tgt.r + 34 - Math.min(28, age * 26), rgba(C.gold, 0.35), 1);
      champ(ctx, tgt.x, tgt.y, tgt.r * grow, {
        color: C.danger,
        glyph: '✦',
        hp: 1,
        selected: true,
      });
    }

    rippleDraw(ctx, this.ripples);
    floatsDraw(ctx, this.floats);

    // Crosshair. The system cursor is hidden — a drawn one is legible on any
    // background and, more usefully, has no lag against what we measure.
    if (f.mouse.inside) {
      ctx.strokeStyle = rgba(C.goldHot, 0.85);
      ctx.lineWidth = 1;
      const { x, y } = f.mouse;
      ctx.beginPath();
      ctx.moveTo(x - 11, y);
      ctx.lineTo(x - 3, y);
      ctx.moveTo(x + 3, y);
      ctx.lineTo(x + 11, y);
      ctx.moveTo(x, y - 11);
      ctx.lineTo(x, y - 3);
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x, y + 11);
      ctx.stroke();
    }

    text(ctx, `${this.hits.length} / ${FLICK_TARGETS}`, w / 2, h - 40, {
      size: 15,
      color: C.faint,
      font: 'mono',
    });
  }

  finished(): boolean {
    // The hard stop exists so a run that is abandoned mid-way still resolves
    // instead of sitting on screen forever waiting for a click.
    return this.hits.length >= FLICK_TARGETS || this.t > 60;
  }

  result(): TestResult {
    const med = this.hits.length ? median(this.hits) : 960;
    const shots = this.hits.length + this.misses;
    const acc = shots ? this.hits.length / shots : 0;
    const totalS = this.hits.reduce((a, b) => a + b, 0) / 1000;
    return {
      // A miss is a wasted right-click. It costs you the same way in lane.
      primary: med + this.misses * 20,
      trials: this.hits,
      stats: [
        { label: 'Accuracy', value: acc, format: 'pct', direction: 'higher' },
        { label: 'Targets / min', value: totalS > 0 ? (this.hits.length / totalS) * 60 : 0, format: 'int', direction: 'higher' },
        { label: 'Misses', value: this.misses, format: 'int', direction: 'lower' },
      ],
      notes: [
        acc < 0.85
          ? 'You are outrunning your accuracy. Every miss here is a right-click that went to the ground in a fight.'
          : 'Clean acquisition — almost every click landed on the target.',
        stdev(this.hits) > 190
          ? 'Wide spread: some flicks are instant and some are hunts. The hunts are the ones to fix.'
          : 'Consistent flicks, which matters more than fast ones.',
      ],
    };
  }
}

/* =========================================================== PREDICTION == */

const LEAD_SHOTS = 12;

interface Missile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  dead: boolean;
}

/**
 * Skillshot lead. Your missile has travel time and the target does not stop
 * for it, so the only aim point that works is the one where they *will* be.
 *
 * The target holds a straight line while a missile is live — a juke mid-flight
 * would make this a luck test rather than a prediction test.
 */
export class LeadTest implements TestRunner {
  readonly cursor = 'crosshair' as const;

  private caster = { x: 0, y: 0 };
  private tgt = { x: 0, y: 0, vx: 0, vy: 0, r: 20 };
  private missile: Missile | null = null;
  private shots = 0;
  private hitsCount = 0;
  private leadErrors: number[] = [];
  private streak = 0;
  private bestStreak = 0;
  private ripples: Ripple[] = [];
  private floats: FloatText[] = [];
  private cooldown = 0;
  private inited = false;
  private lastHit: boolean | null = null;
  private t = 0;
  /**
   * Shots *resolved*, not shots fired. The speeds below are read both when you
   * aim and while the missile flies, so they must not change the instant you
   * click — a target that speeds up mid-flight makes a correct lead miss.
   */
  private level = 0;

  constructor(private rng: Rng) {}

  /** Missile speed falls and target speed rises as the run goes on. */
  private get missileSpeed(): number {
    return 620 - 150 * (this.level / LEAD_SHOTS);
  }
  private get targetSpeed(): number {
    return 190 + 170 * (this.level / LEAD_SHOTS);
  }

  private init(w: number, h: number): void {
    this.caster = { x: w / 2, y: h - 74 };
    this.tgt = { x: w * 0.3, y: h * 0.35, vx: 1, vy: 0, r: 20 };
    this.reroute(w, h);
    this.inited = true;
  }

  /**
   * Pick a heading with enough clear runway to hold it for a whole missile
   * flight. Bouncing off a wall mid-flight would make a correctly led shot
   * miss, which turns a prediction test into a coin flip.
   */
  private reroute(w: number, h: number): void {
    const m = 60;
    const floor = h * 0.62;
    const runway = (dx: number, dy: number): number => {
      const tx = dx > 0 ? (w - m - this.tgt.x) / dx : dx < 0 ? (m - this.tgt.x) / dx : Infinity;
      const ty = dy > 0 ? (floor - this.tgt.y) / dy : dy < 0 ? (m - this.tgt.y) / dy : Infinity;
      return Math.min(tx, ty) / this.targetSpeed;
    };
    let best = { x: 0, y: 0, t: -1 };
    for (let i = 0; i < 40; i++) {
      const a = this.rng.angle();
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const t = runway(dx, dy);
      if (t >= 2.4) {
        this.tgt.vx = dx;
        this.tgt.vy = dy;
        return;
      }
      if (t > best.t) best = { x: dx, y: dy, t };
    }
    this.tgt.vx = best.x;
    this.tgt.vy = best.y;
  }

  /**
   * Where the missile and the target meet, if both hold. Solving this is what
   * your hands are doing when a skillshot lands; seeing the answer afterwards
   * is how you learn to feel it.
   */
  private intercept(): { x: number; y: number } | null {
    const s = this.missileSpeed;
    const vx = this.tgt.vx * this.targetSpeed;
    const vy = this.tgt.vy * this.targetSpeed;
    const dx = this.tgt.x - this.caster.x;
    const dy = this.tgt.y - this.caster.y;
    const a = vx * vx + vy * vy - s * s;
    const b = 2 * (dx * vx + dy * vy);
    const c = dx * dx + dy * dy;
    let t: number;
    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) < 1e-6) return null;
      t = -c / b;
    } else {
      const disc2 = b * b - 4 * a * c;
      if (disc2 < 0) return null;
      const root = Math.sqrt(disc2);
      const t1 = (-b + root) / (2 * a);
      const t2 = (-b - root) / (2 * a);
      const cands = [t1, t2].filter((v) => v > 0);
      if (cands.length === 0) return null;
      t = Math.min(...cands);
    }
    return { x: this.tgt.x + vx * t, y: this.tgt.y + vy * t };
  }

  prompt(): string {
    if (this.missile) return 'IN FLIGHT';
    if (this.lastHit === null) return 'CLICK WHERE THEY WILL BE';
    return this.lastHit ? 'HIT' : 'MISSED — you aimed at where they were';
  }

  progress(): number {
    return this.shots / LEAD_SHOTS;
  }

  pointerDown(x: number, y: number): void {
    if (this.missile || this.cooldown > 0 || this.finished()) return;
    const ideal = this.intercept();
    if (ideal) this.leadErrors.push(Math.hypot(x - ideal.x, y - ideal.y));

    const dx = x - this.caster.x;
    const dy = y - this.caster.y;
    const d = Math.hypot(dx, dy) || 1;
    const s = this.missileSpeed;
    this.missile = {
      x: this.caster.x,
      y: this.caster.y,
      vx: (dx / d) * s,
      vy: (dy / d) * s,
      life: 0,
      max: 2.2,
      dead: false,
    };
    this.shots++;
    audio.play('castQ', 0.85);
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.t = f.t;
    if (!this.inited) this.init(w, h);
    rippleUpdate(this.ripples, f.dt);
    floatsUpdate(this.floats, f.dt);
    if (this.cooldown > 0) this.cooldown -= f.dt;

    /* ---------------------------------------------------------- simulate */
    const sp = this.targetSpeed;
    this.tgt.x += this.tgt.vx * sp * f.dt;
    this.tgt.y += this.tgt.vy * sp * f.dt;
    const m = 60;
    if (this.tgt.x < m || this.tgt.x > w - m) {
      this.tgt.vx *= -1;
      this.tgt.x = clamp(this.tgt.x, m, w - m);
    }
    // Kept off the caster's half: a target standing on top of you is not a
    // prediction problem, it is a free hit.
    const floor = h * 0.62;
    if (this.tgt.y < m || this.tgt.y > floor) {
      this.tgt.vy *= -1;
      this.tgt.y = clamp(this.tgt.y, m, floor);
    }

    if (this.missile) {
      const mi = this.missile;
      const steps = 4; // sub-step so a fast missile can't tunnel through
      for (let i = 0; i < steps && !mi.dead; i++) {
        const dt = f.dt / steps;
        mi.x += mi.vx * dt;
        mi.y += mi.vy * dt;
        mi.life += dt;
        if (Math.hypot(mi.x - this.tgt.x, mi.y - this.tgt.y) <= this.tgt.r + 9) {
          mi.dead = true;
          this.hitsCount++;
          this.streak++;
          this.bestStreak = Math.max(this.bestStreak, this.streak);
          this.lastHit = true;
          pop(this.ripples, this.tgt.x, this.tgt.y, C.goldHot, 90, 0.5);
          say(this.floats, this.tgt.x, this.tgt.y - 34, 'HIT', C.goldHot, 17);
          audio.play('perfect', 0.7);
        } else if (mi.x < -40 || mi.x > w + 40 || mi.y < -40 || mi.y > h + 40 || mi.life > mi.max) {
          mi.dead = true;
          this.streak = 0;
          this.lastHit = false;
          audio.play('nearMiss', 0.5);
        }
      }
      if (mi.dead) {
        this.missile = null;
        this.cooldown = 0.45;
        // The difficulty step happens here, between shots, for the same reason
        // the heading does: nothing may change while a missile is in the air.
        this.level = this.shots;
        this.reroute(w, h);
      }
    }

    /* -------------------------------------------------------------- draw */
    field(ctx, w, h, '#ff6bd6');

    // The caster's cast range, so the geometry of the shot is legible.
    ctx.setLineDash([4, 9]);
    ring(ctx, this.caster.x, this.caster.y, Math.min(520, h * 0.86), rgba(C.gold, 0.16), 1);
    ctx.setLineDash([]);

    // Where they are going, drawn as the ghost trail the client never shows you.
    ctx.strokeStyle = rgba('#ff6bd6', 0.22);
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(this.tgt.x, this.tgt.y);
    ctx.lineTo(this.tgt.x + this.tgt.vx * sp * 0.55, this.tgt.y + this.tgt.vy * sp * 0.55);
    ctx.stroke();
    ctx.setLineDash([]);

    champ(ctx, this.caster.x, this.caster.y, 22, { color: C.cyanHot, glyph: '✧' });
    champ(ctx, this.tgt.x, this.tgt.y, this.tgt.r, { color: '#ff6bd6', glyph: '✦', hp: 1 });

    if (this.missile) {
      const mi = this.missile;
      glow(ctx, mi.x, mi.y, 26, C.goldHot, 0.6);
      disc(ctx, mi.x, mi.y, 7, C.goldHot);
      ctx.strokeStyle = rgba(C.gold, 0.5);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(mi.x - mi.vx * 0.045, mi.y - mi.vy * 0.045);
      ctx.lineTo(mi.x, mi.y);
      ctx.stroke();
    }

    rippleDraw(ctx, this.ripples);
    floatsDraw(ctx, this.floats);

    if (f.mouse.inside && !this.missile) {
      ring(ctx, f.mouse.x, f.mouse.y, 13, rgba(C.goldHot, 0.8), 1.5);
      disc(ctx, f.mouse.x, f.mouse.y, 2, C.goldHot);
    }

    text(ctx, `${this.hitsCount} / ${this.shots}   ·   ${LEAD_SHOTS - this.shots} LEFT`, w / 2, h - 34, {
      size: 13,
      color: C.faint,
      font: 'mono',
    });
  }

  finished(): boolean {
    // Same reasoning as Flick: without this, a run nobody is shooting in never
    // ends on its own.
    return (this.shots >= LEAD_SHOTS || this.t > 75) && !this.missile;
  }

  result(): TestResult {
    const rate = this.shots ? this.hitsCount / this.shots : 0;
    return {
      primary: rate,
      trials: this.leadErrors,
      stats: [
        { label: 'Best streak', value: this.bestStreak, format: 'int', direction: 'higher' },
        { label: 'Median lead error', value: median(this.leadErrors), format: 'units', direction: 'lower' },
        { label: 'Shots', value: this.shots, format: 'int', direction: 'higher' },
      ],
      notes: [
        median(this.leadErrors) > 90
          ? 'Your aim points sit behind the target. You are clicking the champion, not the interception.'
          : 'You are aiming ahead of them, which is the only way a travel-time skillshot ever lands.',
        'The missile slows and the target speeds up through the run. The last shots are the ones worth reading.',
      ],
    };
  }
}

/* ======================================================= LAST HIT CLOCK == */

const CS_TRIALS = 12;

/**
 * Attack timing against a falling health bar, with your own windup in the way.
 *
 * The gold band on the bar is the health your shot would kill through. Fire so
 * the shot *lands* inside it: too early and you hit a healthy minion, too late
 * and the wave takes it. The band narrows every trial.
 */
export class CsClockTest implements TestRunner {
  readonly usesKeys = true;
  readonly cursor = 'none' as const;

  private trial = 0;
  private phase: 'fall' | 'windup' | 'settle' = 'fall';
  private timer = 0;
  private fallTime = 2.4;
  private bandStart = 0;
  private bandEnd = 0;
  private windup = 0.18;
  private pressAt = 0;
  private errors: number[] = [];
  private inBand = 0;
  private lastErr = 0;
  private lastGood = false;
  private ripples: Ripple[] = [];
  private floats: FloatText[] = [];

  constructor(private rng: Rng) {
    this.setup();
  }

  private setup(): void {
    this.phase = 'fall';
    this.timer = 0;
    this.fallTime = this.rng.range(1.8, 3.1);
    // 260ms of window at the start, 110ms by the last minion.
    const width = 0.26 - 0.15 * (this.trial / CS_TRIALS);
    this.bandEnd = this.fallTime;
    this.bandStart = this.fallTime - width;
    this.windup = this.rng.range(0.14, 0.24);
  }

  prompt(): string {
    if (this.phase === 'settle') {
      return this.lastGood
        ? `LAST HIT — ${this.lastErr >= 0 ? '+' : ''}${Math.round(this.lastErr)}ms`
        : this.lastErr < 0
          ? 'EARLY — you hit a healthy minion'
          : 'LATE — the wave took it';
    }
    return 'SPACE to attack — land inside the gold';
  }

  progress(): number {
    return this.trial / CS_TRIALS;
  }

  keyDown(code: string): void {
    if (code !== 'Space' || this.phase !== 'fall') return;
    this.pressAt = this.timer;
    this.phase = 'windup';
    audio.play('attackWindup', 0.8);
  }

  private land(): void {
    const landT = this.pressAt + this.windup;
    const centre = (this.bandStart + this.bandEnd) / 2;
    const err = (landT - centre) * 1000;
    this.errors.push(Math.abs(err));
    this.lastErr = err;
    this.lastGood = landT >= this.bandStart && landT <= this.bandEnd;
    if (this.lastGood) this.inBand++;
    audio.play(this.lastGood ? 'kill' : 'attackCancel', this.lastGood ? 0.85 : 0.6);
    this.phase = 'settle';
    this.timer = 0;
    this.trial++;
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.timer += f.dt;
    rippleUpdate(this.ripples, f.dt);
    floatsUpdate(this.floats, f.dt);

    if (this.phase === 'fall') {
      // Let it fall past zero for a beat, so "too late" is a real outcome you
      // watch happen rather than a message.
      if (this.timer > this.fallTime + 0.28) {
        this.pressAt = this.timer;
        this.windup = 0;
        this.land();
      }
    } else if (this.phase === 'windup') {
      if (this.timer >= this.pressAt + this.windup) this.land();
    } else if (this.timer > 0.9) {
      if (this.trial >= CS_TRIALS) return;
      this.setup();
    }

    /* -------------------------------------------------------------- draw */
    field(ctx, w, h, C.warn);
    const cx = w / 2;
    const cy = h / 2 - 10;

    const shown = this.phase === 'settle' ? clamp(1 - this.pressAt / this.fallTime, 0, 1) : clamp(1 - this.timer / this.fallTime, 0, 1);
    const alive = shown > 0 || this.phase !== 'settle';

    if (alive) {
      champ(ctx, cx, cy, 30, {
        color: this.phase === 'settle' && this.lastGood ? C.warn : C.danger,
        glyph: '▣',
      });
    }

    // The big bar. This is the instrument; the token above it is scenery.
    const bw = Math.min(560, w - 160);
    const bx = cx - bw / 2;
    const by = cy + 78;
    const killable = shown <= (this.bandEnd - this.bandStart) / this.fallTime;
    hpBar(ctx, bx, by, bw, 22, shown, killable ? C.warn : C.good, 10);

    // The killable band, painted where your damage reaches. Labelled under the
    // bar rather than across it — a caption sitting on top of the health fill
    // is the one thing you cannot afford to have to read around.
    const bandFrac = (this.bandEnd - this.bandStart) / this.fallTime;
    const bandX = bx + bw * bandFrac;
    ctx.fillStyle = rgba(C.gold, 0.3);
    ctx.fillRect(bx, by, bw * bandFrac, 22);
    ctx.strokeStyle = rgba(C.goldHot, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bandX, by - 5);
    ctx.lineTo(bandX, by + 27);
    ctx.stroke();
    text(ctx, '↤ YOUR DAMAGE REACHES HERE', bandX + 9, by + 40, {
      size: 10,
      color: C.gold,
      align: 'left',
      track: 2,
    });
    text(ctx, `${Math.round(shown * 100)}%`, bx - 12, by + 11, {
      size: 13,
      color: shown <= bandFrac ? C.warn : C.dim,
      align: 'right',
      font: 'mono',
    });

    // Windup: the one thing that makes this hard, so it is drawn plainly.
    if (this.phase === 'windup') {
      const k = clamp((this.timer - this.pressAt) / this.windup, 0, 1);
      ctx.fillStyle = rgba(C.cyanHot, 0.9);
      ctx.fillRect(bx, by + 58, bw * k, 5);
      text(ctx, 'WINDUP', bx, by + 76, { size: 10, color: C.cyanHot, align: 'left', track: 3 });
    }

    if (this.phase === 'settle') {
      const good = this.lastGood;
      text(
        ctx,
        good ? `${this.lastErr >= 0 ? '+' : ''}${Math.round(this.lastErr)}ms` : this.lastErr < 0 ? 'EARLY' : 'LATE',
        cx,
        cy - 96,
        { size: good ? 40 : 32, color: good ? C.warn : C.danger, font: good ? 'mono' : 'display', track: good ? 0 : 6 },
      );
    }

    keycap(ctx, cx, h - 74, 44, '␣', { lit: this.phase === 'windup' ? 1 : 0, sub: 'ATTACK' });

    const pipW = 30;
    const total = CS_TRIALS * pipW;
    for (let i = 0; i < CS_TRIALS; i++) {
      const x = cx - total / 2 + i * pipW + pipW / 2;
      const v = this.errors[i];
      ctx.fillStyle = v === undefined ? 'rgba(255,255,255,0.09)' : v < 70 ? C.warn : C.dim;
      ctx.fillRect(x - 11, h - 26, 22, 3);
    }
  }

  finished(): boolean {
    return this.trial >= CS_TRIALS && this.phase === 'settle' && this.timer > 0.9;
  }

  result(): TestResult {
    return {
      primary: median(this.errors),
      trials: this.errors,
      stats: [
        { label: 'Last hits', value: this.inBand, format: 'int', direction: 'higher' },
        { label: 'CS accuracy', value: this.errors.length ? this.inBand / this.errors.length : 0, format: 'pct', direction: 'higher' },
        { label: 'Best timing', value: this.errors.length ? Math.min(...this.errors) : 0, format: 'ms', direction: 'lower' },
      ],
      notes: [
        'Your windup changes every minion on purpose. Reacting to the bar is not enough — you have to fire before the moment you want.',
        this.inBand < CS_TRIALS * 0.6
          ? 'Most misses at this level are early. Trust the bar for one more frame.'
          : 'You are firing into the band rather than at it. That is what farming under tower is.',
      ],
    };
  }
}

/* ============================================================= TRACKING == */

const TRACK_SECONDS = 26;

/** Cursor persistence against a target built to shake you off. */
export class TrackTest implements TestRunner {
  readonly cursor = 'crosshair' as const;

  private p = { x: 0, y: 0, vx: 1, vy: 0.4 };
  private onTarget = 0;
  private streak = 0;
  private bestStreak = 0;
  private breaks = 0;
  private wasOn = false;
  private turnIn = 0;
  private dashIn = 3;
  private dash = 0;
  private lock = 0;
  private inited = false;
  private samples: number[] = [];
  private sampleAcc = 0;
  private sampleOn = 0;
  private t = 0;

  constructor(private rng: Rng) {}

  private get speed(): number {
    // Starts brisk, ends genuinely evasive.
    return 200 + 250 * clamp(this.t / TRACK_SECONDS, 0, 1);
  }

  prompt(): string {
    const pct = this.t > 0.3 ? Math.round((this.onTarget / this.t) * 100) : 0;
    return `HOLD THE CURSOR ON THEM — ${pct}% ON TARGET`;
  }

  progress(): number {
    return clamp(this.t / TRACK_SECONDS, 0, 1);
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.t = f.t;
    if (!this.inited) {
      this.p = { x: w / 2, y: h / 2, vx: 1, vy: 0 };
      const a = this.rng.angle();
      this.p.vx = Math.cos(a);
      this.p.vy = Math.sin(a);
      this.inited = true;
    }

    /* ---------------------------------------------------------- simulate */
    this.turnIn -= f.dt;
    this.dashIn -= f.dt;
    if (this.turnIn <= 0) {
      // A juke, not a drift: the direction change is sharp enough to break a
      // cursor that is following rather than leading.
      const a = Math.atan2(this.p.vy, this.p.vx) + this.rng.range(-2.2, 2.2);
      this.p.vx = Math.cos(a);
      this.p.vy = Math.sin(a);
      this.turnIn = this.rng.range(0.35, 1.0);
    }
    if (this.dashIn <= 0) {
      this.dash = 0.22;
      this.dashIn = this.rng.range(2.2, 4.4);
      audio.play('dodge', 0.4);
    }
    this.dash = Math.max(0, this.dash - f.dt);

    const sp = this.speed * (this.dash > 0 ? 2.6 : 1);
    this.p.x += this.p.vx * sp * f.dt;
    this.p.y += this.p.vy * sp * f.dt;
    const m = 60;
    // The bottom band is the lock meter's; a target drifting over it would
    // be read through the readout that is measuring it.
    const floor = h - 104;
    if (this.p.x < m || this.p.x > w - m) {
      this.p.vx *= -1;
      this.p.x = clamp(this.p.x, m, w - m);
    }
    if (this.p.y < m || this.p.y > floor) {
      this.p.vy *= -1;
      this.p.y = clamp(this.p.y, m, floor);
    }

    const r = 26;
    const on = f.mouse.inside && Math.hypot(f.mouse.x - this.p.x, f.mouse.y - this.p.y) <= r + 6;
    if (on) {
      this.onTarget += f.dt;
      this.streak += f.dt;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      if (this.wasOn) this.breaks++;
      this.streak = 0;
    }
    this.wasOn = on;
    this.lock = damp(this.lock, on ? 1 : 0, 9, f.dt);

    // A second-by-second trace, so the results screen can show where you lost it.
    this.sampleAcc += f.dt;
    if (on) this.sampleOn += f.dt;
    if (this.sampleAcc >= 1) {
      this.samples.push(this.sampleOn / this.sampleAcc);
      this.sampleAcc = 0;
      this.sampleOn = 0;
    }

    /* -------------------------------------------------------------- draw */
    field(ctx, w, h, '#ff9f5c');

    if (this.lock > 0.02) {
      ctx.strokeStyle = rgba(C.goldHot, this.lock * 0.32);
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    }

    champ(ctx, this.p.x, this.p.y, r, {
      color: on ? C.goldHot : '#ff9f5c',
      glyph: '✦',
      hp: 1,
      selected: on,
    });
    ring(ctx, this.p.x, this.p.y, r + 12 + (1 - this.lock) * 10, rgba(C.gold, 0.2 + this.lock * 0.5), 1.5);

    if (this.dash > 0) glow(ctx, this.p.x, this.p.y, 90, C.warn, 0.35);

    if (f.mouse.inside) {
      if (on) {
        ctx.strokeStyle = rgba(C.goldHot, 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(f.mouse.x, f.mouse.y);
        ctx.lineTo(this.p.x, this.p.y);
        ctx.stroke();
      }
      ring(ctx, f.mouse.x, f.mouse.y, 10, rgba(on ? C.goldHot : C.dim, 0.9), 1.5);
    }

    // Lock meter along the bottom: the number you are chasing, live.
    const bw = Math.min(520, w - 140);
    const pct = this.t > 0.2 ? this.onTarget / this.t : 0;
    hpBar(ctx, w / 2 - bw / 2, h - 46, bw, 8, pct, pct > 0.7 ? C.good : pct > 0.5 ? C.warn : C.danger);
    text(ctx, `${Math.round(pct * 100)}% ON TARGET`, w / 2, h - 62, { size: 12, color: C.faint, track: 3 });
    text(ctx, `${Math.max(0, TRACK_SECONDS - this.t).toFixed(1)}s`, w / 2, h - 24, {
      size: 12,
      color: C.faint,
      font: 'mono',
    });
  }

  finished(): boolean {
    return this.t >= TRACK_SECONDS;
  }

  result(): TestResult {
    const pct = this.t > 0 ? this.onTarget / this.t : 0;
    return {
      primary: pct,
      trials: this.samples,
      stats: [
        { label: 'Longest lock', value: this.bestStreak, format: 'sec', direction: 'higher' },
        { label: 'Breaks', value: this.breaks, format: 'int', direction: 'lower' },
        { label: 'Time on target', value: this.onTarget, format: 'sec', direction: 'higher' },
      ],
      notes: [
        this.breaks > 22
          ? 'You are chasing the cursor behind them. Lead the movement — put the cursor where the champion is going.'
          : 'You are leading rather than following, which is why the lock holds through the jukes.',
        'They dash roughly every three seconds. Those are the moments the graph drops.',
      ],
    };
  }
}
