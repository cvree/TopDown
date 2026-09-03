import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { clamp } from '../engine/math';
import { Rng } from '../engine/rng';
import { rankFromRating, RATING_MAX, TIERS, TIER_FLOOR } from '../progression/ranks';
import type { TestReport } from '../progression/profile';
import { createTest } from '../tests';
import { formatTestValue, TESTS, unitFor, valueForRating, type TestId } from '../tests/catalog';
import { C, field, text } from '../tests/kit';
import type { Frame, Stat, TestResult, TestRunner } from '../tests/types';
import { RankEmblem } from './components/RankEmblem';
import { useCountUp } from './components/charts';
import './testrun.css';

interface Props {
  id: TestId;
  seed: number;
  /** Set once the run has been recorded; showing it opens the results card. */
  report: TestReport | null;
  result: TestResult | null;
  onComplete: (value: number, res: TestResult) => void;
  onRetry: () => void;
  onExit: () => void;
}

/**
 * The instrument shell.
 *
 * Everything that is the same for all twelve tests lives here: the countdown,
 * the canvas and its device-pixel scaling, the input plumbing, the banner, and
 * the results card. A test itself is a class with an `update(frame)` — it never
 * touches React, and it never has to.
 */
export function TestRun({ id, seed, report, result, onComplete, onRetry, onExit }: Props) {
  const meta = TESTS[id];
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const runnerRef = useRef<TestRunner | null>(null);
  const doneRef = useRef(false);
  const [count, setCount] = useState(3);
  // Read inside the loop rather than depended on: re-running the loop effect
  // would re-size the canvas, and re-sizing a canvas clears it — which would
  // wipe the frozen last frame the results card is supposed to sit on.
  const reportRef = useRef(report);
  reportRef.current = report;

  if (runnerRef.current === null) runnerRef.current = createTest(id, new Rng(seed));

  /* ------------------------------------------------------------ countdown */
  useEffect(() => {
    if (report) return;
    let n = 3;
    audio.play('countdown', 0.8);
    const iv = window.setInterval(() => {
      n -= 1;
      setCount(n);
      if (n > 0) audio.play('countdown', 0.8);
      else {
        audio.play('go', 1);
        window.clearInterval(iv);
      }
    }, 700);
    return () => window.clearInterval(iv);
  }, [report]);

  /* --------------------------------------------------------------- input */
  const mouse = useRef({ x: -1, y: -1, inside: false, down: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onExit();
        return;
      }
      if (report) {
        if (e.key === 'r' || e.key === 'R' || e.key === 'Enter') onRetry();
        return;
      }
      // The tests bind Space and the arrows; letting the page scroll under a
      // live reaction test would be its own kind of measurement error.
      if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
      if (e.repeat || count > 0) return;
      runnerRef.current?.keyDown?.(e.code);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit, onRetry, report, count]);

  const localPoint = (e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (report || count > 0) return;
      e.preventDefault();
      const p = localPoint(e);
      mouse.current = { ...p, inside: true, down: true };
      runnerRef.current?.pointerDown?.(p.x, p.y, e.button);
    },
    [report, count],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const p = localPoint(e);
    mouse.current = { ...mouse.current, ...p, inside: true };
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (report || count > 0) return;
      const p = localPoint(e);
      mouse.current = { ...mouse.current, down: false };
      runnerRef.current?.pointerUp?.(p.x, p.y, e.button);
    },
    [report, count],
  );

  /* ---------------------------------------------------------------- loop */
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(320, Math.floor(r.width));
      h = Math.max(240, Math.floor(r.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    let started = false;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // Clamped so an alt-tab does not hand a test a two-second frame.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const runner = runnerRef.current;
      if (!runner) return;

      if (reportRef.current || doneRef.current) {
        // The last frame stays on screen behind the results card — it is the
        // world the run happened in — but the loop stops here.
        cancelAnimationFrame(raf);
        return;
      }
      if (!started) {
        if (count > 0) {
          field(ctx, w, h, meta.accent);
          text(ctx, 'GET READY', w / 2, h / 2 - 40, { size: 16, color: C.faint, track: 8 });
          return;
        }
        started = true;
      }

      elapsed += dt;
      const frame: Frame = { ctx, w, h, t: elapsed, dt, mouse: mouse.current };
      ctx.clearRect(0, 0, w, h);
      runner.update(frame);

      if (promptRef.current) promptRef.current.textContent = runner.prompt();
      if (railRef.current) railRef.current.style.width = `${clamp(runner.progress(), 0, 1) * 100}%`;

      if (runner.finished()) {
        doneRef.current = true;
        const res = runner.result();
        audio.play('resultsReveal', 0.9);
        onComplete(res.primary, res);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [count, meta.accent, onComplete]);

  const cursor = runnerRef.current?.cursor ?? 'default';

  return (
    <div className="testrun" style={{ ['--c' as string]: meta.accent }}>
      <div className="tr-top">
        <button className="tr-exit" onClick={onExit}>
          <kbd className="kbd">ESC</kbd> Leave
        </button>
        <div className="tr-title">
          <span className="eyebrow">{meta.group} TEST</span>
          <b className="display">{meta.name}</b>
        </div>
        <div className="tr-keys">
          {(meta.keys ?? []).map((k) => (
            <kbd className="kbd" key={k}>
              {k}
            </kbd>
          ))}
        </div>
      </div>

      <div className="tr-banner">
        <div className="tr-prompt" ref={promptRef}>
          {meta.brief}
        </div>
        <div className="tr-rail">
          <span ref={railRef} />
        </div>
      </div>

      <div className="tr-field" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ cursor: cursor === 'none' ? 'none' : cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => (mouse.current = { ...mouse.current, inside: false })}
          onContextMenu={(e) => e.preventDefault()}
        />
        {count > 0 && !report && (
          <div className="tr-count" key={count}>
            <span className="display">{count}</span>
          </div>
        )}
      </div>

      {report && result && (
        <TestResults
          id={id}
          report={report}
          result={result}
          onRetry={onRetry}
          onExit={onExit}
        />
      )}
    </div>
  );
}

