import { LaneReportPanel } from './LaneReportPanel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { clamp } from '../engine/math';
import { DRILLS, type DrillId } from '../drills/catalog';
import { SURVIVE_STRIKES } from '../drills/modes';
import { formatMetric, type ProgressReport, type RunResult } from '../progression/profile';
import { percentileForRating, rankFromRating } from '../progression/ranks';
import { expectedRating } from '../progression/rating';
import { AXIS_LABEL } from '../progression/skills';
import { APM_LEVELS, CLEAR_AT } from '../progression/apm';
import { laneTierOf } from '../progression/lane';
import { TWISTED_STAGES } from '../progression/twistedfate';
import { KATARINA_STAGES } from '../progression/katarina';
import { VAYNE_STAGES } from '../progression/vayne';
import { WASD_MODULES } from '../progression/wasd';
import { ReactionHistogram, RhythmTimeline, useCountUp } from './components/charts';
import { Replay } from './Replay';
import { isCalm } from './motion';
import './results.css';

/** mm:ss, for how long a survive run lasted. */
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface Props {
  result: RunResult;
  report: ProgressReport;
  bounds: { w: number; h: number };
  onRetry: () => void;
  onExit: () => void;
  onNext?: () => void;
  nextLabel?: string;
  /**
   * The run's scenario code, or null for a run that cannot have one. Printed
   * so a minute worth sending to somebody is one copy away from being sent.
   */
  code?: string | null;
  /** A line of context above the buttons: which warm-up step, which benchmark. */
  banner?: { eyebrow: string; line: string; tone?: 'good' | 'warn' } | null;
  /** This drill's score the run before this one, for the line under the number. */
  lastScore?: number | null;
}

/** The count-up of the number, and when it starts. Everything else is timed off these. */
const COUNT_MS = 1100;
const COUNT_DELAY = 140;

/** Whether the evidence was left open last time — a per-viewer convenience, nothing more. */
const EVIDENCE_KEY = 'apex.results.evidence';
const readOpen = (): boolean => {
  try {
    return localStorage.getItem(EVIDENCE_KEY) === '1';
  } catch {
    return false;
  }
};
const writeOpen = (v: boolean): void => {
  try {
    localStorage.setItem(EVIDENCE_KEY, v ? '1' : '0');
  } catch {
    /* private window: it simply starts folded */
  }
};

/**
 * When an ease-out count reaches `r` of its way, as a fraction of its time —
 * the inverse of `easeOut`. It is how the personal-best line is struck on the
 * frame the rolling number passes the old record, not a beat before or after.
 */
const crossing = (r: number): number => 1 - Math.pow(1 - clamp(r, 0, 1), 1 / 4);

/**
 * THE RESULTS SCREEN, in three acts.
 *
 * It used to be up to nineteen panels arriving on a timer, and the one number
 * that mattered competed with eighteen others. Now it is a ceremony:
 *
 *  1. **The number.** The score rolls up, fast and then gently; if it beats
 *     your best, a line is drawn through the old record on the frame the
 *     count passes it, with the chime; under it, what it was against your last
 *     run.
 *  2. **The verdict.** One sentence, the one thing that held the run back,
 *     where the rating went, and one button.
 *  3. **The evidence.** Everything else — every panel this screen has ever
 *     shown, nothing deleted — folded behind one disclosure.
 *
 * Space, R and Escape work from the first frame; nothing waits on the show.
 */
