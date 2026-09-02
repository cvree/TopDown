import { audio } from '../engine/audio';
import { angleDelta, clamp, dist, norm } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { AbilitySlot } from '../engine/input';
import type { AbilityView, HudField } from '../engine/session';
import type { Actor, ArchetypeId, Hazard, Projectile, Vec2 } from '../engine/types';
import { Drill, band, count, pct, type DrillOutcome } from './base';

type Slot = 'q' | 'w' | 'e' | 'r';
type Pattern = 'weave' | 'juke' | 'orbit';

const ABILITY_NAME: Record<Slot, string> = { q: 'LANCE', w: 'ARC', e: 'PIN', r: 'APEX' };
const ABILITY_COLOR: Record<Slot, string> = {
  q: PALETTE.accent,
  w: PALETTE.violet,
  e: PALETTE.good,
  r: PALETTE.warn,
};
const COOLDOWN: Record<Slot, number> = { q: 0.9, w: 2.4, e: 1.7, r: 8.5 };
/** Cosmetic visuals only — none of these dummies fight back. */
const DUMMY_SKINS: ArchetypeId[] = ['ranger', 'duelist', 'controller'];

interface Dummy {
  actor: Actor;
  pattern: Pattern;
  heading: number;
  speedMul: number;
  anchor: Vec2;
  orbitDir: number;
  changeCd: number;
  dodgeCd: number;
  burst: number;
}

interface PendingShot {
  proj: Projectile;
  slot: Slot;
}

interface PendingZone {
  hazard: Hazard;
  slot: Slot;
}

interface Tune {
  count: number;
  speed: number;
  dodgeSkill: number;
  reactionDelay: number;
  hazardWindow: number;
  changeCd: [number, number];
  hp: number;
}

/**
 * SKILLSHOT — land the unlandable.
 *
 * Four abilities, four different skillshot shapes, one target that is
 * actively trying not to be hit. This is the mechanic every League playmaker
 * lives on: reading where something is going, not where it is, and
 * committing a cooldown to that read.
 *
 * Every ability's hit or miss is resolved against the real simulation — a
 * pierced projectile's `hitIds`, or a hazard's own `hazardHits` test at the
 * instant its telegraph expires. Nothing here is a scripted "did you click
 * near it"; it is the same collision the arena actually uses.
 */
