import { audio } from '../../engine/audio';
import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { Drill, band, count, pct, type DrillOutcome } from '../base';

/**
 * The WASD academy's shared engine.
 *
 * The trainer already had a scheme switch. What it did not have was anywhere
 * to *learn* the scheme, and the two are not the same thing: WASD is not
 * clicking with extra steps, it is a different pair of hands with a different
 * set of things that are possible and a different set of things that are
 * expensive. Nine modules teach that, in order, and every one of them is
 * measured by the numbers this file keeps.
 *
 * The four measurements every module shares:
 *
 *   movement uptime — how much of the run your feet were doing anything.
 *   cursor independence — how much of it your feet and your cursor disagreed.
 *   cursor economy — how far the mouse travelled per thing it actually did.
 *   direction irregularity — whether your changes are readable by an opponent.
 *
 * None of them is scored the same way in every module, because they should not
 * be: standing still is correct in module 5 and a mistake in module 4. Each
 * module decides what to do with them; the engine only guarantees they exist,
 * that they mean the same thing everywhere, and that they can never be moved
 * by an input that did not accomplish anything.
 */
export abstract class WasdDrill extends Drill {
  // ------------------------------------------------------------ shared state

  /** Seconds a direction key has been held. */
  protected movingTime = 0;
  /** Seconds the cursor and the held direction were more than 90° apart. */
  protected opposedTime = 0;
  /** Seconds with both a held direction and a cursor to disagree with. */
  protected steeredTime = 0;
  /** Distance the cursor has travelled, in arena units. */
  protected cursorTravel = 0;
  /** Of that, the part spent closing on something the module asked for. */
  protected usefulTravel = 0;
  /** Every change of heading, and the gaps between them. */
  protected dirChanges = 0;
  protected changeGaps: number[] = [];

  protected tasks = 0;
  protected solved = 0;
  protected missed = 0;
  protected reactions: number[] = [];

  protected chain = 0;
  protected bestChain = 0;
  protected scoreAcc = 0;

  private lastCursor: Vec2 | null = null;
  private lastDir: Vec2 | null = null;
  private lastChangeAt = 0;
  private dirCd = 0;

  // --------------------------------------------------------------- template

  /** Per-module simulation, after the engine's own bookkeeping. */
  protected abstract tickModule(dt: number): void;

  /** Per-module drawing. */
  protected paintModule(_out: DrillPaint, _t: number): void {}

  /** The module's own performance, 0..1. Half of the final number. */
  protected abstract quality(): number;

  /**
   * How much of the final number comes from the module rather than from the
   * shared movement discipline. A module that *is* movement discipline turns
   * this down; one that only happens to be played on the keys turns it up.
   */
  protected get moduleWeight(): number {
    return 0.7;
  }

  /** The shared half: whatever "using the scheme properly" means here. */
  protected discipline(): number {
    return this.moveUptime();
  }

  protected moduleField(): HudField | null {
    return null;
  }

  protected moduleMetrics(): KeyMetric[] {
    return [];
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return { movement: performance };
  }

  protected notes(): { helped: string[]; hurt: string[]; advice: string | null } {
    return { helped: [], hurt: [], advice: null };
  }

  /** The keys started moving, or turned. Modules that care override it. */
  protected onDirection(_dir: Vec2, _started: boolean): void {}

  // --------------------------------------------------------------- queries

  protected get d(): number {
    return this.s.config.difficulty;
  }

  protected get player(): Actor | undefined {
    return this.s.world.player;
  }

  /** Of the run so far, the share your feet were doing something. */
  moveUptime(): number {
    return clamp(this.movingTime / Math.max(0.5, this.s.elapsed), 0, 1);
  }

  /**
   * The share of steered time your hands were pointing different ways.
   *
   * This is the number the whole scheme exists for. Under a mouse it is
   * structurally zero — where you clicked *is* where you are looking — so a
   * player whose two hands always agree has bought the scheme and left it in
   * the box.
   */
  independence(): number {
    return clamp(this.opposedTime / Math.max(0.5, this.steeredTime), 0, 1);
  }

