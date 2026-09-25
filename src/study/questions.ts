import type { Rng } from '../engine/rng';
import {
  ROSTER,
  SPELL_KEYS,
  brief,
  champ,
  cooldownFit,
  ladder,
  names,
  rangeFit,
  redact,
  secs,
  spellOf,
  units,
  type Champion,
  type Spell,
  type SpellKey,
} from './roster';

/**
 * THE QUESTIONS.
 *
 * Every question is about one *fact* — a passive, an ability, a cooldown, a
 * range, an attack range, one of Riot's tips — and the fact is what is
 * remembered, not the question. Get Thresh's hook cooldown wrong and it comes
 * back, but it may come back as "which comes back sooner, Thresh's hook or
 * Blitzcrank's?" rather than the same four numbers, because recognising the
 * right answer in a list you have seen before is not the same as knowing it.
 *
 * Fact ids are short and stable: `P:Thresh` the passive, `S:Thresh:Q` what the
 * ability does, `C:Thresh:Q` its cooldown, `R:Thresh:Q` its range, `A:Thresh`
 * the attack range, `T:Thresh:0` the first tip for playing against him.
 *
 * Generation is pure: a seeded `Rng` and a pool in, a question or `null` out.
 * A generator returns null rather than bending — if there are not four honest
 * options, or two ranges are too close to call, it declines and another is
 * asked for.
 */

export type Topic = 'passives' | 'abilities' | 'cooldowns' | 'ranges' | 'matchups';

export const TOPICS: { id: Topic; label: string; note: string }[] = [
  { id: 'passives', label: 'PASSIVES', note: 'what every champion does without pressing anything' },
  { id: 'abilities', label: 'ABILITIES', note: 'what each button does, and whose it is' },
  { id: 'cooldowns', label: 'COOLDOWNS', note: 'how long an ability is down once you have seen it' },
  { id: 'ranges', label: 'RANGES', note: 'how far it reaches — as a number, and on the floor' },
  { id: 'matchups', label: 'MATCHUPS', note: 'who outranges whom, and Riot’s tips for playing against' },
];

/** What a reveal points at on the champion's card. */
export type Focus = 'P' | SpellKey | 'AR' | 'TIP';

export interface Reveal {
  champ: string;
  focus: Focus;
  /** Which tip, when the focus is one. */
  tip?: number;
  /** The one line to take away. */
  line: string;
  /** The other half of a comparison, drawn beside it. */
  vs?: { champ: string; focus: Focus };
}

export interface Option {
  label: string;
  sub?: string;
}

interface Common {
  fact: string;
  topic: Topic;
  kind: KindId;
  /** The question, in one line. */
  prompt: string;
  /** Quoted text the question is about, already redacted where it has to be. */
  stem?: string;
  reveal: Reveal;
}

export interface ChoiceQuestion extends Common {
  format: 'choice';
  options: Option[];
  answer: number;
}

/**
 * Put the end of the ability on the floor.
 *
 * `ref` is a distance the player already knows by eye — their own attack
 * range, or Flash — drawn so the floor has a scale.
 */
export interface PlaceQuestion extends Common {
  format: 'place';
  champ: string;
  key: SpellKey;
  range: number;
  ref: number;
  refLabel: string;
  /** Within this many units of the true range is right. */
  tolerance: number;
}

export type Question = ChoiceQuestion | PlaceQuestion;

/** How close a placement has to be: an eighth of the range, and never tighter than 60 units. */
export const placeTolerance = (range: number): number => Math.max(60, Math.round(range * 0.12));

export const FLASH = 400;

// ----------------------------------------------------------------- facts

export type FactType = 'P' | 'S' | 'C' | 'R' | 'A' | 'T';

export interface Fact {
  type: FactType;
  champ: Champion;
  key?: SpellKey;
  tip?: number;
}

export const factId = (f: Fact): string =>
  f.type === 'P' || f.type === 'A'
    ? `${f.type}:${f.champ.id}`
    : f.type === 'T'
      ? `T:${f.champ.id}:${f.tip}`
      : `${f.type}:${f.champ.id}:${f.key}`;

