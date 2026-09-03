import { audio } from '../../engine/audio';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { Drill, band, count, pct, type DrillOutcome } from '../base';

/**
 * The APM trainer's shared engine.
 *
 * Every mode in this folder measures the same thing — how many *correct*
 * commands your hands issue per minute — and every mode has to feel the same
 * way while doing it. That feel is not decoration: it is the mode's read-out.
 * The chain climbs, the flow tier steps up, the pitch of every confirmation
 * rises with it, the arena bed swells, a metronome appears once you are in
 * rhythm and speeds up as you do. When you break, all of it falls away at
 * once. You should be able to tell how the run is going with your eyes shut.
 *
 * The other half of the design is that speed alone must never score. Every
 * mode routes its inputs through exactly three verbs here:
 *
 *   hit()    — the right command, on time. Pays out, scaled by the multiplier.
 *   fumble() — the wrong command, or one that arrived too late. Breaks flow.
 *   stray()  — an input that meant nothing. Costs efficiency, not the chain.
 *
 * so "actions per minute" can never drift away from "actions that mattered".
 */

export interface FlowTier {
  name: string;
  /** Chain length at which the tier is entered. */
  at: number;
  mult: number;
  color: string;
}

/**
 * The ladder. The gaps widen on purpose: the first step is nearly free and
 * arrives inside the first few seconds, the last one is a run you remember.
 */
export const FLOW_TIERS: FlowTier[] = [
  { name: 'WARMING UP', at: 0, mult: 1, color: PALETTE.textDim },
  { name: 'IN RHYTHM', at: 5, mult: 1.35, color: PALETTE.accent },
  { name: 'HOT HANDS', at: 13, mult: 1.8, color: PALETTE.good },
  { name: 'BLAZING', at: 25, mult: 2.4, color: PALETTE.warn },
  { name: 'TRANSCENDENT', at: 42, mult: 3.2, color: PALETTE.violet },
];

/** Seconds of history the live APM readout averages over. */
const APM_WINDOW = 6;

export interface HitOpts {
  /** 0..1 — how early inside the task's window this landed. 1 is instant. */
  quality?: number;
  /** Base points before the flow multiplier. */
  value?: number;
  /** Floating text, if the default should be replaced. */
  label?: string;
  /** Milliseconds from the task appearing to the input landing. */
  reaction?: number;
  /** Colour override for the confirmation. */
  color?: string;
  /**
   * Whether this hit *was* the input. Modes where the reward arrives as an
   * outcome — walking over a charge, an attack landing — pass false and count
   * the command that caused it instead, so APM stays a count of inputs.
   */
  action?: boolean;
}

export abstract class ApmDrill extends Drill {
  /** The APM this mode is calibrated against — a strong run's sustained rate. */
  protected abstract readonly targetApm: number;

  /** Timestamps, in run seconds, of every counted action. */
  private stamps: number[] = [];

  protected hits = 0;
  protected fumbles = 0;
  protected expiries = 0;
  protected strays = 0;
  protected perfects = 0;
  protected reactions: number[] = [];

  /** The engine owns the chain; the session's copy is a mirror of this one. */
  protected chain = 0;
  protected bestChain = 0;
  protected heat = 0;
  protected tier = 0;
  protected peakTier = 0;
  protected scoreAcc = 0;

  private peakApm = 0;
  private beatCd = 0;
  private lastActionAt = 0;
  private sampleCd = 0;
  private lastMove: { x: number; y: number; t: number } | null = null;

  // ------------------------------------------------------------- template

  /** Per-mode simulation. Called after the engine's own bookkeeping. */
  protected abstract tick(dt: number): void;

  /** Per-mode drawing. The flow ring and tier badge are drawn for you. */
  protected paintMode(_out: DrillPaint, _t: number): void {}

  /** The middle HUD field. Modes that measure something specific override it. */
  protected modeField(): HudField | null {
    return null;
  }

  /** Extra metrics for the results screen, ahead of the shared APM block. */
  protected modeMetrics(): KeyMetric[] {
    return [];
  }

