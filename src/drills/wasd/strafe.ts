import { audio } from '../../engine/audio';
import { clamp, dist, norm } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, pct } from '../base';
import { DUMMY_ATTACK, WasdDrill } from './engine';

interface Shot {
  /** Where the shooter committed to, taken the moment the tell began. */
  aim: Vec2;
  telegraph: number;
  /** The player's heading when the shooter committed. */
  heading: Vec2 | null;
  changed: boolean;
}

/**
 * WASD 03 — STRAFING.
 *
 * A skillshot is aimed at where you are going to be, so the entire counter is
 * to be somewhere else by the time it arrives. Under a mouse that is a click;
 * under the keys it is a release and a different key, which is both faster and
 * far more repeatable — and repeatable is the problem, because a player who
 * changes direction on a rhythm is aiming the skillshot for their opponent.
 *
 * So this module scores three separate things and refuses to let one carry the
 * others: how much of your movement is across the shooter's line rather than
 * along it, how unreadable the timing of your changes is, and how often the
 * shooter actually committed to a place you were no longer going.
 *
 * The last one is the real skill. Every shot shows its tell, and the shooter
 * locks its aim the instant the tell starts — so a direction change after that
 * moment is a bait, and it is the only thing in the drill worth full marks.
 */
export class WasdStrafeDrill extends WasdDrill {
  protected get moduleWeight(): number {
    return 0.78;
  }

  private shooter: Actor | null = null;
  private shot: Shot | null = null;
  private fireCd = 2;

  private telegraphs = 0;
  private baits = 0;
  private hits = 0;

