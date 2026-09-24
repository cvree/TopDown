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
  /**
   * This clip resolves rather than cycles.
   *
   * Most of them are a loop in the strict sense: a pure, periodic function of
   * the time into the loop, so the picture at `length` is the picture at zero
   * and the wrap is invisible. A few modes are a *sentence* instead — a wave
   * walks in and a minion dies, a four-key combo lands, a cast becomes a wall
   * stun, a run finally breaks — and a sentence cannot be made periodic
   * without stopping being the thing it is describing. Those say so here, and
   * the restart reads as the next rep rather than as a glitch.
   *
   * It is a flag rather than a list kept somewhere else because the fact
   * belongs to the clip: whoever writes the painter is the only person who
   * knows which of the two they have written.
   */
  narrative?: boolean;
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
    const { ctx, accent, u } = f;
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

    const pulse = inside ? 0.55 + 0.25 * Math.sin(u * TAU * 4) : 0.16;
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
      const beat = (u * 6) % 1;
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
  narrative: true,
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
  narrative: true,
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
      ctx.globalAlpha = 0.18 + 0.18 * Math.sin(f.u * TAU * 5);
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

    const target = marks[Math.floor(f.u * 3) % 3];
    const ang = Math.atan2(target.y - hy, target.x - hx);
    const beat = ((f.u * 3) % 1) * (4.4 / 3);
    if (beat < 0.5) {
      const q = easeOut(beat / 0.42);
      lance(ctx, lerp(hx, target.x, q), lerp(hy, target.y, q), ang, 18, accent, 0.95, 2.3);
      burst(ctx, target.x, target.y, clamp01((beat - 0.36) / 0.3), accent, 20, 6);
    }

    // Final Hour: the aura that says the ultimate is up.
    const ult = 0.5 + 0.5 * Math.sin(f.u * TAU * 2);
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
  narrative: true,
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
  narrative: true,
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
  narrative: true,
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

// ===========================================================================
// THE REST OF THE VOCABULARY
// ===========================================================================

/**
 * A node: somewhere to be, and how much of being there you have done.
 *
 * MOVEMENT and the academy's first module are both built out of these, and in
 * both of them the mode is not "go near it" but "stop dead inside it" — so the
 * fill is the part that matters and it is drawn as a fill rather than as a
 * colour change.
 */
function node(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
  fill = 0,
) {
  if (fill > 0.002) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.22 * fill;
    ctx.fillStyle = rgba(color, 1);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ring(ctx, x, y, r, rgba(color, 1), alpha, 1.5, fill > 0.002 ? undefined : [3.5, 4]);
  if (fill > 0.002) arcRing(ctx, x, y, r + 4, fill, rgba(color, 1), alpha * 0.9, 2);
}

/** A minion: a small square, so a wave never reads as a row of champions. */
function minion(ctx: CanvasRenderingContext2D, x: number, y: number, tint: string, hp = 1, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(tint, 0.22);
  ctx.strokeStyle = rgba(tint, 0.85);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.rect(x - 3.4, y - 3.4, 6.8, 6.8);
  ctx.fill();
  ctx.stroke();
  // The bar is the whole of LAST HIT, so it is drawn on every minion that has
  // one rather than only on the one being taken.
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 6, y - 8.5, 12, 2.2);
  ctx.fillStyle = rgba(hp < 0.25 ? WARN : tint, 0.95);
  ctx.fillRect(x - 6, y - 8.5, 12 * clamp01(hp), 2.2);
  ctx.restore();
}

/** A telegraph wedge: anything that is about to happen in a direction. */
function cone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  half: number,
  len: number,
  color: string,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(color, 0.16);
  ctx.strokeStyle = rgba(color, 0.75);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, len, ang - half, ang + half);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * A telegraph band: a skillshot's footprint, before it is a skillshot.
 *
 * `warn` fills from the caster outwards, which is the one thing about a
 * telegraph a player has to be able to read at a glance — not that it is
 * there, but how much of the time it gives you is left.
 */
function band(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  len: number,
  width: number,
  color: string,
  alpha: number,
  warn = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.strokeStyle = rgba(color, 0.6);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(0, -width / 2, len, width);
  ctx.setLineDash([]);
  ctx.fillStyle = rgba(color, 0.18);
  ctx.fillRect(0, -width / 2, len * clamp01(warn), width);
  ctx.restore();
}

/** Afterimages, evenly spaced along a path the champion has just taken. */
function ghosts(
  ctx: CanvasRenderingContext2D,
  from: Pt,
  to: Pt,
  p: number,
  color: string,
  n = 4,
) {
  for (let i = 1; i <= n; i++) {
    const q = clamp01(p - i * 0.12);
    if (q <= 0) continue;
    const a = 0.3 * (1 - i / (n + 1)) * (1 - p * 0.4);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba(color, 1);
    ctx.beginPath();
    ctx.arc(lerp(from.x, to.x, easeOut(q)), lerp(from.y, to.y, easeOut(q)), 4.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/** A turret: the one structure a lane clip needs. */
function turret(ctx: CanvasRenderingContext2D, x: number, y: number, tint: string) {
  ctx.save();
  ctx.strokeStyle = rgba(tint, 0.7);
  ctx.fillStyle = rgba(tint, 0.14);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x, y - 9);
  ctx.lineTo(x + 7, y - 1);
  ctx.lineTo(x + 4.5, y + 8);
  ctx.lineTo(x - 4.5, y + 8);
  ctx.lineTo(x - 7, y - 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ===========================================================================
// FOUNDATION
// ===========================================================================

/**
 * MOVEMENT — arriving, rather than heading roughly that way.
 *
 * The clip shows the one thing the mode scores and nothing else: the champion
 * crosses to a node on a straight line and *stops inside it*, and the ring
 * fills only while she is actually standing still in there. The node that is
 * next is already drawn, dim, because in the mode it is too — most of what
 * this drill costs a player is the second they spend deciding.
 */
const movement: PreviewScene = {
  length: 3.6,
  poster: 0.42,
  caption: 'stop dead inside it',
  paint: (f) => {
    const { ctx, accent } = f;
    stage(f, 150, 96);
    const spots: Pt[] = [
      { x: 74, y: 112 },
      { x: 168, y: 62 },
      { x: 248, y: 118 },
    ];
    // Three legs round three nodes, so the last one walks back to the first and
    // the loop closes without a cut.
    const leg = 3.6 / spots.length;
    const n = f.u * spots.length;
    const i = Math.floor(n) % spots.length;
    const p = clamp01((n % 1) / 0.62);
    const from = spots[i];
    const to = spots[(i + 1) % spots.length];
    const hx = lerp(from.x, to.x, easeOut(p));
    const hy = lerp(from.y, to.y, easeOut(p));
    const settled = clamp01(((n % 1) - 0.62) / 0.3);
    void leg;

    // The line you were asked to walk, and the line you walked. They are the
    // same line here, which is the whole of PATH EFFICIENCY.
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = rgba(accent, 0.8);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();

    spots.forEach((s, k) => {
      const live = k === (i + 1) % spots.length;
      node(ctx, s.x, s.y, 15, live ? accent : PAD_OFF, live ? 0.9 : 0.2, live ? settled : 0);
    });
    ghosts(ctx, from, to, p, accent);
    hero(ctx, hx, hy, accent, Math.atan2(to.y - from.y, to.x - from.x));
    if (settled > 0.15) {
      burst(ctx, to.x, to.y, settled, GOOD, 22);
      tag(ctx, to.x, to.y - 26, 'STOPPED', rgba(GOOD, 1), settled * 0.95);
    }
    vignette(f);
  },
};

/**
 * AIM — the right one, exactly on it, now.
 *
 * Three marks and only one of them is the one. The cursor travels, and the
 * clip holds on the travel rather than cutting to the click, because the
 * distance the hand covers between two marks *is* the thing being measured —
 * a preview that snapped straight to the answer would be advertising a
 * reaction test and delivering a precision one.
 */
const aim: PreviewScene = {
  length: 2.82,
  poster: 0.62,
  caption: 'the right one, exactly on it',
  paint: (f) => {
    const { ctx, accent } = f;
    stage(f, 160, 92);
    const marks: Pt[] = [
      { x: 96, y: 70 },
      { x: 190, y: 108 },
      { x: 244, y: 58 },
    ];
    const n = f.u * marks.length;
    const k = Math.floor(n) % marks.length;
    const p = n % 1;
    const prev = marks[(k + marks.length - 1) % marks.length];
    const want = marks[k];
    const travel = clamp01(p / 0.46);
    const struck = p >= 0.46 ? (p - 0.46) / 0.24 : 0;

    marks.forEach((m, j) => {
      const live = j === k;
      // A mark surfaces and sinks: it is worth marks only while it is up, and
      // a clip that drew all three the same would be lying about that.
      const up = live ? clamp01(p / 0.18) : j === (k + 1) % marks.length ? 0.16 : 0.1;
      foe(ctx, m.x, m.y, 5 + up * 1.6, 0.25 + up * 0.75);
      if (live) ring(ctx, m.x, m.y, 11 + (1 - up) * 8, rgba(accent, 1), up * 0.7, 1.3);
    });

    const cx = lerp(prev.x, want.x, easeOut(travel));
    const cy = lerp(prev.y, want.y, easeOut(travel));
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = rgba(BONE, 0.9);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.restore();
    if (struck > 0 && struck < 1) burst(ctx, want.x, want.y, struck, accent, 20, 4);
    pointer(ctx, cx, cy, accent, travel >= 1);
    tag(
      ctx,
      want.x,
      want.y - 20,
      struck > 0 ? `${180 + k * 24}ms` : 'TAKE IT',
      rgba(struck > 0 ? GOOD : accent, 1),
      0.9,
    );
    vignette(f);
  },
};

/**
 * SKILLSHOT — the shot goes where they will be.
 *
 * The band is drawn before the missile because that is the order the decision
 * happens in: you commit to a strip of ground, and then find out whether the
 * thing you were aiming at agreed to be in it. The target here strafes at a
 * constant speed and the lead is correct, so the clip is a picture of the
 * mode being answered rather than of a coin landing.
 */
const skillshot: PreviewScene = {
  length: 3,
  poster: 0.72,
  caption: 'lead it, then fire',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 78, 108);
    const hx = 62;
    const hy = 104;
    const ey = 60 + 34 * Math.sin(u * TAU);
    const ex = 236;
    const aimY = ey + 26 * Math.cos(u * TAU);
    const ang = Math.atan2(aimY - hy, ex - hx);
    const cycle = 1.5;
    const p = (t % cycle) / cycle;

    band(ctx, hx, hy, ang, 200, 15, accent, 0.75, clamp01(p / 0.34));
    if (p >= 0.34) {
      const q = clamp01((p - 0.34) / 0.3);
      const mx = lerp(hx, ex, q);
      const my = lerp(hy, aimY, q);
      lance(ctx, mx, my, ang, 26, accent, 1, 3);
      if (q >= 1) burst(ctx, ex, aimY, clamp01((p - 0.64) / 0.24), accent, 26, 6);
    }
    foe(ctx, ex, ey, 5.5, 1);
    // Where it will be when the missile gets there — the only number this mode
    // is about, drawn rather than written.
    ring(ctx, ex, aimY, 8, rgba(WARN, 1), 0.5, 1, [2, 3]);
    hero(ctx, hx, hy, accent, ang);
    tag(ctx, ex, Math.min(aimY, ey) - 18, 'LEAD', rgba(WARN, 1), 0.85);
    vignette(f);
  },
};

/**
 * DODGE — one step, and it has to be a useful one.
 *
 * Both halves of the mode are in the frame at once, which is the point of it:
 * the cone is what you are leaving and the emitter in the corner is what you
 * are supposed to be killing while you leave it. A clip with only the dodge in
 * it would be advertising half a drill.
 */
const dodge: PreviewScene = {
  length: 3.2,
  poster: 0.5,
  caption: 'leave it, and kill the thrower',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 130, 104);
    const sx = 246;
    const sy = 62;
    const cycle = 1.6;
    const p = (t % cycle) / cycle;
    const warn = clamp01(p / 0.4);
    const fire = p >= 0.4 ? clamp01((p - 0.4) / 0.18) : 0;

    const home = { x: 128, y: 104 };
    const safe = { x: 92, y: 132 };
    // The step happens *inside* the telegraph, not after it: a dodge taken
    // when the thing is already in the air is a dodge that did not happen.
    const step = clamp01((p - 0.24) / 0.16);
    const hx = lerp(home.x, safe.x, easeOut(step));
    const hy = lerp(home.y, safe.y, easeOut(step));

    const ang = Math.atan2(home.y - sy, home.x - sx);
    cone(ctx, sx, sy, ang, 0.34, 190, fire > 0 ? RED : WARN, fire > 0 ? 0.85 * (1 - fire) : 0.35 + warn * 0.45);
    if (fire > 0) burst(ctx, home.x, home.y, fire, RED, 34, 6);

    foe(ctx, sx, sy, 6, 1);
    ring(ctx, sx, sy, 13, rgba(RED, 1), 0.35 + 0.3 * Math.sin(u * TAU * 4), 1.2);
    ghosts(ctx, home, safe, step, accent, 3);
    hero(ctx, hx, hy, accent, Math.atan2(sy - hy, sx - hx));
    // The other half: she is shooting the emitter the whole time she is
    // leaving its cone.
    const shot = (t % 0.4) / 0.4;
    lance(ctx, lerp(hx, sx, easeOut(shot)), lerp(hy, sy, easeOut(shot)), Math.atan2(sy - hy, sx - hx), 18, accent, 0.9, 2.2);
    tag(ctx, hx, hy + 22, step > 0.5 ? 'CLEAR' : 'MOVE', rgba(step > 0.5 ? GOOD : WARN, 1), 0.9);
    vignette(f);
  },
};

// ===========================================================================
// RHYTHM
// ===========================================================================

/**
 * SPACING — the band between the two rings, and then the band without them.
 *
 * Two circles: what you can reach, and what can reach you. The pocket is the
 * ground in one and not the other, and the clip spends its second half fading
 * the rings out — because that is literally what the mode does to you, and a
 * preview that kept them would be showing the easy half.
 */
