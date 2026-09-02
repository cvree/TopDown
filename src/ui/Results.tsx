import { useEffect, useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { clamp } from '../engine/math';
import { DRILLS, type DrillId } from '../drills/catalog';
import { formatMetric, type ProgressReport, type RunResult } from '../progression/profile';
import { percentileForRating, rankFromRating } from '../progression/ranks';
import { expectedRating } from '../progression/rating';
import { AXIS_LABEL } from '../progression/skills';
import { VAYNE_STAGES } from '../progression/vayne';
import { PathMap, ReactionHistogram, RhythmTimeline, useCountUp } from './components/charts';
import './results.css';

interface Props {
  result: RunResult;
  report: ProgressReport;
  bounds: { w: number; h: number };
  onRetry: () => void;
  onExit: () => void;
  onNext?: () => void;
  nextLabel?: string;
}

const REVEAL = [0, 220, 520, 900, 1250, 1600];

export function Results({ result, report, bounds, onRetry, onExit, onNext, nextLabel }: Props) {
  const meta = DRILLS[result.drill];
  const [stage, setStage] = useState(0);
  const score = useCountUp(result.score, 1100, 150);

  useEffect(() => {
    const timers = REVEAL.map((ms, i) => window.setTimeout(() => setStage(i + 1), ms));
    const pb = window.setTimeout(() => {
      if (report.personalBests.length || report.newBestScore) audio.play('personalBest');
    }, 900);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(pb);
    };
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

  const runRating = expectedRating(result.performance, result.difficulty);
  const topPct = 1 - percentileForRating(runRating);
  const head = result.keyMetrics[0];
  const improvement = report.improvements[0];
  const overallDelta = report.overallAfter - report.overallBefore;

  const outcomeLabel = useMemo(() => {
    if (result.endReason === 'death') return 'ELIMINATED';
    if (result.endReason === 'complete') return 'CLEARED';
    if (result.endReason === 'abort') return 'RESET';
    return 'COMPLETE';
  }, [result.endReason]);

  const pbIds = new Set(report.personalBests.map((p) => p.id));
  // A best that rounds to the same displayed value is still a best, but
  // announcing "82% was 82%" reads as a bug rather than an improvement.
  const visibleBests = report.personalBests.filter(
    (pb) => pb.previous === null || formatMetric(pb.value, pb.format) !== formatMetric(pb.previous, pb.format),
  );

  return (
    <div className="results scroll">
      <div className="results-inner">
        <header className={`res-head ${stage >= 1 ? 'in' : ''}`}>
          <div>
            <div className="eyebrow" style={{ color: meta.accent }}>
              {meta.name} · {outcomeLabel}
            </div>
            <h1 className="display res-score num">{Math.round(score).toLocaleString()}</h1>
            <div className="res-sub">
              <span className="mono">{result.metrics.duration.toFixed(1)}s</span>
              <span className="sep" />
              <span className="mono">DIFFICULTY {Math.round(result.difficulty * 100)}</span>
              <span className="sep" />
              <span className="mono">
                RUN LEVEL {rankFromRating(runRating).label}
              </span>
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

        {(report.newBestScore || visibleBests.length > 0) && stage >= 3 && (
          <div className="pb-strip scale-in">
            <div className="pb-flash" />
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

        <div className={`res-hero ${stage >= 2 ? 'in' : ''}`}>
          <div className="hero-metric">
            <div className="eyebrow">{head?.label ?? meta.keyMetric}</div>
            <div className="hero-value display">{head ? formatMetric(head.value, head.format) : '—'}</div>
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

        <div className={`res-rating ${stage >= 3 ? 'in' : ''}`}>
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

        {report.vayne && (
          <div className={`res-vayne ${stage >= 3 ? 'in' : ''}`}>
            <div className="panel pad">
              <div className="panel-title">The Vayne path</div>
              <div className="rv-grid">
                <div className="rv-stage">
                  <span className="eyebrow">
                    Stage {report.vayne.stage.step} / {VAYNE_STAGES.length} · {report.vayne.stage.title}
                  </span>
                  <div className="rv-stars">
                    {[1, 2, 3].map((n) => (
                      <span key={n} className={n <= report.vayne!.starsAfter ? 'on' : ''}>
                        ★
                      </span>
                    ))}
                    {report.vayne.starsAfter > report.vayne.starsBefore && (
                      <b className="rv-gain">
                        +{report.vayne.starsAfter - report.vayne.starsBefore}
                      </b>
                    )}
                  </div>
                  <div className="rv-best mono">
                    BEST {Math.round(report.vayne.best * 100)}%
                    {report.vayne.improved && report.vayne.previousBest > 0 && (
                      <i className="good"> ▲ from {Math.round(report.vayne.previousBest * 100)}%</i>
                    )}
                    {!report.vayne.improved && <i className="faint"> · this run {Math.round(result.performance * 100)}%</i>}
                  </div>
                </div>

                <div className="rv-mastery">
                  <span className="eyebrow">Mastery</span>
                  <div className="rv-num display">{Math.round(report.vayne.masteryAfter)}</div>
                  {report.vayne.masteryAfter > report.vayne.masteryBefore && (
                    <span className="good mono">
                      +{(report.vayne.masteryAfter - report.vayne.masteryBefore).toFixed(1)}
                    </span>
                  )}
                </div>

                <div className="rv-title">
                  <span className="eyebrow">Title</span>
                  <b className="display">{report.vayne.titleAfter.name}</b>
                  {report.vayne.titleAfter.name !== report.vayne.titleBefore.name && (
                    <span className="rv-new">NEW</span>
                  )}
                  <p>{report.vayne.titleAfter.blurb}</p>
                </div>
              </div>

              {report.vayne.unlocked && (
                <div className="rv-unlock">
                  Cleared. <b>{report.vayne.unlocked.title}</b> is now open — stage{' '}
                  {report.vayne.unlocked.step} of the path.
                </div>
              )}
            </div>
          </div>
        )}

        <div className={`res-viz ${stage >= 4 ? 'in' : ''}`}>
          <div className="panel pad">
            <div className="panel-title">Movement path & cursor density</div>
            <PathMap path={result.metrics.path} cursor={result.metrics.cursorPath} bounds={bounds} width={430} />
            <div className="viz-legend">
              <span>
                <i style={{ background: 'var(--accent)' }} /> path, brightening over time
              </span>
              <span>
                <i style={{ background: 'var(--warn)' }} /> cursor density
              </span>
            </div>
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

        <div className={`res-actions ${stage >= 5 ? 'in' : ''}`}>
          <button className="btn primary lg" onClick={onRetry}>
            Run again <span className="kbd">R</span>
          </button>
          {onNext && (
            <button className="btn lg" onClick={onNext}>
              {nextLabel ?? 'Next'} <span className="kbd">Space</span>
            </button>
          )}
          <button className="btn ghost lg" onClick={onExit}>
            Back <span className="kbd">Esc</span>
          </button>
        </div>
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
