import {
  ACTION_LABELS,
  UNBOUND,
  actionsFor,
  findConflicts,
  shortCodeLabel,
  type ActionId,
  type Binding,
  type Bindings,
  type MovementScheme,
} from '../../engine/input';
import { keysAtLevel, ordersAtLevel, type LabOrder } from './keyladder';

/**
 * WHAT A BENCH NEEDS FROM YOUR KEYBOARD, AND WHETHER YOU HAVE IT.
 *
 * Every other screen in the client can afford to be relaxed about bindings: a
 * champion mode asks for four abilities and the player who unbound one of them
 * did it on purpose and knows what they lost. The lab cannot. It is the one
 * section whose *levels are made of keys* — the ladder hands over one more
 * piece of the keyboard every rung — so a player who has taken R off their
 * keyboard has not made the lab a little different, they have made level three
 * and everything above it unplayable. And the mode will not say so. It will
 * light the pad, wait out the window, and score the run as though the player
 * were slow.
 *
 * That is the failure this file exists to prevent, and it is worth being blunt
 * about why it is worth a whole module: *an input trainer that silently grades
 * a player on a key they do not have is worse than no trainer*. It teaches
 * them that their hands are the problem.
 *
 * So the section asks the question before the run rather than after it. Two
 * things can be wrong, and they are told apart because the fixes are different:
 *
 *  - **Unbound.** The action has no key and no mouse button at all. Nothing
 *    the player does can answer that prompt.
 *  - **Clashing.** Two actions answer to one button, which means one of them
 *    is silently dead — and on a bench that grades both of them, the run is
 *    scoring a key that can never arrive.
 *
 * Neither is treated as the player having done something stupid. A layout is a
 * layout; what the lab needs is to know whether *this* layout can answer *this*
 * rung, and to say which row to go and look at if it cannot.
 */

/** Why an action cannot answer a prompt. */
export type BindFaultKind = 'unbound' | 'clash';

export interface BindFault {
  action: ActionId;
  /** The row's name on the settings screen — the thing to go and look for. */
  label: string;
  kind: BindFaultKind;
  /** What the bench calls this key, which is not what the settings screen does. */
  role: string;
  /** The other actions holding the same button, for a clash. */
  clashes: string[];
  /** The rung this key arrives on, so the warning can say what it costs. */
  from: number;
}

export interface BindReport {
  /** Every action a run at this level will ask for, in the order it arrives. */
  needed: ActionId[];
  faults: BindFault[];
  /** Nothing is wrong: every key the rung asks for is one the player has. */
  ok: boolean;
}

/**
 * What the bench calls each key, which is deliberately not what the settings
 * screen calls it.
 *
 * "Ability Q" is the right name on a screen that also configures six champion
 * modes, and it is the wrong one in a warning about a bench with no champion
 * on it. Both names are printed: one is what the player has to go and find,
 * the other is what it is going to be doing to them.
 */
const ROLE: Partial<Record<ActionId, string>> = {
  q: 'a pad on the near bank',
  w: 'a pad on the near bank',
  e: 'a pad on the far bank',
  r: 'a pad on the far bank',
  d: 'the left lane on the corner map',
  f: 'the right lane on the corner map',
  move: 'the move order, on the strip along the bottom',
  attackMove: 'the attack-move order, on the strip along the bottom',
  stop: 'the stop order, on the strip along the bottom',
  pause: 'ending a run and reaching these settings from inside one',
};

/** The rung each action arrives on, for a warning that can say what it costs. */
const arrivesAt = (action: ActionId): number => {
  for (let level = 1; level <= 10; level++) {
    const keys: ActionId[] = [...keysAtLevel(level), ...(ordersAtLevel(level) as ActionId[])];
    if (keys.includes(action)) return level;
  }
  return 1;
};

/** Whether an action has anything at all on it — primary or secondary. */
const hasCode = (b: Binding | undefined): boolean =>
  (b?.primary !== undefined && b.primary !== UNBOUND) ||
  (b?.secondary !== undefined && b.secondary !== UNBOUND);

/**
 * Every action a run of any bench at this level will ask for.
 *
 * It is the ladder plus one: `pause` is not a key the lab grades and it is the
 * only way out of an ENDLESS run, which has no clock and ends when the player
 * says so. A section that offers a run with no end and no way to end it would
 * be offering a trap.
 */
export const labActions = (level: number): ActionId[] => [
  ...(keysAtLevel(level) as ActionId[]),
  ...(ordersAtLevel(level) as LabOrder[] as ActionId[]),
  'pause',
];

/**
 * The bindings a bench needs at this level, checked against what the player
 * actually has.
 *
 * The conflict pass runs over the *whole* scheme rather than over the lab's own
 * list, because a bench key sharing a button with something the lab never uses
 * is still a bench key that will not arrive.
 */
export const checkLabBinds = (
  bindings: Bindings,
  level: number,
  scheme: MovementScheme,
): BindReport => {
  const needed = labActions(level);
  const clashes = findConflicts(bindings, actionsFor(scheme));
  const faults: BindFault[] = [];
  for (const action of needed) {
    const role = ROLE[action] ?? ACTION_LABELS[action];
    const from = arrivesAt(action);
    if (!hasCode(bindings[action])) {
      faults.push({ action, label: ACTION_LABELS[action], kind: 'unbound', role, clashes: [], from });
      continue;
    }
    const others = clashes.get(action);
    if (others && others.length > 0) {
      faults.push({
        action,
        label: ACTION_LABELS[action],
        kind: 'clash',
        role,
        clashes: others.map((o) => ACTION_LABELS[o]),
        from,
      });
    }
  }
  return { needed, faults, ok: faults.length === 0 };
};

/** The key a fault is about, as the player would read it. Empty when unbound. */
export const faultKey = (bindings: Bindings, fault: BindFault): string =>
  fault.kind === 'unbound' ? '' : shortCodeLabel(bindings[fault.action].primary);

/**
 * The highest level this layout can play cleanly.
 *
 * Zero when even level one is broken, which is the only case worth stating
 * outright rather than as a number: a keyboard that cannot answer two pads is
 * a keyboard the whole section is shut to.
 */
export const playableTo = (bindings: Bindings, scheme: MovementScheme, top: number): number => {
  for (let level = 1; level <= top; level++) {
    if (!checkLabBinds(bindings, level, scheme).ok) return level - 1;
  }
  return top;
};