export const parseFact = (id: string): Fact | null => {
  const [type, cid, rest] = id.split(':');
  const c = champ(cid);
  if (!c) return null;
  switch (type) {
    case 'P':
    case 'A':
      return { type, champ: c };
    case 'T': {
      const tip = Number(rest);
      return Number.isInteger(tip) && c.enemy[tip] ? { type, champ: c, tip } : null;
    }
    case 'S':
    case 'C':
    case 'R':
      return (SPELL_KEYS as string[]).includes(rest) ? { type, champ: c, key: rest as SpellKey } : null;
  }
  return null;
};

/** Can this fact be asked at all? A stored fact from an older roster may not be. */
export const factFit = (f: Fact): boolean => {
  if (f.type === 'C') return cooldownFit(f.champ, spellOf(f.champ, f.key!));
  if (f.type === 'R') return rangeFit(f.champ, spellOf(f.champ, f.key!));
  return true;
};

/** Every fact the roster holds, for the count on the front of the screen. */
export const allFacts = (pool: readonly Champion[] = ROSTER): Fact[] => {
  const out: Fact[] = [];
  for (const c of pool) {
    out.push({ type: 'P', champ: c }, { type: 'A', champ: c });
    for (const k of SPELL_KEYS) {
      out.push({ type: 'S', champ: c, key: k });
      const s = spellOf(c, k);
      if (cooldownFit(c, s)) out.push({ type: 'C', champ: c, key: k });
      if (rangeFit(c, s)) out.push({ type: 'R', champ: c, key: k });
    }
    c.enemy.forEach((_, tip) => out.push({ type: 'T', champ: c, tip }));
  }
  return out;
};

// ----------------------------------------------------------------- helpers

export interface Gen {
  rng: Rng;
  /** The champions questions may be *about*. Wrong answers come from everyone. */
  pool: readonly Champion[];
}

const shuffle = <T,>(rng: Rng, xs: T[]): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
};

/** The answer and its wrong options, shuffled, with where the answer ended up. */
const deal = (rng: Rng, right: Option, wrong: Option[]): { options: Option[]; answer: number } | null => {
  const options = shuffle(rng, [right, ...wrong]);
  if (new Set(options.map((o) => o.label)).size !== options.length) return null;
  return { options, answer: options.indexOf(right) };
};

/**
 * Three other champions — people who share the answer's class first, so the
 * wrong answers are ones a player could believe.
 */
const rivals = (rng: Rng, c: Champion, n = 3, ok: (o: Champion) => boolean = () => true): Champion[] => {
  const others = shuffle(rng, ROSTER.filter((o) => o.id !== c.id && ok(o)));
  const near = others.filter((o) => o.tags[0] === c.tags[0]);
  const far = others.filter((o) => o.tags[0] !== c.tags[0]);
  return [...near.slice(0, n), ...far].slice(0, n);
};

const champOption = (c: Champion): Option => ({ label: c.name, sub: c.title });

const abilityLabel = (c: Champion, s: Spell) => `${c.name} ${s.key} — ${s.name}`;

/** Numbers at least `gap` apart from the answer and from each other. */
const spread = (rng: Rng, answer: number, candidates: number[], n: number, gap: (a: number, b: number) => boolean): number[] => {
  const out: number[] = [];
  // Within a factor of two and a half either way: 0.25s beside a 9s hook is not
  // a wrong answer anybody would pick, it is a free elimination.
  const plausible = candidates.filter((x) => x > 0 && x <= answer * 2.5 && x >= answer / 2.5);
  for (const x of shuffle(rng, [...new Set(plausible)])) {
    if (out.length >= n) break;
    if (gap(x, answer) && out.every((y) => gap(x, y))) out.push(x);
  }
  return out.length === n ? out : [];
};

const apart = (rel: number, abs: number) => (a: number, b: number) =>
  Math.abs(a - b) >= Math.max(abs, rel * Math.max(a, b));

/** Every fit ability in the game, for wrong answers and comparisons. */
const everyFit = (fit: (c: Champion, s: Spell) => boolean) =>
  ROSTER.flatMap((c) => c.spells.filter((s) => fit(c, s)).map((s) => ({ c, s })));
let fitCd: { c: Champion; s: Spell }[] | null = null;
let fitRange: { c: Champion; s: Spell }[] | null = null;
const cdPool = () => (fitCd ??= everyFit(cooldownFit));
const rangePool = () => (fitRange ??= everyFit(rangeFit));

const cdLine = (c: Champion, s: Spell) =>
  `${c.name}’s ${s.name} (${s.key}) is down for ${ladder(s.cd, secs)}${s.cd.length > 1 && s.cd[0] !== s.cd[s.cd.length - 1] ? ' by rank' : ''}.`;
