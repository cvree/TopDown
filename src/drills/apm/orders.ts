import { audio } from '../../engine/audio';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { Session } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import { count, ms, pct } from '../base';
import type { HitOpts } from './engine';
import { ORDER_LABEL, ordersAtLevel, type LabOrder } from './keyladder';
import { median } from './stats';

/**
 * THE ORDER LINE — the half of your layout that is not on the bench.
 *
 * The console measures keys. It has always measured keys, and for most of the
 * lab's life that was the whole of it: four abilities under four fingers, and
 * a player who had never touched the settings screen would have finished every
 * rung of every bench without the trainer once asking for the three commands
 * they actually spend a game issuing — move here, attack-move here, stop.
 *
 * Those three are not abilities and they do not belong on the bench. They are
 * *orders*: they go to the champion rather than to a cooldown, two of them
 * live on the mouse, and in League the difference between them is the whole
 * difference between walking into a fight and walking at it. So they get a
 * strip of their own along the bottom of the floor, under the console, where
 * they read as a second instrument rather than as three more pads.
 *
 * A call is a mark on the strip and a word above it. Answer it with the order
 * it asked for, at the mark, inside its window. The three cost different
 * things and are therefore not interchangeable:
 *
 *   MOVE          right button by default — an order to a *place*.
 *   ATTACK-MOVE   left button, or A — an order with a target in it.
 *   STOP          a key, and the only one of the three with no mark: it takes
 *                 back the order before it, so it is answered where you stand.
 *
 * Answering with the wrong one of the three is a fumble rather than a miss,
 * because a right-click where you meant to attack-move is not a slow command,
 * it is the wrong command — and it is the single most common way a real player
 * walks past the minion they meant to kill.
 *
 * The strip arrives one order at a time, up the ladder: move at rung five,
 * attack-move at six, stop at seven. Below five there is no strip at all —
 * `keyladder.ts` has the whole table and the reasoning behind it.
 */

/** What the strip needs from the drill it is bolted onto. */
export interface OrderVerbs {
  hit(pos: Vec2, opts: HitOpts): void;
  fumble(pos: Vec2, label: string, opts: { cost?: number; input?: boolean }): void;
  stray(pos: Vec2): void;
  /** The player's own binding for an order, as printed on the strip. */
  glyph(order: LabOrder): string;
  /** The live prompt colour, so the strip is part of the same run. */
  color(): string;
  /**
   * The difficulty the bench is running at this instant.
   *
   * Read from the drill rather than from the config, so the strip is paced by
   * whatever is pacing everything else: the rung in PLAY, the streak in SURGE,
   * the tide in INFINITE. A second instrument that ignored the floor would be
   * the one thing on screen that never got harder.
   */
  difficulty(): number;
}

interface Call {
  kind: LabOrder;
  /** Where the order has to land. Null for STOP, which is answered in place. */
  at: Vec2 | null;
  /** Run time the call went up. */
  shownAt: number;
  window: number;
}

/** How far a click may be from the mark and still be that order. */
const MARK_RADIUS = 62;

export class OrderLine {
  private call: Call | null = null;
  private nextIn: number;
  private lastMark = 0;

  private asked = 0;
  private taken = 0;
  private wrongOrder = 0;
  private wide = 0;
  private missed = 0;
  private early = 0;
  private reactions: number[] = [];

  /** The orders that have turned up so far. Latched: nothing is taken back. */
  private live: LabOrder[] = [];

  /**
   * @param level The rung being played, read every frame.
   *
   * It is a callback rather than a number because one run shape moves the
   * floor: INFINITE can climb into an order's half of the ladder halfway
   * through, and when it does the strip should gain that order exactly the way
   * the board in the corner turns up. What it never does is *lose* one — the
   * roster latches on, so a layout never shrinks under the hands using it,
   * which is also why SURGE hands this the rung the player chose rather than
   * the one their streak has pushed the pace to.
   */
  constructor(
    private readonly s: Session,
    private readonly v: OrderVerbs,
    private readonly level: () => number,
  ) {
    this.nextIn = this.gap * 0.6;
    this.sync();
  }

  /** The orders this run is asking for. Empty below the rung the strip opens on. */
  get orders(): LabOrder[] {
    return this.live;
  }

  get running(): boolean {
    return this.live.length > 0;
  }

  /**
   * Takes on any order the rung has reached since the last frame, and names it
   * so the run can announce it. An order that simply appeared is an order
   * nobody would look for.
   */
  private sync(): LabOrder | null {
    const want = ordersAtLevel(this.level());
    const gained = want.find((o) => !this.live.includes(o));
    if (!gained) return null;
    this.live.push(gained);
    return gained;
  }

  // ------------------------------------------------------------- the clock

  private get d(): number {
    return this.v.difficulty();
  }

