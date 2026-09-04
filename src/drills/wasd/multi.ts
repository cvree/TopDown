import { audio } from '../../engine/audio';
import { clamp, dist, norm } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { AbilityView, HudField } from '../../engine/session';
import type { AbilitySlot } from '../../engine/input';
import type { Actor, Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct } from '../base';
import { WasdDrill, bandIf } from './engine';

const BOLT_CD = 4.5;
const SHIFT_CD = 7;

/**
 * WASD 09 — MULTITASKING.
 *
 * The last module, and the only one that asks for everything the first eight
 * taught at the same time: feet that never stop, a cursor that holds its own
 * target, two abilities that expire if you sit on them, telegraphs that have
 * to be left, and a priority target that changes while all of it is happening.
 *
 * It is deliberately small — two opponents, one arena, ninety seconds — because
 * the point is not to be overwhelming. The point is to be *just* past what one
 * hand can do alone, so that the thing you drop is visible. And whatever you
 * drop, the drill can name: the load figure is the worst of its five parts
 * rather than their average, because a fight is lost by the thing you stopped
 * doing, not by the four things you kept doing well.
 */
export class WasdMultiDrill extends WasdDrill {
  protected get moduleWeight(): number {
    return 0.8;
  }

  private cd: Record<string, number> = { q: 0, w: 0 };
  private priority: number | null = null;
  private priorityAt = 0;
  private switchCd = 0;
  private switchLatencies: number[] = [];
  private awaitingSwitch = false;

