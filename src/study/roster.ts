import data from './champions.json';

/**
 * THE ROSTER — every champion in League, as Riot publishes them.
 *
 * The rest of the client is three champions known to the decimal. This is the
 * other kind of knowledge: not how Vayne's Tumble feels, but what a hundred
 * and seventy kits you will play *against* actually do, how long each of them
 * is down for, and how far each of them reaches. The part of learning League
 * nobody teaches, because the game never prints it where you can see it.
 *
 * Everything here comes from Data Dragon (`npm run champdata` rebuilds it) and
 * nothing is edited by hand. What this file adds is judgement about which of
 * Data Dragon's numbers are fit to be asked about: its ranges and cooldowns
 * are Riot's own, but some of them are placeholders — 25000 means "global" on
 * Ezreal's ultimate and "cast on yourself" on Hecarim's, a cooldown of 0 is a
 * passive riding in an ability slot, and a champion with two forms has one
 * number standing in for two abilities. A quiz that asks about those is a quiz
 * that teaches something false, so it does not ask.
 */

export type SpellKey = 'Q' | 'W' | 'E' | 'R';
export const SPELL_KEYS: SpellKey[] = ['Q', 'W', 'E', 'R'];

export interface Spell {
  key: SpellKey;
  name: string;
  text: string;
  /** Seconds, one per rank. */
  cd: number[];
  /** Units, one per rank — as Data Dragon lists it. */
  range: number[];
}

export interface Champion {
  id: string;
  name: string;
  title: string;
  tags: string[];
  /** Basic attack range. */
  ar: number;
  /** Base move speed. */
  ms: number;
  passive: { name: string; text: string };
  spells: Spell[];
  /** Riot's "playing against" tips. */
  enemy: string[];
}

export const DATA_VERSION: string = data.version;
export const ROSTER: Champion[] = data.champions as Champion[];

const BY_ID = new Map(ROSTER.map((c) => [c.id, c]));
export const champ = (id: string): Champion | undefined => BY_ID.get(id);
export const spellOf = (c: Champion, key: SpellKey): Spell => c.spells[SPELL_KEYS.indexOf(key)];

/** Data Dragon's classes, in the order a player would look for them. */
export const CLASSES = ['Fighter', 'Tank', 'Mage', 'Assassin', 'Marksman', 'Support'] as const;

// ------------------------------------------------------------- what is fit
//
// A champion with a second form (Jayce, Elise, Nidalee, Udyr, Aphelios…) has
// one Data Dragon number standing in for two or more abilities. Their kits are
// still quizzed — what each button does is real — but never their numbers.

const twoForms = (c: Champion): boolean =>
  c.spells.some((s) => s.name.includes(' / ')) ||
  c.spells.some((s, i) => s.cd.length !== (i === 3 ? 3 : 5));

/** Ranges outside this are placeholders, not distances. */
export const RANGE_MIN = 350;
export const RANGE_MAX = 3000;

/** A cooldown the quiz can ask about: a real, positive, one-form number. */
export const cooldownFit = (c: Champion, s: Spell): boolean => !twoForms(c) && s.cd[0] > 0;

/**
 * A range the quiz can ask about. Rank one's figure, which is the one that
 * matters in lane; an ability with no cooldown is a passive in a slot, and its
 * "range" is whatever the tooltip needed.
 */
export const rangeFit = (c: Champion, s: Spell): boolean =>
  !twoForms(c) && s.cd[0] > 0 && s.range[0] >= RANGE_MIN && s.range[0] <= RANGE_MAX;

// ------------------------------------------------------------- redaction
//
// "Whose passive is this?" is not a question if the answer is printed in it.
// Every way a champion's text names them — the full name, and each distinctive
// word of it — is blacked out. Words too common to be a giveaway on their own
// ("Miss", "Master", "Twisted") are left, since blanking them out of other
// champions' text would be its own tell.

const REDACTED = '▮▮▮';
const COMMON = new Set(['miss', 'master', 'twisted', 'dr.', 'sin', 'iv', 'lee']);

const namesOf = (c: Champion): string[] => {
  const out = new Set<string>([c.name, c.id]);
  for (const part of c.name.split(/[\s&]+/)) {
    if (part.length >= 3 && !COMMON.has(part.toLowerCase())) out.add(part);
  }
  // Apostrophes are written two ways in Riot's text.
  for (const n of [...out]) if (n.includes("'")) out.add(n.replace(/'/g, '’'));
  // Longest first, so "Jarvan IV" goes before "Jarvan" can leave " IV" behind.
  return [...out].sort((a, b) => b.length - a.length);
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_RX = new Map<string, RegExp>();
const nameRx = (c: Champion): RegExp => {
  let rx = NAME_RX.get(c.id);
  if (!rx) {
    rx = new RegExp(`(?<![A-Za-z])(?:${namesOf(c).map(escape).join('|')})(?![A-Za-z])`, 'gi');
    NAME_RX.set(c.id, rx);
  }
  return rx;
};

/** The text, with every way it names `c` blacked out. */
export const redact = (text: string, c: Champion): string => text.replace(nameRx(c), REDACTED);

/** Does the text still give `c` away by name? */
export const names = (text: string, c: Champion): boolean => {
  const rx = nameRx(c);
  rx.lastIndex = 0;
  const hit = rx.test(text);
  rx.lastIndex = 0;
  return hit;
};

/** The first sentence or so — an option in a list has to be readable at a glance. */
export const brief = (text: string, max = 170): string => {
  const cut = text.search(/(?<=[a-z0-9)%][.!?])\s/);
  const first = cut > 40 ? text.slice(0, cut) : text;
  return first.length <= max ? first : `${first.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};

// ------------------------------------------------------------- figures

/** 7 → "7s", 6.5 → "6.5s". */
export const secs = (n: number): string => `${+n.toFixed(2)}s`;

/** A per-rank ladder, collapsed when every rank is the same. */
export const ladder = (xs: number[], unit: (n: number) => string): string =>
  xs.every((x) => x === xs[0]) ? unit(xs[0]) : xs.map(unit).join(' / ');

export const units = (n: number): string => `${Math.round(n)}`;
