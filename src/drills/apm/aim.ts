import { audio } from '../../engine/audio';
import type { AbilitySlot } from '../../engine/input';
import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { AbilityView, HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct, units } from '../base';
import { APM_TARGET_APM, ApmDrill, INERT_ATTACK, KeyCooldowns } from './engine';

/**
 * The click-target family.
 *
 * One field, one rule: something lights up, you put a command on it before it
 * goes out. What separates the four modes below is *what the hand has to
 * decide* on the way — nothing, an order, a pixel, or a second screen.
 */

interface Mark {
  actor: Actor;
  born: number;
  ttl: number;
  /** 1-based position in the required order, or 0 when order does not matter. */
  order: number;
  drift: Vec2;
}

abstract class TargetField extends ApmDrill {
  protected marks: Mark[] = [];
  protected clickErrors: number[] = [];
  private spawnCd = 0.25;
  private nextOrder = 1;

  /** How many targets may be live at once. */
  protected abstract concurrency(): number;
  /** Seconds between spawns, before tempo. */
  protected abstract interval(): number;
  /** How long a target survives unclicked. */
  protected abstract ttl(): number;
  protected abstract radius(): number;
  /** Ordered modes number their targets; the rest do not. */
  protected ordered(): boolean {
    return false;
  }
  /** Drift speed in units per second. */
  protected drift(): number {
    return 0;
  }

  setup(): void {
    const { w, h } = this.s.world.bounds;
    // The hand is the whole subject here, so the champion is bolted down and
    // disarmed: nothing it does can add to, or take away from, the count.
    const p = this.s.world.spawnPlayer({ x: w / 2, y: h / 2 }, { range: 0, damage: 0 });
    p.moveSpeed = 0;
  }

  protected spawn(): void {
    const radius = this.radius();
    const pos = this.randomPoint(this.s.world.player?.pos ?? null, 150, 110);
    const a = this.s.world.spawnActor({
      pos,
      team: 'enemy',
      maxHp: 10,
      radius,
      moveSpeed: 0,
      label: 'MARK',
      attack: { ...INERT_ATTACK },
    });
    const speed = this.drift();
    const ang = this.s.rng.angle();
    this.marks.push({
      actor: a,
      born: this.s.elapsed,
      ttl: this.ttl(),
      order: this.ordered() ? this.nextOrder++ : 0,
      drift: { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
    });
    this.s.fx.ring(pos.x, pos.y, radius * 2.6, radius, 0.22, this.flow.color, 2, 'range');
  }

  protected tick(dt: number): void {
    this.spawnCd -= dt;
    if (this.spawnCd <= 0 && this.marks.length < this.concurrency()) {
      this.spawnCd = this.interval() / this.tempo;
      this.spawn();
    }

    const { w, h } = this.s.world.bounds;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mk = this.marks[i];
      const a = mk.actor;
      if (mk.drift.x || mk.drift.y) {
        a.pos.x = clamp(a.pos.x + mk.drift.x * dt, 90, w - 90);
        a.pos.y = clamp(a.pos.y + mk.drift.y * dt, 90, h - 90);
        if (a.pos.x <= 90 || a.pos.x >= w - 90) mk.drift.x *= -1;
        if (a.pos.y <= 90 || a.pos.y >= h - 90) mk.drift.y *= -1;
      }
      if (this.s.elapsed - mk.born > mk.ttl) {
        this.marks.splice(i, 1);
        a.alive = false;
        this.onExpire(mk);
      }
    }
    this.s.world.actors = this.s.world.actors.filter((x) => x.alive || x.id === this.s.world.playerId);
  }

  protected onExpire(mk: Mark): void {
    this.fumble(mk.actor.pos, 'EXPIRED', { input: false, cost: 40 });
  }

  /** The next mark that is legal to click, for the ordered modes. */
  protected head(): Mark | null {
    if (!this.ordered()) return null;
    let best: Mark | null = null;
    for (const m of this.marks) if (!best || m.order < best.order) best = m;
    return best;
  }

