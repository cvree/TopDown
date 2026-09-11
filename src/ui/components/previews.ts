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

/**
 * The bottom of a clip belongs to the card, not to the painter.
 *
 * Both the cards that carry these put their own name and their own kind label
 * across the foot of the picture, over a gradient. A painter that draws inside
 * this band is drawing underneath somebody else's text, so nothing below it
 * ever carries information — the floor may run there, a pad may not.
 */
const TITLE_BAND = STAGE_H - 26;

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

// ===========================================================================
// THE LAB
// ===========================================================================

/**
 * THIRTEEN BENCHES, EACH IN THREE SECONDS.
 *
 * The lab is the one section of the client whose cards could not be read. A
 * champion mode has a name you already know the shape of — *dodge*, *last
 * hit*, *lane* — and a bench does not: CANCEL, UPKEEP and SWITCH are thirteen
 * abstractions on a floor of circles, and no amount of copy makes "spend each
 * dial as soon as it fills up" into a picture. So the benches get the same
 * treatment the champion modes got, and it matters more here.
 *
 * Every clip below is built out of the same four things the bench itself is
 * built out of — a pad, the key printed on it, the countdown around it, and
 * the pointer — so the picture on the card is the picture in the run. Three of
 * those were already in the client. The fourth is new, and it is in every clip
 * for a reason: *the pointer is always on the pad that is lit*. A player who
 * has watched three seconds of any of these has been told the rule that used
 * to have to be read, which is that this section wants your mouse as well as
 * your hand.
 */

/** The near-black a bench pad sits on when nothing is asking for it. */
const PAD_OFF = '#7f96b8';
const GOOD = '#5ce1a8';
const WARN = '#ffb45c';

/** Eases a point along to another one. The only movement a bench ever makes. */
const glide = (a: Pt, b: Pt, p: number): Pt => ({
  x: lerp(a.x, b.x, smooth(p)),
  y: lerp(a.y, b.y, smooth(p)),
});

/**
 * Where a pointer comes to rest on a pad.
 *
 * Not the middle. A pad's middle is where its key is printed, and an arrow
 * parked on top of that hides the one thing the pad is there to say. Down and
 * to the left is comfortably inside the smallest pad any of these clips draws
 * and leaves the glyph clear — and the lock ring is drawn around the pointer
 * rather than around the pad, so it still reads as *the cursor is on this*.
 */
const onPad = (p: Pt): Pt => ({ x: p.x - 11, y: p.y + 6 });

interface Pt {
  x: number;
  y: number;
}

/** A partial ring, from twelve o'clock clockwise. Every countdown on a bench. */
function arcRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  p: number,
  color: string,
  alpha: number,
  width = 1.8,
) {
  if (p <= 0.002) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + clamp01(p) * TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * A pad: a lit face, an edge, what it wants written on it.
 *
 * The same four marks `paintPad` puts on the floor of a real run, in the same
 * order, so the card and the arena are drawing one object rather than two
 * things that resemble each other.
 */
function benchPad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  glow: number,
  opts: { text?: string; sub?: string; progress?: number; barred?: boolean; dim?: boolean } = {},
) {
  const g = clamp01(glow);
  ctx.save();
  const face = ctx.createRadialGradient(x, y, 0, x, y, r);
  face.addColorStop(0, rgba(color, 0.05 + g * 0.34));
  face.addColorStop(1, rgba(color, 0.01 + g * 0.08));
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
  ring(ctx, x, y, r, rgba(color, 1), 0.16 + g * 0.76, 0.9 + g * 1.9);
  if (opts.progress !== undefined) {
    arcRing(ctx, x, y, r + 4.5, opts.progress, rgba(opts.progress < 0.3 ? RED : color, 1), 0.85);
  }
  if (opts.barred) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = rgba(color, 1);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const d = r * 0.52;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
    ctx.stroke();
    ctx.restore();
  }
  if (opts.text) tag(ctx, x, y, opts.text, rgba(color, 0.45 + g * 0.55), 1, Math.max(8, r * 0.62));
  if (opts.sub) tag(ctx, x, y + r + 8, opts.sub, rgba(color, 0.85), 0.85, 6.5);
}

/**
 * The pointer, and whether it is on the pad.
 *
 * It is drawn as the arrow the operating system draws rather than as a
 * crosshair, because the thing being taught is *where your mouse is*, and a
 * crosshair reads as a thing in the game world instead. The ring around it is
 * the lock: closed and bright means this press will count, and that is the one
 * fact about the lab that nothing on the old card said.
 */
function pointer(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, locked = false) {
  if (locked) {
    ring(ctx, x, y, 8.5, rgba(color, 1), 0.95, 1.4);
    ring(ctx, x, y, 13, rgba(color, 1), 0.3, 1);
  } else {
    ring(ctx, x, y, 10, rgba(BONE, 1), 0.28, 1, [2.5, 3.5]);
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 11.2);
  ctx.lineTo(3.1, 8.6);
  ctx.lineTo(5.3, 13.2);
  ctx.lineTo(7.1, 12.3);
  ctx.lineTo(4.9, 7.8);
  ctx.lineTo(8.6, 7.4);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fill();
  ctx.restore();
}