  /** How the run's performance is split across the axes the mode trains. */
  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return { tempo: clamp(performance * 0.7 + speed * 0.3, 0, 1), aim: accuracy };
  }

  /** Mode-specific coaching, merged with the engine's own. */
  protected notes(): { helped: string[]; hurt: string[]; advice: string | null } {
    return { helped: [], hurt: [], advice: null };
  }

  // ---------------------------------------------------------------- state

  protected get d(): number {
    return this.s.config.difficulty;
  }

  /**
   * The speed multiplier the modes pace themselves with.
   *
   * It reads your own flow, not a clock, which is the whole trick: the drill
   * always sits just past the edge of what you are currently doing, so it is
   * never boring at the bottom and never unreachable at the top.
   */
  protected get tempo(): number {
    return 0.8 + this.d * 0.55 + this.heat * 0.75;
  }

  protected get flow(): FlowTier {
    return FLOW_TIERS[this.tier];
  }

  protected get multiplier(): number {
    return this.flow.mult;
  }

  /** Actions per minute over the trailing window, warm-up-corrected. */
  liveApm(): number {
    const t = this.s.elapsed;
    const span = Math.min(APM_WINDOW, Math.max(0.75, t));
    let n = 0;
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      if (t - this.stamps[i] > span) break;
      n++;
    }
    return (n / span) * 60;
  }

  averageApm(): number {
    return this.s.elapsed > 0.5 ? (this.stamps.length / this.s.elapsed) * 60 : 0;
  }

  /**
   * Correct actions per minute — the number the score is actually built on.
   *
   * The raw rate is what your hands did; this is what your hands did that the
   * drill asked for. It is the whole reason the trainer can call itself an APM
   * trainer without becoming a click-speed test: mashing raises the raw rate
   * and leaves this one exactly where it was.
   */
  correctPerMinute(): number {
    return this.s.elapsed > 0.5 ? (this.hits / this.s.elapsed) * 60 : 0;
  }

  /**
   * The correct-action rate a strong run holds. Defaults to three quarters of
   * the raw target — in a mode where the click *is* the action, a good player
   * wastes about a quarter of their inputs — and modes whose payoff arrives
   * more slowly than their commands override it.
   */
  protected get targetRate(): number {
    return this.targetApm * 0.75;
  }

  /**
   * Of everything that happened, how much of it was you doing the right thing.
   *
   * Expired prompts count at half weight rather than not at all. Without that,
   * a mode whose failures are all timeouts would report a spotless run for
   * someone who never touched the keyboard.
   */
  protected get precision(): number {
    const bad = this.fumbles + this.strays + this.expiries * 0.5;
    return this.hits / Math.max(1, this.hits + bad);
  }

  /** Of everything the drill asked for, how much you answered. */
  protected get answered(): number {
    return this.hits / Math.max(1, this.hits + this.fumbles + this.expiries);
  }

  // ----------------------------------------------------------- the verbs

  /**
   * Counts an input as an action without judging it.
   *
   * Every verb calls this, and the movement modes call it directly for the
   * commands that are the action even though the payoff arrives later.
   */
  protected note(): void {
    this.stamps.push(this.s.elapsed);
    this.lastActionAt = this.s.elapsed;
    if (this.stamps.length > 900) this.stamps.shift();
  }

  /**
   * The right command, on time.
   *
   * Everything satisfying in the trainer is stacked here on purpose: the pitch
   * climbs with the chain, a perfect adds a second voice above it, the ring is
   * wider the hotter you are, and the tier-up lands on top of all of it.
   */
  protected hit(pos: Vec2, opts: HitOpts = {}): void {
    if (opts.action !== false) this.note();
    this.hits++;
    const quality = clamp(opts.quality ?? 0.5, 0, 1);
    const perfect = quality >= 0.72;
    if (perfect) this.perfects++;
    if (opts.reaction !== undefined && Number.isFinite(opts.reaction)) {
      this.reactions.push(opts.reaction);
      this.s.metrics.noteReaction(opts.reaction);
    }

    this.chain++;
    this.bestChain = Math.max(this.bestChain, this.chain);
    audio.setComboPitch(this.chain);

    const base = opts.value ?? 100;
    this.scoreAcc += base * (1 + quality * 0.55) * this.multiplier;

    const color = opts.color ?? (perfect ? PALETTE.good : this.flow.color);
    audio.play(perfect ? 'perfect' : 'pickup', { pan: this.s.panOf(pos) });
    this.s.fx.impact(pos, 0, color, 0.9 + quality * 0.8 + this.heat);
    this.s.fx.ring(pos.x, pos.y, 8, 44 + quality * 46 + this.heat * 70, 0.3, color, 2 + this.heat * 2, 'impact');
    if (opts.label) this.s.micro(opts.label, pos, color);
    else if (perfect) this.s.micro('PERFECT', pos, PALETTE.good);

    this.refreshTier(pos);
  }

  /** The wrong command, or one that never came. The chain pays for it. */
  protected fumble(pos: Vec2, label = 'BROKEN', opts: { cost?: number; input?: boolean } = {}): void {
    if (opts.input !== false) {
      this.note();
      this.fumbles++;
    } else {
      this.expiries++;
    }
    // The cost of a mistake is the flow tier, not the fine: losing a ×2.4 is
    // worth thousands, and a deduction large enough to zero a whole run just
    // teaches people to stop rather than to recover.
    this.scoreAcc = Math.max(0, this.scoreAcc - (opts.cost ?? 70));
    this.breakChain(pos, label);
  }

  /**
   * A movement command, counted as the action it is — unless it is the same
   * command again. Re-issuing an order you already gave is the click-speed
   * inflation this whole engine exists to refuse to pay for.
   */
  protected noteMove(pos: Vec2): void {
    const last = this.lastMove;
    const repeat =
      last !== null && this.s.elapsed - last.t < 0.14 && Math.hypot(pos.x - last.x, pos.y - last.y) < 90;
    this.lastMove = { x: pos.x, y: pos.y, t: this.s.elapsed };
    if (repeat) {
      this.stray(pos);
      return;
    }
    this.note();
  }

  /** An input that meant nothing. It costs efficiency and heat, not the chain. */
  protected stray(pos: Vec2): void {
    this.note();
    this.strays++;
    this.scoreAcc = Math.max(0, this.scoreAcc - 30);
    this.heat *= 0.82;
    // A couple of rungs, not the whole ladder. One fumbled double-click should
    // dent a streak; only a habit of them should end one.
    this.chain = Math.max(0, this.chain - 2);
    audio.setComboPitch(this.chain);
    audio.play('castRefuse', { intensity: 0.5, pan: this.s.panOf(pos) });
    this.s.fx.ring(pos.x, pos.y, 2, 24, 0.22, PALETTE.textFaint, 1.5, 'pulse');
    this.settleTier();
  }

  private breakChain(pos: Vec2, label: string): void {
    const lost = this.chain;
    this.chain = 0;
    this.heat *= 0.25;
    audio.setComboPitch(0);
    audio.play('flowBreak', { pan: this.s.panOf(pos) });
    this.s.fx.ring(pos.x, pos.y, 10, 90, 0.35, PALETTE.danger, 2.5, 'impact');
    this.s.micro(lost >= 8 ? `${label} · ${lost} LOST` : label, pos, PALETTE.danger);
    if (lost >= FLOW_TIERS[2].at) {
      this.s.fx.addShake(3.5, 10);
      this.s.fx.addFlash(0.06, PALETTE.danger);
    }
    this.settleTier();
  }

  private settleTier(): void {
    let t = 0;
    for (let i = FLOW_TIERS.length - 1; i > 0; i--) {
      if (this.chain >= FLOW_TIERS[i].at) {
        t = i;
        break;
      }
    }
    this.tier = t;
  }

  private refreshTier(pos: Vec2): void {
    const before = this.tier;
    this.settleTier();
    if (this.tier <= before) return;
    this.peakTier = Math.max(this.peakTier, this.tier);
    const f = this.flow;
    audio.play('flowTier', { intensity: 0.7 + this.tier * 0.12 });
    this.s.setBanner(`${f.name}  ×${f.mult.toFixed(2).replace(/0$/, '')}`, 1.5);
    this.s.fx.addFlash(0.07 + this.tier * 0.02, f.color);
    this.s.fx.ring(pos.x, pos.y, 20, 240 + this.tier * 60, 0.6, f.color, 4, 'shock');
    this.s.fx.addShake(2 + this.tier, 9);
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    // The engine owns the chain. Writing it every frame keeps the HUD widget,
    // the arena's energy and the audio bed reading this ladder rather than the
    // session's own orbwalk counter, which means something else here.
    this.s.chain = this.chain;
    this.s.chainBest = Math.max(this.s.chainBest, this.bestChain);

    const target = clamp(this.chain / FLOW_TIERS[FLOW_TIERS.length - 1].at, 0, 1);
    const idle = this.s.elapsed - this.lastActionAt;
    // Hands off the keys and the room cools down on its own.
    const rate = idle > 1.1 ? 1.6 : 5;
    this.heat += (target - this.heat) * clamp(dt * rate, 0, 1);
    if (idle > 2.4) this.heat = Math.max(0, this.heat - dt * 0.35);

    this.sampleCd -= dt;
    if (this.sampleCd <= 0) {
      this.sampleCd = 0.5;
      // Peak is only meaningful once the trailing window has filled.
      if (this.s.elapsed > 3) this.peakApm = Math.max(this.peakApm, this.liveApm());
    }

    this.metronome(dt);
    this.tick(dt);
  }

  /**
   * The metronome only exists once you are in rhythm, and it accelerates with
   * you. It is a reward rather than a tool: the moment you can hear it, you
   * are being paid double for every action, and losing it is audible.
   */
  private metronome(dt: number): void {
    if (this.tier < 1) {
      this.beatCd = 0;
      return;
    }
    this.beatCd -= dt;
    if (this.beatCd > 0) return;
    this.beatCd = clamp(0.6 - this.tier * 0.09 - this.heat * 0.12, 0.16, 0.6);
    audio.play('flowPulse', { intensity: 0.35 + this.heat * 0.5 });
    const p = this.s.world.player;
    if (p) this.s.fx.ring(p.pos.x, p.pos.y, p.radius + 8, p.radius + 30 + this.heat * 34, 0.24, this.flow.color, 1.6, 'pulse');
  }

  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (p && this.tier > 0) {
      const f = this.flow;
      const pulse = 0.5 + 0.5 * Math.sin(t * (4 + this.tier * 1.6));
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: p.radius + 22 + this.heat * 26,
        color: f.color,
        alpha: 0.25 + this.heat * 0.5 + pulse * 0.12,
        width: 2 + this.heat * 4,
        progress: clamp(this.chain / Math.max(1, this.nextTierAt()), 0, 1),
        dash: 0,
        rise: 1.4,
      });
      out.billboards.push({
        kind: 'label',
        x: p.pos.x,
        y: p.pos.y,
        text: `×${f.mult.toFixed(2).replace(/0$/, '')}`,
        color: f.color,
        size: 20 + this.tier * 3,
        sub: `${f.name} · ${this.chain}`,
      });
    }
    this.paintMode(out, t);
  }

  private nextTierAt(): number {
    const next = FLOW_TIERS[this.tier + 1];
    return next ? next.at : FLOW_TIERS[FLOW_TIERS.length - 1].at;
  }

  // ------------------------------------------------------------------ hud

  hudFields(): HudField[] {
    const apm = this.liveApm();
    const apmBar = clamp(apm / (this.targetApm * 1.35), 0, 1);
    const acc = this.precision;
    const mid = this.modeField();
    return [
      {
        label: 'APM',
        value: `${Math.round(apm)}`,
        bar: apmBar,
        tone: apm > this.targetApm ? 'good' : apm > this.targetApm * 0.6 ? 'warn' : 'bad',
      },
      mid ?? {
        label: 'CLEAN',
        value: `${Math.round(acc * 100)}%`,
        bar: acc,
        tone: acc > 0.9 ? 'good' : acc > 0.75 ? 'warn' : 'bad',
      },
      {
        label: 'FLOW',
        value:
          this.tier > 0
            ? `${this.flow.name} ×${this.flow.mult.toFixed(2).replace(/0$/, '')}`
            : `${this.chain} / ${FLOW_TIERS[1].at} TO FLOW`,
        bar: this.heat,
        tone: this.tier >= 3 ? 'good' : this.tier >= 1 ? 'warn' : 'neutral',
      },
    ];
  }

  liveScore(): number {
    return Math.max(0, Math.round(this.scoreAcc));
  }

  // -------------------------------------------------------------- outcome

  outcome(): DrillOutcome {
    const avgApm = this.averageApm();
    const correct = this.correctPerMinute();
    const peak = Math.max(this.peakApm, avgApm);
    // Speed is read from the sustained *correct* rate, not the peak and not
    // the raw one: a single fast second is not a fast pair of hands, and a
    // fast pair of hands doing nothing is not a fast pair of hands at all.
    const speed = band(correct, this.targetRate * 0.25, this.targetRate);
    const accuracy = this.precision;
    const answered = this.answered;
    const consistency = band(this.bestChain, 4, Math.max(12, this.targetApm / 6));

    const performance = clamp(speed * 0.42 + accuracy * 0.26 + answered * 0.18 + consistency * 0.14, 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (correct > this.targetRate) helped.push(`${Math.round(correct)} correct actions a minute, sustained.`);
    if (accuracy > 0.93 && this.hits > 12) helped.push('Almost nothing you did was wasted.');
    if (this.peakTier >= 3) helped.push(`You reached ${FLOW_TIERS[this.peakTier].name} — a ×${FLOW_TIERS[this.peakTier].mult} run.`);
    if (this.perfects > this.hits * 0.4 && this.hits > 8) helped.push(`${this.perfects} inputs landed in the early window.`);
    if (this.strays > this.hits * 0.25) hurt.push(`${this.strays} inputs went nowhere — speed you paid for and did not get.`);
    if (this.fumbles > 4) hurt.push(`${this.fumbles} wrong or late inputs broke the chain.`);
    if (this.expiries > this.hits * 0.3) hurt.push(`${this.expiries} prompts expired before you answered them.`);
    if (correct < this.targetRate * 0.55 && accuracy > 0.92) hurt.push('Accurate, but slow. This mode has room for a lot more hand.');
    if (avgApm > this.targetApm * 1.2 && accuracy < 0.7) hurt.push('Plenty of speed, most of it spent on nothing.');

    const own = this.modeMetrics();
    const coaching = this.notes();
    const advice =
      coaching.advice ??
      (accuracy < 0.78
        ? 'Slow down about ten percent. At this accuracy the extra speed is costing more than it earns.'
        : correct < this.targetRate * 0.7
          ? 'Stop waiting for certainty. Commit to the first correct input and let your hands catch up.'
          : this.bestChain < 12
            ? 'You have the speed; you are losing it to breaks. Protect the chain — the multiplier is most of the score.'
            : 'Raise the difficulty. The prompts get tighter, and the ceiling goes up with them.');

    return {
      score: this.liveScore(),
      performance,
      axisPerformance: this.axisSplit(performance, accuracy, speed),
      // Order matters: the results screen leads with the first and shows the
      // next four in a row. So it goes headline rate, the rate that was
      // scored, what the mode itself measures, and then the two numbers that
      // explain the gap between the first two.
      keyMetrics: [
        count('apm', 'SUSTAINED APM', Math.round(avgApm)),
        count('correctApm', 'CORRECT ACTIONS / MIN', Math.round(correct)),
        ...own.slice(0, 1),
        pct('clean', 'CLEAN INPUTS', accuracy),
        count('chain', 'BEST CHAIN', this.bestChain),
        count('peakApm', 'PEAK APM', Math.round(peak)),
        ...own.slice(1),
      ],
      helped: [...helped, ...coaching.helped],
      hurt: [...hurt, ...coaching.hurt],
      advice,
    };
  }
}

/** Shared cooldown bookkeeping for the modes that put keys under your hands. */
export class KeyCooldowns {
  private cd: Record<string, number> = { q: 0, w: 0, e: 0, r: 0, d: 0, f: 0 };

  tick(dt: number): void {
    for (const k of Object.keys(this.cd)) this.cd[k] = Math.max(0, this.cd[k] - dt);
  }

  get(slot: string): number {
    return this.cd[slot] ?? 0;
  }

  set(slot: string, v: number): void {
    this.cd[slot] = v;
  }
}

/** A target that exists to be clicked, not to fight back. */
export const INERT_ATTACK = {
  attackSpeed: 0.01,
  windupRatio: 0.3,
  backswingRatio: 0.3,
  range: 0,
  damage: 0,
  projectileSpeed: 0,
} as const;
