/**
 * The test field's drawing kit.
 *
 * Twelve tests share one visual language so that switching between them feels
 * like changing instrument, not changing app: a dark rift floor, hextech cyan
 * for anything live, gold for structure, red for the thing that will hurt you.
 *
 * Everything here draws in CSS pixels into an already-DPR-scaled context.
 */

import { clamp } from '../engine/math';

export const C = {
  floor: '#070b13',
  floorLit: '#0d1626',
  grid: 'rgba(120,170,220,0.055)',
  gridHot: 'rgba(130,200,255,0.10)',

  gold: '#c8aa6e',
  goldHot: '#f0e6d2',
  goldDeep: '#785a28',

  cyan: '#0ac8b9',
  cyanHot: '#7ceaff',
  ice: '#e6f4ff',

  good: '#5ce1a8',
  warn: '#ffcf6b',
  danger: '#ff5f7e',
  hazard: '#ff8a5c',
  violet: '#b98cff',

  text: '#e8f2ff',
  dim: '#8ea3bd',
  faint: '#54637a',
} as const;

export const UI_FONT = "700 ​13px 'Chakra Petch', system-ui, sans-serif".replace('​', '');
export const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
export const DISPLAY = "'Cinzel', Georgia, serif";

/** rgba() from a #rrggbb and an alpha. Cheap and allocation-light enough. */
export const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/* ------------------------------------------------------------------ field */

/** The floor every test stands on: lit centre, hex grid, hard vignette. */
export const field = (ctx: CanvasRenderingContext2D, w: number, h: number, tint: string = C.cyan): void => {
  const g = ctx.createRadialGradient(w / 2, h * 0.46, 20, w / 2, h * 0.5, Math.max(w, h) * 0.72);
  g.addColorStop(0, C.floorLit);
  g.addColorStop(1, C.floor);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Grid. 48px minor, every fourth line major — the same rhythm as the arena.
  ctx.lineWidth = 1;
  const step = 48;
  for (let x = (w / 2) % step; x < w; x += step) {
    ctx.strokeStyle = Math.round((x - (w / 2) % step) / step) % 4 === 0 ? C.gridHot : C.grid;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
    ctx.stroke();
  }
  for (let y = (h / 2) % step; y < h; y += step) {
    ctx.strokeStyle = Math.round((y - (h / 2) % step) / step) % 4 === 0 ? C.gridHot : C.grid;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
    ctx.stroke();
  }

  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.68);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = rgba(tint, 0.13);
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
};

/* ------------------------------------------------------------- primitives */

export const disc = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string | CanvasGradient,
): void => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
};

export const ring = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stroke: string,
  width = 2,
  from = -Math.PI / 2,
  sweep = Math.PI * 2,
): void => {
  ctx.beginPath();
  ctx.arc(x, y, r, from, from + sweep);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
};

/** A soft radial bloom. Used sparingly — it is the only "light" in here. */
export const glow = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a = 0.5): void => {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.5, rgba(color, a * 0.28));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  font?: 'ui' | 'mono' | 'display';
  weight?: number;
  track?: number;
  alpha?: number;
}

export const text = (
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  o: TextOpts = {},
): void => {
  const size = o.size ?? 14;
  const fam =
    o.font === 'mono' ? MONO : o.font === 'display' ? DISPLAY : "'Chakra Petch', system-ui, sans-serif";
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.font = `${o.weight ?? 700} ${size}px ${fam}`;
  ctx.fillStyle = o.color ?? C.text;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = o.baseline ?? 'middle';
  if (o.track) {
    // Canvas has no letter-spacing everywhere yet, so track by hand. Only used
    // for short eyebrow strings, where the cost is nothing.
    const chars = [...str];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + o.track * (chars.length - 1);
    let cx = o.align === 'left' ? x : o.align === 'right' ? x - total : x - total / 2;
    ctx.textAlign = 'left';
    chars.forEach((c, i) => {
      ctx.fillText(c, cx, y);
      cx += widths[i] + (o.track ?? 0);
    });
  } else {
    ctx.fillText(str, x, y);
  }
  ctx.restore();
};

