import { audio } from '../engine/audio';
import { clamp, dist } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { Actor, Vec2 } from '../engine/types';
import { Drill, band, count, ms, pct, units, type DrillOutcome } from './base';

interface Mark {
  actor: Actor;
  born: number;
  ttl: number;
  decoy: boolean;
  drift: Vec2;
}

/**
 * AIM — command accuracy.
 *
 * Targets surface for a moment; you right-click the right one. This is the
 * League skill of putting your click on the champion you meant, first time,
 * rather than on the ground next to them.
 */
export class AimDrill extends Drill {
  private marks: Mark[] = [];
  private hits = 0;
  private misses = 0;
  private decoyHits = 0;
  private strayClicks = 0;
  private spawnCd = 0.4;
  private errors: number[] = [];

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w / 2, y: h / 2 });
    // The player does not move in this drill — it is purely about the command.
    p.moveSpeed = 0;
  }

  private get d(): number {
    return this.s.config.difficulty;
  }

  private spawn(): void {
    const d = this.d;
    const radius = 36 - d * 17;
    const decoy = this.s.rng.chance(clamp(d * 0.42, 0, 0.4)) && this.hits + this.misses > 3;
    const pos = this.randomPoint(this.s.world.player?.pos ?? null, 180, 120);
    const a = this.s.world.spawnActor({
      pos,
      team: 'enemy',
      maxHp: 10,
      radius,
      moveSpeed: 0,
      label: decoy ? 'DECOY' : 'TARGET',
      attack: { attackSpeed: 0.01, windupRatio: 0.3, backswingRatio: 0.3, range: 0, damage: 0, projectileSpeed: 0 },
    });
    const speed = d > 0.45 ? (d - 0.45) * 260 : 0;
    const ang = this.s.rng.angle();
    this.marks.push({
      actor: a,
      born: this.s.elapsed,
      ttl: 1.75 - d * 1.0,
      decoy,
      drift: { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
    });
    this.s.fx.ring(pos.x, pos.y, radius * 2.4, radius, 0.25, decoy ? PALETTE.textFaint : PALETTE.accent, 2, 'range');
  }

  update(dt: number): void {
    this.spawnCd -= dt;
    const concurrent = 1 + Math.floor(this.d * 2.2);
    if (this.spawnCd <= 0 && this.marks.length < concurrent) {
      this.spawnCd = 0.75 - this.d * 0.45;
      this.spawn();
    }

    const { w, h } = this.s.world.bounds;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mk = this.marks[i];
      const a = mk.actor;
      a.pos.x = clamp(a.pos.x + mk.drift.x * dt, 90, w - 90);
      a.pos.y = clamp(a.pos.y + mk.drift.y * dt, 90, h - 90);
      if (a.pos.x <= 90 || a.pos.x >= w - 90) mk.drift.x *= -1;
      if (a.pos.y <= 90 || a.pos.y >= h - 90) mk.drift.y *= -1;

      if (this.s.elapsed - mk.born > mk.ttl) {
        this.marks.splice(i, 1);
        a.alive = false;
        if (!mk.decoy) {
          this.misses++;
          this.s.chain = 0;
          audio.setComboPitch(0);
          this.s.fx.ring(a.pos.x, a.pos.y, a.radius, a.radius * 0.3, 0.3, PALETTE.textFaint, 2, 'impact');
        }
      }
    }
    this.s.world.actors = this.s.world.actors.filter((x) => x.alive || x.id === this.s.world.playerId);
  }

  onTargetOrder(a: Actor): void {
    const idx = this.marks.findIndex((m) => m.actor.id === a.id);
    if (idx < 0) return;
    const mk = this.marks[idx];
    this.marks.splice(idx, 1);
    a.alive = false;
    const reaction = (this.s.elapsed - mk.born) * 1000;
    const err = dist(this.s.cursorWorld, a.pos);

    if (mk.decoy) {
      this.decoyHits++;
      this.s.chain = 0;
      audio.setComboPitch(0);
      audio.play('attackCancel');
      this.s.micro('WRONG TARGET', a.pos, PALETTE.danger);
      this.s.fx.ring(a.pos.x, a.pos.y, a.radius, a.radius * 2.4, 0.35, PALETTE.danger, 2.5, 'impact');
      return;
    }

    this.hits++;
    this.errors.push(err);
    this.s.metrics.noteReaction(reaction);
    this.s.chain++;
    this.s.chainBest = Math.max(this.s.chainBest, this.s.chain);
    audio.setComboPitch(this.s.chain);
    audio.play('pickup');
    const dead = err < a.radius * 0.34;
    this.s.fx.impact(a.pos, 0, dead ? PALETTE.good : PALETTE.accent, dead ? 1.5 : 1);
    this.s.fx.ring(a.pos.x, a.pos.y, a.radius, a.radius * 2.6, 0.32, dead ? PALETTE.good : PALETTE.accent, 2.5, 'impact');
    if (dead) this.s.micro('DEAD CENTRE', a.pos, PALETTE.good);
    else if (reaction < 320) this.s.micro(`${Math.round(reaction)}ms`, a.pos, PALETTE.accent);
  }

  onClick(pos: Vec2): boolean {
    // A click on a target falls through to the normal targeting path so the
    // hit is registered by onTargetOrder. Anything else is recorded as a stray
    // and swallowed — the player is stationary, so a move order is meaningless.
    for (const m of this.marks) {
      if (dist(pos, m.actor.pos) < m.actor.radius + 26) return false;
    }
    this.strayClicks++;
    this.s.fx.ring(pos.x, pos.y, 2, 22, 0.22, PALETTE.textFaint, 1.5, 'pulse');
    return true;
  }

  paint(out: DrillPaint, t: number): void {
    for (const m of this.marks) {
      const a = m.actor;
      const left = clamp(1 - (this.s.elapsed - m.born) / m.ttl, 0, 1);
      const col = m.decoy ? PALETTE.textFaint : PALETTE.accent;
      out.markers.push({
        kind: 'ring',
        x: a.pos.x,
        y: a.pos.y,
        radius: a.radius + 16,
        color: left < 0.3 ? PALETTE.danger : col,
        alpha: 0.95,
        width: 6,
        progress: left,
        rise: 2.6,
      });
      if (m.decoy) {
        // A decoy is marked with a cross, never with colour alone: the whole
        // point of the drill is that you can tell them apart at a glance.
        out.markers.push({
          kind: 'cross',
          x: a.pos.x,
          y: a.pos.y,
          radius: a.radius * 0.5,
          color: PALETTE.textFaint,
          alpha: 0.85,
          width: 4,
          rise: 3,
        });
      } else {
        const pulse = 0.5 + 0.5 * Math.sin(t * 6);
        out.markers.push({
          kind: 'disc',
          x: a.pos.x,
          y: a.pos.y,
          radius: a.radius * 0.45,
          color: PALETTE.playerCore,
          alpha: 0.6 + pulse * 0.4,
          fill: 0.85,
          width: 2,
          rise: 3,
        });
      }
    }
  }

  hudFields(): HudField[] {
    const acc = this.hits / Math.max(1, this.hits + this.misses);
    const rt = this.s.metrics.m.reactionTimes;
    const last = rt.length ? rt[rt.length - 1] : 0;
    return [
      { label: 'HITS', value: `${this.hits}`, tone: 'neutral' },
      { label: 'ACCURACY', value: `${Math.round(acc * 100)}%`, bar: acc, tone: acc > 0.9 ? 'good' : acc > 0.75 ? 'warn' : 'bad' },
      { label: 'LAST', value: last ? `${Math.round(last)}ms` : '—', tone: 'neutral' },
    ];
  }

  liveScore(): number {
    const rt = this.s.metrics.m.reactionTimes;
    const avg = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 900;
    const speedBonus = clamp((900 - avg) / 700, 0, 1);
    return Math.max(0, Math.round(this.hits * (420 + speedBonus * 640) - this.misses * 260 - this.decoyHits * 420 - this.strayClicks * 40));
  }

  outcome(): DrillOutcome {
    const rt = this.s.metrics.m.reactionTimes;
    const avg = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 1200;
    const accuracy = this.hits / Math.max(1, this.hits + this.misses + this.decoyHits);
    const avgErr = this.errors.length ? this.errors.reduce((a, b) => a + b, 0) / this.errors.length : 60;
    const precision = band(avgErr, 46, 8);
    const speed = band(avg, 780, 240);
    const strayRate = this.strayClicks / Math.max(1, this.strayClicks + this.hits);
    const discipline = band(strayRate, 0.4, 0.02);

    const performance = clamp(accuracy * 0.4 + speed * 0.3 + precision * 0.2 + discipline * 0.1, 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (avg < 340 && this.hits > 5) helped.push(`Median reaction under ${Math.round(avg)}ms — that is fast.`);
    if (avgErr < 14) helped.push('Your clicks land on the centre of the target, not the edge.');
    if (this.decoyHits > 0) hurt.push(`${this.decoyHits} click${this.decoyHits > 1 ? 's' : ''} on a marked decoy.`);
    if (this.misses > 2) hurt.push(`${this.misses} targets expired untouched.`);
    if (strayRate > 0.25) hurt.push('A quarter of your clicks hit empty ground.');

    const advice =
      avgErr > 26
        ? 'Slow down by 30ms and land on the middle. Edge clicks are the ones that miss in game.'
        : avg > 520
          ? 'Keep your cursor near the centre of the arena between targets — you are travelling too far.'
          : 'Raise the difficulty: smaller targets and decoys are where the next gain is.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { aim: performance },
      keyMetrics: [
        ms('reaction', 'MEDIAN REACTION', rt.length ? [...rt].sort((a, b) => a - b)[rt.length >> 1] : 0),
        pct('accuracy', 'ACCURACY', accuracy),
        units('clickErr', 'CLICK ERROR', avgErr),
        count('hits', 'TARGETS HIT', this.hits),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
