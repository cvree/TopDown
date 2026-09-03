import { clamp, dist } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import { VAYNE_COLOR, VAYNE_STATS, tumbleDirection } from '../engine/vayne';
import { band, count, pct, type DrillOutcome } from './base';
import { VayneDrill } from './vaynebase';

/**
 * TUMBLE — the Vayne rhythm.
 *
 * Attack, tumble out of the backswing, attack again. A Vayne player who
 * tumbles on cooldown is not a good Vayne player; a Vayne player who tumbles
 * *in the backswing*, every time it is up, is untouchable, because each tumble
 * is free distance the pursuer has to pay for and an empowered shot on the way
 * out.
 *
 * The drill measures the one thing that separates the two: what your attack
 * was doing at the instant you pressed Q. Pressed mid-windup it throws the
 * attack away and is counted against you; pressed in the backswing it is free
 * and counted for you; pressed while standing with an attack up and a target
 * in range it is a wasted cooldown, and counted as neither.
 */
export class VayneTumbleDrill extends VayneDrill {
  private respawnCd = 0;
  private wanted = 1;
  private kills = 0;
  private windowsOffered = 0;
  private windowsTaken = 0;
  /** True while an attack has landed and the tumble is up: the free window. */
  private windowOpen = false;
  private windowAge = 0;