  /** Cursor distance per task answered. Lower is a hand that does not wander. */
  travelPerTask(): number {
    return this.solved > 0 ? this.cursorTravel / this.solved : 0;
  }

  /** Of everything the mouse did, the share of it that was going somewhere. */
  cursorEconomy(): number {
    return this.cursorTravel > 60 ? clamp(this.usefulTravel / this.cursorTravel, 0, 1) : 1;
  }

  /**
   * How unreadable your direction changes are, 0..1.
   *
   * A player who changes direction exactly every 0.4s is a metronome, and a
   * metronome is the easiest thing in the game to hit. The measurement is the
   * spread of the gaps between changes against their mean, which is high for a
   * human varying deliberately and near zero for one on a rhythm.
   */
  irregularity(): number {
    const g = this.changeGaps;
    if (g.length < 4) return 0;
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    if (mean <= 0.001) return 0;
    const variance = g.reduce((a, b) => a + (b - mean) * (b - mean), 0) / g.length;
    return clamp(Math.sqrt(variance) / mean / 0.65, 0, 1);
  }

  /** Changes of heading per second — the raw rate, before judging it. */
  changeRate(): number {
    return this.dirChanges / Math.max(1, this.s.elapsed);
  }

  // ----------------------------------------------------------------- verbs

  /**
   * The module got what it asked for.
   *
   * `counts` is for payouts that are not answers to a prompt — damage on a
   * target the drill already asked you to be on, say. They keep the chain and
   * the score honest without inflating the answered tally, which is a count of
   * things the drill asked for and got.
   */
  protected award(
    pos: Vec2,
    opts: { value?: number; quality?: number; label?: string; reaction?: number; counts?: boolean } = {},
  ): void {
    if (opts.counts !== false) this.solved++;
    this.chain++;
    this.bestChain = Math.max(this.bestChain, this.chain);
    const q = clamp(opts.quality ?? 0.6, 0, 1);
    this.scoreAcc += (opts.value ?? 100) * (0.6 + q * 0.8) * (1 + Math.min(this.chain, 20) * 0.03);
    if (opts.reaction !== undefined && Number.isFinite(opts.reaction)) {
      this.reactions.push(opts.reaction);
      this.s.metrics.noteReaction(opts.reaction);
    }
    const color = q > 0.8 ? PALETTE.good : PALETTE.accent;
    audio.play(q > 0.8 ? 'perfect' : 'pickup', { pan: this.s.panOf(pos) });
    this.s.fx.impact(pos, 0, color, 0.9 + q * 0.7);
    this.s.fx.ring(pos.x, pos.y, 8, 40 + q * 44, 0.3, color, 2, 'impact');
    if (opts.label) this.s.micro(opts.label, pos, color);
    this.s.chain = this.chain;
    this.s.chainBest = this.bestChain;
  }

  /** The module did not get it, and the chain pays. */
  protected penalize(pos: Vec2, label: string, cost = 60): void {
    this.missed++;
    const lost = this.chain;
    this.chain = 0;
    this.s.chain = 0;
    this.scoreAcc = Math.max(0, this.scoreAcc - cost);
    audio.play('flowBreak', { pan: this.s.panOf(pos) });
    this.s.fx.ring(pos.x, pos.y, 10, 84, 0.34, PALETTE.danger, 2.4, 'impact');
    this.s.micro(lost >= 8 ? `${label} · ${lost} LOST` : label, pos, PALETTE.danger);
  }

  /** A slip that is worth naming but not worth a broken chain. */
  protected nudge(pos: Vec2, label: string, cost = 25): void {
    this.scoreAcc = Math.max(0, this.scoreAcc - cost);
    this.chain = Math.max(0, this.chain - 2);
    this.s.chain = this.chain;
    audio.play('castRefuse', { intensity: 0.5, pan: this.s.panOf(pos) });
    this.s.micro(label, pos, PALETTE.textDim);
  }

