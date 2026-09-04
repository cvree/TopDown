import { useEffect, useMemo } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { ERRORS } from '../progression/errors';
import { formatMetric, type Profile, type ProgressReport, type RunResult } from '../progression/profile';
import { lastSession } from '../progression/plan';
import { recommend } from '../progression/coach';
import { AXIS_LABEL, SKILL_AXES } from '../progression/skills';
import { useCountUp } from './components/charts';
import './session.css';

/**
 * The seam between two drills.
 *
 * Six seconds of reading, not a results page: what you scored, the one thing
 * that cost you, and what is next. The full breakdown is one keypress away
 * and deliberately not the default — a session that stops for a dashboard
 * every two minutes is not a session, it is a menu with drills attached.
 */

interface BreakProps {
  result: RunResult;
  report: ProgressReport;
  step: number;
  total: number;
  nextDrill: DrillId | null;
  onContinue: () => void;
  onRetry: () => void;
  onDetails: () => void;
}

export function DrillBreak({
  result,
  report,
  step,
  total,
  nextDrill,
  onContinue,
  onRetry,
  onDetails,
}: BreakProps) {
  const meta = DRILLS[result.drill];
  const score = useCountUp(result.score, 850, 90);
  const limiter = report.limiter;
  const improvement = report.improvements[0];

  // The card arriving is a beat in the session, so it gets one sound: the
  // reveal, or the record cue when there is a record to announce.
  useEffect(() => {
    const hasBest = report.newBestScore || report.personalBests.length > 0;
    const t = window.setTimeout(() => audio.play(hasBest ? 'personalBest' : 'resultsReveal'), 120);
    return () => window.clearTimeout(t);
  }, [report]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onContinue();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        onRetry();
      } else if (e.code === 'KeyD') {
        e.preventDefault();
        onDetails();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onContinue, onRetry, onDetails]);

  return (
    <div className="brk-screen" style={{ ['--c' as string]: meta.accent }}>
      <div className="brk-card scale-in">
        <div className="brk-steps">
          {Array.from({ length: total }).map((_, i) => (
            <i key={i} className={i < step ? 'on' : ''} />
          ))}
          <span className="eyebrow">
            {meta.name} · {step} / {total}
          </span>
        </div>

        <div className="brk-score display">{Math.round(score).toLocaleString()}</div>

        <div className="brk-line">
          {(report.newBestScore || report.personalBests.length > 0) && <b className="brk-pb">NEW PERSONAL BEST</b>}
          {improvement && (
            <span className="mono faint">
              {improvement.label} {formatMetric(improvement.previous, improvement.format)} →{' '}
              {formatMetric(improvement.current, improvement.format)}
            </span>
          )}
        </div>

        <div className="ornament">
          <i />
        </div>

        {limiter ? (
          <div className="brk-err">
            <span className="eyebrow">Primary limiter</span>
            <b>{ERRORS[limiter.code].label.toUpperCase()}</b>
            <p>{limiter.detail}</p>
            {report.limiterWas !== null && (
              <span
                className={`mono brk-was ${limiter.rate < report.limiterWas ? 'good' : 'bad'}`}
              >
                {limiter.rate < report.limiterWas ? '▼' : '▲'} {Math.round(report.limiterWas * 100)}% →{' '}
                {Math.round(limiter.rate * 100)}% of opportunities, last fortnight
              </span>
            )}
          </div>
        ) : (
          <div className="brk-err clean">
            <span className="eyebrow">Primary limiter</span>
            <b className="good">NONE MEASURED</b>
            <p>{result.advice}</p>
          </div>
        )}

        <div className="brk-next">
          {nextDrill ? (
            <>
              <span className="eyebrow">Next</span>
              <b style={{ color: DRILLS[nextDrill].accent }}>{DRILLS[nextDrill].name}</b>
            </>
          ) : (
            <>
              <span className="eyebrow">Next</span>
              <b>SESSION SUMMARY</b>
            </>
          )}
        </div>

        <div className="brk-actions">
          <button className="btn primary lg" onClick={onContinue}>
            Continue <span className="kbd">Enter</span>
          </button>
          <button className="btn" onClick={onRetry}>
            Again <span className="kbd">R</span>
          </button>
          <button className="btn ghost" onClick={onDetails}>
            Full breakdown <span className="kbd">D</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ session summary */

interface SummaryProps {
  profile: Profile;
  onDone: () => void;
  onProgress: () => void;
  onPlay: (id: DrillId) => void;
}

/**
 * The end of a session.
 *
 * Satisfying without being manipulative: everything on it is a thing that
 * happened, stated once. No confetti, no "streak saved!", no reward for
 * having been present.
 */
export function SessionComplete({ profile, onDone, onProgress, onPlay }: SummaryProps) {
  // The sitting that just happened, inferred from the run history rather than
  // stored: a session is runs that happened near each other, and reading it
  // that way means it works on every profile ever written.
  const session = useMemo(() => lastSession(profile, true), [profile]);
  const since = session ? session.at - session.minutes * 60000 - 60000 : Date.now();

  const moved = useMemo(() => {
    // What the sitting changed, axis by axis: the ratings as they stood before
    // its first run against where they stand now.
    const before = profile.dailyMarks.filter((m) => m.ratings);
    const base = before.length > 1 ? before[before.length - 2].ratings : undefined;
    if (!base) return [];
    return SKILL_AXES.map((axis) => ({ axis, delta: profile.ratings[axis] - (base[axis] ?? 0) }))
      .filter((x) => Math.abs(x.delta) >= 1)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 4);
  }, [profile.ratings, profile.dailyMarks]);

  // Records actually beaten in this sitting. A drill played for the first time
  // writes a baseline, not a record, and does not appear here.
  const bestsToday = useMemo(
    () =>
      profile.recentBests
        .filter((b) => b.at >= since)
        .slice(-3)
        .reverse(),
    [profile.recentBests, since],
  );

  const commonError = useMemo(() => {
    const inSession = profile.errorLog.filter((e) => e.t >= since);
    const by = new Map<string, number>();
    for (const e of inSession) by.set(e.code, (by.get(e.code) ?? 0) + e.count);
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? { code: top[0] as keyof typeof ERRORS, count: top[1] } : null;
  }, [profile.errorLog, since]);

  const next = useMemo(() => recommend(profile, 1)[0] ?? null, [profile]);
  const overallDelta = session ? session.ratingAfter - session.ratingBefore : 0;
  const elapsed = (session?.minutes ?? 0) * 60;
  const reps = useMemo(
    () => profile.history.filter((h) => h.t >= since).reduce((n, h) => n + Math.round(h.score / 100), 0),
    [profile.history, since],
  );

  // One cue, and it tells the truth: the record sound only where a record was
  // actually beaten. A reward for having been present is how a trainer starts
  // meaning nothing.
  useEffect(() => {
    audio.play(bestsToday.length ? 'personalBest' : 'resultsReveal');
    // Fired once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scroll">
      <div className="wrap sess-done fade-up">
        <div className="eyebrow">Session complete</div>
        <h1 className="display sd-title foil">TRAINING COMPLETE</h1>
        <div className="ornament">
          <i />
        </div>

        <div className="sd-top">
          <div className="sd-stat">
            <span className="eyebrow">Time</span>
            <b className="display mono">{formatClock(elapsed)}</b>
          </div>
          <div className="sd-stat">
            <span className="eyebrow">Quality reps</span>
            <b className="display mono">{reps.toLocaleString()}</b>
          </div>
          <div className="sd-stat">
            <span className="eyebrow">Drills</span>
            <b className="display mono">{session?.runs ?? 0}</b>
          </div>
          <div className="sd-stat">
            <span className="eyebrow">Rating</span>
            <b className="display mono">
              {Math.round(profile.overall)}
              <em className={overallDelta >= 0 ? 'good' : 'bad'}>
                {overallDelta >= 0 ? '+' : ''}
                {Math.round(overallDelta)}
              </em>
            </b>
          </div>
        </div>

        <div className="sd-grid">
          <section className="panel pad">
            <div className="panel-title">What moved</div>
            {moved.length ? (
              <div className="sd-moved">
                {moved.map((m) => (
                  <div className="sdm-row" key={m.axis}>
                    <span>{AXIS_LABEL[m.axis]}</span>
                    <div className="sdm-bar">
                      <span
                        className={m.delta >= 0 ? 'up' : 'down'}
                        style={{ width: `${Math.min(100, Math.abs(m.delta) / 1.2)}%` }}
                      />
                    </div>
                    <b className={m.delta >= 0 ? 'good mono' : 'bad mono'}>
                      {m.delta >= 0 ? '+' : ''}
                      {Math.round(m.delta)}
                    </b>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">
                <b>HELD STEADY</b>
                <p>
                  Nothing moved more than a point today. That is what a session at your own level looks like —
                  the rating moves when the performance does.
                </p>
              </div>
            )}
          </section>

          <section className="panel pad">
            <div className="panel-title">Records &amp; habits</div>
            {bestsToday.length > 0 ? (
              <div className="sd-bests">
                {bestsToday.map((b, i) => (
                  <div className="sdb-row" key={`${b.drill}-${b.id}-${i}`}>
                    <span className="eyebrow">Personal best</span>
                    <b style={{ color: DRILLS[b.drill].accent }}>{DRILLS[b.drill].name}</b>
                    <i className="mono">
                      {b.label} {formatMetric(b.value, b.format)}
                    </i>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sd-bests">
                <div className="sdb-none faint">No records beaten today.</div>
              </div>
            )}
            {commonError ? (
              <div className="sd-err">
                <span className="eyebrow">Most common mistake today</span>
                <b>{ERRORS[commonError.code].label.toUpperCase()}</b>
                <p>
                  {commonError.count} {ERRORS[commonError.code].unit}. {ERRORS[commonError.code].when}
                </p>
              </div>
            ) : (
              <div className="sd-err">
                <span className="eyebrow">Most common mistake today</span>
                <b className="good">NONE RECURRING</b>
                <p>No mistake crossed the threshold to be worth naming. Raise the difficulty.</p>
              </div>
            )}
          </section>

          <section className="panel pad">
            <div className="panel-title">Next session</div>
            {next ? (
              <>
                <b className="display sd-next" style={{ color: DRILLS[next.drill].accent }}>
                  {DRILLS[next.drill].name}
                </b>
                <p className="sd-next-why">{next.reason}</p>
                <button className="btn" onClick={() => onPlay(next.drill)}>
                  Train it now
                </button>
              </>
            ) : (
              <p className="dim">Tomorrow's session will be drawn from today's numbers.</p>
            )}
          </section>
        </div>

        <div className="sd-actions">
          <button className="btn primary lg" onClick={onDone}>
            Done
          </button>
          <button className="btn lg" onClick={onProgress}>
            View progress
          </button>
        </div>
      </div>
    </div>
  );
}

const formatClock = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
