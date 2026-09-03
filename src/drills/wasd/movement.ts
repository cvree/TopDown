import { audio } from '../../engine/audio';
import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Vec2, Wall } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct, units } from '../base';
import { WasdDrill, band, bandIf } from './engine';

type Phase = 'cardinal' | 'diagonal' | 'snap' | 'weave' | 'blind';

interface PhaseDef {
  kind: Phase;
  name: string;
  brief: string;
  share: number;
}

/**
 * The five things the four keys have to be able to do, in the order they get
 * hard. Each one runs for a share of the drill's clock rather than a fixed
 * number of seconds, so a longer run is a longer course rather than a longer
 * final phase.
 */
const PHASES: PhaseDef[] = [
  { kind: 'cardinal', name: 'CARDINALS', brief: 'One key at a time. Stop dead in the node.', share: 0.18 },
  { kind: 'diagonal', name: 'DIAGONALS', brief: 'Two keys together, and released together.', share: 0.18 },
  { kind: 'snap', name: 'SNAP', brief: 'Reverse on the light. No drift, no coasting.', share: 0.2 },
  { kind: 'weave', name: 'TERRAIN', brief: 'The node is behind the rock. Go around it, not into it.', share: 0.22 },
  { kind: 'blind', name: 'INSTRUMENTS', brief: 'Read the panel, not your champion.', share: 0.22 },
];

const DIR_NAMES = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const DIR_GLYPH = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];

interface Node {
  pos: Vec2;
  radius: number;
  litAt: number;
  /** Where the champion stood when it lit, for the path measurement. */
  from: Vec2;
  /** Distance actually walked since it lit. */
  walked: number;
  answered: boolean;
}

/**
 * WASD 01 — MOVEMENT.
 *
 * The first thing anybody discovers about direct control is that arriving is
 * easy and *stopping* is not. A click has a destination baked into it; a held
 * key has none, so the last twenty units of every movement are a decision the
 * click scheme never asked you to make. That is what this module is mostly
 * about, and it is why every node here has to be stopped inside rather than
 * passed through.
 *
 * The five phases are the five distinct motor skills, and they are separated
 * because they fail separately: someone who is fine on cardinals and hopeless
 * on diagonals has a specific problem — they are releasing one key before the
 * other — and a drill that mixes the two would report "movement: 61%" and
 * teach them nothing.
 */
export class WasdMovementDrill extends WasdDrill {
  protected get moduleWeight(): number {
    return 0.85;
  }

  private node: Node | null = null;
  private phaseIndex = 0;
  private phaseEnd = 0;

  /** Stop precision: how far from the centre you actually came to rest. */
  private stopErrors: number[] = [];
  private pathRatios: number[] = [];
  private overshoots = 0;
  private settleFor = 0;
  private lastPos: Vec2 | null = null;
  private snapSide = 1;