const rangeLine = (c: Champion, s: Spell) => `${c.name}’s ${s.name} (${s.key}) reaches ${units(s.range[0])} units.`;

// ----------------------------------------------------------------- the kinds

export type KindId =
  | 'passive-whose'
  | 'passive-what'
  | 'passive-name'
  | 'spell-which'
  | 'spell-whose'
  | 'spell-what'
  | 'cd-value'
  | 'cd-compare'
  | 'range-value'
  | 'range-compare'
  | 'range-place'
  | 'tip-whose'
  | 'outrange'
  | 'ar-value'
  | 'ar-compare';

interface Kind {
  id: KindId;
  topic: Topic;
  fact: FactType;
  /**
   * The answer is *who*. Not asked when the pool is one champion — drilling
   * Thresh, "whose passive is this?" has one possible answer before it is read.
   */
  who?: true;
  make: (g: Gen, f: Fact) => Question | null;
}

const KINDS: Kind[] = [
  // --------------------------------------------------------------- passives
  {
    id: 'passive-whose',
    who: true,
    topic: 'passives',
    fact: 'P',
    make: ({ rng }, f) => {
      const c = f.champ;
      const stem = redact(c.passive.text, c);
      if (stem.length < 30) return null;
      const d = deal(rng, champOption(c), rivals(rng, c).map(champOption));
      return d && {
        format: 'choice', fact: factId(f), topic: 'passives', kind: 'passive-whose',
        prompt: 'Whose passive is this?', stem, ...d,
        reveal: { champ: c.id, focus: 'P', line: `${c.passive.name} is ${c.name}’s passive.` },
      };
    },
  },
  {
    id: 'passive-what',
    topic: 'passives',
    fact: 'P',
    make: ({ rng }, f) => {
      const c = f.champ;
      const right = { label: brief(redact(c.passive.text, c)) };
      const wrong = rivals(rng, c).map((o) => ({ label: brief(redact(redact(o.passive.text, o), c)) }));
      const d = deal(rng, right, wrong);
      return d && {
        format: 'choice', fact: factId(f), topic: 'passives', kind: 'passive-what',
        prompt: `What does ${c.name}’s passive, ${c.passive.name}, do?`, ...d,
        reveal: { champ: c.id, focus: 'P', line: `${c.passive.name} — ${brief(c.passive.text, 240)}` },
      };
    },
  },
  {
    id: 'passive-name',
    who: true,
    topic: 'passives',
    fact: 'P',
    make: ({ rng }, f) => {
      const c = f.champ;
      if (names(c.passive.name, c)) return null;
      const d = deal(rng, champOption(c), rivals(rng, c).map(champOption));
      return d && {
        format: 'choice', fact: factId(f), topic: 'passives', kind: 'passive-name',
        prompt: `Whose passive is ${c.passive.name}?`, ...d,
        reveal: { champ: c.id, focus: 'P', line: `${c.passive.name} — ${brief(c.passive.text, 240)}` },
      };
    },
  },

  // -------------------------------------------------------------- abilities
  {
    id: 'spell-which',
    topic: 'abilities',
    fact: 'S',
    make: (_g, f) => {
      const c = f.champ;
      const s = spellOf(c, f.key!);
      const stem = redact(s.text, c);
      if (stem.length < 30) return null;
      // Q W E R, in order: shuffling a champion's own bar would only hide the key.
      const options = c.spells.map((x) => ({ label: `${x.key} — ${x.name}` }));
      return {
        format: 'choice', fact: factId(f), topic: 'abilities', kind: 'spell-which',
        prompt: `Which of ${c.name}’s abilities is this?`, stem, options, answer: SPELL_KEYS.indexOf(s.key),
        reveal: { champ: c.id, focus: s.key, line: `That is ${s.name}, ${c.name}’s ${s.key}.` },
      };
    },
  },
  {
    id: 'spell-whose',
    who: true,
    topic: 'abilities',
    fact: 'S',
    make: ({ rng }, f) => {
      const c = f.champ;
      const s = spellOf(c, f.key!);
      if (names(s.name, c)) return null;
      const d = deal(rng, champOption(c), rivals(rng, c).map(champOption));
      return d && {
        format: 'choice', fact: factId(f), topic: 'abilities', kind: 'spell-whose',
        prompt: `Whose ability is ${s.name}?`, ...d,
        reveal: { champ: c.id, focus: s.key, line: `${s.name} is ${c.name}’s ${s.key}.` },
      };
    },
  },
  {
    id: 'spell-what',
    topic: 'abilities',
    fact: 'S',
    make: ({ rng }, f) => {
      const c = f.champ;
      const s = spellOf(c, f.key!);
      const right = { label: brief(redact(s.text, c)) };
      const wrong = rivals(rng, c).map((o) => ({ label: brief(redact(redact(spellOf(o, s.key).text, o), c)) }));
      const d = deal(rng, right, wrong);
      return d && {
        format: 'choice', fact: factId(f), topic: 'abilities', kind: 'spell-what',
        prompt: `What does ${c.name}’s ${s.key}, ${s.name}, do?`, ...d,
        reveal: { champ: c.id, focus: s.key, line: `${s.name} — ${brief(s.text, 240)}` },
      };
    },
  },

  // -------------------------------------------------------------- cooldowns
  {
    id: 'cd-value',
    topic: 'cooldowns',
    fact: 'C',
    make: ({ rng }, f) => {
      const c = f.champ;
      const s = spellOf(c, f.key!);
      const v = s.cd[0];
      const others = cdPool().filter((x) => (x.s.key === 'R') === (s.key === 'R')).map((x) => x.s.cd[0]);
      const wrong = spread(rng, v, others, 3, apart(0.2, 1));
      if (!wrong.length) return null;
      const d = deal(rng, { label: secs(v) }, wrong.map((w) => ({ label: secs(w) })));
      return d && {
        format: 'choice', fact: factId(f), topic: 'cooldowns', kind: 'cd-value',
        prompt: `${c.name}’s ${s.key}, ${s.name} — cooldown at rank 1?`, ...d,
        reveal: { champ: c.id, focus: s.key, line: cdLine(c, s) },
      };
    },
  },
  {
    id: 'cd-compare',
    topic: 'cooldowns',
    fact: 'C',
    make: ({ rng }, f) => {
      const c = f.champ;
      const s = spellOf(c, f.key!);
      const near = cdPool().filter(
        (x) => x.c.id !== c.id && (x.s.key === 'R') === (s.key === 'R') && apart(0.25, 1.5)(x.s.cd[0], s.cd[0]),
      );
      if (!near.length) return null;
      const o = rng.pick(near);
      const mine = { label: abilityLabel(c, s) };
      const theirs = { label: abilityLabel(o.c, o.s) };
      const options = rng.chance(0.5) ? [mine, theirs] : [theirs, mine];
      const sooner = s.cd[0] < o.s.cd[0] ? mine : theirs;
      return {
        format: 'choice', fact: factId(f), topic: 'cooldowns', kind: 'cd-compare',
        prompt: 'At rank 1, which comes back sooner?', options, answer: options.indexOf(sooner),
        reveal: {
          champ: c.id, focus: s.key, vs: { champ: o.c.id, focus: o.s.key },
          line: `${s.name} ${secs(s.cd[0])} against ${o.s.name} ${secs(o.s.cd[0])}.`,
        },
      };
    },
  },

  // ----------------------------------------------------------------- ranges
  {
    id: 'range-value',
    topic: 'ranges',
    fact: 'R',
    make: ({ rng }, f) => {
      const c = f.champ;
      const s = spellOf(c, f.key!);
      const v = s.range[0];
      const wrong = spread(rng, v, rangePool().map((x) => x.s.range[0]), 3, apart(0.12, 75));
      if (!wrong.length) return null;
      const d = deal(rng, { label: units(v) }, wrong.map((w) => ({ label: units(w) })));
      return d && {
        format: 'choice', fact: factId(f), topic: 'ranges', kind: 'range-value',
        prompt: `${c.name}’s ${s.key}, ${s.name} — how far does it reach?`, ...d,
        reveal: { champ: c.id, focus: s.key, line: rangeLine(c, s) },
      };
    },
  },
  {
    id: 'range-compare',
    topic: 'ranges',
    fact: 'R',
    make: ({ rng }, f) => {
      const c = f.champ;
      const s = spellOf(c, f.key!);
      const near = rangePool().filter((x) => x.c.id !== c.id && apart(0.15, 100)(x.s.range[0], s.range[0]));
      // Close calls teach more than 400 against 2500: prefer a rival within half again.
      const close = near.filter((x) => Math.max(x.s.range[0], s.range[0]) / Math.min(x.s.range[0], s.range[0]) < 1.5);
      const o = rng.pick(close.length ? close : near);
      if (!o) return null;
      const mine = { label: abilityLabel(c, s) };
      const theirs = { label: abilityLabel(o.c, o.s) };
      const options = rng.chance(0.5) ? [mine, theirs] : [theirs, mine];
      const farther = s.range[0] > o.s.range[0] ? mine : theirs;
      return {
        format: 'choice', fact: factId(f), topic: 'ranges', kind: 'range-compare',
        prompt: 'Which reaches farther?', options, answer: options.indexOf(farther),
        reveal: {
          champ: c.id, focus: s.key, vs: { champ: o.c.id, focus: o.s.key },
          line: `${s.name} ${units(s.range[0])} against ${o.s.name} ${units(o.s.range[0])}.`,
        },
      };
    },
  },
  {
    id: 'range-place',
    topic: 'ranges',
    fact: 'R',
    make: (_g, f) => {
      const c = f.champ;
      const s = spellOf(c, f.key!);
      const range = s.range[0];
      if (range > 1600) return null;
      const ranged = c.ar >= 300;
      return {
        format: 'place', fact: factId(f), topic: 'ranges', kind: 'range-place',
        prompt: `Where does ${c.name}’s ${s.key}, ${s.name}, stop?`,
        champ: c.id, key: s.key, range,
        ref: ranged ? c.ar : FLASH,
        refLabel: ranged ? `${c.name}’s attack range · ${c.ar}` : `Flash · ${FLASH}`,
        tolerance: placeTolerance(range),
        reveal: { champ: c.id, focus: s.key, line: rangeLine(c, s) },
      };
    },
  },

  // --------------------------------------------------------------- matchups
  {
    id: 'tip-whose',
    who: true,
    topic: 'matchups',
    fact: 'T',
    make: ({ rng }, f) => {
      const c = f.champ;
      const tip = c.enemy[f.tip!];
      const stem = redact(tip, c);
      if (stem.length < 30) return null;
      const d = deal(rng, champOption(c), rivals(rng, c).map(champOption));
      return d && {
        format: 'choice', fact: factId(f), topic: 'matchups', kind: 'tip-whose',
        prompt: 'Riot’s advice for playing against…', stem, ...d,
        reveal: { champ: c.id, focus: 'TIP', tip: f.tip, line: `Playing against ${c.name}.` },
      };
    },
  },
  {
    id: 'outrange',
    topic: 'matchups',
    fact: 'R',
    make: ({ rng }, f) => {
      const them = f.champ;
      const s = spellOf(them, f.key!);
      const r = s.range[0];
      // Too close to call on the numbers alone is not a question, it is a coin;
      // a melee champion against a thousand-unit skillshot is not one either.
      const you = rng.pick(ROSTER.filter((o) => o.id !== them.id && Math.abs(o.ar - r) >= 100 && Math.abs(o.ar - r) <= 350));
      if (!you) return null;
      const yes = { label: 'It outranges me', sub: `${s.name} reaches farther than my basic attack` };
      const no = { label: 'I outrange it', sub: `my basic attack reaches farther than ${s.name}` };
      const options = [yes, no];
      return {
        format: 'choice', fact: factId(f), topic: 'matchups', kind: 'outrange',
        prompt: `You are ${you.name} (attack range ${you.ar}). ${them.name}’s ${s.key}, ${s.name} — can it hit you from outside your reach?`,
        options, answer: r > you.ar ? 0 : 1,
        reveal: {
          champ: them.id, focus: s.key, vs: { champ: you.id, focus: 'AR' },
          line: `${s.name} reaches ${units(r)}; ${you.name} attacks from ${you.ar}.`,
        },
      };
    },
  },
  {
    id: 'ar-value',
    topic: 'matchups',
    fact: 'A',
    make: ({ rng }, f) => {
      const c = f.champ;
      const wrong = spread(rng, c.ar, ROSTER.map((o) => o.ar), 3, apart(0, 50));
      if (!wrong.length) return null;
      const d = deal(rng, { label: units(c.ar) }, wrong.map((w) => ({ label: units(w) })));
      return d && {
        format: 'choice', fact: factId(f), topic: 'matchups', kind: 'ar-value',
        prompt: `${c.name}’s basic attack range?`, ...d,
        reveal: { champ: c.id, focus: 'AR', line: `${c.name} attacks from ${c.ar} units${c.ar <= 250 ? ' — melee' : ''}.` },
      };
    },
  },
  {
    id: 'ar-compare',
    topic: 'matchups',
    fact: 'A',
    make: ({ rng }, f) => {
      const c = f.champ;
      // A lane someone could actually be in: the same class, or either side of melee/ranged.
      const near = ROSTER.filter((o) => o.id !== c.id && Math.abs(o.ar - c.ar) >= 50 && Math.abs(o.ar - c.ar) <= 200);
      if (!near.length) return null;
      const o = rng.pick(near);
      const options = rng.chance(0.5) ? [champOption(c), champOption(o)] : [champOption(o), champOption(c)];
      const longer = c.ar > o.ar ? c : o;
      return {
        format: 'choice', fact: factId(f), topic: 'matchups', kind: 'ar-compare',
        prompt: 'In lane against each other, whose basic attack reaches farther?',
        options, answer: options.findIndex((x) => x.label === longer.name),
        reveal: { champ: c.id, focus: 'AR', vs: { champ: o.id, focus: 'AR' }, line: `${c.name} ${c.ar} against ${o.name} ${o.ar}.` },
      };
    },
  },
];

