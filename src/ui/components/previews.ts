import type { DrillId } from '../../drills/catalog';

/**
 * WHAT EACH ACTIVITY LOOKS LIKE, IN THREE SECONDS.
 *
 * Every card on PRACTICE used to explain itself in two paragraphs, and two
 * paragraphs is the wrong instrument for the question a player is actually
 * asking at a menu — *what does this one look like when I am playing it?* A
 * mode whose whole shape is "a ring, and whether you are inside it" can answer
 * that in one picture; a mode whose shape is "shoot, roll, shoot" can only
 * answer it in a moving one.
 *
 * So each mode owns a short clip: a loop of the thing itself, drawn from the
 * same top-down vocabulary the arena uses — a bright dot that is you, red
 * markers that are not, rings for range, lances for anything travelling. They
 * are painted rather than recorded on purpose:
 *
 *  - **Crisp at any size.** There is no bitmap to soften. The painter works in
 *    a fixed 320×180 space and the canvas is sized to the real pixel grid, so
 *    the clip is exact on a phone, on a 4K panel and at any card width in
 *    between.
 *  - **Smooth at any frame rate.** Nothing is keyed to a frame counter.
 *    Everything below is a function of one number — seconds into the loop —
 *    so a 144Hz panel gets 144 distinct frames and a throttled tab does not
 *    stutter, it simply draws fewer.
 *  - **Seamless.** Every clip is written so the picture at `length` is the
 *    picture at zero. There is no cut to hide.
 *  - **Cheap.** A few dozen paths. Six of these can idle on one screen without
 *    the menu noticing, and only the one under the cursor is ever running.
 *
 * The still frame the card shows when nothing is hovered is not a separate
 * asset either: it is this same painter, stopped at the one instant in the
 * loop that reads best as a photograph — the moment the bolt lands, the moment
 * the wall hits.
 */

/** The space every painter draws in, whatever the card's real width is. */
export const STAGE_W = 320;
export const STAGE_H = 180;

export interface PreviewFrame {
  ctx: CanvasRenderingContext2D;
  /** Seconds into the loop. Always `0 <= t < length`. */
  t: number;
  /** The same thing as a fraction, for anything driven by a sine. */
  u: number;
  /** The mode's colour, so a clip is lit like the card it sits in. */
  accent: string;
  /**
   * Extra stage width on each side, in stage units, when the card is wider
   * than 16:9.
   *
   * The clip is fitted to the card's *height*, never scaled up to cover its
   * width — a wide band has more floor in it, not a bigger champion. A tile is
   * 16:9 and gets zero; the lane's wide strip gets a few hundred units either
   * side, and a painter is welcome to use them: `-bleed` is the left edge of
   * what will be visible and `STAGE_W + bleed` the right. Anything ignoring it
   * is simply a 320-wide picture centred in a wider frame, which is correct
   * too — so long as whatever fills the background fills the whole width.
   */
  bleed: number;
}

export interface PreviewScene {
  /** Seconds one loop lasts. */
  length: number;
  /** Where in the loop the still frame is taken from, as a fraction. */
  poster: number;
  /** The clip's caption — six words on what you are looking at. */
  caption: string;
  paint: (f: PreviewFrame) => void;
}

// ===========================================================================
// SMALL MATHS
// ===========================================================================

const TAU = Math.PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smoothstep: the only easing a two-second clip ever needs going in and out. */
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const easeIn = (x: number) => clamp01(x) ** 3;
/** A 0..1 ramp that opens at `from` seconds and takes `dur` to finish. */
const at = (t: number, from: number, dur: number) => clamp01((t - from) / dur);
/**
 * `rgba()` from one of the client's hex accents.
 *
 * Canvas has no `color-mix`, and every colour in these clips is some accent at
 * some alpha, so this is the one colour helper the whole file needs.
 */
const rgba = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const RED = '#ff5147';
const BLUE = '#5fb9ff';
const BONE = '#e8eefc';

