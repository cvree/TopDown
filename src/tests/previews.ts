/**
 * Card previews.
 *
 * Every test card in the gallery runs a live miniature of the thing it
 * measures — the flash actually flashes, the target actually runs, the minimap
 * actually blinks. A grid of still thumbnails would tell you the names of
 * twelve tests; a grid of running ones tells you what they are.
 *
 * All twelve share a single rAF driver in the gallery, so this is twelve small
 * draw calls a frame and nothing else.
 */

import { clamp } from '../engine/math';
import { C, disc, hpBar, keycap, lineTelegraph, rgba, ring, text } from './kit';
import type { TestId } from './catalog';

/** Deterministic pseudo-noise so previews look alive without carrying state. */
const wob = (t: number, seed: number): number =>
  Math.sin(t * 1.7 + seed) * 0.6 + Math.sin(t * 2.9 + seed * 2.1) * 0.4;

const backdrop = (ctx: CanvasRenderingContext2D, w: number, h: number, tint: string): void => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0a1220');
  g.addColorStop(1, '#05080f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba(tint, 0.06);
  ctx.lineWidth = 1;
  for (let x = 18; x < w; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  const v = ctx.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, Math.max(w, h) * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
};

/** A small champion blob — the preview's stand-in for the real token. */
const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void => {
  const g = ctx.createRadialGradient(x, y - r * 0.3, 1, x, y, r);
  g.addColorStop(0, rgba(col, 1));
  g.addColorStop(1, rgba(col, 0.45));
  disc(ctx, x, y, r, g);
  disc(ctx, x, y, r * 0.55, 'rgba(4,8,14,0.8)');
  ring(ctx, x, y, r, rgba('#ffffff', 0.5), 1);
};

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

const DRAW: Record<TestId, Draw> = {
  /* -------------------------------------------------------------- reflex */
  flashReact: (ctx, w, h, t) => {
    // A three-second cycle: wait, cue, read the number, wait again.
    const cy = (t % 3.2) / 3.2;
    const cued = cy > 0.55 && cy < 0.78;
    backdrop(ctx, w, h, cued ? C.danger : C.gold);
    if (cued) {
      const k = (cy - 0.55) / 0.23;
      ctx.fillStyle = rgba(C.danger, 0.3 * (1 - k) + 0.1);
      ctx.fillRect(0, 0, w, h);
    }
    blob(ctx, w / 2, h / 2, 15, cued ? C.danger : C.gold);
    ring(ctx, w / 2, h / 2, 24 + (cued ? 0 : Math.sin(t * 2) * 2), rgba(cued ? C.danger : C.gold, 0.5), 1.5);
    text(ctx, cued ? 'FLASH' : cy > 0.78 ? '214ms' : 'WAIT', w / 2, h - 16, {
      size: cued ? 13 : 11,
      color: cued ? C.goldHot : cy > 0.78 ? C.cyanHot : C.faint,
      track: 4,
      font: cy > 0.78 && !cued ? 'mono' : 'ui',
    });
  },

  soundCue: (ctx, w, h, t) => {
    backdrop(ctx, w, h, C.violet);
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.5 + i / 3) % 1;
      ring(ctx, w / 2, h / 2, 12 + k * 46, rgba(C.violet, (1 - k) * 0.5), 1.5);
    }
    disc(ctx, w / 2, h / 2, 11, 'rgba(8,12,22,0.9)');
    ring(ctx, w / 2, h / 2, 11, rgba(C.violet, 0.85), 1.5);
    text(ctx, '🔊', w / 2, h / 2, { size: 13 });
    text(ctx, 'LISTEN', w / 2, h - 16, { size: 10, color: C.faint, track: 5 });
  },

  keyCast: (ctx, w, h, t) => {
    backdrop(ctx, w, h, C.cyanHot);
    const keys = ['Q', 'W', 'E', 'R'];
    const lit = Math.floor(t * 1.4) % keys.length;
    const size = 26;
    const total = keys.length * size + (keys.length - 1) * 7;
    keys.forEach((k, i) => {
      keycap(ctx, w / 2 - total / 2 + i * (size + 7) + size / 2, h / 2 + 2, size, k, {
        lit: i === lit ? 1 : 0,
        color: C.cyanHot,
      });
    });
    text(ctx, 'PRESS THE KEY', w / 2, h - 15, { size: 10, color: C.faint, track: 4 });
  },

  dodgeRead: (ctx, w, h, t) => {
    backdrop(ctx, w, h, C.good);
    const cy = (t % 2.6) / 2.6;
    const vertical = Math.floor(t / 2.6) % 2 === 0;
    const charge = clamp(cy / 0.55, 0, 1);
    if (vertical) lineTelegraph(ctx, 0, h / 2, 0, w, 26, charge);
    else lineTelegraph(ctx, w / 2, 0, Math.PI / 2, h, 26, charge);
    const dodged = cy > 0.55;
    const off = dodged ? Math.min(1, (cy - 0.55) * 6) * 26 : 0;
    blob(ctx, w / 2 + (vertical ? 0 : off), h / 2 + (vertical ? -off : 0), 12, dodged ? C.good : C.cyanHot);
    text(ctx, 'SIDESTEP', w / 2, h - 15, { size: 10, color: C.faint, track: 4 });
  },

  /* ----------------------------------------------------------- precision */
  flick: (ctx, w, h, t) => {
    backdrop(ctx, w, h, C.cyanHot);
    const step = Math.floor(t * 1.1);
    const k = (t * 1.1) % 1;
    const px = w * (0.25 + 0.5 * ((step * 0.37) % 1));
    const py = h * (0.28 + 0.44 * ((step * 0.71) % 1));
    blob(ctx, px, py, 12, C.danger);
    ring(ctx, px, py, 20 - k * 8, rgba(C.gold, 0.6), 1.5);
    // The cursor arriving, which is the whole gesture the test measures.
    const ppx = w * (0.25 + 0.5 * (((step - 1) * 0.37) % 1));
    const ppy = h * (0.28 + 0.44 * (((step - 1) * 0.71) % 1));
    const e = 1 - Math.pow(1 - clamp(k * 1.6, 0, 1), 3);
    const mx = ppx + (px - ppx) * e;
    const my = ppy + (py - ppy) * e;
    ctx.strokeStyle = rgba(C.goldHot, 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx - 7, my);
    ctx.lineTo(mx + 7, my);
    ctx.moveTo(mx, my - 7);
    ctx.lineTo(mx, my + 7);
    ctx.stroke();
  },

  lead: (ctx, w, h, t) => {
    backdrop(ctx, w, h, '#ff6bd6');
    const cy = (t % 2.4) / 2.4;
    const tx = 24 + ((t * 46) % (w - 48));
    const ty = h * 0.36;
    blob(ctx, tx, ty, 11, '#ff6bd6');
    blob(ctx, w / 2, h - 18, 9, C.cyanHot);
    if (cy > 0.3) {
      const k = clamp((cy - 0.3) / 0.5, 0, 1);
      const aim = { x: tx + 44, y: ty };
      const mx = w / 2 + (aim.x - w / 2) * k;
      const my = h - 18 + (aim.y - (h - 18)) * k;
      disc(ctx, mx, my, 4, C.goldHot);
      ctx.strokeStyle = rgba(C.gold, 0.35);
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(w / 2, h - 18);
      ctx.lineTo(aim.x, aim.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    text(ctx, 'LEAD THE TARGET', w / 2, h - 6, { size: 9, color: C.faint, track: 3 });
  },

  csClock: (ctx, w, h, t) => {
    backdrop(ctx, w, h, C.warn);
    const cy = (t % 2.6) / 2.6;
    const hpv = clamp(1 - cy / 0.82, 0, 1);
    blob(ctx, w / 2, h / 2 - 16, 12, hpv < 0.22 ? C.warn : C.danger);
    const bw = Math.min(150, w - 60);
    hpBar(ctx, w / 2 - bw / 2, h / 2 + 12, bw, 10, hpv, hpv < 0.22 ? C.warn : C.good, 6);
    ctx.fillStyle = rgba(C.gold, 0.4);
    ctx.fillRect(w / 2 - bw / 2, h / 2 + 12, bw * 0.22, 10);
    text(ctx, hpv <= 0.001 ? 'LAST HIT' : 'WAIT FOR THE BAND', w / 2, h - 14, {
      size: 10,
      color: hpv <= 0.001 ? C.warn : C.faint,
      track: 3,
    });
  },

  track: (ctx, w, h, t) => {
    backdrop(ctx, w, h, '#ff9f5c');
    const x = w / 2 + wob(t, 1) * (w * 0.3);
    const y = h / 2 + wob(t * 1.3, 4) * (h * 0.24);
    const mx = w / 2 + wob(t - 0.14, 1) * (w * 0.3);
    const my = h / 2 + wob((t - 0.14) * 1.3, 4) * (h * 0.24);
    blob(ctx, x, y, 12, '#ff9f5c');
    ring(ctx, x, y, 19, rgba(C.gold, 0.55), 1.5);
    ctx.strokeStyle = rgba(C.goldHot, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(x, y);
    ctx.stroke();
    ring(ctx, mx, my, 7, rgba(C.goldHot, 0.9), 1.5);
  },

  /* ---------------------------------------------------------------- mind */
  mapRecall: (ctx, w, h, t) => {
    backdrop(ctx, w, h, C.violet);
    const s = Math.min(w, h) - 26;
    const x = (w - s) / 2;
    const y = (h - s) / 2;
    ctx.fillStyle = 'rgba(4,10,16,0.9)';
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = 'rgba(60,140,190,0.22)';
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.12, y + s * 0.12);
    ctx.lineTo(x + s * 0.88, y + s * 0.88);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(190,170,120,0.28)';
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.16, y + s * 0.84);
    ctx.lineTo(x + s * 0.84, y + s * 0.16);
    ctx.stroke();
    ctx.strokeStyle = rgba(C.gold, 0.4);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);

    const cy = (t % 3) / 3;
    const spots = [
      [0.3, 0.28],
      [0.72, 0.55],
      [0.44, 0.78],
    ];
    spots.forEach((p, i) => {
      const px = x + p[0] * s;
      const py = y + p[1] * s;
      if (cy < 0.45) {
        disc(ctx, px, py, 4, C.danger);
        ring(ctx, px, py, 7 + ((t * 2 + i) % 1) * 5, rgba(C.danger, 0.5), 1);
      } else if (cy > 0.65 && cy < 0.9 && i < 2) {
        ring(ctx, px + 5, py - 4, 6, rgba(C.violet, 0.9), 1.5);
      }
    });
  },

  cooldowns: (ctx, w, h, t) => {
    backdrop(ctx, w, h, C.cyan);
    const cy = (t % 3.4) / 3.4;
    const lit = cy < 0.3 ? 1 - cy / 0.3 : 0;
    keycap(ctx, w / 2 - 34, h / 2 - 2, 30, 'F', { lit, color: C.cyanHot, sub: 'FLASH' });
    keycap(ctx, w / 2 + 34, h / 2 - 2, 30, 'I', { lit: 0, color: C.cyanHot, sub: 'IGNITE' });
    text(ctx, cy > 0.55 ? 'IS FLASH UP?' : 'MID USED FLASH', w / 2, h - 14, {
      size: 10,
      color: cy > 0.55 ? C.goldHot : C.faint,
      track: 3,
    });
  },

  execute: (ctx, w, h, t) => {
    backdrop(ctx, w, h, C.danger);
    const cy = (t % 3) / 3;
    const bw = Math.min(150, w - 60);
    hpBar(ctx, w / 2 - bw / 2, h / 2 - 22, bw, 12, 0.34, C.danger, 8);
    text(ctx, '620', w / 2, h / 2 - 16, { size: 10, color: '#fff', font: 'mono' });
    text(ctx, '210 + 95×3 + 120', w / 2, h / 2 + 8, { size: 11, color: C.cyanHot, font: 'mono' });
    text(ctx, cy > 0.5 ? 'GO' : 'CAN YOU KILL?', w / 2, h - 14, {
      size: cy > 0.5 ? 13 : 10,
      color: cy > 0.5 ? C.good : C.faint,
      track: 4,
    });
  },

  comboRecall: (ctx, w, h, t) => {
    backdrop(ctx, w, h, C.violet);
    const seq = ['Q', 'E', 'R', 'W'];
    const step = Math.floor(t * 2) % (seq.length + 2);
    const size = 24;
    const total = seq.length * size + (seq.length - 1) * 6;
    seq.forEach((k, i) => {
      const shown = i <= step;
      keycap(ctx, w / 2 - total / 2 + i * (size + 6) + size / 2, h / 2 - 2, size, shown ? k : '?', {
        lit: i === step ? 1 : 0,
        color: C.violet,
        dim: !shown,
      });
    });
    text(ctx, step >= seq.length ? 'PLAY IT BACK' : 'WATCH', w / 2, h - 14, {
      size: 10,
      color: step >= seq.length ? C.goldHot : C.faint,
      track: 4,
    });
  },
};

export const drawPreview = (
  id: TestId,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void => {
  DRAW[id](ctx, w, h, t);
};