  // ----------------------------------------------------------------- frame

  update(dt: number): void {
    const p = this.player;
    if (p) {
      const dir = p.moveDir;
      if (dir) this.movingTime += dt;

      // Cursor travel, and how much of it was aimed at anything.
      const c = this.s.cursorWorld;
      if (this.lastCursor) {
        const step = dist(this.lastCursor, c);
        // A frame's worth of jitter is not travel; a real sweep is.
        if (step > 0.5) this.cursorTravel += step;
      }
      this.lastCursor = { x: c.x, y: c.y };

      // The hands disagreeing. Only counted while there is a disagreement to
      // have: no keys down, no claim either way.
      if (dir) {
        const toCursor = { x: c.x - p.pos.x, y: c.y - p.pos.y };
        const m = Math.hypot(toCursor.x, toCursor.y);
        if (m > 40) {
          this.steeredTime += dt;
          const cos = (dir.x * toCursor.x + dir.y * toCursor.y) / m;
          if (cos < 0) this.opposedTime += dt;
        }
      }

      // Heading changes, rate-limited the same way the APM engine limits them
      // so a diagonal held between two keys does not read as a drum roll.
      this.dirCd = Math.max(0, this.dirCd - dt);
      const had = this.lastDir;
      this.lastDir = dir ? { x: dir.x, y: dir.y } : null;
      if (dir && this.dirCd <= 0) {
        const started = had === null;
        const turned = had !== null && had.x * dir.x + had.y * dir.y < 0.72;
        if (started || turned) {
          this.dirCd = 0.1;
          this.dirChanges++;
          if (this.lastChangeAt > 0) this.changeGaps.push(this.s.elapsed - this.lastChangeAt);
          this.lastChangeAt = this.s.elapsed;
          this.onDirection(dir, started);
        }
      }
    }
    this.tickModule(dt);
  }

  /** Marks cursor travel that was going somewhere, for the economy figure. */
  protected noteUsefulTravel(units: number): void {
    this.usefulTravel += Math.max(0, units);
  }

  // ----------------------------------------------------------------- paint

  paint(out: DrillPaint, t: number): void {
    this.paintModule(out, t);
  }

  /**
   * The attack cadence bar, over the champion's head.
   *
   * Every module from 05 on draws it, because it is the thing they are all
   * really about: the same key is ruinous in the red stretch and free in the
   * green one, and no amount of prose teaches that as fast as watching your
   * own attack die the third time you get it wrong.
   */
  protected paintCadence(out: DrillPaint, note?: string): void {
    const p = this.player;
    if (!p) return;
    const cycle = 1 / Math.max(0.05, p.attack.attackSpeed);
    const head = clamp(1 - p.attackCd / cycle, 0, 1);
    out.billboards.push({
      kind: 'cadence',
      x: p.pos.x,
      y: p.pos.y,
      windup: p.attack.windupRatio,
      backswing: p.attack.backswingRatio,
      head,
      phase:
        p.phase === 'windup'
          ? 'windup'
          : p.phase === 'backswing'
            ? 'backswing'
            : p.attackCd > 0.02
              ? 'idle'
              : 'ready',
      moving: p.moveDir !== null,
      note,
    });
  }

  // ------------------------------------------------------------------- hud

