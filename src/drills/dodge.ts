import { audio } from '../engine/audio';
import { clamp, norm } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { HudField } from '../engine/session';
import type { Vec2 } from '../engine/types';
import { Drill, count, pct, secs, type DrillOutcome } from './base';

type Pattern = 'volley' | 'radial' | 'sweep' | 'zone' | 'ring' | 'crossfire' | 'spiral';

/**
 * DODGE — skillshot survival.
 *
 * Everything here is telegraphed. The lesson is that a dodge is one correct
 * movement made early, not five panicked ones made late.
 */
export class DodgeDrill extends Drill {
  private wave = 1;
  private waveTime = 0;
  private nextPattern = 1.2;
  private threats = 0;
  /** Distinct patterns fired — the unit a player actually reacts to. */
  private patterns = 0;
  private startHp = 760;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w / 2, y: h / 2 });
    p.attack.range = 0;
    this.startHp = p.maxHp;
  }

  private get d(): number {
    // Difficulty rises through the run as well as with the player's rating.
    return clamp(this.s.config.difficulty * 0.75 + (this.wave - 1) * 0.075, 0, 1.15);
  }

  update(dt: number): void {
    this.waveTime += dt;
    if (this.waveTime > 15) {
      this.waveTime = 0;
      this.wave++;
      this.s.setBanner(`WAVE ${this.wave}`, 1.2);
      this.s.fx.addFlash(0.06, PALETTE.warn);
      audio.play('countdown');
    }

    this.nextPattern -= dt;
    if (this.nextPattern <= 0) {
      const d = this.d;
      this.nextPattern = clamp(1.55 - d * 0.85, 0.42, 1.6);
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

  private shot(from: Vec2, to: Vec2, speed: number, radius = 15, damage = 44, pierce = true): void {
    const dir = norm(to.x - from.x, to.y - from.y);
    this.threats++;
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
        const from = this.edgePoint();
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
        const c = this.randomPoint(player.pos, 300, 200);
        const n = 8 + Math.floor(d * 10);
        const off = this.s.rng.angle();
        this.s.fx.ring(c.x, c.y, 4, 120, 0.4, PALETTE.danger, 3, 'shock');
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          this.shot(c, { x: c.x + Math.cos(a) * 900, y: c.y + Math.sin(a) * 900 }, speed * 0.82, 13, 36);
        }
        break;
      }
      case 'spiral': {
        const c = { x: this.s.world.bounds.w / 2, y: this.s.world.bounds.h / 2 };
        const n = 10 + Math.floor(d * 8);
        const off = this.s.rng.angle();
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          const delay = i * 0.045;
          setTimeoutSafe(() => {
            if (this.s.phase !== 'running') return;
            this.shot(c, { x: c.x + Math.cos(a) * 900, y: c.y + Math.sin(a) * 900 }, speed * 0.75, 12, 32);
          }, delay * 1000);
        }
        break;
      }
      case 'zone': {
        const n = 1 + Math.floor(d * 2.6);
        for (let i = 0; i < n; i++) {
          const at = i === 0 ? this.playerLead(0.5) : this.randomPoint(player.pos, 120, 160);
          this.threats++;
          this.s.world.spawnHazard({
            pos: at,
            team: 'enemy',
            shape: 'circle',
            radius: 118 + d * 42,
            warn: clamp(1.05 - d * 0.42, 0.42, 1.1),
            active: 0.28,
            damage: 58,
            color: PALETTE.hazard,
          });
        }
        break;
      }
      case 'ring': {
        const c = this.randomPoint(player.pos, 0, 240);
        this.threats++;
        this.s.world.spawnHazard({
          pos: c,
          team: 'enemy',
          shape: 'ring',
          radius: 300 + d * 90,
          width: 140,
          warn: clamp(1.0 - d * 0.35, 0.5, 1.05),
          active: 0.3,
          damage: 52,
          color: PALETTE.violet,
        });
        break;
      }
      case 'sweep': {
        const c = this.randomPoint(player.pos, 200, 160);
        const a = this.s.rng.angle();
        this.threats++;
        this.s.world.spawnHazard({
          pos: c,
          end: { x: c.x + Math.cos(a) * 1100, y: c.y + Math.sin(a) * 1100 },
          team: 'enemy',
          shape: 'line',
          width: 46 + d * 16,
          warn: clamp(0.95 - d * 0.35, 0.45, 1.0),
          active: 0.34,
          damage: 54,
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
          const dir = ang + off;
          this.s.world.spawnHazard({
            pos: { x: a.x - Math.cos(dir) * 700, y: a.y - Math.sin(dir) * 700 },
            end: { x: a.x + Math.cos(dir) * 700, y: a.y + Math.sin(dir) * 700 },
            team: 'enemy',
            shape: 'line',
            width: 50,
            warn: clamp(0.9 - d * 0.3, 0.45, 0.95),
            active: 0.3,
            damage: 50,
            color: PALETTE.danger,
          });
        }
        break;
      }
    }
  }

  hudFields(): HudField[] {
    const m = this.s.metrics.m;
    const rate = this.patterns > 0 ? 1 - m.hitsTaken / this.patterns : 1;
    return [
      { label: 'WAVE', value: `${this.wave}`, tone: 'neutral' },
      { label: 'CLEAN', value: `${Math.round(clamp(rate, 0, 1) * 100)}%`, bar: clamp(rate, 0, 1), tone: rate > 0.9 ? 'good' : rate > 0.75 ? 'warn' : 'bad' },
      { label: 'NEAR MISS', value: `${m.nearMisses}`, tone: 'good' },
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    return Math.max(0, Math.round(this.s.elapsed * 180 * this.wave * 0.55 + m.nearMisses * 90 - m.hitsTaken * 700));
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

    const performance = clamp(
      dodgeRate * 0.3 + pressure * 0.24 + hpRetained * 0.2 + survival * 0.18 + sharpness * 0.08,
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (dodgeRate > 0.93) helped.push('You dodged almost everything thrown at you.');
    if (m.nearMisses > 8) helped.push(`${m.nearMisses} near misses — you are dodging by inches, not by fleeing.`);
    if (survival >= 1) helped.push(`Survived all ${this.wave} waves.`);
    if (m.hitsTaken > 4) hurt.push(`${m.hitsTaken} hits taken.`);
    if (m.hazardExposure > 1.5) hurt.push(`${m.hazardExposure.toFixed(1)}s spent standing inside telegraphed ground.`);
    if (!m.survived) hurt.push('The run ended early — you died on wave ' + this.wave + '.');

    const advice =
      m.hazardExposure > 1.2
        ? 'Move on the telegraph, not on the explosion. The warning is the whole window.'
        : dodgeRate < 0.8
          ? 'Commit to one direction. Two half-dodges land you back in the line.'
          : 'Start dodging with smaller movements — you have room to stay closer to the action.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { dodging: performance, movement: clamp(performance * 0.9 + 0.05, 0, 1) },
      keyMetrics: [
        pct('dodgeRate', 'DODGE RATE', dodgeRate),
        secs('survival', 'SURVIVED', m.survivalTime),
        count('hits', 'HITS TAKEN', m.hitsTaken, 'lower'),
        count('nearMiss', 'NEAR MISSES', m.nearMisses),
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

/** Timers used only for staggered visual patterns; never for simulation state. */
const setTimeoutSafe = (fn: () => void, ms: number): void => {
  window.setTimeout(fn, ms);
};