  // --- the instrument phase --------------------------------------------
  private call: { dir: number; hold: number; startedAt: number; from: Vec2 } | null = null;
  private callsMade = 0;
  private callsGood = 0;
  private headingErrors: number[] = [];

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.5 });
    // Terrain from the start rather than conjured for one phase: a rock that
    // appears halfway through a run is a bug, not a lesson.
    const walls: Wall[] = [
      { x: w * 0.28, y: h * 0.32, w: 190, h: 150 },
      { x: w * 0.72, y: h * 0.3, w: 150, h: 210 },
      { x: w * 0.5, y: h * 0.72, w: 300, h: 130 },
      { x: w * 0.16, y: h * 0.74, w: 130, h: 130 },
      { x: w * 0.86, y: h * 0.7, w: 160, h: 140 },
    ];
    this.s.world.walls = walls;
    this.phaseEnd = this.s.config.duration * PHASES[0].share;
  }

  onStart(): void {
    this.s.setBanner(`${PHASES[0].name} · ${PHASES[0].brief}`, 2.6);
    this.lightNode();
  }

  private get phase(): PhaseDef {
    return PHASES[Math.min(this.phaseIndex, PHASES.length - 1)];
  }

  private advancePhase(): void {
    if (this.phaseIndex >= PHASES.length - 1) return;
    this.phaseIndex++;
    const p = this.phase;
    let acc = 0;
    for (let i = 0; i <= this.phaseIndex; i++) acc += PHASES[i].share;
    this.phaseEnd = this.s.config.duration * acc;
    this.s.setBanner(`${p.name} · ${p.brief}`, 2.4);
    audio.play('flowTier', { intensity: 0.7 });
    this.node = null;
    this.call = null;
    if (p.kind !== 'blind') this.lightNode();
  }

  // ------------------------------------------------------------------ nodes

  /** How far the next node sits, tightening as the difficulty rises. */
  private hop(): number {
    return 230 + (1 - this.d) * 130;
  }

  private lightNode(): void {
    const p = this.player;
    if (!p) return;
    const { w, h } = this.s.world.bounds;
    const margin = 110;
    const kind = this.phase.kind;
    let pos: Vec2 | null = null;

    for (let attempt = 0; attempt < 60 && !pos; attempt++) {
      let angle: number;
      let reach = this.hop();
      if (kind === 'cardinal') {
        angle = (Math.PI / 2) * this.s.rng.int(0, 4);
      } else if (kind === 'diagonal') {
        angle = Math.PI / 4 + (Math.PI / 2) * this.s.rng.int(0, 4);
      } else if (kind === 'snap') {
        // Two points, alternating. The whole task is the reversal, so the
        // distance is short and the direction is always the opposite one.
        this.snapSide *= -1;
        angle = this.s.rng.next() * Math.PI * 2;
        reach = 190 + (1 - this.d) * 90;
        const base = this.node ? Math.atan2(this.node.pos.y - p.pos.y, this.node.pos.x - p.pos.x) : angle;
        angle = base + Math.PI + this.s.rng.range(-0.5, 0.5);
      } else {
        angle = this.s.rng.next() * Math.PI * 2;
        reach = 300 + this.s.rng.next() * 220;
      }
      const c = {
        x: clamp(p.pos.x + Math.cos(angle) * reach, margin, w - margin),
        y: clamp(p.pos.y + Math.sin(angle) * reach, margin, h - margin),
      };
      // Never inside a rock, and in the terrain phase deliberately behind one.
      if (this.insideWall(c)) continue;
      if (kind === 'weave' && !this.blocked(p.pos, c)) continue;
      if (kind !== 'weave' && this.blocked(p.pos, c)) continue;
      pos = c;
    }
    if (!pos) pos = { x: w * 0.5, y: h * 0.5 };

    this.tasks++;
    this.node = {
      pos,
      // Precision tightens with difficulty: at the top the node is barely
      // wider than the champion, so "close enough" stops being enough.
      radius: 62 - this.d * 26,
      litAt: this.s.elapsed,
      from: { x: p.pos.x, y: p.pos.y },
      walked: 0,
      answered: false,
    };
    this.settleFor = 0;
    audio.play('tick', { intensity: 0.7 });
  }

  private insideWall(p: Vec2): boolean {
    return this.s.world.walls.some(
      (wl) => Math.abs(p.x - wl.x) < wl.w / 2 + 70 && Math.abs(p.y - wl.y) < wl.h / 2 + 70,
    );
  }

  /** Whether terrain stands between two points. */
  private blocked(a: Vec2, b: Vec2): boolean {
    const d = { x: b.x - a.x, y: b.y - a.y };
    const len = Math.hypot(d.x, d.y) || 1;
    const hit = this.s.world.walls.length
      ? this.s.world.terrainAlong(a, d, len, 26)
      : { hit: false, distance: len, at: b };
    return hit.hit && hit.distance < len - 20;
  }

  // ------------------------------------------------------------- instruments

  private newCall(): void {
    const p = this.player;
    if (!p) return;
    this.tasks++;
    this.callsMade++;
    this.call = {
      dir: this.s.rng.int(0, 8),
      hold: this.s.rng.range(0.8, 1.7),
      startedAt: this.s.elapsed,
      from: { x: p.pos.x, y: p.pos.y },
    };
    audio.play('tick', { intensity: 0.9 });
  }

  private resolveCall(): void {
    const c = this.call;
    const p = this.player;
    this.call = null;
    if (!c || !p) return;
    const want = (c.dir * Math.PI) / 4;
    const moved = { x: p.pos.x - c.from.x, y: p.pos.y - c.from.y };
    const len = Math.hypot(moved.x, moved.y);
    if (len < 60) {
      this.penalize(p.pos, 'NO ANSWER', 70);
      this.headingErrors.push(180);
      return;
    }
    const got = Math.atan2(moved.y, moved.x);
    let err = Math.abs(((got - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    err = (err * 180) / Math.PI;
    this.headingErrors.push(err);
    // Half a sector — a heading nobody could confuse with its neighbour.
    if (err <= 22.5) {
      this.callsGood++;
      const q = clamp(1 - err / 22.5, 0, 1);
      this.award(p.pos, { value: 130, quality: q, label: q > 0.75 ? 'ON HEADING' : DIR_NAMES[c.dir] });
    } else {
      this.penalize(p.pos, `${Math.round(err)}° OFF`, 60);
    }
  }

  // ------------------------------------------------------------------ frame

  protected tickModule(dt: number): void {
    const p = this.player;
    if (!p) return;

    if (this.lastPos) {
      const step = dist(this.lastPos, p.pos);
      if (this.node) this.node.walked += step;
    }
    this.lastPos = { x: p.pos.x, y: p.pos.y };

    if (this.s.elapsed >= this.phaseEnd) this.advancePhase();

    if (this.phase.kind === 'blind') {
      if (!this.call) {
        if (this.s.elapsed - (this.lastCallEnd ?? 0) > 0.45) this.newCall();
      } else if (this.s.elapsed - this.call.startedAt >= this.call.hold) {
        this.resolveCall();
        this.lastCallEnd = this.s.elapsed;
      }
      return;
    }

    const n = this.node;
    if (!n) {
      this.lightNode();
      return;
    }

    const d = dist(p.pos, n.pos);
    const speed = Math.hypot(p.vel.x, p.vel.y);
    const stopped = p.moveDir === null && speed < 12;

    // Passing straight through it is the mistake this module is built around.
    if (d < n.radius && !stopped) {
      n.answered = true;
    } else if (n.answered && d > n.radius * 1.7 && !stopped) {
      n.answered = false;
      this.overshoots++;
      this.nudge(p.pos, 'OVERSHOT', 30);
    }

    if (d < n.radius * 1.35 && stopped) {
      this.settleFor += dt;
      // A quarter of a second at rest: long enough that coasting to a halt
      // does not count, short enough that it is not a separate skill.
      if (this.settleFor >= 0.22) this.completeNode(d);
      return;
    }
    this.settleFor = 0;
  }

  private lastCallEnd: number | null = null;

  private completeNode(finalDist: number): void {
    const n = this.node;
    const p = this.player;
    if (!n || !p) return;
    const ideal = Math.max(1, dist(n.from, n.pos));
    const ratio = clamp(ideal / Math.max(ideal, n.walked), 0, 1);
    this.pathRatios.push(ratio);
    this.stopErrors.push(finalDist);
    const react = (this.s.elapsed - n.litAt) * 1000;

    // Two things are graded and they are graded separately: how straight the
    // line was, and how exactly it ended.
    const precision = band(finalDist, n.radius * 1.3, 8);
    const q = clamp(precision * 0.6 + ratio * 0.4, 0, 1);
    this.award(n.pos, {
      value: 120,
      quality: q,
      reaction: react,
      label: finalDist < 14 ? 'DEAD CENTRE' : undefined,
    });
    this.node = null;
    this.lightNode();
  }

  // ------------------------------------------------------------------ paint

  protected paintModule(out: DrillPaint, t: number): void {
    const p = this.player;
    const n = this.node;
    if (n && p) {
      out.markers.push({
        kind: 'ring',
        x: n.pos.x,
        y: n.pos.y,
        radius: n.radius,
        color: PALETTE.accent,
        alpha: 0.85,
        width: 3,
        fill: 0.12,
        dash: 26,
        spin: 0.5,
        rise: 0.8,
      });
      // The centre, drawn small, because "inside the ring" is not the target —
      // the middle of it is.
      out.markers.push({
        kind: 'cross',
        x: n.pos.x,
        y: n.pos.y,
        radius: 16,
        color: PALETTE.good,
        alpha: 0.7,
        width: 2,
        rise: 0.9,
      });
      // The straight line you were offered, so a curved path is visibly a
      // choice rather than an accident.
      out.markers.push({
        kind: 'line',
        x: n.from.x,
        y: n.from.y,
        x2: n.pos.x,
        y2: n.pos.y,
        halfWidth: 2,
        color: PALETTE.accentDim,
        alpha: 0.28,
        rise: 0.4,
      });
    }

    const c = this.call;
    if (c && p) {
      const { w, h } = this.s.world.bounds;
      // The instrument panel: deliberately nowhere near the champion, because
      // the entire point of the phase is that your eyes are not on them.
      const px = w * 0.5;
      const py = h * 0.12;
      const left = clamp(1 - (this.s.elapsed - c.startedAt) / c.hold, 0, 1);
      out.billboards.push({
        kind: 'label',
        x: px,
        y: py,
        text: `${DIR_GLYPH[c.dir]}  ${DIR_NAMES[c.dir]}`,
        color: PALETTE.warn,
        size: 34,
        sub: 'HOLD THIS HEADING · EYES HERE',
      });
      out.billboards.push({
        kind: 'timerBar',
        x: px,
        y: py,
        progress: left,
        color: left > 0.35 ? PALETTE.warn : PALETTE.danger,
        width: 150,
        lift: 40,
      });
      void t;
    }
  }

  // -------------------------------------------------------------------- hud

  protected moduleField(): HudField {
    const err = this.stopError();
    return {
      label: this.phase.name,
      value: this.phase.kind === 'blind' ? `${this.callsGood} / ${this.callsMade}` : `${Math.round(err)}u OFF`,
      bar:
        this.phase.kind === 'blind'
          ? this.callsMade
            ? this.callsGood / this.callsMade
            : 0
          : bandIf(this.stopErrors.length, err, 60, 8),
      tone: this.phase.kind === 'blind' ? 'neutral' : err < 20 ? 'good' : err < 38 ? 'warn' : 'bad',
    };
  }

  private stopError(): number {
    if (!this.stopErrors.length) return 0;
    return this.stopErrors.reduce((a, b) => a + b, 0) / this.stopErrors.length;
  }

  private pathEfficiency(): number {
    if (!this.pathRatios.length) return 0;
    return this.pathRatios.reduce((a, b) => a + b, 0) / this.pathRatios.length;
  }

  private headingError(): number {
    if (!this.headingErrors.length) return 0;
    return this.headingErrors.reduce((a, b) => a + b, 0) / this.headingErrors.length;
  }

  private blindRate(): number {
    return this.callsMade ? this.callsGood / this.callsMade : 0;
  }

  protected quality(): number {
    // Every one of these is nothing when there is nothing behind it: a run
    // that never reached a node has not got perfect stop precision, it has
    // no stop precision at all.
    const precision = bandIf(this.stopErrors.length, this.stopError(), 64, 10);
    const path = this.pathEfficiency();
    const answered = this.tasks > 0 ? clamp(this.solved / this.tasks, 0, 1) : 0;
    const blind = this.callsMade > 2 ? this.blindRate() : answered;
    const drift = bandIf(this.solved, this.overshoots / Math.max(4, this.solved), 0.5, 0);
    return clamp(precision * 0.34 + path * 0.24 + answered * 0.18 + blind * 0.14 + drift * 0.1, 0, 1);
  }

  protected discipline(): number {
    // Standing still is *correct* here every time a node is reached, so raw
    // uptime would be the wrong stick. What matters is that the champion was
    // moving whenever there was somewhere to be.
    return clamp(this.moveUptime() / 0.7, 0, 1);
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return { movement: performance };
  }

  protected moduleMetrics(): KeyMetric[] {
    return [
      units('stopError', 'STOP PRECISION', this.stopError()),
      pct('pathEff', 'PATH EFFICIENCY', this.pathEfficiency()),
      pct('blind', 'HEADINGS ON INSTRUMENTS', this.blindRate()),
      units('heading', 'HEADING ERROR', this.headingError()),
      count('overshoot', 'NODES OVERSHOT', this.overshoots, 'lower'),
      ms('nodeReact', 'REACTION TO A NODE', this.reactions.length ? this.reactions.reduce((a, b) => a + b, 0) / this.reactions.length : 0),
    ];
  }

  protected notes() {
    const err = this.stopError();
    return {
      helped: err > 0 && err < 18 ? ['You are stopping on the mark, not near it.'] : [],
      hurt:
        this.overshoots > 4
          ? [`${this.overshoots} nodes were passed and reversed into — release earlier, you carry further than you think.`]
          : [],
      advice:
        err > 40
          ? 'Let go before you arrive. Under WASD the release is the destination, and it is always about a body-length early.'
          : this.pathEfficiency() < 0.72
            ? 'You are arriving in two motions. Pick the diagonal first and hold it, rather than going across and then down.'
            : this.blindRate() > 0 && this.blindRate() < 0.6
              ? 'On the instrument phase your eyes belong on the panel. If you are checking your champion, you are not learning the thing this phase teaches.'
              : null,
    };
  }
}
