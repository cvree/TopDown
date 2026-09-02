/**
 * The APEX crest.
 *
 * One mark, drawn once, used at every size — boot screen, top bar, favicon,
 * rank-up. A product that redraws its own logo differently in three places
 * does not read as a product; it reads as three screens.
 *
 * `draw` runs the stroke-dash reveal used by the boot sequence: the outer
 * frame is struck first, then the chevron fills.
 */
export function Crest({
  size = 120,
  draw = false,
  spin = false,
}: {
  size?: number;
  draw?: boolean;
  spin?: boolean;
}) {
  return (
    <svg
      className={`crest${draw ? ' drawing' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden
    >
      <defs>
        <linearGradient id="crestFoil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8efd8" />
          <stop offset="42%" stopColor="#d3b476" />
          <stop offset="62%" stopColor="#9d7c39" />
          <stop offset="100%" stopColor="#f2e2b8" />
        </linearGradient>
        <linearGradient id="crestEdge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0e6d2" />
          <stop offset="50%" stopColor="#c8aa6e" />
          <stop offset="100%" stopColor="#6d5322" />
        </linearGradient>
      </defs>

      {/* Outer hex frame */}
      <path
        className="c-frame"
        d="M60 4 L108 32 V88 L60 116 L12 88 V32 Z"
        fill="none"
        stroke="url(#crestEdge)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {/* Inner keyline: the double frame every hextech panel has */}
      <path
        className="c-frame2"
        d="M60 13 L100 36.5 V83.5 L60 107 L20 83.5 V36.5 Z"
        fill="none"
        stroke="#c8aa6e"
        strokeWidth="0.9"
        opacity="0.45"
        strokeLinejoin="round"
      />
      {/* Rotating tick ring — the only thing on the mark that moves */}
      <g className={spin ? 'c-ring spinning' : 'c-ring'}>
        <circle cx="60" cy="60" r="46" fill="none" stroke="#c8aa6e" strokeWidth="0.7" opacity="0.3" strokeDasharray="2 9" />
      </g>
      {/* The chevron: an apex, literally */}
      <path className="c-mark" d="M60 30 L84 78 H36 Z" fill="none" stroke="url(#crestEdge)" strokeWidth="2" strokeLinejoin="round" />
      <path className="c-fill" d="M60 47 L72 71 H48 Z" fill="url(#crestFoil)" />
    </svg>
  );
}
