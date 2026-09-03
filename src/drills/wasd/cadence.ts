import { audio } from '../../engine/audio';
import { clamp, dist, median } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct } from '../base';
import { WasdDrill, bandIf } from './engine';

type Stage = 'watch' | 'red' | 'free' | 'full';

const STAGES: { kind: Stage; name: string; brief: string; share: number }[] = [
  { kind: 'watch', name: 'THE BAR', brief: 'Attack, and watch what the bar does. Do not move yet.', share: 0.16 },
  { kind: 'red', name: 'THE RED', brief: 'Move only when the bar turns green. Early costs the attack.', share: 0.26 },
  { kind: 'free', name: 'THE GREEN', brief: 'No cue now. Step the instant the shot leaves.', share: 0.3 },
  { kind: 'full', name: 'THE CYCLE', brief: 'It walks. Hold the whole cadence anyway.', share: 0.28 },
];

/**
 * WASD 05 — ATTACKING WHILE MOVING.
 *
 * The signature module, and the one everything after it depends on.
 *
 * A basic attack is not an event. It is four stretches of time — the windup,
 * the instant the damage leaves, the backswing, and the wait for the timer —
 * and movement means something completely different in each of them. During
 * the windup a held key destroys the attack outright and you get nothing for
 * the time you already spent. A fifth of a second later, in the backswing, the
 * exact same key costs nothing at all: the damage has already gone.
 *
 * Almost every mechanical mistake an ADC makes is a misunderstanding of that
 * one asymmetry, and it is invisible in a normal game — the attack simply does
 * not happen and you assume you misclicked. So this module does three things
 * no ordinary drill does: it draws the four stretches as one bar over your
 * champion, it names out loud which stretch every mistake happened in, and it
 * teaches them in order, with a cue first and without one afterwards.
 *
 * Under the keys there is a fifth thing the click scheme never has to learn:
 * a held key does not only cancel attacks, it *prevents* them. The champion
 * will not shoot while you are asking it to walk, so the release is the
 * trigger, and the milliseconds you spend holding a loaded shot are counted
 * here as their own mistake with their own name.
 */
export class WasdCadenceDrill extends WasdDrill {
  protected get moduleWeight(): number {
    return 0.8;
  }

  private dummy: Actor | null = null;
  private stageIndex = 0;
  private stageEnd = 0;

  private attacks = 0;
  private cancels = 0;
  private earlyMoves = 0;
  private cleanSteps = 0;
  private wastedWindows = 0;

  /** Milliseconds from the shot leaving to the first key going down. */
  protected stepDelays: number[] = [];
  private awaitingStep = -1;
  private movedThisWindow = false;
  private inBackswing = false;