/** A key, as the cap it is printed on. The queue modes are built out of these. */
function keycap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  color: string,
  alpha: number,
  size = 15,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const h = size / 2;
  ctx.fillStyle = rgba(color, 0.14);
  ctx.strokeStyle = rgba(color, 0.8);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(x - h, y - h, size, size, 3);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  tag(ctx, x, y + 0.4, label, rgba(color, 0.95), alpha, size * 0.58);
}

/** The bench outline: N pads read as one console rather than as N circles. */
function benchLine(ctx: CanvasRenderingContext2D, pads: Pt[], alpha = 0.22) {
  if (pads.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(150, 185, 230, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pads[0].x, pads[0].y);
  for (let i = 1; i < pads.length; i++) ctx.lineTo(pads[i].x, pads[i].y);
  ctx.stroke();
  ctx.restore();
}

/** The board in the corner, from level four up. Two lanes and something falling. */
function corner(f: PreviewFrame, drop: number, lane: number, key: string, hit: number) {
  const { ctx, accent } = f;
  const x = STAGE_W - 56;
  const y = TITLE_BAND - 40;
  const w = 44;
  const h = 36;
  ctx.save();
  ctx.fillStyle = 'rgba(4, 9, 18, 0.82)';
  ctx.strokeStyle = 'rgba(140, 175, 220, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  const laneX = [x + w * 0.32, x + w * 0.68];
  for (let i = 0; i < 2; i++) {
    ring(ctx, laneX[i], y + h - 7, 4, rgba(i === lane ? accent : PAD_OFF, 1), i === lane ? 0.9 : 0.3, 1.2);
  }
  if (drop >= 0) {
    const dy = lerp(y + 6, y + h - 7, clamp01(drop));
    foe(ctx, laneX[1 - lane], dy, 3, 0.95);
  }
  tag(ctx, x + w / 2, y - 7, key, rgba(accent, 0.9), 0.9, 6.5);
  burst(ctx, laneX[lane], y + h - 7, hit, accent, 12);
}

// ---------------------------------------------------------------- the clips

/**
 * PULSE — two pads, and the one that does not move.
 *
 * Four beats, and the third is the mode: the light stays where it was, so the
 * hand that had decided to alternate is the hand that gets it wrong. The clip
 * says so out loud, because it is the entire reason the mode is not a
 * metronome.
 */
const apmPulse: PreviewScene = {
  length: 3.0,
  poster: 0.13,
  caption: 'two keys · the light repeats',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 96);
    const pads: Pt[] = [
      { x: 108, y: 92 },
      { x: 212, y: 92 },
    ];
    const LIT = [0, 1, 1, 0];
    const beat = 0.75;
    const i = Math.floor(t / beat) % 4;
    const p = (t % beat) / beat;
    const lit = LIT[i];
    const from = pads[LIT[(i + 3) % 4]];
    const to = pads[lit];
    const cur = glide(onPad(from), onPad(to), clamp01(p / 0.38));
    const pressed = p >= 0.46;
    const repeat = LIT[(i + 3) % 4] === lit;

    benchLine(ctx, pads);
    pads.forEach((pd, k) => {
      const on = k === lit;
      benchPad(ctx, pd.x, pd.y, 30, on ? accent : PAD_OFF, on ? (pressed ? 0.45 : 1) : 0.06, {
        text: k === 0 ? 'Q' : 'W',
        progress: on && !pressed ? 1 - p / 0.46 : undefined,
      });
    });
    if (pressed) burst(ctx, to.x, to.y, (p - 0.46) / 0.3, accent, 40, 6);
    pointer(ctx, cur.x, cur.y, accent, p >= 0.38);
    // One line at the top, and it says whichever of the two things this beat
    // is about: the light repeating, or — on every other beat — the rule that
    // governs all thirteen benches. The foot of the frame belongs to the card.
    if (repeat) tag(ctx, 160, 30, 'SAME PAD AGAIN', rgba(WARN, 1), 0.85 * smooth(clamp01(p * 4)));
    else tag(ctx, 160, 30, 'CURSOR ON THE PAD, THEN THE KEY', rgba(BONE, 0.55), 0.75, 7);
    vignette(f);
  },
};

/**
 * SEQUENCE — a queue that never empties.
 *
 * The queue is the picture: five caps rolling in from the right, and only the
 * one at the front worth anything. Nothing about it is a rhythm — the clip
 * answers the same key twice in four beats — so what the eye takes from it is
 * *read the front, take the front*, which is the mode.
 */
