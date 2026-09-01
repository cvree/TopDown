import { clamp, easeOutCubic, easeOutQuint } from './math';
import type { Vec2 } from './types';

/**
 * Effects are pooled and purely visual — the simulation never reads them, so
 * dropping effects on a slow machine can never change a score.
 *
 * The rule for every effect here: it has to say something. Impacts read as
 * damage, rings read as range, traces read as your own path. No confetti.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  kind: 'spark' | 'dust' | 'ember' | 'shard';
  spin: number;
  angle: number;
}

export interface RingFx {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  width: number;
  kind: 'pulse' | 'impact' | 'range' | 'shock';
}

export interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
  weight: number;
}

export interface Trace {
  points: Vec2[];
  life: number;
  max: number;
  color: string;
  width: number;
}

export interface Distort {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  strength: number;
}

const MAX_PARTICLES = 1400;

export class FxSystem {
  particles: Particle[] = [];
  rings: RingFx[] = [];
  texts: FloatText[] = [];
  traces: Trace[] = [];
  distorts: Distort[] = [];

  /** Screen shake, in world units. */
  shake = 0;
  private shakeDecay = 6;
  shakeOffset: Vec2 = { x: 0, y: 0 };

  /** 0..1 — how "charged" the arena looks. Driven by the combo chain. */
  energy = 0;
  targetEnergy = 0;

  /** Brief full-arena flash, e.g. on a kill. */
  flash = 0;
  flashColor = '#ffffff';

  /** Slow-motion factor applied to *presentation only*, never to the sim. */
  timeDilation = 1;

  private rand = Math.random;

  clear(): void {
    this.particles.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.traces.length = 0;
    this.distorts.length = 0;
    this.shake = 0;
    this.energy = 0;
    this.targetEnergy = 0;
    this.flash = 0;
  }

  addShake(amount: number, decay = 6): void {
    this.shake = Math.min(28, this.shake + amount);
    this.shakeDecay = decay;
  }

  addFlash(amount: number, color = '#ffffff'): void {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = color;
  }

  burst(
    x: number,
    y: number,
    count: number,
    opts: {
      color?: string;
      speed?: number;
      spread?: number;
      angle?: number;
      life?: number;
      size?: number;
      kind?: Particle['kind'];
      drag?: number;
    } = {},
  ): void {
    const n = Math.min(count, MAX_PARTICLES - this.particles.length);
    for (let i = 0; i < n; i++) {
      const a = (opts.angle ?? 0) + (this.rand() - 0.5) * (opts.spread ?? Math.PI * 2);
      const sp = (opts.speed ?? 260) * (0.35 + this.rand() * 0.9);
      const max = (opts.life ?? 0.45) * (0.6 + this.rand() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: max,
        max,
        size: (opts.size ?? 3) * (0.6 + this.rand() * 0.9),
        color: opts.color ?? '#8fe9ff',
        drag: opts.drag ?? 3.6,
        kind: opts.kind ?? 'spark',
        spin: (this.rand() - 0.5) * 12,
        angle: this.rand() * Math.PI * 2,
      });
    }
  }

  ring(x: number, y: number, r0: number, r1: number, life: number, color: string, width = 2, kind: RingFx['kind'] = 'pulse'): void {
    this.rings.push({ x, y, r0, r1, life, max: life, color, width, kind });
  }

  text(x: number, y: number, text: string, color = '#dff6ff', size = 18, weight = 700, vy = -46): void {
    this.texts.push({ x, y, vy, life: 0.95, max: 0.95, text, color, size, weight });
  }

  trace(points: Vec2[], color: string, life = 0.7, width = 3): void {
    if (points.length < 2) return;
    this.traces.push({ points: points.map((p) => ({ ...p })), life, max: life, color, width });
  }

  distort(x: number, y: number, r: number, strength = 1, life = 0.5): void {
    this.distorts.push({ x, y, r, life, max: life, strength });
  }

  update(dt: number): void {
    // Particles.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.4 * dt);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.traces.length - 1; i >= 0; i--) {
      this.traces[i].life -= dt;
      if (this.traces[i].life <= 0) this.traces.splice(i, 1);
    }
    for (let i = this.distorts.length - 1; i >= 0; i--) {
      this.distorts[i].life -= dt;
      if (this.distorts[i].life <= 0) this.distorts.splice(i, 1);
    }

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - this.shakeDecay * dt * (1 + this.shake * 0.15));
      const a = this.rand() * Math.PI * 2;
      this.shakeOffset.x = Math.cos(a) * this.shake;
      this.shakeOffset.y = Math.sin(a) * this.shake;
    } else {
      this.shakeOffset.x = 0;
      this.shakeOffset.y = 0;
    }

    this.flash = Math.max(0, this.flash - dt * 3.4);
    this.energy += (this.targetEnergy - this.energy) * clamp(dt * 3, 0, 1);
    this.timeDilation += (1 - this.timeDilation) * clamp(dt * 4, 0, 1);
  }

  // -------- semantic effect recipes: each one means a specific thing --------

  /** An attack connecting. Directional, sharp, reads as "that landed". */
  impact(pos: Vec2, angle: number, color: string, power = 1): void {
    this.burst(pos.x, pos.y, Math.round(7 + power * 7), {
      color,
      angle,
      spread: 1.1,
      speed: 320 * power,
      life: 0.3,
      size: 2.4,
      kind: 'spark',
    });
    this.ring(pos.x, pos.y, 6, 34 + power * 16, 0.26, color, 2.4, 'impact');
    this.addShake(1.6 * power, 12);
  }

  /** A near miss. A hard, thin edge that snaps past you. */
  nearMiss(pos: Vec2, angle: number): void {
    this.ring(pos.x, pos.y, 10, 74, 0.34, '#ffe07a', 2, 'shock');
    this.burst(pos.x, pos.y, 8, {
      color: '#ffe07a',
      angle: angle + Math.PI / 2,
      spread: 0.5,
      speed: 420,
      life: 0.26,
      size: 1.8,
    });
    this.addShake(1.2, 16);
  }

  /** A kill. The biggest positive punctuation in the game. */
  kill(pos: Vec2, color: string): void {
    this.burst(pos.x, pos.y, 34, { color, speed: 520, life: 0.75, size: 3.2, kind: 'ember' });
    this.burst(pos.x, pos.y, 16, { color: '#ffffff', speed: 700, life: 0.35, size: 2 });
    this.ring(pos.x, pos.y, 12, 190, 0.6, color, 3, 'shock');
    this.ring(pos.x, pos.y, 4, 90, 0.35, '#ffffff', 1.6, 'impact');
    this.distort(pos.x, pos.y, 200, 1.2, 0.55);
    this.addShake(6, 8);
    this.addFlash(0.14, color);
  }

  /** Taking damage. Reads as bad without screaming. */
  hurt(pos: Vec2): void {
    this.ring(pos.x, pos.y, 30, 76, 0.4, '#ff6a8a', 3, 'impact');
    this.burst(pos.x, pos.y, 12, { color: '#ff6a8a', speed: 220, life: 0.42, size: 2.6 });
    this.addShake(4.5, 9);
    this.addFlash(0.1, '#ff4d6d');
  }

  /** A cancelled attack — informative, not punishing. */
  cancel(pos: Vec2): void {
    this.ring(pos.x, pos.y, 22, 58, 0.34, '#8892a6', 2, 'impact');
  }
}
export { easeOutCubic, easeOutQuint };
