import { useEffect, useMemo, useRef } from 'react';
import { audio } from '../engine/audio';
import { benchmarkRating, testsAttempted, type Profile } from '../progression/profile';
import { rankFromRating, percentileForRating } from '../progression/ranks';
import {
  formatTestValue,
  TEST_GROUPS,
  TEST_LIST,
  unitFor,
  type TestId,
} from '../tests/catalog';
import { drawPreview } from '../tests/previews';
import { RankEmblem } from './components/RankEmblem';
import { Sparkline } from './components/charts';
import './tests.css';

/**
 * The test gallery.
 *
 * The drills are a training programme; this is the instrument rack. Twelve
 * cards, each running a live miniature of the thing it measures, because a
 * grid of still thumbnails would only tell you twelve names.
 *
 * All twelve previews are driven by a single rAF that walks a map of mounted
 * canvases, so the page costs one animation frame rather than twelve.
 */

interface Props {
  profile: Profile;
  onRun: (id: TestId) => void;
  onBack: () => void;
}

export function Tests({ profile, onRun, onBack }: Props) {
  const canvases = useRef(new Map<TestId, HTMLCanvasElement>());
  const dims = useRef(new Map<TestId, { w: number; h: number }>());
  const gridRef = useRef<HTMLDivElement>(null);
  const still = profile.settings.lowFx;

  const bench = benchmarkRating(profile);
  const attempted = testsAttempted(profile);
  const benchRank = rankFromRating(bench);

  /* ------------------------------------------------------ preview driver */
  useEffect(() => {
    const measure = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const [id, cv] of canvases.current) {
        const r = cv.getBoundingClientRect();
        if (r.width < 2) continue;
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        const prev = dims.current.get(id);
        if (prev && prev.w === w && prev.h === h) continue;
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        const ctx = cv.getContext('2d');
        ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        dims.current.set(id, { w, h });
      }
    };

    const paint = (t: number) => {
      for (const [id, cv] of canvases.current) {
        const d = dims.current.get(id);
        const ctx = cv.getContext('2d');
        if (!d || !ctx) continue;
        ctx.clearRect(0, 0, d.w, d.h);
        drawPreview(id, ctx, d.w, d.h, t);
      }
    };

    measure();
    if (still) {
      // Low-FX draws one honest frame and then leaves the page alone.
      paint(0.5);
      const ro = new ResizeObserver(() => {
        measure();
        paint(0.5);
      });
      if (gridRef.current) ro.observe(gridRef.current);
      return () => ro.disconnect();
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      paint((now - start) / 1000);
    };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(measure);
    if (gridRef.current) ro.observe(gridRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [still]);

  const setCanvas = (id: TestId) => (el: HTMLCanvasElement | null) => {
    if (el) canvases.current.set(id, el);
    else {
      canvases.current.delete(id);
      dims.current.delete(id);
    }
  };

  // The weakest graded test, which is the one worth running next.
  const weakest = useMemo(() => {
    const graded = TEST_LIST.filter((t) => profile.tests[t.id]);
    if (graded.length === 0) return null;
    return graded.reduce((a, b) =>
      (profile.tests[a.id]?.bestRating ?? 0) <= (profile.tests[b.id]?.bestRating ?? 0) ? a : b,
    );
  }, [profile.tests]);

  return (
    <div className="scroll">
      <div className="wrap wide tests fade-up">
        {/* -------------------------------------------------------- header */}
        <header className="tests-head">
          <div className="tests-head-l">
            <div className="eyebrow">Skill tests</div>
            <h1 className="display tests-h1">BENCHMARK</h1>
            <p className="dim tests-lead">
              Twelve instruments, twenty to sixty seconds each. A drill trains a habit and the APM trainer
              measures what your hands can sustain; a test measures one event on a bare field and hands you a
              number. Reaction, prediction, recall, arithmetic under a closing window — the parts of the game
              nobody practises because nobody measures them.
            </p>
            <div className="tests-actions">
              <button className="btn ghost sm" onClick={onBack} onMouseEnter={() => audio.play('uiHover')}>
                ← Back to drills
              </button>
              {weakest && (
                <button
                  className="btn sm"
                  onClick={() => onRun(weakest.id)}
                  onMouseEnter={() => audio.play('uiHover')}
                >
                  Run your weakest: {weakest.name}
                </button>
              )}
            </div>
          </div>

          <div className="tests-score panel">
            <i className="brk tl" />
            <i className="brk tr" />
            <i className="brk bl" />
            <i className="brk br" />
            <RankEmblem tier={benchRank.tier} size={78} />
            <div className="ts-tier display">{attempted > 0 ? benchRank.label : 'UNTESTED'}</div>
            <div className="ts-rating mono">
              {attempted > 0 ? `${Math.round(bench)} BENCHMARK` : 'RUN ANY TEST'}
            </div>
            <div className="ts-meter">
              <span style={{ width: `${Math.round(benchRank.progress * 100)}%` }} />
            </div>
            <div className="ts-sub">
              <span>
                {attempted} / {TEST_LIST.length} tested
              </span>
              {attempted > 0 && <span>top {Math.max(1, Math.round((1 - percentileForRating(bench)) * 100))}%</span>}
            </div>
          </div>
        </header>

        {/* --------------------------------------------------------- groups */}
        <div ref={gridRef}>
          {TEST_GROUPS.map((g) => (
            <section className="tests-group" key={g.id}>
              <div className="tg-head">
                <h2 className="display">{g.title}</h2>
                <span className="faint">{g.blurb}</span>
                <i />
              </div>

              <div className="tests-grid">
                {TEST_LIST.filter((t) => t.group === g.id).map((t) => {
                  const rec = profile.tests[t.id];
                  const rank = rec ? rankFromRating(rec.bestRating) : null;
                  const trend = rec ? rec.history.slice(-14).map((h) => h.rating) : [];
                  return (
                    <button
                      key={t.id}
                      className="tcard"
                      style={{ ['--c' as string]: t.accent }}
                      onMouseEnter={() => audio.play('uiHover')}
                      onClick={() => {
                        audio.unlock();
                        audio.play('uiClick');
                        onRun(t.id);
                      }}
                    >
                      <div className="tc-preview">
                        <canvas ref={setCanvas(t.id)} />
                        <div className="tc-veil" />
                        <div className="tc-run">
                          <span>RUN TEST</span>
                        </div>
                        {rank && (
                          <div className="tc-badge">
                            <RankEmblem tier={rank.tier} size={22} />
                            <span>{rank.label}</span>
                          </div>
                        )}
                        <div className="tc-meta">
                          <span>{t.seconds}s</span>
                          <span>{t.input.includes('keys') ? 'KEYS' : 'MOUSE'}</span>
                        </div>
                      </div>

                      <div className="tc-body">
                        <div className="tc-name display">{t.name}</div>
                        <div className="tc-tag">{t.tagline}</div>
                        <p className="tc-brief">{t.brief}</p>

                        <div className="tc-foot">
                          <div className="tc-best">
                            <span className="eyebrow">{t.primaryLabel}</span>
                            <b className="mono">
                              {rec ? formatTestValue(rec.best, t.primaryFormat) : '—'}
                              <i>{rec ? unitFor(t.primaryFormat).toLowerCase() : ''}</i>
                            </b>
                          </div>
                          {trend.length > 3 ? (
                            <Sparkline values={trend} width={96} height={30} color={t.accent} />
                          ) : (
                            <span className="tc-attempts faint">
                              {rec ? `${rec.attempts} attempt${rec.attempts > 1 ? 's' : ''}` : 'not yet run'}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <p className="tests-disclaimer">
          These grades measure <b>these instruments</b> — one skill each, under controlled conditions, on your
          hardware. A monitor and a mouse are worth real milliseconds here. Compare yourself to your own
          previous runs before you compare yourself to anyone else.
        </p>
      </div>
    </div>
  );
}
