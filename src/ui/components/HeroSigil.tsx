import { heroFor, type HeroId } from '../../engine/heroes';

/**
 * A champion's mark, drawn flat.
 *
 * The 3D portrait is the payoff, but it cannot be in a list row, in a top bar
 * or on a machine that has asked for fewer effects. So every hero also has a
 * one-glyph identity built from the two things that actually define its
 * silhouette in the arena: the weapon it carries and the shape of its head.
 * Same rule as the rig — read the outline first, the colour second.
 */

const WEAPON: Record<string, string> = {
  // A blade, point up.
  sword: 'M32 12 L36 26 V44 H28 V26 Z M24 44 H40 M32 44 V52',
  // Two-handed, wider, with a cross guard that reads at 20px.
  greatsword: 'M32 8 L38 24 V46 H26 V24 Z M20 46 H44 M32 46 V56',
  // A drawn bow.
  bow: 'M22 12 C40 22 40 42 22 52 M22 12 L22 52 M22 32 H46',
  // A staff with a stone.
  staff: 'M32 16 V56 M32 16 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0',
  // Crossed daggers.
  daggers: 'M20 16 L44 48 M44 16 L20 48 M18 44 L26 52 M46 44 L38 52',
  // A hammer head on a haft.
  hammer: 'M20 14 H44 V28 H20 Z M32 28 V56',
  none: 'M32 18 V50 M22 34 H42',
};

const HEAD: Record<string, string> = {
  hood: 'M32 4 C20 4 16 14 18 24 L46 24 C48 14 44 4 32 4 Z',
  helm: 'M18 22 V12 L32 5 L46 12 V22 L32 27 Z',
  horns: 'M18 24 L12 10 L24 16 M46 24 L52 10 L40 16 M22 24 H42',
  crown: 'M18 24 V10 L25 17 L32 6 L39 17 L46 10 V24 Z',
  none: '',
};

export function HeroSigil({ hero, size = 34 }: { hero: HeroId; size?: number }) {
  const def = heroFor(hero);
  const head = HEAD[def.look.headgear] ?? '';
  return (
    <svg
      className="hero-sigil"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={{ ['--c' as string]: def.accent }}
      aria-hidden
    >
      {head && (
        <path
          d={head}
          fill="none"
          stroke={def.accent}
          strokeWidth="2.6"
          strokeLinejoin="round"
          opacity="0.92"
        />
      )}
      {/* A bare head leaves the whole box to the weapon; anything worn on it
          pushes the weapon down into its own band so the two never overlap. */}
      <g transform={head ? 'translate(12 27) scale(0.62)' : 'translate(0 2)'}>
        <path
          d={WEAPON[def.look.weapon] ?? WEAPON.none}
          fill="none"
          stroke="currentColor"
          strokeWidth={head ? 4.4 : 3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
