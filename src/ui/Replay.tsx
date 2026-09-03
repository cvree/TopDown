import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { audio } from '../engine/audio';
import { clamp } from '../engine/math';
import type { RunMetrics, TimelineMark } from '../engine/metrics';
import type { BestReplay } from '../progression/profile';
import './replay.css';

/**
 * REPLAY.
 *
 * The run, back at a quarter speed, with every mistake on the clock.
 *
 * A score tells you that four attacks were thrown away; this tells you *when*,
 * and what you were doing at the time. It is drawn entirely from telemetry the
 * run already recorded — the sampled path, the cursor track and the event
 * timeline — so it costs nothing to keep and cannot disagree with the numbers
 * on the rest of the page.
 */

const SAMPLE_DT = 0.05; // The rate the recorder samples the path at.

interface Props {
  metrics: RunMetrics;
  bounds: { w: number; h: number };
  accent: string;
  /** Minimum drawing height. The canvas takes the width it is given. */
  minHeight?: number;
  maxHeight?: number;
  /** The best run of this drill as it stood before this one, if there is one. */
  ghost?: BestReplay | null;
  /** This run's score, for the comparison line. */
  score?: number;
}

/** What each timeline event is called, and how it is drawn. */
const EVENT_STYLE: Record<
  TimelineMark['kind'],
  { label: string; color: string; r: number; note: (t: number, prev?: TimelineMark) => string }
> = {
  attack: { label: 'Attack started', color: '#eafcff', r: 2.6, note: () => 'Windup began.' },
  hit: { label: 'Attack landed', color: '#8ef0ff', r: 3.4, note: () => 'The projectile connected.' },
  cancel: {
    label: 'Attack cancelled',
    color: '#ff5f7e',
    r: 4.4,
    note: (t, prev) =>
      prev && prev.kind === 'attack'
        ? `Moved ${Math.round((t - prev.t) * 1000)}ms into the windup — the attack never released.`
        : 'The windup was thrown away before the projectile released.',
  },
  move: { label: 'Move command', color: 'rgba(92,225,168,.8)', r: 2, note: () => 'A movement order was issued.' },
  kill: { label: 'Kill', color: '#ffcf6b', r: 4.6, note: () => 'Target eliminated.' },
  taken: { label: 'Damage taken', color: '#e84057', r: 4, note: () => 'You were hit.' },
  dodge: { label: 'Dodged', color: '#5ce1a8', r: 3.4, note: () => 'A telegraph missed you.' },
  graze: { label: 'Near miss', color: '#f0c247', r: 2.8, note: () => 'It passed within a few units.' },
};

/** The events worth listing rather than only drawing. */
const NOTABLE: TimelineMark['kind'][] = ['cancel', 'taken', 'kill', 'dodge'];

const SPEEDS = [0.25, 0.5, 1] as const;