/* ---------------------------------------------------------------- tokens */

export interface ChampOpts {
  color?: string;
  /** A letter or glyph in the middle. */
  glyph?: string;
  /** 0..1 health remaining; omitted draws no bar. */
  hp?: number;
  hpColor?: string;
  /** Selection ring, as League draws it under a targeted champion. */
  selected?: boolean;
  alpha?: number;
  /** Draws the cast-range circle around the token. */
  range?: number;
}

/**
 * A champion token: a lit disc, a dark core, a rim, and a health bar above it.
 * Reads as a unit at 14px and as a portrait at 40px.
 */
export const champ = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  o: ChampOpts = {},
): void => {
  const col = o.color ?? C.danger;
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;

  if (o.range) {
    ctx.setLineDash([5, 7]);
    ring(ctx, x, y, o.range, rgba(col, 0.22), 1);
    ctx.setLineDash([]);
  }
  if (o.selected) {
    ring(ctx, x, y, r + 7, rgba(C.goldHot, 0.9), 2);
    ring(ctx, x, y, r + 11, rgba(C.gold, 0.3), 1);
  }

  glow(ctx, x, y, r * 2.6, col, 0.34);

  const g = ctx.createLinearGradient(x, y - r, x, y + r);
  g.addColorStop(0, rgba(col, 0.95));
  g.addColorStop(1, rgba(col, 0.42));
  disc(ctx, x, y, r, g);
  disc(ctx, x, y, r * 0.62, 'rgba(4,8,14,0.85)');
  ring(ctx, x, y, r, rgba('#ffffff', 0.55), 1.5);

  if (o.glyph) {
    text(ctx, o.glyph, x, y + 0.5, { size: r * 0.86, color: rgba(col, 1), font: 'display' });
  }
  if (o.hp !== undefined) {
    hpBar(ctx, x - r - 3, y - r - 11, (r + 3) * 2, 5, o.hp, o.hpColor ?? C.good);
  }
  ctx.restore();
};

/** The health bar, drawn the way the client draws it: segmented, hard edges. */
export const hpBar = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string = C.good,
  segments = 0,
): void => {
  const f = clamp(frac, 0, 1);
  ctx.fillStyle = 'rgba(2,5,10,0.9)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * f, h);
  ctx.fillStyle = rgba('#ffffff', 0.25);
  ctx.fillRect(x, y, w * f, 1);
  if (segments > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 1; i < segments; i++) ctx.fillRect(Math.round(x + (w * i) / segments), y, 1, h);
  }
  ctx.strokeStyle = rgba(C.goldDeep, 0.7);
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
};

/** A League keycap: the ability box with its letter and an optional charge. */
export const keycap = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  label: string,
  o: { lit?: number; color?: string; dim?: boolean; cooldown?: number; sub?: string } = {},
): void => {
  const lit = o.lit ?? 0;
  const col = o.color ?? C.gold;
  const half = size / 2;
  ctx.save();

  if (lit > 0) glow(ctx, x, y, size * 1.5, col, 0.5 * lit);

  const g = ctx.createLinearGradient(x, y - half, x, y + half);
  g.addColorStop(0, lit > 0 ? rgba(col, 0.42 + lit * 0.4) : 'rgba(16,28,44,0.92)');
  g.addColorStop(1, lit > 0 ? rgba(col, 0.14 + lit * 0.2) : 'rgba(6,12,22,0.94)');
  ctx.fillStyle = g;
  ctx.fillRect(x - half, y - half, size, size);

  if (o.cooldown !== undefined && o.cooldown > 0) {
    // The client's cooldown sweep: the dark wedge that unwinds clockwise.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, size, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(o.cooldown, 0, 1));
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = 'rgba(2,6,12,0.78)';
    ctx.fillRect(x - half, y - half, size, size);
    ctx.restore();
  }

  ctx.strokeStyle = lit > 0 ? rgba(C.goldHot, 0.4 + lit * 0.6) : rgba(C.goldDeep, 0.8);
  ctx.lineWidth = lit > 0 ? 2 : 1;
  ctx.strokeRect(x - half + 0.5, y - half + 0.5, size - 1, size - 1);

  text(ctx, label, x, y + 1, {
    size: size * 0.46,
    color: o.dim ? C.faint : lit > 0 ? '#0a1017' : C.gold,
    font: 'display',
  });
  if (o.sub) text(ctx, o.sub, x, y + half + 10, { size: 9, color: C.faint, track: 1.5 });
  ctx.restore();
};

