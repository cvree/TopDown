import { audio } from '../../engine/audio';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { Drill, band, count, pct, rate, secs, type DrillOutcome } from '../base';
import { Tide } from './tide';
import { APM_LEVELS, difficultyLevel, levelDifficulty } from '../../progression/apmladder';

/**
 * THE LAB — the APM trainer's shared engine.
 *
 * The trainer used to be the game with a stopwatch on it: minions to farm,
 * camps to smite, a duelist to kite. That taught the game a second time and
 * measured hands only incidentally. This engine now sits under something
 * deliberately further away — a bare console of pads, gates and clocks with no
 * champion to fight and nothing to kill — so that what is left in the
 * measurement is the thing the section is named after: *pressing*. How fast
 * two fingers trade off. How wide the gap is between the two keys of a chord.
 * How early you can commit to a window that has not opened yet. How much a
 * key costs when your hand has to move to reach it.
 *
 * Distance from the game is the point, and applicability is bought back a
 * different way: every mode names the moment it is a slice of. A gate that
 * refuses an early press is the cast bar you buffer into; a barred pad you
 * must leave alone is the cooldown you do not spend on a bait. The lab never
 * shows you the moment — it drills the press the moment is made of.
 *
 * Every mode in this folder measures the same thing — how many *correct*
 * commands your hands issue per minute — and every mode has to feel the same
 * way while doing it. That feel is not decoration: it is the mode's read-out.
 * The chain climbs, the flow tier steps up, the pitch of every confirmation
 * rises with it, the console bed swells, a metronome appears once you are in
 * rhythm and speeds up as you do. When you break, all of it falls away at
 * once. You should be able to tell how the run is going with your eyes shut.
 *
 * The other half of the design is that speed alone must never score. Every
 * mode routes its inputs through exactly four verbs here:
 *
 *   hit()    — the right command, on time. Pays out, scaled by the multiplier.
 *   hold()   — the command you were right not to make. Pays, counts no action.
 *   fumble() — the wrong command, or one that arrived too late. Breaks flow.
 *   stray()  — an input that meant nothing. Costs efficiency, not the chain.
 *
 * so "actions per minute" can never drift away from "actions that mattered" —
 * and so a mode about restraint can pay for restraint without paying a rate
 * for it, which is the whole reason hold() exists as a verb of its own.
 *
 * And one rule about the floor those verbs sit on: *the rung sets the pace and
 * nothing else moves it*. Every window, every spacing and every clock in every
 * bench is a function of `d` — the difficulty the level named — so two runs at
 * a level are two runs at the same difficulty and the numbers they produce can
 * be put next to each other. The engine used to feed the player's own flow
 * back into the pace, which was a lovely idea and the wrong instrument: it
 * meant a good run bought itself a harder bench, and "level 6" named a range
 * rather than a place. What your form moves now is the *reward* — the chain,
 * the tier, the multiplier, the pitch, the bed. The one shape of run with a
 * moving floor is INFINITE, where moving the floor is the entire mode.
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

/**
 * The rate a strong run sustains in each mode.
 *
 * It lives out here, in one table, rather than as a number buried in each
 * class, because it is not only a scoring constant: the level ladder prints it
 * next to every rung as the par for that mode. A figure the player is shown
 * and a figure the score is built from must be the same figure, or the ladder
 * is lying about what it is asking for.
 */
