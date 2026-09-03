import { useEffect, useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { clamp } from '../engine/math';
import { DRILLS, type DrillId } from '../drills/catalog';
import { formatMetric, type ProgressReport, type RunResult } from '../progression/profile';
import { AXIS_LABEL } from '../progression/skills';
import { APM_LEVELS, CLEAR_AT } from '../progression/apm';
import { VAYNE_STAGES } from '../progression/vayne';
import { WASD_MODULES } from '../progression/wasd';
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

/**
 * RESULTS.
 *
 * A coach, not a report. The screen used to be eight stacked panels and a
 * scroll: a percentile badge, a five-row rating table, a two-column read, a
 * per-track progression card, a path map, a rhythm timeline and a reaction
 * histogram — roughly forty numbers, arriving in six timed waves, for a
 * forty-five second drill.
 *
 * Every one of those numbers is still here. What changed is that four of them
 * are on the first screen and the rest are behind one button, because the
 * question a player has when a run ends is not "what were all my figures", it
 * is:
 *
 *   how did I do?          — the score, and whether it beat you.
 *   what specifically?     — three metrics, named.
 *   what went wrong?       — one error, in a sentence, not a list.
 *   what now?              — one button.
 *
 * The reveal is two beats rather than six. Six was a wait dressed as drama.
 */
export function Results({ result, report, bounds, onRetry, onExit, onNext, nextLabel }: Props) {
  const meta = DRILLS[result.drill];
  const [stage, setStage] = useState(0);
  const [detail, setDetail] = useState(false);
  const score = useCountUp(result.score, 900, 120);

  useEffect(() => {
    const timers = [0, 320].map((ms, i) => window.setTimeout(() => setStage(i + 1), ms));
    const pb = window.setTimeout(() => {
      if (report.personalBests.length || report.newBestScore) audio.play('personalBest');
    }, 700);
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
      } else if (e.code === 'KeyD') {
        e.preventDefault();
        setDetail((d) => !d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRetry, onExit, onNext]);

  const outcome =
    result.endReason === 'death'
      ? 'ELIMINATED'
      : result.endReason === 'complete'
        ? 'CLEARED'
        : result.endReason === 'abort'
          ? 'RESET'
          : 'COMPLETE';

  // A best that rounds to the same displayed value is still a best, but
  // announcing "82% was 82%" reads as a bug rather than an improvement.
  const visibleBests = report.personalBests.filter(
    (pb) => pb.previous === null || formatMetric(pb.value, pb.format) !== formatMetric(pb.previous, pb.format),
  );
  const pbIds = new Set(report.personalBests.map((p) => p.id));
  const scoreBest = report.newBestScore && report.previousBestScore !== null ? report.previousBestScore : null;

  const overallDelta = report.overallAfter - report.overallBefore;
  const driver = useMemo(
    () =>
      report.axisChanges.reduce<(typeof report.axisChanges)[number] | null>(
        (acc, c) => (!acc || Math.abs(c.delta) > Math.abs(acc.delta) ? c : acc),
        null,
      ),
    [report.axisChanges],
  );

  // The one thing that cost the run. The engine already ranks `hurt`, so the
  // first entry is the primary error; the rest are detail, not headline.
  const primaryError = result.hurt[0] ?? null;
  const track = trackLine(report);

  return (
    <div className="results scroll">
      <div className="res-inner">
        {/* ------------------------------------------------------ the verdict */}
        <header className={`res-head${stage >= 1 ? ' in' : ''}`}>
          <div className="eyebrow" style={{ color: meta.accent }}>
            {meta.name} · {outcome}
          </div>
          <h1 className="res-score display">{Math.round(score).toLocaleString()}</h1>

          {report.newBestScore || visibleBests.length > 0 ? (
            <div className="res-pb">
              <span className="res-pb-tag">New personal best</span>
              {scoreBest !== null ? (
                <span className="res-pb-move mono">
                  {scoreBest.toLocaleString()} <i>→</i> {result.score.toLocaleString()}
                  <em className="good">+{(result.score - scoreBest).toLocaleString()}</em>
                </span>
              ) : (
                visibleBests[0] && (
                  <span className="res-pb-move mono">
                    {visibleBests[0].label} {formatMetric(visibleBests[0].value, visibleBests[0].format)}
                    {visibleBests[0].previous !== null && (
                      <i> was {formatMetric(visibleBests[0].previous, visibleBests[0].format)}</i>
                    )}
                  </span>
                )
              )}
            </div>
          ) : (
            <div className="res-pb quiet">
              <span className="res-pb-move mono">
                {report.previousBestScore !== null
                  ? `Your best is ${report.previousBestScore.toLocaleString()}`
                  : 'First run on this drill'}
              </span>
            </div>
          )}
        </header>

        {/* ------------------------------------------------------ the numbers */}
        <div className={`res-metrics${stage >= 1 ? ' in' : ''}`}>
          {result.keyMetrics.slice(0, 4).map((m) => (
            <div className={`stat${pbIds.has(m.id) ? ' pb' : ''}`} key={m.id}>
              <span className="stat-k">{m.label}</span>
              <span className="stat-v">{formatMetric(m.value, m.format)}</span>
              {pbIds.has(m.id) && <span className="stat-s good">best</span>}
            </div>
          ))}
        </div>

        {/* -------------------------------------------------------- the read */}
        <div className={`res-read${stage >= 2 ? ' in' : ''}`}>
          <section className="res-error">
            <span className="eyebrow">{primaryError ? 'Primary error' : 'What worked'}</span>
            <b className="display">{primaryError ? errorTitle(primaryError) : cleanTitle(result.helped[0])}</b>
            <p>{primaryError ?? result.helped[0] ?? 'Nothing went obviously wrong. Raise the difficulty.'}</p>
            {primaryError && result.helped[0] && (
              <p className="res-worked">
                <span className="good">Worked</span> {result.helped[0]}
              </p>
            )}
          </section>

          <section className="res-next">
            <span className="eyebrow">{onNext ? 'Next' : 'Do this next'}</span>
            <b className="display">{onNext && nextLabel ? stripNext(nextLabel) : 'Same drill, one fix'}</b>
            <p>{result.advice}</p>
            <div className="res-actions">
              {onNext ? (
                <>
                  <button className="btn primary lg" onClick={onNext}>
                    Train next <span className="hint">SPACE</span>
                  </button>
                  <button className="btn" onClick={onRetry}>
                    Run again <span className="hint">R</span>
                  </button>
                </>
              ) : (
                <button className="btn primary lg" onClick={onRetry}>
                  Run again <span className="hint">R</span>
                </button>
              )}
              <button className="btn ghost" onClick={onExit}>
                Done <span className="hint">ESC</span>
              </button>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------------ the ledger
            One line, not a table: what the run did to your rating, and to the
            track it belongs to if it belongs to one. */}
        <div className={`res-ledger${stage >= 2 ? ' in' : ''}`}>
          <span>
            {report.rankAfter.label}
            <b className="mono">{Math.round(report.overallAfter)}</b>
            <i className={overallDelta >= 0 ? 'good' : 'bad'}>
              {overallDelta >= 0 ? '+' : ''}
              {Math.round(overallDelta)}
            </i>
          </span>
          {driver && Math.round(driver.delta) !== 0 && (
            <span>
              {AXIS_LABEL[driver.axis]}
              <b className="mono">{Math.round(driver.after)}</b>
              <i className={driver.delta >= 0 ? 'good' : 'bad'}>
                {driver.delta >= 0 ? '+' : ''}
                {Math.round(driver.delta)}
              </i>
            </span>
          )}
          {track && (
            <span>
              {track.label}
              <b className="mono">{track.value}</b>
              {track.note && <i className={track.good ? 'good' : ''}>{track.note}</i>}
            </span>
          )}
          <button className="link res-detail-toggle" onClick={() => setDetail((d) => !d)}>
            {detail ? 'Hide breakdown' : 'Full breakdown'} <span className="kbd">D</span>
          </button>
        </div>

        {/* ------------------------------------------------------- the detail
            Everything the screen used to open with. Kept whole, moved behind
            one press, because the fortieth run wants it and the fourth does
            not. */}
        {detail && (
          <div className="res-detail fade-up">
            <section>
              <div className="sec-head">Mechanical rating</div>
              <div className="rd-rows">
                {report.axisChanges.map((c) => (
                  <div className="rd-row" key={c.axis}>
                    <span>{AXIS_LABEL[c.axis]}</span>
                    <div className="meter">
                      <span style={{ width: `${clamp(c.after / 3600, 0.01, 1) * 100}%` }} />
                    </div>
                    <em className="mono">{c.rankAfter.label}</em>
                    <i className={`mono ${c.delta >= 0 ? 'good' : 'bad'}`}>
                      {c.delta >= 0 ? '+' : ''}
                      {Math.round(c.delta)}
                    </i>
                  </div>
                ))}
              </div>
              {report.difficultyAfter !== report.difficultyBefore && (
                <p className="rd-note">
                  Difficulty {report.difficultyAfter > report.difficultyBefore ? 'raised' : 'eased'} to{' '}
                  <b>{Math.round(report.difficultyAfter * 100)}</b> for your next{' '}
                  {meta.name.toLowerCase()} run.
                </p>
              )}
            </section>

            {(result.helped.length > 0 || result.hurt.length > 1) && (
              <section>
                <div className="sec-head">Everything the run showed</div>
                <div className="rd-lines">
                  {result.helped.map((h, i) => (
                    <p className="rd-line good" key={`h${i}`}>
                      {h}
                    </p>
                  ))}
                  {result.hurt.slice(1).map((h, i) => (
                    <p className="rd-line bad" key={`x${i}`}>
                      {h}
                    </p>
                  ))}
                </div>
              </section>
            )}

            <section className="rd-viz">
              <div>
                <div className="sec-head">Movement path</div>
                <PathMap path={result.metrics.path} cursor={result.metrics.cursorPath} bounds={bounds} width={380} />
              </div>
              <div className="rd-viz-wide">
                <div className="sec-head">Attack rhythm</div>
                <RhythmTimeline
                  marks={result.metrics.timeline}
                  duration={Math.max(1, result.metrics.duration)}
                  width={560}
                />
                {result.metrics.reactionTimes.length > 2 && (
                  <>
                    <div className="sec-head" style={{ marginTop: 22 }}>
                      Reaction distribution
                    </div>
                    <ReactionHistogram values={result.metrics.reactionTimes} width={520} height={80} />
                  </>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export const drillLabel = (id: DrillId): string => DRILLS[id].name;

/* -------------------------------------------------------------- helpers */

/**
 * The progression track this run fed, as one line.
 *
 * The three tracks — champion path, academy, APM ladder — each used to get a
 * three-column panel of their own on this screen, and only ever one of them
 * was present. They all say the same three things, so they all say them the
 * same way now: where you are, and what moved.
 */
const trackLine = (
  r: ProgressReport,
): { label: string; value: string; note: string | null; good: boolean } | null => {
  if (r.vayne) {
    return {
      label: `Path ${r.vayne.stage.step} / ${VAYNE_STAGES.length}`,
      value: `${Math.round(r.vayne.masteryAfter)} mastery`,
      note: r.vayne.unlocked
        ? `${r.vayne.unlocked.title} unlocked`
        : r.vayne.starsAfter > r.vayne.starsBefore
          ? `+${r.vayne.starsAfter - r.vayne.starsBefore}★`
          : null,
      good: true,
    };
  }
  if (r.wasd) {
    return {
      label: `Module ${r.wasd.module.step} / ${WASD_MODULES.length}`,
      value: `${Math.round(r.wasd.best * 100)}% best`,
      note: r.wasd.unlocked
        ? `${r.wasd.unlocked.title} unlocked`
        : r.wasd.starsAfter > r.wasd.starsBefore
          ? `+${r.wasd.starsAfter - r.wasd.starsBefore}★`
          : null,
      good: true,
    };
  }
  if (r.apm) {
    return {
      label: `Level ${r.apm.level} / ${APM_LEVELS}`,
      value: `${Math.round(r.apm.apm)} APM`,
      note:
        r.apm.unlockedTo !== null
          ? `level ${r.apm.unlockedTo} open`
          : r.apm.cleared
            ? 'cleared'
            : `${Math.max(0, Math.round((CLEAR_AT - r.apm.best) * 100))} short of clearing`,
      good: r.apm.unlockedTo !== null || r.apm.cleared,
    };
  }
  return null;
};

/**
 * A two-word name for an error, taken from its own sentence.
 *
 * The drills write their findings as prose ("You cancelled 3 attacks by
 * moving just before the damage point"), which is the right thing to read
 * second and the wrong thing to read first. This lifts the verb out so the
 * screen can lead with EARLY MOVE and keep the sentence underneath it.
 */
const ERROR_NAMES: [RegExp, string][] = [
  [/cancel|windup|wind-?up|before the (damage|point)|too soon|moved early/i, 'Early move'],
  [/re-?click|clicking short|past the direct|wander|extra distance|travelled/i, 'Wasted pathing'],
  [/overstep|too close|inside their|closed the gap|drift(ed)? in/i, 'Overstepping'],
  [/too far|out of range|short of range|backed off/i, 'Standing off'],
  [/slow|late|delay|reaction|reacted/i, 'Slow reaction'],
  [/switch(ed|ing)?|wrong target|target/i, 'Target choice'],
  [/miss(ed)?|off target|wide|wasted|threw away/i, 'Missed commands'],
  [/stack|third hit|unfinished|finish/i, 'Unfinished stacks'],
  [/idle|standing still|stopped|uptime|stood/i, 'Standing still'],
  [/hit by|took .*damage|died|eliminated|walked into/i, 'Taking damage'],
];

const errorTitle = (sentence: string): string => {
  for (const [re, name] of ERROR_NAMES) if (re.test(sentence)) return name;
  return 'Execution';
};

const cleanTitle = (sentence: string | undefined): string => {
  if (!sentence) return 'Clean run';
  const first = sentence.split(/[.,—]/)[0].trim();
  return first.length > 26 ? 'Clean run' : first;
};

/** "Next: Kite" → "Kite". The label carries its own heading now. */
const stripNext = (label: string): string => label.replace(/^next:\s*/i, '');