const apmSequence: PreviewScene = {
  length: 3.2,
  poster: 0.2,
  caption: 'take the front of the queue',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 110);
    const SEQ = [0, 1, 2, 1];
    const GLYPH = ['Q', 'W', 'E'];
    const beat = 0.8;
    const i = Math.floor(t / beat) % 4;
    const p = (t % beat) / beat;
    const pads: Pt[] = [
      { x: 96, y: 122 },
      { x: 160, y: 122 },
      { x: 224, y: 122 },
    ];
    const want = SEQ[i];

    // The queue, rolling one cap left over each beat. Six drawn, four distinct
    // — so the picture at the end of the loop is the picture at the start.
    for (let k = 0; k < 6; k++) {
      const x = 128 + (k - smooth(clamp01((p - 0.55) / 0.3))) * 36;
      const a = k === 0 ? 1 - clamp01((p - 0.55) / 0.3) : 1;
      keycap(ctx, x, 46, GLYPH[SEQ[(i + k) % 4]], k === 0 ? accent : PAD_OFF, a * (k === 0 ? 1 : 0.6), k === 0 ? 20 : 16);
    }
    tag(ctx, 128, 24, 'NEXT', rgba(accent, 0.9), 0.8, 6.5);

    benchLine(ctx, pads);
    const pressed = p >= 0.5;
    pads.forEach((pd, k) => {
      const on = k === want;
      benchPad(ctx, pd.x, pd.y, 26, on ? accent : PAD_OFF, on ? (pressed ? 0.4 : 0.95) : 0.06, {
        text: GLYPH[k],
      });
    });
    const cur = glide(onPad(pads[SEQ[(i + 3) % 4]]), onPad(pads[want]), clamp01(p / 0.42));
    if (pressed) burst(ctx, pads[want].x, pads[want].y, (p - 0.5) / 0.28, accent, 34, 5);
    pointer(ctx, cur.x, cur.y, accent, p >= 0.42);
    vignette(f);
  },
};

/**
 * CHORD — two fingers, one moment.
 *
 * The number is the mode, so the number is on screen: the pair lands, and the
 * gap between the two presses is printed where it happened. Anything under the
 * tolerance is a hit and the clip shows a hit, because a preview that showed
 * the failure would be advertising the thing the mode is trying to remove.
 */
const apmChord: PreviewScene = {
  length: 2.6,
  poster: 0.31,
  caption: 'both keys, one moment',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 92);
    const c = { x: 160, y: 92 };
    const GLYPH = ['Q', 'W', 'E', 'R'];
    const pads: Pt[] = GLYPH.map((_, k) => {
      const a = -Math.PI / 2 + (k / 4) * TAU;
      return { x: c.x + Math.cos(a) * 74, y: c.y + Math.sin(a) * 38 };
    });
    const PAIRS: [number, number][] = [
      [0, 2],
      [1, 3],
    ];
    const beat = 1.3;
    const i = Math.floor(t / beat) % 2;
    const p = (t % beat) / beat;
    const pair = PAIRS[i];
    const prev = PAIRS[(i + 1) % 2];
    const pressed = p >= 0.5;
    const mid = { x: (pads[pair[0]].x + pads[pair[1]].x) / 2, y: (pads[pair[0]].y + pads[pair[1]].y) / 2 };

    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = rgba(accent, 0.9);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(pads[pair[0]].x, pads[pair[0]].y);
    ctx.lineTo(pads[pair[1]].x, pads[pair[1]].y);
    ctx.stroke();
    ctx.restore();

    pads.forEach((pd, k) => {
      const on = k === pair[0] || k === pair[1];
      benchPad(ctx, pd.x, pd.y, 24, on ? accent : PAD_OFF, on ? (pressed ? 0.45 : 0.95) : 0.06, {
        text: GLYPH[k],
        progress: on && !pressed ? 1 - p / 0.5 : undefined,
      });
    });
    if (pressed) {
      const q = (p - 0.5) / 0.3;
      burst(ctx, pads[pair[0]].x, pads[pair[0]].y, q, accent, 32, 4);
      burst(ctx, pads[pair[1]].x, pads[pair[1]].y, q, accent, 32, 4);
      tag(ctx, mid.x, mid.y - 2, '11ms', rgba(GOOD, 1), 1 - q * 0.4, 10);
    }
    // One pointer, two pads: resting on either of the pair is enough, which is
    // the one place the rule bends and the only way a chord could obey it.
    const cur = glide(onPad(pads[prev[0]]), onPad(pads[pair[0]]), clamp01(p / 0.44));
    pointer(ctx, cur.x, cur.y, accent, p >= 0.44);
    vignette(f);
  },
};

/**
 * GO / NO-GO — the press you were right not to make.
 *
 * Half the clip is a pad nobody touches, which is the hardest thing a preview
 * can be asked to show and the only honest picture of this mode. The pointer
 * still travels to the barred pad — the eye goes there, the hand does not —
 * because that is exactly what the mode costs a player who cannot stop.
 */
const apmGate: PreviewScene = {
  length: 3.2,
  poster: 0.66,
  caption: 'half of them say do not press',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 96);
    const GLYPH = ['Q', 'W', 'E'];
    const pads: Pt[] = [
      { x: 88, y: 96 },
      { x: 160, y: 96 },
      { x: 232, y: 96 },
    ];
    const CALLS: { pad: number; bar: boolean }[] = [
      { pad: 0, bar: false },
      { pad: 2, bar: true },
      { pad: 1, bar: false },
      { pad: 2, bar: false },
    ];
    const beat = 0.8;
    const i = Math.floor(t / beat) % 4;
    const p = (t % beat) / beat;
    const call = CALLS[i];
    const color = call.bar ? RED : accent;
    const pressed = !call.bar && p >= 0.5;

    benchLine(ctx, pads);
    pads.forEach((pd, k) => {
      const on = k === call.pad;
      benchPad(ctx, pd.x, pd.y, 28, on ? color : PAD_OFF, on ? (pressed ? 0.4 : 0.95) : 0.06, {
        text: GLYPH[k],
        progress: on && !pressed ? 1 - p / (call.bar ? 1 : 0.5) : undefined,
        barred: on && call.bar,
        sub: on ? (call.bar ? 'HANDS OFF' : 'GO') : undefined,
      });
    });
    if (pressed) burst(ctx, pads[call.pad].x, pads[call.pad].y, (p - 0.5) / 0.3, accent, 36, 5);
    if (call.bar && p > 0.86) {
      tag(ctx, pads[call.pad].x, pads[call.pad].y - 44, 'HELD', rgba(GOOD, 1), (p - 0.86) / 0.14);
    }
    const cur = glide(onPad(pads[CALLS[(i + 3) % 4].pad]), onPad(pads[call.pad]), clamp01(p / 0.42));
    pointer(ctx, cur.x, cur.y, color, p >= 0.42);
    vignette(f);
  },
};