export class SkillshotDrill extends Drill {
  private dummies: Dummy[] = [];
  private pendingShots: PendingShot[] = [];
  private pendingZones: PendingZone[] = [];
  private cooldowns: Record<Slot, number> = { q: 0, w: 0, e: 0, r: 0 };
  private hits: Record<Slot, number> = { q: 0, w: 0, e: 0, r: 0 };
  private misses: Record<Slot, number> = { q: 0, w: 0, e: 0, r: 0 };
  private kills = 0;
  private wave = 1;
  private waveTime = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w / 2, y: h * 0.62 });
    // Landing shots is the whole drill — the player's own auto-attack would
    // muddy hit attribution, so it is switched off entirely.
    p.attack.range = 0;
    for (let i = 0; i < this.tune.count; i++) this.spawnDummy();
  }

  private get tune(): Tune {
    const d = clamp(this.s.config.difficulty + (this.wave - 1) * 0.06, 0, 1.3);
    return {
      count: d < 0.32 ? 1 : d < 0.72 ? 2 : 3,
      speed: 220 + d * 235,
      dodgeSkill: clamp(0.04 + d * 0.62, 0, 0.82),
      reactionDelay: clamp(0.5 - d * 0.37, 0.09, 0.5),
      hazardWindow: clamp(0.55 - d * 0.3, 0.18, 0.58),
      changeCd: [1.7 - d * 0.95, 2.9 - d * 1.1] as [number, number],
      hp: 145 + d * 95,
    };
  }

  private spawnDummy(): void {
    const t = this.tune;
    const player = this.s.world.player;
    const pos = this.randomPoint(player?.pos ?? null, 260, 140);
    const pattern = this.s.rng.pick<Pattern>(['weave', 'weave', 'juke', 'orbit']);
    const a = this.s.world.spawnActor({
      pos,
      team: 'enemy',
      maxHp: Math.round(t.hp),
      radius: this.s.rng.range(27, 40),
      moveSpeed: t.speed,
      archetype: this.s.rng.pick(DUMMY_SKINS),
      label: 'DUMMY',
      attack: { attackSpeed: 0.01, windupRatio: 0.2, backswingRatio: 0.2, range: 0, damage: 0, projectileSpeed: 0 },
    });
    this.dummies.push({
      actor: a,
      pattern,
      heading: this.s.rng.angle(),
      speedMul: this.s.rng.range(0.85, 1.15),
      anchor: { ...pos },
      orbitDir: this.s.rng.chance(0.5) ? 1 : -1,
      changeCd: this.s.rng.range(0.3, 1.1),
      dodgeCd: 0,
      burst: 0,
    });
  }

  update(dt: number): void {
    this.waveTime += dt;
    if (this.waveTime > 18) {
      this.waveTime = 0;
      this.wave++;
      this.s.setBanner(`WAVE ${this.wave}`, 1.2);
      audio.play('countdown');
    }

    for (const k of Object.keys(this.cooldowns) as Slot[]) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] -= dt;
    }

    this.resolvePending();

    const t = this.tune;
    const { w, h } = this.s.world.bounds;
    const player = this.s.world.player;
    for (const dm of this.dummies) {
      const a = dm.actor;
      if (dm.dodgeCd > 0) dm.dodgeCd -= dt;
      if (dm.burst > 0) dm.burst -= dt;
      if (dm.changeCd > 0) dm.changeCd -= dt;

      const reacted = dm.dodgeCd <= 0 && this.tryDodge(dm, t);
      if (!reacted && dm.changeCd <= 0) {
        dm.changeCd = this.s.rng.range(t.changeCd[0], t.changeCd[1]);
        this.retarget(dm, player);
      }

      // Bounce off the walls by flipping heading before the engine steps —
      // the actual movement (velocity, facing, bounds clamp) is left to the
      // world's own order system so a dummy walks and turns exactly like any
      // other actor instead of gliding.
      if (a.pos.x <= a.radius + 8 || a.pos.x >= w - a.radius - 8) dm.heading = Math.PI - dm.heading;
      if (a.pos.y <= a.radius + 8 || a.pos.y >= h - a.radius - 8) dm.heading = -dm.heading;
      a.moveSpeed = t.speed * dm.speedMul * (dm.burst > 0 ? 1.85 : 1);
      a.order = {
        kind: 'move',
        pos: { x: a.pos.x + Math.cos(dm.heading) * 400, y: a.pos.y + Math.sin(dm.heading) * 400 },
      };
    }

    // Dummies that die respawn immediately — the kill FX already fires off
    // the world's own 'death' event, so this is purely bookkeeping.
    for (let i = this.dummies.length - 1; i >= 0; i--) {
      if (!this.dummies[i].actor.alive) {
        this.kills++;
        this.dummies.splice(i, 1);
      }
    }
    this.s.world.actors = this.s.world.actors.filter((x) => x.alive || x.id === this.s.world.playerId);
    while (this.dummies.length < t.count) this.spawnDummy();
  }

  private retarget(dm: Dummy, player: Actor | undefined): void {
    if (dm.pattern === 'juke') {
      dm.heading = this.s.rng.angle();
      return;
    }
    if (dm.pattern === 'orbit') {
      if (this.s.rng.chance(0.25)) dm.orbitDir *= -1;
      const toAnchor = Math.atan2(dm.actor.pos.y - dm.anchor.y, dm.actor.pos.x - dm.anchor.x);
      dm.heading = toAnchor + (Math.PI / 2) * dm.orbitDir;
      return;
    }
    // weave: wander, biased to hold a mid-range band from the player.
    if (!player) {
      dm.heading = this.s.rng.angle();
      return;
    }
    const d = dist(dm.actor.pos, player.pos);
    const toPlayer = Math.atan2(player.pos.y - dm.actor.pos.y, player.pos.x - dm.actor.pos.x);
    let bias = toPlayer + Math.PI / 2;
    if (d > 760) bias = toPlayer;
    else if (d < 220) bias = toPlayer + Math.PI;
    dm.heading = bias + (this.s.rng.next() - 0.5) * 1.7;
  }

  /** Steps a dummy out of a telegraphed zone or an inbound skillshot. */
  private tryDodge(dm: Dummy, t: Tune): boolean {
    const a = dm.actor;
    for (const h of this.s.world.hazards) {
      if (h.team !== 'player' || h.warn <= 0 || h.warn > t.hazardWindow) continue;
      if (!this.s.world.hazardHits(h, a.pos, a.radius)) continue;
      if (!this.s.rng.chance(t.dodgeSkill)) continue;
      const away = norm(a.pos.x - h.pos.x, a.pos.y - h.pos.y);
      dm.heading = Math.atan2(away.y, away.x) + (this.s.rng.chance(0.5) ? 0.35 : -0.35);
      dm.burst = 0.35;
      dm.dodgeCd = 0.6;
      return true;
    }
    for (const p of this.s.world.projectiles) {
      if (p.team !== 'player' || p.targetId != null) continue;
      const toMe = { x: a.pos.x - p.pos.x, y: a.pos.y - p.pos.y };
      const d = Math.hypot(toMe.x, toMe.y);
      if (d > 480 || d < 24) continue;
      const timeToImpact = d / Math.max(1, p.speed);
      if (timeToImpact < t.reactionDelay) continue;
      const travel = Math.atan2(p.vel.y, p.vel.x);
      const bearing = Math.atan2(toMe.y, toMe.x);
      const delta = angleDelta(travel, bearing);
      if (Math.abs(delta) > 0.42) continue;
      if (!this.s.rng.chance(t.dodgeSkill)) continue;
      const side = delta > 0 ? 1 : -1;
      dm.heading = travel + (Math.PI / 2) * side;
      dm.burst = 0.3;
      dm.dodgeCd = 0.5;
      return true;
    }
    return false;
  }

  private resolvePending(): void {
    for (let i = this.pendingShots.length - 1; i >= 0; i--) {
      const ps = this.pendingShots[i];
      if ((ps.proj.hitIds?.size ?? 0) > 0) {
        this.registerHit(ps.slot, ps.proj.pos);
        this.pendingShots.splice(i, 1);
        continue;
      }
      if (!this.s.world.projectiles.includes(ps.proj)) {
        this.registerMiss(ps.slot);
        this.pendingShots.splice(i, 1);
      }
    }
    for (let i = this.pendingZones.length - 1; i >= 0; i--) {
      const pz = this.pendingZones[i];
      if (pz.hazard.warn > 0) continue;
      const landed = this.dummies.some((d) => this.s.world.hazardHits(pz.hazard, d.actor.pos, d.actor.radius));
      if (landed) this.registerHit(pz.slot, pz.hazard.pos);
      else this.registerMiss(pz.slot);
      this.pendingZones.splice(i, 1);
    }
  }

  private registerHit(slot: Slot, pos: Vec2): void {
    this.hits[slot]++;
    this.s.chain++;
    this.s.chainBest = Math.max(this.s.chainBest, this.s.chain);
    audio.setComboPitch(this.s.chain);
    audio.play(this.s.chain >= 3 ? 'perfect' : 'pickup');
    this.s.fx.impact(pos, 0, ABILITY_COLOR[slot], 1.1);
    this.s.fx.ring(pos.x, pos.y, 6, 60, 0.3, ABILITY_COLOR[slot], 2.4, 'impact');
    if (this.s.chain > 0 && this.s.chain % 4 === 0) this.s.micro(`${this.s.chain}x CHAIN`, pos, PALETTE.good);
  }

  private registerMiss(slot: Slot): void {
    this.misses[slot]++;
    this.s.chain = 0;
    audio.setComboPitch(0);
    audio.play('attackCancel');
    const p = this.s.world.player;
    if (slot === 'r' && p) this.s.micro('APEX MISSED', p.pos, PALETTE.textDim);
  }

  onAbility(slot: AbilitySlot, at: Vec2): void {
    if (slot === 'd' || slot === 'f') return;
    const s = slot as Slot;
    if (this.cooldowns[s] > 0) return;
    const player = this.s.world.player;
    if (!player) return;

    this.cooldowns[s] = COOLDOWN[s];
    const dir = norm(at.x - player.pos.x, at.y - player.pos.y);
    const from = { x: player.pos.x + dir.x * player.radius, y: player.pos.y + dir.y * player.radius };

    switch (s) {
      case 'q': {
        const speed = 2050;
        const proj = this.s.world.spawnProjectile({
          pos: from,
          team: 'player',
          ownerId: player.id,
          vel: { x: dir.x * speed, y: dir.y * speed },
          speed,
          damage: 40,
          radius: 15,
          pierce: true,
          shape: 'shard',
          maxLife: 0.85,
          color: ABILITY_COLOR.q,
        });
        this.pendingShots.push({ proj, slot: s });
        break;
      }
      case 'e': {
        const speed = 1550;
        const proj = this.s.world.spawnProjectile({
          pos: from,
          team: 'player',
          ownerId: player.id,
          vel: { x: dir.x * speed, y: dir.y * speed },
          speed,
          damage: 46,
          radius: 12,
          pierce: true,
          shape: 'orb',
          maxLife: 0.7,
          effect: { root: 0.5 },
          color: ABILITY_COLOR.e,
        });
        this.pendingShots.push({ proj, slot: s });
        break;
      }
      case 'w': {
        const hazard = this.s.world.spawnHazard({
          pos: { ...player.pos },
          end: at,
          team: 'player',
          shape: 'cone',
          radius: 480,
          width: 0.3,
          warn: 0.1,
          active: 0.16,
          damage: 34,
          color: ABILITY_COLOR.w,
        });
        this.pendingZones.push({ hazard, slot: s });
        break;
      }
      case 'r': {
        this.s.fx.addShake(3);
        const hazard = this.s.world.spawnHazard({
          pos: { ...at },
          team: 'player',
          shape: 'circle',
          radius: 165,
          warn: 0.9,
          active: 0.3,
          damage: 95,
          color: ABILITY_COLOR.r,
        });
        this.pendingZones.push({ hazard, slot: s });
        break;
      }
    }
  }

  paint(out: DrillPaint, _t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    // A faint guide from your champion to the cursor, capped to LANCE's reach
    // — the one number every skillshot decision actually runs on.
    const cur = this.s.cursorWorld;
    const d = Math.min(dist(p.pos, cur), 1740);
    const dir = norm(cur.x - p.pos.x, cur.y - p.pos.y);
    out.markers.push({
      kind: 'line',
      x: p.pos.x,
      y: p.pos.y,
      x2: p.pos.x + dir.x * d,
      y2: p.pos.y + dir.y * d,
      halfWidth: 2,
      color: PALETTE.accentDim,
      alpha: 0.4,
      dash: 26,
      rise: 1.4,
    });
    for (const dm of this.dummies) {
      const a = dm.actor;
      out.markers.push({
        kind: 'line',
        x: a.pos.x,
        y: a.pos.y,
        x2: a.pos.x + Math.cos(dm.heading) * (a.radius + 30),
        y2: a.pos.y + Math.sin(dm.heading) * (a.radius + 30),
        halfWidth: 2.5,
        color: dm.burst > 0 ? PALETTE.danger : PALETTE.textFaint,
        alpha: dm.burst > 0 ? 0.8 : 0.4,
        rise: 1.6,
      });
    }
  }

  abilities(): AbilityView[] {
    return super.abilities().map((a) => {
      if (a.slot === 'd' || a.slot === 'f') return a;
      const s = a.slot as Slot;
      return {
        ...a,
        name: ABILITY_NAME[s],
        cd: clamp(this.cooldowns[s] / COOLDOWN[s], 0, 1),
        highlight: false,
        locked: false,
      };
    });
  }

  hudFields(): HudField[] {
    const totalHits = this.hits.q + this.hits.w + this.hits.e + this.hits.r;
    const totalMisses = this.misses.q + this.misses.w + this.misses.e + this.misses.r;
    const rate = totalHits + totalMisses > 0 ? totalHits / (totalHits + totalMisses) : 0;
    return [
      { label: 'LANDED', value: `${totalHits}`, tone: 'neutral' },
      { label: 'HIT RATE', value: `${Math.round(rate * 100)}%`, bar: rate, tone: rate > 0.6 ? 'good' : rate > 0.4 ? 'warn' : 'bad' },
      { label: 'CHAIN', value: `${this.s.chain}`, tone: this.s.chain >= 3 ? 'good' : 'neutral' },
    ];
  }

  liveScore(): number {
    const totalHits = this.hits.q + this.hits.w + this.hits.e + this.hits.r;
    const totalMisses = this.misses.q + this.misses.w + this.misses.e + this.misses.r;
    return Math.max(
      0,
      Math.round(totalHits * 340 + this.hits.r * 380 + this.kills * 260 - totalMisses * 130 + this.s.chainBest * 60),
    );
  }

  outcome(): DrillOutcome {
    const totalHits = this.hits.q + this.hits.w + this.hits.e + this.hits.r;
    const totalMisses = this.misses.q + this.misses.w + this.misses.e + this.misses.r;
    const totalAttempts = totalHits + totalMisses;
    const hitRate = totalAttempts > 0 ? totalHits / totalAttempts : 0;
    const perMinute = totalAttempts / Math.max(0.1, this.s.elapsed / 60);
    const volume = band(perMinute, 8, 30);
    const streak = band(this.s.chainBest, 2, 9);

    const performance = clamp(hitRate * 0.55 + volume * 0.22 + streak * 0.15 + band(this.kills, 0, 6) * 0.08, 0, 1);

    const rateOf = (s: Slot) => (this.hits[s] + this.misses[s] > 0 ? this.hits[s] / (this.hits[s] + this.misses[s]) : null);
    const qr = rateOf('q');
    const wr = rateOf('w');
    const rr = rateOf('r');

    const helped: string[] = [];
    const hurt: string[] = [];
    if (hitRate > 0.65 && totalAttempts > 8) helped.push(`${Math.round(hitRate * 100)}% of your casts landed on a target that was actively juking.`);
    if (this.s.chainBest >= 5) helped.push(`A ${this.s.chainBest}-hit chain without a whiff.`);
    if (this.kills > 3) helped.push(`${this.kills} dummies downed.`);
    if (rr !== null && rr > 0.5) helped.push('You are predicting APEX correctly — that is the hardest read in the kit.');
    if (qr !== null && qr < 0.4) hurt.push('LANCE is your fastest, thinnest shot — most of its misses are late reactions, not bad reads.');
    if (wr !== null && wr < 0.55) hurt.push('ARC is a forgiving cone; a sub-55% rate there means you are firing on cooldown, not on a read.');
    if (totalAttempts > 0 && perMinute < 8) hurt.push('You are holding cooldowns too long. A skillshot on cooldown is a skillshot that cannot miss twice.');
    if (totalMisses > totalHits && totalAttempts > 6) hurt.push('More misses than hits — slow down and wait for a committed movement before casting.');

    const advice =
      qr !== null && wr !== null && qr < wr - 0.15
        ? 'Lead LANCE further than feels right — it is your fastest shot, but the target still has the whole flight time to move.'
        : perMinute < 10
          ? 'Cast more often. A missed skillshot on a 1-second cooldown costs almost nothing; a shot you never threw costs everything.'
          : 'Start mixing APEX in earlier in the fight — its long telegraph is what makes it your highest-value read.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { skillshot: performance, aim: clamp(performance * 0.75 + 0.08, 0, 1) },
      keyMetrics: [
        pct('hitRate', 'HIT RATE', hitRate),
        count('landed', 'SHOTS LANDED', totalHits),
        count('casts', 'CASTS', totalAttempts),
        count('chain', 'BEST CHAIN', this.s.chainBest),
        count('kills', 'DUMMIES DOWNED', this.kills),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
