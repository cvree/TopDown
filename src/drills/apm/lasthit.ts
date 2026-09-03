import { clamp, dist, norm } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, pct } from '../base';
import { ApmDrill, INERT_ATTACK } from './engine';

/**
 * The last-hit modes.
 *
 * Every other CS drill in the trainer is about the timing of one killing
 * blow. These two are about the *rate*: five health bars falling at once, a
 * wave that does not wait, and an attack cycle that only lets you be in one
 * place at a time. The whole skill is choosing which bar to be on next, and
 * being there already.
 */
abstract class ApmCsDrill extends ApmDrill {
  protected minions: Actor[] = [];
  protected secured = 0;
  protected perfectCs = 0;
  protected lost = 0;
  /** Of those, the ones that died within your reach. Only these count. */
  protected missedInRange = 0;
  private attacksOn = new Map<number, number>();
  private allyTick = 0;
  private waveCd = 0;
  private wave = 0;

  protected abstract waveSize(): number;
  protected abstract drainRate(): number;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.74 });
    // Harassment costs you the chain, not the run. See the dodge modes.
    p.maxHp = 2400;
    p.hp = 2400;
    this.spawnWave();
  }

  protected spawnWave(): void {
    this.wave++;
    const { w, h } = this.s.world.bounds;
    const n = this.waveSize();
    const y = h * 0.38;
    for (let i = 0; i < n; i++) {
      const cannon = i === n - 1 && this.wave % 3 === 0;
      const x = w * 0.5 + (i - (n - 1) / 2) * (104 - this.d * 20);
      const hp = (cannon ? 340 : 190) + this.s.rng.range(-30, 50) + this.d * 60;
      this.minions.push(
        this.s.world.spawnActor({
          pos: { x, y: y + this.s.rng.range(-26, 26) },
          team: 'enemy',
          maxHp: Math.round(hp),
          radius: cannon ? 28 : 23,
          moveSpeed: 0,
          isMinion: true,
          goldValue: cannon ? 3 : 1,
          label: cannon ? 'CANNON' : 'MINION',
          attack: { ...INERT_ATTACK },
        }),
      );
    }
    this.waveCd = clamp(7.5 - this.d * 2.2, 4.5, 8);
  }

  protected tick(dt: number): void {
    this.updateBrains(dt);

    // Allied fire. Faster than the standard drill on purpose: the window
    // between "not yet" and "gone" is the thing being trained here.
    this.allyTick -= dt;
    if (this.allyTick <= 0) {
      this.allyTick = clamp(this.drainRate() / Math.max(0.8, this.tempo * 0.9), 0.14, 1);
      const living = this.minions.filter((m) => m.alive);
      if (living.length) {
        const t = living[this.s.rng.int(0, living.length)];
        this.s.world.damage(t, 26 + this.d * 26 + this.s.rng.range(-5, 9), undefined);
        this.s.fx.ring(t.pos.x, t.pos.y, 4, 24, 0.18, PALETTE.textFaint, 1.4, 'impact');
      }
    }

    this.waveCd -= dt;
    this.minions = this.minions.filter((m) => m.alive);
    if (this.waveCd <= 0 || this.minions.length <= 1) this.spawnWave();

    this.modeTick(dt);
  }

  protected modeTick(_dt: number): void {}

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type === 'attackLand' && e.actorId === pid && e.targetId !== undefined) {
        this.attacksOn.set(e.targetId, (this.attacksOn.get(e.targetId) ?? 0) + 1);
      }
      if (e.type !== 'death' || e.actorId === undefined || e.actorId === pid) continue;
      const victim = this.s.world.byId(e.actorId);
      const pos = e.pos ?? victim?.pos;
      if (!pos || !victim?.isMinion) continue;
      const swings = this.attacksOn.get(e.actorId) ?? 0;
      this.attacksOn.delete(e.actorId);
      if (victim.killedByPlayer) {
        this.secured++;
        const clean = swings <= 1;
        if (clean) this.perfectCs++;
        this.hit(pos, {
          quality: clean ? 0.95 : clamp(1 - (swings - 1) * 0.3, 0, 0.7),
          value: (victim.goldValue ?? 1) > 1 ? 240 : 130,
          action: false,
          label: clean ? 'CLEAN' : undefined,
        });
      } else {
        this.lost++;
        // Only a minion you could actually have taken counts against you.
        // Three bars can empty in the same second and one champion has one
        // attack; breaking the chain for the other two would be punishing you
        // for arithmetic rather than teaching you where to stand and when to
        // swing. So it has to have been in range *and* your attack has to have
        // been off cooldown and not already committed to something else.
        const p = this.s.world.player;
        const takeable =
          !!p &&
          dist(p.pos, pos) <= p.attack.range + victim.radius + 40 &&
          p.attackCd <= 0.2 &&
          p.phase !== 'windup';
        if (takeable) {
          this.missedInRange++;
          this.fumble(pos, 'MISSED', { input: false, cost: 60 });
        } else {
          this.s.fx.ring(pos.x, pos.y, 6, 30, 0.22, PALETTE.textFaint, 1.4, 'impact');
        }
      }
    }
  }

  /** Attack orders and steps between bars: both are the action being counted. */
  onClick(pos: Vec2): boolean {
    this.noteMove(pos);
    return false;
  }

  /** Of the minions you could actually have taken, how many you took. */
  protected csRate(): number {
    return this.secured / Math.max(1, this.secured + this.missedInRange);
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    const oneShot = p.attack.damage;
    for (const m of this.minions) {
      if (!m.alive) continue;
      // A minion inside one attack of death gets a ring. The drill is not
      // hiding the answer — it is asking whether your hand can keep up with it.
      if (m.hp > oneShot) continue;
      out.markers.push({
        kind: 'ring',
        x: m.pos.x,
        y: m.pos.y,
        radius: m.radius + 16,
        color: PALETTE.warn,
        alpha: 0.9,
        width: 5,
        progress: clamp(m.hp / Math.max(1, oneShot), 0, 1),
        rise: 2.4,
      });
    }
  }

  protected modeField(): HudField {
    const rate = this.csRate();
    return {
      label: 'CS',
      value: `${this.secured}`,
      bar: rate,
      tone: rate > 0.85 ? 'good' : rate > 0.65 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    void accuracy;
    return {
      tempo: clamp(speed * 0.55 + performance * 0.45, 0, 1),
      lastHitting: clamp(this.csRate() * 0.6 + performance * 0.4, 0, 1),
      targeting: performance,
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      pct('cs', 'CS SECURED', this.csRate()),
      count('secured', 'MINIONS KILLED', this.secured),
      count('perfect', 'ONE-ATTACK KILLS', this.perfectCs),
      count('lost', 'MISSED IN RANGE', this.missedInRange, 'lower'),
    ];
  }
}