/**
 * BUFFER — press before it opens, not after.
 *
 * Two cycles, and the whole subject is a quarter of a second wide, so the clip
 * draws the thing that quarter-second is measured against: a ring closing on
 * an opening, the press landing inside the last sliver of it, and the word
 * that separates this mode from every other one in the section — *buffered*,
 * not *reacted*.
 */
const apmBuffer: PreviewScene = {
  length: 2.4,
  poster: 0.42,
  caption: 'press just before it opens',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 94);
    const c = { x: 160, y: 94 };
    const cycle = 1.2;
    const p = (t % cycle) / cycle;
    // The opening is at 0.82 of the cycle; the buffer window is the 0.16
    // before it, and the press lands at 0.74 — inside it, which is the point.
    const open = 0.82;
    const pressed = p >= 0.74;
    const opened = p >= open;

    // The window, drawn on the floor as the band it is.
    arcRing(ctx, c.x, c.y, 54, 1, rgba(PAD_OFF, 1), 0.18, 2);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = rgba(GOOD, 1);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 54, -Math.PI / 2 + (open - 0.16) * TAU, -Math.PI / 2 + open * TAU);
    ctx.stroke();
    ctx.restore();
    arcRing(ctx, c.x, c.y, 54, p, rgba(accent, 1), 0.95, 2.4);

    benchPad(ctx, c.x, c.y, 40, opened ? GOOD : accent, pressed ? 0.5 : 0.5 + p * 0.4, {
      text: 'Q',
      sub: opened ? 'OPEN' : 'SHUT',
    });
    if (pressed) {
      burst(ctx, c.x, c.y, clamp01((p - 0.74) / 0.26), accent, 46, 6);
      tag(ctx, c.x, c.y - 60, 'BUFFERED · 74ms EARLY', rgba(GOOD, 1), 1 - clamp01((p - 0.74) / 0.4) * 0.3);
    } else {
      tag(ctx, c.x, c.y - 60, 'TOO EARLY IS IGNORED', rgba(BONE, 0.6), 0.7, 7);
    }
    // The idle wobble rides the cycle rather than the wall clock: a hand
    // resting on a pad still moves, and a movement whose period does not
    // divide the loop is the one thing that would stop this being a loop.
    const rest = onPad(c);
    pointer(ctx, rest.x + Math.sin(p * TAU) * 3, rest.y + Math.cos(p * TAU * 2) * 2, accent, true);
    vignette(f);
  },
};

/**
 * CANCEL — start it, then cut it short.
 *
 * The bar between the two pads is the animation you are cancelling, and the
 * clip is built so the eye can see the part of it that never plays: the cut
 * lands with a third of the bar still unspent, and the stub left behind is the
 * whole of what the mode is worth.
 */
const apmCancel: PreviewScene = {
  length: 3.0,
  poster: 0.63,
  caption: 'start the bar, then cut it',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 92);
    const a = { x: 96, y: 92 };
    const b = { x: 224, y: 92 };
    const cycle = 1.5;
    const p = (t % cycle) / cycle;
    // call → start at 0.24 → commit → cut window opens 0.56 → cut at 0.68.
    const started = p >= 0.24;
    const cutting = p >= 0.56;
    const cut = p >= 0.68;
    const barTo = cut ? 0.66 : clamp01((p - 0.24) / 0.66);

    // The bar: the thing you are racing, drawn between the two keys that
    // start it and end it.
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(12, 20, 34, 0.9)';
    ctx.strokeStyle = rgba(PAD_OFF, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(a.x, 40, b.x - a.x, 11);
    ctx.fill();
    ctx.stroke();
    if (started) {
      ctx.fillStyle = rgba(cut ? WARN : accent, cut ? 0.55 : 0.85);
      ctx.fillRect(a.x + 1, 41, (b.x - a.x - 2) * barTo, 9);
    }
    ctx.restore();
    // Where the cut is allowed. A window you can see is a window you can aim at.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = rgba(GOOD, 1);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x + (b.x - a.x) * 0.48, 36);
    ctx.lineTo(a.x + (b.x - a.x) * 0.48, 55);
    ctx.moveTo(a.x + (b.x - a.x) * 0.78, 36);
    ctx.lineTo(a.x + (b.x - a.x) * 0.78, 55);
    ctx.stroke();
    ctx.restore();
    tag(ctx, 160, 28, cut ? 'CANCELLED · 92ms' : cutting ? 'CUT IT NOW' : 'CASTING', rgba(cut ? GOOD : accent, 1), 0.95);

    benchPad(ctx, a.x, a.y, 30, started && !cut ? PAD_OFF : accent, started && !cut ? 0.08 : 0.85, {
      text: 'Q',
      sub: 'START',
    });
    benchPad(ctx, b.x, b.y, 30, cutting ? accent : PAD_OFF, cutting ? (cut ? 0.4 : 0.95) : 0.06, {
      text: 'R',
      sub: 'CUT',
      progress: cutting && !cut ? 1 - (p - 0.56) / 0.12 : undefined,
    });
    if (p >= 0.24 && p < 0.44) burst(ctx, a.x, a.y, (p - 0.24) / 0.2, accent, 34, 4);
    if (cut) burst(ctx, b.x, b.y, clamp01((p - 0.68) / 0.26), GOOD, 40, 6);

    const cur =
      cutting || cut
        ? glide(onPad(a), onPad(b), clamp01((p - 0.5) / 0.12))
        : glide(onPad(b), onPad(a), clamp01((p + 0.16) / 0.2));
    pointer(ctx, cur.x, cur.y, accent, true);
    vignette(f);
  },
};