const spacing: PreviewScene = {
  length: 4,
  poster: 0.2,
  caption: 'hold the pocket, then hold it blind',
  paint: (f) => {
    const { ctx, accent, u } = f;
    stage(f, 110, 100);
    const ex = 206;
    const ey = 94;
    const mine = 84;
    const theirs = 52;
    // Rings all the way out and all the way back, so the loop closes on the
    // frame it opened on and the mode's second half is in every clip.
    const shown = (1 + Math.cos(u * TAU)) / 2;
    const hx = ex - (theirs + 16 + 8 * Math.sin(u * TAU));
    const hy = ey + 6 * Math.sin(u * TAU * 2);

    // The pocket itself: the annulus you are allowed to stand in.
    ctx.save();
    ctx.globalAlpha = 0.14 + shown * 0.1;
    ctx.fillStyle = rgba(GOOD, 1);
    ctx.beginPath();
    ctx.arc(ex, ey, mine, 0, TAU);
    ctx.arc(ex, ey, theirs, 0, TAU, true);
    ctx.fill();
    ctx.restore();

    ring(ctx, ex, ey, theirs, rgba(RED, 1), 0.2 + shown * 0.6, 1.4, shown > 0.5 ? undefined : [4, 5]);
    ring(ctx, hx, hy, mine, rgba(accent, 1), 0.1 + shown * 0.5, 1.3, [5, 6]);
    foe(ctx, ex, ey, 5.5, 1);
    hero(ctx, hx, hy, accent, 0);
    tag(
      ctx,
      ex,
      ey - theirs - 14,
      shown > 0.4 ? 'THEIR REACH' : 'FROM MEMORY',
      rgba(shown > 0.4 ? RED : accent, 0.95),
      0.9,
    );
    vignette(f);
  },
};

/**
 * KITE — attack, step, attack, and never in the wrong order.
 *
 * The bar under the champion is the whole mode: it is the attack, split into
 * the part a step throws away and the part a step is free in. Red is the
 * windup, and she never moves during it; the moment it turns, she does.
 */
const kite: PreviewScene = {
  length: 4,
  poster: 0.3,
  caption: 'move in the backswing, never the windup',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 100, 100);
    const ex = 206;
    const ey = 76;
    const cycle = 1;
    const p = (t % cycle) / cycle;
    const WIND = 0.28;
    const n = Math.floor(t / cycle);
    // Two lanes far enough apart that the step between attacks is the thing
    // the eye follows. A drill about moving cannot preview as a champion that
    // twitches.
    const lane = 86 + (n % 2) * 46;
    const nextLane = 86 + ((n + 1) % 2) * 46;
    const hx = 96;
    // Planted through the windup, moving through the backswing. That asymmetry
    // is the entire drill.
    const hy = p < WIND ? lane : lerp(lane, nextLane, easeOut((p - WIND) / (1 - WIND)));
    const ang = Math.atan2(ey - hy, ex - hx);

    if (p < WIND) {
      ring(ctx, hx, hy, 13, rgba(RED, 1), 0.5, 1.4);
    } else {
      const q = (p - WIND) / 0.32;
      if (q < 1) lance(ctx, lerp(hx, ex, easeOut(q)), lerp(hy, ey, easeOut(q)), ang, 20, accent, 1, 2.4);
      if (q >= 1) burst(ctx, ex, ey, clamp01(q - 1), accent, 20);
    }

    foe(ctx, ex, ey, 5.5, 1);
    hero(ctx, hx, hy, accent, ang);

    // The cycle, drawn as the thing it is: two stretches of time, one of which
    // is yours to spend.
    const bx = 100;
    const by = TITLE_BAND - 16;
    const bw = 120;
    ctx.save();
    ctx.fillStyle = 'rgba(10,16,28,0.8)';
    ctx.fillRect(bx, by, bw, 6);
    ctx.fillStyle = rgba(RED, 0.4);
    ctx.fillRect(bx, by, bw * WIND, 6);
    ctx.fillStyle = rgba(GOOD, 0.34);
    ctx.fillRect(bx + bw * WIND, by, bw * (1 - WIND), 6);
    ctx.fillStyle = rgba(BONE, 0.95);
    ctx.fillRect(bx + bw * p - 1, by - 2, 2, 10);
    ctx.restore();
    tag(ctx, bx + bw * (WIND / 2), by - 9, 'LOCKED', rgba(RED, 0.95), 0.85, 7);
    tag(ctx, bx + bw * (WIND + (1 - WIND) / 2), by - 9, 'FREE', rgba(GOOD, 0.95), 0.85, 7);
    vignette(f);
  },
};

/**
 * LAST HIT — one attack, and it has to be the one that kills.
 *
 * The bar on the middle minion is the clip. It falls on its own — the two
 * waves are fighting whether you are there or not — and the shot leaves at the
 * moment it has to, which is early enough that the missile arrives late enough.
 * Travel time is the reason this mode is hard and it is the reason the lance
 * is in the air for a third of the loop.
 */
const lasthit: PreviewScene = {
  length: 3.4,
  poster: 0.66,
  caption: 'the killing blow, not the next one',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 96, 92);
    const cycle = 1.7;
    const p = (t % cycle) / cycle;
    const hx = 66;
    const hy = 104;
    const mx = 178;
    const my = 88;

    turret(ctx, 292, 62, RED);
    // Your wave and theirs, trading in the middle.
    for (let i = 0; i < 3; i++) minion(ctx, 122 + i * 16, 116 - i * 5, BLUE, 1, 0.85);
    minion(ctx, 210, 74, RED, 0.72, 0.85);
    minion(ctx, 226, 96, RED, 0.44, 0.85);

    // The one being taken: its bar falls to the threshold and is finished.
    const hp = p < 0.52 ? lerp(0.5, 0.16, p / 0.52) : 0;
    if (hp > 0) minion(ctx, mx, my, RED, hp, 1);
    const ang = Math.atan2(my - hy, mx - hx);
    if (p >= 0.34 && p < 0.56) {
      const q = (p - 0.34) / 0.22;
      lance(ctx, lerp(hx, mx, q), lerp(hy, my, q), ang, 22, accent, 1, 2.6);
    }
    if (p >= 0.52 && p < 0.8) burst(ctx, mx, my, (p - 0.52) / 0.28, WARN, 26, 6);
    hero(ctx, hx, hy, accent, ang);
    tag(
      ctx,
      mx,
      my - 20,
      p < 0.34 ? 'WAIT' : p < 0.52 ? 'NOW' : '+21g',
      rgba(p < 0.34 ? PAD_OFF : p < 0.52 ? accent : WARN, 1),
      0.95,
    );
    vignette(f);
  },
};

/**
 * TARGET SWITCH — off the old one, onto the new one, and no dithering.
 *
 * The mark moves first and the cursor follows, and the gap between the two is
 * drawn as a dashed line because that gap *is* the score. Three bodies, so the
 * move is a choice rather than a reflex.
 */
const targetswitch: PreviewScene = {
  length: 3.3,
  poster: 0.34,
  caption: 'the priority moved — go',
  paint: (f) => {
    const { ctx, accent } = f;
    stage(f, 92, 100);
    const foes: Pt[] = [
      { x: 156, y: 58 },
      { x: 232, y: 96 },
      { x: 168, y: 126 },
    ];
    const hx = 68;
    const hy = 96;
    const n = f.u * foes.length;
    const k = Math.floor(n) % foes.length;
    const p = n % 1;
    const prev = foes[(k + foes.length - 1) % foes.length];
    const want = foes[k];
    // Reaction, then commitment: the hand is late on purpose for a fifth of a
    // second, because it is in a run too.
    const react = clamp01((p - 0.12) / 0.3);
    const cx = lerp(prev.x, want.x, easeOut(react));
    const cy = lerp(prev.y, want.y, easeOut(react));

    foes.forEach((e, j) => {
      const live = j === k;
      foe(ctx, e.x, e.y, 5.5, live ? 1 : 0.45);
      if (live) {
        ring(ctx, e.x, e.y, 13 + (1 - clamp01(p / 0.2)) * 10, rgba(WARN, 1), 0.9, 1.6);
        tag(ctx, e.x, e.y - 20, 'PRIORITY', rgba(WARN, 1), 0.9, 7.5);
      }
    });

    if (react >= 1) {
      const shot = clamp01((p - 0.42) / 0.22);
      const ang = Math.atan2(want.y - hy, want.x - hx);
      if (shot < 1) lance(ctx, lerp(hx, want.x, shot), lerp(hy, want.y, shot), ang, 20, accent, 1, 2.4);
      else burst(ctx, want.x, want.y, clamp01((p - 0.64) / 0.26), accent, 20);
    }
    hero(ctx, hx, hy, accent, Math.atan2(cy - hy, cx - hx));
    pointer(ctx, cx, cy, accent, react >= 1);
    vignette(f);
  },
};

/**
 * COMBOS — four keys, in an order somebody else picked.
 *
 * The row of caps is the mode's instrument and the timer above it is its
 * pressure, so both are in every frame. The cast lands on the target as each
 * cap goes out, because a sequence drill that showed only the keyboard would
 * be a typing test.
 */
const combos: PreviewScene = {
  length: 3.1,
  poster: 0.45,
  caption: 'in order, before it closes',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 110, 88);
    const KEYS = ['Q', 'E', 'W', 'R'];
    const ex = 232;
    const ey = 82;
    const hx = 84;
    const hy = 96;
    const step = 0.62;
    // A sequence cannot loop without a reset somewhere. This one puts the reset
    // behind the flash the last cast makes — which is where a real combo puts
    // it too — so the clip closes on the frame it opens on.
    const seam = Math.max(clamp01((t - step * KEYS.length) / 0.34), clamp01(1 - t / 0.34));
    const k = Math.min(KEYS.length - 1, Math.floor(t / step));
    const p = Math.min(1, (t - k * step) / step);
    const left = 1 - clamp01(t / (step * KEYS.length));

    const ang = Math.atan2(ey - hy, ex - hx);
    foe(ctx, ex, ey, 6, 1);
    hero(ctx, hx, hy, accent, ang);
    if (p < 0.5) {
      const q = p / 0.5;
      lance(ctx, lerp(hx, ex, easeOut(q)), lerp(hy, ey, easeOut(q)), ang, 22, accent, 1, 2.6);
    } else {
      burst(ctx, ex, ey, (p - 0.5) / 0.4, accent, 24, 5);
    }

    KEYS.forEach((key, j) => {
      const x = 116 + j * 26;
      const done = j < k;
      const now = j === k;
      keycap(ctx, x, TITLE_BAND - 22, key, done ? GOOD : now ? accent : PAD_OFF, done ? 0.55 : now ? 1 : 0.3, 17);
      if (now) arcRing(ctx, x, TITLE_BAND - 22, 13, 1 - p, rgba(accent, 1), 0.8, 1.6);
    });
    // The window, and the fact that it is closing.
    ctx.save();
    ctx.fillStyle = 'rgba(10,16,28,0.75)';
    ctx.fillRect(110, 26, 100, 4);
    ctx.fillStyle = rgba(left < 0.3 ? RED : accent, 0.9);
    ctx.fillRect(110, 26, 100 * left, 4);
    ctx.restore();
    tag(ctx, 160, 16, 'SEQUENCE', rgba(BONE, 0.6), 0.8, 7.5);
    if (seam > 0.01) {
      ctx.save();
      ctx.globalAlpha = seam * 0.5;
      ctx.fillStyle = rgba(GOOD, 1);
      ctx.fillRect(-f.bleed, 0, STAGE_W + f.bleed * 2, STAGE_H);
      ctx.restore();
      tag(ctx, 160, 96, 'CLEAN', rgba(BONE, 1), seam * 0.9, 13);
    }
    vignette(f);
  },
};

// ===========================================================================
// COMBAT
// ===========================================================================

/**
 * The duels, drawn from one painter.
 *
 * 1v1, 1v2 and 1v3 are the same picture with more of the same thing in it, and
 * that is exactly what the three modes are — so they share a painter and differ
 * only in how many bodies are closing and how little room is left. The
 * clip is written round the moment that separates them: with one opponent the
 * ring you are holding is a pocket, with three it is a shrinking island.
 */
const duel = (count: number, poster: number, caption: string): PreviewScene => ({
  length: 3.6,
  poster,
  caption,
  paint: (f) => {
    const { ctx, accent, u } = f;
    stage(f, 120, 100);
    // A piece of terrain to fight around, pulled in off the edge: flush
    // against the frame it stops reading as ground and starts reading as a
    // border somebody drew on the card.
    wall(ctx, 284, 38, 134);
    const cx = 138;
    const cy = 94;
    const hx = cx + 16 * Math.cos(u * TAU);
    const hy = cy + 10 * Math.sin(u * TAU * 2);

    // They close, and the closest one is always the one being answered.
    const bodies = Array.from({ length: count }, (_, i) => {
      const a = count === 1 ? -0.2 : -0.95 + (i / (count - 1)) * 1.9;
      const r = 92 - 16 * Math.sin(u * TAU + i * 1.3);
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.72, a };
    });
    // Rounded before it is compared: two bodies a millionth of a unit apart
    // are the same distance away, and letting the last bit of a float decide
    // which one is answered puts a flicker in the loop.
    const away = (b: { x: number; y: number }) => Math.round(Math.hypot(b.x - hx, b.y - hy) * 1000);
    const near = bodies.reduce((p, q) => (away(p) <= away(q) ? p : q));

    ring(ctx, hx, hy, 78, rgba(accent, 1), 0.22, 1.1, [5, 6]);
    for (const b of bodies) {
      foe(ctx, b.x, b.y, 5.5, b === near ? 1 : 0.6);
      if (b !== near) {
        // Everybody who is not being shot is still doing something.
        // Wrapped the long way round: a heading behind the champion is a
        // negative angle, and JavaScript's remainder keeps the sign, which
        // would put this clock in a different place at the end of the loop
        // than at the start of it.
        const q = (((u * 3 + b.a / TAU) % 1) + 1) % 1;
        lance(ctx, lerp(b.x, hx, q), lerp(b.y, hy, q), Math.atan2(hy - b.y, hx - b.x), 14, RED, 0.5, 1.8);
      }
    }
    const ang = Math.atan2(near.y - hy, near.x - hx);
    const shot = (u * 6) % 1;
    if (shot < 0.7) lance(ctx, lerp(hx, near.x, shot / 0.7), lerp(hy, near.y, shot / 0.7), ang, 20, accent, 1, 2.5);
    else burst(ctx, near.x, near.y, (shot - 0.7) / 0.3, accent, 20);
    hero(ctx, hx, hy, accent, ang);
    tag(ctx, near.x, near.y - 20, count === 1 ? 'TRADE' : 'PRIORITY', rgba(count === 1 ? accent : WARN, 1), 0.9, 7.5);
    vignette(f);
  },
});

