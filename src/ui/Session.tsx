import { useEffect, useMemo } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { ERRORS } from '../progression/errors';
import { formatMetric, type Profile, type ProgressReport, type RunResult } from '../progression/profile';
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
  const d = profile.daily;
  const startedAt = d.startedAt ?? Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const moved = useMemo(() => {
    const start = d.startRatings;
    if (!start) return [];
    return SKILL_AXES.map((axis) => ({ axis, delta: profile.ratings[axis] - (start[axis] ?? 0) }))
      .filter((x) => Math.abs(x.delta) >= 1)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 4);
  }, [profile.ratings, d.startRatings]);

  const bestsToday = useMemo(
    () =>
      (Object.entries(profile.bests) as [DrillId, { score: number; at: number }][])
        .filter(([, b]) => b.at >= dayStart.getTime())
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, 3),
    // dayStart is derived per render but stable within a day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.bests],
  );

  const commonError = useMemo(() => {
    const today = profile.errorLog.filter((e) => e.t >= dayStart.getTime());
    const by = new Map<string, number>();
    for (const e of today) by.set(e.code, (by.get(e.code) ?? 0) + e.count);
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? { code: top[0] as keyof typeof ERRORS, count: top[1] } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.errorLog]);

  const next = useMemo(() => recommend(profile, 1)[0] ?? null, [profile]);
  const overallDelta = profile.overall - d.startOverall;
  const elapsed = Math.max(d.seconds, (Date.now() - startedAt) / 1000);

  useEffect(() => {
    audio.play('personalBest');
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
            <b className="display mono">{d.reps.toLocaleString()}</b>
          </div>
          <div className="sd-stat">
            <span className="eyebrow">Drills</span>
            <b className="display mono">{d.completed.length}</b>
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
            {bestsToday.length > 0 && (
              <div className="sd-bests">
                {bestsToday.map(([id, b]) => (
                  <div className="sdb-row" key={id}>
                    <span className="eyebrow">Personal best</span>
                    <b style={{ color: DRILLS[id].accent }}>{DRILLS[id].name}</b>
                    <i className="mono">{b.score.toLocaleString()}</i>
                  </div>
                ))}
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