  onTargetOrder(a: Actor): void {
    const idx = this.marks.findIndex((m) => m.actor.id === a.id);
    if (idx < 0) return;
    const mk = this.marks[idx];
    const err = dist(this.s.cursorWorld, a.pos);
    const age = this.s.elapsed - mk.born;

    if (this.ordered()) {
      const head = this.head();
      if (head && head !== mk) {
        this.marks.splice(idx, 1);
        a.alive = false;
        this.fumble(a.pos, `OUT OF ORDER · ${head.order}`);
        return;
      }
    }

    this.marks.splice(idx, 1);
    a.alive = false;
    this.clickErrors.push(err);
    this.land(mk, age, err);
  }

  /** What a correct click on this mark is worth. Modes grade it differently. */
  protected land(mk: Mark, age: number, err: number): void {
    void err;
    this.hit(mk.actor.pos, {
      quality: clamp(1 - age / mk.ttl, 0, 1),
      value: 105,
      reaction: age * 1000,
    });
  }

  onClick(pos: Vec2): boolean {
    for (const m of this.marks) {
      if (dist(pos, m.actor.pos) < m.actor.radius + 26) return false;
    }
    // Nothing under the cursor and nothing to walk toward: a wasted action,
    // and in a mode measured in actions per minute that has to cost something.
    this.stray(pos);
    return true;
  }

  protected paintMode(out: DrillPaint, t: number): void {
    for (const m of this.marks) {
      const a = m.actor;
      const left = clamp(1 - (this.s.elapsed - m.born) / m.ttl, 0, 1);
      const head = this.head();
      const isHead = !this.ordered() || head === m;
      const col = left < 0.28 ? PALETTE.danger : isHead ? this.flow.color : PALETTE.textDim;
      out.markers.push({
        kind: 'ring',
        x: a.pos.x,
        y: a.pos.y,
        radius: a.radius + 14,
        color: col,
        alpha: 0.95,
        width: isHead ? 6 : 3.5,
        progress: left,
        rise: 2.6,
      });
      const pulse = 0.5 + 0.5 * Math.sin(t * 7);
      out.markers.push({
        kind: 'disc',
        x: a.pos.x,
        y: a.pos.y,
        radius: a.radius * 0.42,
        color: isHead ? PALETTE.playerCore : PALETTE.textFaint,
        alpha: 0.55 + pulse * 0.4,
        fill: 0.85,
        width: 2,
        rise: 3,
      });
      if (m.order > 0) {
        out.billboards.push({
          kind: 'label',
          x: a.pos.x,
          y: a.pos.y,
          text: `${m.order}`,
          color: isHead ? this.flow.color : PALETTE.textDim,
          size: 22,
        });
      }
    }
  }

  protected medianReaction(): number {
    if (!this.reactions.length) return 0;
    const s = [...this.reactions].sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  protected meanError(): number {
    return this.clickErrors.length
      ? this.clickErrors.reduce((a, b) => a + b, 0) / this.clickErrors.length
      : 0;
  }

  protected modeMetrics(): KeyMetric[] {
    return [ms('reaction', 'MEDIAN REACTION', this.medianReaction())];
  }
}

/**
 * AIM — the raw rate.
 *
 * No decisions, no decoys, no order: every mark is legal the moment it exists.
 * The only question this mode asks is how many correct commands per minute
 * your hand can actually produce, and it answers it in about forty seconds.
 */
export class ApmAimDrill extends TargetField {
  protected readonly targetApm = APM_TARGET_APM.apmAim;

  protected concurrency(): number {
    return 2 + Math.floor(this.d * 2.4);
  }
  protected interval(): number {
    return 0.5 - this.d * 0.18;
  }
  protected ttl(): number {
    return clamp(1.5 - this.d * 0.55 - this.heat * 0.25, 0.55, 1.6);
  }
  protected radius(): number {
    return 34 - this.d * 13;
  }