export function Replay({
  metrics,
  bounds,
  accent,
  minHeight = 240,
  maxHeight = 380,
  ghost = null,
  score = 0,
}: Props) {
  const [showGhost, setShowGhost] = useState(true);
  const duration = Math.max(0.1, metrics.duration);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(0.5);
  const [selected, setSelected] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const last = useRef(0);

  // The arena is drawn to the width it is given rather than to a constant, so
  // the replay is as big as the panel it lands in on any display.
  const [width, setWidth] = useState(430);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = clamp((width * bounds.h) / Math.max(1, bounds.w), minHeight, maxHeight);

  const events = metrics.timeline;
  // The list is a summary, not a log: a run with forty hits taken should not
  // bury its four cancelled attacks under them, so each kind gets at most
  // four entries and the worst kind is listed first.
  const notable = useMemo(() => {
    const seen = new Map<TimelineMark['kind'], number>();
    return events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => NOTABLE.includes(e.kind))
      .sort((a, b) => NOTABLE.indexOf(a.e.kind) - NOTABLE.indexOf(b.e.kind) || a.e.t - b.e.t)
      .filter(({ e }) => {
        const n = (seen.get(e.kind) ?? 0) + 1;
        seen.set(e.kind, n);
        return n <= 4;
      });
  }, [events]);
  const listed = notable.length;
  const totalNotable = useMemo(() => events.filter((e) => NOTABLE.includes(e.kind)).length, [events]);

  // Where the player was at a given moment, in canvas space.
  const project = useCallback(
    (x: number, y: number): [number, number] => {
      const s = Math.min(width / bounds.w, height / bounds.h);
      const ox = (width - bounds.w * s) / 2;
      const oy = (height - bounds.h * s) / 2;
      return [ox + x * s, oy + y * s];
    },
    [bounds.w, bounds.h, width, height],
  );

  const posAt = useCallback(
    (time: number): [number, number] | null => {
      if (!metrics.path.length) return null;
      const i = clamp(Math.round(time / SAMPLE_DT), 0, metrics.path.length - 1);
      const p = metrics.path[i];
      return project(p.x, p.y);
    },
    [metrics.path, project],
  );

  /* ---------------------------------------------------------- transport */
  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last.current) / 1000) * speed;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, duration]);

  /* ------------------------------------------------------------- render */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // The floor.
    const [x0, y0] = project(0, 0);
    const [x1, y1] = project(bounds.w, bounds.h);
    ctx.fillStyle = 'rgba(8,16,28,0.55)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(120,90,40,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);

    // The whole route, dim; then the part already played, lit.
    const upto = clamp(Math.round(t / SAMPLE_DT), 0, metrics.path.length - 1);
    const line = (from: number, to: number, style: string, w: number) => {
      if (to - from < 1) return;
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        const [px, py] = project(metrics.path[i].x, metrics.path[i].y);
        if (i === from) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = w;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    line(0, metrics.path.length - 1, 'rgba(140,170,200,0.16)', 1.2);

    // The record run, underneath. Drawn to the same clock, so at any moment
    // the two dots are where you were and where your best self was.
    if (ghost && showGhost && ghost.path.length > 1) {
      const gUpto = clamp(Math.round(t / ghost.step), 0, ghost.path.length - 1);
      ctx.beginPath();
      for (let i = 0; i <= gUpto; i++) {
        const [px, py] = project(ghost.path[i].x, ghost.path[i].y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(240,230,210,0.34)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      const g = ghost.path[gUpto];
      if (g) {
        const [gx, gy] = project(g.x, g.y);
        ctx.strokeStyle = 'rgba(240,230,210,0.75)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(gx, gy, 5.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    line(Math.max(0, upto - 90), upto, accent, 1.9);

    // Cursor, and the line from hand to intent.
    const cur = metrics.cursorPath[upto];
    const pos = metrics.path[upto];
    if (cur && pos) {
      const [cx, cy] = project(cur.x, cur.y);
      const [px, py] = project(pos.x, pos.y);
      ctx.strokeStyle = 'rgba(240,194,71,0.35)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(240,194,71,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy);
      ctx.lineTo(cx + 4, cy);
      ctx.moveTo(cx, cy - 4);
      ctx.lineTo(cx, cy + 4);
      ctx.stroke();
    }

    // Events, drawn where they happened. Ones still ahead are ghosted.
    events.forEach((e, i) => {
      const p = posAt(e.t);
      if (!p) return;
      const st = EVENT_STYLE[e.kind];
      const past = e.t <= t;
      ctx.globalAlpha = past ? 0.95 : 0.22;
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.arc(p[0], p[1], st.r, 0, Math.PI * 2);
      ctx.fill();
      if (selected === i) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#f0e6d2';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p[0], p[1], st.r + 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    // The champion.
    if (pos) {
      const [px, py] = project(pos.x, pos.y);
      ctx.fillStyle = '#f0e6d2';
      ctx.beginPath();
      ctx.arc(px, py, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [t, selected, metrics, events, project, posAt, bounds.w, bounds.h, width, height, accent, ghost, showGhost]);

  const seek = (time: number) => {
    setT(clamp(time, 0, duration));
  };

  const pick = (i: number) => {
    audio.play('uiClick');
    setSelected(i);
    setPlaying(false);
    seek(events[i].t);
  };

  /** Clicking the bar: snap to a marker if one is close, otherwise scrub. */
  const onTrackClick = (ev: MouseEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const time = clamp(((ev.clientX - r.left) / Math.max(1, r.width)) * duration, 0, duration);
    // Within about a tenth of a second of an event, the intent was the event.
    const snap = Math.max(0.12, duration * 0.006);
    let best = -1;
    let bestD = Infinity;
    events.forEach((e, i) => {
      const d = Math.abs(e.t - time);
      // Notable events win ties: a cancel under a cluster of move commands is
      // the one anybody clicking there meant.
      const weighted = NOTABLE.includes(e.kind) ? d * 0.6 : d;
      if (weighted < bestD) {
        bestD = weighted;
        best = i;
      }
    });
    setPlaying(false);
    if (best >= 0 && bestD <= snap) {
      setSelected(best);
      seek(events[best].t);
      audio.play('uiClick');
    } else {
      setSelected(null);
      seek(time);
    }
  };

  // Landed attacks either side of the same moment — the comparison the stored
  // marks can make honestly, and the one that decides an orbwalk. A drill with
  // no attacks in either run gets no such line rather than a pair of zeroes.
  const landedNow = events.filter((e) => e.kind === 'hit' && e.t <= t).length;
  const landedBest = ghost ? ghost.marks.filter((m) => m.k === 'hit' && m.t <= t).length : 0;
  const comparable =
    !!ghost &&
    (events.some((e) => e.kind === 'hit') || ghost.marks.some((m) => m.k === 'hit'));

  const sel = selected !== null ? events[selected] : null;
  const prevMark = selected !== null && selected > 0 ? events[selected - 1] : undefined;
  // Health at the selected moment, from the same series the results chart
  // reads. It turns "you were hit" into "you were hit, and here is what it
  // left you with".
  const hpAt = useMemo(() => {
    if (!sel || !metrics.hpSeries.length) return null;
    let best = metrics.hpSeries[0];
    for (const h of metrics.hpSeries) if (Math.abs(h.t - sel.t) < Math.abs(best.t - sel.t)) best = h;
    return Math.round(best.hp * 100);
  }, [sel, metrics.hpSeries]);

  if (!metrics.path.length) {
    return (
      <div className="empty">
        <b>NO TELEMETRY</b>
        <p>This run recorded no movement samples, so there is nothing to play back.</p>
      </div>
    );
  }

  return (
    <div className="replay" style={{ ['--c' as string]: accent }}>
      <div ref={wrapRef} className="rp-wrap">
        <canvas ref={canvasRef} style={{ width, height }} className="rp-canvas" />
      </div>

      <div className="rp-transport">
        <button
          className="rp-play"
          onClick={() => {
            audio.play('uiClick');
            if (t >= duration) setT(0);
            setPlaying((v) => !v);
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        {/* One click surface rather than sixty two-pixel buttons: clicking
            near a marker selects it, clicking anywhere else scrubs. The
            markers themselves are decoration — the list below is how a
            keyboard reaches them. */}
        <div className="rp-track" ref={trackRef} onClick={onTrackClick}>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={t}
            onChange={(e) => {
              setPlaying(false);
              seek(Number(e.target.value));
            }}
            aria-label="Scrub the replay"
          />
          {/* Every event, on the clock. The bar is the run's shape at a glance:
              a cluster of red is where it went wrong. */}
          <div className="rp-marks" aria-hidden>
            {events.map((e, i) => (
              <span
                key={i}
                className={`rp-mark${selected === i ? ' on' : ''}`}
                style={{ left: `${(e.t / duration) * 100}%` }}
                title={`${EVENT_STYLE[e.kind].label} · ${e.t.toFixed(2)}s`}
              >
                <i
                  style={{
                    background: EVENT_STYLE[e.kind].color,
                    height: NOTABLE.includes(e.kind) ? 12 : 6,
                  }}
                />
              </span>
            ))}
          </div>
        </div>

        <span className="rp-time mono">
          {t.toFixed(2)}s <i>/ {duration.toFixed(1)}s</i>
        </span>

        <div className="rp-speeds">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      {ghost && (
        <div className="rp-ghost">
          <button
            className={`rp-ghost-toggle${showGhost ? ' on' : ''}`}
            onClick={() => setShowGhost((v) => !v)}
            aria-pressed={showGhost}
          >
            <i />
            Personal best ghost
          </button>
          {showGhost && comparable && (
            <span className="rp-ghost-read mono">
              At {t.toFixed(1)}s · you {landedNow} landed · best {landedBest}
              <em className={landedNow - landedBest >= 0 ? 'good' : 'bad'}>
                {' '}
                {landedNow > landedBest
                  ? `+${landedNow - landedBest} ahead`
                  : landedNow < landedBest
                    ? `${landedBest - landedNow} behind`
                    : 'level'}
              </em>
            </span>
          )}
          <span className="rp-ghost-score mono faint">
            best {ghost.score.toLocaleString()}
            {score > 0 && ` · this run ${score.toLocaleString()}`}
          </span>
        </div>
      )}

      <div className="rp-detail">
        {sel ? (
          <>
            <span className="eyebrow" style={{ color: EVENT_STYLE[sel.kind].color }}>
              {EVENT_STYLE[sel.kind].label}
            </span>
            <b className="mono">{sel.t.toFixed(2)}s</b>
            <p>
              {EVENT_STYLE[sel.kind].note(sel.t, prevMark)}
              {hpAt !== null && <span className="rp-hp"> Health at that moment: {hpAt}%.</span>}
            </p>
          </>
        ) : (
          <>
            <span className="eyebrow">Pick a marker</span>
            <p className="faint">
              Every attack, cancel, dodge and hit is on the bar. Click one to jump to the moment it happened.
            </p>
          </>
        )}
      </div>

      {notable.length > 0 && (
        <div className="rp-list">
          {notable.map(({ e, i }) => (
            <button
              key={i}
              className={`rp-row${selected === i ? ' on' : ''}`}
              onClick={() => pick(i)}
              style={{ ['--k' as string]: EVENT_STYLE[e.kind].color }}
            >
              <i />
              <span>{EVENT_STYLE[e.kind].label}</span>
              <b className="mono">{e.t.toFixed(2)}s</b>
            </button>
          ))}
          {totalNotable > listed && (
            <span className="rp-more faint">+{totalNotable - listed} more on the bar</span>
          )}
        </div>
      )}
    </div>
  );
}