/* ========================================================== results card == */

function TestResults({
  id,
  report,
  result,
  onRetry,
  onExit,
}: {
  id: TestId;
  report: TestReport;
  result: TestResult;
  onRetry: () => void;
  onExit: () => void;
}) {
  const meta = TESTS[id];
  const rank = rankFromRating(report.rating);
  const shown = useCountUp(report.value, 900, 120);
  const lower = meta.primaryDirection === 'lower';

  // What the next tier costs, in the test's own unit — an actionable target
  // rather than a rating number nobody can act on.
  const nextTierIdx = Math.min(TIERS.length - 1, rank.tierIndex + 1);
  const nextFloor = TIER_FLOOR[TIERS[nextTierIdx]];
  const nextValue = valueForRating(id, nextFloor);
  const atTop = report.rating >= RATING_MAX - 1;

  useEffect(() => {
    if (report.newBest) audio.play('personalBest', 1);
    else if (report.promoted) audio.play('rankUpHit', 1);
  }, [report.newBest, report.promoted]);

  return (
    <div className="tr-results">
      <div className="trr panel scale-in" style={{ ['--c' as string]: meta.accent }}>
        <i className="brk tl" />
        <i className="brk tr" />
        <i className="brk bl" />
        <i className="brk br" />

        <div className="trr-head">
          <span className="eyebrow">{meta.name}</span>
          <span className="faint">{meta.tagline}</span>
        </div>

        <div className="trr-hero">
          <div className="trr-figure">
            <b className="mono">{formatTestValue(shown, meta.primaryFormat)}</b>
            <span className="trr-unit">{unitFor(meta.primaryFormat)}</span>
          </div>
          <div className="trr-figure-label eyebrow">{meta.primaryLabel}</div>
        </div>

        <div className="trr-grade">
          <RankEmblem tier={rank.tier} size={58} />
          <div>
            <div className="trr-tier display">{rank.label}</div>
            <div className="trr-rating mono">{Math.round(report.rating)} / {RATING_MAX}</div>
          </div>
          <div className="trr-grade-rail">
            <span style={{ width: `${(report.rating / RATING_MAX) * 100}%` }} />
            {/* Tier ticks, so the bar reads as a ladder and not a progress bar. */}
            {TIERS.map((t) => (
              <i key={t} style={{ left: `${(TIER_FLOOR[t] / RATING_MAX) * 100}%` }} />
            ))}
          </div>
        </div>

        {report.newBest && (
          <div className="trr-pb">
            <b>PERSONAL BEST</b>
            <span>
              previous {formatTestValue(report.previousBest ?? 0, meta.primaryFormat)}
              {unitFor(meta.primaryFormat).toLowerCase()} — improved by{' '}
              {formatTestValue(Math.abs((report.previousBest ?? 0) - report.value), meta.primaryFormat)}
              {unitFor(meta.primaryFormat).toLowerCase()}
            </span>
          </div>
        )}
        {!report.newBest && report.previousBest !== null && (
          <div className="trr-pb quiet">
            <b>BEST STANDS</b>
            <span>
              your best is {formatTestValue(report.previousBest, meta.primaryFormat)}
              {unitFor(meta.primaryFormat).toLowerCase()} — {lower ? 'go lower' : 'go higher'} to take it
            </span>
          </div>
        )}

        <div className="trr-stats">
          {result.stats.map((s) => (
            <StatCell key={s.label} s={s} />
          ))}
        </div>

        {result.trials.length > 2 && (
          <div className="trr-trace">
            <span className="eyebrow">Every attempt in this run</span>
            <TrialBars values={result.trials} lower={lower} accent={meta.accent} />
          </div>
        )}

        <div className="trr-notes">
          {result.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>

        {!atTop && (
          <div className="trr-next">
            <span className="eyebrow">Next tier</span>
            <b>
              {TIERS[nextTierIdx]} at {formatTestValue(nextValue, meta.primaryFormat)}
              {unitFor(meta.primaryFormat).toLowerCase()}
            </b>
          </div>
        )}

        <div className="trr-actions">
          <button className="btn primary lg" onClick={onRetry}>
            RUN IT AGAIN <span className="trr-key">R</span>
          </button>
          <button className="btn ghost" onClick={onExit}>
            ALL TESTS
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCell({ s }: { s: Stat }) {
  const v =
    s.format === 'pct'
      ? `${Math.round(s.value * 100)}%`
      : s.format === 'ms'
        ? `${Math.round(s.value)}ms`
        : s.format === 'sec'
          ? `${s.value.toFixed(1)}s`
          : s.format === 'units'
            ? `${Math.round(s.value)}px`
            : `${Math.round(s.value)}`;
  return (
    <div className="trr-stat">
      <span className="eyebrow">{s.label}</span>
      <b className="mono">{v}</b>
    </div>
  );
}

/** Per-trial bars: the shape of a run, where a single number cannot be. */
function TrialBars({ values, lower, accent }: { values: number[]; lower: boolean; accent: string }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return (
    <div className="trialbars">
      {values.map((v, i) => {
        // Height is always "how good", whichever direction good is.
        const q = lower ? 1 - (v - min) / span : (v - min) / span;
        return (
          <i
            key={i}
            style={{
              height: `${18 + q * 82}%`,
              background: q > 0.66 ? accent : q > 0.33 ? 'rgba(200,170,110,0.55)' : 'rgba(232,64,87,0.6)',
            }}
            title={String(Math.round(v))}
          />
        );
      })}
    </div>
  );
}