/**
 * LAST HIT — CS at rate.
 *
 * Five bars, one attack cycle, and allied fire that does not care which one
 * you were planning to take. Nothing is chasing you; the pressure is entirely
 * the clock.
 */
export class ApmLastHitDrill extends ApmCsDrill {
  protected readonly targetApm = 110;
  // A wave is five bars and they arrive about every seven seconds.
  protected get targetRate(): number {
    return 34;
  }

  protected waveSize(): number {
    return 4 + Math.floor(this.d * 2);
  }
  protected drainRate(): number {
    return 0.62 - this.d * 0.2;
  }

  protected notes() {
    return {
      helped: this.csRate() > 0.9 && this.secured > 15 ? ['Almost nothing died without you.'] : [],
      hurt: this.missedInRange > this.secured * 0.35 ? ['A third of the minions within your reach died without you.'] : [],
      advice:
        this.perfectCs < this.secured * 0.5 && this.secured > 8
          ? 'You are chipping healthy minions. Stand in range, wait, and let one attack do the whole job.'
          : null,
    };
  }
}

/**
 * LAST HIT 2 — CS with someone standing on you.
 *
 * The same wave, plus a ranged enemy that shoots wherever you were about to
 * stand. Every last hit now costs a positioning decision, which is what
 * makes CS hard in a real lane and easy in every trainer that leaves it out.
 */
export class ApmLastHit2Drill extends ApmCsDrill {
  protected readonly targetApm = 130;
  protected get targetRate(): number {
    // Lower than the clean lane on purpose: some of the wave is meant to be
    // lost to the fact that you had to be somewhere else for a second.
    return 28;
  }
  private harasser: Actor | null = null;
  private harassCd = 2.5;
  private hitsTaken = 0;

  protected waveSize(): number {
    return 5 + Math.floor(this.d * 2);
  }
  protected drainRate(): number {
    return 0.5 - this.d * 0.16;
  }

  setup(): void {
    super.setup();
    const { w, h } = this.s.world.bounds;
    const a = this.spawnEnemy('artillery', { x: w * 0.5, y: h * 0.12 }, { hpScale: 12 });
    // Its harassment is the telegraphed line below, which you are meant to be
    // able to read and leave. Letting it auto-attack as well would add damage
    // you cannot dodge on top of damage you can, and the chain would be gone
    // for reasons the drill never showed you.
    a.attack.damage = 0;
    a.attack.range = 0;
    a.label = 'HARASS';
    this.harasser = a;
  }

  protected modeTick(dt: number): void {
    const p = this.s.world.player;
    const h = this.harasser;
    if (!p || !h || !h.alive) return;
    this.harassCd -= dt;
    if (this.harassCd > 0) return;
    this.harassCd = clamp(3.1 - this.d * 1.2, 1.5, 3.2);
    // Aimed at where the next last hit would put you, not at where you are.
    const lead = { x: p.pos.x + p.vel.x * 0.45, y: p.pos.y + p.vel.y * 0.45 };
    const dir = norm(lead.x - h.pos.x, lead.y - h.pos.y);
    this.s.world.spawnHazard({
      pos: { ...h.pos },
      team: 'enemy',
      shape: 'line',
      end: { x: h.pos.x + dir.x * 1400, y: h.pos.y + dir.y * 1400 },
      radius: 1400,
      width: 56 + this.d * 22,
      warn: clamp(0.8 - this.d * 0.3, 0.34, 0.85),
      active: 0.28,
      damage: 40,
      color: PALETTE.danger,
    });
  }

  onEvents(events: readonly WorldEvent[]): void {
    super.onEvents(events);
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type === 'damage' && e.targetId === pid) {
        this.hitsTaken++;
        this.fumble(e.pos ?? this.s.world.player?.pos ?? { x: 0, y: 0 }, 'HARASSED', { input: false, cost: 60 });
      }
    }
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      ...super.axisSplit(performance, accuracy, speed),
      dodging: clamp(1 - this.hitsTaken / 10, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [...super.modeMetrics(), count('taken', 'HARASS TAKEN', this.hitsTaken, 'lower')];
  }

  protected notes() {
    return {
      helped: this.hitsTaken === 0 && this.secured > 12 ? ['You took the whole wave without taking a single skillshot.'] : [],
      hurt: this.hitsTaken > 6 ? ['You are standing still to CS. That is exactly what the harasser is aiming at.'] : [],
      advice:
        this.hitsTaken > 6
          ? 'Approach the minion from a different angle each time. A predictable last-hit position is a free hit for them.'
          : null,
    };
  }
}
