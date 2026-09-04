import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct, units } from '../base';
import { DUMMY_ATTACK, WasdDrill, bandIf } from './engine';

interface Mark {
  actor: Actor;
  born: number;
  ttl: number;
}

/**
 * WASD 04 — AIM WHILE MOVING.
 *
 * Everybody can click a target. The question this module asks is what your
 * feet were doing at the moment you did, because the half-second pause people
 * take to be sure of a click is the single most common way a won fight turns
 * into a lost one.
 *
 * A mark taken on the move is worth full marks. The same mark taken standing
 * still is worth a fraction of one — not zero, because it is not nothing, but
 * far too little to build a run out of. And to make sure standing still is
 * never merely *suboptimal*, the ground you are standing on is periodically
 * the ground something lands on.
 *
 * Four things are measured and reported separately, because they fail
 * separately: accuracy, how long acquiring took, how much of the run your feet
 * were live, and how far the mouse travelled to do it.
 */
export class WasdAimMoveDrill extends WasdDrill {
  protected get moduleWeight(): number {
    return 0.72;
  }

  private marks: Mark[] = [];
  private spawnCd = 0.4;
  private hazardCd = 2.4;

  private clicks = 0;
  private hits = 0;
  private movingHits = 0;
  private expired = 0;
  private acquisitions: number[] = [];
  private switches: number[] = [];
  private lastKillAt = -1;
  private lastKillPos: Vec2 | null = null;
  private travelAtLastKill = 0;
  private wastedTravel = 0;
  private hitsTaken = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.55 }, { range: 0, damage: 0 });
    p.maxHp = 1200;
    p.hp = 1200;
  }

  onStart(): void {
    this.s.setBanner('TAKE THEM ALL — AND NEVER STOP TO DO IT', 2.6);
    for (let i = 0; i < 2; i++) this.spawn();
  }

  private concurrency(): number {
    return this.d > 0.6 ? 3 : 2;
  }

  private ttl(): number {
    return clamp(2.6 - this.d * 1.1, 1.2, 2.8);
  }

  private spawn(): void {
    const p = this.player;
    const pos = this.randomPoint(p?.pos ?? null, 260, 130);
    const a = this.s.world.spawnActor({
      pos,
      team: 'enemy',
      maxHp: 10,
      radius: 34 - this.d * 8,
      moveSpeed: 0,
      label: 'MARK',
      attack: { ...DUMMY_ATTACK },
      immovable: true,
    });
    this.tasks++;
    this.marks.push({ actor: a, born: this.s.elapsed, ttl: this.ttl() });
  }

  protected tickModule(dt: number): void {
    this.spawnCd -= dt;
    if (this.spawnCd <= 0 && this.marks.length < this.concurrency()) {
      this.spawnCd = clamp(0.9 - this.d * 0.4, 0.28, 1);
      this.spawn();
    }

    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mk = this.marks[i];
      if (this.s.elapsed - mk.born <= mk.ttl) continue;
      this.marks.splice(i, 1);
      mk.actor.alive = false;
      this.expired++;
      this.penalize(mk.actor.pos, 'EXPIRED', 55);
    }
    this.s.world.actors = this.s.world.actors.filter((x) => x.alive || x.id === this.s.world.playerId);

    // The ground you are standing on is not a safe place to be standing.
    this.hazardCd -= dt;
    const p = this.player;
    if (this.hazardCd <= 0 && p) {
      this.hazardCd = clamp(2.6 - this.d * 1.1, 1.1, 2.8);
      this.s.world.spawnHazard({
        pos: { x: p.pos.x, y: p.pos.y },
        team: 'enemy',
        shape: 'circle',
        radius: 132,
        warn: clamp(1 - this.d * 0.35, 0.5, 1),
        active: 0.3,
        damage: 70,
        color: PALETTE.danger,
      });
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    const p = this.player;
    for (const e of events) {
      if (e.type === 'damage' && e.targetId === pid && p) {
        this.hitsTaken++;
        this.nudge(p.pos, 'STOOD IN IT', 45);
      }
    }
  }

  /** A click that landed on nothing is the miss this module counts. */
  onClick(pos: Vec2): boolean {
    this.clicks++;
    const on = this.marks.some((m) => dist(pos, m.actor.pos) < m.actor.radius + 26);
    if (!on) {
      const p = this.player;
      if (p) this.nudge(pos, 'MISSED', 20);
    }
    return false;
  }

  onTargetOrder(a: Actor): void {
    const i = this.marks.findIndex((m) => m.actor.id === a.id);
    if (i < 0) return;
    const mk = this.marks[i];
    const p = this.player;
    this.marks.splice(i, 1);
    a.alive = false;
    this.hits++;

    const age = (this.s.elapsed - mk.born) * 1000;
    this.acquisitions.push(age);
    if (this.lastKillAt >= 0) this.switches.push((this.s.elapsed - this.lastKillAt) * 1000);

    // Unnecessary cursor travel: everything the mouse did between two marks
    // beyond the straight line that joined them.
    const travelled = this.cursorTravel - this.travelAtLastKill;
    const straight = this.lastKillPos ? dist(this.lastKillPos, a.pos) : travelled;
    this.wastedTravel += Math.max(0, travelled - straight);
    this.noteUsefulTravel(Math.min(travelled, straight));
    this.travelAtLastKill = this.cursorTravel;
    this.lastKillAt = this.s.elapsed;
    this.lastKillPos = { x: a.pos.x, y: a.pos.y };

    const moving = p !== undefined && p.moveDir !== null;
    if (moving) this.movingHits++;
    const q = clamp(1 - age / (mk.ttl * 1000), 0, 1);
    if (moving) {
      this.award(a.pos, { value: 120, quality: q, reaction: age, label: q > 0.7 ? 'CLEAN' : undefined });
    } else {
      // Counted, credited, and pointedly not worth much.
      this.solved++;
      this.scoreAcc += 35;
      this.reactions.push(age);
      this.s.metrics.noteReaction(age);
      this.s.micro('STOOD STILL', a.pos, PALETTE.warn);
    }
  }

  // ------------------------------------------------------------------ paint

  protected paintModule(out: DrillPaint, _t: number): void {
    for (const mk of this.marks) {
      const left = clamp(1 - (this.s.elapsed - mk.born) / mk.ttl, 0, 1);
      out.markers.push({
        kind: 'ring',
        x: mk.actor.pos.x,
        y: mk.actor.pos.y,
        radius: mk.actor.radius + 18,
        color: left > 0.4 ? PALETTE.accent : PALETTE.warn,
        alpha: 0.85,
        width: 3,
        progress: left,
        rise: 0.8,
      });
    }
    const p = this.player;
    if (p && p.moveDir === null) {
      out.billboards.push({
        kind: 'label',
        x: p.pos.x,
        y: p.pos.y,
        text: 'STATIONARY',
        color: PALETTE.warn,
        size: 13,
        sub: 'marks are worth a third',
      });
    }
  }

  // -------------------------------------------------------------------- hud

  private accuracy(): number {
    return this.clicks > 0 ? clamp(this.hits / this.clicks, 0, 1) : 0;
  }

  private movingShare(): number {
    return this.hits > 0 ? clamp(this.movingHits / this.hits, 0, 1) : 0;
  }

  private avg(list: number[]): number {
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  }

  protected moduleField(): HudField {
    const s = this.movingShare();
    return {
      label: 'TAKEN ON THE MOVE',
      value: `${Math.round(s * 100)}%`,
      bar: s,
      tone: s > 0.8 ? 'good' : s > 0.5 ? 'warn' : 'bad',
    };
  }

  protected quality(): number {
    const acc = this.accuracy();
    const moving = this.movingShare();
    // Acquisition time and travel economy only mean anything once something
    // has actually been acquired: with no marks taken they are not perfect,
    // they are absent.
    const speed = bandIf(this.acquisitions.length, this.avg(this.acquisitions), 1500, 380);
    const answered = this.tasks > 0 ? clamp(this.hits / this.tasks, 0, 1) : 0;
    const economy = bandIf(this.hits, this.wastedTravel / Math.max(1, this.hits), 900, 120);
    return clamp(acc * 0.24 + moving * 0.28 + speed * 0.2 + answered * 0.18 + economy * 0.1, 0, 1);
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return {
      aim: clamp(this.accuracy() * 0.5 + performance * 0.5, 0, 1),
      movement: clamp(this.movingShare() * 0.6 + performance * 0.4, 0, 1),
      targeting: performance,
    };
  }

  protected moduleMetrics(): KeyMetric[] {
    return [
      pct('movingHits', 'MARKS TAKEN ON THE MOVE', this.movingShare()),
      pct('accuracy', 'CLICK ACCURACY', this.accuracy()),
      ms('acquire', 'ACQUISITION TIME', this.avg(this.acquisitions)),
      ms('switch', 'TARGET SWITCH', this.avg(this.switches)),
      units('waste', 'CURSOR TRAVEL WASTED', this.wastedTravel / Math.max(1, this.hits)),
      count('expired', 'MARKS LOST', this.expired, 'lower'),
      count('haz', 'HAZARDS EATEN', this.hitsTaken, 'lower'),
    ];
  }

  protected notes() {
    return {
      helped: this.movingShare() > 0.85 ? ['You almost never stopped to shoot. That is the module.'] : [],
      hurt: this.hitsTaken > 4 ? [`${this.hitsTaken} circles landed on you — the cost of standing to aim.`] : [],
      advice:
        this.movingShare() < 0.6
          ? 'You are releasing the keys to click. You do not have to: the cursor is a separate hand and it can do this on its own.'
          : this.accuracy() < 0.7
            ? 'Slow the mouse slightly. At this accuracy the extra hand speed is costing more marks than it is winning.'
            : this.avg(this.acquisitions) > 900
              ? 'You are confirming before you commit. Move the cursor to the mark and click in the same motion.'
              : null,
    };
  }
}