  constructor(s: import('../engine/session').Session) {
    super(s, { tumble: true, bolts: false, condemn: false, finalHour: false });
  }

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.spawnVayne({ x: w / 2, y: h * 0.72 });
    // A rhythm drill runs its full length: health is the cost of sloppy
    // tumbles, not a fail state that cuts the run short.
    p.maxHp = 1500;
    p.hp = 1500;
    this.wanted = this.s.config.difficulty > 0.62 ? 2 : 1;
    for (let i = 0; i < this.wanted; i++) this.spawnPursuer();
  }

  private spawnPursuer(): void {
    const p = this.s.world.player;
    const pos = this.randomPoint(p?.pos ?? null, 520, 140);
    const a = this.spawnEnemy('diver', pos, { hpScale: 0.78 });
    // Tuned against an orbwalking Vayne's *effective* speed — she only moves
    // in the free window — plus the ground a tumble buys her every six
    // seconds. Comfortably survivable clean; a genuine race when sloppy.
    a.moveSpeed = 156 + this.s.config.difficulty * 78;
    a.attack.damage = 18 + this.s.config.difficulty * 20;
    a.label = 'PURSUER';
    const brain = this.brains[this.brains.length - 1];
    if (brain) brain.tune = { ...brain.tune, aggression: 0.36 + this.s.config.difficulty * 0.5 };
    this.s.fx.ring(pos.x, pos.y, 10, 120, 0.5, PALETTE.hazard, 2.5, 'shock');
  }

  update(dt: number): void {
    super.update(dt);
    this.updateBrains(dt);

    if (this.s.world.enemies().length < this.wanted) {
      this.respawnCd -= dt;
      if (this.respawnCd <= 0) {
        this.respawnCd = 1.1;
        this.spawnPursuer();
      }
    }

    // The free window: the attack has committed its damage, the tumble is up.
    // Offering it is what makes "use it" a measurable instruction rather than
    // a slogan; taking it is the entire drill.
    const p = this.s.world.player;
    if (!p) return;
    const open = p.phase === 'backswing' && this.kit.tumbleCd <= 0;
    if (open && !this.windowOpen) {
      this.windowOpen = true;
      this.windowAge = 0;
      this.windowsOffered++;
    } else if (!open && this.windowOpen) {
      this.windowOpen = false;
    }
    if (this.windowOpen) {
      this.windowAge += dt;
      if (this.kit.lastTumbleAt >= this.s.world.time - dt * 1.5 && this.kit.lastTumbleQuality === 'clean') {
        this.windowsTaken++;
        this.windowOpen = false;
      }
    }
  }

  onEvents(events: readonly import('../engine/world').WorldEvent[]): void {
    super.onEvents(events);
    for (const e of events) if (e.type === 'death' && e.byPlayer) this.kills++;
  }

  paint(out: DrillPaint, t: number): void {
    super.paint(out, t);
    this.paintSignature(out, t);
    const p = this.s.world.player;
    if (!p) return;

    // The prompt. It only ever appears in the window it is asking you to use,
    // and it is gone the moment the window closes — a metronome, not a label.
    if (this.windowOpen) {
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: p.radius + 30 + this.windowAge * 90,
        color: VAYNE_COLOR,
        alpha: clamp(0.75 - this.windowAge * 1.4, 0, 0.75),
        width: 4,
        rise: 2,
      });
      out.billboards.push({
        kind: 'label',
        x: p.pos.x,
        y: p.pos.y,
        text: 'TUMBLE',
        color: VAYNE_COLOR,
        size: 17,
      });
    }

    for (const e of this.s.world.enemies()) {
      const r = e.attack.range + p.radius;
      const inside = dist(p.pos, e.pos) < r;
      out.markers.push({
        kind: 'ring',
        x: e.pos.x,
        y: e.pos.y,
        radius: r,
        color: PALETTE.danger,
        alpha: inside ? 0.5 + 0.2 * Math.sin(t * 8) : 0.2,
        width: inside ? 4 : 2.5,
        dash: 46,
        spin: -0.22,
        fill: inside ? 0.06 : 0,
        rise: 1.8,
      });
    }
  }

  hudFields(): HudField[] {
    const d = derive(this.s.metrics.m);
    const st = this.kit.stats;
    const rhythm = st.tumbles > 0 ? st.tumblesClean / st.tumbles : 0;
    const trigger = this.triggerField();
    return [
      this.tumbleField(),
      {
        label: 'TUMBLE RHYTHM',
        value: `${Math.round(rhythm * 100)}%`,
        bar: rhythm,
        tone: rhythm > 0.8 ? 'good' : rhythm > 0.5 ? 'warn' : 'bad',
      },
      {
        label: 'ORBWALK',
        value: `${Math.round(d.orbwalkEfficiency * 100)}%`,
        bar: d.orbwalkEfficiency,
        tone: d.orbwalkEfficiency > 0.7 ? 'good' : 'warn',
      },
      ...(trigger ? [trigger] : []),
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    const d = derive(m);
    const st = this.kit.stats;
    return Math.max(0, Math.round(
      m.damageDealt * 8 * (0.5 + d.orbwalkEfficiency) +
        st.tumblesClean * 900 +
        st.empoweredHits * 260 +
        this.kills * 2000 +
        this.s.chainBest * 240 -
        st.tumblesWasted * 1100 -
        m.attacksCancelled * 420 -
        m.hpLost * 2.5,
    ));
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? 1500);
    const st = this.kit.stats;

    const rhythm = st.tumbles > 0 ? st.tumblesClean / st.tumbles : 0;
    // How much of the tumble's uptime was actually spent. Sitting on a
    // six-second cooldown for a minute is its own mistake.
    const available = Math.max(1, this.s.elapsed / VAYNE_STATS.tumbleCd);
    const usage = band(st.tumbles / available, 0.25, 0.85);
    const windowUse = this.windowsOffered > 0 ? clamp(this.windowsTaken / this.windowsOffered, 0, 1) : 0;
    const tumbleScore = rhythm * (0.4 + 0.6 * usage);
    const damageRate = band(m.damageDealt / Math.max(1, this.s.elapsed), 10, 40);
    const chainScore = band(m.maxChain, 2, 12);

    const performance = clamp(
      d.orbwalkEfficiency * 0.3 +
        tumbleScore * 0.28 +
        windowUse * 0.08 +
        d.hpRetained * 0.14 +
        damageRate * 0.12 +
        chainScore * 0.08,
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (rhythm > 0.85 && st.tumbles > 4) helped.push(`${st.tumblesClean} of ${st.tumbles} tumbles taken in a free window.`);
    if (st.empoweredHits > 4) helped.push(`${st.empoweredHits} empowered attacks landed off a tumble.`);
    if (d.orbwalkEfficiency > 0.75) helped.push('Your attack and movement windows are almost fully used.');
    if (st.tumblesWasted > 0) hurt.push(`${st.tumblesWasted} tumble${st.tumblesWasted === 1 ? '' : 's'} thrown mid-windup — each one cost you a whole attack.`);
    if (st.tumblesGreedy > 1) hurt.push(`${st.tumblesGreedy} tumbles taken with your attack already up.`);
    if (usage < 0.4) hurt.push('You sat on the tumble. It is a six-second cooldown, not an escape button.');
    if (windowUse < 0.35 && this.windowsOffered > 6) hurt.push('The backswing prompt came up and went unused most of the time.');
    this.handsNotes(helped, hurt);

    const advice =
      this.handsAdvice() ??
      st.tumblesWasted > 1
        ? 'Watch the cycle bar: amber is committed. Wait for it to turn green, then tumble — the damage is already out.'
        : usage < 0.45
          ? 'Tumble every time it comes up in a backswing. Distance you take for free is damage they never deal.'
          : rhythm > 0.85 && d.orbwalkEfficiency > 0.72
            ? 'This is the Vayne rhythm. Take it into Silver Bolts and keep it under target pressure.'
            : 'Close. Tighten the gap between the attack landing and the tumble — it should feel like one motion.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: {
        kiting: performance,
        movement: clamp(d.moveEfficiency, 0, 1),
        spacing: clamp(band(d.avgSpacingError, 240, 40), 0, 1),
      },
      keyMetrics: [
        pct('tumbleRhythm', 'TUMBLE RHYTHM', rhythm),
        count('tumbles', 'TUMBLES USED', st.tumbles),
        count('wasted', 'WINDUPS THROWN', st.tumblesWasted, 'lower'),
        pct('orbwalk', 'ORBWALK EFFICIENCY', d.orbwalkEfficiency),
        pct('tumbleAway', 'TUMBLE DIRECTION', tumbleDirection(st)),
        count('empowered', 'EMPOWERED HITS', st.empoweredHits),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
