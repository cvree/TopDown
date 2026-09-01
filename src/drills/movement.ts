import { hexA } from '../engine/renderer';
import { clamp, dist } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { HudField } from '../engine/session';
import type { Vec2 } from '../engine/types';
import { Drill, band, count, pct, type DrillOutcome } from './base';
import { audio } from '../engine/audio';

interface Node {
  pos: Vec2;
  radius: number;
  born: number;
  ttl: number;
  /** Set when the player enters it. */
  taken: boolean;
}

/**
 * MOVEMENT — precision pathing.
 *
 * Nodes light up one at a time; you move onto them. The drill measures the
 * thing that actually separates good movement from bad: how much distance you
 * waste getting somewhere, and how many commands it took you.
 */
export class MovementDrill extends Drill {
  private nodes: Node[] = [];
  private hit = 0;
  private missed = 0;
  private idealDistance = 0;
  private travelled = 0;
  private lastPos: Vec2 | null = null;
  private lastNodeAt = 0;
  private arrivalTimes: number[] = [];
  private pendingIdeal = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.spawnPlayer({ x: w / 2, y: h / 2 });
    this.spawnNode();
  }

  private get difficulty(): number {
    return this.s.config.difficulty;
  }

  private spawnNode(): void {
    const player = this.s.world.player;
    const from = player?.pos ?? null;
    const d = this.difficulty;
    const minDist = 260 + d * 220;
    const pos = this.randomPoint(from, minDist, 110);
    const radius = 62 - d * 22;
    // The window tightens with difficulty: at the top you must move immediately.
    const travel = from ? dist(from, pos) : 400;
    const ttl = travel / (345 * (0.72 + d * 0.5)) + (1.5 - d * 0.85);
    this.nodes.push({ pos, radius, born: this.s.elapsed, ttl, taken: false });
    this.pendingIdeal = travel;
    this.lastNodeAt = this.s.elapsed;
    this.s.fx.ring(pos.x, pos.y, radius * 1.9, radius, 0.4, PALETTE.accent, 2.5, 'range');
  }

  update(dt: number): void {
    const player = this.s.world.player;
    if (!player) return;

    if (this.lastPos) this.travelled += dist(this.lastPos, player.pos);
    else this.lastPos = { ...player.pos };
    this.lastPos.x = player.pos.x;
    this.lastPos.y = player.pos.y;

    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const age = this.s.elapsed - n.born;
      if (dist(player.pos, n.pos) < n.radius) {
        this.nodes.splice(i, 1);
        this.hit++;
        this.idealDistance += this.pendingIdeal;
        this.arrivalTimes.push((this.s.elapsed - this.lastNodeAt) * 1000);
        audio.play('pickup');
        this.s.fx.burst(n.pos.x, n.pos.y, 18, { color: PALETTE.accent, speed: 340, life: 0.5, size: 2.6 });
        this.s.fx.ring(n.pos.x, n.pos.y, n.radius, n.radius * 2.6, 0.4, PALETTE.accent, 3, 'impact');
        this.s.chain++;
        this.s.chainBest = Math.max(this.s.chainBest, this.s.chain);
        audio.setComboPitch(this.s.chain);
        if (this.s.chain >= 3) this.s.micro(`x${this.s.chain}`, n.pos, PALETTE.good);
        this.spawnNode();
      } else if (age > n.ttl) {
        this.nodes.splice(i, 1);
        this.missed++;
        this.idealDistance += this.pendingIdeal;
        this.s.chain = 0;
        audio.setComboPitch(0);
        this.s.fx.ring(n.pos.x, n.pos.y, n.radius, n.radius * 0.4, 0.3, PALETTE.textFaint, 2, 'impact');
        this.s.micro('TOO SLOW', n.pos, PALETTE.textDim);
        this.spawnNode();
      }
    }
    void dt;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, scale: number, t: number): void {
    for (const n of this.nodes) {
      const age = this.s.elapsed - n.born;
      const left = clamp(1 - age / n.ttl, 0, 1);
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);

      ctx.beginPath();
      ctx.arc(n.pos.x, n.pos.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = hexA(PALETTE.accent, 0.07 + pulse * 0.05);
      ctx.fill();
      ctx.strokeStyle = hexA(PALETTE.accent, 0.55);
      ctx.lineWidth = 2 / scale;
      ctx.stroke();

      // The remaining window drawn as a depleting arc — readable at a glance.
      ctx.beginPath();
      ctx.arc(n.pos.x, n.pos.y, n.radius + 9, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
      ctx.strokeStyle = left < 0.3 ? hexA(PALETTE.danger, 0.9) : hexA(PALETTE.accent, 0.85);
      ctx.lineWidth = 4 / scale;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(n.pos.x, n.pos.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.playerCore;
      ctx.fill();
    }
  }

  hudFields(): HudField[] {
    const eff = this.pathEfficiency();
    return [
      { label: 'NODES', value: `${this.hit}`, tone: 'neutral' },
      { label: 'MISSED', value: `${this.missed}`, tone: this.missed > 2 ? 'bad' : 'neutral' },
      { label: 'PATH EFF', value: `${Math.round(eff * 100)}%`, bar: eff, tone: eff > 0.85 ? 'good' : eff > 0.7 ? 'warn' : 'bad' },
    ];
  }

  private pathEfficiency(): number {
    // A player who never moved has no efficiency to speak of — reporting 1
    // here would let doing nothing score like a perfect run.
    if (this.hit === 0) return 0;
    if (this.travelled < 50) return 0;
    return clamp(this.idealDistance / Math.max(1, this.travelled), 0, 1);
  }

  liveScore(): number {
    return Math.max(0, Math.round(this.hit * 620 * this.pathEfficiency() - this.missed * 220));
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    const eff = this.pathEfficiency();
    const rate = this.hit / Math.max(1, this.s.elapsed);
    // Targets: ~0.55 nodes/sec is competent, ~0.95 is excellent.
    const rateScore = band(rate, 0.28, 0.9);
    const accuracy = this.hit / Math.max(1, this.hit + this.missed);
    const clickWaste = m.clicks > 0 ? m.redundantClicks / m.clicks : 0;
    const cleanliness = band(clickWaste, 0.35, 0.02);
    const efficiency = band(eff, 0.55, 0.95);

    // Cleanliness is a modifier on real work, never a source of score on its
    // own: with no nodes reached the whole thing collapses to zero.
    const performance = clamp(
      (efficiency * 0.4 + rateScore * 0.32 + accuracy * 0.2 + cleanliness * 0.08) *
        (this.hit === 0 ? 0 : 1),
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (eff > 0.88) helped.push('Almost no wasted distance — your clicks went where you needed to be.');
    if (accuracy === 1 && this.hit > 6) helped.push('Every node reached inside its window.');
    if (clickWaste > 0.18) hurt.push('A fifth of your clicks were repeats of the same command.');
    if (eff < 0.72) hurt.push('You travelled well past the direct path — you are clicking short and re-clicking.');
    if (this.missed > 2) hurt.push(`${this.missed} nodes expired before you arrived.`);

    const advice =
      eff < 0.75
        ? 'Click the node itself, not the ground near it. One command per node.'
        : rate < 0.5
          ? 'React sooner. The clock on a node starts the instant it appears.'
          : 'Push the difficulty up — you are ahead of this speed.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { movement: performance },
      keyMetrics: [
        pct('pathEff', 'PATH EFFICIENCY', eff),
        count('nodes', 'NODES REACHED', this.hit),
        pct('nodeAcc', 'WINDOW ACCURACY', accuracy),
        pct('clean', 'COMMAND CLEANLINESS', 1 - clickWaste),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