const duel1v1 = duel(1, 0.36, 'the whole kit, against somebody');
const duel1v2 = duel(2, 0.5, 'two angles, one of them first');
const duel1v3 = duel(3, 0.58, 'outnumbered, and still choosing');

// ===========================================================================
// THE WASD ACADEMY
// ===========================================================================

/**
 * The four keys, in the shape they sit on the keyboard.
 *
 * Every module in this section is about the left hand, so every clip in it
 * carries the left hand. `held` is a unit heading and the caps light by how
 * much of themselves that heading is using, which means a diagonal lights two
 * at three quarters rather than two at full — the distinction the second
 * module is entirely about.
 *
 * {@link KEYS_AT} is where it goes, and it is the same corner in all nine:
 * the card's caption owns the top left and the picture owns the middle, so the
 * top right is the one place a fixed instrument can sit without ever being
 * read as part of the arena. The stylesheet already reserves it — see the
 * width the caption stops short at.
 */
const KEYS_AT: Pt = { x: 284, y: 40 };

function wasdKeys(ctx: CanvasRenderingContext2D, x: number, y: number, held: Pt, accent: string) {
  const caps: [string, number, number, number, number][] = [
    ['W', 0, -1, 0, -1],
    ['A', -1, 0, -1, 0],
    ['S', 0, 1, 0, 1],
    ['D', 1, 0, 1, 0],
  ];
  for (const [label, dx, dy, ux, uy] of caps) {
    const lit = clamp01(held.x * ux + held.y * uy);
    keycap(ctx, x + dx * 15, y + dy * 15, label, lit > 0.05 ? accent : PAD_OFF, 0.24 + lit * 0.76, 13);
  }
}

/**
 * WASD 01 · MOVEMENT — the keys, and stopping.
 *
 * The same node as the mouse module, answered with the other hand — so the
 * clip is that node plus the caps that are driving towards it, and the caps go
 * dark a beat before she arrives, because letting go early is the whole of
 * stopping dead on a keyboard.
 */
const wasdMove: PreviewScene = {
  length: 3.2,
  poster: 0.46,
  caption: 'let go early, stop exactly',
  paint: (f) => {
    const { ctx, accent } = f;
    stage(f, 150, 92);
    const spots: Pt[] = [
      { x: 88, y: 118 },
      { x: 196, y: 64 },
      { x: 236, y: 124 },
    ];
    const n = f.u * spots.length;
    const i = Math.floor(n) % spots.length;
    const p = clamp01((n % 1) / 0.6);
    const from = spots[i];
    const to = spots[(i + 1) % spots.length];
    const hx = lerp(from.x, to.x, easeOut(p));
    const hy = lerp(from.y, to.y, easeOut(p));
    const settled = clamp01(((n % 1) - 0.6) / 0.28);
    // Released at four fifths of the way there. The coast is the skill.
    const held: Pt = p < 0.8 ? { x: to.x - from.x, y: to.y - from.y } : { x: 0, y: 0 };
    const m = Math.hypot(held.x, held.y) || 1;

    spots.forEach((s, k) => {
      const live = k === (i + 1) % spots.length;
      node(ctx, s.x, s.y, 15, live ? accent : PAD_OFF, live ? 0.9 : 0.2, live ? settled : 0);
    });
    ghosts(ctx, from, to, p, accent);
    hero(ctx, hx, hy, accent, Math.atan2(to.y - from.y, to.x - from.x));
    wasdKeys(ctx, KEYS_AT.x, KEYS_AT.y, { x: held.x / m, y: held.y / m }, accent);
    tag(ctx, hx, hy + 22, p < 0.8 ? 'HELD' : settled > 0.4 ? 'DEAD STOP' : 'COASTING', rgba(p < 0.8 ? accent : GOOD, 1), 0.9, 7.5);
    vignette(f);
  },
};

/**
 * WASD 02 · CURSOR INDEPENDENCE — the two hands disagreeing on purpose.
 *
 * The clip is one picture: a line from the champion to her feet and a line
 * from the champion to her cursor, and the angle between them. That angle is
 * literally the score, so it is drawn as an arc and the arc is widest at the
 * moment the poster is taken.
 */
const wasdIndep: PreviewScene = {
  length: 3.4,
  poster: 0.28,
  caption: 'feet one way, cursor the other',
  paint: (f) => {
    const { ctx, accent, u } = f;
    stage(f, 150, 96);
    const cx = 158;
    const cy = 96;
    const swing = Math.sin(u * TAU);
    const feetA = Math.PI + swing * 0.5;
    const aimA = swing * 0.5;
    const hx = cx + Math.cos(feetA) * 26;
    const hy = cy + Math.sin(feetA) * 14;
    const mark: Pt = { x: cx + Math.cos(aimA) * 96, y: cy + Math.sin(aimA) * 52 };

    // The two commitments, and the ground between them.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = rgba(accent, 0.8);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + Math.cos(feetA) * 46, hy + Math.sin(feetA) * 26);
    ctx.stroke();
    ctx.strokeStyle = rgba(WARN, 0.8);
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(mark.x, mark.y);
    ctx.stroke();
    ctx.restore();
    arcRing(ctx, hx, hy, 34, 0.5 - Math.abs(swing) * 0.08, rgba(GOOD, 1), 0.55, 2);

    foe(ctx, mark.x, mark.y, 5.2, 1);
    pointer(ctx, mark.x, mark.y, accent, true);
    hero(ctx, hx, hy, accent, aimA);
    wasdKeys(ctx, KEYS_AT.x, KEYS_AT.y, { x: Math.cos(feetA), y: Math.sin(feetA) }, accent);
    tag(ctx, hx, hy - 26, 'OPPOSED', rgba(GOOD, 1), 0.9, 7.5);
    // A shot every beat, because the cursor is doing a job rather than posing.
    const shot = (u * 5) % 1;
    if (shot < 0.7) {
      const ang = Math.atan2(mark.y - hy, mark.x - hx);
      lance(ctx, lerp(hx, mark.x, shot / 0.7), lerp(hy, mark.y, shot / 0.7), ang, 18, accent, 0.95, 2.2);
    }
    vignette(f);
  },
};

/**
 * WASD 03 · STRAFING — making it fire where you were.
 *
 * The shot is drawn *behind* her, always, and the flip happens while the
 * telegraph is filling. That is the only readable way to show a bait: the
 * picture has to contain both the place the shooter aimed at and the place she
 * actually is, at the same instant.
 */
const wasdStrafe: PreviewScene = {
  length: 3.2,
  poster: 0.68,
  caption: 'be where it is not',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 150, 100);
    const sx = 56;
    const sy = 92;
    const cycle = 1.6;
    const p = (t % cycle) / cycle;
    const side = Math.floor(t / cycle) % 2 === 0 ? 1 : -1;
    const laneY = 96;
    // Committed to, then abandoned: the aim point is where she was at the
    // moment the shot was called.
    const readAt = 0.3;
    const beforeY = laneY + side * 34;
    const afterY = laneY - side * 30;
    const flip = clamp01((p - readAt) / 0.24);
    const hy = p < readAt ? beforeY : lerp(beforeY, afterY, easeOut(flip));
    const hx = 218;

    const ang = Math.atan2(beforeY - sy, hx - sx);
    band(ctx, sx, sy, ang, 190, 14, p < 0.54 ? WARN : RED, 0.8, clamp01(p / 0.54));
    if (p >= 0.54) {
      const q = clamp01((p - 0.54) / 0.26);
      lance(ctx, lerp(sx, hx, q), lerp(sy, beforeY, q), ang, 24, RED, 1, 2.6);
      if (q >= 1) burst(ctx, hx, beforeY, clamp01((p - 0.8) / 0.2), RED, 24);
    }
    foe(ctx, sx, sy, 6, 1);
    ghosts(ctx, { x: hx, y: beforeY }, { x: hx, y: afterY }, flip, accent, 3);
    hero(ctx, hx, hy, accent, Math.PI);
    wasdKeys(ctx, KEYS_AT.x, KEYS_AT.y, { x: 0, y: p < readAt ? side : -side }, accent);
    tag(ctx, hx + 8, hy - 20, p >= 0.54 ? 'BAITED' : 'CHANGE', rgba(p >= 0.54 ? GOOD : accent, 1), 0.9, 7.5);
    vignette(f);
  },
};

/**
 * WASD 04 · AIM WHILE MOVING — never stopping to shoot.
 *
 * A trail behind her that never has a gap in it, and marks being taken off it.
 * The claim the mode makes is that a mark taken standing still is worth a
 * fraction of one taken moving, so the clip never stops: the champion is in
 * motion in every single frame, including the ones where the shot lands.
 */
const wasdAimMove: PreviewScene = {
  length: 3.2,
  poster: 0.4,
  caption: 'never stop to take one',
  paint: (f) => {
    const { ctx, accent, u } = f;
    stage(f, 150, 100);
    const cx = 150;
    const cy = 96;
    const a = u * TAU;
    const hx = cx + Math.cos(a) * 62;
    const hy = cy + Math.sin(a) * 34;
    const prev = { x: cx + Math.cos(a - 0.4) * 62, y: cy + Math.sin(a - 0.4) * 34 };

    ring(ctx, cx, cy, 62, rgba(accent, 1), 0.1, 1, [4, 6]);
    const marks: Pt[] = [
      { x: 244, y: 62 },
      { x: 238, y: 124 },
      { x: 92, y: 56 },
    ];
    const n = u * marks.length;
    const k = Math.floor(n) % marks.length;
    const p = n % 1;
    marks.forEach((mk, j) => {
      const live = j === k;
      foe(ctx, mk.x, mk.y, 5.2, live ? 1 : 0.2);
      if (live) ring(ctx, mk.x, mk.y, 10 + (1 - clamp01(p / 0.3)) * 9, rgba(WARN, 1), 0.8, 1.4);
    });
    const want = marks[k];
    const ang = Math.atan2(want.y - hy, want.x - hx);
    const shot = clamp01((p - 0.22) / 0.3);
    if (shot > 0 && shot < 1) lance(ctx, lerp(hx, want.x, shot), lerp(hy, want.y, shot), ang, 20, accent, 1, 2.4);
    if (shot >= 1) burst(ctx, want.x, want.y, clamp01((p - 0.52) / 0.26), accent, 20, 4);

    ghosts(ctx, prev, { x: hx, y: hy }, 1, accent, 4);
    hero(ctx, hx, hy, accent, ang);
    pointer(ctx, want.x, want.y, accent, true);
    wasdKeys(ctx, KEYS_AT.x, KEYS_AT.y, { x: -Math.sin(a), y: Math.cos(a) * 0.55 }, accent);
    tag(ctx, cx, 24, 'ON THE MOVE', rgba(GOOD, 1), 0.85, 7.5);
    vignette(f);
  },
};

/**
 * WASD 05 · ATTACK CADENCE — the bar, and which part of it is yours.
 *
 * This module *is* a bar, so the bar is the clip and the arena is the caption
 * on it. The key row lights only in the green stretch, because the one thing
 * the mode teaches is which stretch a held key is free in — and a clip that
 * lit the keys through the red would be teaching the opposite of it.
 */
const wasdCadence: PreviewScene = {
  length: 3,
  poster: 0.62,
  caption: 'which part of it is free',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 150, 64);
    const cycle = 1;
    const p = (t % cycle) / cycle;
    const WIND = 0.3;
    const free = p >= WIND;
    const ex = 236;
    const ey = 62;
    const hy = free ? 84 + 22 * easeOut((p - WIND) / (1 - WIND)) : 84;
    const hx = 104;
    const ang = Math.atan2(ey - hy, ex - hx);

    foe(ctx, ex, ey, 5.5, 1);
    if (!free) ring(ctx, hx, hy, 13, rgba(RED, 1), 0.55, 1.5);
    else {
      const q = (p - WIND) / 0.3;
      if (q < 1) lance(ctx, lerp(hx, ex, easeOut(q)), lerp(hy, ey, easeOut(q)), ang, 20, accent, 1, 2.4);
    }
    hero(ctx, hx, hy, accent, ang);

    const bx = 74;
    const by = 128;
    const bw = 172;
    ctx.save();
    ctx.fillStyle = 'rgba(10,16,28,0.85)';
    ctx.strokeStyle = rgba(PAD_OFF, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 11, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(RED, 0.45);
    ctx.fillRect(bx + 1, by + 1, (bw - 2) * WIND, 9);
    ctx.fillStyle = rgba(GOOD, 0.38);
    ctx.fillRect(bx + 1 + (bw - 2) * WIND, by + 1, (bw - 2) * (1 - WIND), 9);
    ctx.fillStyle = rgba(BONE, 0.95);
    ctx.fillRect(bx + (bw - 2) * p, by - 3, 2, 17);
    ctx.restore();
    tag(ctx, bx + bw * WIND * 0.5, by - 10, 'WINDUP', rgba(RED, 0.95), 0.9, 7);
    tag(ctx, bx + bw * (WIND + (1 - WIND) / 2), by - 10, 'BACKSWING', rgba(GOOD, 0.95), 0.9, 7);
    wasdKeys(ctx, KEYS_AT.x, KEYS_AT.y, free ? { x: 0, y: 1 } : { x: 0, y: 0 }, accent);
    vignette(f);
  },
};