  /** Seconds between calls. The strip is a second job, not the job. */
  private get gap(): number {
    return clamp(6.6 - this.d * 2.6, 2.8, 6.6);
  }

  /** How long a call stands. Long: this is a command, not a reaction test. */
  private get window(): number {
    return clamp(2.5 - this.d * 0.95, 0.95, 2.5);
  }

  /** The strip's own line across the floor, well below the console. */
  private get line(): { y: number; x0: number; x1: number } {
    const { w, h } = this.s.world.bounds;
    return { y: h * 0.9, x0: w * 0.16, x1: w * 0.84 };
  }

  /** Where a call's feedback lands when it has no mark of its own. */
  private get home(): Vec2 {
    const l = this.line;
    return { x: (l.x0 + l.x1) / 2, y: l.y };
  }

  // ------------------------------------------------------------- the frame

  /** Returns an order that has just turned up, for the run to announce. */
  update(dt: number): LabOrder | null {
    const gained = this.sync();
    if (!this.running) return gained;
    if (this.call) {
      if (this.s.elapsed - this.call.shownAt <= this.call.window) return gained;
      const at = this.call.at ?? this.home;
      this.missed++;
      this.call = null;
      this.nextIn = this.gap;
      this.v.fumble(at, 'NO ORDER', { input: false, cost: 70 });
      return gained;
    }
    this.nextIn -= dt;
    if (this.nextIn <= 0) this.deal();
    return gained;
  }

  private deal(): void {
    const kind = this.s.rng.pick(this.orders);
    this.call = {
      kind,
      at: kind === 'stop' ? null : this.mark(),
      shownAt: this.s.elapsed,
      window: this.window,
    };
    this.asked++;
    audio.play('telegraph', { intensity: 0.5 });
  }

  /** A point on the strip, never on top of the last one. */
  private mark(): Vec2 {
    const l = this.line;
    for (let i = 0; i < 12; i++) {
      const x = this.s.rng.range(l.x0, l.x1);
      if (Math.abs(x - this.lastMark) > (l.x1 - l.x0) * 0.28) {
        this.lastMark = x;
        return { x, y: l.y };
      }
    }
    this.lastMark = (l.x0 + l.x1) / 2;
    return { x: this.lastMark, y: l.y };
  }

  // -------------------------------------------------------------- the input

  /**
   * A click, offered to the strip before the bench sees it.
   *
   * Returns true when the strip took it. It only ever takes a click that
   * landed on its own mark, so a bench whose whole mode is clicking pads keeps
   * every click that was aimed at one.
   */
  click(pos: Vec2, kind: 'move' | 'attackMove'): boolean {
    const c = this.call;
    if (!this.running || !c || !c.at) return false;
    if (Math.hypot(pos.x - c.at.x, pos.y - c.at.y) > MARK_RADIUS + 20) return false;
    if (c.kind !== kind) {
      // The right place and the wrong button. Not a slow command — a
      // different one, and the reason this strip grades three orders rather
      // than counting clicks.
      this.wrongOrder++;
      this.answered(c);
      this.v.fumble(c.at, `WANTED ${ORDER_LABEL[c.kind]}`, { cost: 90 });
      return true;
    }
    this.take(c, pos);
    return true;
  }

  /**
   * The stop key. Returns true once the strip is running, whether or not it
   * wanted one: below rung seven the key is not part of the run and the
   * champion may have it, and above it a stop pressed for nothing is an input
   * that meant nothing, which is exactly what a stray is.
   */
  stop(): boolean {
    if (!this.live.includes('stop')) return false;
    const c = this.call;
    if (!c || c.kind !== 'stop') {
      this.early++;
      this.v.stray(this.home);
      return true;
    }
    this.take(c, this.home);
    return true;
  }

  private take(c: Call, pos: Vec2): void {
    const age = this.s.elapsed - c.shownAt;
    const at = c.at ?? this.home;
    if (c.at) {
      // How near the middle of the mark the order landed. An order is a place
      // as well as a button, and the strip is the only thing in the lab that
      // grades both at once.
      const off = Math.hypot(pos.x - c.at.x, pos.y - c.at.y);
      if (off > MARK_RADIUS) this.wide++;
    }
    this.taken++;
    this.reactions.push(age * 1000);
    this.answered(c);
    this.v.hit(at, {
      quality: clamp(1 - age / c.window, 0, 1),
      value: 130,
      reaction: age * 1000,
      label: ORDER_LABEL[c.kind],
      color: this.v.color(),
    });
  }

  private answered(c: Call): void {
    if (this.call === c) this.call = null;
    this.nextIn = this.gap;
  }

  /** The order a perfect player would be issuing right now, if any. */
  solution(): { kind: LabOrder; at: Vec2 | null } | null {
    const c = this.call;
    if (!this.running || !c) return null;
    return { kind: c.kind, at: c.at ? { ...c.at } : null };
  }

  // ------------------------------------------------------------- the strip