/**
 * VECTOR — a direction, as fast as you can produce one.
 *
 * Nothing to dodge, nowhere to be: an arrow calls a heading and the body goes
 * there. Four calls that sum to zero, so the champion ends the loop standing
 * exactly where it opened it and there is no cut to hide.
 */
const apmVector: PreviewScene = {
  length: 2.8,
  poster: 0.18,
  caption: 'the call, then the heading',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 96);
    const DIRS: Pt[] = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ];
    const NAMES = ['EAST', 'SOUTH', 'WEST', 'NORTH'];
    const beat = 0.7;
    const i = Math.floor(t / beat) % 4;
    const p = (t % beat) / beat;
    const step = 26;
    // Where the body is: every leg it has already walked, plus this one.
    let hx = 160;
    let hy = 96;
    for (let k = 0; k < i; k++) {
      hx += DIRS[k].x * step;
      hy += DIRS[k].y * step * 0.62;
    }
    const go = smooth(clamp01((p - 0.22) / 0.6));
    hx += DIRS[i].x * step * go;
    hy += DIRS[i].y * step * 0.62 * go;
    const d = DIRS[i];
    const ang = Math.atan2(d.y * 0.62, d.x);

    // The call: a wedge on the floor, wide enough to be the tolerance it is.
    ctx.save();
    ctx.globalAlpha = 0.16 + 0.14 * (1 - clamp01(p / 0.3));
    ctx.fillStyle = rgba(accent, 1);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, 64, ang - 0.38, ang + 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    lance(ctx, hx + Math.cos(ang) * 48, hy + Math.sin(ang) * 48, ang, 34, accent, 0.9, 2.6);
    tag(ctx, 160, 26, NAMES[i], rgba(accent, 1), 0.9 * (1 - clamp01((p - 0.5) / 0.5) * 0.5), 11);
    ring(ctx, hx, hy, 15 + go * 6, rgba(accent, 1), 0.3 * (1 - go), 1.4);
    hero(ctx, hx, hy, accent, ang);
    tag(ctx, 160, TITLE_BAND - 14, 'NO PADS · JUST THE COMMAND', rgba(BONE, 0.5), 0.75, 7);
    vignette(f);
  },
};

/**
 * FIELD — pure mouse, and scored on the middle.
 *
 * The only mode on the bench with no key in it, so the clip has no key in it:
 * a mark drifts, the pointer catches it, and the ring that blooms is drawn
 * from where the click actually landed rather than from the middle — the mode
 * pays for the centre and the picture has to be able to say so.
 */
const apmField: PreviewScene = {
  length: 3.0,
  poster: 0.26,
  caption: 'click it, and click it central',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 96);
    const SPOTS: Pt[] = [
      { x: 96, y: 62 },
      { x: 224, y: 100 },
      { x: 150, y: 112 },
    ];
    const beat = 1.0;
    const i = Math.floor(t / beat) % 3;
    const p = (t % beat) / beat;
    // Two turns of the loop, so a mark is back where it started at 3s and the
    // clip closes. A drift on its own clock would never quite close.
    const drift = (sp: Pt, k: number): Pt => ({
      x: sp.x + Math.sin((t / 3.0) * TAU * 2 + k) * 16,
      y: sp.y + Math.cos((t / 3.0) * TAU * 2 + k * 2) * 9,
    });
    const target = drift(SPOTS[i], i);
    const r = 30;
    const clicked = p >= 0.72;

    // The one ahead of it, faint: the bench always has more than one alive.
    const nextSpot = drift(SPOTS[(i + 1) % 3], i + 1);
    if (p > 0.45) benchPad(ctx, nextSpot.x, nextSpot.y, r, accent, 0.18 * ((p - 0.45) / 0.55), { text: '' });

    benchPad(ctx, target.x, target.y, r, clicked ? GOOD : accent, clicked ? 0.35 : 0.8, {
      progress: clicked ? undefined : 1 - p / 0.72,
    });
    ring(ctx, target.x, target.y, r * 0.3, rgba(accent, 1), clicked ? 0.2 : 0.55, 1);
    const cur = glide(drift(SPOTS[(i + 2) % 3], i + 2), target, clamp01(p / 0.66));
    if (clicked) {
      burst(ctx, target.x, target.y, (p - 0.72) / 0.28, GOOD, 40, 6);
      tag(ctx, target.x, target.y - r - 12, 'CENTRE', rgba(GOOD, 1), 1 - (p - 0.72) / 0.4);
    }
    pointer(ctx, cur.x, cur.y, accent, p >= 0.66);
    vignette(f);
  },
};