/**
 * The three kiting modules, from one painter.
 *
 * They are the same cycle pointed in three directions — held, chasing,
 * retreating — and the only honest way to preview three modes that differ by
 * one sign is to draw them with one painter and let the sign be the
 * difference. `drift` is where the pair is going: zero holds, positive chases,
 * negative gives ground.
 */
const kiting = (drift: number, label: string, poster: number, caption: string): PreviewScene => ({
  length: 3.2,
  poster,
  caption,
  paint: (f) => {
    const { ctx, accent, u } = f;
    stage(f, 110, 96);
    const p = (u * 4) % 1;
    const WIND = 0.3;
    const reach = 74;
    // The pair travels together across the frame and back, because a clip that
    // only travelled would have to teleport home. The gap between them is what
    // each of the three modes is actually scoring.
    const march = Math.sin(u * TAU) * 46 * drift;
    const ex = 214 + march;
    const ey = 86;
    const hx = ex - reach - (drift < 0 ? 6 : 0) + march * 0.06;
    const hy = ey + 22 + (p < WIND ? 0 : 16 * easeOut((p - WIND) / (1 - WIND))) * (drift >= 0 ? 1 : -1);
    const ang = Math.atan2(ey - hy, ex - hx);

    ring(ctx, hx, hy, reach, rgba(accent, 1), 0.26, 1.2, [5, 6]);
    if (drift < 0) ring(ctx, ex, ey, 40, rgba(RED, 1), 0.4, 1.2, [4, 5]);
    foe(ctx, ex, ey, 5.5, 1);
    if (p < WIND) ring(ctx, hx, hy, 12, rgba(RED, 1), 0.5, 1.4);
    else {
      const q = (p - WIND) / 0.34;
      if (q < 1) lance(ctx, lerp(hx, ex, easeOut(q)), lerp(hy, ey, easeOut(q)), ang, 20, accent, 1, 2.4);
      else burst(ctx, ex, ey, clamp01(q - 1), accent, 18);
    }
    hero(ctx, hx, hy, accent, ang);
    wasdKeys(ctx, KEYS_AT.x, KEYS_AT.y, p < WIND ? { x: 0, y: 0 } : { x: drift >= 0 ? 1 : -1, y: 0.3 }, accent);
    // The gap, drawn as the measurement it is.
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = rgba(GOOD, 0.9);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
    tag(ctx, (hx + ex) / 2, Math.min(hy, ey) - 16, label, rgba(GOOD, 1), 0.9, 7.5);
    vignette(f);
  },
});

const wasdKite = kiting(0, 'ON THE BEAT', 0.36, 'attack, move, attack — timed');
const wasdOffKite = kiting(1, 'EDGE OF REACH', 0.44, 'chase without closing');
const wasdDefKite = kiting(-1, 'NEVER CLOSER', 0.52, 'backwards, still shooting');

/**
 * WASD 09 · MULTITASKING — all of it, at once.
 *
 * The only clip in the client that is deliberately busy. Everything the module
 * runs is on screen in the same frame — a telegraph to leave, two skillshots
 * in flight, a priority that has just moved and a cycle that has not stopped —
 * because "several things at the same time" cannot be previewed one at a time.
 */
const wasdMulti: PreviewScene = {
  length: 3.2,
  poster: 0.4,
  caption: 'all of it, at the same time',
  paint: (f) => {
    const { ctx, accent, u } = f;
    stage(f, 120, 102);
    const hx = 116 + 16 * Math.cos(u * TAU);
    const hy = 106 + 12 * Math.sin(u * TAU * 2);
    const foes: Pt[] = [
      { x: 224, y: 58 },
      { x: 258, y: 116 },
      { x: 170, y: 46 },
    ];
    const k = Math.floor(u * 3) % foes.length;
    const want = foes[k];

    // Something on the floor, always — and it has to read as a thing arriving
    // rather than as a rectangle, so it is short enough to see both ends of
    // and bright enough to be the second thing the eye finds.
    const tele = (u * 2) % 1;
    band(
      ctx,
      302,
      136,
      Math.PI * 1.14,
      142,
      24,
      tele < 0.6 ? WARN : RED,
      tele < 0.6 ? 0.55 + tele * 0.5 : 0.95,
      clamp01(tele / 0.6),
    );

    foes.forEach((e, j) => {
      foe(ctx, e.x, e.y, 5.4, j === k ? 1 : 0.55);
      if (j === k) ring(ctx, e.x, e.y, 12, rgba(WARN, 1), 0.85, 1.5);
    });

    // Two missiles in the air on different clocks, because in the module they
    // are on different cooldowns.
    const q1 = (u * 3) % 1;
    const q2 = (u * 4 + 0.5) % 1;
    if (q1 < 0.7) {
      const ang = Math.atan2(want.y - hy, want.x - hx);
      lance(ctx, lerp(hx, want.x, q1 / 0.7), lerp(hy, want.y, q1 / 0.7), ang, 22, accent, 1, 2.6);
    }
    if (q2 < 0.7) {
      const other = foes[(k + 1) % foes.length];
      const ang = Math.atan2(other.y - hy, other.x - hx);
      lance(ctx, lerp(hx, other.x, q2 / 0.7), lerp(hy, other.y, q2 / 0.7), ang, 18, BLUE, 0.9, 2.2);
    }
    hero(ctx, hx, hy, accent, Math.atan2(want.y - hy, want.x - hx));
    pointer(ctx, want.x, want.y, accent, true);
    wasdKeys(ctx, KEYS_AT.x, KEYS_AT.y, { x: -Math.sin(u * TAU), y: Math.cos(u * TAU * 2) * 0.6 }, accent);
    vignette(f);
  },
};

// ===========================================================================
// EZREAL
// ===========================================================================

/**
 * MYSTIC SHOT — how long it takes and how wide it is.
 *
 * There is nothing to lead and nothing to dodge, so the clip has room to show
 * the two facts the mode exists to install: the missile is in the air for a
 * real length of time, and it is not a line, it is a strip with a width. The
 * strip stays drawn while the missile crosses it, which is the only way a
 * still frame carries both.
 */
const ezQ: PreviewScene = {
  length: 2.6,
  poster: 0.42,
  caption: 'travel time, and a width',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 78, 100);
    const hx = 66;
    const hy = 98;
    const ex = 246;
    const ey = 74;
    const cycle = 1.3;
    const p = (t % cycle) / cycle;
    const ang = Math.atan2(ey - hy, ex - hx);

    band(ctx, hx, hy, ang, 190, 13, accent, 0.55, 1);
    foe(ctx, ex, ey, 5.5, 1);
    if (p < 0.62) {
      const q = p / 0.62;
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), ang, 26, accent, 1, 3);
      tag(ctx, lerp(hx, ex, q), lerp(hy, ey, q) - 14, `${Math.round(q * 420)}ms`, rgba(BONE, 0.75), 0.8, 7);
    } else {
      burst(ctx, ex, ey, (p - 0.62) / 0.38, accent, 26, 6);
    }
    hero(ctx, hx, hy, accent, ang);
    vignette(f);
  },
};

/**
 * LEAD — the shot goes to the arrival.
 *
 * Two markers: where they are, and where the missile is going. The gap between
 * them is the mode. The target moves at a constant speed and the lead is right,
 * so the clip shows a player who has solved it rather than one who is guessing.
 */
const ezLead: PreviewScene = {
  length: 3,
  poster: 0.3,
  caption: 'aim at the arrival',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 78, 100);
    const hx = 62;
    const hy = 100;
    const ex = 232;
    const ey = 92 + 44 * Math.sin(u * TAU);
    const lead = ey + 40 * Math.cos(u * TAU);
    const ang = Math.atan2(lead - hy, ex - hx);
    const cycle = 1.5;
    const p = (t % cycle) / cycle;

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = rgba(WARN, 0.9);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex, lead);
    ctx.stroke();
    ctx.restore();
    ring(ctx, ex, lead, 9, rgba(WARN, 1), 0.8, 1.3, [3, 3]);
    foe(ctx, ex, ey, 5.5, 1);
    if (p < 0.62) {
      const q = p / 0.62;
      lance(ctx, lerp(hx, ex, q), lerp(hy, lead, q), ang, 24, accent, 1, 2.8);
    } else burst(ctx, ex, lead, (p - 0.62) / 0.38, accent, 22, 5);
    hero(ctx, hx, hy, accent, ang);
    tag(ctx, ex, lead - 18, 'ARRIVAL', rgba(WARN, 1), 0.9, 7.5);
    vignette(f);
  },
};

/**
 * Q WHILE STRAFING — both feet busy, and the shot goes anyway.
 *
 * The zones land where she *is*, so she can never be standing still when the
 * missile leaves — which is the mode's whole scoring rule drawn rather than
 * written. Every frame has her in motion and a circle closing on where she was.
 */
const ezStrafe: PreviewScene = {
  length: 3.2,
  poster: 0.44,
  caption: 'moving, and landing it anyway',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 110, 102);
    const cx = 132;
    const cy = 100;
    const a = u * TAU;
    const hx = cx + Math.cos(a) * 54;
    const hy = cy + Math.sin(a) * 30;
    const ex = 252;
    const ey = 70;
    const ang = Math.atan2(ey - hy, ex - hx);

    // A zone on the ground she has already left, and one arriving.
    for (const off of [0, 0.5]) {
      const q = (u + off) % 1;
      const zx = cx + Math.cos(a - 1.5) * 54;
      const zy = cy + Math.sin(a - 1.5) * 30;
      if (q < 0.55) {
        ring(ctx, zx, zy, 24, rgba(WARN, 1), 0.6 * (1 - q / 0.55), 1.4, [4, 4]);
      } else {
        burst(ctx, zx, zy, (q - 0.55) / 0.45, RED, 30);
      }
    }

    foe(ctx, ex, ey, 5.5, 1);
    const cycle = 1.6;
    const p = (t % cycle) / cycle;
    if (p < 0.55) {
      const q = p / 0.55;
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), ang, 24, accent, 1, 2.8);
    } else burst(ctx, ex, ey, (p - 0.55) / 0.45, accent, 22, 5);
    ghosts(ctx, { x: cx + Math.cos(a - 0.4) * 54, y: cy + Math.sin(a - 0.4) * 30 }, { x: hx, y: hy }, 1, accent, 4);
    hero(ctx, hx, hy, accent, ang);
    tag(ctx, cx, 26, 'FIRED ON THE MOVE', rgba(GOOD, 1), 0.85, 7.5);
    vignette(f);
  },
};

/**
 * THREAD — the gap, and how long it is there for.
 *
 * The wave is drawn as the wall it is, and the one gap in it closes over the
 * loop. The missile goes through at the last moment it could have, because a
 * clip of a gap being threaded early would be a clip of an easier mode.
 */
const ezThread: PreviewScene = {
  length: 3,
  poster: 0.56,
  caption: 'find the gap, fire before it shuts',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 74, 100);
    const hx = 58;
    const hy = 98;
    const ex = 266;
    const ey = 78;
    // The wall, with one hole in it that drifts and narrows.
    const gapY = 74 + 16 * Math.sin(u * TAU);
    const rows = [40, 58, 76, 94, 112, 130];
    const wallX = 168;
    const p = (t % 1.5) / 1.5;
    const ang = Math.atan2(gapY - hy, ex - hx);

    band(ctx, hx, hy, ang, 220, 10, accent, 0.45, 1);
    for (const ry of rows) {
      if (Math.abs(ry - gapY) < 15) continue;
      minion(ctx, wallX, ry, RED, 1, 0.8);
      minion(ctx, wallX + 20, ry - 8, RED, 1, 0.5);
    }
    foe(ctx, ex, ey, 5.5, 1);
    if (p < 0.6) {
      const q = p / 0.6;
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), ang, 24, accent, 1, 2.8);
    } else burst(ctx, ex, ey, (p - 0.6) / 0.4, accent, 22, 5);
    hero(ctx, hx, hy, accent, ang);
    tag(ctx, wallX + 10, gapY - 16, 'GAP', rgba(GOOD, 1), 0.9, 7.5);
    vignette(f);
  },
};

/**
 * WEAVE — the missile goes between the attacks, not instead of them.
 *
 * Three marks on one bar: the attack, the window the Q belongs in, and the
 * window it must never be in. The champion runs the cycle correctly on the
 * beat, so the clip is a metronome you can copy rather than a diagram you have
 * to decode.
 */
const ezWeave: PreviewScene = {
  length: 3,
  poster: 0.5,
  caption: 'auto, Q, auto',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 96, 96);
    const hx = 96;
    const hy = 100;
    const ex = 244;
    const ey = 80;
    const cycle = 1.5;
    const p = (t % cycle) / cycle;
    const WIND = 0.26;
    const ang = Math.atan2(ey - hy, ex - hx);

    foe(ctx, ex, ey, 5.5, 1);
    if (p < WIND) ring(ctx, hx, hy, 13, rgba(RED, 1), 0.55, 1.5);
    // The auto goes out at the end of the windup; the Q rides the backswing.
    if (p >= WIND && p < WIND + 0.3) {
      const q = (p - WIND) / 0.3;
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), ang, 20, accent, 1, 2.4);
    }
    if (p >= WIND + 0.16 && p < WIND + 0.62) {
      const q = (p - WIND - 0.16) / 0.46;
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey + 12, q), ang + 0.06, 26, BLUE, 1, 3);
    }
    hero(ctx, hx, hy, accent, ang);

    const bx = 90;
    const by = TITLE_BAND - 16;
    const bw = 140;
    ctx.save();
    ctx.fillStyle = 'rgba(10,16,28,0.82)';
    ctx.fillRect(bx, by, bw, 7);
    ctx.fillStyle = rgba(RED, 0.42);
    ctx.fillRect(bx, by, bw * WIND, 7);
    ctx.fillStyle = rgba(BLUE, 0.34);
    ctx.fillRect(bx + bw * (WIND + 0.16), by, bw * 0.46, 7);
    ctx.fillStyle = rgba(BONE, 0.95);
    ctx.fillRect(bx + bw * p - 1, by - 2, 2, 11);
    ctx.restore();
    tag(ctx, bx + bw * WIND * 0.5, by - 9, 'NOT HERE', rgba(RED, 0.95), 0.9, 7);
    tag(ctx, bx + bw * (WIND + 0.39), by - 9, 'Q HERE', rgba(BLUE, 0.95), 0.9, 7);
    vignette(f);
  },
};