  /** Movement decomposed against the shooter's line, sampled each step. */
  private lateralSum = 0;
  private movementSum = 0;
  /** Direction changes taken while a tell was live. */
  private changesUnderTell = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.68 });
    p.maxHp = 1400;
    p.hp = 1400;
    this.shooter = this.s.world.spawnActor({
      pos: { x: w * 0.5, y: h * 0.16 },
      team: 'enemy',
      maxHp: 100000,
      radius: 32,
      moveSpeed: 0,
      attack: { ...DUMMY_ATTACK },
      label: 'SHOOTER',
      immovable: true,
      archetype: 'artillery',
    });
  }

  onStart(): void {
    this.s.setBanner('STRAFE ACROSS ITS LINE · CHANGE ON NO RHYTHM', 2.6);
  }

  /** Seconds between shots. Tightens with difficulty and with your own flow. */
  private interval(): number {
    return clamp(2.4 - this.d * 1.1 - Math.min(this.chain, 20) * 0.02, 0.85, 2.6);
  }

  /** How long the tell runs. The window you have to make it wrong. */
  private tell(): number {
    return clamp(0.75 - this.d * 0.28, 0.34, 0.8);
  }

  protected onDirection(_dir: Vec2, _started: boolean): void {
    if (this.shot) {
      this.shot.changed = true;
      this.changesUnderTell++;
    }
  }

  protected tickModule(dt: number): void {
    const p = this.player;
    const sh = this.shooter;
    if (!p || !sh) return;

    // The shooter slides along the top of the arena so the line you have to
    // strafe across keeps turning, and "lateral" never becomes one key.
    const { w, h } = this.s.world.bounds;
    sh.pos.x = w * 0.5 + Math.sin(this.s.elapsed * 0.35) * w * 0.3;
    sh.pos.y = h * 0.16 + Math.cos(this.s.elapsed * 0.22) * h * 0.05;
    sh.hp = sh.maxHp;

    this.sampleLateral(dt, p, sh);

    if (this.shot) {
      this.shot.telegraph -= dt;
      if (this.shot.telegraph <= 0) this.fire(sh);
      return;
    }
    this.fireCd -= dt;
    if (this.fireCd <= 0) this.beginTell(p, sh);
  }

  /**
   * How much of your movement is across the line rather than up and down it.
   *
   * Running straight at a skillshot or straight away from it is the same
   * mistake wearing two hats: neither changes the angle, and the angle is the
   * only thing that makes a linear skillshot miss.
   */
  private sampleLateral(dt: number, p: Actor, sh: Actor): void {
    const v = Math.hypot(p.vel.x, p.vel.y);
    if (v < 12) return;
    const line = norm(p.pos.x - sh.pos.x, p.pos.y - sh.pos.y);
    const along = Math.abs((p.vel.x * line.x + p.vel.y * line.y) / v);
    const across = clamp(1 - along, 0, 1);
    this.movementSum += dt;
    this.lateralSum += across * dt;
  }

  private beginTell(p: Actor, sh: Actor): void {
    const speed = 1150;
    const flight = dist(p.pos, sh.pos) / speed;
    // The shooter leads you from your heading at this instant and then commits.
    // Everything you do from here decides whether it was right.
    const aim = {
      x: p.pos.x + p.vel.x * flight * (0.7 + this.d * 0.5),
      y: p.pos.y + p.vel.y * flight * (0.7 + this.d * 0.5),
    };
    this.telegraphs++;
    this.tasks++;
    this.shot = {
      aim,
      telegraph: this.tell(),
      heading: p.moveDir ? { x: p.moveDir.x, y: p.moveDir.y } : null,
      changed: false,
    };
    audio.play('telegraph', { intensity: 0.85, pan: this.s.panOf(sh.pos) });
  }

  private fire(sh: Actor): void {
    const s = this.shot;
    if (!s) return;
    const d = norm(s.aim.x - sh.pos.x, s.aim.y - sh.pos.y);
    this.s.world.spawnProjectile({
      pos: { x: sh.pos.x + d.x * sh.radius, y: sh.pos.y + d.y * sh.radius },
      team: 'enemy',
      ownerId: sh.id,
      vel: { x: d.x * 1150, y: d.y * 1150 },
      speed: 1150,
      damage: 55,
      targetId: null,
      radius: 26,
      shape: 'wave',
      maxLife: 2.4,
      color: PALETTE.danger,
    });
    this.pending.push({ changed: s.changed, at: this.s.elapsed, resolved: false });
    this.shot = null;
    this.fireCd = this.interval();
  }

  /** Shots in flight, so a hit can be matched back to whether you baited it. */
  private pending: { changed: boolean; at: number; resolved: boolean }[] = [];

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    const p = this.player;
    for (const e of events) {
      if (e.type === 'damage' && e.targetId === pid && p) {
        this.hits++;
        const live = this.pending.find((x) => !x.resolved);
        if (live) live.resolved = true;
        this.penalize(p.pos, 'HIT', 80);
      }
    }
  }

  update(dt: number): void {
    super.update(dt);
    const p = this.player;
    if (!p) return;
    // A shot resolves when it can no longer reach you. A miss you caused by
    // changing direction under the tell is a bait; a miss you got for standing
    // in a place it was never aimed at is just a miss.
    for (const s of this.pending) {
      if (s.resolved || this.s.elapsed - s.at < 1.3) continue;
      s.resolved = true;
      if (s.changed) {
        this.baits++;
        this.award(p.pos, { value: 160, quality: 0.9, label: 'BAITED' });
      } else {
        this.solved++;
        this.scoreAcc += 45;
        this.s.micro('MISSED YOU', p.pos, PALETTE.textDim);
      }
    }
    if (this.pending.length > 40) this.pending.splice(0, this.pending.length - 40);
  }

  // ------------------------------------------------------------------ paint

  protected paintModule(out: DrillPaint, t: number): void {
    const sh = this.shooter;
    const s = this.shot;
    if (!sh) return;
    if (s) {
      const left = clamp(s.telegraph / this.tell(), 0, 1);
      const d = norm(s.aim.x - sh.pos.x, s.aim.y - sh.pos.y);
      out.markers.push({
        kind: 'line',
        x: sh.pos.x,
        y: sh.pos.y,
        x2: sh.pos.x + d.x * 1600,
        y2: sh.pos.y + d.y * 1600,
        halfWidth: 26,
        color: PALETTE.danger,
        alpha: 0.22 + (1 - left) * 0.3,
        fill: 0.2,
        progress: 1 - left,
        rise: 0.35,
      });
      out.markers.push({
        kind: 'cross',
        x: s.aim.x,
        y: s.aim.y,
        radius: 30,
        color: PALETTE.danger,
        alpha: 0.75,
        width: 2.5,
        rise: 0.5,
      });
      out.billboards.push({
        kind: 'label',
        x: s.aim.x,
        y: s.aim.y,
        text: s.changed ? 'COMMITTED — YOU LEFT' : 'IT THINKS YOU ARE GOING HERE',
        color: s.changed ? PALETTE.good : PALETTE.warn,
        size: 12,
      });
    }
    const p = this.player;
    if (p) {
      // The lateral axis, drawn on the floor: the direction that actually
      // makes the shot miss, at every moment.
      const line = norm(p.pos.x - sh.pos.x, p.pos.y - sh.pos.y);
      const perp = { x: -line.y, y: line.x };
      out.markers.push({
        kind: 'line',
        x: p.pos.x - perp.x * 190,
        y: p.pos.y - perp.y * 190,
        x2: p.pos.x + perp.x * 190,
        y2: p.pos.y + perp.y * 190,
        halfWidth: 2,
        color: PALETTE.good,
        alpha: 0.24,
        rise: 0.3,
      });
    }
    void t;
  }

  // -------------------------------------------------------------------- hud

  private lateralRatio(): number {
    return this.movementSum > 0.4 ? clamp(this.lateralSum / this.movementSum, 0, 1) : 0;
  }

  private baitRate(): number {
    return this.telegraphs > 0 ? clamp(this.baits / this.telegraphs, 0, 1) : 0;
  }

  private dodgeRate(): number {
    return this.telegraphs > 0 ? clamp(1 - this.hits / this.telegraphs, 0, 1) : 1;
  }

  protected moduleField(): HudField {
    const b = this.baitRate();
    return {
      label: 'BAITED',
      value: `${this.baits} / ${this.telegraphs}`,
      bar: b,
      tone: b > 0.55 ? 'good' : b > 0.3 ? 'warn' : 'bad',
    };
  }

  protected quality(): number {
    return clamp(
      this.baitRate() * 0.34 + this.dodgeRate() * 0.26 + this.lateralRatio() * 0.24 + this.irregularity() * 0.16,
      0,
      1,
    );
  }

  protected discipline(): number {
    // Standing still under a committed skillshot is the one unforgivable
    // thing here, so uptime is graded harder than elsewhere.
    return clamp(this.moveUptime() / 0.85, 0, 1);
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return {
      dodging: clamp(this.dodgeRate() * 0.5 + this.baitRate() * 0.5, 0, 1),
      movement: performance,
      spacing: performance,
    };
  }

  protected moduleMetrics(): KeyMetric[] {
    return [
      pct('baitRate', 'SHOTS BAITED', this.baitRate()),
      pct('lateral', 'MOVEMENT ACROSS THE LINE', this.lateralRatio()),
      pct('dodgeRate', 'SHOTS AVOIDED', this.dodgeRate()),
      pct('irregular', 'RHYTHM UNREADABILITY', this.irregularity()),
      count('changes', 'CHANGES UNDER A TELL', this.changesUnderTell),
      count('hitsTaken', 'HITS TAKEN', this.hits, 'lower'),
    ];
  }

  protected notes() {
    return {
      helped: this.baitRate() > 0.6 ? ['More than half its shots went where you had already stopped going.'] : [],
      hurt:
        this.irregularity() < 0.25 && this.dirChanges > 8
          ? ['Your changes are on a rhythm. Anything on a rhythm can be led, and it will be.']
          : [],
      advice:
        this.lateralRatio() < 0.5
          ? 'You are running up and down its line. Only movement across it changes the angle — everything else is jogging into the shot.'
          : this.baitRate() < 0.3
            ? 'Change *after* the tell starts, not before. Committing early is just picking a different place to be hit.'
            : this.irregularity() < 0.3
              ? 'Vary how long you hold each direction. Two short, one long, one very long — a pattern it cannot fit a lead to.'
              : null,
    };
  }
}
