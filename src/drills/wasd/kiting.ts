import { clamp, dist, median, norm } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct, secs } from '../base';
import { WasdDrill, band, bandIf } from './engine';

/**
 * The kiting family — modules 06, 07 and 08.
 *
 * All three run the same cycle and all three refuse, on principle, to score
 * the number of inputs it took. An orbwalk is two commands whose *timing* is
 * the entire skill: a step a fifth of a second early throws away an attack,
 * the same step a fifth of a second late throws away a step, and both of them
 * look identical in an APM counter. So what is measured here is when each
 * command arrived relative to the attack cycle, and every way of getting that
 * wrong has its own name and its own number:
 *
 *   cancelled     — a key down during the windup. The attack is simply gone.
 *   early         — the same mistake, named before the cancel lands.
 *   rooted        — standing still with a free window running.
 *   wasted        — a backswing that ended without a step in it.
 *   spam          — the same command again, inside a tenth of a second.
 *   lost target   — in range, with nothing acquired to shoot at.
 *   closing       — walking toward something you are already in range of.
 *
 * The last one is the one nobody counts and everybody does.
 */
abstract class KiteModule extends WasdDrill {
  protected get moduleWeight(): number {
    return 0.78;
  }

  protected attacks = 0;
  protected cancels = 0;
  protected earlyMoves = 0;
  protected wastedWindows = 0;
  protected spam = 0;
  protected rootedTime = 0;
  protected lostTargetTime = 0;
  protected closingTime = 0;
  protected hitsTaken = 0;

  protected stepDelays: number[] = [];
  private awaitingStep = -1;
  private movedThisWindow = false;
  private inBackswing = false;
  private idleFor = 0;
  private rootedFlagged = false;
  private lastOrderAt = -1;
  private lastDirAt = -1;

  /** Distance from the nearest enemy, sampled, against the ideal band. */
  private rangeSamples = 0;
  private rangeSum = 0;

