import { clamp, dist } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { BotBehavior } from '../engine/ai';
import { Drill, band, count, pct, secs, units, type DrillOutcome } from './base';

/**
 * SPACING — the pocket, and then the pocket without the lines.
 *
 * Spacing is one question asked continuously: *can I hit them, and can they
 * hit me?* There is exactly one answer worth holding — yes and no — and the
 * band of ground where that is true is the pocket. Everything else is a
 * mistake with a name: inside their reach is an overstep, outside your own is
 * passivity.
 *
 * The drill is built in three stages across one run, because the skill being
 * trained is not "stand in the green ring". It is knowing where the ring is
 * when nothing is drawing it:
 *
 *   SHOWN   both reaches drawn, the pocket filled. Learn what it looks like.
 *   FADING  the lines appear only as you cross them. Learn to feel the edge.
 *   BLIND   nothing at all. This is the stage that counts double, because it
 *           is the only one that resembles a game.
 *
 * The partner cycles behaviours the whole time — it tethers, it walks you
 * down, it runs, it baits — so holding the pocket means chasing correctly and
 * retreating correctly rather than standing on a mark.
 */

type Stage = 'shown' | 'fading' | 'blind';

interface StageBook {
  advantage: number;
  overstep: number;
  passive: number;
  total: number;
}

const emptyBook = (): StageBook => ({ advantage: 0, overstep: 0, passive: 0, total: 0 });

/** What the partner does, in the order it does it. */
const ROTATION: BotBehavior[] = ['tether', 'retreat', 'chase', 'bait', 'irregular', 'retreat'];