export const KIND_IDS: KindId[] = KINDS.map((k) => k.id);

// ----------------------------------------------------------------- picking

/** A random fact of this type about someone in the pool, that can be asked. */
const randomFact = (g: Gen, type: FactType): Fact | null => {
  for (let i = 0; i < 24; i++) {
    const c = g.rng.pick(g.pool);
    const f: Fact =
      type === 'P' || type === 'A'
        ? { type, champ: c }
        : type === 'T'
          ? { type, champ: c, tip: c.enemy.length ? g.rng.int(0, c.enemy.length) : -1 }
          : { type, champ: c, key: g.rng.pick(SPELL_KEYS) };
    if (f.type === 'T' && f.tip! < 0) continue;
    if (factFit(f)) return f;
  }
  return null;
};

const askable = (g: Gen, k: Kind) => !(k.who && g.pool.length === 1);

/** Ask about this particular fact, in whichever enabled way works. */
export const questionFor = (g: Gen, factKey: string, topics?: readonly Topic[]): Question | null => {
  const f = parseFact(factKey);
  if (!f || !factFit(f)) return null;
  const kinds = shuffle(g.rng, KINDS.filter((k) => k.fact === f.type && (!topics || topics.includes(k.topic)) && askable(g, k)));
  for (const k of kinds) {
    const q = k.make(g, f);
    if (q) return q;
  }
  return null;
};