/**
 * MAX RANGE Q — the outer quarter, and nothing else.
 *
 * The band that scores is shaded and the rest of the reach is not, so the
 * picture answers the only question the mode asks before a word of copy is
 * read: how far out do I have to be standing.
 */
const ezMaxRange: PreviewScene = {
  length: 2.8,
  poster: 0.46,
  caption: 'only the outer quarter counts',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 70, 102);
    const hx = 54;
    const hy = 104;
    const R = 196;
    const inner = R * 0.75;
    const a = -0.34 + 0.12 * Math.sin(u * TAU);
    const ex = hx + Math.cos(a) * (R - 14);
    const ey = hy + Math.sin(a) * (R - 14);

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = rgba(GOOD, 1);
    ctx.beginPath();
    ctx.arc(hx, hy, R, 0, TAU);
    ctx.arc(hx, hy, inner, 0, TAU, true);
    ctx.fill();
    ctx.restore();
    ring(ctx, hx, hy, R, rgba(accent, 1), 0.55, 1.5);
    ring(ctx, hx, hy, inner, rgba(GOOD, 1), 0.45, 1.2, [4, 5]);

    const cycle = 1.4;
    const p = (t % cycle) / cycle;
    if (p < 0.66) {
      const q = p / 0.66;
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), a, 26, accent, 1, 2.8);
    } else burst(ctx, ex, ey, (p - 0.66) / 0.34, GOOD, 24, 6);
    foe(ctx, ex, ey, 5.5, 1);
    hero(ctx, hx, hy, accent, a);
    tag(ctx, ex - 6, ey - 18, 'MAX', rgba(GOOD, 1), 0.9, 7.5);
    vignette(f);
  },
};

/**
 * KITE AND Q — the cycle, with something on you.
 *
 * The hunter closes the whole time and the cycle never breaks, which is the
 * claim the mode makes about itself: aiming a missile is a thing you do *while*
 * the attack timer is running, not instead of it.
 */
const ezKite: PreviewScene = {
  length: 3.2,
  poster: 0.38,
  caption: 'aim with something on you',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 108, 100);
    const ex = 218 - 30 * Math.sin(u * TAU);
    const ey = 74;
    const hx = 104 - 18 * Math.sin(u * TAU);
    const hy = 112;
    const ang = Math.atan2(ey - hy, ex - hx);
    const cycle = 0.8;
    const p = (t % cycle) / cycle;

    ring(ctx, hx, hy, 78, rgba(accent, 1), 0.22, 1.1, [5, 6]);
    ring(ctx, ex, ey, 34, rgba(RED, 1), 0.38, 1.2, [4, 4]);
    foe(ctx, ex, ey, 5.8, 1);
    if (p < 0.28) ring(ctx, hx, hy, 12, rgba(RED, 1), 0.5, 1.4);
    else {
      const q = (p - 0.28) / 0.34;
      if (q < 1) lance(ctx, lerp(hx, ex, easeOut(q)), lerp(hy, ey, easeOut(q)), ang, 20, accent, 1, 2.4);
    }
    // The missile runs on its own clock, twice as slow as the attack.
    const qq = (t % 1.6) / 1.6;
    if (qq < 0.5) lance(ctx, lerp(hx, ex, qq / 0.5), lerp(hy, ey + 10, qq / 0.5), ang + 0.05, 26, BLUE, 1, 3);
    hero(ctx, hx, hy, accent, ang);
    tag(ctx, hx, hy + 22, 'CYCLE HELD', rgba(GOOD, 1), 0.85, 7.5);
    vignette(f);
  },
};

/**
 * ARCANE SHIFT — scored on where it puts you.
 *
 * Two circles you must not be in and one you must stay inside, and the blink
 * lands in the sliver that satisfies all three. The sliver is shaded, because
 * "out of their reach, still in yours" is a piece of *ground* and the mode is
 * about finding it.
 */
const ezShift: PreviewScene = {
  length: 3.4,
  poster: 0.62,
  caption: 'out of theirs, still inside yours',
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 104, 100);
    const ex = 244;
    const ey = 78;
    const shells: Pt[] = [
      { x: 128, y: 52 },
      { x: 116, y: 130 },
    ];
    const from: Pt = { x: 86, y: 92 };
    const to: Pt = { x: 186, y: 96 };
    const cycle = 1.7;
    const p = (t % cycle) / cycle;
    const blink = clamp01((p - 0.24) / 0.14);
    const hx = blink >= 1 ? to.x : blink > 0 ? lerp(from.x, to.x, easeIn(blink)) : from.x;
    const hy = blink >= 1 ? to.y : blink > 0 ? lerp(from.y, to.y, easeIn(blink)) : from.y;

    for (const s of shells) {
      ring(ctx, s.x, s.y, 56, rgba(RED, 1), 0.4, 1.3, [4, 5]);
      foe(ctx, s.x, s.y, 5, 0.8);
    }
    ring(ctx, to.x, to.y, 84, rgba(accent, 1), 0.3, 1.2, [5, 6]);
    foe(ctx, ex, ey, 5.5, 1);

    if (blink > 0 && blink < 1) {
      ghosts(ctx, from, to, blink, accent, 4);
      burst(ctx, from.x, from.y, blink, accent, 22);
    }
    if (blink >= 1) burst(ctx, to.x, to.y, clamp01((p - 0.38) / 0.24), accent, 24, 6);
    hero(ctx, hx, hy, accent, Math.atan2(ey - hy, ex - hx));
    tag(ctx, to.x, to.y - 22, blink >= 1 ? 'CLEAR · IN RANGE' : 'BLINK', rgba(blink >= 1 ? GOOD : accent, 1), 0.9, 7.5);
    vignette(f);
  },
};

/**
 * TRANSFER — the mark moves, and the missile has to follow it.
 *
 * The same shape as TARGET SWITCH one section down, and deliberately so: the
 * skill is the same and the instrument is different. What the clip adds is
 * travel time — the missile is still crossing when the eye has already gone,
 * which is exactly why transferring a skillshot is harder than transferring an
 * attack.
 */
const ezSwitch: PreviewScene = {
  length: 3.3,
  poster: 0.4,
  caption: 'onto the one that matters',
  paint: (f) => {
    const { ctx, accent } = f;
    stage(f, 78, 100);
    const hx = 62;
    const hy = 100;
    const foes: Pt[] = [
      { x: 214, y: 52 },
      { x: 262, y: 104 },
      { x: 190, y: 134 },
    ];
    const n = f.u * foes.length;
    const k = Math.floor(n) % foes.length;
    const p = n % 1;
    const want = foes[k];
    const ang = Math.atan2(want.y - hy, want.x - hx);

    foes.forEach((e, j) => {
      const live = j === k;
      foe(ctx, e.x, e.y, 5.4, live ? 1 : 0.45);
      if (live) {
        ring(ctx, e.x, e.y, 12 + (1 - clamp01(p / 0.2)) * 10, rgba(WARN, 1), 0.85, 1.5);
        tag(ctx, e.x, e.y - 19, 'MARKED', rgba(WARN, 1), 0.9, 7);
      }
    });
    const fire = clamp01((p - 0.22) / 0.44);
    if (fire > 0 && fire < 1) {
      band(ctx, hx, hy, ang, 220, 11, accent, 0.35, 1);
      lance(ctx, lerp(hx, want.x, fire), lerp(hy, want.y, fire), ang, 24, accent, 1, 2.8);
    }
    if (fire >= 1) burst(ctx, want.x, want.y, clamp01((p - 0.66) / 0.3), accent, 22, 5);
    hero(ctx, hx, hy, accent, ang);
    pointer(ctx, want.x, want.y, accent, fire > 0);
    vignette(f);
  },
};

/**
 * THE FIGHT — everything the section taught, in the same ten seconds.
 *
 * The busiest picture in the client after MULTITASKING, and for the same
 * reason: the mode's subject is that all of it is true at once. A hunter, a
 * duelist, a wave, terrain, a missile in the air and a cycle still running —
 * and no single one of them is the thing you are looking at.
 */
const ezFight: PreviewScene = {
  length: 3.6,
  poster: 0.46,
  caption: 'move, aim, attack, decide',
  paint: (f) => {
    const { ctx, accent, u } = f;
    stage(f, 96, 104);
    wall(ctx, 288, 34, 138);
    const hx = 104 + 18 * Math.cos(u * TAU);
    const hy = 108 + 14 * Math.sin(u * TAU * 2);
    const hunter: Pt = { x: 198 - 26 * Math.sin(u * TAU), y: 62 };
    const duelist: Pt = { x: 244, y: 126 - 20 * Math.cos(u * TAU) };

    for (let i = 0; i < 3; i++) minion(ctx, 150 + i * 15, 100 + i * 9, RED, 1 - i * 0.22, 0.7);
    const tele = (u * 2) % 1;
    cone(ctx, duelist.x, duelist.y, Math.PI * 0.92, 0.3, 130, tele < 0.62 ? WARN : RED, tele < 0.62 ? 0.3 + tele * 0.5 : 0.8 * (1 - (tele - 0.62) / 0.38));

    foe(ctx, hunter.x, hunter.y, 5.6, 1);
    foe(ctx, duelist.x, duelist.y, 5.6, 1);
    ring(ctx, hx, hy, 80, rgba(accent, 1), 0.2, 1.1, [5, 6]);

    const ang = Math.atan2(hunter.y - hy, hunter.x - hx);
    const auto = (u * 5) % 1;
    if (auto < 0.62) lance(ctx, lerp(hx, hunter.x, auto / 0.62), lerp(hy, hunter.y, auto / 0.62), ang, 20, accent, 1, 2.4);
    const q = (u * 2) % 1;
    if (q < 0.5) lance(ctx, lerp(hx, duelist.x, q / 0.5), lerp(hy, duelist.y, q / 0.5), Math.atan2(duelist.y - hy, duelist.x - hx), 26, BLUE, 1, 3);
    hero(ctx, hx, hy, accent, ang);
    pointer(ctx, hunter.x, hunter.y, accent, true);
    vignette(f);
  },
};


// ===========================================================================
// TWISTED FATE
//
// Every other champion in this file is drawn with rings and lances, because
// every other champion is about distance. His clips need one more noun — a
// card — and one more verb: a wheel that turns whether or not you are ready,
// which is the only mechanic in the client that is a *tempo* rather than a
// geometry. Both live here.
// ===========================================================================

const TF_CARDS: { id: 'blue' | 'red' | 'gold'; color: string }[] = [
  { id: 'blue', color: '#5cc8ff' },
  { id: 'red', color: '#ff6155' },
  { id: 'gold', color: '#ffcf5c' },
];
const TF_GOLDC = '#ffcf5c';
const TF_VIOLET = '#b07bff';

/** A playing card, face on, at an angle. The one shape that is only his. */
function card(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  alpha: number,
  scale = 1,
  rot = 0,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  const w = 7;
  const h = 10.5;
  ctx.fillStyle = rgba(color, 0.9);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 1.8);
  ctx.fill();
  ctx.stroke();
  // A pip, so a card at this size still reads as a card and not a chip.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, 1.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * THE WHEEL.
 *
 * Three arcs in the order they come, and a head sweeping them at two cards a
 * second. It is the same object the arena draws under his feet, at the same
 * proportions, for the same reason the bench pads are: the card and the run
 * should be one picture, not two that resemble each other.
 *
 * `phase` is turns, not seconds, so a caller can drive it from anything.
 */
function wheel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  phase: number,
  lit: 'blue' | 'red' | 'gold' | null,
  alpha = 1,
) {
  const span = TAU / 3;
  for (let i = 0; i < 3; i++) {
    const c = TF_CARDS[i];
    const on = lit === c.id;
    ctx.save();
    ctx.globalAlpha = alpha * (on ? 0.95 : 0.3);
    ctx.strokeStyle = rgba(c.color, 1);
    ctx.lineWidth = on ? 4.2 : 2;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2 + i * span + 0.09, -Math.PI / 2 + (i + 1) * span - 0.09);
    ctx.stroke();
    ctx.restore();
  }
  const a = -Math.PI / 2 + ((((phase % 3) + 3) % 3) * span);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * (r - 7), y + Math.sin(a) * (r - 7));
  ctx.lineTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6));
  ctx.stroke();
  ctx.restore();
}

/** Which face the wheel is showing at a given phase in turns. */
const faceAt = (phase: number): 'blue' | 'red' | 'gold' =>
  TF_CARDS[Math.floor((((phase % 3) + 3) % 3))].id;

/**
 * PICK A CARD — the wheel, and the appointment you have to keep.
 *
 * The whole mode in one picture: a card is named, the wheel turns at two a
 * second, and the lock happens the *first* time gold comes round. The head
 * passes blue and red without stopping, which is the thing that separates this
 * clip from a clip of somebody waiting — and the count of slots is printed,
 * because that count is literally the mode's score.
 */
const tfPick: PreviewScene = {
  length: 2.8,
  poster: 0.66,
  caption: 'take it the first time round',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 150, 100);
    const hx = 152;
    const hy = 96;
    const R = 46;

    // Two cards a second, starting on blue, locking the moment gold arrives.
    const spinAt = 0.5;
    const lockAt = spinAt + 2 * 0.5;
    const spinning = t >= spinAt && t < lockAt;
    const phase = spinning ? (t - spinAt) / 0.5 : 0;

    tag(ctx, hx, 26, 'GOLD', TF_GOLDC, t < lockAt ? 0.95 : 0.35, 11);
    if (t < spinAt) {
      wheel(ctx, hx, hy, R, 0, null, 0.45);
    } else if (spinning) {
      wheel(ctx, hx, hy, R, phase, faceAt(phase), 1);
      tag(ctx, hx, hy + R + 18, `${Math.floor(phase)} / 2`, rgba(BONE, 1), 0.8, 8);
    } else {
      wheel(ctx, hx, hy, R, 2, 'gold', 1);
      burst(ctx, hx, hy, at(t, lockAt, 0.5), TF_GOLDC, 54, 6);
      card(ctx, hx + 34, hy - 30, TF_GOLDC, easeOut(at(t, lockAt, 0.25)), 1.1, 0.24);
      tag(ctx, hx, hy + R + 18, 'NO SLOTS WASTED', GOOD, at(t, lockAt + 0.1, 0.3) * 0.95, 8);
    }

    hero(ctx, hx, hy, accent, -Math.PI / 2);
    vignette(f);
  },
};

