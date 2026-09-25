import { factInTopics, TOPICS, type Topic } from '../study/questions';
import { CLASSES, ROSTER, type Champion } from '../study/roster';

/**
 * What STUDY remembers: every fact you have been asked, and when to ask it
 * again.
 *
 * The schedule is a Leitner box, because it is the simplest one that is
 * honest. A fact you get wrong goes to box 0 and is due now — it comes back in
 * the same session, a few questions later. Each time you get it right it moves
 * up a box and waits longer: a day, three, a week, sixteen days, five weeks.
 * A fact answered right the first time it is ever seen starts in box 2, since
 * asking you tomorrow about something you already knew is the quiz wasting
 * your time.
 *
 * Kept apart from the profile on purpose. The profile is a ledger of runs,
 * ratings and ranks, and a quiz about Thresh's hook is none of those: it has
 * no business moving a mechanics rating, and a profile reset (which is about
 * starting your hands over) should not quietly forget which cooldowns you
 * know.
 */

const STORAGE_KEY = 'apex.study.v1';
const DAY = 86_400_000;

/** How long each box waits before a fact is asked again, in days. */
export const BOX_DAYS = [0, 1, 3, 7, 16, 35] as const;
export const TOP_BOX = BOX_DAYS.length - 1;
/** A fact in this box or above is one you know. */
export const KNOWN_BOX = 3;

export interface Card {
  box: number;
  /** When it is next due, ms since the epoch. */
  due: number;
  right: number;
  wrong: number;
  last: number;
}

export type StudyMode = 'play' | 'survive' | 'review';

/** Which champions questions are about: everyone, one class, or your own list. */
export type Scope = 'all' | 'mine' | (typeof CLASSES)[number];

export interface StudyRun {
  mode: StudyMode;
  right: number;
  asked: number;
  at: number;
}

export interface StudyStore {
  v: 1;
  cards: Record<string, Card>;
  best: { play: number; survive: number };
  topics: Topic[];
  scope: Scope;
  mine: string[];
  runs: StudyRun[];
}

export const newStudy = (): StudyStore => ({
  v: 1,
  cards: {},
  best: { play: 0, survive: 0 },
  topics: TOPICS.map((t) => t.id),
  scope: 'all',
  mine: [],
  runs: [],
});

export const loadStudy = (): StudyStore => {
  const base = newStudy();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<StudyStore>;
    const topics = (s.topics ?? []).filter((t) => TOPICS.some((x) => x.id === t));
    const scope = s.scope === 'all' || s.scope === 'mine' || CLASSES.includes(s.scope as never) ? s.scope! : 'all';
    return {
      v: 1,
      cards: s.cards && typeof s.cards === 'object' ? s.cards : {},
      best: { play: s.best?.play ?? 0, survive: s.best?.survive ?? 0 },
      topics: topics.length ? topics : base.topics,
      scope,
      mine: (s.mine ?? []).filter((id) => ROSTER.some((c) => c.id === id)),
      runs: Array.isArray(s.runs) ? s.runs.slice(-40) : [],
    };
  } catch {
    return base;
  }
};

export const saveStudy = (s: StudyStore): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // A private window or a full disk: the session still works, it just will not be remembered.
  }
};

/** The card after one answer. Pure: the caller decides when to write it. */
export const answer = (prev: Card | undefined, right: boolean, now: number): Card => {
  if (!right) {
    return { box: 0, due: now, right: prev?.right ?? 0, wrong: (prev?.wrong ?? 0) + 1, last: now };
  }
  const box = prev ? Math.min(prev.box + 1, TOP_BOX) : 2;
  return { box, due: now + BOX_DAYS[box] * DAY, right: (prev?.right ?? 0) + 1, wrong: prev?.wrong ?? 0, last: now };
};

/** Every champion a question may be about, under the chosen scope. */
export const scopePool = (s: Pick<StudyStore, 'scope' | 'mine'>): Champion[] => {
  if (s.scope === 'all') return ROSTER;
  if (s.scope === 'mine') return ROSTER.filter((c) => s.mine.includes(c.id));
  return ROSTER.filter((c) => c.tags.includes(s.scope));
};

const inScope = (fact: string, pool: ReadonlySet<string>) => pool.has(fact.split(':')[1]);

/**
 * Facts due now, most overdue first — only those the enabled topics can ask
 * about, and only about champions in scope.
 */
export const dueFacts = (s: StudyStore, now: number, pool: readonly Champion[]): string[] => {
  const ids = new Set(pool.map((c) => c.id));
  return Object.entries(s.cards)
    .filter(([id, c]) => c.due <= now && inScope(id, ids) && factInTopics(id, s.topics))
    .sort((a, b) => a[1].box - b[1].box || a[1].due - b[1].due)
    .map(([id]) => id);
};

/** How many facts you know, and how many you have met at all. */
export const tally = (s: StudyStore): { known: number; seen: number } => {
  let known = 0;
  let seen = 0;
  for (const c of Object.values(s.cards)) {
    seen++;
    if (c.box >= KNOWN_BOX) known++;
  }
  return { known, seen };
};

/** Your record on one champion: facts known, facts met. */
export const champTally = (s: StudyStore, id: string): { known: number; seen: number; missed: number } => {
  let known = 0;
  let seen = 0;
  let missed = 0;
  for (const [fact, c] of Object.entries(s.cards)) {
    if (fact.split(':')[1] !== id) continue;
    seen++;
    if (c.box >= KNOWN_BOX) known++;
    if (c.box === 0) missed++;
  }
  return { known, seen, missed };
};