  protected notes() {
    const rt = this.medianReaction();
    return {
      helped: rt > 0 && rt < 330 ? [`Median reaction ${Math.round(rt)}ms across the whole run.`] : [],
      hurt: [],
      advice:
        rt > 520
          ? 'Park your cursor near the middle between marks. Half of a slow reaction here is travel, not decision.'
          : null,
    };
  }
}

/**
 * AIM 2 — the rate, with an order on top.
 *
 * The marks are numbered and only the lowest one is legal. Speed now costs
 * you a read, which is the thing that actually happens in a fight: the fast
 * click on the wrong unit is worse than the slower click on the right one.
 */
export class ApmAim2Drill extends TargetField {
  protected readonly targetApm = APM_TARGET_APM.apmAim2;
  private outOfOrder = 0;

  protected ordered(): boolean {
    return true;
  }
  protected concurrency(): number {
    return 3 + Math.floor(this.d * 2.2);
  }
  protected interval(): number {
    return 0.55 - this.d * 0.2;
  }
  protected ttl(): number {
    return clamp(2.6 - this.d * 0.8, 1.2, 2.8);
  }
  protected radius(): number {
    return 32 - this.d * 11;
  }
  protected drift(): number {
    return this.d > 0.5 ? (this.d - 0.5) * 200 : 0;
  }

  protected land(mk: Mark, age: number, err: number): void {
    void err;
    this.hit(mk.actor.pos, {
      quality: clamp(1 - age / mk.ttl, 0, 1),
      value: 130,
      reaction: age * 1000,
      label: mk.order % 5 === 0 ? `#${mk.order}` : undefined,
    });
  }

  onTargetOrder(a: Actor): void {
    const before = this.fumbles;
    super.onTargetOrder(a);
    if (this.fumbles > before) this.outOfOrder++;
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return { tempo: clamp(performance * 0.65 + speed * 0.35, 0, 1), targeting: performance, aim: accuracy };
  }

  protected modeMetrics(): KeyMetric[] {
    return [ms('reaction', 'MEDIAN REACTION', this.medianReaction()), count('order', 'ORDER ERRORS', this.outOfOrder, 'lower')];
  }

  protected notes() {
    return {
      helped: this.outOfOrder === 0 && this.hits > 10 ? ['You never once took the wrong mark first.'] : [],
      hurt: this.outOfOrder > 4 ? [`${this.outOfOrder} clicks on a mark that was not next.`] : [],
      advice:
        this.outOfOrder > 4
          ? 'Find the next number before you finish the current click. The read has to run one step ahead of the hand.'
          : null,
    };
  }
}

/**
 * MOUSE PRECISION — speed measured in pixels.
 *
 * The marks are small, they drift, and being *near* one is not the same as
 * being on it: your click is graded on how far from the centre it landed. The
 * targets shrink as your chain grows, so the mode gets harder in exactly the
 * proportion that you are getting better at it.
 */
export class ApmPrecisionDrill extends TargetField {
  protected readonly targetApm = APM_TARGET_APM.apmPrecision;

  protected concurrency(): number {
    return 3 + Math.floor(this.d * 3);
  }
  protected interval(): number {
    return 0.42 - this.d * 0.14;
  }
  protected ttl(): number {
    return clamp(2.2 - this.d * 0.7, 1, 2.4);
  }
  protected radius(): number {
    // Shrinks with the chain, floored so it never becomes a lottery.
    return clamp((26 - this.d * 11) * (1 - Math.min(0.35, this.chain * 0.012)), 9, 30);
  }
  protected drift(): number {
    return 60 + this.d * 220;
  }

  protected land(mk: Mark, age: number, err: number): void {
    const tolerance = mk.actor.radius + 26;
    const centred = clamp(1 - err / tolerance, 0, 1);
    const timing = clamp(1 - age / mk.ttl, 0, 1);
    // Precision leads, tempo follows: a fast click on the rim is worth less
    // than a slower one through the middle.
    this.hit(mk.actor.pos, {
      quality: centred * 0.7 + timing * 0.3,
      value: 90 + centred * 90,
      reaction: age * 1000,
      label: centred > 0.86 ? 'DEAD CENTRE' : undefined,
      color: centred > 0.86 ? PALETTE.good : undefined,
    });
  }