/**
 * GOLD CARD — the lock, and then the walk that has to pay for it.
 *
 * Locking gold is half the mode and the clip gives it half the time. The other
 * half is the part players forget exists: the card does nothing until an attack
 * carries it into somebody, and somebody is moving.
 */
const tfGold: PreviewScene = {
  length: 3.2,
  poster: 0.78,
  caption: 'lock it, then land it',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 90, 104);
    const lockAt = 1;
    const fireAt = 2;
    const landAt = 2.35;

    const ex = 226 - 26 * Math.sin(u * TAU);
    const ey = 78 + 30 * Math.cos(u * TAU * 0.8);
    const walk = smooth(clamp01((t - lockAt) / 1));
    const hx = lerp(62, 120, walk);
    const hy = lerp(112, 104, walk);
    const ang = Math.atan2(ey - hy, ex - hx);

    if (t < lockAt) {
      const phase = t / 0.5;
      wheel(ctx, hx, hy, 40, phase, faceAt(phase), 0.95);
    } else {
      card(ctx, hx - 20, hy - 22, TF_GOLDC, 1, 0.95, -0.3);
    }

    ring(ctx, hx, hy, 74, rgba(accent, 1), 0.18, 1.2, [4, 5]);
    foe(ctx, ex, ey, 5.6, 1);
    if (t >= fireAt && t < landAt) {
      const q = (t - fireAt) / (landAt - fireAt);
      lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), ang, 22, TF_GOLDC, 1, 2.8);
    } else if (t >= landAt) {
      burst(ctx, ex, ey, at(t, landAt, 0.5), TF_GOLDC, 30, 8);
      ring(ctx, ex, ey, 15 + 3 * Math.sin(t * 14), rgba(TF_GOLDC, 1), 0.9, 2);
      tag(ctx, ex, ey - 22, 'STUNNED', TF_GOLDC, at(t, landAt, 0.2) * 0.95, 8.5);
    }
    hero(ctx, hx, hy, accent, ang);
    vignette(f);
  },
};

/**
 * WILD CARDS — a line, not a point.
 *
 * The one thing the mode is about is visible only by contrast, so the clip
 * draws the contrast: the same cast, twice. Aimed at the body it clips one
 * minion. Turned fifteen degrees it goes down the length of the wave and every
 * card in the fan finds something.
 */
const tfWild: PreviewScene = {
  length: 4,
  poster: 0.82,
  caption: 'aim along them, not at them',
  paint: (f) => {
    const { ctx, accent } = f;
    // Two halves that answer each other, so the loop is the comparison rather
    // than a sentence with an ending: the wrong cast, then the right one, then
    // the wrong one again. Taken modulo its own length so the frame at the end
    // is the frame at the start and there is nothing to hide.
    const t = f.t % 4;
    stage(f, 66, 100);
    const hx = 52;
    const hy = 100;
    // A column of bodies, standing off to one side, so there is a line that
    // threads them and a line that does not.
    const wave: Pt[] = [];
    for (let i = 0; i < 5; i++) wave.push({ x: 190 + i * 13, y: 52 + i * 21 });

    const bad = t < 2;
    const aimAt = bad ? wave[2] : { x: wave[0].x - 24, y: wave[0].y - 6 };
    const ang = Math.atan2(aimAt.y - hy, aimAt.x - hx);
    const cycle = bad ? t / 2 : (t - 2) / 2;
    const p = clamp01((cycle - 0.16) / 0.7);

    for (const m of wave) minion(ctx, m.x, m.y, RED, 1);

    for (const off of [-0.2443, 0, 0.2443]) {
      const a = ang + off;
      const len = 210;
      const tipX = hx + Math.cos(a) * len * p;
      const tipY = hy + Math.sin(a) * len * p;
      if (p > 0 && p < 1) lance(ctx, tipX, tipY, a, 30, TF_GOLDC, 0.95, 2.6);
      // Every body the card actually passes through lights up as it goes by.
      for (const m of wave) {
        const rx = m.x - hx;
        const ry = m.y - hy;
        const along = rx * Math.cos(a) + ry * Math.sin(a);
        const offAxis = Math.abs(rx * -Math.sin(a) + ry * Math.cos(a));
        if (offAxis > 7 || along < 0 || along > len) continue;
        const hitAt = along / len;
        if (p > hitAt) burst(ctx, m.x, m.y, clamp01((p - hitAt) / 0.3), TF_GOLDC, 16, 4);
      }
    }

    tag(ctx, 166, 150, bad ? 'AT THE BODY — ONE CARD' : 'ALONG THE LINE — SIX', bad ? WARN : GOOD, 0.95, 8.5);
    hero(ctx, hx, hy, accent, ang);
    pointer(ctx, aimAt.x, aimAt.y, accent, !bad);
    vignette(f);
  },
};

/**
 * STACKED DECK — the fourth one, and where it is allowed to go.
 *
 * Four pips, filling. The first three attacks go into the wave because they
 * are worth nothing; the fourth goes past it, and the clip lets the three land
 * in real time so the count is something you watch happen rather than a number
 * printed on a card.
 */
const tfDeck: PreviewScene = {
  length: 3.6,
  poster: 0.88,
  caption: 'the fourth one is worth three',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 66, 104);
    const hx = 56;
    const hy = 104;
    const mins: Pt[] = [
      { x: 150, y: 74 },
      { x: 152, y: 108 },
      { x: 148, y: 140 },
    ];
    const champ = { x: 250, y: 92 };

    const beat = 0.8;
    const n = Math.min(4, Math.floor(t / beat));
    const p = (t % beat) / beat;

    for (let i = 0; i < mins.length; i++) minion(ctx, mins[i].x, mins[i].y, RED, i < n ? 0.45 : 1);
    foe(ctx, champ.x, champ.y, 6, 1);

    const to = n < 3 ? mins[Math.min(n, 2)] : champ;
    const ang = Math.atan2(to.y - hy, to.x - hx);
    if (n < 4) {
      if (p < 0.66) {
        const q = p / 0.66;
        lance(ctx, lerp(hx, to.x, q), lerp(hy, to.y, q), ang, 20, n === 3 ? TF_GOLDC : accent, 1, n === 3 ? 3.4 : 2.2);
      } else {
        burst(ctx, to.x, to.y, (p - 0.66) / 0.34, n === 3 ? TF_GOLDC : accent, n === 3 ? 40 : 16, n === 3 ? 8 : 0);
      }
    } else {
      burst(ctx, champ.x, champ.y, clamp01((t - 4 * beat) / 0.6), TF_GOLDC, 46, 8);
      tag(ctx, champ.x, champ.y - 24, 'FOURTH', TF_GOLDC, 0.95, 9);
    }

    // The count, as pips, exactly as the arena draws it.
    for (let i = 0; i < 4; i++) {
      const px = hx - 24 + i * 12;
      const on = i < Math.min(n + (p > 0.66 ? 1 : 0), 4);
      ring(ctx, px, hy - 34, 4, rgba(on ? TF_GOLDC : BONE, 1), on ? 0.95 : 0.22, on ? 2.2 : 1.2);
    }
    hero(ctx, hx, hy, accent, ang);
    vignette(f);
  },
};

/**
 * LOADED — the card was already there.
 *
 * The one habit that decides his fights, and it is a *negative* picture: the
 * interesting thing is what does not happen when the hunter arrives. So the
 * clip spends its first half on an empty floor with a wheel turning on it, and
 * its second on somebody walking into a card that was locked before they were
 * visible.
 */
const tfHold: PreviewScene = {
  length: 4,
  poster: 0.86,
  caption: 'locked before it was needed',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 104, 104);
    const hx = 104;
    const hy = 104;
    const lockAt = 1;

    if (t < lockAt) {
      const phase = t / 0.5;
      wheel(ctx, hx, hy, 42, phase, faceAt(phase), 0.95);
      tag(ctx, hx, 28, 'NOBODY HERE YET', rgba(BONE, 1), 0.6, 8);
    } else {
      card(ctx, hx + 2, hy - 30, TF_GOLDC, 1, 1 + 0.06 * Math.sin(t * 5), 0.1);
      tag(ctx, hx, 28, t < 2.4 ? 'HOLDING' : 'INCOMING', t < 2.4 ? TF_GOLDC : WARN, 0.9, 9);
    }

    // The approach, on a clock you can see — the mode's own telegraph.
    const walk = clamp01((t - 2) / 1.4);
    const ex = lerp(300, 158, easeOut(walk));
    const ey = 92;
    if (t > 1.9) {
      foe(ctx, ex, ey, 5.8, 1);
      ring(ctx, hx, hy, 74, rgba(accent, 1), 0.2, 1.2, [4, 5]);
    }
    if (walk >= 1) {
      const q = at(t, 3.4, 0.5);
      burst(ctx, ex, ey, q, TF_GOLDC, 32, 8);
      if (q > 0.05) ring(ctx, ex, ey, 15 + 3 * Math.sin(t * 15), rgba(TF_GOLDC, 1), 0.9, 2);
    }
    hero(ctx, hx, hy, accent, t > 1.9 ? Math.atan2(ey - hy, ex - hx) : -Math.PI / 2);
    vignette(f);
  },
};

/**
 * COLD DECK — the same wheel, and no floor to stand on.
 *
 * Nothing about the wheel changes here, which is the point, so the clip changes
 * everything around it: the champion is always moving, a circle is always
 * closing on where she was, and the head goes round at exactly the speed it did
 * when she was allowed to stand still.
 */
const tfPressure: PreviewScene = {
  length: 3,
  poster: 0.5,
  caption: 'choosing, while being shot at',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 130, 100);
    const cx = 142;
    const cy = 100;
    const a = u * TAU;
    const hx = cx + Math.cos(a) * 56;
    const hy = cy + Math.sin(a) * 32;

    // A zone lands where she was a moment ago, every time. Two of them, half a
    // loop apart, so there is always one on the floor.
    for (const off of [0, 0.5]) {
      const q = (u + off) % 1;
      // Always a step and a bit behind her, which is where a zone aimed at a
      // moving champion actually lands.
      const za = a - 1.1 - off * TAU;
      const zx = cx + Math.cos(za) * 56;
      const zy = cy + Math.sin(za) * 32;
      const warn = q < 0.62 ? q / 0.62 : 1;
      ring(ctx, zx, zy, 26, rgba(q < 0.62 ? WARN : RED, 1), q < 0.62 ? 0.4 + warn * 0.4 : 0.8 * (1 - (q - 0.62) / 0.38), q < 0.62 ? 1.3 : 2.4, q < 0.62 ? [3, 4] : undefined);
      if (q < 0.62) arcRing(ctx, zx, zy, 26, warn, rgba(WARN, 1), 0.7, 2);
    }

    const phase = (t / 0.5) % 3;
    wheel(ctx, hx, hy, 38, phase, faceAt(phase), 0.95);
    foe(ctx, 284, 52, 5.4, 0.9);
    // Wrapped, because a heading of 7.85 radians and one of 1.57 are the same
    // picture and not the same frame — and the loop has to close as a frame.
    hero(ctx, hx, hy, accent, (a + Math.PI / 2) % TAU);
    vignette(f);
  },
};

/**
 * THE SET-UP — the stun is a window, not an outcome.
 *
 * The clip is a clock: gold lands, a ring starts draining, and the fan and the
 * attack both land before it empties. A player who has only ever stunned people
 * has never seen the second half of this picture, which is the reason it is
 * drawn rather than described.
 */
const tfCombo: PreviewScene = {
  length: 3.4,
  poster: 0.62,
  caption: 'spend the whole second and a half',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 74, 104);
    const hx = 74;
    const hy = 108;
    const ex = 228;
    const ey = 80;
    const ang = Math.atan2(ey - hy, ex - hx);
    const stunAt = 0.8;
    const left = clamp01(1 - (t - stunAt) / 1.5);

    foe(ctx, ex, ey, 5.8, 1);
    if (t < stunAt) {
      const q = t / stunAt;
      card(ctx, lerp(hx, ex, q), lerp(hy, ey, q), TF_GOLDC, 1, 1, q * 9);
    } else {
      // The window, drawn as the thing it is: a ring that is running out.
      ring(ctx, ex, ey, 18, rgba(TF_GOLDC, 1), 0.28, 2);
      arcRing(ctx, ex, ey, 18, left, rgba(TF_GOLDC, 1), 0.95, 3);
      burst(ctx, ex, ey, at(t, stunAt, 0.4), TF_GOLDC, 30, 8);
    }

    // The fan, then the attack, both inside the ring's life.
    const fanAt = stunAt + 0.25;
    if (t >= fanAt) {
      const q = clamp01((t - fanAt) / 0.55);
      for (const off of [-0.2443, 0, 0.2443]) {
        const a = ang + off;
        if (q < 1) lance(ctx, hx + Math.cos(a) * 190 * q, hy + Math.sin(a) * 190 * q, a, 26, TF_GOLDC, 0.9, 2.4);
      }
      if (q >= 1) burst(ctx, ex, ey, clamp01((t - fanAt - 0.55) / 0.35), TF_GOLDC, 22, 5);
    }
    const autoAt = stunAt + 1.05;
    if (t >= autoAt) {
      const q = clamp01((t - autoAt) / 0.3);
      if (q < 1) lance(ctx, lerp(hx, ex, q), lerp(hy, ey, q), ang, 20, accent, 1, 2.6);
      else burst(ctx, ex, ey, clamp01((t - autoAt - 0.3) / 0.4), accent, 26, 6);
    }
    tag(ctx, ex, ey - 30, left > 0 ? `${(left * 1.5).toFixed(1)}s` : 'SPENT', left > 0 ? TF_GOLDC : GOOD, 0.9, 8.5);
    hero(ctx, hx, hy, accent, ang);
    vignette(f);
  },
};