export function Results({ result, report, bounds, onRetry, onExit, onNext, nextLabel, code, banner, lastScore = null }: Props) {
  const [copied, setCopied] = useState(false);
  const meta = DRILLS[result.drill];
  const [act, setAct] = useState(isCalm() ? 3 : 0);
  const [struck, setStruck] = useState(false);
  const [open, setOpen] = useState(readOpen);
  const evidenceRef = useRef<HTMLDivElement>(null);
  const score = useCountUp(result.score, COUNT_MS, COUNT_DELAY);
  const prevBest = report.previousBestScore;
  const pbIds = new Set(report.personalBests.map((p) => p.id));
  // A best that rounds to the same displayed value is still a best, but
  // announcing "82% was 82%" reads as a bug rather than an improvement.
  const visibleBests = report.personalBests.filter(
    (pb) => pb.previous === null || formatMetric(pb.value, pb.format) !== formatMetric(pb.previous, pb.format),
  );
  const anyBest = report.newBestScore || visibleBests.length > 0;

  useEffect(() => {
    const calm = isCalm();
    // Sound and motion land together: the reveal swell under the number, and
    // the chime on the frame the old record is struck through.
    const at = (ms: number, fn: () => void) => window.setTimeout(fn, calm ? 0 : ms);
    const strikeAt =
      report.newBestScore && prevBest && result.score > 0
        ? COUNT_DELAY + COUNT_MS * crossing(prevBest / result.score)
        : COUNT_DELAY + COUNT_MS * 0.82;
    const t = [
      at(0, () => setAct((a) => Math.max(a, 1))),
      at(30, () => audio.play('resultsReveal')),
      at(clamp(strikeAt, 420, COUNT_DELAY + COUNT_MS), () => {
        if (!anyBest) return;
        setStruck(true);
        audio.play('personalBest');
      }),
      at(COUNT_DELAY + COUNT_MS + 40, () => setAct((a) => Math.max(a, 2))),
      at(COUNT_DELAY + COUNT_MS + 360, () => setAct(3)),
    ];
    return () => t.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'KeyR' || e.code === 'Backquote') {
        e.preventDefault();
        onRetry();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        onExit();
      } else if (e.code === 'Space' && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRetry, onExit, onNext]);

  const toggleEvidence = () => {
    const next = !open;
    setOpen(next);
    writeOpen(next);
    audio.play(next ? 'uiTab' : 'uiBack');
    // Opening it moves you to it: the click is the cause, the panels arriving
    // where you are looking is the result.
    if (next) {
      window.requestAnimationFrame(() =>
        evidenceRef.current?.scrollIntoView({ behavior: isCalm() ? 'auto' : 'smooth', block: 'start' }),
      );
    }
  };

  const runRating = expectedRating(result.performance, result.difficulty);
  const topPct = 1 - percentileForRating(runRating);
  const head = result.keyMetrics[0];
  const improvement = report.improvements[0];
  const overallDelta = report.overallAfter - report.overallBefore;
  const vsLast = lastScore === null ? null : result.score - lastScore;
  // One thing that held the run back: the detector's limiter, in its own words
  // with this run's numbers in it; failing that, the worst line of the read.
  const limiter = report.limiter?.detail ?? result.hurt[0] ?? null;

  const outcomeLabel = useMemo(() => {
    // A survive run always ends the same way, so "ELIMINATED" is not news; how
    // long it took to eliminate you is the entire result.
    if (result.mode === 'survive') return `SURVIVED ${clock(result.seconds)}`;
    if (result.endReason === 'death') return 'ELIMINATED';
    if (result.endReason === 'complete') return 'CLEARED';
    if (result.endReason === 'abort') return 'RESET';
    return 'COMPLETE';
  }, [result.endReason, result.mode, result.seconds]);

  const shown = open;

  return (
    <div className="results scroll">
      <div className="results-inner">
        {/* ------------------------------------------------ act one: the number */}
        <header className={`res-number${act >= 1 ? ' in' : ''}`}>
          <div className="eyebrow" style={{ color: meta.accent }}>
            {meta.name} · {outcomeLabel}
          </div>
          <h1 className="display res-score num">{Math.round(score).toLocaleString()}</h1>
          <div className="res-line">
            {prevBest !== null && (
              <span className={`res-best${struck && report.newBestScore ? ' struck' : ''}`}>
                <span className="res-best-old">
                  BEST <b className="mono">{prevBest.toLocaleString()}</b>
                  <i className="res-best-rule" aria-hidden />
                </span>
                {report.newBestScore && <em className="res-best-new">NEW BEST</em>}
              </span>
            )}
            {prevBest === null && <span className="res-best first">FIRST RUN</span>}
            {vsLast !== null && (
              <span className={`res-vs ${vsLast > 0 ? 'up' : vsLast < 0 ? 'down' : ''}`}>
                {vsLast === 0 ? 'level with' : `${vsLast > 0 ? '+' : '−'}${Math.abs(vsLast).toLocaleString()} on`} your last run
              </span>
            )}
          </div>
        </header>

        {/* ----------------------------------------------- act two: the verdict */}
        <section className={`res-verdict${act >= 2 ? ' in' : ''}`}>
          <div className="rvd-metric">
            <div className="eyebrow">{head?.label ?? meta.keyMetric}</div>
            <div className="rvd-value display">{head ? formatMetric(head.value, head.format) : '—'}</div>
            {improvement &&
              (() => {
                const same =
                  formatMetric(improvement.current, improvement.format) ===
                  formatMetric(improvement.previous, improvement.format);
                const better =
                  improvement.direction === 'higher'
                    ? improvement.current > improvement.previous
                    : improvement.current < improvement.previous;
                return (
                  <div className={`hero-delta ${same ? '' : better ? 'up' : 'down'}`}>
                    {same
                      ? `held at ${formatMetric(improvement.previous, improvement.format)} from last run`
                      : `${better ? '▲' : '▼'} from ${formatMetric(improvement.previous, improvement.format)} last run`}
                  </div>
                );
              })()}
          </div>
          <div className="rvd-words">
            <p className="rvd-sentence">{result.advice}</p>
            {limiter && (
              <p className="rvd-limiter">
                <span className="eyebrow">Held it back</span>
                {limiter}
              </p>
            )}
            <div className="rvd-rating mono">
              <b>{report.rankAfter.label}</b> · {Math.round(report.overallAfter)} rating{' '}
              <span className={overallDelta >= 0 ? 'good' : 'bad'}>
                {overallDelta >= 0 ? '+' : '−'}
                {Math.abs(Math.round(overallDelta))}
              </span>
            </div>
          </div>
        </section>

        {banner && (
          <div className={`res-context${act >= 2 ? ' in' : ''}`}>
            <div className={`res-banner${banner.tone ? ` ${banner.tone}` : ''}`}>
              <span className="eyebrow">{banner.eyebrow}</span>
              <b>{banner.line}</b>
            </div>
          </div>
        )}

        <div className={`res-actions${act >= 2 ? ' in' : ''}`}>
          <button className="btn primary lg" onClick={onRetry}>
            Run again <span className="kbd">R</span>
          </button>
          {onNext && (
            <button className="btn ghost lg" onClick={onNext}>
              {nextLabel ?? 'Next'} <span className="kbd">Space</span>
            </button>
          )}
          <button className="btn ghost lg" onClick={onExit}>
            Back <span className="kbd">Esc</span>
          </button>
        </div>

        {/* --------------------------------------------- act three: the evidence */}
        <button
          type="button"
          className={`res-why${act >= 3 ? ' in' : ''}${open ? ' open' : ''}`}
          aria-expanded={open}
          onClick={toggleEvidence}
        >
          <span className="res-why-mark" aria-hidden>
            ?
          </span>
          <span>{open ? 'Fold the evidence away' : 'Why — the evidence'}</span>
        </button>

        <div ref={evidenceRef} className={`res-evidence${open ? ' open' : ''}`} hidden={!open}>
        <header className={`res-head ${shown ? 'in' : ''}`}>
          <div>
            <div className="eyebrow">The run</div>
            <div className="res-sub">
              <span className="mono">{result.metrics.duration.toFixed(1)}s</span>
              {result.mode === 'survive' && (
                <>
                  <span className="sep" />
                  <span className="mono">
                    {result.strikes} / {SURVIVE_STRIKES} STRIKES
                  </span>
                </>
              )}
              <span className="sep" />
              <span className="mono">DIFFICULTY {Math.round(result.difficulty * 100)}</span>
              <span className="sep" />
              <span className="mono">RUN LEVEL {rankFromRating(runRating).label}</span>
            </div>
          </div>

          <div className="res-top-badge">
            <div className="eyebrow">THIS RUN</div>
            {topPct <= 0.5 ? (
              <>
                <div className="res-top-num display">TOP {topPct < 0.01 ? '<1' : Math.round(topPct * 100)}%</div>
                <div className="faint" style={{ fontSize: 11 }}>
                  of trainer performances
                </div>
              </>
            ) : (
              <>
                <div className="res-top-num display" style={{ color: 'var(--text-2)' }}>
                  {ordinal(Math.max(1, Math.round((1 - topPct) * 100)))}
                </div>
                <div className="faint" style={{ fontSize: 11 }}>
                  percentile · room to climb
                </div>
              </>
            )}
          </div>
        </header>

        {anyBest && (
          <div className="pb-strip">
            <span className="pb-tag">NEW BEST</span>
            <div className="pb-items">
              {report.newBestScore && (
                <span>
                  SCORE <b>{result.score.toLocaleString()}</b>
                  {report.previousBestScore !== null && (
                    <i> was {report.previousBestScore.toLocaleString()}</i>
                  )}
                </span>
              )}
              {visibleBests.slice(0, 3).map((pb) => (
                <span key={pb.id}>
                  {pb.label} <b>{formatMetric(pb.value, pb.format)}</b>
                  {pb.previous !== null && <i> was {formatMetric(pb.previous, pb.format)}</i>}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={`res-hero ${shown ? 'in' : ''}`}>
          <div className="metric-grid">
            {result.keyMetrics.slice(1, 5).map((m) => (
              <div className={`metric-cell ${pbIds.has(m.id) ? 'pb' : ''}`} key={m.id}>
                <div className="eyebrow">{m.label}</div>
                <div className="metric-value display">{formatMetric(m.value, m.format)}</div>
                {pbIds.has(m.id) && <span className="pb-dot">BEST</span>}
              </div>
            ))}
          </div>
        </div>

        <div className={`res-rating ${shown ? 'in' : ''}`}>
          <div className="panel pad rating-panel">
            <div className="panel-title">Mechanical rating</div>
            <div className="rating-rows">
              {report.axisChanges.map((c) => (
                <div className="rating-row" key={c.axis}>
                  <div className="rr-name">{AXIS_LABEL[c.axis]}</div>
                  <div className="rr-bar">
                    <span style={{ width: `${clamp(c.after / 3600, 0.01, 1) * 100}%` }} />
                    <i
                      style={{
                        left: `${clamp(Math.min(c.before, c.after) / 3600, 0, 1) * 100}%`,
                        width: `${(Math.abs(c.delta) / 3600) * 100}%`,
                        background: c.delta >= 0 ? 'var(--good)' : 'var(--danger)',
                      }}
                    />
                  </div>
                  <div className="rr-rank">{c.rankAfter.label}</div>
                  <div className={`rr-delta ${c.delta >= 0 ? 'up' : 'down'}`}>
                    {c.delta >= 0 ? '+' : ''}
                    {Math.round(c.delta)}
                  </div>
                  <div className="rr-promo-slot">
                    {c.promoted && Math.round(c.delta) >= 1 && <span className="rr-promo">RANK UP</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="divider" />

            <div className="row between" style={{ alignItems: 'flex-end', gap: 20 }}>
              <div>
                <div className="eyebrow">OVERALL</div>
                <div className="display" style={{ fontSize: 26, letterSpacing: '0.1em' }}>
                  {report.rankAfter.label}
                </div>
                <div className="faint mono" style={{ fontSize: 12, marginTop: 2 }}>
                  {Math.round(report.overallAfter)} rating
                  <span className={overallDelta >= 0 ? 'good' : 'bad'} style={{ marginLeft: 8 }}>
                    {overallDelta >= 0 ? '+' : ''}
                    {Math.round(overallDelta)}
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, maxWidth: 340 }}>
                <div className="rank-progress">
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <span className="eyebrow">{report.rankAfter.label}</span>
                    <span className="mono faint" style={{ fontSize: 11 }}>
                      {report.rankAfter.nextAt
                        ? `${Math.max(0, Math.round(report.rankAfter.nextAt - report.overallAfter))} to next`
                        : 'PEAK'}
                    </span>
                  </div>
                  <div className="rp-track">
                    <span style={{ width: `${clamp(report.rankAfter.progress, 0, 1) * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>

            {report.difficultyAfter !== report.difficultyBefore && (
              <div className="diff-note">
                Difficulty {report.difficultyAfter > report.difficultyBefore ? 'raised' : 'eased'} to{' '}
                <b>{Math.round(report.difficultyAfter * 100)}</b> for your next {meta.name.toLowerCase()} run.
              </div>
            )}
          </div>

          <div className="panel pad read-panel">
            <div className="panel-title">The read</div>
            {result.helped.length > 0 && (
              <div className="read-block">
                <div className="read-label good">WHAT WORKED</div>
                {result.helped.map((h, i) => (
                  <div className="read-line" key={i}>
                    {h}
                  </div>
                ))}
              </div>
            )}
            {result.hurt.length > 0 && (
              <div className="read-block">
                <div className="read-label bad">WHAT COST YOU</div>
                {result.hurt.map((h, i) => (
                  <div className="read-line" key={i}>
                    {h}
                  </div>
                ))}
              </div>
            )}
            <div className="advice">
              <div className="read-label" style={{ color: 'var(--accent)' }}>
                DO THIS NEXT
              </div>
              <div className="advice-text">{result.advice}</div>
            </div>
          </div>
        </div>

        {report.lane && (
          <div className={`res-vayne ${shown ? 'in' : ''}`}>
            <div className="panel pad">
              <div className="panel-title">The lane, against {laneTierOf(result.difficulty).label}</div>
              <div className="rv-grid">
                <div className="rv-stage">
                  <span className="eyebrow">Best CS a minute</span>
                  <div className="rv-num display">{report.lane.bestCsPerMin.toFixed(1)}</div>
                  <div className="rv-best mono">
                    THIS OPPONENT FARMS {laneTierOf(result.difficulty).expect.toFixed(1)}
                  </div>
                </div>
                <div className="rv-mastery">
                  <span className="eyebrow">Lanes played</span>
                  <div className="rv-num display">{report.lane.runs}</div>
                  <span className="mono">{report.lane.wins} won on gold</span>
                </div>
                <div className="rv-title">
                  <span className="eyebrow">Best CS difference</span>
                  <b className="display">
                    {report.lane.bestCsLead > -900
                      ? `${report.lane.bestCsLead > 0 ? '+' : ''}${Math.round(report.lane.bestCsLead)}`
                      : '—'}
                  </b>
                  <p>
                    A lane is a comparison rather than a score: the creep score difference is
                    what a coach would look at first, and it is the only number here that
                    already has the opponent in it.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Four ladders, one panel.
            The champion paths and the academy report the same three facts —
            where you stand on the ladder, what mastery did, and what opened —
            because they are the same kind of progress and a player who has
            learned to read one has learned to read all of them. They used to
            be three copies of the same forty lines, which is how two of them
            came to have subtly different wording for the same event. */}
        <LadderPanel
          shown={shown}
          label="The Vayne path"
          noun="Stage"
          total={VAYNE_STAGES.length}
          runPerformance={result.performance}
          report={
            report.vayne && {
              ...report.vayne,
              step: report.vayne.stage.step,
              name: report.vayne.stage.title,
              unlocked: report.vayne.unlocked && {
                step: report.vayne.unlocked.step,
                title: report.vayne.unlocked.title,
              },
            }
          }
        />

        <LadderPanel
          shown={shown}
          label="The card path"
          noun="Stage"
          total={TWISTED_STAGES.length}
          className="res-twisted"
          runPerformance={result.performance}
          report={
            report.twisted && {
              ...report.twisted,
              step: report.twisted.stage.step,
              name: report.twisted.stage.title,
              unlocked: report.twisted.unlocked && {
                step: report.twisted.unlocked.step,
                title: report.twisted.unlocked.title,
              },
            }
          }
        />

        <LadderPanel
          shown={shown}
          label="The dagger path"
          noun="Stage"
          total={KATARINA_STAGES.length}
          className="res-katarina"
          runPerformance={result.performance}
          report={
            report.katarina && {
              ...report.katarina,
              step: report.katarina.stage.step,
              name: report.katarina.stage.title,
              unlocked: report.katarina.unlocked && {
                step: report.katarina.unlocked.step,
                title: report.katarina.unlocked.title,
              },
            }
          }
        />

        <LadderPanel
          shown={shown}
          label="The WASD academy"
          noun="Module"
          total={WASD_MODULES.length}
          className="res-wasd"
          runPerformance={result.performance}
          report={
            report.wasd && {
              ...report.wasd,
              step: report.wasd.module.step,
              name: report.wasd.module.title,
              unlocked: report.wasd.unlocked && {
                step: report.wasd.unlocked.step,
                title: report.wasd.unlocked.title,
              },
            }
          }
        />

        {report.apm?.infinite && (
          <div className={`res-apm ${shown ? 'in' : ''}`}>
            <div className="panel pad">
              <div className="panel-title">The tide</div>
              <div className="ra-grid">
                <div className="ra-level">
                  <span className="eyebrow">
                    Opened on level {report.apm.infinite.opened} · {Math.round(report.apm.infinite.seconds)}s
                  </span>
                  <div className="ra-num display">{report.apm.infinite.held.toFixed(1)}</div>
                  <div className="ra-best mono">
                    LEVEL HELD
                    {report.apm.infinite.heldRecord ? (
                      <i className="good"> · BEST EVER</i>
                    ) : (
                      report.apm.infinite.previousHeld > 0 && (
                        <i className="faint"> · best {report.apm.infinite.previousHeld.toFixed(1)}</i>
                      )
                    )}
                  </div>
                </div>

                <div className="ra-rate">
                  <span className="eyebrow">Reached</span>
                  <div className="ra-num display">{report.apm.infinite.peak.toFixed(1)}</div>
                  <span className={report.apm.infinite.peakRecord ? 'good mono' : 'faint mono'}>
                    {report.apm.infinite.peakRecord
                      ? 'HIGHEST LEVEL YET'
                      : `fell to ${report.apm.infinite.low.toFixed(1)}`}
                  </span>
                </div>

                <div className="ra-title">
                  <span className="eyebrow">Correct actions / min</span>
                  <b className="display">{Math.round(report.apm.apm)}</b>
                  <p>
                    {report.apm.apmRecord ? 'RATE RECORD' : `best ${Math.round(report.apm.bestApm)}`}
                    {report.apm.infinite.longest && <span className="ra-new">LONGEST</span>}
                  </p>
                </div>
              </div>

              {report.apm.infinite.unlockedTo !== null ? (
                <div className="ra-unlock">
                  You held it, so <b>level {report.apm.infinite.unlockedTo}</b> is where this
                  drill will open from now on. No star for it — stars are for beating a level, and
                  this was standing on one.
                </div>
              ) : (
                <div className="ra-unlock quiet">
                  {`It settled at level ${report.apm.infinite.held.toFixed(1)}. That is the one to play for a score — the hardest one you can still keep clean.`}
                </div>
              )}
            </div>
          </div>
        )}

        {report.apm?.surge && (
          <div className={`res-apm ${shown ? 'in' : ''}`}>
            <div className="panel pad">
              <div className="panel-title">The surge</div>
              <div className="ra-grid">
                <div className="ra-level">
                  <span className="eyebrow">Opened on level {report.apm.surge.opened}</span>
                  <div className="ra-num display">
                    +{report.apm.surge.peak.toFixed(1)}
                  </div>
                  <div className="ra-best mono">
                    LEVELS YOUR STREAK ADDED
                    {report.apm.surge.peakRecord ? (
                      <i className="good"> · BEST EVER</i>
                    ) : (
                      report.apm.surge.previousPeak > 0 && (
                        <i className="faint"> · best +{report.apm.surge.previousPeak.toFixed(1)}</i>
                      )
                    )}
                  </div>
                </div>

                <div className="ra-rate">
                  <span className="eyebrow">Longest streak</span>
                  <div className="ra-num display">{report.apm.surge.chain}</div>
                  <span className={report.apm.surge.scoreRecord ? 'good mono' : 'faint mono'}>
                    {report.apm.surge.scoreRecord ? 'SCORE RECORD IN SURGE' : 'your streak sets the difficulty'}
                  </span>
                </div>

                <div className="ra-title">
                  <span className="eyebrow">Correct actions / min</span>
                  <b className="display">{Math.round(report.apm.apm)}</b>
                  <p>{report.apm.apmRecord ? 'RATE RECORD' : `best ${Math.round(report.apm.bestApm)}`}</p>
                </div>
              </div>

              <div className="ra-unlock quiet">
SURGE keeps its own record. The difficulty moved while you played, so this does
                not count as a run at level {report.apm.surge.opened} — play that level in PLAY,
                where it holds still, to put a score on the board.
              </div>
            </div>
          </div>
        )}

        {report.apm && !report.apm.infinite && !report.apm.surge && (
          <div className={`res-apm ${shown ? 'in' : ''}`}>
            <div className="panel pad">
              <div className="panel-title">Your level</div>
              <div className="ra-grid">
                <div className="ra-level">
                  <span className="eyebrow">
                    Level {report.apm.level} of {APM_LEVELS}
                    {report.apm.endurance && ' · endurance run'}
                  </span>
                  <div className="ra-stars">
                    {[1, 2, 3].map((n) => (
                      <span key={n} className={n <= report.apm!.starsAfter ? 'on' : ''}>
                        ★
                      </span>
                    ))}
                    {report.apm.starsAfter > report.apm.starsBefore && (
                      <b className="ra-gain">+{report.apm.starsAfter - report.apm.starsBefore}</b>
                    )}
                  </div>
                  <div className="ra-best mono">
                    BEST {Math.round(report.apm.best * 100)}%
                    {report.apm.best > report.apm.previousBest && report.apm.previousBest > 0 && (
                      <i className="good"> ▲ from {Math.round(report.apm.previousBest * 100)}%</i>
                    )}
                    {report.apm.best <= report.apm.previousBest && (
                      <i className="faint"> · this run {Math.round(result.performance * 100)}%</i>
                    )}
                  </div>
                </div>

                <div className="ra-rate">
                  <span className="eyebrow">Correct actions / min</span>
                  <div className="ra-num display">{Math.round(report.apm.apm)}</div>
                  {report.apm.apmRecord ? (
                    <span className="good mono">RATE RECORD ON THIS LEVEL</span>
                  ) : (
                    <span className="faint mono">best here {Math.round(report.apm.bestApm)}</span>
                  )}
                </div>

                <div className="ra-title">
                  <span className="eyebrow">Mastery</span>
                  <b className="display">
                    {Math.round(report.apm.masteryAfter)}
                    {report.apm.masteryAfter > report.apm.masteryBefore && (
                      <em className="good mono">
                        {' '}
                        +{(report.apm.masteryAfter - report.apm.masteryBefore).toFixed(1)}
                      </em>
                    )}
                  </b>
                  <p>
                    {report.apm.titleAfter.name}
                    {report.apm.titleAfter.name !== report.apm.titleBefore.name && (
                      <span className="ra-new">NEW</span>
                    )}
                  </p>
                </div>
              </div>

              {report.apm.unlockedTo !== null ? (
                <div className="ra-unlock">
                  {report.apm.skipped ? 'Beaten outright.' : 'Beaten.'} This drill opens on{' '}
                  <b>level {report.apm.unlockedTo}</b> next
                  {report.apm.skipped && ' — two levels up, because this one had nothing left to teach you'}
                  . Every other level is still one click away.
                </div>
              ) : (
                <div className="ra-unlock quiet">
                  {report.apm.cleared
                    ? `Level ${report.apm.level} is still beaten. Try level ${report.apm.nextLevel} next.`
                    : `${Math.round((CLEAR_AT - result.performance) * 100)} points short of beating level ${report.apm.level}.`}
                </div>
              )}
            </div>
          </div>
        )}

        {result.lane && <LaneReportPanel report={result.lane} visible={shown} />}

        <div className={`res-viz ${shown ? 'in' : ''}`}>
          <div className="panel pad">
            <div className="panel-title">Replay</div>
            <Replay
              metrics={result.metrics}
              bounds={bounds}
              accent={meta.accent}
              ghost={report.ghost}
              score={result.score}
            />
          </div>

          <div className="panel pad" style={{ flex: 1 }}>
            <div className="panel-title">Attack rhythm</div>
            <RhythmTimeline
              marks={result.metrics.timeline}
              duration={Math.max(1, result.metrics.duration)}
              width={560}
            />
            <div className="viz-legend">
              <span>
                <i style={{ background: '#eafcff' }} /> attack landed
              </span>
              <span>
                <i style={{ background: '#ff5f7e' }} /> cancelled
              </span>
              <span>
                <i style={{ background: 'rgba(92,225,168,.7)' }} /> move command
              </span>
              <span>
                <i style={{ background: '#ffcf6b' }} /> kill
              </span>
            </div>

            {result.metrics.reactionTimes.length > 2 && (
              <>
                <div className="panel-title" style={{ marginTop: 22 }}>
                  Reaction distribution
                </div>
                <ReactionHistogram values={result.metrics.reactionTimes} width={520} height={86} />
              </>
            )}
          </div>
        </div>

        {code && (
          <div className="res-context in">
            <button
              type="button"
              className="res-code"
              title="Copy this scenario code — the same start for anybody who pastes it on HOME"
              onClick={() => {
                void navigator.clipboard?.writeText(code).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
                audio.play('uiClick');
              }}
            >
              <span className="eyebrow">{copied ? 'Copied' : 'Scenario code'}</span>
              <code className="mono">{code}</code>
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/**
 * A LADDER, REPORTED.
 *
 * Three things in this client keep a ladder — the Vayne path, the card path
 * and the WASD academy — and all three want to say the same three sentences
 * after a run: *here is where you stand on it*, *here is what your mastery
 * did*, and *here is what that opened*. They were three copies of this markup
 * for a while, and the cost showed up exactly where duplication always does:
 * two of them drifted into different wording for the same event.
 *
 * The shapes they report are already identical, so the only adaptation any
 * caller does is naming its step — a stage, or a module — and handing over the
 * numbers. A null report draws nothing, which is what lets a caller pass its
 * report straight through without a guard of its own.
 */
interface LadderView {
  step: number;
  name: string;
  starsBefore: number;
  starsAfter: number;
  best: number;
  previousBest: number;
  improved: boolean;
  masteryBefore: number;
  masteryAfter: number;
  titleBefore: { name: string };
  titleAfter: { name: string; blurb: string };
  unlocked: { step: number; title: string } | null | undefined;
}

function LadderPanel({
  report,
  label,
  noun,
  total,
  shown,
  runPerformance,
  className,
}: {
  report: LadderView | null | undefined;
  /** The panel's own heading. */
  label: string;
  /** What one rung of this ladder is called, capitalised. */
  noun: string;
  total: number;
  shown: boolean;
  /** This run, for the line that says what it was worth against your best. */
  runPerformance: number;
  className?: string;
}) {
  if (!report) return null;
  return (
    <div className={`res-vayne${className ? ` ${className}` : ''} ${shown ? 'in' : ''}`}>
      <div className="panel pad">
        <div className="panel-title">{label}</div>
        <div className="rv-grid">
          <div className="rv-stage">
            <span className="eyebrow">
              {noun} {report.step} / {total} · {report.name}
            </span>
            <div className="rv-stars">
              {[1, 2, 3].map((n) => (
                <span key={n} className={n <= report.starsAfter ? 'on' : ''}>
                  ★
                </span>
              ))}
              {report.starsAfter > report.starsBefore && (
                <b className="rv-gain">+{report.starsAfter - report.starsBefore}</b>
              )}
            </div>
            <div className="rv-best mono">
              BEST {Math.round(report.best * 100)}%
              {report.improved && report.previousBest > 0 && (
                <i className="good"> ▲ from {Math.round(report.previousBest * 100)}%</i>
              )}
              {!report.improved && <i className="faint"> · this run {Math.round(runPerformance * 100)}%</i>}
            </div>
          </div>

          <div className="rv-mastery">
            <span className="eyebrow">Mastery</span>
            <div className="rv-num display">{Math.round(report.masteryAfter)}</div>
            {report.masteryAfter > report.masteryBefore && (
              <span className="good mono">+{(report.masteryAfter - report.masteryBefore).toFixed(1)}</span>
            )}
          </div>

          <div className="rv-title">
            <span className="eyebrow">Title</span>
            <b className="display">{report.titleAfter.name}</b>
            {report.titleAfter.name !== report.titleBefore.name && <span className="rv-new">NEW</span>}
            <p>{report.titleAfter.blurb}</p>
          </div>
        </div>

        {report.unlocked && (
          <div className="rv-unlock">
            Cleared. <b>{report.unlocked.title}</b> is now open — {noun.toLowerCase()}{' '}
            {report.unlocked.step} of {total}.
          </div>
        )}
      </div>
    </div>
  );
}

export const drillLabel = (id: DrillId): string => DRILLS[id].name;

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};
