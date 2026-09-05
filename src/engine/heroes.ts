import type { Build, HeadKind, WeaponKind } from '../gfx/champions';

/**
 * The roster.
 *
 * A trainer that puts you behind the same anonymous blue body in every drill
 * for six months is a spreadsheet with a camera on it. Picking a champion is
 * the first thing a MOBA player does and the last thing they stop caring
 * about, so it happens here too — once, up front, before the first drill, and
 * changeable from the settings screen forever after.
 *
 * What a hero is, exactly:
 *
 *  - It is your silhouette, your livery and your weapon in every drill that
 *    does not name its own champion. That is the entire scope, on purpose.
 *  - It is *not* a stat line. Not one number in the simulation moves: the
 *    windup law, the attack profile, the move speed and the health pool are
 *    identical behind every hero on this list. That is what keeps a rating
 *    earned on one champion comparable with a rating earned on another — the
 *    ladder measures your hands, and your hands do not change when your cape
 *    does.
 *  - The Vayne path is the one exception, and it overrides in the other
 *    direction: those drills are about a specific champion with specific
 *    numbers, so they always spawn her whatever the roster says.
 *
 * The look fields are exactly the ones `ChampionRig` builds a body out of.
 * Each hero has to be readable as a shape before it is readable as a colour,
 * because at this camera distance the outline is all that survives — so no two
 * entries share both a weapon and a headgear.
 */

export type HeroId =
  | 'sentinel'
  | 'warden'
  | 'huntress'
  | 'arcanist'
  | 'revenant'
  | 'berserker'
  | 'nightHunter';

/** The subset of `RigSpec` that is the champion rather than the situation. */
export interface HeroLook {
  build: Build;
  primary: string;
  secondary: string;
  accent: string;
  skin: string;
  weapon: WeaponKind;
  headgear: HeadKind;
  cape: boolean;
}

export interface HeroDef {
  id: HeroId;
  /** As printed. */
  name: string;
  /** The line under the name. */
  title: string;
  /** One word, in the roster grid. */
  role: string;
  /** The card's colour. Always the look's accent, so the two never drift. */
  accent: string;
  /** Two sentences at most: who this is. */
  blurb: string;
  /** What you actually see on the floor — the silhouette, in words. */
  silhouette: string;
  look: HeroLook;
  /**
   * Set on the champion the Vayne path spawns. She is on the roster because
   * she is a body you can wear everywhere else too, but the path owns her.
   */
  championPath?: boolean;
}