// ===========================================================================
// THE VOCABULARY
// ===========================================================================

/**
 * The floor, and the light on it.
 *
 * Drawn rather than photographed for the same reason the rest is: a grid at a
 * known spacing is a scale bar. When the ring in RANGE covers three squares
 * and the roll in TUMBLE covers one, those two clips are telling the player
 * something true about the champion without a word of copy.
 */
function stage(f: PreviewFrame, glowX = 90, glowY = 118) {
  const { ctx, accent } = f;
  const x0 = -f.bleed;
  const x1 = STAGE_W + f.bleed;
  const base = ctx.createLinearGradient(0, 0, 0, STAGE_H);
  base.addColorStop(0, '#070d18');
  base.addColorStop(0.62, '#050a13');
  base.addColorStop(1, '#02050b');
  ctx.fillStyle = base;
  ctx.fillRect(x0, 0, x1 - x0, STAGE_H);

  // The floor grid fades out towards the top of the frame, which is the only
  // depth cue a flat top-down picture gets for free. It is drawn on absolute
  // stage coordinates rather than from the left edge, so a wide band and a
  // tile show the same grid at the same phase — the squares are a scale bar,
  // and a scale bar that shifts with the card is not one.
  ctx.lineWidth = 1;
  for (let y = 12; y < STAGE_H; y += 24) {
    ctx.strokeStyle = `rgba(120, 160, 210, ${0.03 + 0.05 * (y / STAGE_H)})`;
    ctx.beginPath();
    ctx.moveTo(x0, y + 0.5);
    ctx.lineTo(x1, y + 0.5);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(120, 160, 210, 0.045)';
  for (let x = 16 - Math.ceil((16 - x0) / 24) * 24; x < x1; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, STAGE_H);
    ctx.stroke();
  }

  const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, 150);
  glow.addColorStop(0, rgba(accent, 0.17));
  glow.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(x0, 0, x1 - x0, STAGE_H);
}

/** The dark corners. Painted last, over everything. */
function vignette(f: PreviewFrame, strength = 0.55) {
  const { ctx } = f;
  const cx = STAGE_W / 2;
  const r = Math.hypot(STAGE_W / 2 + f.bleed, STAGE_H / 2) * 1.05;
  const v = ctx.createRadialGradient(cx, STAGE_H / 2, r * 0.24, cx, STAGE_H / 2, r);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = v;
  ctx.fillRect(-f.bleed, 0, STAGE_W + f.bleed * 2, STAGE_H);
}

/** You: a lit disc with a facing chevron, so a still frame still has a heading. */
function hero(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accent: string,
  facing = 0,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 20);
  halo.addColorStop(0, rgba(accent, 0.5));
  halo.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, TAU);
  ctx.fill();

  ctx.fillStyle = rgba(accent, 0.95);
  ctx.beginPath();
  ctx.arc(x, y, 5.4, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.translate(x, y);
  ctx.rotate(facing);
  ctx.strokeStyle = rgba(accent, 0.85);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(7, -4.5);
  ctx.lineTo(12.5, 0);
  ctx.lineTo(7, 4.5);
  ctx.stroke();
  ctx.restore();
}

