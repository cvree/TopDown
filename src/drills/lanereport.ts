import type { WavePlan } from '../engine/lanebot';

/**
 * THE LANE REPORT — what happened, in the order it happened, with the reason.
 *
 * A lane's result screen used to be totals: creep score, gold, level, and a
 * list of what helped and what hurt. Totals say *that* a lane was lost. They do
 * not say which exchange lost it, who started that exchange, or what the other
 * laner was thinking when she walked at you — and those three are the only
 * things a player can actually change next time.
 *
 * So the lane keeps three ledgers while it runs and hands them over at the end:
 *
 *  - **Trades.** Every exchange between the two champions, from the first hit
 *    to three seconds of quiet, with everything each side took in it — her,
 *    her wave, her turret — and the one thing that decided it.
 *  - **The level race.** When each of you reached two, three and six. The
 *    first minutes of a lane are a race to those numbers, and the gap is a
 *    fight you win or lose before it starts.
 *  - **Her plan.** Every time the opponent changed what she was doing with the
 *    lane, and why — she counted lethal, she had two more minions and wanted
 *    the wave on her side. The bot runs on stated reasons; this reads them back.
 */

export type Side = 'you' | 'her';
export type Source = Side | 'minion' | 'turret';

export interface Trade {
  /** Game clock, seconds. */
  start: number;
  end: number;
  startedBy: Side;
  /** Everything she took while it lasted, whoever dealt it. */
  dealt: number;
  /** What you took, split by who dealt it. */
  fromHer: number;
  fromMinions: number;
  fromTurret: number;
  /** She opened it as you went for a minion. */
  onYourLastHit: boolean;
  /** What you dealt minus what you took, in health. */
  net: number;
  verdict: 'won' | 'even' | 'lost';
  /** The one sentence: what decided it. */
  lesson: string;
}

export interface PlanSpan {
  start: number;
  end: number;
  plan: WavePlan;
  why: string;
}

export interface LevelRace {
  level: number;
  you: number | null;
  her: number | null;
}

export interface LaneReport {
  trades: Trade[];
  plans: PlanSpan[];
  levels: LevelRace[];
  /** Free hits she took on you, and how many of those were on your last hit. */
  punishes: number;
  punishesOnLastHit: number;
}

/** Seconds of no champion-on-champion damage that close a trade. */
const QUIET = 3;
/** A trade within this share of your health either way is even. */
const EVEN_SHARE = 0.08;

interface Open {
  start: number;
  last: number;
  startedBy: Side;
  dealt: number;
  fromHer: number;
  fromMinions: number;
  fromTurret: number;
  onYourLastHit: boolean;
}

export class TradeLedger {
  private open: Open | null = null;
  readonly trades: Trade[] = [];

  constructor(private readonly yourMaxHp: () => number) {}

  /**
   * One point of damage, at game-clock `t`. Only champion-on-champion damage
   * opens a trade; everything else is only counted while one is open, because
   * a caster minion hitting you in an empty lane is farming, not trading.
   */
  damage(t: number, from: Source, to: Side, amount: number, onYourLastHit = false): void {
    if (amount <= 0) return;
    const duel = (from === 'you' && to === 'her') || (from === 'her' && to === 'you');
    if (this.open && t - this.open.last > QUIET) this.close();
    if (!this.open) {
      if (!duel) return;
      this.open = {
        start: t,
        last: t,
        startedBy: from as Side,
        dealt: 0,
        fromHer: 0,
        fromMinions: 0,
        fromTurret: 0,
        onYourLastHit: from === 'her' && onYourLastHit,
      };
    }
    const o = this.open;
    if (duel) o.last = t;
    if (to === 'her') o.dealt += amount;
    else if (from === 'her') o.fromHer += amount;
    else if (from === 'minion') o.fromMinions += amount;
    else if (from === 'turret') o.fromTurret += amount;
  }

  /** Time passing with nothing hitting anybody; closes a trade gone quiet. */
  tick(t: number): void {
    if (this.open && t - this.open.last > QUIET) this.close();
  }

