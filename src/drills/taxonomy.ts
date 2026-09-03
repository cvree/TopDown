import { DRILL_LIST, DRILLS, type DrillId } from './catalog';

/**
 * THE TRAINING TAXONOMY.
 *
 * The catalogue answers "what is this drill". This answers the two questions
 * a player standing in front of thirty-nine of them actually has:
 *
 *   what part of my game is this?   — the category
 *   how hard is it going to be?     — the phase
 *
 * The `group` field on a drill is neither: it is where the drill was *built*
 * (FOUNDATION, RHYTHM, APM), which is an author's filing system rather than a
 * player's. A flat list sorted by it puts CANCEL and SUSTAIN next to each
 * other because they came from the same engine, and puts KITE three headings
 * away from WASD 06 · KITING, which is the same skill on the other hand.
 *
 * Both fields here are derived rather than stored, so a new drill in the
 * catalogue lands in the right place by having sensible axes, and nothing has
 * to be kept in sync by hand.
 */

/** A player-facing part of the game. The order is the order they are shown. */
export type Category =
  | 'wasd'
  | 'aim'
  | 'kiting'
  | 'spacing'
  | 'dodging'
  | 'farming'
  | 'combat'
  | 'awareness';

export const CATEGORIES: { id: Category; name: string; blurb: string }[] = [
  { id: 'wasd', name: 'WASD', blurb: 'Direct control, from the four keys upward' },
  { id: 'aim', name: 'Aim', blurb: 'Putting a command on the right point, first time' },
  { id: 'kiting', name: 'Kiting', blurb: 'Attack, move, attack — without losing either' },
  { id: 'spacing', name: 'Spacing', blurb: 'Living on the edge of your range' },
  { id: 'dodging', name: 'Dodging', blurb: 'Reading a telegraph and not being there' },
  { id: 'farming', name: 'Farming', blurb: 'The killing blow, on a moving health bar' },
  { id: 'combat', name: 'Combat', blurb: 'All of it, against something that fights back' },
  { id: 'awareness', name: 'Awareness', blurb: 'Choosing the target, and the press, correctly' },
];

/**
 * How much of the game is switched on.
 *
 * This is the axis that tells a player whether they are about to be taught
 * something or measured on it, and it is the one thing a flat catalogue can
 * never say. It runs in one direction — you learn a thing alone, then with
 * one other thing, then with something shooting at you, then in the champion
 * it was for — so a rail sorted by it reads as a difficulty curve.
 */
export type Phase = 'learn' | 'isolated' | 'combined' | 'pressure' | 'transfer' | 'test';

/**
 * The phases, and the ramp they are drawn in.
 *
 * The colours are a sequence rather than six labels that happen to have hues:
 * cool where the game is switched off and you are being taught, warming as it
 * comes back on, violet where it is a whole champion, gold where nothing is
 * being trained at all. Learn and Isolated used to be two shades of the same
 * cyan, which made the two most common tags on the screen indistinguishable.
 */
export const PHASE: Record<Phase, { label: string; blurb: string; color: string }> = {
  learn: { label: 'Learn', blurb: 'Taught, at your own pace, with nothing at stake', color: '#8fb4ff' },
  isolated: { label: 'Isolated', blurb: 'One mechanic, alone, measured', color: '#58e0ff' },
  combined: { label: 'Combined', blurb: 'Two mechanics that interfere with each other', color: '#26d7c6' },
  pressure: { label: 'Pressure', blurb: 'The same thing, with something answering', color: '#f0c247' },
  transfer: { label: 'Transfer', blurb: 'Inside a real champion’s real kit', color: '#a878ff' },
  test: { label: 'Test', blurb: 'Not training — a number, on a bare field', color: '#c8aa6e' },
};