/** Anybody who is not you: a red diamond, because it must never read as a dot. */
function foe(ctx: CanvasRenderingContext2D, x: number, y: number, r = 5.5, alpha = 1, tint = RED) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = rgba(tint, 0.28);
  ctx.strokeStyle = rgba(tint, 0.95);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.rect(-r, -r, r * 2, r * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A ring on the floor: range, an aura, a stun. */
function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
  width = 1.2,
  dash?: number[],
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** Anything travelling in a straight line, with the light it drags behind it. */
function lance(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  len: number,
  color: string,
  alpha: number,
  width = 2.4,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(ang);
  const g = ctx.createLinearGradient(-len, 0, 0, 0);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(1, rgba(color, 0.95));
  ctx.strokeStyle = g;
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(-len, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(0, 0, width * 0.62, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** An impact: a hard ring that expands and dies inside a third of a second. */
function burst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: number,
  color: string,
  size = 26,
  spokes = 0,
) {
  if (p <= 0 || p >= 1) return;
  const a = (1 - p) ** 2;
  ring(ctx, x, y, easeOut(p) * size, rgba(color, 1), a * 0.9, 1.6 + 1.4 * (1 - p));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = rgba(color, 0.9);
  ctx.beginPath();
  ctx.arc(x, y, (1 - p) * 4, 0, TAU);
  ctx.fill();
  if (spokes) {
    ctx.strokeStyle = rgba(color, 0.8);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < spokes; i++) {
      const ang = (i / spokes) * TAU + p * 0.6;
      const r0 = 4 + easeOut(p) * size * 0.5;
      const r1 = r0 + 8 * (1 - p);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
      ctx.lineTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A short mono label — the clip's only words, and never more than two. */
function tag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  alpha: number,
  size = 8.5,
  align: CanvasTextAlign = 'center',
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `700 ${size}px 'JetBrains Mono', ui-monospace, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(text, x + 0.8, y + 0.8);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A wall: the only piece of terrain any of these clips needs. */
function wall(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number) {
  ctx.save();
  const g = ctx.createLinearGradient(x - 9, 0, x + 9, 0);
  g.addColorStop(0, 'rgba(90, 116, 150, 0.05)');
  g.addColorStop(1, 'rgba(120, 150, 190, 0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 9, y0, 18, y1 - y0);
  ctx.strokeStyle = 'rgba(150, 185, 230, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - 9, y0);
  ctx.lineTo(x - 9, y1);
  ctx.stroke();
  ctx.restore();
}

// ===========================================================================
// THE CLIPS
// ===========================================================================

/**
 * RANGE — the ring, and which side of it you are on.
 *
 * There is one idea in this mode and the clip is that idea: a dummy drifts in
 * and out of the circle, the circle answers, and the shots only exist while
 * the answer is yes. Nothing else happens, because in the mode nothing else
 * happens either.
 */
const rangecheck: PreviewScene = {
  length: 3.6,
  poster: 0.3,
  caption: 'the ring is the mode',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 108, 96);
    const hx = 108;
    const hy = 96;
    const R = 66;

    // One breath in, one breath out — the loop closes because a sine does.
    const dist = 44 + 46 * Math.sin(u * TAU - Math.PI / 2);
    const ang = -0.28;
    const ex = hx + Math.cos(ang) * dist;
    const ey = hy + Math.sin(ang) * dist;
    const inside = dist <= R;

    const pulse = inside ? 0.55 + 0.25 * Math.sin(t * 7) : 0.16;
    ring(ctx, hx, hy, R, rgba(accent, 1), pulse, inside ? 1.8 : 1.1, inside ? undefined : [4, 5]);
    if (inside) {
      const fill = ctx.createRadialGradient(hx, hy, R * 0.55, hx, hy, R);
      fill.addColorStop(0, rgba(accent, 0));
      fill.addColorStop(1, rgba(accent, 0.13));
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(hx, hy, R, 0, TAU);
      ctx.fill();
    }

    // The measurement itself, drawn as the tick you would put on a ruler.
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = rgba(inside ? accent : RED, 0.8);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();

    // An attack every 0.55s, but only while the dummy is in reach.
    if (inside) {
      const beat = ((t % 0.55) / 0.55);
      const p = easeOut(beat);
      lance(ctx, lerp(hx, ex, p), lerp(hy, ey, p), ang, 16, accent, 1 - beat * 0.35, 2.2);
      burst(ctx, ex, ey, 1 - beat > 0.72 ? (1 - beat - 0.72) / 0.28 : 0, accent, 16);
    }

    foe(ctx, ex, ey, 5.5, 1);
    hero(ctx, hx, hy, accent, ang);
    // Above the target rather than under the ring: the bottom of every clip
    // belongs to the card's own title, and a painter that writes there is
    // writing underneath it.
    tag(
      ctx,
      ex,
      ey - 17,
      inside ? 'IN RANGE' : 'TOO FAR',
      inside ? rgba(accent, 0.95) : rgba(RED, 0.9),
      0.9,
    );
    vignette(f);
  },
};

/**
 * TUMBLE — shoot, roll, shoot.
 *
 * Four beats, and the whole point of the clip is the quarter-second at the end
 * of the roll: the afterimages are spaced by real easing, so the eye reads the
 * roll as fast and the shot at the end of it as immediate. A mode about a
 * rhythm has to be previewed at that rhythm or it is previewing nothing.
 */
const vayneTumble: PreviewScene = {
  length: 3.2,
  poster: 0.06,
  caption: 'shoot · roll · shoot',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 96, 104);
    const ex = 246;
    const ey = 82;
    const beat = 0.8;
    const i = Math.floor(t / beat) % 4;
    const p = (t % beat) / beat;

    // Two stations. Beats 0 and 2 shoot; 1 and 3 roll between them, out and
    // back, so the fourth beat leaves the picture exactly where it started.
    const A = { x: 84, y: 118 };
    const B = { x: 112, y: 60 };
    const from = i === 1 ? A : i === 3 ? B : i === 0 ? A : B;
    const to = i === 1 ? B : i === 3 ? A : from;
    const rolling = i === 1 || i === 3;
    const k = rolling ? easeOut(Math.min(1, p / 0.62)) : 0;
    const hx = lerp(from.x, to.x, k);
    const hy = lerp(from.y, to.y, k);
    const ang = Math.atan2(ey - hy, ex - hx);

    if (rolling) {
      for (let g = 1; g <= 4; g++) {
        const kg = easeOut(Math.max(0, Math.min(1, (p - g * 0.055) / 0.62)));
        hero(ctx, lerp(from.x, to.x, kg), lerp(from.y, to.y, kg), accent, ang, 0.12 * (5 - g));
      }
      // The roll's own light, dragged along the path.
      lance(ctx, hx, hy, Math.atan2(to.y - from.y, to.x - from.x), 26 * (1 - p), accent, 0.5, 3);
    }

    // Shooting beats: the bolt leaves at once, lands two thirds through.
    if (!rolling) {
      const b = clamp01(p / 0.62);
      const q = easeOut(b);
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), ang, 20, accent, 0.95, 2.4);
      burst(ctx, ex, ey, b > 0.8 ? (b - 0.8) / 0.2 : 0, accent, 20, 6);
    }

    foe(ctx, ex, ey, 6, 1);
    hero(ctx, hx, hy, accent, ang);

    // The cooldown, because the rhythm this mode teaches is the cooldown's —
    // drawn as an arc on the champion rather than as a bar in a corner. A
    // status bar is chrome and would have to fight the card's title for the
    // bottom of the frame; a ring around the body is the world saying it.
    const cd = clamp01((t % (beat * 2)) / (beat * 2));
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = rgba(accent, 0.9);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(hx, hy, 13, -Math.PI / 2, -Math.PI / 2 + cd * TAU);
    ctx.stroke();
    ctx.restore();
    ring(ctx, hx, hy, 13, 'rgba(255,255,255,0.16)', 0.6, 1);
    vignette(f);
  },
};

/**
 * SILVER BOLTS — one, two, three.
 *
 * The pips above the target are the mode: two quiet hits and one that is not,
 * and the third landing is the only moment in the clip that gets a full-frame
 * flash. If a player takes one thing from three seconds of this, it should be
 * that the third hit looks different.
 */
const vayneBolts: PreviewScene = {
  length: 2.9,
  poster: 0.62,
  caption: 'one, two, three',
  paint: (f) => {
    const { ctx, accent, t } = f;
    const step = 0.62;
    const shot = Math.min(3, Math.floor(t / step));
    const p = clamp01((t % step) / (step * 0.7));
    const landed = Math.min(3, Math.floor((t - 0.34) / step) + 1);
    const procT = t - (2 * step + 0.34);

    stage(f, 96, 104);
    const hx = 92;
    const hy = 104;
    const ex = 226;
    const ey = 84;
    const ang = Math.atan2(ey - hy, ex - hx);

    if (procT > 0 && procT < 0.5) {
      // The proc lights the whole floor for a sixth of a second.
      ctx.save();
      ctx.globalAlpha = 0.5 * (1 - easeOut(procT / 0.5));
      ctx.fillStyle = rgba(BONE, 0.4);
      ctx.fillRect(-f.bleed, 0, STAGE_W + f.bleed * 2, STAGE_H);
      ctx.restore();
    }

    if (t < 3 * step) {
      const q = easeOut(p);
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), ang, 18, shot === 2 ? BONE : accent, 0.95, 2.2);
    }
    burst(ctx, ex, ey, procT > 0 ? procT / 0.55 : 0, BONE, 40, 8);
    if (landed > 0 && landed < 3) burst(ctx, ex, ey, clamp01((t - 0.34 - (landed - 1) * step) / 0.3), accent, 15);

    foe(ctx, ex, ey, 6, 1);
    hero(ctx, hx, hy, accent, ang);

    // Three pips: filled as they land, emptied by the proc.
    const stacks = procT > 0 ? 0 : Math.max(0, Math.min(3, landed));
    for (let s = 0; s < 3; s++) {
      const px = ex - 13 + s * 13;
      const on = s < stacks;
      const isThird = s === 2;
      ctx.save();
      ctx.globalAlpha = on ? 1 : 0.28;
      ctx.strokeStyle = on ? rgba(BONE, 0.95) : 'rgba(200,220,255,0.45)';
      ctx.fillStyle = on ? rgba(BONE, isThird ? 0.9 : 0.35) : 'rgba(0,0,0,0)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(px, ey - 26);
      ctx.lineTo(px + 4.5, ey - 20);
      ctx.lineTo(px, ey - 14);
      ctx.lineTo(px - 4.5, ey - 20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (procT > 0 && procT < 0.75) {
      tag(ctx, ex, ey - 40, 'TRUE DAMAGE', rgba(BONE, 1), 1 - easeIn(procT / 0.75), 9);
    }
    vignette(f);
  },
};

/**
 * CONDEMN — the wall does the damage.
 *
 * The clip is built around one instant, and everything before it is setup for
 * that instant: the target crosses the frame, the bolt lands, the target goes
 * backwards fast, and then it stops against something. The still frame is that
 * stop, because that is what the mode is for.
 */
const vayneCondemn: PreviewScene = {
  length: 3.2,
  poster: 0.42,
  caption: 'into something solid',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 92, 100);
    const WX = 268;
    wall(ctx, WX, 8, 172);

    const hx = 74;
    const hy = 100;
    const cast = 0.85;
    const fly = 0.22;
    const push = 0.3;

    // The target walks in, is thrown, is pinned, and fades out and back in so
    // the last frame of the loop matches the first.
    const start = 176;
    const pinned = WX - 16;
    const k = easeIn(at(t, cast + fly, push));
    const ex = lerp(start, pinned, k);
    const ey = 92;
    const stunned = t > cast + fly + push;
    const fade = 1 - smooth(at(t, 2.55, 0.45));
    const ang = Math.atan2(ey - hy, ex - hx);

    // The aim line, held for as long as the mode gives you to decide.
    if (t < cast) {
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.18 * Math.sin(t * 9);
      ctx.strokeStyle = rgba(accent, 1);
      ctx.lineWidth = 9;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(ang) * 230, hy + Math.sin(ang) * 230);
      ctx.stroke();
      ctx.restore();
    }
    if (t >= cast && t < cast + fly) {
      const q = at(t, cast, fly);
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), ang, 26, accent, 1, 4.5);
    }

    if (stunned) {
      const s = t - (cast + fly + push);
      burst(ctx, pinned + 12, ey, clamp01(s / 0.45), accent, 34, 9);
      ring(ctx, ex, ey, 13 + Math.sin(s * 8) * 1.5, rgba(accent, 1), 0.55 * fade, 1.4, [3, 4]);
      tag(ctx, ex, ey - 26, 'PINNED', rgba(accent, 1), (1 - easeIn(clamp01(s / 1.3))) * fade, 9);
      // Chips off the wall.
      ctx.save();
      ctx.globalAlpha = clamp01(1 - s / 0.5) * fade;
      ctx.fillStyle = rgba(accent, 0.9);
      for (let i = 0; i < 7; i++) {
        const a2 = Math.PI * (0.5 + (i / 6) * 1) + Math.PI / 2;
        const d = 6 + s * 90 + i * 2;
        ctx.fillRect(pinned + 12 + Math.cos(a2) * d, ey + Math.sin(a2) * d, 2, 2);
      }
      ctx.restore();
    }

    foe(ctx, ex, ey, 6, fade);
    hero(ctx, hx, hy, accent, ang);
    vignette(f);
  },
};

/**
 * NIGHT HUNTER — all of it, and you cannot see.
 *
 * The other clips are lit. This one is not, and the difference is the mode:
 * everything past the edge of your own light is a guess, and the three markers
 * only exist while they are inside it. The kit fires in sequence — shot, roll,
 * condemn — so the card reads as the one that hands you everything at once.
 */
const vayneHunt: PreviewScene = {
  length: 4.4,
  poster: 0.24,
  caption: 'all of it, in the dark',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 150, 96);
    // Night, everywhere, before anything is drawn on top of it.
    ctx.fillStyle = 'rgba(2, 4, 10, 0.88)';
    ctx.fillRect(-f.bleed, 0, STAGE_W + f.bleed * 2, STAGE_H);

    const loop = 4.4;
    const path = t / loop;
    const hx = 150 + Math.cos(path * TAU) * 46;
    const hy = 96 + Math.sin(path * TAU) * 26;
    const VIS = 74;

    // Your light: a hole cut in the night, and the only reason anything below
    // is visible at all.
    const lightGrad = ctx.createRadialGradient(hx, hy, 8, hx, hy, VIS);
    lightGrad.addColorStop(0, rgba(accent, 0.22));
    lightGrad.addColorStop(0.6, rgba(accent, 0.07));
    lightGrad.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = lightGrad;
    ctx.beginPath();
    ctx.arc(hx, hy, VIS, 0, TAU);
    ctx.fill();
    ring(ctx, hx, hy, VIS, rgba(accent, 1), 0.16, 1, [3, 6]);

    const marks = [
      { x: 236, y: 58 },
      { x: 252, y: 128 },
      { x: 96, y: 40 },
    ];
    // A target is drawn only as brightly as your own light reaches it.
    marks.forEach((m) => {
      const d = Math.hypot(m.x - hx, m.y - hy);
      foe(ctx, m.x, m.y, 5.5, clamp01(1 - (d - VIS * 0.35) / (VIS * 0.8)));
    });

    const target = marks[Math.floor(t / 1.47) % 3];
    const ang = Math.atan2(target.y - hy, target.x - hx);
    const beat = t % 1.47;
    if (beat < 0.5) {
      const q = easeOut(beat / 0.42);
      lance(ctx, lerp(hx, target.x, q), lerp(hy, target.y, q), ang, 18, accent, 0.95, 2.3);
      burst(ctx, target.x, target.y, clamp01((beat - 0.36) / 0.3), accent, 20, 6);
    }

    // Final Hour: the aura that says the ultimate is up.
    const ult = 0.5 + 0.5 * Math.sin(t * 2.4);
    ring(ctx, hx, hy, 16 + ult * 4, rgba('#ff8fc8', 1), 0.25 + ult * 0.35, 1.6);
    hero(ctx, hx, hy, accent, ang);
    vignette(f, 0.7);
  },
};

/**
 * SHERIFF — somebody else's cast time.
 *
 * Every other clip on the screen is about what your hands did. This one is
 * about what somebody else's did, so the frame is built the other way round:
 * the telegraph fills, the lance leaves, and the step out of it happens
 * *before* the lance does — which is the entire lesson.
 */
const caitlynDodge: PreviewScene = {
  length: 3.4,
  poster: 0.56,
  caption: 'step before it leaves',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 96, 100);
    const cx = 268;
    const cy = 88;
    const lane = 100;
    const hx = 78;

    const telegraph = 0.62;
    const travel = 0.62;
    // The step starts inside the cast time. Late is a hit, and the clip is
    // careful never to show late.
    const step = smooth(at(t, 0.34, 0.36)) * (1 - smooth(at(t, 1.9, 0.6)));
    const hy = lane - step * 34;

    // Where the shot was aimed: at the lane, not at where you end up.
    const aimY = lane;
    const ang = Math.atan2(aimY - cy, hx - cx);

    if (t < telegraph) {
      const p = t / telegraph;
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.3 * p;
      const g = ctx.createLinearGradient(cx, cy, hx - 30, aimY);
      g.addColorStop(0, rgba(accent, 0.65));
      g.addColorStop(1, rgba(accent, 0.05));
      ctx.strokeStyle = g;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(hx - 30, aimY);
      ctx.stroke();
      ctx.restore();
      // The cast bar, which is the number the codex prints for this ability.
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(cx - 22, cy - 20, 44, 3.5);
      ctx.fillStyle = rgba(accent, 0.95);
      ctx.fillRect(cx - 22, cy - 20, 44 * p, 3.5);
    }

    if (t >= telegraph && t < telegraph + travel) {
      const q = (t - telegraph) / travel;
      const mx = lerp(cx, hx - 40, q);
      const my = lerp(cy, aimY, q);
      lance(ctx, mx, my, ang, 46, accent, 1, 5);
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = rgba(accent, 0.5);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.restore();
    }

    const missed = t > telegraph + travel * 0.55 && t < telegraph + travel * 0.55 + 0.9;
    if (missed) {
      const p = (t - (telegraph + travel * 0.55)) / 0.9;
      tag(ctx, hx, hy - 24, 'CLEAN', rgba('#7dffb0', 1), 1 - easeIn(p), 9);
      ring(ctx, hx, lane, 10 + p * 16, rgba('#7dffb0', 1), (1 - p) * 0.45, 1.2);
    }

    // The line you were standing on, so the gap between it and you is legible.
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = 'rgba(200,220,255,0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(hx - 22, lane + 0.5);
    ctx.lineTo(cx, lane + 0.5);
    ctx.stroke();
    ctx.restore();

    foe(ctx, cx, cy, 6.5, 1, accent);
    hero(ctx, hx, hy, '#c86bff', 0.1);
    vignette(f);
  },
};

/**
 * LANE PHASE — the job itself.
 *
 * Not a mechanic: a wave, a turret, somebody on the other side, and one minion
 * dying at the right moment for gold. The gold number floating up is the only
 * score this mode has, so it is the thing the clip is built to show.
 *
 * It is also the one clip that reads its frame's width. The lane card is a
 * wide strip rather than a tile, and a lane *is* a wide strip — so the turret
 * goes to the far left of whatever the card actually is, the enemy paces the
 * far right, and the wave meets somewhere near the middle. On a narrow card
 * the same layout simply closes up.
 */
const lanePhase: PreviewScene = {
  length: 4.8,
  poster: 0.52,
  caption: 'a wave, and somebody opposite',
  paint: (f) => {
    const { ctx, accent, t } = f;
    const L = -f.bleed;
    const R = STAGE_W + f.bleed;
    const span = R - L;
    /** A fraction of the way across the lane, whatever the lane's width is. */
    const X = (k: number) => L + span * k;
    stage(f, X(0.1), 120);

    // The turret behind you, drawn as the client draws structures: a base and
    // a ring of reach.
    const tx = X(0.05);
    ring(ctx, tx, 118, 40, rgba(BLUE, 1), 0.14, 1, [4, 6]);
    ctx.save();
    ctx.fillStyle = rgba(BLUE, 0.22);
    ctx.strokeStyle = rgba(BLUE, 0.7);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(tx, 118, 9, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Two waves walking in and meeting where the lane's middle happens to be.
    const march = smooth(clamp01(t / 1.4));
    const meetB = X(0.44);
    const meetR = X(0.56);
    for (let i = 0; i < 3; i++) {
      const bx = lerp(X(0.14) + i * 14, meetB - i * 14, march);
      const rx = lerp(X(0.94) - i * 14, meetR + i * 14, march);
      const y = 96 + (i - 1) * 15;
      ctx.save();
      ctx.fillStyle = rgba(BLUE, 0.3);
      ctx.strokeStyle = rgba(BLUE, 0.85);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.rect(bx - 3.5, y - 3.5, 7, 7);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      foe(ctx, rx, y, 4, 1);
    }

    // The one that matters: the front red minion, bleeding out, taken on the
    // last hit rather than a moment early.
    const csAt = 2.5;
    const hpFull = clamp01(1 - at(t, 1.5, 1.0) * 0.86);
    const dead = t >= csAt;
    const mx = meetR + 28;
    const my = 111;
    if (!dead) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(mx - 11, my - 12, 22, 3);
      ctx.fillStyle = hpFull < 0.25 ? '#ffd166' : '#ff6a5f';
      ctx.fillRect(mx - 11, my - 12, 22 * hpFull, 3);
      ctx.restore();
      foe(ctx, mx, my, 4.5, 1);
    }

    const hx = X(0.33);
    const hy = 124;
    const ang = Math.atan2(my - hy, mx - hx);
    if (t > csAt - 0.36 && t < csAt) {
      const q = easeOut((t - (csAt - 0.36)) / 0.3);
      lance(ctx, lerp(hx, mx, q), lerp(hy, my, q), ang, 18, accent, 0.95, 2.2);
    }
    burst(ctx, mx, my, dead ? clamp01((t - csAt) / 0.5) : 0, '#ffd166', 22, 7);
    if (dead) {
      const p = clamp01((t - csAt) / 1.5);
      tag(ctx, mx, my - 16 - p * 22, '+21 g', rgba('#ffd166', 1), 1 - easeIn(p), 10);
    }

    // The other one, walking the line, deciding whether to punish it.
    const ox = X(0.78);
    const oy = 58 + Math.sin(t * 1.3) * 16;
    foe(ctx, ox, oy, 6.5, 1);
    ring(ctx, ox, oy, 26, rgba(RED, 1), 0.12, 1, [3, 5]);

    hero(ctx, hx, hy, accent, ang);
    tag(ctx, tx - 9, 150, 'CS 34', rgba(BLUE, 0.75), 0.85, 8.5, 'left');
    vignette(f);
  },
};

/**
 * Every clip the client owns, by the mode it belongs to.
 *
 * Partial on purpose: a mode with no clip draws its accent and its name and is
 * a perfectly good card. Nothing in the menu may depend on a picture existing.
 */
export const PREVIEWS: Partial<Record<DrillId, PreviewScene>> = {
  rangecheck,
  vayneTumble,
  vayneBolts,
  vayneCondemn,
  vayneHunt,
  caitlynDodge,
  lanePhase,
};