/** Could a fact of this id be asked under these topics? */
export const factInTopics = (factKey: string, topics: readonly Topic[]): boolean => {
  const type = factKey.split(':')[0];
  return KINDS.some((k) => k.fact === type && topics.includes(k.topic));
};

/**
 * A new question: a topic from those enabled, a way of asking inside it, and
 * a fact about someone in the pool — none of the facts in `avoid`, unless
 * that is every fact there is. One champion and one topic can be a single
 * fact, and asking it again beats ending the session on a player who chose it.
 */
export const nextQuestion = (g: Gen, topics: readonly Topic[], avoid: ReadonlySet<string> = new Set()): Question | null => {
  if (!g.pool.length || !topics.length) return null;
  for (let i = 0; i < 60; i++) {
    const topic = g.rng.pick(topics);
    const kinds = KINDS.filter((k) => k.topic === topic && askable(g, k));
    if (!kinds.length) continue;
    const kind = g.rng.pick(kinds);
    const f = randomFact(g, kind.fact);
    if (!f || avoid.has(factId(f))) continue;
    const q = kind.make(g, f);
    if (q) return q;
  }
  return avoid.size ? nextQuestion(g, topics) : null;
};

/** Makes one specific kind of question — for the tests. */
export const makeKind = (g: Gen, kind: KindId, f: Fact): Question | null =>
  KINDS.find((k) => k.id === kind)!.make(g, f);

export const kindFact = (kind: KindId): FactType => KINDS.find((k) => k.id === kind)!.fact;
export const randomFactOf = randomFact;

/** Was this answer right? For a placement, `pick` is the distance in units. */
export const isRight = (q: Question, pick: number): boolean =>
  q.format === 'choice' ? pick === q.answer : Math.abs(pick - q.range) <= q.tolerance;
