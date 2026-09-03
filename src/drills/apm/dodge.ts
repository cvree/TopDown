import { audio } from '../../engine/audio';
import type { AbilitySlot } from '../../engine/input';
import { clamp, dist, norm } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { AbilityView, HudField } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, pct, secs } from '../base';
import { ApmDrill } from './engine';

/** A charge you collect by standing on it. The reason to keep moving. */
interface Charge {
  pos: Vec2;
  radius: number;
}

/**
 * The moving half of the APM trainer.
 *
 * Clicking fast in one spot is not APM, it is noise. These two modes make the
 * arena itself demand commands: charges pull you somewhere, telegraphs push
 * you off it, and every second you are not issuing a movement order is a
 * second you are standing in something.
 */
abstract class ApmMoveDrill extends ApmDrill {
  protected charges: Charge[] = [];
  protected collected = 0;
  protected hitsTaken = 0;
  private chargeCd = 0;
  private threatCd = 1;
  private clean = 0;
  private moveOrders = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w / 2, y: h / 2 });
    p.attack.range = 0;
    // A deep pool on purpose. The cost of standing in something here is the
    // flow tier, not the run: an APM drill that ends at forty seconds because
    // you took four hits has stopped measuring what it set out to measure.
    p.maxHp = 2400;
    p.hp = 2400;
    this.seedCharges();
  }

  protected chargeCount(): number {
    return 2 + Math.floor(this.d * 2);
  }

  private seedCharges(): void {
    while (this.charges.length < this.chargeCount()) this.addCharge();
  }

  private addCharge(): void {
    const p = this.s.world.player;
    const pos = this.randomPoint(p?.pos ?? null, 260, 150);
    this.charges.push({ pos, radius: 44 - this.d * 12 });
    this.s.fx.ring(pos.x, pos.y, 90, 30, 0.35, PALETTE.good, 2, 'range');
  }

  protected tick(dt: number): void {
    const p = this.s.world.player;
    if (!p) return;

    // Charges. Collecting one immediately places the next somewhere else, so
    // the drill never lets you settle: there is always a reason to be moving.
    this.chargeCd -= dt;
    if (this.charges.length < this.chargeCount() && this.chargeCd <= 0) {
      this.chargeCd = 0.35;
      this.addCharge();
    }
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const c = this.charges[i];
      if (dist(p.pos, c.pos) > c.radius + p.radius) continue;
      this.charges.splice(i, 1);
      this.collected++;
      this.clean += 1;
      // The command that earned this was the move order; the pickup is the
      // payoff, so it is scored but not counted a second time as an action.
      this.hit(c.pos, { quality: 0.6, value: 120, action: false, label: 'CHARGE' });
    }

    this.threatCd -= dt;
    if (this.threatCd <= 0) {
      this.threatCd = clamp((1.5 - this.d * 0.7) / Math.max(0.75, this.tempo * 0.85), 0.35, 1.6);
      this.threat();
    }

    this.modeTick(dt);
  }

  protected modeTick(_dt: number): void {}

  /** One telegraphed threat, aimed where you are going rather than where you are. */
  private threat(): void {
    const p = this.s.world.player;
    if (!p) return;
    const d = this.d;
    const lead = { x: p.pos.x + p.vel.x * 0.4 * d, y: p.pos.y + p.vel.y * 0.4 * d };
    const roll = this.s.rng.next();

    if (roll < 0.4) {
      this.s.world.spawnHazard({
        pos: lead,
        team: 'enemy',
        shape: 'circle',
        radius: 120 + d * 60,
        warn: clamp(0.85 - d * 0.35, 0.32, 0.9),
        active: 0.35,
        damage: 60,
        color: PALETTE.hazard,
      });
      return;
    }
    if (roll < 0.72) {
      const from = this.edgePoint();
      const dir = norm(lead.x - from.x, lead.y - from.y);
      this.s.world.spawnHazard({
        pos: from,
        team: 'enemy',
        shape: 'line',
        end: { x: from.x + dir.x * 1500, y: from.y + dir.y * 1500 },
        radius: 1500,
        width: 62 + d * 26,
        warn: clamp(0.75 - d * 0.3, 0.3, 0.8),
        active: 0.3,
        damage: 55,
        color: PALETTE.danger,
      });
      return;
    }
    const from = this.edgePoint();
    const n = 2 + Math.floor(d * 3);
    for (let i = 0; i < n; i++) {
      const aim = { x: lead.x + this.s.rng.range(-90, 90), y: lead.y + this.s.rng.range(-90, 90) };
      const dir = norm(aim.x - from.x, aim.y - from.y);
      const speed = 640 + d * 420;
      this.s.world.spawnProjectile({
        pos: { ...from },
        team: 'enemy',
        ownerId: -1,
        vel: { x: dir.x * speed, y: dir.y * speed },
        speed,
        damage: 40,
        radius: 15,
        pierce: true,
        shape: 'shard',
        maxLife: 4,
        color: PALETTE.danger,
      });
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type === 'damage' && e.targetId === pid) {
        this.hitsTaken++;
        this.clean = 0;
        this.fumble(e.pos ?? this.s.world.player?.pos ?? { x: 0, y: 0 }, 'HIT', { input: false, cost: 90 });
      }
    }
  }

  /** A movement command is the action this mode is counting. */
  onClick(pos: Vec2): boolean {
    this.moveOrders++;
    this.noteMove(pos);
    return false;
  }

  protected paintMode(out: DrillPaint, t: number): void {
    for (const c of this.charges) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5 + c.pos.x * 0.01);
      out.markers.push({
        kind: 'ring',
        x: c.pos.x,
        y: c.pos.y,
        radius: c.radius + pulse * 6,
        color: PALETTE.good,
        alpha: 0.8,
        width: 4,
        dash: 6,
        spin: 0.8,
        rise: 1.6,
      });
      out.markers.push({
        kind: 'disc',
        x: c.pos.x,
        y: c.pos.y,
        radius: c.radius * 0.36,
        color: PALETTE.good,
        alpha: 0.5 + pulse * 0.35,
        fill: 0.9,
        width: 1,
        rise: 2,
      });
    }
  }

  protected modeField(): HudField {
    return {
      label: 'CHARGES',
      value: `${this.collected}`,
      bar: clamp(this.clean / 12, 0, 1),
      tone: this.hitsTaken === 0 ? 'good' : this.clean > 5 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    void accuracy;
    const survival = clamp(1 - this.hitsTaken / Math.max(6, this.collected * 0.6), 0, 1);
    return {
      tempo: clamp(speed * 0.6 + performance * 0.4, 0, 1),
      dodging: clamp(survival * 0.7 + performance * 0.3, 0, 1),
      movement: clamp(performance * 0.6 + speed * 0.4, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      count('charges', 'CHARGES TAKEN', this.collected),
      count('hitsTaken', 'HITS TAKEN', this.hitsTaken, 'lower'),
      count('orders', 'MOVE COMMANDS', this.moveOrders),
    ];
  }
}

/**
 * DODGE — movement APM.
 *
 * Charges to collect, telegraphs to avoid, and no way to have both without
 * issuing a command every half-second. Standing still is safe for about a
 * second and then it is not safe at all.
 */
export class ApmDodgeDrill extends ApmMoveDrill {
  protected readonly targetApm = 100;
  // A charge every couple of seconds, while never standing in anything.
  protected get targetRate(): number {
    return 30;
  }

  protected notes() {
    return {
      helped: this.hitsTaken === 0 ? ['You took nothing the whole run while still collecting.'] : [],
      hurt: this.hitsTaken > 6 ? ['You are moving a lot, but into things rather than away from them.'] : [],
      advice:
        this.hitsTaken > 6
          ? 'Take the charge on the way out of the telegraph, not on the way in. Plan the second click before the first lands.'
          : null,
    };
  }
}

const ABILITY_NAME: Record<string, string> = { q: 'BOLT', w: 'WARD', e: 'DASH', r: 'PULSE' };
const SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r'];

/**
 * DODGE + COOLDOWN — the two hands, at once.
 *
 * Everything the dodge mode does, plus four abilities that must be spent the
 * moment they come up. A cooldown sat on is damage you never did; a key
 * pressed while it is still turning is an input you paid for and did not get.
 * Both are counted, and neither can be fixed by giving up on the other.
 */
export class ApmDodgeCooldownDrill extends ApmMoveDrill {
  protected readonly targetApm = 130;
  // Four cooldowns turning over, plus the charges, minus what you sat on.
  protected get targetRate(): number {
    return 45;
  }

  private cd: Record<string, number> = { q: 0, w: 0, e: 0, r: 0 };
  private base: Record<string, number> = { q: 3.4, w: 4.6, e: 5.2, r: 6.4 };
  private readyAt: Record<string, number> = { q: 0, w: 0, e: 0, r: 0 };
  private onTime = 0;
  private late = 0;
  private wasted = 0;
  private idleSum = 0;
  private lateness: number[] = [];

  protected chargeCount(): number {
    return 1 + Math.floor(this.d * 2);
  }

  protected modeTick(dt: number): void {
    for (const s of SLOTS) {
      if (this.cd[s] <= 0) {
        // The clock on a ready ability: how long it has been sitting there.
        this.idleSum += dt;
        continue;
      }
      this.cd[s] = Math.max(0, this.cd[s] - dt);
      if (this.cd[s] === 0) {
        this.readyAt[s] = this.s.elapsed;
        audio.play('abilityReady', { intensity: 0.6 });
      }
    }
  }

  private window(): number {
    return clamp(1.5 - this.d * 0.5, 0.6, 1.6);
  }

  onAbility(slot: AbilitySlot, at: Vec2): void {
    if (!SLOTS.includes(slot)) return;
    const p = this.s.world.player;
    if (!p) return;

    if (this.cd[slot] > 0) {
      // Pressing into a turning cooldown: a real input, spent on nothing.
      this.wasted++;
      this.stray(p.pos);
      return;
    }

    const idle = this.s.elapsed - this.readyAt[slot];
    const w = this.window();
    this.cast(slot, at, p.pos);
    this.cd[slot] = this.base[slot] * (1 - this.d * 0.35);

    if (idle > w) {
      this.late++;
      this.lateness.push(idle * 1000);
      this.fumble(p.pos, 'SAT ON IT', { cost: 60 });
      return;
    }
    this.onTime++;
    this.lateness.push(idle * 1000);
    this.hit(p.pos, {
      quality: clamp(1 - idle / w, 0, 1),
      value: 150,
      reaction: idle * 1000,
      label: slot.toUpperCase(),
    });
  }

  /** Each key does something visible: an ability you cannot see is a chore. */
  private cast(slot: AbilitySlot, at: Vec2, from: Vec2): void {
    const dir = norm(at.x - from.x, at.y - from.y);
    const p = this.s.world.player!;
    switch (slot) {
      case 'q':
        this.s.world.spawnProjectile({
          pos: { ...from },
          team: 'player',
          ownerId: p.id,
          vel: { x: dir.x * 1500, y: dir.y * 1500 },
          speed: 1500,
          damage: 0,
          radius: 14,
          pierce: true,
          shape: 'shard',
          maxLife: 1,
          color: PALETTE.accent,
        });
        break;
      case 'w':
        this.s.fx.ring(from.x, from.y, 10, 130, 0.4, PALETTE.good, 3, 'pulse');
        break;
      case 'e': {
        const step = Math.min(240, dist(from, at));
        p.pos.x = clamp(p.pos.x + dir.x * step, p.radius, this.s.world.bounds.w - p.radius);
        p.pos.y = clamp(p.pos.y + dir.y * step, p.radius, this.s.world.bounds.h - p.radius);
        p.prev.x = p.pos.x;
        p.prev.y = p.pos.y;
        this.s.fx.ring(p.pos.x, p.pos.y, 8, 90, 0.3, PALETTE.accent, 2.5, 'shock');
        break;
      }
      case 'r':
        this.s.fx.ring(from.x, from.y, 20, 240, 0.5, PALETTE.violet, 4, 'shock');
        this.s.fx.addShake(3);
        break;
      default:
        break;
    }
  }

  abilities(): AbilityView[] {
    return super.abilities().map((a) => {
      if (!SLOTS.includes(a.slot)) return a;
      const cd = this.cd[a.slot];
      const total = this.base[a.slot] * (1 - this.d * 0.35);
      return {
        ...a,
        name: ABILITY_NAME[a.slot],
        locked: false,
        cd: clamp(cd / Math.max(0.2, total), 0, 1),
        highlight: cd <= 0,
      };
    });
  }

  protected modeField(): HudField {
    const total = this.onTime + this.late;
    const rate = this.onTime / Math.max(1, total);
    return {
      label: 'UPTIME',
      value: `${Math.round(rate * 100)}%`,
      bar: rate,
      tone: rate > 0.85 ? 'good' : rate > 0.6 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    const uptime = this.onTime / Math.max(1, this.onTime + this.late);
    return {
      tempo: clamp(speed * 0.55 + performance * 0.45, 0, 1),
      dodging: clamp(performance * 0.6 + accuracy * 0.4, 0, 1),
      combat: clamp(uptime * 0.7 + performance * 0.3, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    const total = this.onTime + this.late;
    const avgIdle = this.lateness.length ? this.lateness.reduce((a, b) => a + b, 0) / this.lateness.length / 1000 : 0;
    return [
      pct('uptime', 'COOLDOWNS SPENT ON TIME', this.onTime / Math.max(1, total)),
      secs('idle', 'AVERAGE SIT TIME', avgIdle, 'lower'),
      count('wasted', 'KEYS INTO COOLDOWN', this.wasted, 'lower'),
      count('hitsTaken', 'HITS TAKEN', this.hitsTaken, 'lower'),
    ];
  }

  protected notes() {
    const uptime = this.onTime / Math.max(1, this.onTime + this.late);
    return {
      helped: uptime > 0.9 && this.onTime > 8 ? ['Nothing sat on cooldown while you were busy dodging.'] : [],
      hurt: this.wasted > 8 ? [`${this.wasted} presses into a turning cooldown.`] : [],
      advice:
        this.wasted > 8
          ? 'Let the ready chime cue you rather than mashing. The keys are audible before the wheel finishes.'
          : uptime < 0.6
            ? 'Spend the ability while you are already moving. Waiting for a safe moment is how a cooldown gets sat on.'
            : null,
    };
  }
}