export const HEROES: Record<HeroId, HeroDef> = {
  // The default, and deliberately the plainest: a bright blue knight is the
  // easiest thing in the arena to find, which is the one job the player's own
  // body has to do before it does anything else.
  sentinel: {
    id: 'sentinel',
    name: 'SENTINEL',
    title: 'The shield of the line',
    role: 'Fighter',
    accent: '#9ff2ff',
    blurb:
      'Sword, helm, cloak. The most legible body on the roster: brightest in the arena, unmistakable at a glance, nothing on the silhouette competing with the thing you are supposed to be watching.',
    silhouette: 'Upright, caped, one-handed blade',
    look: {
      build: 'medium',
      primary: '#4e9ee0',
      secondary: '#e2c77a',
      accent: '#9ff2ff',
      skin: '#e6c2a0',
      weapon: 'sword',
      headgear: 'helm',
      cape: true,
    },
  },
  warden: {
    id: 'warden',
    name: 'WARDEN',
    title: 'Immovable by trade',
    role: 'Vanguard',
    accent: '#ffc46b',
    blurb:
      'A slab of a body carrying a hammer twice its arm span. Heavy builds read their attack windup from further away than anything else on the roster — useful while you are still learning to see one.',
    silhouette: 'Broad, low, two-handed hammer',
    look: {
      build: 'heavy',
      primary: '#b98a3c',
      secondary: '#3a2a12',
      accent: '#ffc46b',
      skin: '#c99b72',
      weapon: 'hammer',
      headgear: 'helm',
      cape: false,
    },
  },
  huntress: {
    id: 'huntress',
    name: 'HUNTRESS',
    title: 'Long sight, short patience',
    role: 'Marksman',
    accent: '#6dffb4',
    blurb:
      'Lean, hooded, bow already drawn. The classic ranged carry outline — if you are here to learn orbwalking, this is the body the habit was built for.',
    silhouette: 'Lean, hooded, longbow',
    look: {
      build: 'lean',
      primary: '#2f8f6d',
      secondary: '#123528',
      accent: '#6dffb4',
      skin: '#d7b189',
      weapon: 'bow',
      headgear: 'hood',
      cape: true,
    },
  },
  arcanist: {
    id: 'arcanist',
    name: 'ARCANIST',
    title: 'Everything, written down first',
    role: 'Mage',
    accent: '#d6a2ff',
    blurb:
      'Crown, staff, long coat. The tallest, thinnest outline on the roster, which makes the moment a dodge actually clears a hazard edge very easy to read on your own body.',
    silhouette: 'Tall, crowned, staff held high',
    look: {
      build: 'lean',
      primary: '#7a4fd0',
      secondary: '#241546',
      accent: '#d6a2ff',
      skin: '#cdb6d8',
      weapon: 'staff',
      headgear: 'crown',
      cape: true,
    },
  },
  revenant: {
    id: 'revenant',
    name: 'REVENANT',
    title: 'Two blades, no sound',
    role: 'Assassin',
    accent: '#5ff0e0',
    blurb:
      'Bare-headed, twin daggers, nothing hanging off the silhouette at all. The smallest profile here — the least of your own body between you and the fight.',
    silhouette: 'Compact, uncovered, paired daggers',
    look: {
      build: 'lean',
      primary: '#1f6f72',
      secondary: '#0c2b2e',
      accent: '#5ff0e0',
      skin: '#b98f74',
      weapon: 'daggers',
      headgear: 'none',
      cape: false,
    },
  },
  berserker: {
    id: 'berserker',
    name: 'BERSERKER',
    title: 'Nothing held back, ever',
    role: 'Juggernaut',
    accent: '#ff9257',
    blurb:
      'Horned, hulking, greatsword. The widest body on the roster: it makes spacing drills honest, because there is a lot more of you to keep out of range.',
    silhouette: 'Horned, massive, two-handed greatsword',
    look: {
      build: 'heavy',
      primary: '#a8462a',
      secondary: '#361613',
      accent: '#ff9257',
      skin: '#b98763',
      weapon: 'greatsword',
      headgear: 'horns',
      cape: false,
    },
  },
  // The champion path's own body, offered to everyone. Wearing her outside the
  // path changes nothing about how the path plays — it simply means the
  // silhouette you practise behind is the one you are learning.
  nightHunter: {
    id: 'nightHunter',
    name: 'NIGHT HUNTER',
    title: 'The champion path, worn everywhere',
    role: 'Marksman',
    accent: '#c86bff',
    blurb:
      'The silhouette the Vayne path puts you in: lean, hooded, cloaked, violet. Choosing her here means every other drill rehearses the same outline the path is teaching you to read.',
    silhouette: 'Lean, hooded, cloaked, crossbow',
    look: {
      build: 'lean',
      primary: '#4a2f6b',
      secondary: '#1b1030',
      accent: '#c86bff',
      skin: '#e3c6ae',
      weapon: 'bow',
      headgear: 'hood',
      cape: true,
    },
    championPath: true,
  },
};

export const HERO_LIST: HeroDef[] = Object.values(HEROES);

/** Who a profile is until it says otherwise. */
/**
 * The champion, singular.
 *
 * The roster below is still a roster — the renderer builds a silhouette from
 * one of these entries and the arena backdrop wears one — but the client
 * trains one champion now, so there is only one answer to "who am I".
 */
export const DEFAULT_HERO: HeroId = 'nightHunter';

export const isHeroId = (v: unknown): v is HeroId => typeof v === 'string' && v in HEROES;

/** Never throws: an id from an older profile falls back rather than crashing. */
export const heroFor = (id: HeroId | string | undefined | null): HeroDef =>
  isHeroId(id) ? HEROES[id] : HEROES[DEFAULT_HERO];