/**
 * HANDOFF — mouse, keyboard, mouse, keyboard.
 *
 * The measurement is the handover, so the clip draws the handover: a bracket
 * under the picture that names whose turn it is, switching on the beat. Four
 * beats is two full passes, which is the shortest loop that shows the
 * alternation is a rule rather than a coincidence.
 */
const apmHandoff: PreviewScene = {
  length: 3.2,
  poster: 0.14,
  caption: 'never twice with one hand',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 86);
    const beat = 0.8;
    const i = Math.floor(t / beat) % 4;
    const p = (t % beat) / beat;
    const mouseTurn = i % 2 === 0;
    const CLICKS: Pt[] = [
      { x: 108, y: 72 },
      { x: 214, y: 62 },
    ];
    const keys: Pt[] = [
      { x: 116, y: 126 },
      { x: 160, y: 126 },
      { x: 204, y: 126 },
    ];
    const GLYPH = ['Q', 'W', 'E'];
    const clickPad = CLICKS[(i >> 1) % 2];
    const keyIdx = [1, 0, 2, 0][i];
    const done = p >= 0.56;

    benchLine(ctx, keys);
    keys.forEach((pd, k) => {
      const on = !mouseTurn && k === keyIdx;
      benchPad(ctx, pd.x, pd.y, 20, on ? accent : PAD_OFF, on ? (done ? 0.4 : 0.95) : 0.05, {
        text: GLYPH[k],
      });
    });
    if (mouseTurn) {
      benchPad(ctx, clickPad.x, clickPad.y, 34, done ? GOOD : accent, done ? 0.35 : 0.85, {
        sub: 'CLICK',
        progress: done ? undefined : 1 - p / 0.56,
      });
    }
    const to = mouseTurn ? clickPad : keys[keyIdx];
    const from = mouseTurn ? keys[[1, 0, 2, 0][(i + 3) % 4]] : CLICKS[((i + 3) >> 1) % 2];
    const cur = glide(mouseTurn ? from : onPad(from), mouseTurn ? to : onPad(to), clamp01(p / 0.5));
    if (done) burst(ctx, to.x, to.y, (p - 0.56) / 0.3, mouseTurn ? GOOD : accent, 38, 5);
    pointer(ctx, cur.x, cur.y, accent, p >= 0.5);

    // Whose turn it is, spelled out. The mode is the alternation and nothing
    // else, so the clip states it rather than leaving it to be inferred.
    tag(ctx, 116, 26, 'MOUSE', rgba(mouseTurn ? accent : PAD_OFF, 1), mouseTurn ? 1 : 0.4, 9);
    tag(ctx, 160, 26, '→', rgba(BONE, 0.5), 0.6, 9);
    tag(ctx, 204, 26, 'KEYS', rgba(!mouseTurn ? accent : PAD_OFF, 1), !mouseTurn ? 1 : 0.4, 9);
    vignette(f);
  },
};

/**
 * SPLIT — the middle and the corner, at the same time.
 *
 * Two things happen in this clip and neither waits for the other, which is the
 * entire mode. The queue in the middle keeps its beat all the way through the
 * orb falling in the corner, so the picture never resolves into one thing to
 * look at — because in the run it never does either.
 */
const apmSplit: PreviewScene = {
  length: 3.2,
  poster: 0.72,
  caption: 'the queue and the corner',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 140, 92);
    const GLYPH = ['Q', 'W', 'E'];
    const SEQ = [0, 2, 1, 2];
    const beat = 0.8;
    const i = Math.floor(t / beat) % 4;
    const p = (t % beat) / beat;
    const pads: Pt[] = [
      { x: 74, y: 92 },
      { x: 134, y: 92 },
      { x: 194, y: 92 },
    ];
    const want = SEQ[i];
    const pressed = p >= 0.5;

    benchLine(ctx, pads);
    pads.forEach((pd, k) => {
      const on = k === want;
      benchPad(ctx, pd.x, pd.y, 24, on ? accent : PAD_OFF, on ? (pressed ? 0.4 : 0.95) : 0.06, {
        text: GLYPH[k],
        progress: on && !pressed ? 1 - p / 0.5 : undefined,
      });
    });
    if (pressed) burst(ctx, pads[want].x, pads[want].y, (p - 0.5) / 0.28, accent, 30, 4);
    const cur = glide(onPad(pads[SEQ[(i + 3) % 4]]), onPad(pads[want]), clamp01(p / 0.42));
    pointer(ctx, cur.x, cur.y, accent, p >= 0.42);

    // The corner, on its own clock: one orb every two beats, and it does not
    // care which beat the queue is on.
    const orb = (t % 1.6) / 1.6;
    corner(f, orb < 0.78 ? orb / 0.78 : -1, Math.floor(t / 1.6) % 2 === 0 ? 0 : 1, 'D · F', orb > 0.78 ? (orb - 0.78) / 0.22 : 0);
    tag(ctx, 134, 30, 'BOTH AT ONCE', rgba(BONE, 0.55), 0.75, 7);
    vignette(f);
  },
};

