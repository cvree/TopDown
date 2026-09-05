import { clamp, dist } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { Actor } from '../engine/types';
import { VAYNE_SILVER, VAYNE_STATS, boltEfficiency } from '../engine/vayne';
import type { WorldEvent } from '../engine/world';
import { band, count, pct, type DrillOutcome } from './base';
import { VayneDrill } from './vaynebase';

const SWITCH_EVERY = 11;

/**
 * SILVER BOLTS — the third hit.
 *
 * Vayne's damage does not come from her attacks, it comes from every third one
 * landing on the same target. So the mistake that defines a bad Vayne is not
 * missing: it is switching at two. Somebody flashes low, you turn, and you
 * throw away the only part of your kit that kills tanks.
 *
 * Three targets, and a marked one that changes every eleven seconds. The
 * instruction is not "hit the mark" and it is not "never switch" — it is
 * *finish your stack, then switch*, which is the actual decision.
 */
export class VayneBoltsDrill extends VayneDrill {
  private dummies: Actor[] = [];
  private priorityId = -1;
  private switchTimer = SWITCH_EVERY;
  private procsOnPriority = 0;
  private procsTotal = 0;
  private markChanges = 0;
  /** Bolt stacks held on the old mark when a new one was called. */
  private stacksAtSwitch = 0;
  private finishedAfterSwitch = 0;

  constructor(s: import('../engine/session').Session) {
    // A Vayne who has put points in W: the bolts mode is about finishing a
    // stack, and the third hit should be worth finishing.
    super(s, { tumble: true, bolts: true, condemn: false, finalHour: false, ranks: { q: 2, w: 3 } });
  }

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.spawnVayne({ x: w / 2, y: h * 0.74 });
    p.maxHp = 1400;
    p.hp = 1400;