  /** Close whatever is open. Called at the end of the lane too. */
  close(): void {
    const o = this.open;
    this.open = null;
    if (!o) return;
    const taken = o.fromHer + o.fromMinions + o.fromTurret;
    // A single stray hit either way is not an exchange worth a row.
    if (o.dealt + taken < 30) return;
    const net = o.dealt - taken;
    const even = EVEN_SHARE * Math.max(1, this.yourMaxHp());
    const verdict = net > even ? 'won' : net < -even ? 'lost' : 'even';
    this.trades.push({
      start: o.start,
      end: o.last,
      startedBy: o.startedBy,
      dealt: Math.round(o.dealt),
      fromHer: Math.round(o.fromHer),
      fromMinions: Math.round(o.fromMinions),
      fromTurret: Math.round(o.fromTurret),
      onYourLastHit: o.onYourLastHit,
      net: Math.round(net),
      verdict,
      lesson: lessonFor(verdict, o, taken),
    });
  }
}

/**
 * What decided a trade, as one thing to do differently.
 *
 * Read in order of how much of the loss each cause accounts for, because the
 * biggest one is the fix: a trade lost mostly to her wave is a lesson about
 * minion aggro even if she also started it.
 */
export const lessonFor = (verdict: Trade['verdict'], o: Omit<Open, 'start' | 'last'>, taken: number): string => {
  if (verdict === 'won') {
    return o.startedBy === 'you'
      ? `You started it and came out ${Math.round(o.dealt - taken)} ahead — that is a trade worth taking again.`
      : `She started it and you won it back by ${Math.round(o.dealt - taken)}.`;
  }
  if (taken > 0 && o.fromMinions / taken >= 0.4)
    return `Her wave did ${Math.round(o.fromMinions)} of it. Hitting her with her minions next to you turns them on you — trade when her wave is small or busy.`;
  if (taken > 0 && o.fromTurret / taken >= 0.4)
    return `Her turret did ${Math.round(o.fromTurret)} of it. A trade under her turret is a trade against two things.`;
  if (verdict === 'even') return 'An even trade. Fine on its own — expensive if you take it when she is a level ahead.';
  if (o.startedBy === 'her' && o.onYourLastHit)
    return 'She opened as you went for a minion. Last-hit from outside her 650 reach, or be ready to hit her straight back.';
  if (o.startedBy === 'her') return 'She hit first and you did not answer. A free hit you do not trade back is health you gave away.';
  return 'You started it and she out-traded you. At 550 against 650 a straight exchange is hers — roll in with Tumble, hit, and leave.';
};

/**
 * Turn her raw plan log into spans a person can read.
 *
 * The bot re-decides twelve times a second, so a raw log flickers. Spans
 * shorter than a second are folded away, and so are the long stretches of
 * plain farming — the report is about the moments she decided something.
 */
export const planSpans = (log: readonly { t: number; plan: WavePlan; why: string }[], endT: number, toClock: (t: number) => number): PlanSpan[] => {
  // Every entry as a span, then the flicker thrown away first: a plan held
  // for a quarter of a second is the bot re-deciding, not the bot deciding.
  const raw = log
    .map((a, i) => ({ start: a.t, end: log[i + 1]?.t ?? endT, plan: a.plan, why: a.why }))
    .filter((x) => x.end - x.start >= 0.5);
  // Then the same plan for the same reason, resumed within two seconds, is
  // one span — whatever flickered in between.
  const merged: typeof raw = [];
  for (const x of raw) {
    const last = merged[merged.length - 1];
    if (last && last.plan === x.plan && last.why === x.why && x.start - last.end < 2) last.end = x.end;
    else merged.push({ ...x });
  }
  // And the report is about decisions, so plain farming is left out.
  return merged
    .filter((x) => x.plan !== 'farm' && x.end - x.start >= 1)
    .map((x) => ({ start: toClock(x.start), end: toClock(x.end), plan: x.plan, why: x.why }));
};

export const PLAN_LABEL: Record<WavePlan, string> = {
  farm: 'FARMING',
  freeze: 'FREEZING',
  shove: 'SHOVING',
  retreat: 'BACKING OFF',
  allIn: 'ALL IN',
};

export const clockText = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