  protected abstract populate(): void;
  /** The distance this module wants held, as a share of your attack range. */
  protected idealBand(): [number, number] {
    return [0.82, 1];
  }

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.7 });
    p.maxHp = 1900;
    p.hp = 1900;
    this.populate();
  }

  protected nearest(): Actor | null {
    const p = this.player;
    if (!p) return null;
    let best: Actor | null = null;
    let bd = Infinity;
    for (const e of this.s.world.enemies()) {
      const d = dist(p.pos, e.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  protected tickModule(dt: number): void {
    this.updateBrains(dt);
    const p = this.player;
    if (!p) return;
    const e = this.nearest();

    // Rooted: a free window running with nobody using it.
    const free = p.phase !== 'windup' && p.moveDir === null;
    if (free) {
      this.idleFor += dt;
      if (this.idleFor > 0.5) {
        this.rootedTime += dt;
        if (!this.rootedFlagged && this.idleFor > 0.9) {
          this.rootedFlagged = true;
          this.nudge(p.pos, 'STANDING STILL', 30);
        }
      }
    } else {
      this.idleFor = 0;
      this.rootedFlagged = false;
    }

    if (e) {
      const gap = dist(p.pos, e.pos) - e.radius;
      const reach = p.attack.range;
      this.rangeSamples++;
      this.rangeSum += clamp(gap / Math.max(1, reach), 0, 1.6);

      // In range with nothing acquired: a cycle you are not taking.
      const t = this.s.world.byId(p.targetId);
      if (gap <= reach && (!t || !t.alive)) this.lostTargetTime += dt;

      // Closing on something already inside your reach. The most expensive
      // habit in the game, and the one with no feedback attached to it.
      if (gap <= reach * this.idealBand()[0] && p.moveDir) {
        const toward = norm(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
        if (p.moveDir.x * toward.x + p.moveDir.y * toward.y > 0.5) this.closingTime += dt;
      }
    }

    const nowBackswing = p.phase === 'backswing';
    if (this.inBackswing && !nowBackswing) {
      if (!this.movedThisWindow) {
        this.wastedWindows++;
        this.nudge(p.pos, 'WINDOW WASTED', 30);
      }
      this.awaitingStep = -1;
    }
    this.inBackswing = nowBackswing;

    this.tickKite(dt);
  }

  protected tickKite(_dt: number): void {}

  protected onDirection(_dir: Vec2, started: boolean): void {
    const p = this.player;
    if (!p) return;
    // Input spam: the same hand, twice, inside a tenth of a second. It buys
    // nothing and it is what an APM number would happily pay for.
    if (this.lastDirAt >= 0 && this.s.elapsed - this.lastDirAt < 0.1) this.spam++;
    this.lastDirAt = this.s.elapsed;
    if (!started) return;

    if (p.phase === 'windup') {
      this.earlyMoves++;
      this.penalize(p.pos, 'EARLY — ATTACK LOST', 85);
      return;
    }
    if (this.awaitingStep >= 0) {
      const delay = (this.s.elapsed - this.awaitingStep) * 1000;
      this.stepDelays.push(delay);
      this.awaitingStep = -1;
      this.movedThisWindow = true;
      this.tasks++;
      const q = clamp(1 - delay / 420, 0, 1);
      this.award(p.pos, { value: 105, quality: q, label: q > 0.75 ? 'ON THE BEAT' : undefined });
    }
  }

  onClick(_pos: Vec2, kind: 'move' | 'attackMove'): boolean {
    // Re-issuing the order you already gave. Under the keys the mouse only
    // ever names a target, so naming the same one twice is pure waste.
    if (this.lastOrderAt >= 0 && this.s.elapsed - this.lastOrderAt < 0.12) this.spam++;
    this.lastOrderAt = this.s.elapsed;
    void kind;
    return false;
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    const p = this.player;
    for (const e of events) {
      if (!p) break;
      if (e.type === 'attackRelease' && e.actorId === pid) {
        this.attacks++;
        this.awaitingStep = this.s.elapsed;
        this.movedThisWindow = false;
        this.tasks++;
        this.onShot(e);
      } else if (e.type === 'attackCancel' && e.actorId === pid) {
        this.cancels++;
      } else if (e.type === 'damage' && e.targetId === pid) {
        this.hitsTaken++;
        this.onTaken(e);
      }
    }
  }

  /** What a landed attack is worth. The modules disagree, on purpose. */
  protected onShot(_e: WorldEvent): void {
    const p = this.player;
    if (p) this.award(p.pos, { value: 110, quality: 0.7 });
  }

  protected onTaken(e: WorldEvent): void {
    const p = this.player;
    if (p) this.penalize(e.pos ?? p.pos, 'TAKEN', 70);
  }

  // -------------------------------------------------------------- queries

  protected stepDelay(): number {
    return this.stepDelays.length ? median(this.stepDelays) : 0;
  }

  protected uptime(): number {
    const p = this.player;
    if (!p) return 0;
    const cycle = 1 / Math.max(0.1, p.attack.attackSpeed);
    return clamp(this.attacks / Math.max(1, this.s.elapsed / cycle), 0, 1);
  }

  protected cleanliness(): number {
    return this.attacks + this.cancels > 0 ? clamp(1 - this.cancels / (this.attacks + this.cancels), 0, 1) : 0;
  }

  /** Mean gap held, as a share of your own range. */
  protected heldRange(): number {
    return this.rangeSamples > 0 ? this.rangeSum / this.rangeSamples : 0;
  }

  /** How close the held gap is to the band this module wants. */
  protected bandFit(): number {
    const [lo, hi] = this.idealBand();
    const r = this.heldRange();
    if (r >= lo && r <= hi) return 1;
    const off = r < lo ? lo - r : r - hi;
    return clamp(1 - off / 0.42, 0, 1);
  }

  protected freeWindowUse(): number {
    const m = this.s.metrics.m;
    return m.freeWindow > 0.4 ? clamp(m.freeWindowMoving / m.freeWindow, 0, 1) : 0;
  }

  protected timingScore(): number {
    // Timing is a claim about attacks. Without any, there is no claim to make.
    if (this.attacks === 0) return 0;
    return clamp(
      this.cleanliness() * 0.3 +
        bandIf(this.stepDelays.length, this.stepDelay(), 700, 90) * 0.24 +
        this.uptime() * 0.24 +
        this.freeWindowUse() * 0.22,
      0,
      1,
    );
  }

  /** Everything the module explicitly penalizes, as one 0..1 figure. */
  protected discipline(): number {
    const run = Math.max(1, this.s.elapsed);
    return clamp(
      band(this.rootedTime / run, 0.35, 0.02) * 0.3 +
        band(this.closingTime / run, 0.25, 0.01) * 0.24 +
        band(this.lostTargetTime / run, 0.3, 0.02) * 0.22 +
        band(this.spam / Math.max(6, this.attacks), 0.7, 0.05) * 0.14 +
        band(this.wastedWindows / Math.max(4, this.attacks), 0.6, 0.05) * 0.1,
      0,
      1,
    );
  }

  protected paintModule(out: DrillPaint, _t: number): void {
    const p = this.player;
    if (!p) return;
    this.paintCadence(out);
    const [lo, hi] = this.idealBand();
    out.markers.push({
      kind: 'ring',
      x: p.pos.x,
      y: p.pos.y,
      radius: p.attack.range * lo,
      color: PALETTE.warn,
      alpha: 0.22,
      width: 2,
      rise: 0.4,
    });
    out.markers.push({
      kind: 'ring',
      x: p.pos.x,
      y: p.pos.y,
      radius: p.attack.range * hi,
      color: PALETTE.good,
      alpha: 0.3,
      width: 2,
      rise: 0.45,
    });
  }

  protected moduleMetrics(): KeyMetric[] {
    return [
      ms('stepDelay', 'STEP AFTER THE SHOT', this.stepDelay()),
      pct('uptime', 'ATTACK UPTIME', this.uptime()),
      pct('freeWindow', 'FREE WINDOW USED', this.freeWindowUse()),
      count('cancels', 'ATTACKS CANCELLED', this.cancels, 'lower'),
      secs('rooted', 'TIME STANDING STILL', this.rootedTime, 'lower'),
      secs('closing', 'TIME CLOSING IN RANGE', this.closingTime, 'lower'),
      secs('lost', 'TIME WITH NO TARGET', this.lostTargetTime, 'lower'),
      count('spam', 'REPEATED COMMANDS', this.spam, 'lower'),
    ];
  }
}

/**
 * WASD 06 — KITING.
 *
 * The cycle on its own, against something that walks at you and can barely
 * hurt you. Nothing here is about survival; the only question is whether the
 * two commands can hold a full attack cycle for a minute with every one of
 * them arriving at the right moment.
 */
export class WasdKiteDrill extends KiteModule {
  protected populate(): void {
    const { w, h } = this.s.world.bounds;
    const a = this.spawnEnemy('juggernaut', { x: w * 0.5, y: h * 0.3 }, { hpScale: 14 });
    a.attack.damage = 8;
    a.moveSpeed *= 0.66;
    a.label = 'PACE DUMMY';
  }

  protected tickKite(_dt: number): void {
    if (this.s.world.enemies().length === 0) this.populate();
  }

  protected quality(): number {
    return clamp(this.timingScore() * 0.72 + this.bandFit() * 0.28, 0, 1);
  }

  protected moduleField(): HudField {
    const t = this.timingScore();
    return {
      label: 'CYCLE TIMING',
      value: `${Math.round(t * 100)}%`,
      bar: t,
      tone: t > 0.78 ? 'good' : t > 0.55 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return { kiting: performance, movement: performance, spacing: this.bandFit() };
  }

  protected notes() {
    return {
      helped: this.cancels === 0 && this.attacks > 20 ? ['A whole run without throwing away a windup.'] : [],
      hurt:
        this.closingTime > 4
          ? [`${this.closingTime.toFixed(1)}s spent walking toward something already inside your range.`]
          : [],
      advice:
        this.cancels > 5
          ? 'You are moving on the red. Shoot, wait one beat, then move — the beat is shorter than it feels.'
          : this.rootedTime > 8
            ? 'You are stopping between attacks rather than stepping between them. The backswing is free movement you already own.'
            : null,
    };
  }
}

/**
 * WASD 07 — OFFENSIVE KITING.
 *
 * It runs. You follow.
 *
 * The whole skill is that following is not chasing: every step closer than the
 * one you needed is a step deeper into whatever is behind it, and the fact
 * that the target is running is exactly what makes people take those steps.
 * Attacks landed at the outer edge of your range are worth full marks; the
 * same attack taken from halfway in is worth a fraction of one.
 */
export class WasdOffensiveKiteDrill extends KiteModule {
  private fled = 0;
  private edgeShots = 0;
  private closeShots = 0;
  private runner: Actor | null = null;

  protected idealBand(): [number, number] {
    return [0.86, 1];
  }

  protected populate(): void {
    const { w, h } = this.s.world.bounds;
    const a = this.spawnEnemy('ranger', { x: w * 0.5, y: h * 0.3 }, { hpScale: 9 });
    a.attack.damage = 14;
    a.moveSpeed = 330 + this.d * 40;
    a.label = 'RUNNER';
    this.runner = a;
    // No brain: it is not fighting you, it is leaving. The brains list is
    // cleared so nothing tries to make it hold ground.
    this.brains.length = 0;
  }

  protected tickKite(dt: number): void {
    const p = this.player;
    let e = this.runner;
    if (!e || !e.alive) {
      this.fled++;
      this.populate();
      e = this.runner;
    }
    if (!p || !e) return;
    e.hp = Math.min(e.maxHp, e.hp + dt * 55);

    // It runs from you, and turns along the wall rather than into it.
    const { w, h } = this.s.world.bounds;
    const away = norm(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
    const wobble = Math.sin(this.s.elapsed * 1.7) * 0.5;
    const dir = {
      x: away.x * Math.cos(wobble) - away.y * Math.sin(wobble),
      y: away.x * Math.sin(wobble) + away.y * Math.cos(wobble),
    };
    e.pos.x = clamp(e.pos.x + dir.x * e.moveSpeed * dt, 110, w - 110);
    e.pos.y = clamp(e.pos.y + dir.y * e.moveSpeed * dt, 110, h - 110);
  }

  protected onShot(): void {
    const p = this.player;
    const e = this.runner;
    if (!p || !e) return;
    const gap = dist(p.pos, e.pos) - e.radius;
    const share = clamp(gap / Math.max(1, p.attack.range), 0, 1.2);
    if (share > 0.86) {
      this.edgeShots++;
      this.award(p.pos, { value: 150, quality: 0.9, label: 'MAX RANGE' });
    } else if (share > 0.6) {
      this.award(p.pos, { value: 90, quality: 0.5 });
    } else {
      this.closeShots++;
      this.solved++;
      this.scoreAcc += 30;
      this.s.micro('TOO DEEP', p.pos, PALETTE.warn);
    }
  }

  private edgeShare(): number {
    return this.attacks > 0 ? clamp(this.edgeShots / this.attacks, 0, 1) : 0;
  }

  protected quality(): number {
    return clamp(this.timingScore() * 0.4 + this.edgeShare() * 0.34 + this.bandFit() * 0.26, 0, 1);
  }

  protected moduleField(): HudField {
    const s = this.edgeShare();
    return {
      label: 'SHOTS AT THE EDGE',
      value: `${this.edgeShots} / ${this.attacks}`,
      bar: s,
      tone: s > 0.7 ? 'good' : s > 0.45 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return { kiting: performance, spacing: clamp(this.edgeShare() * 0.6 + this.bandFit() * 0.4, 0, 1), movement: performance };
  }

  protected moduleMetrics(): KeyMetric[] {
    return [
      pct('edgeShots', 'SHOTS AT MAX RANGE', this.edgeShare()),
      pct('rangeHeld', 'RANGE HELD', clamp(this.heldRange(), 0, 1)),
      ...super.moduleMetrics(),
      count('tooDeep', 'SHOTS TAKEN TOO DEEP', this.closeShots, 'lower'),
      count('escaped', 'TARGETS THAT GOT AWAY', this.fled, 'lower'),
    ];
  }

  protected notes() {
    return {
      helped: this.edgeShare() > 0.65 ? ['Two thirds of your damage came from the outer edge of your range.'] : [],
      hurt: this.closeShots > 6 ? [`${this.closeShots} attacks were taken from well inside your reach.`] : [],
      advice:
        this.edgeShare() < 0.4
          ? 'You are chasing rather than following. Step, shoot, step — never two steps between attacks.'
          : this.uptime() < 0.55
            ? 'You are keeping the range and not using it. Every step should end with a shot leaving.'
            : null,
    };
  }
}

/**
 * WASD 08 — DEFENSIVE KITING.
 *
 * They come to you, and the shot you take from inside their reach costs more
 * than it earns. Damage dealt from outside their threat range is the number;
 * damage dealt from inside it barely counts, which is a truthful model of what
 * happens when you trade with a diver because you wanted one more attack.
 */
export class WasdDefensiveKiteDrill extends KiteModule {
  private safeShots = 0;
  private riskyShots = 0;
  private safeTime = 0;

  protected idealBand(): [number, number] {
    return [0.8, 1.05];
  }

  protected populate(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.player;
    const n = this.d > 0.55 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = this.spawnEnemy('diver', { x: w * (0.34 + i * 0.32), y: h * 0.22 }, { hpScale: 3.2 });
      a.label = 'DIVER';
      // A diver is faster than you by default, which is correct for a duel and
      // ruinous for a kiting lesson: against something that simply out-runs
      // you there is no gap to hold, so the module would be scoring an
      // impossibility. Here it is deliberately slower than you are, and the
      // difficulty closes that margin rather than removing it — the whole
      // skill is spending a speed advantage you actually have.
      // The margin is what the module is teaching you to spend, so it has to
      // be a real one: retreating properly holds the gap comfortably, orbiting
      // sideways out of habit loses it slowly, and standing still loses it at
      // once. The difficulty narrows the margin; it never closes it.
      if (p) a.moveSpeed = p.moveSpeed * (0.55 + this.d * 0.22);
    }
  }

  protected tickKite(dt: number): void {
    if (this.s.world.enemies().length === 0) this.populate();
    const p = this.player;
    if (!p) return;
    const e = this.nearest();
    if (!e) return;
    const gap = dist(p.pos, e.pos) - e.radius;
    if (gap > e.attack.range + p.radius) this.safeTime += dt;
  }

  protected onShot(): void {
    const p = this.player;
    const e = this.nearest();
    if (!p || !e) return;
    const gap = dist(p.pos, e.pos) - e.radius;
    if (gap > e.attack.range + p.radius * 0.6) {
      this.safeShots++;
      this.award(p.pos, { value: 150, quality: 0.9, label: 'OUT OF REACH' });
    } else {
      this.riskyShots++;
      this.solved++;
      this.scoreAcc += 35;
      this.s.micro('INSIDE THEIR REACH', p.pos, PALETTE.warn);
    }
  }

  private safeShare(): number {
    return this.attacks > 0 ? clamp(this.safeShots / this.attacks, 0, 1) : 0;
  }

  private safeRatio(): number {
    return clamp(this.safeTime / Math.max(0.5, this.s.elapsed), 0, 1);
  }

  protected quality(): number {
    return clamp(
      this.timingScore() * 0.34 + this.safeShare() * 0.3 + this.safeRatio() * 0.22 + band(this.hitsTaken, 14, 0) * 0.14,
      0,
      1,
    );
  }

  protected moduleField(): HudField {
    const s = this.safeShare();
    return {
      label: 'SAFE DAMAGE',
      value: `${this.safeShots} / ${this.attacks}`,
      bar: s,
      tone: s > 0.75 ? 'good' : s > 0.5 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return {
      kiting: performance,
      spacing: clamp(this.safeRatio() * 0.6 + performance * 0.4, 0, 1),
      dodging: clamp(1 - this.hitsTaken / 14, 0, 1),
    };
  }

  protected moduleMetrics(): KeyMetric[] {
    return [
      pct('safeShots', 'DAMAGE FROM OUTSIDE THEIR REACH', this.safeShare()),
      pct('safeTime', 'TIME OUT OF REACH', this.safeRatio()),
      ...super.moduleMetrics(),
      count('risky', 'SHOTS TAKEN INSIDE THEIR REACH', this.riskyShots, 'lower'),
      count('taken', 'HITS TAKEN', this.hitsTaken, 'lower'),
    ];
  }

  protected notes() {
    return {
      helped: this.safeShare() > 0.8 ? ['Almost all of your damage was dealt from somewhere they could not answer.'] : [],
      hurt: this.riskyShots > 8 ? [`${this.riskyShots} attacks were taken from inside their range — that is trading, not kiting.`] : [],
      advice:
        this.safeShare() < 0.55
          ? 'Step first, shoot second. The urge to get one more attack in before you move is what closes the gap.'
          : this.uptime() < 0.5
            ? 'You are safe and doing nothing. Backing off is only half of it — the shot has to leave on every step.'
            : null,
    };
  }
}
