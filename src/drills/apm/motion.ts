import { clamp } from '../../engine/math';
import type { Rng } from '../../engine/rng';
import type { Vec2 } from '../../engine/types';
import type { Pad } from './lab';

/**
 * MOTION — why nothing on the bench stands still any more.
 *
 * The lab was, for its whole life, a console of pads bolted to the floor. That
 * made it an honest measurement and a slightly dishonest one at the same time:
 * a key you press is a key you press wherever its pad is, but *finding* the
 * pad is half of every real command, and a target that never moves lets your
 * eyes stop working entirely after about ten seconds. Which is the one thing
 * League never lets them do.
 *
 * So every pad in every mode now travels. What that buys is different in the
 * two halves of the lab and both are worth having:
 *
 *   - In a keyboard mode the movement is a *reading* load. The press is no
 *     harder; locating which of six drifting circles is lit, while your hands
 *     are already busy, is. That is the exact load a teamfight puts on you.
 *   - In a mouse mode the movement is the mode. A click into a moving pad is
 *     tracking, and tracking is the ceiling on every command that starts with
 *     the cursor being somewhere.
 *
 * Two ways of moving, because the bench and the field want different things.
 * A `wander` pad swims around the spot it was built at, so a row still reads
 * as a row and a ring still reads as a ring — the formation survives, and only
 * the pads inside it breathe. A `free` pad has a heading and bounces off the
 * arena, which is what a target you have to chase actually does.
 *
 * Everything scales off two numbers handed in each frame: how fast the field
 * runs and how far it swings. The drill reads those from its difficulty and
 * its own flow, so the arena speeds up under a player who is doing well and
 * settles again when they break — the same self-pacing every other part of
 * the engine is built on.
 */
export type Drift = 'wander' | 'free';

/** How the field is being driven this frame. */
export interface MotionDrive {
  /** Multiplies the rate everything travels at. 1 is the calm middle. */
  speed: number;
  /** 0..1 — how far a wandering pad swings from home. */
  spread: number;
}

interface Track {
  pad: Pad;
  home: Vec2;
  drift: Drift;
  /** Lissajous frequencies and phases, so no two pads share an orbit. */
  fx: number;
  fy: number;
  px: number;
  py: number;
  /** Per-axis amplitude, so the orbits are ellipses at assorted angles. */
  ax: number;
  ay: number;
  /** Heading, for a free pad. Unit length; the drive supplies the speed. */
  vx: number;
  vy: number;
}

/** How far a wandering pad can be from home, as a multiple of its radius. */
const SWING = 2.6;
/** Units a second a free pad travels at full drive. */
const FREE_SPEED = 210;

export class PadMotion {
  private tracks: Track[] = [];
  /**
   * The field's own clock, advanced by the drive rather than by the frame.
   *
   * Integrating the speed instead of multiplying by it is what lets a mode
   * change pace mid-run without every pad jumping: the phase is continuous
   * through the change, so a bench that speeds up looks like a bench that sped
   * up rather than like a bench that was re-dealt.
   */
  private t = 0;

  constructor(
    private readonly bounds: { w: number; h: number },
    private readonly rng: Rng,
  ) {}

  /** Puts a pad into the field. Returns it, so calls can be chained inline. */
  add(pad: Pad, drift: Drift = 'wander'): Pad {
    const a = this.rng.angle();
    this.tracks.push({
      pad,
      home: { x: pad.pos.x, y: pad.pos.y },
      drift,
      fx: this.rng.range(0.5, 1.15),
      fy: this.rng.range(0.5, 1.15),
      px: this.rng.angle(),
      py: this.rng.angle(),
      ax: this.rng.range(0.72, 1.28),
      ay: this.rng.range(0.55, 1.05),
      vx: Math.cos(a),
      vy: Math.sin(a),
    });
    return pad;
  }

  addAll(pads: readonly Pad[], drift: Drift = 'wander'): Pad[] {
    for (const p of pads) this.add(p, drift);
    return [...pads];
  }

  /** Takes a pad back out — a mode that deals and discards has to say so. */
  forget(pad: Pad): void {
    const i = this.tracks.findIndex((t) => t.pad === pad);
    if (i >= 0) this.tracks.splice(i, 1);
  }

  /** Moves a pad's anchor, for a mode that re-deals in place. */
  rehome(pad: Pad): void {
    const t = this.tracks.find((x) => x.pad === pad);
    if (t) t.home = { x: pad.pos.x, y: pad.pos.y };
  }

  step(dt: number, drive: MotionDrive): void {
    if (!this.tracks.length) return;
    const speed = Math.max(0, drive.speed);
    const spread = clamp(drive.spread, 0, 1);
    this.t += dt * speed;
    for (const tr of this.tracks) {
      if (tr.drift === 'wander') this.wander(tr, spread);
      else this.free(tr, dt * speed);
      this.contain(tr);
    }
    this.separate();
  }

  private wander(tr: Track, spread: number): void {
    const amp = tr.pad.radius * SWING * (0.22 + spread * 0.78);
    // Two terms per axis: one slow sweep and one small wobble on top of it, so
    // the path never settles into a circle the eye can predict and pre-aim.
    tr.pad.pos.x =
      tr.home.x +
      Math.sin(this.t * tr.fx + tr.px) * amp * tr.ax +
      Math.sin(this.t * tr.fx * 2.31 + tr.py) * amp * 0.22;
    tr.pad.pos.y =
      tr.home.y +
      Math.cos(this.t * tr.fy + tr.py) * amp * tr.ay * 0.72 +
      Math.cos(this.t * tr.fy * 1.87 + tr.px) * amp * 0.16;
  }

  private free(tr: Track, step: number): void {
    tr.pad.pos.x += tr.vx * FREE_SPEED * step;
    tr.pad.pos.y += tr.vy * FREE_SPEED * step;
    const m = tr.pad.radius + 70;
    if (tr.pad.pos.x < m && tr.vx < 0) tr.vx = -tr.vx;
    if (tr.pad.pos.x > this.bounds.w - m && tr.vx > 0) tr.vx = -tr.vx;
    if (tr.pad.pos.y < m && tr.vy < 0) tr.vy = -tr.vy;
    if (tr.pad.pos.y > this.bounds.h - m && tr.vy > 0) tr.vy = -tr.vy;
  }

  /** Nothing leaves the floor. A pad you cannot reach is not a target. */
  private contain(tr: Track): void {
    const m = tr.pad.radius + 60;
    tr.pad.pos.x = clamp(tr.pad.pos.x, m, this.bounds.w - m);
    tr.pad.pos.y = clamp(tr.pad.pos.y, m, this.bounds.h - m);
  }

  /**
   * Pads push each other apart.
   *
   * Two circles that overlap are one shape with two glyphs in it, and a mode
   * whose prompt is "the lit one" cannot afford that for even a frame. The
   * shove is positional and does not touch either pad's home, so the formation
   * still pulls itself back together on its own.
   */
  private separate(): void {
    for (let i = 0; i < this.tracks.length; i++) {
      for (let j = i + 1; j < this.tracks.length; j++) {
        const a = this.tracks[i].pad;
        const b = this.tracks[j].pad;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const want = a.radius + b.radius + 18;
        const d = Math.hypot(dx, dy);
        if (d >= want || d < 0.0001) continue;
        const push = (want - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
      }
    }
  }
}