  protected modeField(): HudField {
    const err = this.meanError();
    const q = clamp(1 - err / 40, 0, 1);
    return {
      label: 'CLICK ERROR',
      value: this.clickErrors.length ? `${Math.round(err)}u` : '—',
      bar: q,
      tone: err < 12 ? 'good' : err < 24 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    const err = this.meanError();
    return {
      tempo: clamp(performance * 0.6 + speed * 0.4, 0, 1),
      aim: clamp(accuracy * 0.5 + clamp(1 - err / 34, 0, 1) * 0.5, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [units('clickErr', 'CLICK ERROR', this.meanError()), ms('reaction', 'MEDIAN REACTION', this.medianReaction())];
  }

  protected notes() {
    const err = this.meanError();
    return {
      helped: err > 0 && err < 11 ? ['Your clicks are landing on the middle of the target, not the edge.'] : [],
      hurt: err > 26 ? ['You are clicking near the marks rather than on them.'] : [],
      advice: err > 26 ? 'Lower your DPI a notch and aim through the centre. Edge clicks are the ones that miss a champion.' : null,
    };
  }
}

/** How long a summoner key reads as spent after it is pressed. */
const KEY_CD = 0.45;

/** A map alert: it appears at the arena's rim and wants one summoner key. */
interface Ping {
  pos: Vec2;
  born: number;
  window: number;
  /** Red pings want D, blue pings want F. */
  slot: 'd' | 'f';
}

/**
 * AIM + MAP — two screens, one pair of hands.
 *
 * Marks in the middle, alerts at the rim. A red alert wants D, a blue one
 * wants F, and both die in about a second and a half. This is the skill of
 * keeping a count going while something at the edge of your vision demands a
 * different key — which is what the minimap actually costs you in a game.
 */
export class ApmAimMapDrill extends TargetField {
  protected readonly targetApm = APM_TARGET_APM.apmAimMap;
  protected get targetRate(): number {
    return 88;
  }
  private pings: Ping[] = [];
  private pingCd = 2.4;
  private pingsAnswered = 0;
  private pingsMissed = 0;
  private pingsWrongKey = 0;
  private keys = new KeyCooldowns();

  protected concurrency(): number {
    return 2 + Math.floor(this.d * 1.6);
  }
  protected interval(): number {
    return 0.62 - this.d * 0.2;
  }
  protected ttl(): number {
    return clamp(1.9 - this.d * 0.6, 0.8, 2);
  }
  protected radius(): number {
    return 32 - this.d * 11;
  }

  protected tick(dt: number): void {
    super.tick(dt);
    this.keys.tick(dt);
    this.pingCd -= dt;
    if (this.pingCd <= 0) {
      this.pingCd = (3.4 - this.d * 1.3) / Math.max(0.7, this.tempo * 0.8);
      this.spawnPing();
    }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const g = this.pings[i];
      if (this.s.elapsed - g.born > g.window) {
        this.pings.splice(i, 1);
        this.pingsMissed++;
        this.fumble(g.pos, 'MISSED PING', { input: false, cost: 70 });
      }
    }
  }

  private spawnPing(): void {
    const { w, h } = this.s.world.bounds;
    const corner = this.s.rng.int(0, 4);
    const pos = {
      x: corner === 0 || corner === 3 ? 130 : w - 130,
      y: corner < 2 ? 120 : h - 120,
    };
    const slot: 'd' | 'f' = this.s.rng.chance(0.5) ? 'd' : 'f';
    this.pings.push({ pos, born: this.s.elapsed, window: clamp(1.8 - this.d * 0.55, 0.85, 1.9), slot });
    audio.play('telegraph', { intensity: 0.75, pan: this.s.panOf(pos) });
    this.s.fx.ring(pos.x, pos.y, 20, 130, 0.5, slot === 'd' ? PALETTE.danger : PALETTE.accent, 3, 'shock');
  }

  onAbility(slot: AbilitySlot): void {
    if (slot !== 'd' && slot !== 'f') return;
    // The wheel has to move on every press, or the session — which reads the
    // bar either side of the call to decide whether the cast happened — would
    // announce a refusal over the top of a correct answer.
    this.keys.set(slot, KEY_CD);
    const g = this.pings[0];
    if (!g) {
      const p = this.s.world.player;
      if (p) this.stray(p.pos);
      return;
    }
    this.pings.shift();
    const age = this.s.elapsed - g.born;
    if (g.slot !== slot) {
      this.pingsWrongKey++;
      this.fumble(g.pos, 'WRONG KEY');
      return;
    }
    this.pingsAnswered++;
    this.hit(g.pos, {
      quality: clamp(1 - age / g.window, 0, 1),
      value: 190,
      reaction: age * 1000,
      label: 'ANSWERED',
      color: g.slot === 'd' ? PALETTE.danger : PALETTE.accent,
    });
  }

  /** Both summoner keys stay lit, and the one the alert wants is highlighted. */
  abilities(): AbilityView[] {
    const g = this.pings[0];
    return super.abilities().map((a) => {
      if (a.slot !== 'd' && a.slot !== 'f') return a;
      return {
        ...a,
        name: a.slot === 'd' ? 'ENEMY' : 'ALLY',
        locked: false,
        highlight: g?.slot === a.slot,
        cd: clamp(this.keys.get(a.slot) / KEY_CD, 0, 1),
      };
    });
  }

  protected paintMode(out: DrillPaint, t: number): void {
    super.paintMode(out, t);
    for (const g of this.pings) {
      const left = clamp(1 - (this.s.elapsed - g.born) / g.window, 0, 1);
      const col = g.slot === 'd' ? PALETTE.danger : PALETTE.accent;
      out.markers.push({
        kind: 'ring',
        x: g.pos.x,
        y: g.pos.y,
        radius: 78,
        color: col,
        alpha: 0.9,
        width: 7,
        progress: left,
        rise: 2,
      });
      out.markers.push({
        kind: 'cross',
        x: g.pos.x,
        y: g.pos.y,
        radius: 34,
        color: col,
        alpha: 0.8,
        width: 5,
        spin: 1.2,
        rise: 2.4,
      });
      out.billboards.push({
        kind: 'label',
        x: g.pos.x,
        y: g.pos.y,
        text: g.slot.toUpperCase(),
        color: col,
        size: 26,
        sub: g.slot === 'd' ? 'ENEMY SPOTTED' : 'ALLY CALLING',
      });
    }
  }

  protected modeField(): HudField {
    const total = this.pingsAnswered + this.pingsMissed + this.pingsWrongKey;
    const rate = this.pingsAnswered / Math.max(1, total);
    return {
      label: 'PINGS',
      value: `${this.pingsAnswered}/${total}`,
      bar: rate,
      tone: rate > 0.85 ? 'good' : rate > 0.6 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    const total = this.pingsAnswered + this.pingsMissed + this.pingsWrongKey;
    const pingRate = this.pingsAnswered / Math.max(1, total);
    return {
      tempo: clamp(performance * 0.6 + speed * 0.4, 0, 1),
      targeting: clamp(pingRate * 0.7 + performance * 0.3, 0, 1),
      aim: accuracy,
    };
  }

  protected modeMetrics(): KeyMetric[] {
    const total = this.pingsAnswered + this.pingsMissed + this.pingsWrongKey;
    return [
      pct('pings', 'ALERTS ANSWERED', this.pingsAnswered / Math.max(1, total)),
      count('pingMiss', 'ALERTS MISSED', this.pingsMissed, 'lower'),
    ];
  }

  protected notes() {
    return {
      helped: this.pingsMissed === 0 && this.pingsAnswered > 6 ? ['Not one alert went unanswered while you were counting.'] : [],
      hurt: this.pingsWrongKey > 3 ? [`${this.pingsWrongKey} alerts answered with the wrong key.`] : [],
      advice:
        this.pingsMissed > this.pingsAnswered * 0.4
          ? 'Widen your gaze rather than flicking to the corner. The alert is loud before it is visible — the sound is the cue.'
          : null,
    };
  }
}
