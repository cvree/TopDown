import { audio } from '../engine/audio';
import { clamp } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { Actor } from '../engine/types';
import type { WorldEvent } from '../engine/world';
import { Drill, band, count, pct, type DrillOutcome } from './base';

/**
 * LAST HIT — the killing blow.
 *
 * Friendly fire chips the minions down; you take the final hit. Landing it
 * with exactly one attack is "perfect" — hitting a healthy minion three times
 * to secure it is the habit this drill is trying to remove, and it is scored
 * accordingly.
 */
export class LastHitDrill extends Drill {
  private minions: Actor[] = [];
  private allyTick = 0;
  private waveCd = 0;
  private waveIndex = 0;
  private attacksOn = new Map<number, number>();
  private perfect = 0;
  private secured = 0;
  private lost = 0;
  private wasted = 0;
  private harasser: Actor | null = null;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.72 });
    this.spawnWave();
    if (this.s.config.difficulty > 0.5) {
      const a = this.spawnEnemy('ranger', { x: w * 0.5, y: h * 0.14 }, { hpScale: 6 });
      a.attack.damage = 22;
      a.label = 'HARASS';
      this.harasser = a;
    }
  }

  private get d(): number {
    return this.s.config.difficulty;
  }

  private spawnWave(): void {
    this.waveIndex++;
    const { w, h } = this.s.world.bounds;
    const n = 3 + Math.floor(this.d * 3);
    const y = h * 0.38;
    for (let i = 0; i < n; i++) {
      const x = w * 0.5 + (i - (n - 1) / 2) * (110 - this.d * 22);
      const hp = 200 + this.s.rng.range(-40, 60) + this.d * 60;
      const m = this.s.world.spawnActor({
        pos: { x, y: y + this.s.rng.range(-30, 30) },
        team: 'enemy',
        maxHp: Math.round(hp),
        radius: 23,
        moveSpeed: 0,
        isMinion: true,
        goldValue: 1,
        label: 'MINION',
        attack: { attackSpeed: 0.01, windupRatio: 0.3, backswingRatio: 0.3, range: 0, damage: 0, projectileSpeed: 0 },
      });
      this.minions.push(m);
    }
    this.waveCd = 9.5 - this.d * 2.4;
  }

  update(dt: number): void {
    this.updateBrains(dt);

    // Allied fire: a steady drain that gets faster with difficulty, so the
    // window between "not yet dead" and "dead" narrows.
    this.allyTick -= dt;
    if (this.allyTick <= 0) {
      this.allyTick = clamp(1.15 - this.d * 0.55, 0.35, 1.2);
      const living = this.minions.filter((m) => m.alive);
      if (living.length) {
        const t = living[this.s.rng.int(0, living.length)];
        const dmg = 26 + this.d * 22 + this.s.rng.range(-6, 6);
        this.s.world.damage(t, dmg, undefined);
        this.s.fx.ring(t.pos.x, t.pos.y, 4, 26, 0.2, PALETTE.textFaint, 1.5, 'impact');
      }
    }

    this.waveCd -= dt;
    if (this.waveCd <= 0 || this.minions.every((m) => !m.alive)) {
      this.minions = this.minions.filter((m) => m.alive);
      if (this.minions.length < 3) this.spawnWave();
      else this.waveCd = 2;
    }
    void this.harasser;
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type === 'attackLand' && e.actorId === pid && e.targetId != null) {
        const t = this.s.world.byId(e.targetId);
        if (t?.isMinion) this.attacksOn.set(t.id, (this.attacksOn.get(t.id) ?? 0) + 1);
      }
      if (e.type === 'death' && e.actorId != null) {
        const victim = this.s.world.byId(e.actorId);
        if (!victim?.isMinion) continue;
        const hits = this.attacksOn.get(victim.id) ?? 0;
        if (e.byPlayer) {
          this.secured++;
          if (hits <= 1) {
            this.perfect++;
            this.s.chain++;
            this.s.chainBest = Math.max(this.s.chainBest, this.s.chain);
            audio.setComboPitch(this.s.chain);
            audio.play('perfect');
            this.s.micro('PERFECT', victim.pos, PALETTE.good);
            this.s.fx.ring(victim.pos.x, victim.pos.y, 8, 90, 0.45, PALETTE.good, 3, 'impact');
          } else {
            this.wasted += hits - 1;
            this.s.micro('LAST HIT', victim.pos, PALETTE.warn);
          }
        } else {
          this.lost++;
          this.s.chain = 0;
          audio.setComboPitch(0);
          this.s.micro('MISSED CS', victim.pos, PALETTE.danger);
          this.s.fx.ring(victim.pos.x, victim.pos.y, 8, 60, 0.35, PALETTE.danger, 2, 'impact');
        }
      }
    }
  }

  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    for (const m of this.minions) {
      if (!m.alive || m.hp > p.attack.damage) continue;
      // A minion that dies to your next attack gets a clear, calm mark. It
      // never tells you *when* to click — only that this one is now worth it.
      const pulse = 0.55 + 0.45 * Math.sin(t * 9);
      out.markers.push({
        kind: 'ring',
        x: m.pos.x,
        y: m.pos.y,
        radius: m.radius + 14 + pulse * 4,
        color: PALETTE.good,
        alpha: 0.55 + pulse * 0.4,
        width: 4,
        rise: 2.4,
      });
    }
  }

  hudFields(): HudField[] {
    const attempts = this.secured + this.lost;
    const acc = attempts > 0 ? this.secured / attempts : 1;
    return [
      { label: 'CS', value: `${this.secured}`, tone: 'neutral' },
      { label: 'ACCURACY', value: `${Math.round(acc * 100)}%`, bar: acc, tone: acc > 0.9 ? 'good' : acc > 0.7 ? 'warn' : 'bad' },
      { label: 'PERFECT', value: `${this.perfect}`, tone: 'good' },
    ];
  }

  liveScore(): number {
    return Math.max(0, Math.round(this.secured * 900 + this.perfect * 620 - this.lost * 700 - this.wasted * 160 - this.s.metrics.m.hpLost * 2));
  }

  outcome(): DrillOutcome {
    const attempts = this.secured + this.lost;
    const acc = attempts > 0 ? this.secured / attempts : 0;
    const perfectRate = this.secured > 0 ? this.perfect / this.secured : 0;
    const waste = this.secured > 0 ? this.wasted / this.secured : 0;
    const volume = band(this.secured / Math.max(1, this.s.elapsed / 60), 6, 26);

    const performance = clamp(acc * 0.42 + perfectRate * 0.26 + volume * 0.20 + band(waste, 1.5, 0.05) * 0.12, 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (acc > 0.92 && attempts > 8) helped.push(`${Math.round(acc * 100)}% of available minions secured.`);
    if (perfectRate > 0.7) helped.push('Most kills took exactly one attack — no wasted damage.');
    if (this.lost > 3) hurt.push(`${this.lost} minions died before you hit them.`);
    if (waste > 0.6) hurt.push('You are attacking healthy minions and then waiting — that is where the misses come from.');

    const advice =
      waste > 0.6
        ? 'Hold your attack until the health bar crosses the marker. Every early attack puts your timer on cooldown.'
        : acc < 0.75
          ? 'Start your attack slightly before the bar reaches the marker — the windup takes time.'
          : 'Add pressure: raise the difficulty and keep the same accuracy with a harasser on you.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { lastHitting: performance, aim: clamp(acc, 0, 1) },
      keyMetrics: [
        pct('csAcc', 'CS ACCURACY', acc),
        count('cs', 'MINIONS SECURED', this.secured),
        count('perfect', 'PERFECT LAST HITS', this.perfect),
        count('lost', 'MISSED', this.lost, 'lower'),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