  private onPriority = 0;
  private offPriority = 0;
  private boltsCast = 0;
  private boltsHit = 0;
  private shifts = 0;
  private hazardsFaced = 0;
  private hazardsEaten = 0;
  private hazardCd = 3;
  private hurtCd = 0;
  private attacks = 0;
  private hitsTaken = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.72 });
    // A load test, not a survival test. The run has to last long enough for
    // the five things being measured to have anything to say, so the health
    // pool is generous and the opposition is turned down to match: dying at
    // twenty seconds measures nothing except that you died.
    p.maxHp = 5200;
    p.hp = 5200;
    this.wanted = this.d > 0.65 ? 3 : 2;
    this.spawnOpponent('ranger', { x: w * 0.34, y: h * 0.24 });
    this.spawnOpponent('diver', { x: w * 0.68, y: h * 0.26 });
    if (this.wanted > 2) this.spawnOpponent('controller', { x: w * 0.5, y: h * 0.16 });
  }

  /** How many opponents the arena keeps standing. */
  private wanted = 2;

  private spawnOpponent(kind: 'ranger' | 'diver' | 'controller', at: Vec2): Actor {
    const a = this.spawnEnemy(kind, at, { hpScale: 3.4 });
    a.attack.damage *= 0.4;
    return a;
  }

  onStart(): void {
    this.s.setBanner('ALL OF IT AT ONCE · THE CARET IS THE TARGET', 2.8);
    this.callPriority();
  }

  // ------------------------------------------------------------- priority

  private callPriority(): void {
    const live = this.s.world.enemies();
    if (!live.length) return;
    const options = live.filter((e) => e.id !== this.priority);
    const pick = this.s.rng.pick(options.length ? options : live);
    this.priority = pick.id;
    this.priorityAt = this.s.elapsed;
    this.switchCd = clamp(8 - this.d * 3, 4, 9);
    this.awaitingSwitch = true;
    this.tasks++;
    audio.play('tick', { intensity: 1 });
    this.s.setBanner(`PRIORITY · ${pick.label ?? 'TARGET'}`, 1.2);
  }

  private priorityActor(): Actor | null {
    const a = this.s.world.byId(this.priority);
    return a && a.alive ? a : null;
  }

  // ------------------------------------------------------------ abilities

  onAbility(slot: AbilitySlot, at: Vec2): void {
    const p = this.player;
    if (!p) return;
    if (slot === 'q') {
      if (this.cd.q > 0) return;
      this.cd.q = BOLT_CD;
      this.boltsCast++;
      const d = norm(at.x - p.pos.x, at.y - p.pos.y);
      this.s.world.spawnProjectile({
        pos: { x: p.pos.x + d.x * p.radius, y: p.pos.y + d.y * p.radius },
        team: 'player',
        ownerId: p.id,
        vel: { x: d.x * 1500, y: d.y * 1500 },
        speed: 1500,
        damage: 120,
        targetId: null,
        radius: 18,
        shape: 'shard',
        pierce: true,
        maxLife: 1.2,
        color: PALETTE.accent,
      });
      return;
    }
    if (slot === 'w') {
      if (this.cd.w > 0) return;
      this.cd.w = SHIFT_CD;
      this.shifts++;
      // A dash aimed by the hand that is already pointing somewhere. Under the
      // keys that is the natural reading, and it is the one the module wants:
      // the cursor is busy holding a target.
      const hand = this.s.handDir;
      const dir = hand ?? norm(at.x - p.pos.x, at.y - p.pos.y);
      const reach = this.s.world.terrainAlong(p.pos, dir, 320, p.radius);
      p.pos.x += dir.x * reach.distance;
      p.pos.y += dir.y * reach.distance;
      // A tool rather than a task: it is paid for, but it never counts toward
      // the answered tally, or spending it would look like solving something.
      this.scoreAcc += 60;
      this.s.fx.ring(p.pos.x, p.pos.y, 8, 90, 0.3, PALETTE.violet, 3, 'shock');
      this.s.micro('SHIFT', p.pos, PALETTE.violet);
      audio.play('pickup', { pan: this.s.panOf(p.pos) });
    }
  }

  abilities(): AbilityView[] {
    const base = super.abilities();
    return base.map((a) => {
      if (a.slot === 'q') return { ...a, name: 'BOLT', cd: clamp(this.cd.q / BOLT_CD, 0, 1), highlight: this.cd.q <= 0 };
      if (a.slot === 'w') return { ...a, name: 'SHIFT', cd: clamp(this.cd.w / SHIFT_CD, 0, 1), highlight: this.cd.w <= 0 };
      return a;
    });
  }

  // ---------------------------------------------------------------- frame

  protected tickModule(dt: number): void {
    this.updateBrains(dt);
    const p = this.player;
    if (!p) return;
    this.hurtCd = Math.max(0, this.hurtCd - dt);

    // The fight is kept at strength. Killing one is worth doing and worth
    // celebrating; being left with nothing to do afterwards is not.
    if (this.s.world.enemies().length < this.wanted) {
      const kinds: ('ranger' | 'diver' | 'controller')[] = ['ranger', 'diver', 'controller'];
      this.spawnOpponent(this.s.rng.pick(kinds), this.edgePoint());
    }
    for (const k of Object.keys(this.cd)) this.cd[k] = Math.max(0, this.cd[k] - dt);

    // The priority rotates whether or not you got to the last one.
    this.switchCd -= dt;
    if (this.switchCd <= 0 || !this.priorityActor()) {
      if (this.awaitingSwitch) {
        // Never answered. The call still counts, as a call you missed.
        this.penalize(p.pos, 'PRIORITY MISSED', 80);
        this.awaitingSwitch = false;
      }
      this.callPriority();
    }

    // Where the cursor is, relative to what the drill asked for.
    const target = this.priorityActor();
    if (target) {
      if (dist(this.s.cursorWorld, target.pos) < target.radius + 60) this.onPriority += dt;
      else this.offPriority += dt;
    }

    this.hazardCd -= dt;
    if (this.hazardCd <= 0) {
      this.hazardCd = clamp(3.4 - this.d * 1.5, 1.2, 3.6);
      const lead = 0.55;
      this.s.world.spawnHazard({
        pos: { x: p.pos.x + p.vel.x * lead, y: p.pos.y + p.vel.y * lead },
        team: 'enemy',
        shape: 'circle',
        radius: 150,
        warn: clamp(1.05 - this.d * 0.35, 0.55, 1.1),
        active: 0.32,
        damage: 90,
        color: PALETTE.danger,
      });
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    const p = this.player;
    if (!p) return;
    for (const e of events) {
      // Every telegraph in the arena counts, not only the ones this module
      // places: the opponents cast their own, and a dodge rate measured
      // against half the hazards on the floor is not a dodge rate.
      if (e.type === 'hazardWarn') {
        this.hazardsFaced++;
        continue;
      }
      if (e.type === 'attackRelease' && e.actorId === pid) {
        this.attacks++;
        continue;
      }
      if (e.type === 'damage' && e.targetId === pid) {
        this.hitsTaken++;
        // A hazard's damage has no author; a champion's does. Only the first
        // is a telegraph you were still standing in when it went off.
        if (e.actorId === undefined) this.hazardsEaten++;
        // Rate-limited. Two opponents auto-attacking will land something every
        // second or so no matter how well you play, and a chain that can never
        // survive a single hit is not measuring anything.
        if (this.hurtCd <= 0) {
          this.hurtCd = 1.5;
          this.penalize(e.pos ?? p.pos, 'TAKEN', 55);
        }
        continue;
      }
      if (e.type === 'attackLand' && e.actorId === pid) {
        const hitPriority = e.targetId === this.priority;
        if (hitPriority && this.awaitingSwitch) {
          this.awaitingSwitch = false;
          this.switchLatencies.push((this.s.elapsed - this.priorityAt) * 1000);
          this.award(e.pos ?? p.pos, {
            value: 150,
            quality: clamp(1 - (this.s.elapsed - this.priorityAt) / 2.5, 0, 1),
            label: 'SWITCHED',
            reaction: (this.s.elapsed - this.priorityAt) * 1000,
          });
        } else if (hitPriority) {
          // Damage on the called target, but not the switch itself. It keeps
          // the chain alive and pays, and it is not a task — the tasks are the
          // calls, and only answering one is answering something.
          this.award(e.pos ?? p.pos, { value: 70, quality: 0.6, counts: false });
        } else {
          this.scoreAcc += 15;
        }
        continue;
      }
      if (e.type === 'damage' && e.actorId === pid && e.targetId !== pid) {
        // Bolt damage lands as a plain damage event when it pierces.
        if (e.targetId === this.priority) this.boltsHit++;
      }
    }
  }

  // ----------------------------------------------------------------- paint

  protected paintModule(out: DrillPaint, _t: number): void {
    const p = this.player;
    if (!p) return;
    this.paintCadence(out);
    const target = this.priorityActor();
    if (target) {
      out.billboards.push({ kind: 'caret', x: target.pos.x, y: target.pos.y, color: PALETTE.warn });
      out.markers.push({
        kind: 'ring',
        x: target.pos.x,
        y: target.pos.y,
        radius: target.radius + 22,
        color: PALETTE.warn,
        alpha: 0.7,
        width: 2.5,
        dash: 18,
        spin: 0.8,
        rise: 0.7,
      });
    }
    if (this.cd.q <= 0) {
      const d = norm(this.s.cursorWorld.x - p.pos.x, this.s.cursorWorld.y - p.pos.y);
      out.markers.push({
        kind: 'line',
        x: p.pos.x,
        y: p.pos.y,
        x2: p.pos.x + d.x * 900,
        y2: p.pos.y + d.y * 900,
        halfWidth: 14,
        color: PALETTE.accentDim,
        alpha: 0.16,
        rise: 0.3,
      });
    }
  }

  // ------------------------------------------------------------------- hud

  private priorityShare(): number {
    const total = this.onPriority + this.offPriority;
    return total > 0.5 ? clamp(this.onPriority / total, 0, 1) : 0;
  }

  private switchSpeed(): number {
    return this.switchLatencies.length
      ? this.switchLatencies.reduce((a, b) => a + b, 0) / this.switchLatencies.length
      : 0;
  }

  private abilityUse(): number {
    // Every cooldown that came up should have been spent. Two abilities, one
    // run's worth of charges, against what you actually cast.
    const possible = this.s.elapsed / BOLT_CD + this.s.elapsed / SHIFT_CD;
    return clamp((this.boltsCast + this.shifts) / Math.max(1, possible), 0, 1);
  }

  private dodgeRate(): number {
    return this.hazardsFaced > 0 ? clamp(1 - this.hazardsEaten / this.hazardsFaced, 0, 1) : 1;
  }

  private attackUptime(): number {
    const p = this.player;
    if (!p) return 0;
    const cycle = 1 / Math.max(0.1, p.attack.attackSpeed);
    return clamp(this.attacks / Math.max(1, this.s.elapsed / cycle), 0, 1);
  }

  /**
   * The load, which is the worst of the five things rather than their mean.
   *
   * Averaging would let somebody who stopped moving entirely still read as
   * "72%", and that is exactly the run this module exists to catch.
   */
  private load(): number {
    const parts = [
      this.moveUptime() / 0.75,
      this.attackUptime(),
      this.abilityUse(),
      this.dodgeRate(),
      this.priorityShare(),
    ].map((x) => clamp(x, 0, 1));
    const worst = Math.min(...parts);
    const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
    return clamp(worst * 0.45 + mean * 0.55, 0, 1);
  }

  protected moduleField(): HudField {
    const l = this.load();
    return {
      label: 'LOAD CARRIED',
      value: `${Math.round(l * 100)}%`,
      bar: l,
      tone: l > 0.72 ? 'good' : l > 0.5 ? 'warn' : 'bad',
    };
  }

  protected quality(): number {
    // Damage taken is priced per minute rather than per run, so a longer
    // module is not automatically a worse one. And taking none is only an
    // achievement if you were in the fight at all: with nothing attempted, an
    // untouched champion scores nothing for it.
    const perMinute = (this.hitsTaken / Math.max(5, this.s.elapsed)) * 60;
    return clamp(this.load() * 0.72 + bandIf(this.attacks + this.boltsCast, perMinute, 90, 14) * 0.28, 0, 1);
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return {
      combat: performance,
      targeting: clamp(this.priorityShare() * 0.5 + performance * 0.5, 0, 1),
      dodging: this.dodgeRate(),
      kiting: clamp(this.attackUptime() * 0.5 + performance * 0.5, 0, 1),
    };
  }

  protected moduleMetrics(): KeyMetric[] {
    return [
      pct('load', 'LOAD CARRIED', this.load()),
      pct('priority', 'CURSOR ON THE PRIORITY', this.priorityShare()),
      ms('switch', 'SWITCH LATENCY', this.switchSpeed()),
      pct('abilities', 'COOLDOWNS SPENT', this.abilityUse()),
      pct('dodge', 'TELEGRAPHS LEFT', this.dodgeRate()),
      pct('attackUp', 'ATTACK UPTIME', this.attackUptime()),
      count('taken', 'HITS TAKEN', this.hitsTaken, 'lower'),
    ];
  }

  protected notes() {
    const parts: { name: string; v: number }[] = [
      { name: 'your feet', v: clamp(this.moveUptime() / 0.75, 0, 1) },
      { name: 'your attacks', v: this.attackUptime() },
      { name: 'your cooldowns', v: this.abilityUse() },
      { name: 'the telegraphs', v: this.dodgeRate() },
      { name: 'the priority target', v: this.priorityShare() },
    ];
    const worst = parts.reduce((a, b) => (a.v <= b.v ? a : b));
    return {
      helped: this.load() > 0.75 ? ['Nothing was dropped. That is what this module is for.'] : [],
      hurt: worst.v < 0.55 ? [`Under load, the first thing you dropped was ${worst.name}.`] : [],
      advice:
        worst.v < 0.55
          ? `Run it again and give ${worst.name} one deliberate thought per exchange. It is the only part that is actually short.`
          : 'Every part of the load is being carried. Raise the difficulty and find the one that breaks first.',
    };
  }
}
