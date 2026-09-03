import { useEffect, useMemo, useRef, useState } from 'react';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import { AXIS_SHORT, SKILL_AXES, type SkillAxis } from '../../progression/skills';
import { rankFromRating, RATING_MAX } from '../../progression/ranks';
import type { Vec2 } from '../../engine/types';

/** True when the viewer has asked their system for less motion. */
const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Counts a number up when it enters, because numbers arriving feel earned. */
export function useCountUp(target: number, duration = 900, delay = 0): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    // A rating that races up the screen is motion like any other. Somebody who
    // has asked for less of it gets the number, immediately.
    if (prefersReducedMotion()) {
      setV(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t + delay;
      const p = clamp((t - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay]);
  return v;
}

/* -------------------------------------------------------------- radar */

/** Room around the web for the axis labels and their ranks. */
const RADAR_PAD = 46;

interface RadarProps {
  ratings: Record<SkillAxis, number>;
  samples: Record<SkillAxis, number>;
  size?: number;
  compare?: Record<SkillAxis, number> | null;
}

/** Skill radar. Rings are rank boundaries, so the shape reads as a rank map. */
export function SkillRadar({ ratings, samples, size = 320, compare = null }: RadarProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 46;
  const n = SKILL_AXES.length;
  const [t, setT] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setT(1);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const p = clamp((now - start) / 800, 0, 1);
      setT(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pt = (i: number, v: number): Vec2 => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const rr = r * clamp(v / RATING_MAX, 0.04, 1);
    return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
  };

  const poly = (vals: number[], scale = 1) =>
    vals.map((v, i) => {
      const p = pt(i, v * scale);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');

  const values = SKILL_AXES.map((a) => (samples[a] > 0 ? ratings[a] : 0));
  const compareValues = compare ? SKILL_AXES.map((a) => compare[a] ?? 0) : null;
  const rings = [800, 1600, 2400, 2800, RATING_MAX];

  return (
    // The labels sit outside the web, and every panel in the app clips its
    // children, so the box is padded rather than trusting overflow.
    <svg
      width={size}
      height={size}
      viewBox={`${-RADAR_PAD} ${-RADAR_PAD} ${size + RADAR_PAD * 2} ${size + RADAR_PAD * 2}`}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <radialGradient id="radar-fill">
          <stop offset="0%" stopColor={PALETTE.accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={PALETTE.accent} stopOpacity="0.1" />
        </radialGradient>
      </defs>

      {rings.map((ring, i) => (
        <polygon
          key={ring}
          points={poly(SKILL_AXES.map(() => ring))}
          fill="none"
          stroke={i === rings.length - 1 ? 'rgba(140,190,240,.2)' : 'rgba(140,190,240,.09)'}
          strokeWidth="1"
        />
      ))}

      {SKILL_AXES.map((_, i) => {
        const p = pt(i, RATING_MAX);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(140,190,240,.08)" strokeWidth="1" />;
      })}

      {compareValues && (
        <polygon points={poly(compareValues, t)} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" strokeDasharray="4 5" />
      )}

      <polygon points={poly(values, t)} fill="url(#radar-fill)" stroke={PALETTE.accent} strokeWidth="2" strokeLinejoin="round" />

      {SKILL_AXES.map((axis, i) => {
        const p = pt(i, values[i] * t);
        const has = samples[axis] > 0;
        return (
          <circle key={axis} cx={p.x} cy={p.y} r={has ? 4 : 2.5} fill={has ? PALETTE.playerCore : PALETTE.textFaint} />
        );
      })}

      {SKILL_AXES.map((axis, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const lx = cx + Math.cos(a) * (r + 30);
        const ly = cy + Math.sin(a) * (r + 30);
        const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
        const rank = samples[axis] > 0 ? rankFromRating(ratings[axis]) : null;
        return (
          <g key={axis}>
            <text
              x={lx}
              y={ly - 4}
              textAnchor={anchor}
              fill={PALETTE.textDim}
              fontSize="10.5"
              fontFamily="var(--display)"
              fontWeight="600"
              letterSpacing="0.12em"
            >
              {AXIS_SHORT[axis]}
            </text>
            <text
              x={lx}
              y={ly + 10}
              textAnchor={anchor}
              fill={rank ? PALETTE.accent : PALETTE.textFaint}
              fontSize="10"
              fontFamily="var(--mono)"
            >
              {rank ? rank.label : 'UNRATED'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------ sparkline */

export function Sparkline({
  values,
  width = 200,
  height = 44,
  color = PALETTE.accent,
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  const path = useMemo(() => {
    if (values.length < 2) return { line: '', area: '' };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - 3 - ((v - min) / span) * (height - 8);
      return [x, y] as const;
    });
    // Catmull-Rom-ish smoothing keeps the curve calm without hiding trends.
    let line = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      line += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
    }
    return { line, area: `${line} L${width},${height} L0,${height} Z` };
  }, [values, width, height]);

  if (!path.line) return <svg width={width} height={height} />;
  const id = `spark-${color.replace('#', '')}`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.34" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={path.area} fill={`url(#${id})`} />}
      <path d={path.line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------- progress meter */

export function RankMeter({ progress, label, sub }: { progress: number; label: string; sub?: string }) {
  const p = clamp(progress, 0, 1);
  const cells = 18;
  const filled = Math.round(p * cells);
  return (
    <div>
      <div className="row between" style={{ marginBottom: 7 }}>
        <span className="eyebrow" style={{ letterSpacing: '0.18em' }}>{label}</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>{Math.round(p * 100)}%</span>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: cells }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 8,
              borderRadius: 2,
              background: i < filled ? 'var(--accent)' : 'rgba(140,190,240,.12)',
              boxShadow: i < filled ? '0 0 10px rgba(88,224,255,.5)' : 'none',
              transition: `background .4s var(--ease) ${i * 22}ms, box-shadow .4s ${i * 22}ms`,
            }}
          />
        ))}
      </div>
      {sub && <div className="faint" style={{ fontSize: 11, marginTop: 7 }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------- canvas visuals */

/** Attack rhythm timeline — each mark is one decision, coloured by quality. */
export function RhythmTimeline({
  marks,
  duration,
  width = 640,
  height = 74,
}: {
  marks: { t: number; kind: string }[];
  duration: number;
  width?: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = width * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const rows: Record<string, { y: number; color: string; h: number }> = {
      attack: { y: height * 0.3, color: 'rgba(88,224,255,.85)', h: 16 },
      hit: { y: height * 0.3, color: '#eafcff', h: 22 },
      move: { y: height * 0.62, color: 'rgba(92,225,168,.7)', h: 11 },
      cancel: { y: height * 0.3, color: '#ff5f7e', h: 24 },
      taken: { y: height * 0.86, color: '#ff5f7e', h: 12 },
      kill: { y: height * 0.12, color: '#ffcf6b', h: 14 },
      graze: { y: height * 0.86, color: '#ffcf6b', h: 8 },
      dodge: { y: height * 0.86, color: 'rgba(92,225,168,.5)', h: 6 },
    };

    ctx.strokeStyle = 'rgba(140,190,240,.12)';
    ctx.lineWidth = 1;
    for (const key of ['attack', 'move', 'taken']) {
      const r = rows[key];
      ctx.beginPath();
      ctx.moveTo(0, r.y);
      ctx.lineTo(width, r.y);
      ctx.stroke();
    }

    for (const m of marks) {
      const r = rows[m.kind];
      if (!r) continue;
      const x = (m.t / Math.max(0.001, duration)) * width;
      ctx.fillStyle = r.color;
      ctx.fillRect(x - 0.9, r.y - r.h / 2, m.kind === 'cancel' ? 2.4 : 1.8, r.h);
    }
  }, [marks, duration, width, height]);

  // A fixed drawing width, but never wider than the column it lands in.
  return <canvas ref={ref} style={{ width, height, display: 'block', maxWidth: '100%' }} />;
}

/** Reaction-time distribution: a histogram you can read in one glance. */
export function ReactionHistogram({
  values,
  width = 320,
  height = 110,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 3) {
    return (
      <div className="faint" style={{ fontSize: 12, padding: '20px 0' }}>
        Not enough samples in this run.
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const bins = 12;
  const span = Math.max(1, max - min);
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor(((v - min) / span) * bins))]++;
  const peak = Math.max(...counts);
  const bw = width / bins;

  return (
    <svg width={width} height={height + 18} style={{ maxWidth: '100%' }}>
      {counts.map((c, i) => {
        const h = (c / peak) * height;
        return (
          <rect
            key={i}
            x={i * bw + 1}
            y={height - h}
            width={bw - 2}
            height={h}
            rx={2}
            fill={PALETTE.accent}
            opacity={0.28 + (c / peak) * 0.6}
          />
        );
      })}
      <text x={0} y={height + 14} fill={PALETTE.textFaint} fontSize="10" fontFamily="var(--mono)">
        {Math.round(min)}ms
      </text>
      <text x={width} y={height + 14} textAnchor="end" fill={PALETTE.textFaint} fontSize="10" fontFamily="var(--mono)">
        {Math.round(max)}ms
      </text>
    </svg>
  );
}