export const APM_TARGET_APM = {
  apmPulse: 265,
  apmSequence: 235,
  apmChord: 170,
  apmGate: 125,
  apmBuffer: 65,
  apmCancel: 145,
  apmVector: 105,
  apmField: 180,
  apmHandoff: 150,
  apmSplit: 145,
  apmUpkeep: 120,
  apmSwitch: 165,
  apmSustain: 200,
} as const;

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
  /** Prompts you were right to leave alone. Correct, and not an action. */
  protected holds = 0;
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

  /**
   * The floor, when it moves.
   *
   * Null in every run shape but one. INFINITE builds it on the first frame —
   * not in a constructor, because the rate it is calibrated against is a
   * subclass field and does not exist yet while a base constructor is running.
   */
  protected tide: Tide | null = null;
  private tideBuilt = false;

  private peakApm = 0;
  private beatCd = 0;
  private lastActionAt = 0;
  private sampleCd = 0;
  private lastMove: { x: number; y: number; t: number } | null = null;
  private lastDir: Vec2 | null = null;
  private dirCd = 0;

  // ------------------------------------------------------------- template

  /** Per-mode simulation. Called after the engine's own bookkeeping. */
  protected abstract tick(dt: number): void;

  /** Per-mode drawing. The flow ring and tier badge are drawn for you. */
  protected paintMode(_out: DrillPaint, _t: number): void {}

  /**
   * A movement command issued with the keys rather than the mouse.
   *
   * `started` is true when the champion was standing still and is now moving —
   * the WASD equivalent of a click on the ground. A change of heading while
   * already moving is also a command, and is passed with `started` false so a
   * mode can tell the two apart.
   */
  protected onDirectMove(_pos: Vec2, _started: boolean): void {}

  /** The middle HUD field. Modes that measure something specific override it. */
  protected modeField(): HudField | null {
    return null;
  }

  /** Extra metrics for the results screen, ahead of the shared APM block. */
  protected modeMetrics(): KeyMetric[] {
    return [];
  }

  /**
   * What the layers *under* the mode measured.
   *
   * The console's board in the corner runs in every mode and belongs to none
   * of them, so its ledger arrives here rather than in thirteen copies of
   * `modeMetrics`. Same for the two coaching hooks below it: a run lost on the
   * map is a thing the results screen has to be able to say out loud even
   * though no mode knows the map exists.
   */
  protected extraMetrics(): KeyMetric[] {
    return [];
  }

  protected extraNotes(): { helped: string[]; hurt: string[] } {
    return { helped: [], hurt: [] };
  }

  protected extraAdvice(): string | null {
    return null;
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

  /**
   * The difficulty the mode is built at, right now.
   *
   * A number in PLAY and in SURVIVE, because a rep that moved under you is not
   * a rep. A moving floor in INFINITE, which is the whole of that mode: every
   * window, every spacing, every clock in every bench reads this one getter,
   * so a tide that changes it changes all thirteen modes at once and none of
   * them had to be told.
   */
  protected get d(): number {
    return this.tide ? this.tide.difficulty : this.s.config.difficulty;
  }

  /** The moving floor, for the HUD. Null whenever the floor is not moving. */
  difficultyNow(): number | null {
    return this.tide ? this.tide.difficulty : null;
  }

  /** The rung the floor is on, continuously. Null when nothing is moving. */
  levelNow(): number | null {
    return this.tide ? this.tide.level : null;
  }

  /** Which way the floor is heading, -1..1. Null when nothing is moving. */
  driftNow(): number | null {
    return this.tide ? this.tide.drift : null;
  }

  /**
   * The speed multiplier the modes pace themselves with.
   *
   * It reads the rung and nothing else. It used to read your own flow as well
   * — the better the run was going, the faster the bench ran — and that is a
   * lovely idea and the wrong instrument. A level is supposed to be a *place*:
   * you go back to it, you beat it, you leave it behind, and the number you
   * bring back is comparable with the last one because the bench was the same
   * bench both times. A floor that accelerated under a good run meant the
   * opposite — the better you played, the harder the thing you were being
   * scored on, so a strong start was punished with a hostile finish and no two
   * runs at "level 6" were ever the same difficulty.
   *
   * So pacing is static within a run and rises only with the rung. The thing
   * your form still moves is the *reward* — the chain, the tier and the
   * multiplier — which is where a reward belongs.
   *
   * The one deliberate exception is INFINITE, which has no rung to be static
   * at: there `this.d` is the tide, and moving the floor is the entire mode.
   */
  protected get tempo(): number {
    return 0.8 + this.d * 1.05;
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
    const good = this.hits + this.holds;
    const bad = this.fumbles + this.strays + this.expiries * 0.5;
    return good / Math.max(1, good + bad);
  }

  /** Of everything the drill asked for, how much you answered. */
  protected get answered(): number {
    const good = this.hits + this.holds;
    return good / Math.max(1, good + this.fumbles + this.expiries);
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
    // Every hit is a correct *action*, whether or not the press was the thing
    // that paid out: the rate the tide is calibrated against is this engine's
    // own correct-per-minute, which counts hits and never asks how the payoff
    // arrived. Reading the flag here instead made the movement modes — where
    // the command is counted separately from the outcome it causes — look to
    // the tide like a player who was not pressing anything at all.
    this.tide?.good(this.s.elapsed, true);
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
    // No camera on a hit. A confirmation in the lab is the spray, the ring and
    // the pitch — a shove as well would fire five times a second for a whole
    // minute, which is not weight, it is a tremor.
    this.s.fx.impact(pos, 0, color, 0.9 + quality * 0.8 + this.heat, 0);
    this.s.fx.ring(pos.x, pos.y, 8, 44 + quality * 46 + this.heat * 70, 0.3, color, 2 + this.heat * 2, 'impact');
    if (opts.label) this.s.micro(opts.label, pos, color);
    else if (perfect) this.s.micro('PERFECT', pos, PALETTE.good);

    this.refreshTier(pos);
  }

  /**
   * The command you were right not to make.
   *
   * A mode that asks you to withhold cannot pay for it with hit(): that would
   * put a number in "correct actions per minute" that no finger produced, and
   * the whole engine rests on that number being made of inputs. So restraint
   * gets a verb of its own — it pays score, it protects the chain, it counts
   * towards how much of what was asked you answered, and it moves the rate
   * exactly nowhere.
   */
  protected hold(pos: Vec2, label = 'HELD'): void {
    this.holds++;
    // Correct, and not a keystroke: it moves the tide's read of your form and
    // leaves its read of your rate exactly where it was, which is the same
    // split this verb exists to make everywhere else.
    this.tide?.good(this.s.elapsed, false);
    this.chain++;
    this.bestChain = Math.max(this.bestChain, this.chain);
    audio.setComboPitch(this.chain);
    this.scoreAcc += 70 * this.multiplier;
    audio.play('abilityReady', { intensity: 0.5, pan: this.s.panOf(pos) });
    this.s.fx.ring(pos.x, pos.y, 10, 52, 0.32, PALETTE.textDim, 2, 'pulse');
    this.s.micro(label, pos, PALETTE.textDim);
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
    // A wrong press is worth more to the tide than a prompt that ran out: one
    // is a hand that went to the wrong place, the other is a floor that is
    // simply going faster than you are, and the second is the thing the tide
    // is meant to fix rather than punish.
    this.tide?.bad(opts.input === false ? 1.25 : 1.6);
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
    this.tide?.bad(0.6);
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
    // The buzzer, the shove and the red wash are punishment; the ring and the
    // word are the report. Only the first three are the player's to switch
    // off — losing the chain still costs exactly what it cost.
    audio.play('flowBreak', { pan: this.s.panOf(pos) });
    this.s.fx.ring(pos.x, pos.y, 10, 90, 0.35, PALETTE.danger, 2.5, 'impact');
    this.s.micro(lost >= 8 ? `${label} · ${lost} LOST` : label, pos, PALETTE.danger);
    // Only a chain worth mourning, and half the shove it used to be: on a
    // bench where a break is an ordinary event this fired several times a
    // minute, and a camera that lurches every twenty seconds stops reading as
    // punctuation and starts reading as a fault.
    if (lost >= FLOW_TIERS[3].at) {
      this.s.fx.badShake(1.8, 12);
      this.s.fx.badFlash(0.05, PALETTE.danger);
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
    this.s.fx.addFlash(0.05 + this.tier * 0.015, f.color);
    this.s.fx.ring(pos.x, pos.y, 20, 240 + this.tier * 60, 0.6, f.color, 4, 'shock');
    // The first two tiers arrive inside the first few seconds of every run and
    // then again after every break, so they get the banner and the ring and no
    // camera at all. Shake is saved for the two a run is actually built on,
    // where it still means something because it is rare.
    if (this.tier >= 3) this.s.fx.addShake(1.4 + (this.tier - 3) * 0.8, 11);
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    if (!this.tideBuilt) {
      this.tideBuilt = true;
      // The first frame is the earliest moment `targetApm` exists: a subclass
      // field is written after the base constructor has already run.
      if (this.s.mode === 'infinite') {
        this.tide = new Tide({
          openAt: difficultyLevel(this.s.config.difficulty),
          targetRate: this.targetRate,
        });
      }
    }

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

    this.pollHeldDirection(dt);
    this.metronome(dt);
    this.tick(dt);
    // Last, so the floor a mode was built against this frame is the floor it
    // was drawn at, and the next rung arrives on the next frame rather than
    // halfway through this one.
    if (this.tide) {
      this.tide.step(dt, this.s.elapsed);
      this.announceRung();
    }
  }

  /**
   * The floor moving under you, said out loud.
   *
   * A difficulty that changes silently is a difficulty a player will swear
   * never changed — so a rung is a moment: a banner, a flash, a ring off the
   * body, and a note that rises when the floor does and falls when it does
   * not. It is the only feedback in the lab that is about the *mode* rather
   * than about the press, which is why it is allowed to interrupt.
   */
  private announceRung(): void {
    const c = this.tide?.takeCrossing();
    if (!c) return;
    const color = c.up ? PALETTE.warn : PALETTE.accent;
    this.s.setBanner(c.up ? `LEVEL ${c.level}  ▲ HARDER` : `LEVEL ${c.level}  ▼ EASED`, 1.6);
    audio.play(c.up ? 'flowTier' : 'abilityReady', { intensity: c.up ? 0.85 : 0.55 });
    this.s.fx.addFlash(c.up ? 0.09 : 0.05, color);
    const p = this.s.world.player;
    if (p) {
      this.s.fx.ring(p.pos.x, p.pos.y, 24, 260 + c.level * 20, 0.6, color, 3.5, 'shock');
      if (c.up) this.s.fx.addShake(1.2, 11);
    }
  }

  /**
   * WASD's actions, counted the way clicks are.
   *
   * Under direct control the mouse issues almost nothing: the commands are a
   * held direction starting and a heading changing. Without this the movement
   * modes would report almost no APM for anyone driving with the keys, which
   * would make the whole trainer a click-scheme feature by accident.
   *
   * Only modes whose champion can actually move are polled, so hammering the
   * keys in a mode that has you bolted to the floor buys nothing. The rate
   * limit is what stops a held key that wobbles between two diagonals from
   * reading as ten commands a second.
   */
  private pollHeldDirection(dt: number): void {
    if (this.s.scheme !== 'wasd') return;
    const p = this.s.world.player;
    if (!p || !p.alive || p.moveSpeed <= 0) return;
    this.dirCd = Math.max(0, this.dirCd - dt);

    const dir = p.moveDir;
    if (!dir) {
      this.lastDir = null;
      return;
    }
    const had = this.lastDir;
    const started = had === null;
    // Unit vectors, so the dot product is the cosine: 0.72 is about 44°.
    const turned = had !== null && had.x * dir.x + had.y * dir.y < 0.72;
    if (!started && !turned) {
      // Drift, not a decision. Tracked so that a slow sweep across the
      // threshold still eventually reads as the turn it is.
      this.lastDir = { x: dir.x, y: dir.y };
      return;
    }
    // A command that arrives inside the rate limit is deferred, not thrown
    // away: the old heading is left in place so the turn is still pending and
    // is counted on the first frame the limit allows. Dropping it instead —
    // which is what this did — silently lost every command a mode asked for
    // in quick succession, and a movement mode is mostly those.
    if (this.dirCd > 0) return;
    this.lastDir = { x: dir.x, y: dir.y };
    this.dirCd = 0.12;
    this.note();
    this.onDirectMove(p.pos, started);
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
    const clean: HudField = {
      label: 'CLEAN',
      value: `${Math.round(acc * 100)}%`,
      bar: acc,
      tone: acc > 0.9 ? 'good' : acc > 0.75 ? 'warn' : 'bad',
    };
    return [
      {
        label: 'APM',
        value: `${Math.round(apm)}`,
        bar: apmBar,
        tone: apm > this.targetApm ? 'good' : apm > this.targetApm * 0.6 ? 'warn' : 'bad',
      },
      // The HUD has four slots. A mode with something of its own to say gets
      // one, and cleanliness keeps its own either way: in a drill that refuses
      // to pay for wasted inputs, the share that landed is not a footnote.
      ...(mid ? [mid, clean] : [clean]),
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
    if (this.holds > 4 && this.fumbles <= this.holds * 0.25)
      helped.push(`${this.holds} prompts you correctly left alone.`);
    if (this.strays > this.hits * 0.25) hurt.push(`${this.strays} inputs went nowhere — speed you paid for and did not get.`);
    if (this.fumbles > 4) hurt.push(`${this.fumbles} wrong or late inputs broke the chain.`);
    if (this.expiries > this.hits * 0.3) hurt.push(`${this.expiries} prompts expired before you answered them.`);
    if (correct < this.targetRate * 0.55 && accuracy > 0.92) hurt.push('Accurate, but slow. This mode has room for a lot more hand.');
    if (avgApm > this.targetApm * 1.2 && accuracy < 0.7) hurt.push('Plenty of speed, most of it spent on nothing.');

    const own = this.modeMetrics();
    const layerMetrics = this.extraMetrics();
    const coaching = this.notes();
    const layers = this.extraNotes();

    // What the floor did, when there was a floor. An infinite run's whole
    // result is these three numbers: where it settled, how high it got, and
    // how far that is from where it opened.
    const tide = this.tide;
    if (tide) {
      const held = tide.settled;
      const moved = held - tide.opened;
      if (moved >= 0.6)
        helped.push(
          `The floor came up ${moved.toFixed(1)} rungs under you — you opened on ${tide.opened.toFixed(1)} and held ${held.toFixed(1)}.`,
        );
      if (tide.peak >= 9.5) helped.push('You reached the top of the ladder. There is no rung above this one.');
      else if (tide.peak - held >= 0.9)
        hurt.push(
          `You touched level ${tide.peak.toFixed(1)} and could not stay there — the run settled ${(tide.peak - held).toFixed(1)} rungs below its own peak.`,
        );
      if (moved <= -0.6)
        hurt.push(`The floor had to come down ${Math.abs(moved).toFixed(1)} rungs to find you.`);
    }

    const advice =
      coaching.advice ??
      this.extraAdvice() ??
      (tide
        ? tide.settled >= APM_LEVELS - 0.4
          ? `You held level ${tide.settled.toFixed(1)}. Nothing here is above you any more — take the same rung in PLAY and put it on the board.`
          : `The tide put you at level ${Math.round(tide.settled)}. That is the rung to play for score: it is the hardest one you can still hold clean.`
        : accuracy < 0.78
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
      // The tide spends the whole run holding your performance inside one
      // band, so the *performance* of an infinite run is nearly a constant and
      // the difficulty it was held at is the entire finding. Handing the rung
      // back as the run's effective difficulty is what makes that finding
      // count for rating instead of averaging away into nothing.
      ...(tide ? { effectiveDifficulty: levelDifficulty(tide.settled) } : {}),
      // Order matters: the results screen leads with the first and shows the
      // next four in a row. So it goes headline rate, the rate that was
      // scored, what the mode itself measures, what the layers under it
      // measured — the corner of the screen is where a good run is most often
      // actually lost — and then how much of it all was clean. Everything
      // after that is kept for the records rather than the four cells.
      // A run whose floor moved reports the floor first: what it settled at is
      // the result, and every rate under it is a rate *at that level* rather
      // than a rate on its own.
      keyMetrics: [
        ...(tide
          ? [
              rate('labHeld', 'LEVEL HELD', tide.settled),
              secs('lasted', 'LASTED', this.s.elapsed),
              rate('labPeak', 'PEAK LEVEL', tide.peak),
            ]
          : []),
        count('apm', 'SUSTAINED APM', Math.round(avgApm)),
        count('correctApm', 'CORRECT ACTIONS / MIN', Math.round(correct)),
        ...own.slice(0, 1),
        ...layerMetrics.slice(0, 1),
        pct('clean', 'CLEAN INPUTS', accuracy),
        count('chain', 'BEST CHAIN', this.bestChain),
        count('peakApm', 'PEAK APM', Math.round(peak)),
        ...(this.holds > 0 ? [count('held', 'CORRECTLY HELD', this.holds)] : []),
        ...(tide ? [rate('labLow', 'LOWEST LEVEL', tide.low)] : []),
        ...own.slice(1),
        ...layerMetrics.slice(1),
      ],
      helped: [...helped, ...coaching.helped, ...layers.helped],
      hurt: [...hurt, ...coaching.hurt, ...layers.hurt],
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