/**
 * UPKEEP — four dials and nobody reminding you.
 *
 * The four rings fill at four rates that share a period with the clip, so what
 * the loop shows is the thing the mode is actually made of: at any instant one
 * of them is full and being wasted while you are looking at another. The one
 * with the cross on it is the rule that stops the mode being a sweep — a dial
 * that is up and must be left alone.
 */
const apmUpkeep: PreviewScene = {
  length: 3.6,
  poster: 0.3,
  caption: 'spend each one the moment it fills',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 96);
    const GLYPH = ['Q', 'W', 'E', 'R'];
    const PERIOD = [1.2, 1.8, 0.9, 3.6];
    const pads: Pt[] = GLYPH.map((_, k) => ({ x: 58 + k * 68, y: 96 }));
    // Which dial came up most recently: that is the one worth a press, and it
    // is the one the pointer is on.
    let live = 0;
    let newest = -1;
    for (let k = 0; k < 4; k++) {
      const since = t % PERIOD[k];
      if (since > newest) {
        newest = since;
        live = k;
      }
    }
    const locked = 3;
    const spendable = live === locked ? (live + 1) % 4 : live;
    const spend = clamp01((newest - 0.1) / 0.3);

    benchLine(ctx, pads);
    pads.forEach((pd, k) => {
      const fill = (t % PERIOD[k]) / PERIOD[k];
      const up = k === live;
      const bar = k === locked;
      const color = bar ? RED : up ? accent : PAD_OFF;
      benchPad(ctx, pd.x, pd.y, 27, color, bar ? 0.4 : up ? 0.9 : 0.1 + fill * 0.2, {
        text: GLYPH[k],
        progress: bar ? undefined : 1 - fill,
        barred: bar,
        sub: bar ? 'LOCKED' : up ? 'UP' : undefined,
      });
    });
    if (spendable === live && spend > 0 && spend < 1) {
      burst(ctx, pads[live].x, pads[live].y, spend, accent, 36, 5);
    }
    const rest = onPad(pads[spendable]);
    pointer(ctx, rest.x, rest.y, accent, true);
    tag(ctx, 160, 30, 'NOTHING TELLS YOU WHEN', rgba(BONE, 0.55), 0.75, 7);
    vignette(f);
  },
};

/**
 * SWITCH — what it costs to move your hand.
 *
 * Three destinations and the prompt jumping between them, which is the only
 * way to draw a cost that is measured in travel. The banks are drawn where
 * they are on a keyboard — the far one above, the near one below, the mouse in
 * the middle — so the picture is a hand's geography rather than a row.
 */
const apmSwitch: PreviewScene = {
  length: 3.2,
  poster: 0.58,
  caption: 'near bank · far bank · mouse',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 92);
    const far: Pt[] = [
      { x: 128, y: 42 },
      { x: 192, y: 42 },
    ];
    const near: Pt[] = [
      { x: 128, y: 130 },
      { x: 192, y: 130 },
    ];
    const mouse: Pt = { x: 160, y: 94 };
    const CALLS: { bank: 0 | 1 | 2; idx: number; label: string }[] = [
      { bank: 0, idx: 0, label: 'Q' },
      { bank: 1, idx: 1, label: 'R' },
      { bank: 2, idx: 0, label: 'CLICK' },
      { bank: 1, idx: 0, label: 'E' },
    ];
    const beat = 0.8;
    const i = Math.floor(t / beat) % 4;
    const p = (t % beat) / beat;
    const call = CALLS[i];
    const spotOf = (c: (typeof CALLS)[number]): Pt =>
      c.bank === 0 ? near[c.idx] : c.bank === 1 ? far[c.idx] : mouse;
    const to = spotOf(call);
    const from = spotOf(CALLS[(i + 3) % 4]);
    const done = p >= 0.56;

    benchLine(ctx, far);
    benchLine(ctx, near);
    tag(ctx, 84, 42, 'FAR', rgba(PAD_OFF, 1), 0.55, 7, 'right');
    tag(ctx, 84, 130, 'NEAR', rgba(PAD_OFF, 1), 0.55, 7, 'right');

    const drawBank = (pads: Pt[], bank: number, labels: string[]) =>
      pads.forEach((pd, k) => {
        const on = call.bank === bank && call.idx === k;
        benchPad(ctx, pd.x, pd.y, 21, on ? accent : PAD_OFF, on ? (done ? 0.4 : 0.95) : 0.05, {
          text: labels[k],
        });
      });
    drawBank(near, 0, ['Q', 'W']);
    drawBank(far, 1, ['E', 'R']);
    benchPad(ctx, mouse.x, mouse.y, 30, call.bank === 2 ? accent : PAD_OFF, call.bank === 2 ? (done ? 0.4 : 0.85) : 0.05, {
      sub: call.bank === 2 ? 'CLICK' : undefined,
    });
    if (done) burst(ctx, to.x, to.y, (p - 0.56) / 0.3, accent, 34, 5);

    // The travel itself, drawn: the cost this mode prints is the length of
    // this dashed line, and nothing else on the card could say that.
    ctx.save();
    ctx.globalAlpha = 0.28 * (1 - clamp01(p / 0.56));
    ctx.strokeStyle = rgba(accent, 1);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
    const cur = glide(
      CALLS[(i + 3) % 4].bank === 2 ? from : onPad(from),
      call.bank === 2 ? to : onPad(to),
      clamp01(p / 0.5),
    );
    pointer(ctx, cur.x, cur.y, accent, p >= 0.5);
    vignette(f);
  },
};