/** Hand-set where the derivation would be wrong; derived everywhere else. */
const PHASE_OVERRIDE: Partial<Record<DrillId, Phase>> = {
  // The academy teaches; the first four modules are explicitly instruction.
  wasdMove: 'learn',
  wasdIndep: 'learn',
  wasdStrafe: 'learn',
  wasdAimMove: 'learn',
  wasdCadence: 'combined',
  wasdKite: 'combined',
  wasdOffKite: 'combined',
  wasdDefKite: 'combined',
  wasdMulti: 'pressure',
  // A duel is the definition of pressure.
  duel1v1: 'pressure',
  duel1v2: 'pressure',
  duel1v3: 'pressure',
  combos: 'combined',
  targetswitch: 'combined',
  // The lab measures a press with the game taken away. That is a bench, not
  // a drill, and calling it anything but a test oversells what it trains.
  apmSustain: 'test',
  apmSplit: 'combined',
  apmHandoff: 'combined',
  apmUpkeep: 'combined',
  apmSwitch: 'combined',
};

export const phaseOf = (id: DrillId): Phase => {
  const override = PHASE_OVERRIDE[id];
  if (override) return override;
  const meta = DRILLS[id];
  if (meta.group === 'VAYNE') return 'transfer';
  if (meta.group === 'APM') return 'isolated';
  if (meta.group === 'COMBAT') return 'pressure';
  // A drill that trains exactly one axis is by definition isolated; one that
  // splits its weight across several is asking for two things at once.
  return Object.keys(meta.axes).length > 1 ? 'combined' : 'isolated';
};

/**
 * Which skill category a drill belongs to, derived from its heaviest axis.
 *
 * WASD is deliberately *not* answered here. It is a control scheme rather
 * than a part of the game, so an academy module has a real skill category
 * (WASD 06 · KITING is a kiting drill) and is additionally listed under WASD
 * because the course is a sequence you take in order. A player who came here
 * to fix their kiting should find both hands' versions of it in one place,
 * and a player taking the course should find the course intact.
 */
const CATEGORY_OVERRIDE: Partial<Record<DrillId, Category>> = {
  apmVector: 'wasd',
  apmField: 'aim',
  apmPulse: 'awareness',
  apmSequence: 'awareness',
  apmChord: 'awareness',
  apmGate: 'awareness',
  apmBuffer: 'awareness',
  apmCancel: 'awareness',
  apmHandoff: 'awareness',
  apmSplit: 'awareness',
  apmUpkeep: 'awareness',
  apmSwitch: 'awareness',
  apmSustain: 'awareness',
  targetswitch: 'awareness',
  combos: 'combat',
  skillshot: 'aim',
  movement: 'wasd',
};

export const categoryOf = (id: DrillId): Category => {
  const override = CATEGORY_OVERRIDE[id];
  if (override) return override;
  const meta = DRILLS[id];
  if (meta.group === 'COMBAT' || meta.group === 'VAYNE') return 'combat';
  const heaviest = Object.entries(meta.axes).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0];
  switch (heaviest) {
    case 'aim':
    case 'skillshot':
      return 'aim';
    case 'kiting':
      return 'kiting';
    case 'spacing':
      return 'spacing';
    case 'dodging':
      return 'dodging';
    case 'lastHitting':
      return 'farming';
    case 'targeting':
    case 'tempo':
      return 'awareness';
    case 'combat':
      return 'combat';
    default:
      return 'wasd';
  }
};

/**
 * Every drill in a category, ready to print.
 *
 * WASD lists the course in course order, because the order is the teaching.
 * Every other category is sorted by phase, so the rows read as a difficulty
 * curve rather than as the order somebody happened to write them in.
 */
const PHASE_ORDER: Phase[] = ['learn', 'isolated', 'combined', 'pressure', 'transfer', 'test'];

// The catalogue and the taxonomy are both static, so each category is worked
// out once for the life of the tab rather than on every render of the browser
// that draws eight of them.
const CACHE = new Map<Category, DrillId[]>();

export const drillsIn = (c: Category): DrillId[] => {
  const hit = CACHE.get(c);
  if (hit) return hit;
  const ids =
    c === 'wasd'
      ? DRILL_LIST.filter((d) => d.group === 'WASD' || categoryOf(d.id) === 'wasd').map((d) => d.id)
      : DRILL_LIST.filter((d) => categoryOf(d.id) === c)
          .map((d) => d.id)
          .sort((a, b) => {
            const d = PHASE_ORDER.indexOf(phaseOf(a)) - PHASE_ORDER.indexOf(phaseOf(b));
            return d !== 0 ? d : DRILLS[a].order - DRILLS[b].order;
          });
  CACHE.set(c, ids);
  return ids;
};