  hudFields(): HudField[] {
    const up = this.moveUptime();
    const mid = this.moduleField();
    const move: HudField = {
      label: 'MOVEMENT',
      value: `${Math.round(up * 100)}%`,
      bar: up,
      tone: up > 0.7 ? 'good' : up > 0.4 ? 'warn' : 'bad',
    };
    const answered = this.tasks > 0 ? this.solved / this.tasks : 0;
    return [
      move,
      ...(mid ? [mid] : []),
      {
        label: 'ANSWERED',
        value: this.tasks > 0 ? `${this.solved} / ${this.tasks}` : '—',
        bar: answered,
        tone: answered > 0.85 ? 'good' : answered > 0.6 ? 'warn' : 'bad',
      },
      {
        label: 'CHAIN',
        value: `${this.chain}`,
        bar: clamp(this.chain / 20, 0, 1),
        tone: this.chain >= 10 ? 'good' : this.chain >= 4 ? 'warn' : 'neutral',
      },
    ];
  }

  liveScore(): number {
    return Math.max(0, Math.round(this.scoreAcc));
  }

  // --------------------------------------------------------------- outcome

  outcome(): DrillOutcome {
    const q = clamp(this.quality(), 0, 1);
    const disc = clamp(this.discipline(), 0, 1);
    const w = this.moduleWeight;
    const performance = clamp(q * w + disc * (1 - w), 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    const m = this.s.metrics.m;

    if (this.moveUptime() > 0.75) helped.push('Your feet were doing something for three quarters of the run.');
    if (this.independence() > 0.45)
      helped.push(`Cursor and feet disagreed ${Math.round(this.independence() * 100)}% of the time you were moving — that is the scheme working.`);
    if (this.bestChain >= 12) helped.push(`A ${this.bestChain}-long chain without a mistake.`);
    if (this.moveUptime() < 0.4)
      hurt.push('You stood still for most of the run. Under WASD nothing is happening while your hand is off the keys.');
    if (m.windupBreaks > 4)
      hurt.push(`${m.windupBreaks} attacks were thrown away by taking a direction during the windup.`);
    if (m.heldFire > 1.2)
      hurt.push(`${m.heldFire.toFixed(1)}s of loaded shots held back by a key that was still down.`);

    const own = this.notes();
    const advice =
      own.advice ??
      (this.moveUptime() < 0.45
        ? 'Keep a key down. The default state of this scheme is moving, and standing is the thing you do on purpose.'
        : m.windupBreaks > 4
          ? 'Watch the red stretch on the cadence bar. A key going down there costs the whole attack; a fifth of a second later it costs nothing.'
          : q < 0.55
            ? 'The module itself is what is short here, not your hands. Read what it is asking for and slow down until it is right.'
            : 'Take the next module. This one has told you what it can.');

    return {
      score: this.liveScore(),
      performance,
      axisPerformance: this.axisSplit(performance),
      keyMetrics: [
        ...this.moduleMetrics().slice(0, 2),
        pct('moveUptime', 'MOVEMENT UPTIME', this.moveUptime()),
        pct('independence', 'HANDS OPPOSED', this.independence()),
        count('chainBest', 'BEST CHAIN', this.bestChain),
        ...this.moduleMetrics().slice(2),
      ],
      helped: [...helped, ...own.helped],
      hurt: [...hurt, ...own.hurt],
      advice,
    };
  }
}

/** Maps a value onto 0..1 where `good` scores 1 and `bad` scores 0. */
export { band };

/**
 * `band`, for a measurement that might not have happened.
 *
 * Every "lower is better" figure in this folder starts at zero, and zero is
 * usually the best possible value — nought milliseconds of delay, nought
 * wasted units of travel. So a run in which nothing happened at all would
 * score full marks on all of them, and an idle run would come out looking
 * like a careful one. Anything measured from a sample therefore has to say
 * how many samples it has, and score nothing when the answer is none.
 */
export const bandIf = (samples: number, value: number, bad: number, good: number): number =>
  samples > 0 ? band(value, bad, good) : 0;

/** A body that exists to be shot at rather than to fight back. */
export const DUMMY_ATTACK = {
  attackSpeed: 0.01,
  windupRatio: 0.3,
  backswingRatio: 0.3,
  range: 0,
  damage: 0,
  projectileSpeed: 0,
} as const;
