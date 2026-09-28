/**
 * YOUR LAST FIVE, AS A LINE.
 *
 * The one question a card could never answer before — am I getting better at
 * this — answered in forty pixels: the drill's last few scores, oldest on the
 * left, the newest one dotted. It colours itself by whether the newest beats
 * the oldest, and says so in words for anything that reads the screen instead
 * of looking at it.
 */
export function Trend({ scores, className }: { scores: number[]; className?: string }) {
  if (scores.length < 2) return null;
  const W = 44;
  const H = 14;
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const span = hi - lo || 1;
  const pts = scores.map((s, i) => [
    (i / (scores.length - 1)) * (W - 4) + 2,
    hi === lo ? H / 2 : H - 2 - ((s - lo) / span) * (H - 4),
  ]);
  const first = scores[0];
  const last = scores[scores.length - 1];
  const dir = last > first ? 'up' : last < first ? 'down' : 'flat';
  const [lx, ly] = pts[pts.length - 1];
  return (
    <span
      className={`trend ${dir}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={`last ${scores.length} scores: ${scores.map((s) => Math.round(s)).join(', ')}`}
      title={`Your last ${scores.length}: ${scores.map((s) => Math.round(s).toLocaleString()).join(' → ')}`}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx={lx} cy={ly} r="2" fill="currentColor" />
      </svg>
    </span>
  );
}
