import { clamp, dist } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import { hexA } from '../engine/renderer';
import type { HudField } from '../engine/session';
import { Drill, band, count, pct, secs, units, type DrillOutcome } from './base';

/**
 * SPACING — hold the edge.
 *
 * The enemy's reach is shorter than yours. The entire drill is the band
 * between the two: stand inside it and you trade for free, drift in and you
 * get hit, drift out and your damage does nothing.
 */
export class SpacingDrill extends Drill {
  private inBand = 0;
  private tooClose = 0;
  private tooFar = 0;
  private total = 0;
  private perfectStreak = 0;
  private bestStreak = 0;
  private lastMicro = 0;
  private phaseCd = 3.5;
  private pressuring = true;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.3, y: h / 2 });
    // Health is the running cost of bad spacing over sixty seconds, not a
    // three-strikes fail state.
    p.maxHp = 1150;
    p.hp = 1150;
    this.spawnSparring();
  }

  private spawnSparring(): void {
    const { w, h } = this.s.world.bounds;
    const a = this.spawnEnemy('ranger', { x: w * 0.72, y: h / 2 }, { hpScale: 4.2 });
    // Shorter reach than the player: the band is the whole point of the drill.
    a.attack.range = 320;
    a.attack.damage = 26;
    a.attack.projectileSpeed = 1200;
    // Slower than you, and it wants to sit just inside its own reach — so
    // holding the band is always achievable, and losing it is your doing.
    a.moveSpeed = 192 + this.s.config.difficulty * 62;
    a.label = 'SPARRING';
    const brain = this.brains[this.brains.length - 1];
    if (brain) brain.preferredRange = this.pressuring ? 285 : 660;
  }

  private get bandRange(): [number, number] {
    const p = this.s.world.player!;
    const e = this.s.world.enemies()[0];
    const inner = (e ? e.attack.range : 320) + p.radius + 30;
    const outer = p.attack.range + (e ? e.radius : 26);
    return [inner, outer];
  }

  update(dt: number): void {
    this.updateBrains(dt);
    if (this.s.world.enemies().length === 0) this.spawnSparring();

    // The partner alternates between stepping up and resetting. That rhythm is
    // the actual lesson: match their movement instead of holding ground.
    this.phaseCd -= dt;
    if (this.phaseCd <= 0) {
      this.pressuring = !this.pressuring;
      this.phaseCd = this.s.rng.range(3.2, 5.4) - this.s.config.difficulty * 1.2;
      for (const b of this.brains) b.preferredRange = this.pressuring ? 285 : 660;
      const e = this.s.world.enemies()[0];
      if (e) {
        this.s.fx.ring(
          e.pos.x,
          e.pos.y,
          e.radius + 6,
          e.radius + (this.pressuring ? 70 : 40),
          0.5,
          this.pressuring ? PALETTE.danger : PALETTE.textDim,
          2.4,
          this.pressuring ? 'shock' : 'pulse',
        );
      }
    }

    const p = this.s.world.player;
    const e = this.s.world.enemies()[0];
    if (!p || !e) return;

    const d = dist(p.pos, e.pos);
    const [inner, outer] = this.bandRange;
    this.total += dt;
    if (d < inner) {
      this.tooClose += dt;
      this.perfectStreak = 0;
    } else if (d > outer) {
      this.tooFar += dt;
      this.perfectStreak = 0;
    } else {
      this.inBand += dt;
      this.perfectStreak += dt;
      this.bestStreak = Math.max(this.bestStreak, this.perfectStreak);
      if (this.perfectStreak > 3 && this.s.elapsed - this.lastMicro > 3) {
        this.lastMicro = this.s.elapsed;
        this.s.micro('PERFECT SPACING', p.pos, PALETTE.good);
        this.s.fx.ring(p.pos.x, p.pos.y, p.radius + 8, p.radius + 46, 0.5, PALETTE.good, 2, 'pulse');
      }
    }
    if (d < inner && this.s.elapsed - this.lastMicro > 2.2) {
      this.lastMicro = this.s.elapsed;
      this.s.micro('TOO CLOSE', p.pos, PALETTE.danger);
    }
  }

  drawOverlay(ctx: CanvasRenderingContext2D, scale: number, t: number): void {
    const p = this.s.world.player;
    const e = this.s.world.enemies()[0];
    if (!p || !e) return;
    const [inner, outer] = this.bandRange;
    const d = dist(p.pos, e.pos);
    const good = d >= inner && d <= outer;

    // The band itself, drawn around the enemy.
    ctx.beginPath();
    ctx.arc(e.pos.x, e.pos.y, outer, 0, Math.PI * 2);
    ctx.arc(e.pos.x, e.pos.y, inner, 0, Math.PI * 2, true);
    ctx.fillStyle = hexA(PALETTE.good, good ? 0.075 + 0.02 * Math.sin(t * 4) : 0.035);
    ctx.fill();

    ctx.setLineDash([8, 10]);
    ctx.lineWidth = 1.8 / scale;
    ctx.strokeStyle = hexA(PALETTE.good, good ? 0.7 : 0.32);
    ctx.beginPath();
    ctx.arc(e.pos.x, e.pos.y, outer, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexA(PALETTE.danger, 0.5);
    ctx.beginPath();
    ctx.arc(e.pos.x, e.pos.y, inner, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // A live readout of the error, drawn on the line between the two units.
    const err = d < inner ? inner - d : d > outer ? d - outer : 0;
    if (err > 4) {
      const mx = (p.pos.x + e.pos.x) / 2;
      const my = (p.pos.y + e.pos.y) / 2;
      ctx.font = `600 ${16 / scale}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = hexA(d < inner ? PALETTE.danger : PALETTE.warn, 0.85);
      ctx.fillText(`${d < inner ? '-' : '+'}${Math.round(err)}u`, mx, my - 12 / scale);
    }
  }

  hudFields(): HudField[] {
    const frac = this.total > 0 ? this.inBand / this.total : 0;
    return [
      { label: 'IN BAND', value: `${Math.round(frac * 100)}%`, bar: frac, tone: frac > 0.75 ? 'good' : frac > 0.55 ? 'warn' : 'bad' },
      { label: 'TOO CLOSE', value: `${this.tooClose.toFixed(1)}s`, tone: this.tooClose > 6 ? 'bad' : 'neutral' },
      { label: 'STREAK', value: `${this.perfectStreak.toFixed(1)}s`, tone: 'good' },
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    // Time in the band only counts while you are actually trading from it.
    const trading = clamp(derive(m).attackEfficiency, 0, 1);
    return Math.max(0, Math.round(
      this.inBand * 900 * trading + m.damageDealt * 4 + this.bestStreak * 260 * trading - this.tooClose * 420 - m.hpLost * 4,
    ));
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    const d = derive(m);
    const frac = this.total > 0 ? this.inBand / this.total : 0;
    const closeRate = this.total > 0 ? this.tooClose / this.total : 0;
    const errScore = band(d.avgSpacingError, 260, 35);

    // Standing still while the partner happens to walk past you is not
    // spacing. Everything is gated on actually trading — you have to be
    // holding the edge *and* using it.
    const engagement = band(d.attackEfficiency, 0.12, 0.75);
    const performance = clamp(
      (frac * 0.4 + errScore * 0.18 + d.hpRetained * 0.14 + band(closeRate, 0.4, 0.02) * 0.1 + d.attackEfficiency * 0.18) *
        (0.3 + 0.7 * engagement),
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (frac > 0.8) helped.push(`${Math.round(frac * 100)}% of the run spent inside your free-trade band.`);
    if (this.bestStreak > 8) helped.push(`Held perfect spacing for ${this.bestStreak.toFixed(1)}s straight.`);
    if (closeRate > 0.2) hurt.push(`${Math.round(closeRate * 100)}% of the run inside their reach for no reason.`);
    if (this.tooFar / Math.max(1, this.total) > 0.25) hurt.push('A quarter of the run was spent out of your own range, doing nothing.');
    if (m.hpLost > 150) hurt.push(`${Math.round(d.hpLostCapped)} health lost to a shorter-ranged opponent.`);
    if (engagement < 0.3) hurt.push('You held position but barely attacked — spacing only pays if you are trading from it.');

    const advice =
      closeRate > 0.18
        ? 'When they step toward you, step back the same distance. Match their movement instead of holding ground.'
        : this.tooFar / Math.max(1, this.total) > 0.25
          ? 'You are backing off too far. The edge of your range is the profitable place to stand.'
          : 'Excellent. Carry this exact distance into the 1v1 arena.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { spacing: performance, movement: clamp(frac * 0.85 + 0.1, 0, 1) },
      keyMetrics: [
        pct('inBand', 'TIME IN BAND', frac),
        units('spacingErr', 'AVG SPACING ERROR', d.avgSpacingError),
        secs('tooClose', 'TIME TOO CLOSE', this.tooClose, 'lower'),
        secs('streak', 'BEST STREAK', this.bestStreak),
        count('damage', 'DAMAGE DEALT', Math.round(m.damageDealt)),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