  /** Seconds a ready shot was held back by a key that was still down. */
  private triggerHeld = 0;
  private readyAndHeld = false;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.68 });
    p.maxHp = 2400;
    p.hp = 2400;
    this.dummy = this.spawnEnemy('juggernaut', { x: w * 0.5, y: h * 0.34 }, { hpScale: 40 });
    this.dummy.attack.damage = 4;
    this.dummy.moveSpeed = 0;
    this.dummy.label = 'DUMMY';
    this.stageEnd = this.s.config.duration * STAGES[0].share;
  }

  onStart(): void {
    this.s.setBanner(`${STAGES[0].name} · ${STAGES[0].brief}`, 3);
  }

  private get stage() {
    return STAGES[Math.min(this.stageIndex, STAGES.length - 1)];
  }

  private advance(): void {
    if (this.stageIndex >= STAGES.length - 1) return;
    this.stageIndex++;
    let acc = 0;
    for (let i = 0; i <= this.stageIndex; i++) acc += STAGES[i].share;
    this.stageEnd = this.s.config.duration * acc;
    this.s.setBanner(`${this.stage.name} · ${this.stage.brief}`, 2.6);
    audio.play('flowTier', { intensity: 0.7 });
    // The last stage puts the dummy on its feet, so range has to be kept as
    // well as timed — which is the whole of module 06 in miniature.
    if (this.stage.kind === 'full' && this.dummy) {
      this.dummy.moveSpeed = 150 + this.d * 90;
      this.dummy.label = 'CHASER';
      this.brains.length = 0;
      this.dummy.order = { kind: 'attackMove', pos: { ...this.dummy.pos } };
    }
  }

  protected tickModule(dt: number): void {
    const p = this.player;
    const e = this.dummy;
    if (!p || !e) return;
    if (this.s.elapsed >= this.stageEnd) this.advance();

    if (this.stage.kind === 'full') {
      // A walker rather than a brain: it has one job, which is to keep the
      // range moving so a cadence learnt standing still does not survive.
      const d = dist(p.pos, e.pos);
      if (d > 180) {
        const n = { x: (p.pos.x - e.pos.x) / d, y: (p.pos.y - e.pos.y) / d };
        e.pos.x += n.x * e.moveSpeed * dt;
        e.pos.y += n.y * e.moveSpeed * dt;
      }
    }
    e.hp = e.maxHp;
    e.alive = true;

    // The trigger. Loaded, in range, and a key still down.
    const loaded = p.attackCd <= 0 && p.phase !== 'windup';
    const inRange = dist(p.pos, e.pos) - e.radius <= p.attack.range;
    const holding = loaded && inRange && p.moveDir !== null;
    if (holding) {
      this.triggerHeld += dt;
      if (!this.readyAndHeld && this.triggerHeld > 0.25) {
        this.readyAndHeld = true;
        this.s.micro('TRIGGER HELD', p.pos, PALETTE.warn);
      }
    } else {
      this.readyAndHeld = false;
    }

    // A backswing that ended with the champion having never moved is a free
    // window thrown away — the quiet mistake, the one with no error message.
    const nowBackswing = p.phase === 'backswing';
    if (this.inBackswing && !nowBackswing) {
      if (!this.movedThisWindow && this.stage.kind !== 'watch') {
        this.wastedWindows++;
        this.nudge(p.pos, 'WINDOW WASTED', 35);
      }
      this.awaitingStep = -1;
    }
    this.inBackswing = nowBackswing;
  }

  /**
   * A direction going down, judged by which stretch of the attack it landed in.
   *
   * This is the entire module, expressed as one branch. The world has already
   * cancelled the attack if it was in the windup; what happens here is that the
   * player is told, in the moment, which stretch they were in.
   */
  protected onDirection(_dir: Vec2, started: boolean): void {
    const p = this.player;
    if (!p || !started) return;

    if (p.phase === 'windup') {
      // The world cancelled it. Naming it is what makes the lesson land.
      this.earlyMoves++;
      this.penalize(p.pos, 'MOVED IN THE RED', 90);
      return;
    }
    if (this.awaitingStep >= 0) {
      const delay = (this.s.elapsed - this.awaitingStep) * 1000;
      this.stepDelays.push(delay);
      this.awaitingStep = -1;
      this.movedThisWindow = true;
      this.cleanSteps++;
      this.tasks++;
      // The backswing is roughly a third of a second long. A step inside the
      // first half of it is free; one that arrives after it is a window you
      // only half used.
      const q = clamp(1 - delay / 420, 0, 1);
      this.award(p.pos, {
        value: 110,
        quality: q,
        label: q > 0.7 ? 'FREE STEP' : 'LATE STEP',
      });
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    const p = this.player;
    for (const e of events) {
      if (e.actorId !== pid || !p) continue;
      if (e.type === 'attackRelease') {
        this.attacks++;
        this.awaitingStep = this.s.elapsed;
        this.movedThisWindow = false;
        if (this.stage.kind === 'watch') {
          this.tasks++;
          this.award(p.pos, { value: 90, quality: 0.7, label: 'RELEASED' });
        }
        if (this.stage.kind === 'red') audio.play('abilityReady', { intensity: 0.8 });
      } else if (e.type === 'attackCancel') {
        this.cancels++;
      }
    }
  }

  // ------------------------------------------------------------------ paint

  protected paintModule(out: DrillPaint, _t: number): void {
    const p = this.player;
    const e = this.dummy;
    if (!p) return;

    this.paintCadence(out, this.stage.kind === 'watch' ? 'WATCH THE BAR · DO NOT MOVE' : undefined);

    // The floor under the champion says the same thing as the bar, in the
    // place your eyes actually are during a fight.
    const phaseColor =
      p.phase === 'windup' ? PALETTE.danger : p.phase === 'backswing' ? PALETTE.good : PALETTE.textDim;
    out.markers.push({
      kind: 'ring',
      x: p.pos.x,
      y: p.pos.y,
      radius: p.radius + 16,
      color: phaseColor,
      alpha: p.phase === 'idle' ? 0.35 : 0.85,
      width: 4,
      rise: 0.7,
    });

    // The cue, in the stage that has one.
    if (this.stage.kind === 'red' && p.phase === 'backswing') {
      out.billboards.push({
        kind: 'label',
        x: p.pos.x,
        y: p.pos.y,
        text: 'GO',
        color: PALETTE.good,
        size: 30,
        sub: 'the damage has already left',
      });
    }
    if (e) {
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: p.attack.range,
        color: dist(p.pos, e.pos) - e.radius <= p.attack.range ? PALETTE.accentDim : PALETTE.warn,
        alpha: 0.3,
        width: 2,
        rise: 0.5,
      });
    }
  }

  // -------------------------------------------------------------------- hud

  private freeWindowUse(): number {
    const m = this.s.metrics.m;
    return m.freeWindow > 0.4 ? clamp(m.freeWindowMoving / m.freeWindow, 0, 1) : 0;
  }

  private cancelFreedom(): number {
    return this.attacks + this.cancels > 0 ? clamp(1 - this.cancels / (this.attacks + this.cancels), 0, 1) : 0;
  }

  private stepDelay(): number {
    return this.stepDelays.length ? median(this.stepDelays) : 0;
  }

  private triggerDelayMs(): number {
    return (this.triggerHeld / Math.max(1, this.attacks)) * 1000;
  }

  private uptime(): number {
    const p = this.player;
    if (!p) return 0;
    const cycle = 1 / Math.max(0.1, p.attack.attackSpeed);
    return clamp(this.attacks / Math.max(1, this.s.elapsed / cycle), 0, 1);
  }

  protected moduleField(): HudField {
    const use = this.freeWindowUse();
    return {
      label: 'FREE WINDOW USED',
      value: `${Math.round(use * 100)}%`,
      bar: use,
      tone: use > 0.75 ? 'good' : use > 0.5 ? 'warn' : 'bad',
    };
  }

  protected quality(): number {
    // The two timing figures are measured from attacks, so a run with no
    // attacks in it scores nothing for them rather than everything.
    return clamp(
      this.freeWindowUse() * 0.28 +
        this.cancelFreedom() * 0.24 +
        bandIf(this.stepDelays.length, this.stepDelay(), 700, 90) * 0.18 +
        this.uptime() * 0.18 +
        bandIf(this.attacks, this.triggerDelayMs(), 500, 40) * 0.12,
      0,
      1,
    );
  }

  protected discipline(): number {
    // Uptime is the wrong stick in a module whose first stage forbids moving.
    return clamp(this.freeWindowUse() * 0.6 + this.moveUptime() * 0.4, 0, 1);
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return {
      kiting: clamp(this.freeWindowUse() * 0.5 + performance * 0.5, 0, 1),
      tempo: performance,
      movement: performance,
    };
  }

  protected moduleMetrics(): KeyMetric[] {
    return [
      pct('freeWindow', 'FREE WINDOW USED', this.freeWindowUse()),
      ms('stepDelay', 'STEP AFTER THE SHOT', this.stepDelay()),
      count('cancels', 'ATTACKS LOST IN THE WINDUP', this.cancels, 'lower'),
      ms('trigger', 'TRIGGER HELD PER ATTACK', this.triggerDelayMs()),
      pct('uptime', 'ATTACK UPTIME', this.uptime()),
      count('wasted', 'BACKSWINGS WASTED', this.wastedWindows, 'lower'),
      count('attacks', 'ATTACKS LANDED', this.attacks),
    ];
  }

  protected notes() {
    return {
      helped:
        this.cancels === 0 && this.attacks > 15
          ? ['Not one attack lost to an early key all run. That is the law learnt.']
          : this.freeWindowUse() > 0.8
            ? ['You used almost every free frame between attacks.']
            : [],
      hurt:
        this.earlyMoves > 4
          ? [`${this.earlyMoves} keys went down in the red stretch, and each one threw away a whole attack.`]
          : this.triggerDelayMs() > 260
            ? ['You are holding loaded shots. Under the keys, releasing is what pulls the trigger.']
            : [],
      advice:
        this.earlyMoves > 4
          ? 'Count it out: shoot, then one beat, then move. The beat is the windup, and it is a fifth of a second long.'
          : this.freeWindowUse() < 0.5
            ? 'The green stretch is free and you are spending it standing. Every backswing is a step you already paid for.'
            : this.triggerDelayMs() > 260
              ? 'Let go earlier. The shot fires the instant your hand comes off the keys, not the instant the timer is up.'
              : null,
    };
  }
}
