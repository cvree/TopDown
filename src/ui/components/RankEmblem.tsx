import { RANK_COLORS } from '../../engine/palette';
import type { Tier } from '../../progression/ranks';

interface Props {
  tier: Tier;
  size?: number;
  /** Adds the light sweep and glow used in the rank-up moment. */
  animated?: boolean;
  dim?: boolean;
}

/**
 * The rank emblem. Built from primitives rather than art assets so it scales
 * cleanly, tints per tier, and can be animated for the promotion moment.
 * Complexity increases with class: Foundation is a bare plate, Apex is crowned.
 */
export function RankEmblem({ tier, size = 120, animated = false, dim = false }: Props) {
  const c = RANK_COLORS[tier] ?? RANK_COLORS.FOUNDATION;
  const idx = [
    'FOUNDATION',
    'DEVELOPING',
    'PROFICIENT',
    'CALIBRATED',
    'REFINED',
    'ADVANCED',
    'EXPERT',
    'ELITE',
    'PEERLESS',
    'APEX',
  ].indexOf(tier);
  const uid = `rk-${tier}`;
  const chevrons = Math.min(3, Math.floor(idx / 3));
  const crowned = idx >= 7;
  const winged = idx >= 8;
  const apex = idx >= 9;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      style={{
        overflow: 'visible',
        opacity: dim ? 0.55 : 1,
        filter: animated ? `drop-shadow(0 0 26px ${c.glow}88)` : `drop-shadow(0 8px 22px rgba(0,0,0,.55))`,
      }}
    >
      <defs>
        <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={c.glow} />
          <stop offset="45%" stopColor={c.base} />
          <stop offset="100%" stopColor={c.metal} />
        </linearGradient>
        <linearGradient id={`${uid}-edge`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c.glow} stopOpacity="0.95" />
          <stop offset="100%" stopColor={c.metal} stopOpacity="0.6" />
        </linearGradient>
        <radialGradient id={`${uid}-halo`}>
          <stop offset="0%" stopColor={c.glow} stopOpacity="0.45" />
          <stop offset="70%" stopColor={c.base} stopOpacity="0.08" />
          <stop offset="100%" stopColor={c.base} stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${uid}-clip`}>
          <path d="M60 6 L104 30 L104 74 L60 114 L16 74 L16 30 Z" />
        </clipPath>
      </defs>

      <circle cx="60" cy="60" r="58" fill={`url(#${uid}-halo)`} />

      {winged && (
        <g opacity="0.85">
          <path d="M14 44 L2 52 L14 58 Z" fill={c.base} opacity="0.8" />
          <path d="M106 44 L118 52 L106 58 Z" fill={c.base} opacity="0.8" />
        </g>
      )}

      {/* Plate */}
      <path
        d="M60 6 L104 30 L104 74 L60 114 L16 74 L16 30 Z"
        fill={`url(#${uid}-body)`}
        stroke={`url(#${uid}-edge)`}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M60 6 L104 30 L104 74 L60 114 L16 74 L16 30 Z"
        fill="none"
        stroke="rgba(0,0,0,.35)"
        strokeWidth="6"
        strokeLinejoin="round"
        opacity="0.25"
      />

      {/* Inner bevel */}
      <path
        d="M60 18 L94 37 L94 70 L60 101 L26 70 L26 37 Z"
        fill="rgba(0,0,0,.34)"
        stroke={c.glow}
        strokeOpacity="0.4"
        strokeWidth="1"
      />

      {/* Sigil: a rising chevron stack. */}
      <g clipPath={`url(#${uid}-clip)`}>
        {Array.from({ length: chevrons + 1 }).map((_, i) => (
          <path
            key={i}
            d={`M60 ${40 + i * 15} L78 ${58 + i * 15} L69 ${58 + i * 15} L60 ${49 + i * 15} L51 ${58 + i * 15} L42 ${58 + i * 15} Z`}
            fill={i === 0 ? '#ffffff' : c.glow}
            opacity={i === 0 ? 0.95 : 0.55 - i * 0.12}
          />
        ))}
        {apex && (
          <circle cx="60" cy="34" r="6" fill="#ffffff" opacity="0.95" />
        )}
        {animated && (
          <rect
            x="-60"
            y="0"
            width="34"
            height="120"
            fill="rgba(255,255,255,.5)"
            transform="skewX(-18)"
            style={{ animation: 'sweep 1.6s var(--ease) 0.35s both' }}
          />
        )}
      </g>

      {crowned && (
        <path
          d="M42 20 L50 10 L60 18 L70 10 L78 20 Z"
          fill={c.glow}
          stroke={c.metal}
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
