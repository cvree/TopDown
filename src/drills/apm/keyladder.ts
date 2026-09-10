import type { AbilitySlot } from '../../engine/input';
import { clamp } from '../../engine/math';
import { APM_LEVELS } from '../../progression/apmladder';

/**
 * THE KEY LADDER — which of your keys a rung has put in your hands.
 *
 * The lab's ten levels used to change exactly one thing: how fast everything
 * on the bench happened. Every rung asked for the same fingers, so level one
 * and level ten were the same activity at two speeds, and a player who had
 * never opened the settings screen had no idea the trainer knew about half
 * their keyboard.
 *
 * They change two things now. The pace is still the rung — that has not moved
 * and must not, because a level is a place — and on top of it the rung decides
 * *how much of your layout is in play*. You start on two fingers. By the top
 * of the ladder every command the bench is able to grade is being asked for:
 * the four abilities, the two summoners, and the three orders that live on the
 * mouse and beside it.
 *
 *      1   Q · W            the near bank. Two fingers, and nothing else.
 *      2   + E              the hand starts to stretch.
 *      3   + R              the whole ability row.
 *      4   + D · F          the summoner bank — and the board in the corner
 *                           that owns it.
 *      5   + move           an order to a place: the cursor joins the keys.
 *      6   + attack-move    an order with a target in it.
 *      7   + stop           the order that takes the last one back.
 *      8–10                 all of it at once, at speeds nothing else asks
 *                           for.
 *
 * Two things this ladder deliberately does not do.
 *
 * It does not *gate* anything. Every rung of every bench is playable from a
 * player's first run — that is the section's oldest promise and this file does
 * not touch it. Choosing level ten on day one is choosing to be asked for
 * every key on day one, which is exactly what somebody who chooses level ten
 * is asking for.
 *
 * And it never takes a bench below the number of keys it needs to exist. A
 * mode whose whole subject is switching between two banks is not a mode with
 * one bank in it, so `benchSlots` hands back the mode's own opening keys when
 * the rung would leave it with too few. A rung may make a bench smaller. It
 * may not make it absent.
 *
 * The camera keys are not on the ladder, and it is not an oversight: centring
 * the camera and locking it are things you do to the *view*, and the lab
 * grades commands. There is no honest way to score a look.
 */

/** An order the bench can grade, beyond the six keys under your hands. */
export type LabOrder = 'move' | 'attackMove' | 'stop';

/** The ability row, in the order the ladder hands it to you. */
export const BENCH_SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r'];

/** The summoner pair. The board in the corner owns both, in every mode. */
export const MAP_SLOTS: [AbilitySlot, AbilitySlot] = ['d', 'f'];

/**
 * The rung the board turns up on.
 *
 * It lives here rather than beside the board because it is one entry in the
 * ladder above and not a fact about the board: a second task is only worth
 * adding to a first one you can already do, and rungs one to three are where a
 * player finds out what a bench is asking for.
 */
export const MAP_MIN_LEVEL = 4;

/** How many of the ability row a rung asks for. */
const ROW_AT: number[] = [2, 3, 4, 4, 4, 4, 4, 4, 4, 4];

/** The rung each order arrives on. */
export const ORDER_AT: Record<LabOrder, number> = {
  move: 5,
  attackMove: 6,
  stop: 7,
};

/** The rung by which every key on the ladder is in your hands. */
export const KEYS_COMPLETE_AT = Math.max(...Object.values(ORDER_AT));

export const LAB_ORDERS: LabOrder[] = ['move', 'attackMove', 'stop'];

/** What each order is called on the bench, and what it wants. */
export const ORDER_LABEL: Record<LabOrder, string> = {
  move: 'MOVE',
  attackMove: 'ATTACK-MOVE',
  stop: 'STOP',
};

const rung = (level: number): number => Math.floor(clamp(level, 1, APM_LEVELS));

/** The part of the ability row a rung asks for. */
export const rowAtLevel = (level: number): AbilitySlot[] =>
  BENCH_SLOTS.slice(0, ROW_AT[rung(level) - 1]);

/** Whether the board in the corner — and with it the summoner bank — is live. */
export const mapAtLevel = (level: number): boolean => rung(level) >= MAP_MIN_LEVEL;

/** The orders a rung asks for, in the order they arrive. */
export const ordersAtLevel = (level: number): LabOrder[] =>
  LAB_ORDERS.filter((o) => rung(level) >= ORDER_AT[o]);

/** Every key a rung has in play, for anything that has to name them. */
export const keysAtLevel = (level: number): AbilitySlot[] => [
  ...rowAtLevel(level),
  ...(mapAtLevel(level) ? MAP_SLOTS : []),
];

/**
 * A bench's own vocabulary, cut down to what the rung has handed over.
 *
 * `min` is the number of keys below which this bench stops being itself. When
 * the rung cannot supply that many the mode gets its own opening keys instead:
 * the ladder is allowed to simplify a bench and never to break one.
 */
export const benchSlots = (vocabulary: AbilitySlot[], level: number, min = 2): AbilitySlot[] => {
  const allowed = new Set<AbilitySlot>(rowAtLevel(level));
  const kept = vocabulary.filter((s) => allowed.has(s));
  const floor = Math.min(min, vocabulary.length);
  return kept.length >= floor ? kept : vocabulary.slice(0, floor);
};

/**
 * The two keys a two-pad bench uses at a rung — the widest pair available.
 *
 * PULSE is the one mode with exactly two pads and no room to grow, so the
 * ladder grows it the only way a two-pad bench can be grown: by moving the two
 * fingers further apart. Adjacent on rung one, opposite ends of the row by
 * rung three, which is the same journey every other bench makes by gaining a
 * pad.
 */
export const benchPair = (level: number): AbilitySlot[] => {
  const row = rowAtLevel(level);
  return [row[0], row[row.length - 1]];
};

/** What a level adds that the one below it did not have. Empty when nothing. */
export const rungAdds = (level: number): string => {
  const n = rung(level);
  if (n === 1) return 'Two keys: Q and W';
  const gained = rowAtLevel(n).filter((s) => !rowAtLevel(n - 1).includes(s));
  if (gained.length > 0) return `${gained.map((s) => s.toUpperCase()).join(' and ')} — one more finger`;
  if (n === MAP_MIN_LEVEL) return 'D and F, plus the little map in the corner';
  const order = LAB_ORDERS.find((o) => ORDER_AT[o] === n);
  if (order) return `${ORDER_LABEL[order]} — a mouse command, not a key`;
  return '';
};
