import { audio } from '../engine/audio';
import { clamp, dist, norm } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { Actor, Vec2 } from '../engine/types';
import { Drill, count, pct, secs, type DrillOutcome } from './base';

type Pattern = 'volley' | 'radial' | 'sweep' | 'zone' | 'ring' | 'crossfire' | 'spiral';

/**
 * DODGE — skillshot survival, with something to shoot back at.
 *
 * Everything here is telegraphed, and the lesson is still that a dodge is one
 * correct movement made early rather than five panicked ones made late. What
 * changed is who is throwing it.
 *
 * The drill used to have no enemies at all: the projectiles came from nowhere,
 * nothing could be killed, and the optimal strategy was therefore to walk to
 * an empty corner of the arena and stay there. That is a real skill for about
 * four seconds of a real game and it is the opposite of the habit an ADC needs
 * — you dodge *while* doing your job, or you have simply left the fight.
 *
 * So the patterns now come out of emitters that stand on the floor and can be
 * shot. Killing one takes its share of the incoming fire off the board, which
 * means walking into range and back out of it, which means the correct answer
 * is a dodge that ends somewhere useful. Both halves are scored and printed:
 * DAMAGE AVOIDED and DAMAGE DEALT. Neither can carry the run on its own.
 */
export class DodgeDrill extends Drill {
  private wave = 1;
  private waveTime = 0;
  private nextPattern = 1.2;
  private threats = 0;
  /** Distinct patterns fired — the unit a player actually reacts to. */
  private patterns = 0;
  private startHp = 760;
  /** Total damage the arena aimed at the player, landed or not. */
  private threatDamage = 0;
  private emittersKilled = 0;
  private emitterCd = 0;
  /**
   * Shots the drill has committed to but not fired yet.
   *
   * The spiral used to stagger itself with `window.setTimeout`, which put a
   * piece of the simulation on the wall clock: it kept firing through a pause,
   * it landed on different frames at different frame rates, and it meant two
   * runs of the same seed were not the same run. Everything is on the fixed
   * step now.
   */
  private queued: { at: number; from: Vec2; to: Vec2; speed: number; radius: number; damage: number }[] = [];

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w / 2, y: h * 0.68 });
    // Health is the ledger of what you failed to dodge, over the full run.
    p.maxHp = 1000;
    p.hp = 1000;
    this.startHp = p.maxHp;
    this.spawnEmitter();
  }

  /**
   * A thing that shoots, stands still, and dies.
   *
   * Immovable and short-ranged: it never chases and it cannot hit you by
   * walking at you, so every point of damage it does is a dodge you missed.
   * What it *can* do is make you come and get it.
   */
  private spawnEmitter(): Actor {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.player;
    const pos = this.randomPoint(p?.pos ?? { x: w / 2, y: h / 2 }, 780, 220);
    const a = this.s.world.spawnActor({
      pos,
      team: 'enemy',
      maxHp: 430 + this.s.config.difficulty * 220,
      radius: 34,
      moveSpeed: 0,
      immovable: true,
      unitKind: 'turret',
      label: 'EMITTER',
      attack: { attackSpeed: 0.4, windupRatio: 0.3, backswingRatio: 0.3, range: 0, damage: 0, projectileSpeed: 0 },
    });
    this.s.fx.ring(pos.x, pos.y, 10, 130, 0.5, PALETTE.hazard, 2.5, 'shock');
    return a;
  }

  private emitters(): Actor[] {
    return this.s.world.enemies().filter((e) => e.unitKind === 'turret');
  }

  /** Where a pattern comes from: an emitter if one is alive, else the edge. */
  private source(): Vec2 {
    const live = this.emitters();
    if (!live.length) return this.edgePoint();
    return { ...this.s.rng.pick(live).pos };
  }

  private get d(): number {
    // Difficulty rises through the run as well as with the player's rating.
    return clamp(this.s.config.difficulty * 0.75 + (this.wave - 1) * 0.05, 0, 1.05);
  }

  update(dt: number): void {
    this.updateBrains(dt);

    // Queued shots, on the fixed step.
    for (let i = this.queued.length - 1; i >= 0; i--) {
      const q = this.queued[i];
      if (this.s.world.time < q.at) continue;
      this.queued.splice(i, 1);
      this.shot(q.from, q.to, q.speed, q.radius, q.damage);
    }

    // Emitters come back, slowly, and one more joins with every wave — so
    // clearing them is progress you can feel without ever being finished.
    // Three at most, and they arrive slowly. Every emitter is another angle
    // the patterns come from, and four of them surrounds the player rather
    // than pressuring them.
    const wanted = Math.min(3, 1 + Math.floor(this.wave / 2));
    if (this.emitters().length < wanted) {
      this.emitterCd -= dt;
      if (this.emitterCd <= 0) {
        this.emitterCd = 5.5 - this.s.config.difficulty * 1.5;
        this.spawnEmitter();
      }
    }

    this.waveTime += dt;
    if (this.waveTime > 15) {
      this.waveTime = 0;
      this.wave++;
      this.s.setBanner(`WAVE ${this.wave}`, 1.2);
      this.s.fx.addFlash(0.06, PALETTE.warn);
      audio.play('countdown');
      // From the third wave something starts walking at you as well, so the
      // corner of the arena stops being a place you can stand.
      if (this.wave === 4) {
        const a = this.spawnEnemy('diver', this.edgePoint(), { hpScale: 0.8, behavior: 'diver' });
        a.moveSpeed = 168 + this.s.config.difficulty * 76;
        a.attack.damage = 22 + this.s.config.difficulty * 16;
        a.label = 'HUNTER';
      }
    }

    this.nextPattern -= dt;
    if (this.nextPattern <= 0) {
      const d = this.d;
      // Slower than it was: there are bodies on the floor now as well as
      // patterns in the air, and the drill asks you to walk into range of one
      // of them between waves. That gap has to exist.
      this.nextPattern = clamp(1.95 - d * 0.9, 0.78, 2.0);
      this.patterns++;
      this.fire(this.choosePattern());
    }
  }

  private choosePattern(): Pattern {
    const pool: Pattern[] = ['volley', 'radial', 'zone'];
    if (this.wave >= 2) pool.push('sweep', 'ring');
    if (this.wave >= 3) pool.push('crossfire');
    if (this.wave >= 4) pool.push('spiral');
    return this.s.rng.pick(pool);
  }

  private playerLead(seconds: number): Vec2 {
    const p = this.s.world.player!;
    const acc = clamp(this.d, 0, 1);
    return {
      x: p.pos.x + p.vel.x * seconds * acc,
      y: p.pos.y + p.vel.y * seconds * acc,
    };
  }

  private shot(from: Vec2, to: Vec2, speed: number, radius = 15, damage = 36, pierce = true): void {
    const dir = norm(to.x - from.x, to.y - from.y);
    this.threats++;
    this.threatDamage += damage;
    this.s.world.spawnProjectile({
      pos: from,
      team: 'enemy',
      ownerId: -1,
      vel: { x: dir.x * speed, y: dir.y * speed },
      speed,
      damage,
      radius,
      pierce,
      shape: 'shard',
      maxLife: 4,
      color: PALETTE.danger,
    });
  }

  private fire(p: Pattern): void {
    const d = this.d;
    const player = this.s.world.player;
    if (!player) return;
    const speed = 620 + d * 460;

    switch (p) {
      case 'volley': {
        const from = this.source();
        const n = 2 + Math.floor(d * 3.4);
        for (let i = 0; i < n; i++) {
          const aim = this.playerLead(0.35 + i * 0.09);
          const spread = (i - (n - 1) / 2) * (0.09 - d * 0.03);
          const dir = norm(aim.x - from.x, aim.y - from.y);
          const ca = Math.atan2(dir.y, dir.x) + spread;
          this.shot(from, { x: from.x + Math.cos(ca) * 900, y: from.y + Math.sin(ca) * 900 }, speed);
        }
        break;
      }
      case 'radial': {
        const c = this.source();
        const n = 8 + Math.floor(d * 10);
        const off = this.s.rng.angle();
        this.s.fx.ring(c.x, c.y, 4, 120, 0.4, PALETTE.danger, 3, 'shock');
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          this.shot(c, { x: c.x + Math.cos(a) * 900, y: c.y + Math.sin(a) * 900 }, speed * 0.82, 13, 30);
        }
        break;
      }
      case 'spiral': {
        const c = this.source();
        const n = 10 + Math.floor(d * 8);
        const off = this.s.rng.angle();
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          this.queued.push({
            at: this.s.world.time + i * 0.045,
            from: { ...c },
            to: { x: c.x + Math.cos(a) * 900, y: c.y + Math.sin(a) * 900 },
            speed: speed * 0.75,
            radius: 12,
            damage: 32,
          });
        }
        break;
      }
      case 'zone': {
        const n = 1 + Math.floor(d * 2.6);
        for (let i = 0; i < n; i++) {
          const at = i === 0 ? this.playerLead(0.5) : this.randomPoint(player.pos, 120, 160);
          this.threats++;
          this.threatDamage += 48;
          this.s.world.spawnHazard({
            pos: at,
            team: 'enemy',
            shape: 'circle',
            radius: 118 + d * 42,
            warn: clamp(1.05 - d * 0.42, 0.5, 1.1),
            active: 0.28,
            damage: 48,
            color: PALETTE.hazard,
          });
        }
        break;
      }
      case 'ring': {
        const c = this.randomPoint(player.pos, 0, 240);
        this.threats++;
        this.threatDamage += 44;
        this.s.world.spawnHazard({
          pos: c,
          team: 'enemy',
          shape: 'ring',
          radius: 300 + d * 90,
          width: 140,
          warn: clamp(1.0 - d * 0.35, 0.55, 1.05),
          active: 0.3,
          damage: 44,
          color: PALETTE.violet,
        });
        break;
      }
      case 'sweep': {
        const c = this.randomPoint(player.pos, 200, 160);
        const a = this.s.rng.angle();
        this.threats++;
        this.threatDamage += 46;
        this.s.world.spawnHazard({
          pos: c,
          end: { x: c.x + Math.cos(a) * 1100, y: c.y + Math.sin(a) * 1100 },
          team: 'enemy',
          shape: 'line',
          width: 46 + d * 16,
          warn: clamp(0.95 - d * 0.35, 0.52, 1.0),
          active: 0.34,
          damage: 46,
          spin: (this.s.rng.chance(0.5) ? 1 : -1) * (0.35 + d * 0.5),
          color: PALETTE.warn,
        });
        break;
      }
      case 'crossfire': {
        const a = this.playerLead(0.6);
        const ang = this.s.rng.angle();
        for (const off of [0, Math.PI / 2]) {
          this.threats++;
          this.threatDamage += 44;
          const dir = ang + off;
          this.s.world.spawnHazard({
            pos: { x: a.x - Math.cos(dir) * 700, y: a.y - Math.sin(dir) * 700 },
            end: { x: a.x + Math.cos(dir) * 700, y: a.y + Math.sin(dir) * 700 },
            team: 'enemy',
            shape: 'line',
            width: 50,
            warn: clamp(0.9 - d * 0.3, 0.52, 0.95),
            active: 0.3,
            damage: 44,
            color: PALETTE.danger,
          });
        }
        break;
      }
    }
  }

  onEvents(events: readonly { type: string; actorId?: number; byPlayer?: boolean }[]): void {
    for (const e of events) {
      if (e.type !== 'death' || !e.byPlayer) continue;
      const victim = this.s.world.byId(e.actorId);
      if (victim?.unitKind === 'turret') {
        this.emittersKilled++;
        this.s.micro('EMITTER DOWN', victim.pos, PALETTE.good);
      }
    }
  }

  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    // Which emitters you can actually punish from where you are standing. The
    // drill is asking you to dodge *toward* a target, so it has to be visible
    // which targets are worth dodging toward.
    for (const e of this.emitters()) {
      const reachable = dist(p.pos, e.pos) - e.radius <= p.attack.range;
      out.markers.push({
        kind: 'ring',
        x: e.pos.x,
        y: e.pos.y,
        radius: e.radius + 14,
        color: reachable ? PALETTE.good : PALETTE.textDim,
        alpha: reachable ? 0.5 + 0.12 * Math.sin(t * 6) : 0.22,
        width: reachable ? 3 : 2,
        rise: 1.5,
      });
    }
  }

  /** What the arena threw at you that never landed. */
  private get damageAvoided(): number {
    return Math.max(0, this.threatDamage - this.s.metrics.m.hpLost);
  }

  hudFields(): HudField[] {
    const m = this.s.metrics.m;
    const rate = this.patterns > 0 ? 1 - m.hitsTaken / this.patterns : 1;
    return [
      { label: 'WAVE', value: `${this.wave}`, tone: 'neutral' },
      { label: 'AVOIDED', value: `${Math.round(clamp(rate, 0, 1) * 100)}%`, bar: clamp(rate, 0, 1), tone: rate > 0.9 ? 'good' : rate > 0.75 ? 'warn' : 'bad' },
      // The half the drill used to leave out entirely.
      {
        label: 'DEALT',
        value: `${Math.round(m.damageDealt)}`,
        tone: m.damageDealt > this.s.elapsed * 16 ? 'good' : m.damageDealt > this.s.elapsed * 6 ? 'warn' : 'bad',
      },
      { label: 'EMITTERS', value: `${this.emittersKilled}`, tone: 'good' },
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    return Math.max(
      0,
      Math.round(
        this.s.elapsed * 120 * this.wave * 0.5 +
          this.damageAvoided * 1.4 +
          m.damageDealt * 5 +
          this.emittersKilled * 1600 +
          m.nearMisses * 80 -
          m.hitsTaken * 520,
      ),
    );
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    // A radial burst is eighteen projectiles but one decision, so cleanliness
    // is measured per pattern. Counting projectiles would make a barely-alive
    // run look like a 96% dodge rate.
    const dodgeRate = this.patterns > 0 ? clamp(1 - m.hitsTaken / this.patterns, 0, 1) : 0;
    const hitsPer10s = m.hitsTaken / Math.max(0.1, m.survivalTime / 10);
    const pressure = bandLocal(hitsPer10s, 3.2, 0.05);
    const hpRetained = clamp(1 - m.hpLost / this.startHp, 0, 1);
    const survival = this.s.config.duration > 0 ? clamp(m.survivalTime / this.s.config.duration, 0, 1) : 1;
    // Near misses are evidence of tight, deliberate dodging rather than
    // running away — worth a little, never enough to carry a run.
    const sharpness = clamp(m.nearMisses / Math.max(6, this.threats * 0.35), 0, 1);

    // The offensive half. Emitters are the thing you are supposed to be
    // walking into range of, so they are weighted above raw damage — killing
    // one is proof you entered a threat range on purpose and got back out.
    const dps = m.damageDealt / Math.max(1, m.survivalTime);
    const offence = clamp(bandLocal(dps, 3, 26) * 0.6 + bandLocal(this.emittersKilled, 0, 4) * 0.4, 0, 1);

    // Both halves, and a gate. Running to an empty corner still scores the
    // avoidance it earns — that part was never dishonest — but it can no
    // longer produce a good run, because a player who deals nothing is a
    // player who has left the fight, and leaving the fight is the habit this
    // drill used to accidentally reward.
    const performance = clamp(
      (dodgeRate * 0.24 + pressure * 0.16 + offence * 0.28 + hpRetained * 0.14 + survival * 0.12 + sharpness * 0.06) *
        (0.45 + 0.55 * bandLocal(offence, 0.05, 0.5)),
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (dodgeRate > 0.93) helped.push('You dodged almost everything thrown at you.');
    if (m.nearMisses > 8) helped.push(`${m.nearMisses} near misses — you are dodging by inches, not by fleeing.`);
    if (survival >= 1) helped.push(`Survived all ${this.wave} waves.`);
    if (m.hitsTaken > 4) hurt.push(`${m.hitsTaken} hits taken.`);
    if (this.emittersKilled >= 3) helped.push(`${this.emittersKilled} emitters killed — you dodged toward something, not away from everything.`);
    if (offence < 0.2) hurt.push('You dodged well and did nothing. Every dodge should end somewhere you can shoot from.');
    else if (offence < 0.45) hurt.push('Not enough damage. Walk into range on the gap between patterns, take your shot, and leave.');
    if (m.hazardExposure > 1.5) hurt.push(`${m.hazardExposure.toFixed(1)}s spent standing inside telegraphed ground.`);
    if (!m.survived) hurt.push('The run ended early — you died on wave ' + this.wave + '.');

    const advice =
      offence < 0.25
        ? 'Dodging is not the drill on its own — the emitters have to die. Move on the telegraph, and move toward a target rather than into empty floor.'
        : m.hazardExposure > 1.2
        ? 'Move on the telegraph, not on the explosion. The warning is the whole window.'
        : dodgeRate < 0.8
          ? 'Commit to one direction. Two half-dodges land you back in the line.'
          : 'Start dodging with smaller movements — you have room to stay closer to the action.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: {
        dodging: performance,
        movement: clamp(performance * 0.9 + 0.05, 0, 1),
        combat: clamp(offence * 0.6 + dodgeRate * 0.4, 0, 1),
      },
      keyMetrics: [
        pct('dodgeRate', 'DODGE RATE', dodgeRate),
        count('avoided', 'DAMAGE AVOIDED', Math.round(this.damageAvoided)),
        count('dealt', 'DAMAGE DEALT', Math.round(m.damageDealt)),
        count('emitters', 'EMITTERS KILLED', this.emittersKilled),
        count('hits', 'HITS TAKEN', m.hitsTaken, 'lower'),
        count('nearMiss', 'NEAR MISSES', m.nearMisses),
        secs('survival', 'SURVIVED', m.survivalTime),
        count('wave', 'WAVE REACHED', this.wave),
      ],
      helped,
      hurt,
      advice,
    };
  }
}

const bandLocal = (value: number, bad: number, good: number): number => {
  if (good === bad) return 0;
  const t = (value - bad) / (good - bad);
  return t < 0 ? 0 : t > 1 ? 1 : t;
};