export class SpacingDrill extends Drill {
  private books: Record<Stage, StageBook> = { shown: emptyBook(), fading: emptyBook(), blind: emptyBook() };
  private perfectStreak = 0;
  private bestStreak = 0;
  private lastMicro = 0;
  private phaseCd = 0;
  private rotation = 0;
  /** Seconds since the player last crossed a boundary, for the fading stage. */
  private sinceCross = 99;
  private wasIn = false;
  /** Seconds between entering the pocket and taking the shot it exists for. */
  private entryDelays: number[] = [];
  private enteredAt = -1;
  private firedSinceEntry = true;

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
    const a = this.spawnEnemy('ranger', { x: w * 0.72, y: h / 2 }, {
      hpScale: 4.2,
      behavior: ROTATION[this.rotation % ROTATION.length],
      anchor: { x: w * 0.72, y: h / 2 },
      leash: 620,
    });
    // Shorter reach than the player: without that gap there is no pocket, and
    // without a pocket there is nothing here to train.
    a.attack.range = 320;
    a.attack.damage = 26;
    a.attack.projectileSpeed = 1200;
    // Slower than you *after* the quarter of every cycle you spend rooted in
    // a windup. Holding the pocket has to be achievable by moving correctly,
    // or the drill is measuring a foot race rather than spacing.
    a.moveSpeed = 178 + this.s.config.difficulty * 64;
    a.label = 'SPARRING';
    const brain = this.lastBrain;
    if (brain) brain.preferredRange = 290;
  }

  /** Which third of the run we are in. */
  private get stage(): Stage {
    const total = Math.max(1, this.s.config.duration);
    const t = this.s.elapsed / total;
    return t < 0.34 ? 'shown' : t < 0.67 ? 'fading' : 'blind';
  }

  /** How strongly the indicators are drawn right now, 0..1. */
  private get clarity(): number {
    switch (this.stage) {
      case 'shown':
        return 1;
      case 'fading':
        // Only as you cross the edge: a reminder, not a readout.
        return clamp(1 - this.sinceCross / 0.9, 0, 1) * 0.8;
      case 'blind':
        return 0;
    }
  }

  /** The two distances that define the pocket, measured centre to centre. */
  private reaches(): { theirs: number; mine: number } | null {
    const p = this.s.world.player;
    const e = this.s.world.enemies()[0];
    if (!p || !e) return null;
    return { theirs: e.attack.range + p.radius, mine: p.attack.range + e.radius };
  }

  update(dt: number): void {
    this.updateBrains(dt);
    if (this.s.world.enemies().length === 0) this.spawnSparring();

    // The partner changes what it is doing on a clock. Holding the pocket
    // against something that walks you down is a different act from holding it
    // against something that runs — and both are in every game you play.
    this.phaseCd -= dt;
    if (this.phaseCd <= 0) {
      this.phaseCd = this.s.rng.range(7.5, 10.5) - this.s.config.difficulty * 1.6;
      this.rotation++;
      const next = ROTATION[this.rotation % ROTATION.length];
      for (const b of this.brains) b.behavior = next;
      const e = this.s.world.enemies()[0];
      if (e) {
        this.s.fx.ring(e.pos.x, e.pos.y, e.radius + 6, e.radius + 62, 0.5, PALETTE.warn, 2.4, 'pulse');
      }
    }

    const p = this.s.world.player;
    const e = this.s.world.enemies()[0];
    const r = this.reaches();
    if (!p || !e || !r) return;

    const d = dist(p.pos, e.pos);
    const book = this.books[this.stage];
    book.total += dt;
    const inPocket = d > r.theirs && d <= r.mine;

    if (d <= r.theirs) {
      book.overstep += dt;
      this.perfectStreak = 0;
    } else if (inPocket) {
      book.advantage += dt;
      this.perfectStreak += dt;
      this.bestStreak = Math.max(this.bestStreak, this.perfectStreak);
    } else {
      book.passive += dt;
      this.perfectStreak = 0;
    }

    // Entering the pocket is only worth anything if a shot follows. Time the
    // gap: stepping in, hesitating, and stepping back out is the single most
    // common way a player wastes a whole trade.
    if (inPocket && !this.wasIn) {
      this.enteredAt = this.s.elapsed;
      this.firedSinceEntry = false;
      this.sinceCross = 0;
    } else if (!inPocket && this.wasIn) {
      if (!this.firedSinceEntry && this.enteredAt >= 0) this.entryDelays.push(1.6);
      this.sinceCross = 0;
    } else {
      this.sinceCross += dt;
    }
    this.wasIn = inPocket;

    if (this.perfectStreak > 3.5 && this.s.elapsed - this.lastMicro > 3.5) {
      this.lastMicro = this.s.elapsed;
      this.s.micro('PERFECT SPACING', p.pos, PALETTE.good);
      this.s.fx.ring(p.pos.x, p.pos.y, p.radius + 8, p.radius + 46, 0.5, PALETTE.good, 2, 'pulse');
    }
    if (d <= r.theirs && this.s.elapsed - this.lastMicro > 2.4) {
      this.lastMicro = this.s.elapsed;
      this.s.micro('TOO CLOSE', p.pos, PALETTE.danger);
    }
  }

  onEvents(events: readonly { type: string; actorId?: number }[]): void {
    for (const e of events) {
      if (e.type === 'attackRelease' && e.actorId === this.s.world.playerId) {
        if (!this.firedSinceEntry && this.enteredAt >= 0) {
          this.entryDelays.push(Math.max(0, this.s.elapsed - this.enteredAt));
        }
        this.firedSinceEntry = true;
      }
    }
  }

  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    const e = this.s.world.enemies()[0];
    const r = this.reaches();
    if (!p || !e || !r) return;
    const a = this.clarity;
    if (a <= 0.01) {
      // The blind stage draws one thing only: whether you are in the pocket
      // right now, on your own body. Not where the edge is — that is the
      // question — only whether you are currently on the right side of it.
      const d = dist(p.pos, e.pos);
      const good = d > r.theirs && d <= r.mine;
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: p.radius + 12,
        color: good ? PALETTE.good : PALETTE.danger,
        alpha: 0.32 + 0.1 * Math.sin(t * 5),
        width: 2.5,
        rise: 1.4,
      });
      return;
    }

    const d = dist(p.pos, e.pos);
    const good = d > r.theirs && d <= r.mine;
    out.markers.push({
      kind: 'ring',
      x: e.pos.x,
      y: e.pos.y,
      radius: r.mine,
      color: PALETTE.good,
      alpha: (good ? 0.72 : 0.34) * a,
      width: 4,
      dash: 60,
      spin: 0.1,
      rise: 1.8,
    });
    out.markers.push({
      kind: 'ring',
      x: e.pos.x,
      y: e.pos.y,
      radius: r.theirs,
      color: PALETTE.danger,
      alpha: 0.55 * a,
      width: 3,
      dash: 44,
      spin: -0.14,
      fill: good ? 0 : 0.05 * a,
      rise: 1.9,
    });
    if (good) {
      out.markers.push({
        kind: 'ring',
        x: e.pos.x,
        y: e.pos.y,
        radius: (r.theirs + r.mine) / 2,
        color: PALETTE.good,
        alpha: (0.12 + 0.05 * Math.sin(t * 4)) * a,
        width: r.mine - r.theirs,
        rise: 1.6,
      });
    }

    const err = d < r.theirs ? r.theirs - d : d > r.mine ? d - r.mine : 0;
    if (err > 4) {
      out.billboards.push({
        kind: 'label',
        x: (p.pos.x + e.pos.x) / 2,
        y: (p.pos.y + e.pos.y) / 2,
        text: `${d < r.theirs ? '-' : '+'}${Math.round(err)}u`,
        color: d < r.theirs ? PALETTE.danger : PALETTE.warn,
        size: 15,
      });
    }
  }

  /** Advantage share across every stage, with the blind stage counted double. */
  private weightedAdvantage(): number {
    const w: Record<Stage, number> = { shown: 1, fading: 1.4, blind: 2.2 };
    let num = 0;
    let den = 0;
    for (const st of ['shown', 'fading', 'blind'] as Stage[]) {
      const b = this.books[st];
      if (b.total < 0.5) continue;
      num += (b.advantage / b.total) * w[st];
      den += w[st];
    }
    return den > 0 ? num / den : 0;
  }

  private get liveShare(): number {
    const b = this.books[this.stage];
    return b.total > 0.4 ? b.advantage / b.total : 0;
  }

  hudFields(): HudField[] {
    const frac = this.liveShare;
    const stageName = this.stage === 'shown' ? 'SHOWN' : this.stage === 'fading' ? 'FADING' : 'BLIND';
    return [
      {
        label: 'ADVANTAGE',
        value: `${Math.round(frac * 100)}%`,
        bar: frac,
        tone: frac > 0.72 ? 'good' : frac > 0.5 ? 'warn' : 'bad',
      },
      { label: 'RANGES', value: stageName, tone: this.stage === 'blind' ? 'good' : 'neutral' },
      { label: 'STREAK', value: `${this.perfectStreak.toFixed(1)}s`, tone: 'good' },
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    const d = derive(m);
    // Nothing here pays unless you are trading from the pocket. Holding a
    // flattering distance and never firing is the cheese this gate exists for.
    const trading = clamp(d.pocketUse * 0.6 + d.attackEfficiency * 0.4, 0, 1);
    const advantage = this.books.shown.advantage + this.books.fading.advantage * 1.4 + this.books.blind.advantage * 2.2;
    const overstep = this.books.shown.overstep + this.books.fading.overstep + this.books.blind.overstep;
    return Math.max(0, Math.round(
      advantage * 620 * trading + m.damageDealt * 4 + this.bestStreak * 240 * trading - overstep * 420 - m.hpLost * 4,
    ));
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    const d = derive(m);
    const weighted = this.weightedAdvantage();
    const blind = this.books.blind;
    const blindShare = blind.total > 0.5 ? blind.advantage / blind.total : 0;
    const overstepRate = d.overstepRate;
    const entryDelay = this.entryDelays.length
      ? this.entryDelays.reduce((a, b) => a + b, 0) / this.entryDelays.length
      : 1.6;

    // Two independent gates, and both are gates rather than bonuses on
    // purpose. Spacing that never trades is hiding; spacing that only works
    // while the lines are drawn has not been learnt, it has been read off.
    const trading = band(d.pocketUse, 0.15, 0.7);
    const engagement = band(d.attackEfficiency, 0.1, 0.7);

    const performance = clamp(
      (weighted * 0.44 +
        band(overstepRate, 0.35, 0.02) * 0.14 +
        band(entryDelay, 1.5, 0.25) * 0.12 +
        d.hpRetained * 0.12 +
        d.attackEfficiency * 0.18) *
        (0.35 + 0.4 * trading + 0.25 * engagement),
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (blindShare > 0.7) helped.push(`${Math.round(blindShare * 100)}% advantageous with the ranges hidden — you know where the edge is.`);
    if (this.bestStreak > 9) helped.push(`Held the pocket for ${this.bestStreak.toFixed(1)}s straight.`);
    if (entryDelay < 0.4 && this.entryDelays.length > 4) helped.push('You fire the moment you enter range, every time.');
    if (overstepRate > 0.2) hurt.push(`${Math.round(overstepRate * 100)}% of the run inside their reach, where the trade is not free.`);
    if (blindShare < weighted - 0.15) hurt.push('Your spacing fell apart once the ranges stopped being drawn. That is the stage that matters.');
    if (d.pocketUse < 0.4) hurt.push('You held the right distance without attacking from it. The pocket is where you trade, not where you wait.');
    if (entryDelay > 0.9) hurt.push(`${entryDelay.toFixed(2)}s between stepping into range and firing — that hesitation is a whole trade.`);
    if (m.hpLost > 150) hurt.push(`${Math.round(d.hpLostCapped)} health lost to a shorter-ranged opponent.`);

    const advice =
      d.pocketUse < 0.45
        ? 'You are standing in the right place and not shooting. Enter range with the attack already coming up, fire, and step back out.'
        : overstepRate > 0.18
          ? 'When they step toward you, step back the same distance. Match their movement instead of holding ground.'
          : blindShare < 0.55
            ? 'Watch the gap between the two bodies, not the rings. That distance is the same in every game you will ever play.'
            : 'Excellent. Carry this exact distance into the 1v1 arena.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { spacing: performance, movement: clamp(weighted * 0.85 + 0.1, 0, 1) },
      keyMetrics: [
        pct('advantage', 'ADVANTAGEOUS SPACING', weighted),
        pct('blind', 'ADVANTAGE, RANGES HIDDEN', blindShare),
        pct('pocketUse', 'TRADED FROM THE POCKET', d.pocketUse),
        secs('entry', 'RANGE TO FIRST SHOT', entryDelay, 'lower'),
        units('spacingErr', 'AVG SPACING ERROR', d.avgSpacingError),
        count('damage', 'DAMAGE DEALT', Math.round(m.damageDealt)),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