/**
 * GATE — three seconds of standing still, and a place worth them.
 *
 * Two channels and a blink, in order, at their real lengths. The ring on the
 * far side is closing the whole time, which is the mode's entire argument: you
 * cannot start the ultimate when the window opens and still arrive, so the
 * ultimate has to have been started before it did.
 */
const tfGate: PreviewScene = {
  length: 4.2,
  poster: 0.9,
  caption: 'the window closes before you could walk',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 64, 112);
    const hx = 60;
    const hy = 118;
    const zx = 268;
    const zy = 56;

    const revealFrom = 0.4;
    const gateFrom = 2.1;
    const arriveAt = 3.6;
    const zoneLeft = clamp01(1 - t / 4);

    ring(ctx, zx, zy, 30, rgba(TF_VIOLET, 1), 0.45, 2, [5, 5]);
    arcRing(ctx, zx, zy, 34, zoneLeft, rgba(TF_VIOLET, 1), 0.85, 2.4);

    const here = t < arriveAt;
    const px = here ? hx : zx;
    const py = here ? hy : zy;

    if (t >= revealFrom && t < revealFrom + 1.5) {
      const q = (t - revealFrom) / 1.5;
      ring(ctx, hx, hy, 22 + q * 130, rgba(TF_VIOLET, 1), 0.5 * (1 - q), 1.6);
      arcRing(ctx, hx, hy, 20, q, rgba(TF_VIOLET, 1), 0.9, 2.6);
      tag(ctx, hx, hy - 34, 'DESTINY', TF_VIOLET, 0.9, 8);
    }
    if (t >= gateFrom && t < arriveAt) {
      const q = (t - gateFrom) / (arriveAt - gateFrom);
      arcRing(ctx, hx, hy, 20, q, rgba(TF_VIOLET, 1), 0.95, 3);
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.4 * q;
      ctx.strokeStyle = rgba(TF_VIOLET, 1);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(zx, zy);
      ctx.stroke();
      ctx.restore();
      tag(ctx, hx, hy - 34, 'GATE', TF_VIOLET, 0.95, 8);
    }
    if (t >= arriveAt) {
      ghosts(ctx, { x: hx, y: hy }, { x: zx, y: zy }, 1, TF_VIOLET, 5);
      burst(ctx, zx, zy, at(t, arriveAt, 0.6), TF_VIOLET, 46, 8);
      tag(ctx, zx, zy + 30, 'ON THE MARK', GOOD, at(t, arriveAt, 0.25) * 0.95, 8.5);
    }
    hero(ctx, px, py, accent, Math.atan2(zy - hy, zx - hx));
    vignette(f);
  },
};

/**
 * THE TABLE — the whole deck, and people trying to take it off you.
 *
 * The one clip on the path that is a loop rather than a sentence, because the
 * mode is not a sentence either: the wheel is always turning, something is
 * always arriving, and the fan is always somewhere in the air.
 */
const tfFight: PreviewScene = {
  length: 3,
  poster: 0.46,
  caption: 'all of it, against people',
  paint: (f) => {
    const { ctx, accent, t, u } = f;
    stage(f, 118, 104);
    const cx = 126;
    const cy = 104;
    const a = u * TAU;
    const hx = cx + Math.cos(a) * 44;
    const hy = cy + Math.sin(a) * 26;

    wall(ctx, 206, 8, 54);
    wall(ctx, 206, 132, 178);

    // Everything here turns a whole number of times in one loop — the wheel
    // twice, the hunter twice, the fan twice, the telegraph twice — which is
    // the only way a clip with four independent clocks on it closes.
    const hunter = { x: 232 + 16 * Math.cos(u * TAU * 2), y: 62 + 14 * Math.sin(u * TAU * 2) };
    const duelist = { x: 264, y: 132 };
    for (let i = 0; i < 3; i++) minion(ctx, 172 + i * 9, 88 + i * 16, RED, 1 - i * 0.25, 0.75);

    const phase = (t / 0.5) % 3;
    wheel(ctx, hx, hy, 34, phase, faceAt(phase), 0.8);

    const ang = Math.atan2(hunter.y - hy, hunter.x - hx);
    const fan = (u * 2) % 1;
    if (fan < 0.55) {
      for (const off of [-0.2443, 0, 0.2443]) {
        const d = ang + off;
        lance(ctx, hx + Math.cos(d) * 180 * (fan / 0.55), hy + Math.sin(d) * 180 * (fan / 0.55), d, 24, TF_GOLDC, 0.9, 2.2);
      }
    }
    const tele = (u * 2) % 1;
    cone(ctx, duelist.x, duelist.y, Math.PI * 0.86, 0.3, 120, tele < 0.6 ? WARN : RED, tele < 0.6 ? 0.28 + tele * 0.5 : 0.75 * (1 - (tele - 0.6) / 0.4));

    foe(ctx, hunter.x, hunter.y, 5.6, 1);
    foe(ctx, duelist.x, duelist.y, 5.6, 1);
    hero(ctx, hx, hy, accent, ang);
    pointer(ctx, hunter.x, hunter.y, accent, true);
    vignette(f);
  },
};

// ===========================================================================
// KATARINA
// ===========================================================================

const KAT_REDC = '#ff4057';
const KAT_STEELC = '#dfe8f5';
const KAT_PINK = '#ff6f9c';

/**
 * A dagger: a short blade and a crossguard. The one shape that is only hers,
 * and at this size it has to read as a blade rather than an arrow — so the
 * guard is drawn wider than the blade is thick.
 */
function blade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  color: string,
  alpha: number,
  scale = 1,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(scale, scale);
  ctx.fillStyle = rgba(color, 0.95);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-3.5, -1.4);
  ctx.lineTo(6.5, 0);
  ctx.lineTo(-3.5, 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-3.8, -3.2);
  ctx.lineTo(-3.8, 3.2);
  ctx.moveTo(-3.8, 0);
  ctx.lineTo(-7, 0);
  ctx.stroke();
  ctx.restore();
}

/**
 * A dagger on its way down: the ring closing on the spot it will land, and
 * the blade itself above it, dropping. The same reading the arena draws —
 * a place first, a thing second.
 */
function falling(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, alpha = 1) {
  const q = clamp01(p);
  ring(ctx, x, y, 4 + 16 * (1 - q), rgba(KAT_STEELC, 1), alpha * (0.35 + 0.5 * q), 1.2);
  blade(ctx, x, y - (1 - q) * 22, Math.PI / 2, KAT_STEELC, alpha * 0.9, 0.9);
}

/** A dagger on the floor, and the reach you have to get inside to take it. */
function grounded(ctx: CanvasRenderingContext2D, x: number, y: number, alpha = 1) {
  ring(ctx, x, y, 18, rgba(KAT_REDC, 1), alpha * 0.45, 1, [3, 3]);
  blade(ctx, x, y, -0.6, KAT_REDC, alpha, 1);
}

/** A blink, fading: the line from where she was to where she is. */
function blinkTrace(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, p: number) {
  if (p <= 0 || p >= 1) return;
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.8;
  ctx.strokeStyle = rgba(KAT_REDC, 1);
  ctx.lineWidth = 2.4 * (1 - p) + 0.6;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * PREPARATION — drop it, then meet it.
 *
 * The dagger goes up where she stands and she spends its second and a quarter
 * doing what everybody does with the haste — following the target. Then the
 * step back, onto the spot, on the beat, with them still inside the slash.
 * The step back is the mode.
 */
const katPrep: PreviewScene = {
  length: 3.2,
  poster: 0.58,
  caption: 'drop it, then meet it',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 150, 100);
    const drop = { x: 144, y: 102 };
    const dropAt = 0.4;
    const landAt = dropAt + 1.25;
    const foe0 = { x: 192 + 10 * Math.sin(t * 2.2), y: 92 + 8 * Math.cos(t * 1.7) };

    // Out with the haste, and back onto the spot as it lands.
    const out = at(t, dropAt + 0.1, 0.55);
    const back = at(t, dropAt + 0.75, 0.45);
    const hx = lerp(drop.x, 170, smooth(out) - smooth(back)) + (t >= landAt ? 8 * smooth(at(t, landAt + 0.4, 0.8)) : 0);
    const hy = lerp(drop.y, 96, smooth(out) - smooth(back));

    if (t >= dropAt && t < landAt) falling(ctx, drop.x, drop.y, (t - dropAt) / 1.25);
    if (t >= landAt) {
      burst(ctx, hx, hy, at(t, landAt, 0.45), KAT_REDC, 44, 10);
      ring(ctx, foe0.x, foe0.y, 12, rgba(KAT_REDC, 1), 0.8 * (1 - at(t, landAt + 0.3, 0.6)), 2);
      tag(ctx, hx, hy - 30, 'TAKEN', GOOD, at(t, landAt, 0.2) * 0.95, 9);
    } else if (t >= dropAt) {
      tag(ctx, drop.x - 30, drop.y - 20, `${Math.max(0, landAt - t).toFixed(1)}s`, KAT_STEELC, 0.8, 8);
    }
    foe(ctx, foe0.x, foe0.y, 5.6, 1);
    hero(ctx, hx, hy, accent, Math.atan2(foe0.y - hy, foe0.x - hx));
    vignette(f);
  },
};

/**
 * BOUNCING BLADE — it lands behind what it hits.
 *
 * The same throw twice, as a comparison rather than a sentence: at the
 * champion, and the dagger comes down past them where nobody is; at the minion
 * in front of them, and it comes down on them. One body of difference, which
 * is the whole of the mode.
 */
const katBlade: PreviewScene = {
  length: 4,
  poster: 0.86,
  caption: 'throw at what is in front',
  paint: (f) => {
    const { ctx, accent } = f;
    const t = f.t % 4;
    stage(f, 70, 100);
    const hx = 58;
    const hy = 104;
    const champ = { x: 208, y: 92 };
    const wave: Pt[] = [
      { x: 160, y: 70 },
      { x: 164, y: 97 },
      { x: 158, y: 124 },
    ];
    const bad = t < 2;
    const first = bad ? champ : wave[1];
    const p = bad ? t / 2 : (t - 2) / 2;
    const fly = at(p, 0.1, 0.22);
    const fall = at(p, 0.32, 0.3);
    const dir = { x: first.x - hx, y: first.y - hy };
    const m = Math.hypot(dir.x, dir.y);
    const land = { x: first.x + (dir.x / m) * 44, y: first.y + (dir.y / m) * 44 };

    for (const w of wave) minion(ctx, w.x, w.y, RED, 1);
    if (fly > 0 && fly < 1) {
      lance(ctx, lerp(hx, first.x, fly), lerp(hy, first.y, fly), Math.atan2(dir.y, dir.x), 18, KAT_STEELC, 0.95, 2.2);
    }
    if (fly >= 1) {
      // The line it will come down along, drawn from the first body.
      ctx.save();
      ctx.globalAlpha = 0.35 * (1 - at(p, 0.9, 0.1));
      ctx.strokeStyle = rgba(KAT_STEELC, 1);
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(land.x, land.y);
      ctx.stroke();
      ctx.restore();
      if (fall < 1) falling(ctx, land.x, land.y, fall);
      else grounded(ctx, land.x, land.y, 1 - at(p, 0.9, 0.1));
    }
    const onThem = !bad && fall >= 1;
    if (onThem) ring(ctx, champ.x, champ.y, 40, rgba(KAT_REDC, 1), 0.45 * (1 - at(p, 0.9, 0.1)), 1.4, [4, 3]);
    foe(ctx, champ.x, champ.y, 5.8, 1);
    // Top left: the foot of the frame is the card's title, the top right its keys.
    tag(ctx, 12, 20, bad ? 'AT THEM — LANDS BEHIND' : 'AT THE WAVE — LANDS ON THEM', bad ? WARN : GOOD, 0.95, 8.5, 'left');
    hero(ctx, hx, hy, accent, Math.atan2(dir.y, dir.x));
    pointer(ctx, first.x + 4, first.y + 4, accent, !bad);
    vignette(f);
  },
};

/**
 * SHUNPO — one cooldown, three daggers.
 *
 * She blinks onto a dagger, takes it, and the blink is back before the next
 * one needs it. Round a triangle, forever, which is the only honest way to
 * draw a cooldown that a planned route keeps handing back.
 */
const katShunpo: PreviewScene = {
  length: 3,
  poster: 0.2,
  caption: 'onto the dagger, and again',
  paint: (f) => {
    const { ctx, accent } = f;
    const t = f.t % 3;
    stage(f, 160, 96);
    const target = { x: 164 + 6 * Math.sin((t / 3) * TAU), y: 92 };
    const pts: Pt[] = [
      { x: 118, y: 120 },
      { x: 164, y: 50 },
      { x: 212, y: 120 },
    ];
    const k = Math.floor(t) % 3;
    const tt = t - Math.floor(t);
    const prev = pts[(k + 2) % 3];
    for (let i = 0; i < 3; i++) {
      if (i === k) continue;
      // The one she has just left is dropped again, so there is always a
      // route: it lands before she comes round to it.
      if (i === (k + 2) % 3) falling(ctx, pts[i].x, pts[i].y, at(tt, 0.1, 0.7));
      else grounded(ctx, pts[i].x, pts[i].y);
    }
    blinkTrace(ctx, prev, pts[k], at(tt, 0, 0.4));
    burst(ctx, pts[k].x, pts[k].y, at(tt, 0, 0.45), KAT_REDC, 40, 10);
    foe(ctx, target.x, target.y, 5.6, 1);
    hero(ctx, pts[k].x, pts[k].y, accent, Math.atan2(target.y - pts[k].y, target.x - pts[k].x));
    // The cooldown, as the arc it is: nearly all of it gone on every take.
    const cd = 1 - at(tt, 0, 0.3);
    // Top left, clear of the card's own keys in the other corner.
    ring(ctx, 24, 24, 9, rgba(BONE, 1), 0.2, 1.4);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = rgba(KAT_REDC, 1);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(24, 24, 9, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - cd));
    ctx.stroke();
    ctx.restore();
    tag(ctx, 24, 24, 'E', BONE, 0.9, 8);
    vignette(f);
  },
};