/**
 * SUSTAIN — the rate you can be held to, found by taking it away.
 *
 * Every other bench is previewed at one speed because every other bench runs
 * at one speed. This one does not: the beat steps up while you are on it, and
 * a clip that hid that would be previewing a different mode. So the loop runs
 * three beats at one rate, three at the next, and then does the only thing
 * this mode can do to end — it takes the rate past the hands holding it.
 *
 * That break is also what makes the loop close. Every other clip here returns
 * to its first frame because nothing in it ever changed for good; a mode built
 * on a number that only goes up has no such frame, so the clip earns one the
 * way the mode does, by dropping the beat and starting again.
 */
const apmSustain: PreviewScene = {
  length: 3.6,
  poster: 0.08,
  caption: 'it speeds up until you drop it',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 96);
    const GLYPH = ['Q', 'W', 'E', 'R'];
    const c = { x: 160, y: 92 };
    const pads: Pt[] = GLYPH.map((_, k) => {
      const a = -Math.PI / 2 + (k / 4) * TAU;
      return { x: c.x + Math.cos(a) * 78, y: c.y + Math.sin(a) * 36 };
    });
    // Six beats and then the break. The table is the clip: three at one rate,
    // three a third faster, and 0.75s of the run being over.
    const STEP1 = 0.5;
    const STEP2 = 0.45;
    const BREAK_AT = STEP1 * 3 + STEP2 * 3;
    const LIT = [0, 2, 1, 3, 0, 2];
    const broken = t >= BREAK_AT;
    const slow = t < STEP1 * 3;
    const beat = slow ? STEP1 : STEP2;
    const idx = slow ? Math.floor(t / STEP1) : 3 + Math.floor((t - STEP1 * 3) / STEP2);
    const p = broken ? 1 : ((t - (slow ? 0 : STEP1 * 3)) % beat) / beat;
    const lit = LIT[Math.min(idx, LIT.length - 1)];
    const pressed = p >= 0.4;

    pads.forEach((pd, k) => {
      const on = !broken && k === lit && !pressed;
      benchPad(ctx, pd.x, pd.y, 24, on ? accent : PAD_OFF, on ? 0.95 : 0.06, {
        text: GLYPH[k],
        progress: on ? 1 - p / 0.4 : undefined,
      });
    });
    if (!broken) {
      if (pressed) burst(ctx, pads[lit].x, pads[lit].y, (p - 0.4) / 0.3, accent, 32, 4);
      const cur = glide(onPad(pads[LIT[(idx + LIT.length - 1) % LIT.length]]), onPad(pads[lit]), clamp01(p / 0.34));
      pointer(ctx, cur.x, cur.y, accent, p >= 0.34);
    }

    // The metronome, and the step it is on.
    const bw = 132;
    ctx.save();
    ctx.fillStyle = 'rgba(12, 20, 34, 0.85)';
    ctx.strokeStyle = rgba(PAD_OFF, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(160 - bw / 2, 24, bw, 7);
    ctx.fill();
    ctx.stroke();
    if (!broken) {
      ctx.fillStyle = rgba(accent, 0.9);
      ctx.fillRect(160 - bw / 2 + 1, 25, (bw - 2) * (1 - p), 5);
    }
    ctx.restore();
    tag(ctx, 160, 13, broken ? '133 APM' : `${slow ? 100 : 133} APM`, rgba(broken ? RED : slow ? accent : WARN, 1), 0.95, 10);
    if (!slow && !broken && t < STEP1 * 3 + 0.3) {
      tag(ctx, 160, TITLE_BAND - 12, 'STEP UP', rgba(WARN, 1), 1 - (t - STEP1 * 3) / 0.3, 8);
    }
    if (broken) {
      // Two dropped beats and the run is over. The red is what the arena does
      // about it, at the alpha it does it at.
      const q = clamp01((t - BREAK_AT) / 0.75);
      ctx.save();
      ctx.globalAlpha = 0.22 * (1 - q);
      ctx.fillStyle = rgba(RED, 1);
      ctx.fillRect(-f.bleed, 0, STAGE_W + f.bleed * 2, STAGE_H);
      ctx.restore();
      tag(ctx, 160, 92, 'BROKE AT 133 APM', rgba(RED, 1), 0.95, 11);
      tag(ctx, 160, 108, 'THAT NUMBER IS THE SCORE', rgba(BONE, 0.7), 0.8, 7);
    }
    vignette(f);
  },
};

export const PREVIEWS: Partial<Record<DrillId, PreviewScene>> = {
  rangecheck,
  vayneTumble,
  vayneBolts,
  vayneCondemn,
  vayneHunt,
  caitlynDodge,
  lanePhase,
  apmPulse,
  apmSequence,
  apmChord,
  apmGate,
  apmBuffer,
  apmCancel,
  apmVector,
  apmField,
  apmHandoff,
  apmSplit,
  apmUpkeep,
  apmSwitch,
  apmSustain,
};