/**
 * A linear skillshot telegraph — the red capsule the client paints under an
 * incoming ability. `charge` 0..1 fills it; at 1 it fires.
 */
export const lineTelegraph = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  charge: number,
  color: string = C.danger,
): void => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const c = clamp(charge, 0, 1);

  ctx.fillStyle = rgba(color, 0.1);
  ctx.fillRect(0, -width / 2, length, width);
  ctx.fillStyle = rgba(color, 0.3 + c * 0.36);
  ctx.fillRect(0, -width / 2, length * c, width);

  ctx.strokeStyle = rgba(color, 0.55 + c * 0.45);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.5, -width / 2 + 0.5, length - 1, width - 1);
  ctx.restore();
};

/** The cone version, for the abilities that are not lines. */
export const coneTelegraph = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  radius: number,
  spread: number,
  charge: number,
  color: string = C.danger,
): void => {
  const c = clamp(charge, 0, 1);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, radius, angle - spread / 2, angle + spread / 2);
  ctx.closePath();
  ctx.fillStyle = rgba(color, 0.12 + c * 0.4);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.5 + c * 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
};

/* ------------------------------------------------------------------- fx */

export interface Ripple {
  x: number;
  y: number;
  t: number;
  life: number;
  r0: number;
  r1: number;
  color: string;
  /** A ring, or a filled burst. */
  fill?: boolean;
}

export const rippleUpdate = (list: Ripple[], dt: number): void => {
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].t += dt;
    if (list[i].t >= list[i].life) list.splice(i, 1);
  }
};

export const rippleDraw = (ctx: CanvasRenderingContext2D, list: Ripple[]): void => {
  for (const p of list) {
    const k = clamp(p.t / p.life, 0, 1);
    const r = p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - k, 3));
    const a = (1 - k) * (1 - k);
    if (p.fill) disc(ctx, p.x, p.y, r, rgba(p.color, a * 0.4));
    ring(ctx, p.x, p.y, r, rgba(p.color, a), 2);
  }
};

export const pop = (list: Ripple[], x: number, y: number, color: string, r1 = 46, life = 0.42): void => {
  list.push({ x, y, t: 0, life, r0: 4, r1, color });
};

/** Floating score/latency numbers, the way a damage number reads in game. */
export interface FloatText {
  x: number;
  y: number;
  t: number;
  life: number;
  str: string;
  color: string;
  size: number;
}

export const floatsUpdate = (list: FloatText[], dt: number): void => {
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].t += dt;
    if (list[i].t >= list[i].life) list.splice(i, 1);
  }
};

export const floatsDraw = (ctx: CanvasRenderingContext2D, list: FloatText[]): void => {
  for (const f of list) {
    const k = f.t / f.life;
    text(ctx, f.str, f.x, f.y - 26 * k, {
      size: f.size,
      color: f.color,
      font: 'mono',
      alpha: (1 - k) * (1 - k) + 0.05,
    });
  }
};

export const say = (list: FloatText[], x: number, y: number, str: string, color: string, size = 15): void => {
  list.push({ x, y, t: 0, life: 0.85, str, color, size });
};

/* --------------------------------------------------------------- helpers */

export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const pulse = (t: number, hz = 1): number => 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * hz);

/** Median — the number to quote for reaction times, since one sneeze skews a mean. */
export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Standard deviation — consistency is the number that separates ranks. */
export const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
};