    const spots: { x: number; y: number }[] = [
      { x: w * 0.26, y: h * 0.3 },
      { x: w * 0.5, y: h * 0.22 },
      { x: w * 0.74, y: h * 0.3 },
    ];
    for (const spot of spots) this.spawnDummy(spot);
    this.priorityId = this.dummies[1]?.id ?? -1;
  }

  private spawnDummy(pos: { x: number; y: number }): Actor {
    // Deliberately fat: the bolts take a share of maximum health, so a target
    // worth proccing has to be a target that survives being procced.
    const a = this.spawnEnemy('juggernaut', pos, { hpScale: 1.9 });
    a.label = 'TARGET';
    a.attack.damage = 12 + this.s.config.difficulty * 14;
    const brain = this.brains[this.brains.length - 1];
    if (brain) {
      brain.tune = { ...brain.tune, aggression: 0.3 + this.s.config.difficulty * 0.3 };
      brain.preferredRange = 260 + this.s.rng.range(-60, 60);
    }
    this.dummies.push(a);
    return a;
  }

  update(dt: number): void {
    super.update(dt);
    this.updateBrains(dt);

    this.dummies = this.dummies.filter((d) => d.alive);
    if (this.dummies.length < 3) {
      const { w, h } = this.s.world.bounds;
      const p = this.s.world.player;
      const pos = this.randomPoint(p?.pos ?? null, 460, 150);
      this.spawnDummy({ x: clamp(pos.x, 140, w - 140), y: clamp(pos.y, 140, h * 0.66) });
    }
    if (!this.dummies.some((d) => d.id === this.priorityId)) this.callMark(true);

    this.switchTimer -= dt;
    if (this.switchTimer <= 0) this.callMark(false);
  }

  private callMark(forced: boolean): void {
    const options = this.dummies.filter((d) => d.alive && d.id !== this.priorityId);
    if (!options.length) return;
    const next = this.s.rng.pick(options);
    this.switchTimer = SWITCH_EVERY;
    if (!forced) {
      this.markChanges++;
      this.stacksAtSwitch = this.kit.stacks;
    }
    this.priorityId = next.id;
    this.s.setBanner('NEW MARK', 0.9);
    this.s.fx.ring(next.pos.x, next.pos.y, 10, 150, 0.5, VAYNE_SILVER, 3, 'shock');
  }

  onEvents(events: readonly WorldEvent[]): void {
    const procsBefore = this.kit.stats.boltProcs;
    const targetBefore = this.kit.stackTargetId;
    super.onEvents(events);
    const gained = this.kit.stats.boltProcs - procsBefore;
    if (gained > 0) {
      this.procsTotal += gained;
      if (targetBefore === this.priorityId || this.kit.stackTargetId === this.priorityId) {
        this.procsOnPriority += gained;
      }
      // A stack that was live when the mark moved and got finished anyway is
      // the behaviour this drill is asking for.
      if (this.stacksAtSwitch > 0) {
        this.finishedAfterSwitch++;
        this.stacksAtSwitch = 0;
      }
      this.s.fx.addFlash(0.05, VAYNE_SILVER);
    }
  }

  paint(out: DrillPaint, t: number): void {
    super.paint(out, t);
    this.paintSignature(out, t);
    const p = this.s.world.player;
    if (!p) return;

    for (const d of this.dummies) {
      if (!d.alive) continue;
      const isMark = d.id === this.priorityId;
      const stacked = this.kit.stackTargetId === d.id ? this.kit.stacks : 0;
      if (isMark) {
        out.billboards.push({ kind: 'caret', x: d.pos.x, y: d.pos.y, color: VAYNE_SILVER, lift: d.radius * 5 });
        out.markers.push({
          kind: 'ring',
          x: d.pos.x,
          y: d.pos.y,
          radius: d.radius + 26,
          color: VAYNE_SILVER,
          alpha: 0.5 + 0.16 * Math.sin(t * 5),
          width: 3,
          dash: 22,
          spin: 0.5,
          rise: 1.6,
        });
      }
      // The stack count drawn on the ground under the unit holding it, because
      // that is the only place it is a fact about a target rather than a
      // number on a bar.
      if (stacked > 0) {
        out.markers.push({
          kind: 'ring',
          x: d.pos.x,
          y: d.pos.y,
          radius: d.radius + 12,
          color: VAYNE_SILVER,
          alpha: 0.85,
          width: 4,
          progress: stacked / VAYNE_STATS.boltsPerProc,
          rise: 1.7,
        });
        out.billboards.push({
          kind: 'label',
          x: d.pos.x,
          y: d.pos.y,
          text: `${stacked} / ${VAYNE_STATS.boltsPerProc}`,
          color: stacked === VAYNE_STATS.boltsPerProc - 1 ? PALETTE.good : VAYNE_SILVER,
          size: 15,
        });
      }
      if (dist(p.pos, d.pos) < p.attack.range + d.radius) {
        out.markers.push({
          kind: 'ring',
          x: d.pos.x,
          y: d.pos.y,
          radius: d.radius + 6,
          color: PALETTE.accentDim,
          alpha: 0.25,
          width: 2,
          rise: 1.1,
        });
      }
    }
  }

  hudFields(): HudField[] {
    const st = this.kit.stats;
    const eff = boltEfficiency(st);
    return [
      this.boltField(),
      {
        label: 'PROCS',
        value: `${st.boltProcs}`,
        tone: 'good',
      },
      {
        label: 'STACKS DROPPED',
        value: `${st.boltsDropped}`,
        bar: 1 - clamp(st.boltsDropped / 6, 0, 1),
        tone: st.boltsDropped > 2 ? 'bad' : eff > 0.7 ? 'good' : 'warn',
      },
      ...(this.triggerField() ? [this.triggerField() as HudField] : []),
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    const st = this.kit.stats;
    return Math.max(0, Math.round(
      st.boltProcs * 1600 +
        this.procsOnPriority * 700 +
        this.finishedAfterSwitch * 500 +
        m.damageDealt * 5 -
        st.boltsDropped * 900 -
        m.attacksCancelled * 300 -
        m.hpLost * 2,
    ));
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? 1400);
    const st = this.kit.stats;

    const cycle = 1 / VAYNE_STATS.attack.attackSpeed;
    const activity = band(st.attacksLanded / Math.max(1, this.s.elapsed / cycle), 0.25, 0.8);
    const efficiency = boltEfficiency(st);
    const procRate = band(st.boltProcs / Math.max(1, this.s.elapsed / 9), 0.3, 1);
    const dropRate = st.boltProcs + st.boltsDropped > 0 ? st.boltsDropped / (st.boltProcs + st.boltsDropped) : 0;
    const discipline = (1 - dropRate) * activity;
    const priorityShare = this.procsTotal > 0 ? this.procsOnPriority / this.procsTotal : 0;

    const performance = clamp(
      efficiency * 0.36 +
        procRate * 0.22 +
        discipline * 0.2 +
        priorityShare * 0.14 +
        d.hpRetained * 0.08,
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (st.boltProcs > 6) helped.push(`${st.boltProcs} bolt procs — ${Math.round(st.boltDamage)} true damage.`);
    if (st.boltsDropped === 0 && st.boltProcs > 2) helped.push('You never abandoned a stack.');
    if (this.finishedAfterSwitch > 1) helped.push(`${this.finishedAfterSwitch} times you finished the stack before taking the new mark — that is the habit.`);
    if (priorityShare > 0.7 && this.procsTotal > 3) helped.push('Almost every proc landed on the called target.');
    if (st.boltsDropped > 2) hurt.push(`${st.boltsDropped} stacks thrown away by switching early.`);
    if (efficiency < 0.6 && st.attacksLanded > 12) hurt.push('Your hits are spread across targets — most of them are doing nothing.');
    if (priorityShare < 0.4 && this.procsTotal > 3) hurt.push('You proc, but rarely on the target you were asked to kill.');
    this.handsNotes(helped, hurt);

    const advice =
      this.handsAdvice() ??
      (st.boltsDropped > 2
        ? 'Two stacks on a target is an investment. Finish the third hit before you look anywhere else.'
        : efficiency < 0.6
          ? 'Pick one target and stay on it for three attacks. Spread damage is Vayne doing nothing.'
          : priorityShare < 0.5
            ? 'When the mark moves, finish your stack — then commit fully to the new one.'
            : 'Clean bolt management. Take it into Condemn, where the target is also trying to reach you.');

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: {
        targeting: performance,
        lastHitting: clamp(efficiency, 0, 1),
        aim: clamp(d.accuracy, 0, 1),
      },
      keyMetrics: [
        pct('boltEfficiency', 'BOLT EFFICIENCY', efficiency),
        count('procs', 'BOLT PROCS', st.boltProcs),
        count('dropped', 'STACKS DROPPED', st.boltsDropped, 'lower'),
        pct('markShare', 'PROCS ON MARK', priorityShare),
        count('trueDamage', 'TRUE DAMAGE', Math.round(st.boltDamage)),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