  paint(out: DrillPaint): void {
    if (!this.running) return;
    const l = this.line;
    const c = this.call;
    const color = c ? this.v.color() : PALETTE.textFaint;
    out.markers.push({
      kind: 'line',
      x: l.x0,
      y: l.y,
      x2: l.x1,
      y2: l.y,
      halfWidth: 2,
      color: PALETTE.textFaint,
      alpha: 0.3,
      rise: 0.1,
    });
    if (!c) {
      out.billboards.push({
        kind: 'label',
        x: (l.x0 + l.x1) / 2,
        y: l.y,
        text: 'ORDERS',
        color: PALETTE.textFaint,
        size: 15,
        sub: this.orders.map((o) => `${ORDER_LABEL[o]} ${this.v.glyph(o)}`).join('   '),
      });
      return;
    }
    const left = clamp(1 - (this.s.elapsed - c.shownAt) / c.window, 0, 1);
    const at = c.at ?? this.home;
    if (c.at) {
      // A filled ring rather than a disc, and deliberately: a disc on this
      // floor means *a pad on the bench*, which is what the console draws and
      // what the harness counts when it checks that the bench travels. The
      // strip is a second instrument and should not be mistaken for the first
      // by an eye or by a test.
      out.markers.push({
        kind: 'ring',
        x: at.x,
        y: at.y,
        radius: MARK_RADIUS,
        color,
        alpha: 0.1 + left * 0.22,
        width: MARK_RADIUS * 0.06,
        fill: 1,
        rise: 0.3,
      });
      out.markers.push({
        kind: 'ring',
        x: at.x,
        y: at.y,
        radius: MARK_RADIUS,
        color: left < 0.3 ? PALETTE.danger : color,
        alpha: 0.9,
        width: 3.5,
        progress: left,
        // Attack-move is drawn dashed, the way every attack-move indicator in
        // the genre is: the two orders have to be told apart at a glance or
        // the strip is a coin toss with a countdown on it.
        dash: c.kind === 'attackMove' ? 10 : 0,
        rise: 0.7,
      });
    } else {
      out.markers.push({
        kind: 'cross',
        x: at.x,
        y: at.y,
        radius: 34,
        color: left < 0.3 ? PALETTE.danger : color,
        alpha: 0.95,
        width: 6,
        rise: 0.9,
      });
    }
    out.billboards.push({
      kind: 'label',
      x: at.x,
      y: at.y,
      text: ORDER_LABEL[c.kind],
      color: left < 0.3 ? PALETTE.danger : color,
      size: 22,
      sub: this.v.glyph(c.kind),
    });
  }

  // ------------------------------------------------------------ the ledger

  /** True once the strip has actually asked the player for something. */
  get engaged(): boolean {
    return this.asked > 0;
  }

  metrics(): KeyMetric[] {
    if (!this.asked) return [];
    const clean = this.taken / Math.max(1, this.asked);
    return [
      pct('orderClean', 'ORDERS ISSUED', clean),
      ms('orderReact', 'ORDER REACTION', median(this.reactions)),
      ...(this.wrongOrder > 0 ? [count('orderWrong', 'WRONG ORDER', this.wrongOrder, 'lower')] : []),
      ...(this.missed > 0 ? [count('orderMissed', 'ORDERS NEVER ISSUED', this.missed, 'lower')] : []),
      ...(this.wide > 0 ? [count('orderWide', 'ORDERS OFF THE MARK', this.wide, 'lower')] : []),
    ];
  }

  notes(): { helped: string[]; hurt: string[] } {
    if (!this.asked) return { helped: [], hurt: [] };
    const helped: string[] = [];
    const hurt: string[] = [];
    if (this.taken === this.asked && this.asked > 2)
      helped.push(`Every one of ${this.asked} orders issued, without dropping the bench.`);
    else if (this.taken > this.asked * 0.8) helped.push(`${this.taken} orders issued while your hands were busy.`);
    if (this.wrongOrder > 1)
      hurt.push(`${this.wrongOrder} orders came out as the wrong button — move where you meant to attack-move, or the other way round.`);
    if (this.missed > 2) hurt.push(`${this.missed} orders were never issued at all.`);
    if (this.early > 2) hurt.push(`${this.early} stops pressed with no order to take back.`);
    return { helped, hurt };
  }

  /** The one line of coaching the strip is worth, if it is the worst thing. */
  advice(): string | null {
    if (!this.asked) return null;
    if (this.wrongOrder > this.taken * 0.25)
      return `Read the word, not the mark. ${ORDER_LABEL.move} and ${ORDER_LABEL.attackMove} go to the same place and mean different things, and the client will happily walk you past what you meant to hit.`;
    if (this.missed > this.taken * 0.5)
      return 'The strip along the bottom is part of the run. Orders are what you spend a game issuing, and this bench is the only place that counts them.';
    return null;
  }
}