/**
 * BLADE, THEN BLINK — be there when it lands.
 *
 * Throw, wait for the ring to close, and blink onto the spot on the beat the
 * dagger touches the floor. The clip holds on the wait, because the wait is
 * the mode: early is nothing to land on.
 */
const katBlink: PreviewScene = {
  length: 3,
  poster: 0.5,
  caption: 'throw it, then be there',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 120, 104);
    const home = { x: 70, y: 116 };
    const foe0 = { x: 170 + 6 * Math.sin(t * 2), y: 98 };
    const dir = norm2(foe0.x - home.x, foe0.y - home.y);
    const land = { x: 170 + dir.x * 44, y: 98 + dir.y * 44 };
    const fly = at(t, 0.25, 0.22);
    const landAt = 1.4;
    const blinked = t >= landAt;
    const hx = blinked ? land.x - 6 : home.x;
    const hy = blinked ? land.y - 4 : home.y;

    for (let i = 0; i < 3; i++) minion(ctx, 140 + i * 6, 132 + i * 12, RED, 1, 0.7);
    if (fly > 0 && fly < 1) lance(ctx, lerp(home.x, foe0.x, fly), lerp(home.y, foe0.y, fly), Math.atan2(dir.y, dir.x), 18, KAT_STEELC, 0.95, 2.2);
    if (fly >= 1 && !blinked) falling(ctx, land.x, land.y, (t - 0.47) / (landAt - 0.47));
    if (blinked) {
      blinkTrace(ctx, home, { x: hx, y: hy }, at(t, landAt, 0.5));
      burst(ctx, hx, hy, at(t, landAt, 0.5), KAT_REDC, 44, 10);
      tag(ctx, hx, hy - 30, 'ON THE BEAT', GOOD, at(t, landAt, 0.2) * 0.95, 8.5);
    }
    foe(ctx, foe0.x, foe0.y, 5.6, 1);
    hero(ctx, hx, hy, accent, Math.atan2(foe0.y - hy, foe0.x - hx));
    vignette(f);
  },
};

/** Unit vector, for the few clips that aim along a line. */
const norm2 = (x: number, y: number): Pt => {
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m };
};

/**
 * THE DANCE — in, drop, take.
 *
 * Three words, printed as they happen, because the order is the mode: the
 * blink first, the dagger at once, and the pickup on top of somebody who has
 * started walking away from it.
 */
const katDance: PreviewScene = {
  length: 3.4,
  poster: 0.66,
  caption: 'in, drop, take',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 160, 100);
    const start = { x: 70, y: 118 };
    const inAt = 0.35;
    const dropAt = 0.5;
    const landAt = dropAt + 1.25;
    const foe0 = { x: lerp(196, 218, smooth(at(t, 0.6, 1.4))), y: lerp(94, 86, smooth(at(t, 0.6, 1.4))) };
    const spot = { x: 184, y: 100 };
    const inside = t >= inAt;
    // Haste pulls her after them; she comes back onto the spot on the beat.
    const drift = smooth(at(t, dropAt + 0.1, 0.5)) - smooth(at(t, dropAt + 0.75, 0.45));
    const hx = inside ? spot.x + drift * 22 : start.x;
    const hy = inside ? spot.y - drift * 6 : start.y;

    if (inside) blinkTrace(ctx, start, spot, at(t, inAt, 0.5));
    if (t >= dropAt && t < landAt) falling(ctx, spot.x, spot.y, (t - dropAt) / 1.25);
    if (t >= landAt) burst(ctx, hx, hy, at(t, landAt, 0.5), KAT_REDC, 44, 10);

    const words = ['IN', 'DROP', 'TAKE'];
    const times = [inAt, dropAt, landAt];
    for (let i = 0; i < 3; i++) {
      tag(ctx, 34 + i * 44, 24, words[i], t >= times[i] ? GOOD : BONE, t >= times[i] ? 0.95 : 0.25, 9.5);
    }
    foe(ctx, foe0.x, foe0.y, 5.6, 1);
    hero(ctx, hx, hy, accent, Math.atan2(foe0.y - hy, foe0.x - hx));
    vignette(f);
  },
};

/**
 * RESET — a kill is a cooldown.
 *
 * Three bodies, and she goes round them: arrive, kill, and the kit comes back
 * lit before she has left. Each one is back on its feet by the time she is
 * round to it again, so the loop is the fight rather than an ending.
 */
const katReset: PreviewScene = {
  length: 3,
  poster: 0.16,
  caption: 'arrive at the next one ready',
  paint: (f) => {
    const { ctx, accent } = f;
    const t = f.t % 3;
    stage(f, 160, 100);
    const pts: Pt[] = [
      { x: 110, y: 118 },
      { x: 166, y: 56 },
      { x: 220, y: 116 },
    ];
    const k = Math.floor(t) % 3;
    const tt = t - Math.floor(t);
    for (let i = 0; i < 3; i++) {
      const alpha = i === k ? 1 - at(tt, 0.3, 0.3) : i === (k + 2) % 3 ? at(tt, 0.2, 0.6) : 1;
      foe(ctx, pts[i].x, pts[i].y, 5.6, alpha);
    }
    const here = { x: pts[k].x - 12, y: pts[k].y + 6 };
    const was = { x: pts[(k + 2) % 3].x - 12, y: pts[(k + 2) % 3].y + 6 };
    blinkTrace(ctx, was, here, at(tt, 0, 0.35));
    burst(ctx, pts[k].x, pts[k].y, at(tt, 0.28, 0.4), KAT_REDC, 26, 8);
    tag(ctx, here.x, here.y - 26, 'RESET', KAT_REDC, at(tt, 0.4, 0.1) * (1 - at(tt, 0.85, 0.15)), 9);
    // Q W E, dark while spent and lit the instant the kill lands.
    for (let i = 0; i < 3; i++) {
      const lit = at(tt, 0.4, 0.08);
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.7 * lit;
      ctx.fillStyle = rgba(lit > 0.5 ? KAT_REDC : BONE, 0.35);
      ctx.strokeStyle = rgba(lit > 0.5 ? KAT_REDC : BONE, 0.9);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(14 + i * 16, 16, 12, 12);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      tag(ctx, 20 + i * 16, 22, ['Q', 'W', 'E'][i], BONE, 0.9, 7.5);
    }
    hero(ctx, here.x, here.y, accent, Math.atan2(pts[k].y - here.y, pts[k].x - here.x));
    vignette(f);
  },
};

/**
 * DEATH LOTUS — stand still, for once.
 *
 * They close from three sides, she spins, and she does not move — the clip
 * prints the instruction while it happens, because it is the one moment in
 * her kit where the right thing to do with your hands is nothing.
 */
const katLotus: PreviewScene = {
  length: 3,
  poster: 0.62,
  caption: 'the spin you lose by moving',
  paint: (f) => {
    const { ctx, accent } = f;
    const t = f.t % 3;
    stage(f, 160, 96);
    const cx = 160;
    const cy = 96;
    const close = smooth(at(t, 0.1, 1));
    const r = lerp(90, 36, close);
    const alpha = at(t, 0, 0.2) * (1 - at(t, 2.75, 0.25));
    const spinning = t >= 1.1 && t < 2.6;
    const foes: Pt[] = [];
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i / 3) * TAU;
      foes.push({ x: cx + Math.cos(a) * r * 1.3, y: cy + Math.sin(a) * r });
    }
    if (spinning) {
      const s = (t - 1.1) / 1.5;
      ring(ctx, cx, cy, 66, rgba(KAT_PINK, 1), 0.4, 1.4, [5, 4]);
      for (let i = 0; i < 3; i++) {
        const k = (s * 9 + i / 3) % 1;
        const fx = foes[i];
        lance(ctx, lerp(cx, fx.x, k), lerp(cy, fx.y, k), Math.atan2(fx.y - cy, fx.x - cx), 12, KAT_PINK, 0.9 * alpha, 1.8);
      }
      tag(ctx, 12, 20, 'HANDS OFF', KAT_PINK, 0.95, 9, 'left');
    }
    for (const fx of foes) foe(ctx, fx.x, fx.y, 5.4, alpha);
    hero(ctx, cx, cy, accent, spinning ? t * 12 : -Math.PI / 2);
    vignette(f);
  },
};

/**
 * THE ENTRY — join a fight, not start one.
 *
 * The fight's health, draining while she waits outside it, and the word over
 * it changing from WAIT to GO. Then in, and the fight finishes itself around
 * her. The waiting is most of the clip because it is most of the skill.
 */
const katEntry: PreviewScene = {
  length: 3.8,
  poster: 0.74,
  caption: 'go in when it is ready',
  narrative: true,
  paint: (f) => {
    const { ctx, accent, t } = f;
    stage(f, 200, 96);
    const fight = { x: 222, y: 102 };
    const hp = lerp(1, 0.42, smooth(at(t, 0.1, 2.1)));
    const ready = hp <= 0.55;
    const goAt = 2.35;
    const inside = t >= goAt;
    const orbit = t * 1.6;
    const outside = { x: 86 + 10 * Math.cos(orbit), y: 110 + 12 * Math.sin(orbit) };
    const hx = inside ? fight.x - 8 : outside.x;
    const hy = inside ? fight.y + 6 : outside.y;

    const members: Pt[] = [
      { x: fight.x - 22, y: fight.y - 12 },
      { x: fight.x + 20, y: fight.y - 14 },
      { x: fight.x + 4, y: fight.y + 22 },
    ];
    ring(ctx, fight.x, fight.y, 44, rgba(ready ? GOOD : WARN, 1), ready ? 0.5 : 0.25, ready ? 1.8 : 1.1, [5, 4]);
    // The fight's health, as one bar over it.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(fight.x - 26, fight.y - 58, 52, 4);
    ctx.fillStyle = rgba(ready ? GOOD : WARN, 0.95);
    ctx.fillRect(fight.x - 26, fight.y - 58, 52 * hp, 4);
    ctx.restore();
    // Beside the bar rather than over it: above it is where the card's keys are.
    if (!inside) tag(ctx, fight.x - 32, fight.y - 56, ready ? 'GO' : 'WAIT', ready ? GOOD : WARN, 0.95, 10, 'right');

    if (inside) {
      blinkTrace(ctx, { x: 86, y: 110 }, { x: hx, y: hy }, at(t, goAt, 0.5));
      ring(ctx, hx, hy, 40, rgba(KAT_PINK, 1), 0.45 * (1 - at(t, 3.4, 0.4)), 1.4, [5, 4]);
    }
    for (let i = 0; i < 3; i++) {
      const dies = goAt + 0.35 + i * 0.3;
      const a = inside ? 1 - at(t, dies, 0.25) : 1;
      foe(ctx, members[i].x, members[i].y, 5.2, a);
      if (inside) burst(ctx, members[i].x, members[i].y, at(t, dies, 0.4), KAT_REDC, 22, 6);
    }
    hero(ctx, hx, hy, accent, Math.atan2(fight.y - hy, fight.x - hx));
    vignette(f);
  },
};

/**
 * THE SPIN — all of it, at once.
 *
 * She moves on a loop and a dagger comes down on the loop ahead of her each
 * second, landing exactly as she arrives. That is the whole of her drawn as a
 * picture: a route with the daggers already on it.
 */
const katFight: PreviewScene = {
  length: 3,
  poster: 0.3,
  caption: 'all of it, against people',
  paint: (f) => {
    const { ctx, accent } = f;
    const t = f.t % 3;
    const u = t / 3;
    stage(f, 140, 100);
    wall(ctx, 206, 8, 52);
    wall(ctx, 206, 134, 178);
    const cx = 144;
    const cy = 100;
    const path = (v: number): Pt => ({ x: cx + Math.cos(v * TAU) * 58, y: cy + Math.sin(v * TAU) * 34 });
    const me = path(u);
    const hunter = { x: 150 + 14 * Math.cos(u * TAU * 2), y: 96 + 10 * Math.sin(u * TAU * 2) };
    const duel = { x: 256, y: 128 + 8 * Math.sin(u * TAU) };
    for (let i = 0; i < 3; i++) minion(ctx, 176 + i * 9, 64 + i * 14, RED, 1 - i * 0.25, 0.7);

    // One dagger a second, dropped where she will be when it lands.
    const k = Math.floor(t);
    const tt = t - k;
    const next = path((k + 1) / 3);
    if (tt < 0.999) falling(ctx, next.x, next.y, tt);
    const here = path(k / 3);
    burst(ctx, here.x, here.y, at(tt, 0, 0.45), KAT_REDC, 40, 10);

    foe(ctx, hunter.x, hunter.y, 5.6, 1);
    foe(ctx, duel.x, duel.y, 5.6, 1);
    hero(ctx, me.x, me.y, accent, u * TAU + Math.PI / 2);
    vignette(f);
  },
};

/**
 * EVERY ACTIVITY, AND ITS CLIP.
 *
 * Total over `DrillId` on purpose, and that is the point of the type rather
 * than a detail of it: adding a mode to the catalogue without drawing it is a
 * compile error now, not a card that quietly renders an empty rectangle. The
 * menus ask for a clip by id and get one, always.
 */
export const PREVIEWS: Record<DrillId, PreviewScene> = {
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
  movement,
  aim,
  skillshot,
  dodge,
  spacing,
  kite,
  lasthit,
  targetswitch,
  combos,
  duel1v1,
  duel1v2,
  duel1v3,
  wasdMove,
  wasdIndep,
  wasdStrafe,
  wasdAimMove,
  wasdCadence,
  wasdKite,
  wasdOffKite,
  wasdDefKite,
  wasdMulti,
  ezQ,
  ezLead,
  ezStrafe,
  ezThread,
  ezWeave,
  ezMaxRange,
  ezKite,
  ezShift,
  ezSwitch,
  ezFight,
  tfPick,
  tfGold,
  tfWild,
  tfDeck,
  tfHold,
  tfPressure,
  tfCombo,
  tfGate,
  tfFight,
  katPrep,
  katBlade,
  katShunpo,
  katBlink,
  katDance,
  katReset,
  katLotus,
  katEntry,
  katFight,
};
