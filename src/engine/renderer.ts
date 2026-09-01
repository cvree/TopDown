import { FxSystem } from './fx';
import { clamp, easeOutCubic, lerp } from './math';
import { PALETTE } from './palette';
import type { Actor, Hazard, Vec2 } from './types';
import { World } from './world';

/**
 * Canvas2D renderer.
 *
 * The two things that keep this fast at 240Hz: glow sprites are pre-rendered
 * once per colour into small offscreen canvases and blitted (canvas shadowBlur
 * and per-frame gradients are the usual killers), and everything is drawn in
 * one pass per layer so we set composite modes a handful of times per frame,
 * not per entity.
 */

export interface View {
  scale: number;
  ox: number;
  oy: number;
  cw: number;
  ch: number;
}

const glowCache = new Map<string, HTMLCanvasElement>();

const glowSprite = (color: string): HTMLCanvasElement => {
  const cached = glowCache.get(color);
  if (cached) return cached;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.28, hexA(color, 0.55));
  grad.addColorStop(0.6, hexA(color, 0.14));
  grad.addColorStop(1, hexA(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowCache.set(color, c);
  return c;
};

/** Hex (or rgb) colour with an alpha applied. */
export const hexA = (color: string, a: number): string => {
  if (color.startsWith('rgba')) return color.replace(/[\d.]+\)$/, `${a})`);
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  const h = color.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  view: View = { scale: 1, ox: 0, oy: 0, cw: 1, ch: 1 };
  /** Subtle parallax toward the cursor. Sells depth without moving the arena. */
  private camDrift: Vec2 = { x: 0, y: 0 };
  private t = 0;
  /** The arena floor and its grid never change — they are drawn once. */
  private floorLayer: HTMLCanvasElement | null = null;
  private floorKey = '';
  /** The vignette is viewport-sized and also static between resizes. */
  private vignetteLayer: HTMLCanvasElement | null = null;
  private vignetteKey = '';
  private hurtLayer: HTMLCanvasElement | null = null;
  private hurtKey = '';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(worldW: number, worldH: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    // A little inset so the arena frame and its corner brackets are always on
    // screen — the boundary is information, not decoration.
    const pad = 0.965;
    const scale = Math.min(rect.width / worldW, rect.height / worldH) * pad;
    this.view = {
      scale,
      ox: (rect.width - worldW * scale) / 2,
      oy: (rect.height - worldH * scale) / 2,
      cw: rect.width,
      ch: rect.height,
    };
  }

  screenToWorld(x: number, y: number): Vec2 {
    const v = this.view;
    return { x: (x - v.ox) / v.scale, y: (y - v.oy) / v.scale };
  }

  worldToScreen(p: Vec2): Vec2 {
    const v = this.view;
    return { x: p.x * v.scale + v.ox, y: p.y * v.scale + v.oy };
  }

  render(
    world: World,
    fx: FxSystem,
    alpha: number,
    dtWall: number,
    opts: {
      cursor: Vec2;
      showRange: boolean;
      hoverTargetId: number | null;
      pathTrail: Vec2[];
      chain: number;
      dimmed: number;
      hitFeedback: number;
      focusPos?: Vec2 | null;
      lowFx?: boolean;
      /** Drill-specific arena drawing (nodes, bands, prompts). */
      overlay?: (ctx: CanvasRenderingContext2D, scale: number, t: number) => void;
    },
  ): void {
    const ctx = this.ctx;
    const v = this.view;
    this.t += dtWall;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, v.cw, v.ch);

    // Backdrop fills the whole element; the arena is drawn inside it.
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, v.cw, v.ch);

    // Camera parallax: a few units of drift toward the cursor.
    const cw = this.screenToWorld(opts.cursor.x, opts.cursor.y);
    const targetDrift = {
      x: clamp((cw.x - world.bounds.w / 2) * 0.012, -14, 14),
      y: clamp((cw.y - world.bounds.h / 2) * 0.012, -14, 14),
    };
    this.camDrift.x = lerp(this.camDrift.x, targetDrift.x, clamp(dtWall * 3, 0, 1));
    this.camDrift.y = lerp(this.camDrift.y, targetDrift.y, clamp(dtWall * 3, 0, 1));

    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.scale, v.scale);
    ctx.translate(
      -this.camDrift.x + fx.shakeOffset.x,
      -this.camDrift.y + fx.shakeOffset.y,
    );

    this.drawFloor(world, fx, opts.lowFx ?? false);
    this.drawTraces(fx);
    this.drawPlayerTrail(opts.pathTrail, fx.energy);
    this.drawHazards(world, alpha);
    if (opts.overlay) {
      ctx.save();
      opts.overlay(ctx, v.scale, this.t);
      ctx.restore();
    }
    this.drawRings(fx, 'under');
    if (opts.showRange) this.drawRangeIndicator(world, opts.chain);
    this.drawProjectiles(world, alpha);
    this.drawActors(world, alpha, opts.hoverTargetId, fx);
    this.drawParticles(fx);
    this.drawRings(fx, 'over');
    this.drawDistorts(fx);
    this.drawFloatText(fx);
    this.drawCursor(cw, world, opts.hoverTargetId);

    ctx.restore();

    // Full-frame punctuation.
    if (fx.flash > 0.001) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexA(fx.flashColor, fx.flash * 0.5);
      ctx.fillRect(0, 0, v.cw, v.ch);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Taking damage reads as a thin edge, not a red wash over the playfield.
    // You should always be able to see what is about to hit you next.
    if (opts.hitFeedback > 0.001) {
      ctx.globalAlpha = Math.min(1, opts.hitFeedback) * 0.55;
      ctx.drawImage(this.buildHurtLayer(), 0, 0, v.cw, v.ch);
      ctx.globalAlpha = 1;
    }
    this.drawVignette(fx.energy);
    if (opts.dimmed > 0.001) {
      ctx.fillStyle = `rgba(3,5,9,${opts.dimmed})`;
      ctx.fillRect(0, 0, v.cw, v.ch);
    }
  }

  // ------------------------------------------------------------------ layers

  /**
   * The floor, grid and frame are identical every frame, so they are rendered
   * once into an offscreen canvas and blitted. Rebuilding these gradients per
   * frame was the single most expensive thing in the renderer.
   */
  private buildFloorLayer(world: World): HTMLCanvasElement {
    const { w, h } = world.bounds;
    const key = `${w}x${h}`;
    if (this.floorLayer && this.floorKey === key) return this.floorLayer;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;

    const grad = g.createLinearGradient(0, 0, w * 0.45, h);
    grad.addColorStop(0, '#141c2c');
    grad.addColorStop(0.5, '#0d1421');
    grad.addColorStop(1, '#090d16');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // A soft pool of light in the middle so the playfield reads as a stage.
    const pool = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.66);
    pool.addColorStop(0, 'rgba(90,150,200,0.10)');
    pool.addColorStop(0.55, 'rgba(70,120,170,0.035)');
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = pool;
    g.fillRect(0, 0, w, h);

    const step = 100;
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(140,195,245,0.075)';
    g.beginPath();
    for (let x = step; x < w; x += step) {
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, h);
    }
    for (let y = step; y < h; y += step) {
      g.moveTo(0, y + 0.5);
      g.lineTo(w, y + 0.5);
    }
    g.stroke();

    g.strokeStyle = 'rgba(150,215,255,0.16)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = step * 4; x < w; x += step * 4) {
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
    for (let y = step * 4; y < h; y += step * 4) {
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();

    // Measurement ticks along the edges: instrumentation, not decoration.
    g.strokeStyle = 'rgba(150,215,255,0.22)';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = step; x < w; x += step) {
      const major = x % (step * 4) === 0;
      g.moveTo(x, 0);
      g.lineTo(x, major ? 18 : 9);
      g.moveTo(x, h);
      g.lineTo(x, h - (major ? 18 : 9));
    }
    for (let y = step; y < h; y += step) {
      const major = y % (step * 4) === 0;
      g.moveTo(0, y);
      g.lineTo(major ? 18 : 9, y);
      g.moveTo(w, y);
      g.lineTo(w - (major ? 18 : 9), y);
    }
    g.stroke();

    g.strokeStyle = 'rgba(120,200,255,0.28)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);

    this.floorLayer = c;
    this.floorKey = key;
    return c;
  }

  private drawFloor(world: World, fx: FxSystem, lowFx: boolean): void {
    const ctx = this.ctx;
    const { w, h } = world.bounds;
    ctx.drawImage(this.buildFloorLayer(world), 0, 0);

    // The only animated part of the floor: an energy bloom that tracks the
    // combo chain, blitted from a cached sprite rather than a live gradient.
    if (!lowFx && fx.energy > 0.01) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * (1.2 + fx.energy * 2.4));
      const sprite = glowSprite(PALETTE.accent);
      const r = Math.max(w, h) * 0.72;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = fx.energy * (0.1 + pulse * 0.06);
      ctx.drawImage(sprite, w / 2 - r, h / 2 - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Corner brackets brighten with the chain — the frame itself charges up.
    const c = 72;
    ctx.strokeStyle = hexA(PALETTE.accent, 0.45 + fx.energy * 0.5);
    ctx.lineWidth = 4 / this.view.scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const corners: [number, number, number, number][] = [
      [0, 0, 1, 1],
      [w, 0, -1, 1],
      [0, h, 1, -1],
      [w, h, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.moveTo(x + sx * c, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * c);
    }
    ctx.stroke();
  }

  private drawTraces(fx: FxSystem): void {
    const ctx = this.ctx;
    if (fx.traces.length === 0) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const tr of fx.traces) {
      const a = easeOutCubic(tr.life / tr.max);
      ctx.strokeStyle = hexA(tr.color, 0.5 * a);
      ctx.lineWidth = tr.width * a;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tr.points[0].x, tr.points[0].y);
      for (let i = 1; i < tr.points.length; i++) ctx.lineTo(tr.points[i].x, tr.points[i].y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** The player's own path, drawn very faintly. You can read your movement. */
  private drawPlayerTrail(trail: Vec2[], energy: number): void {
    if (trail.length < 2) return;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i++) {
      const t = i / trail.length;
      ctx.strokeStyle = hexA(PALETTE.player, 0.03 + t * (0.13 + energy * 0.14));
      ctx.lineWidth = 1 + t * 5;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawHazards(world: World, _alpha: number): void {
    const ctx = this.ctx;
    for (const h of world.hazards) {
      const warning = h.warn > 0;
      const p = warning ? 1 - h.warn / Math.max(0.001, h.warnTotal) : 1;
      const live = !warning;
      const fade = live ? clamp(h.active / Math.max(0.001, h.activeTotal), 0, 1) : 1;
      const col = h.color ?? PALETTE.hazard;
      this.drawHazardShape(ctx, h, col, warning, p, fade);
    }
  }

  private drawHazardShape(
    ctx: CanvasRenderingContext2D,
    h: Hazard,
    col: string,
    warning: boolean,
    p: number,
    fade: number,
  ): void {
    ctx.save();
    if (warning) {
      // Telegraph: outline plus a fill that sweeps in as it arms.
      ctx.fillStyle = hexA(col, 0.09);
      ctx.strokeStyle = hexA(col, 0.5);
      ctx.lineWidth = 2.5 / this.view.scale;
      this.hazardPath(ctx, h, 1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hexA(col, 0.2);
      this.hazardPath(ctx, h, p);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexA(col, 0.34 * fade);
      this.hazardPath(ctx, h, 1);
      ctx.fill();
      ctx.strokeStyle = hexA('#ffffff', 0.5 * fade);
      ctx.lineWidth = 3 / this.view.scale;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  private hazardPath(ctx: CanvasRenderingContext2D, h: Hazard, p: number): void {
    ctx.beginPath();
    switch (h.shape) {
      case 'circle':
        ctx.arc(h.pos.x, h.pos.y, h.radius * (h.warn > 0 ? 1 : 1) * (p < 1 ? p : 1), 0, Math.PI * 2);
        break;
      case 'ring': {
        const inner = Math.max(0, h.radius - (h.width ?? 60));
        ctx.arc(h.pos.x, h.pos.y, lerp(inner, h.radius, p), 0, Math.PI * 2);
        ctx.arc(h.pos.x, h.pos.y, inner, 0, Math.PI * 2, true);
        break;
      }
      case 'line': {
        if (!h.end) break;
        const dx = h.end.x - h.pos.x;
        const dy = h.end.y - h.pos.y;
        const l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * (h.width ?? 50);
        const ny = (dx / l) * (h.width ?? 50);
        const ex = h.pos.x + dx * p;
        const ey = h.pos.y + dy * p;
        ctx.moveTo(h.pos.x + nx, h.pos.y + ny);
        ctx.lineTo(ex + nx, ey + ny);
        ctx.lineTo(ex - nx, ey - ny);
        ctx.lineTo(h.pos.x - nx, h.pos.y - ny);
        ctx.closePath();
        break;
      }
      case 'cone': {
        if (!h.end) break;
        const a = Math.atan2(h.end.y - h.pos.y, h.end.x - h.pos.x);
        const half = h.width ?? 0.5;
        ctx.moveTo(h.pos.x, h.pos.y);
        ctx.arc(h.pos.x, h.pos.y, h.radius * p, a - half, a + half);
        ctx.closePath();
        break;
      }
    }
  }

  /** Player attack range: the single most useful piece of information on screen. */
  private drawRangeIndicator(world: World, chain: number): void {
    const p = world.player;
    if (!p || !p.alive) return;
    const ctx = this.ctx;
    const r = p.attack.range + p.radius;
    const ready = p.attackCd <= 0;
    const col = ready ? PALETTE.accent : hexA(PALETTE.accent, 0.5);

    ctx.save();
    ctx.setLineDash([12, 16]);
    ctx.lineDashOffset = -this.t * 26;
    ctx.strokeStyle = hexA(col, ready ? 0.6 + Math.min(chain, 8) * 0.03 : 0.26);
    ctx.lineWidth = 2.2 / this.view.scale;
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Attack timer arc — the cooldown becomes a readable instrument.
    if (!ready) {
      const cycle = 1 / p.attack.attackSpeed;
      const frac = 1 - clamp(p.attackCd / cycle, 0, 1);
      ctx.save();
      ctx.strokeStyle = hexA(PALETTE.accent, 0.6);
      ctx.lineWidth = 3 / this.view.scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.radius + 13, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 7);
      ctx.strokeStyle = hexA(PALETTE.playerCore, 0.35 + pulse * 0.35);
      ctx.lineWidth = 2.4 / this.view.scale;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.radius + 13, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawProjectiles(world: World, alpha: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of world.projectiles) {
      const x = lerp(p.prev.x, p.pos.x, alpha);
      const y = lerp(p.prev.y, p.pos.y, alpha);
      const col = p.color ?? (p.team === 'player' ? PALETTE.accent : PALETTE.danger);
      const ang = Math.atan2(p.vel.y, p.vel.x);

      if (p.trail.length > 1) {
        ctx.strokeStyle = hexA(col, 0.22);
        ctx.lineWidth = p.radius * 0.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.trail[0].x, p.trail[0].y);
        for (let i = 1; i < p.trail.length; i++) ctx.lineTo(p.trail[i].x, p.trail[i].y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      const sprite = glowSprite(col);
      const gr = p.radius * 5.5;
      ctx.drawImage(sprite, x - gr, y - gr, gr * 2, gr * 2);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = '#ffffff';
      if (p.shape === 'shard') {
        ctx.beginPath();
        ctx.moveTo(p.radius * 2.1, 0);
        ctx.lineTo(0, p.radius * 0.72);
        ctx.lineTo(-p.radius * 1.3, 0);
        ctx.lineTo(0, -p.radius * 0.72);
        ctx.closePath();
        ctx.fill();
      } else if (p.shape === 'orb') {
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * 0.72, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.radius * 1.35, p.radius * 0.52, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawActors(world: World, alpha: number, hoverId: number | null, fx: FxSystem): void {
    const ctx = this.ctx;
    // Ground shadows first so units feel seated on the floor.
    for (const a of world.actors) {
      if (!a.alive) continue;
      const x = lerp(a.prev.x, a.pos.x, alpha);
      const y = lerp(a.prev.y, a.pos.y, alpha);
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.beginPath();
      ctx.ellipse(x, y + a.radius * 0.55, a.radius * 1.05, a.radius * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const a of world.actors) {
      if (!a.alive) continue;
      const x = lerp(a.prev.x, a.pos.x, alpha);
      const y = lerp(a.prev.y, a.pos.y, alpha);
      const isPlayer = a.id === world.playerId;
      const col = isPlayer ? PALETTE.player : a.isMinion ? '#8fa3bd' : this.actorColor(a);

      // Glow.
      const sprite = glowSprite(col);
      const gr = a.radius * (isPlayer ? 4.4 : 3.4) * (1 + fx.energy * 0.12);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = isPlayer ? 0.5 : 0.36;
      ctx.drawImage(sprite, x - gr, y - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      ctx.save();
      ctx.translate(x, y);

      // Windup tell: a tightening arc that resolves at the moment of release.
      if (a.phase === 'windup') {
        const cycle = 1 / a.attack.attackSpeed;
        const total = cycle * a.attack.windupRatio;
        const t = 1 - clamp(a.phaseTime / total, 0, 1);
        ctx.rotate(a.facing);
        ctx.strokeStyle = hexA(isPlayer ? PALETTE.playerCore : col, 0.35 + t * 0.6);
        ctx.lineWidth = 3.4 / this.view.scale + t * 2;
        ctx.beginPath();
        ctx.arc(0, 0, a.radius + 20 - t * 12, -0.9 + t * 0.55, 0.9 - t * 0.55);
        ctx.stroke();
        ctx.rotate(-a.facing);
      }

      ctx.rotate(a.facing + Math.PI / 2);

      // Body. The player is a clean chevron; enemies are angular by archetype.
      const r = a.radius;
      ctx.beginPath();
      if (isPlayer) {
        ctx.moveTo(0, -r * 1.28);
        ctx.lineTo(r * 0.92, r * 0.86);
        ctx.lineTo(0, r * 0.42);
        ctx.lineTo(-r * 0.92, r * 0.86);
      } else if (a.isMinion) {
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.8, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.8, 0);
      } else {
        const sides = a.archetype === 'juggernaut' ? 6 : a.archetype === 'artillery' ? 3 : 5;
        for (let i = 0; i < sides; i++) {
          const ang = (i / sides) * Math.PI * 2 - Math.PI / 2;
          const rr = r * (i % 2 === 0 ? 1.12 : 0.9);
          const px = Math.cos(ang) * rr;
          const py = Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      }
      ctx.closePath();

      const flash = a.hitFlash;
      ctx.fillStyle = flash > 0 ? hexA('#ffffff', 0.35 + flash * 0.55) : hexA(col, 0.22);
      ctx.fill();
      ctx.strokeStyle = flash > 0 ? '#ffffff' : col;
      ctx.lineWidth = (isPlayer ? 3.2 : 2.6) / this.view.scale + 1.2;
      ctx.stroke();

      // Core.
      ctx.beginPath();
      ctx.arc(0, isPlayer ? -r * 0.12 : 0, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = isPlayer ? PALETTE.playerCore : hexA(col, 0.95);
      ctx.fill();

      ctx.restore();

      if (hoverId === a.id && !isPlayer) {
        ctx.strokeStyle = hexA(PALETTE.warn, 0.85);
        ctx.lineWidth = 2.2 / this.view.scale;
        ctx.beginPath();
        ctx.arc(x, y, a.radius + 10, 0, Math.PI * 2);
        ctx.stroke();
        this.drawBrackets(ctx, x, y, a.radius + 16, PALETTE.warn);
      }

      // Health bar. Minimal, legible, sits above the unit.
      if (!isPlayer && a.maxHp > 0) {
        const w = a.radius * 2.6;
        const hgt = 5;
        const yy = y - a.radius - 20;
        ctx.fillStyle = 'rgba(4,7,12,0.85)';
        ctx.fillRect(x - w / 2 - 1, yy - 1, w + 2, hgt + 2);
        const frac = clamp(a.hp / a.maxHp, 0, 1);
        ctx.fillStyle = a.isMinion
          ? frac < 0.25
            ? PALETTE.warn
            : '#93a7c0'
          : col;
        ctx.fillRect(x - w / 2, yy, w * frac, hgt);
        // Last-hit window marker: shows the damage your next attack will do.
        if (a.isMinion) {
          const player = world.player;
          if (player) {
            const dmgFrac = clamp(player.attack.damage / a.maxHp, 0, 1);
            const mx = x - w / 2 + w * clamp(frac - dmgFrac, 0, 1);
            ctx.fillStyle = frac <= dmgFrac ? PALETTE.good : hexA(PALETTE.warn, 0.9);
            ctx.fillRect(mx - 1, yy - 2, 2, hgt + 4);
          }
        }
      }
    }
  }

  private drawBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    ctx.strokeStyle = hexA(color, 0.9);
    ctx.lineWidth = 2.4 / this.view.scale;
    const a = 0.5;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const base = (i * Math.PI) / 2 + Math.PI / 4;
      ctx.arc(x, y, r, base - a / 2, base + a / 2);
      ctx.moveTo(x + Math.cos(base + a / 2 + 0.001) * r, y + Math.sin(base + a / 2 + 0.001) * r);
    }
    ctx.stroke();
  }

  private actorColor(a: Actor): string {
    switch (a.archetype) {
      case 'ranger':
        return '#5ce1a8';
      case 'diver':
        return '#ff7a5c';
      case 'artillery':
        return '#c48bff';
      case 'controller':
        return '#58c6ff';
      case 'duelist':
        return '#ffd166';
      case 'juggernaut':
        return '#ff5f8f';
      default:
        return PALETTE.danger;
    }
  }

  private drawParticles(fx: FxSystem): void {
    const ctx = this.ctx;
    if (fx.particles.length === 0) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of fx.particles) {
      const t = p.life / p.max;
      const a = t * t;
      ctx.fillStyle = hexA(p.color, a);
      if (p.kind === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillRect(-p.size, -p.size * 0.35, p.size * 2, p.size * 0.7);
        ctx.restore();
      } else if (p.kind === 'spark') {
        const sp = Math.hypot(p.vx, p.vy);
        const len = clamp(sp * 0.012, 1, 16);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-len, -p.size * 0.35, len * 2, p.size * 0.7);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + t * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawRings(fx: FxSystem, layer: 'under' | 'over'): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const r of fx.rings) {
      const isUnder = r.kind === 'range' || r.kind === 'pulse';
      if ((layer === 'under') !== isUnder) continue;
      const t = 1 - r.life / r.max;
      const rad = Math.max(0.5, lerp(r.r0, r.r1, easeOutCubic(t)));
      const a = (1 - t) * (1 - t);
      ctx.strokeStyle = hexA(r.color, a * 0.9);
      ctx.lineWidth = r.width * (1 - t * 0.55);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Cheap refraction stand-in: concentric offset rings read as a shockwave. */
  private drawDistorts(fx: FxSystem): void {
    if (fx.distorts.length === 0) return;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const d of fx.distorts) {
      const t = 1 - d.life / d.max;
      const rad = d.r * easeOutCubic(t);
      const a = (1 - t) * 0.18 * d.strength;
      for (let i = 0; i < 3; i++) {
        const rr = rad - i * 9;
        if (rr <= 0) continue;
        ctx.strokeStyle = hexA('#bfe9ff', a * (1 - i * 0.28));
        ctx.lineWidth = 1.4 + i * 0.9;
        ctx.beginPath();
        ctx.arc(d.x, d.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawFloatText(fx: FxSystem): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of fx.texts) {
      const p = t.life / t.max;
      const a = clamp(p * 1.7, 0, 1);
      const scale = 1 + (1 - p) * 0.12;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(scale, scale);
      ctx.font = `${t.weight} ${t.size}px "Chakra Petch", "Inter", system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(3,6,11,${a * 0.75})`;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = hexA(t.color, a);
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
  }

  private drawCursor(cw: Vec2, world: World, hoverId: number | null): void {
    const ctx = this.ctx;
    const col = hoverId != null ? PALETTE.warn : PALETTE.accent;
    ctx.strokeStyle = hexA(col, 0.85);
    ctx.lineWidth = 1.8 / this.view.scale;
    const s = 11;
    ctx.beginPath();
    ctx.moveTo(cw.x - s, cw.y);
    ctx.lineTo(cw.x - 4, cw.y);
    ctx.moveTo(cw.x + 4, cw.y);
    ctx.lineTo(cw.x + s, cw.y);
    ctx.moveTo(cw.x, cw.y - s);
    ctx.lineTo(cw.x, cw.y - 4);
    ctx.moveTo(cw.x, cw.y + 4);
    ctx.lineTo(cw.x, cw.y + s);
    ctx.stroke();
    ctx.fillStyle = hexA(col, 0.9);
    ctx.fillRect(cw.x - 1, cw.y - 1, 2, 2);
    void world;
  }

  private buildHurtLayer(): HTMLCanvasElement {
    const { cw, ch } = this.view;
    const key = `${Math.round(cw)}x${Math.round(ch)}`;
    if (this.hurtLayer && this.hurtKey === key) return this.hurtLayer;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(cw));
    c.height = Math.max(1, Math.round(ch));
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.44, cw / 2, ch / 2, Math.max(cw, ch) * 0.62);
    grad.addColorStop(0, 'rgba(255,60,90,0)');
    grad.addColorStop(0.72, 'rgba(255,55,88,0.16)');
    grad.addColorStop(1, 'rgba(255,45,80,0.5)');
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
    this.hurtLayer = c;
    this.hurtKey = key;
    return c;
  }

  private drawVignette(energy: number): void {
    const ctx = this.ctx;
    const { cw, ch } = this.view;
    const key = `${Math.round(cw)}x${Math.round(ch)}`;
    if (!this.vignetteLayer || this.vignetteKey !== key) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(cw));
      c.height = Math.max(1, Math.round(ch));
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.42, cw / 2, ch / 2, Math.max(cw, ch) * 0.8);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(2,3,6,0.85)');
      g.fillStyle = grad;
      g.fillRect(0, 0, cw, ch);
      this.vignetteLayer = c;
      this.vignetteKey = key;
    }
    ctx.globalAlpha = 0.62 - energy * 0.16;
    ctx.drawImage(this.vignetteLayer, 0, 0, cw, ch);
    ctx.globalAlpha = 1;
  }
}
