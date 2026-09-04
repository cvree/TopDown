import { useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { formatMetric, type Profile } from '../progression/profile';
import { sessionHistory } from '../progression/plan';
import {
  axisGains,
  errorRollup,
  errorWeeks,
  overallGain,
  pressureRetention,
  styleRead,
  transferLadder,
  type TransferRow,
} from '../progression/coach';
import { ERRORS, type ErrorCode } from '../progression/errors';
import { percentileForRating, rankFromRating } from '../progression/ranks';
import { AXIS_BLURB, AXIS_LABEL, SKILL_AXES, type SkillAxis } from '../progression/skills';
import { apmTitleFor } from '../progression/apm';
import { titleFor } from '../progression/vayne';
import { RankEmblem } from './components/RankEmblem';
import { SkillRadar, Sparkline } from './components/charts';
import './profile.css';
import './progress.css';

/**
 * PROGRESS.
 *
 * One analytical page, in the order the questions get asked: how good am I,
 * what is my shape, does it survive a fight, which mistakes am I still
 * making, and is any of it going away. Everything below the fold is optional
 * detail; nothing above it is decoration.
 */

interface Props {
  profile: Profile;
  onRename: (name: string) => void;
  onReset: () => void;
  onPlay: (id: DrillId) => void;
}

export function Progress({ profile, onRename, onReset, onPlay }: Props) {
  const rank = rankFromRating(profile.overall);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.name);
  const [confirmReset, setConfirmReset] = useState(false);
  const [openError, setOpenError] = useState<ErrorCode | null>(null);

  const gain = useMemo(() => overallGain(profile, 30), [profile]);
  const gains = useMemo(() => axisGains(profile, 30), [profile]);
  const retention = useMemo(() => pressureRetention(profile), [profile]);
  const errors = useMemo(() => errorRollup(profile, 7), [profile]);
  const read = useMemo(() => styleRead(profile), [profile]);
  const slowest = gains.length ? gains[gains.length - 1] : null;
  // Axes measured for the first time inside the window: real news, but not
  // growth, so they are named separately rather than folded into the gains.
  const newlyRated = useMemo(() => {
    const marks = profile.dailyMarks.filter((m) => m.ratings);
    if (marks.length < 2) return [];
    const cutoff = Date.now() - 30 * 86400000;
    const older = marks.filter((m) => new Date(m.date).getTime() <= cutoff);
    const base = older.length ? older[older.length - 1] : marks[0];
    return SKILL_AXES.filter((a) => (base.ratings?.[a] ?? 0) <= 0 && profile.ratings[a] > 0);
  }, [profile]);

  // The transfer ladder is shown for the axis that most needs it: the one
  // that falls apart hardest under pressure, or failing that the weakest.
  const focusAxis = useMemo<SkillAxis | null>(() => {
    if (retention.length) return retention[0].axis;
    const rated = SKILL_AXES.filter((a) => profile.samples[a] > 0);
    if (!rated.length) return null;
    return rated.reduce((a, b) => (profile.ratings[a] <= profile.ratings[b] ? a : b));
  }, [retention, profile]);
  const ladder = useMemo(() => (focusAxis ? transferLadder(profile, focusAxis) : []), [profile, focusAxis]);

  const curve = useMemo(() => {
    if (profile.dailyMarks.length > 2) return profile.dailyMarks.map((d) => d.overall);
    return profile.history.slice(-60).map((h) => h.overall);
  }, [profile]);

  const sessions = useMemo(() => sessionHistory(profile, 8), [profile]);
  const topPct = 1 - percentileForRating(profile.overall);

  return (
    <div className="scroll">
      <div className="wrap prof">
        {/* ------------------------------------------------------ identity */}
        <section className="prof-head fade-up">
          <div className="prof-id">
            <RankEmblem tier={rank.tier} size={118} />
            <div>
              {editing ? (
                <input
                  className="prof-name-input display"
                  value={draft}
                  autoFocus
                  maxLength={16}
                  onChange={(e) => setDraft(e.target.value.toUpperCase())}
                  onBlur={() => {
                    onRename(draft.trim() || 'PLAYER');
                    setEditing(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              ) : (
                <h1 className="display prof-name" onClick={() => setEditing(true)} title="Click to rename">
                  {profile.name}
                </h1>
              )}
              <div className="eyebrow" style={{ marginTop: 10 }}>
                APEX mechanical rating
              </div>
              <div className="prof-rank display">{profile.placed ? rank.label : 'UNRANKED'}</div>
              <div className="prof-stats mono">
                <span>{Math.round(profile.overall)} AMR</span>
                <span>peak {Math.round(profile.peakOverall)}</span>
                {profile.placed && <span>top {topPct < 0.01 ? '<1' : Math.round(topPct * 100)}%</span>}
              </div>
            </div>
          </div>

          {/* The 30-day band: the single most-asked question on this page. */}
          <div className="thirty">
            <div className="panel-title">30-day change</div>
            {gain ? (
              <div className="th-grid">
                <div>
                  <span className="eyebrow">Overall AMR</span>
                  <b className={gain.delta >= 0 ? 'good' : 'bad'}>
                    {gain.delta >= 0 ? '+' : ''}
                    {Math.round(gain.delta)}
                  </b>
                  <i className="mono faint">
                    {Math.round(gain.from)} → {Math.round(gain.to)}
                  </i>
                </div>
                <div>
                  <span className="eyebrow">Strongest growth</span>
                  <b className="good">
                    {gains[0] ? `${gains[0].label} +${Math.round(gains[0].delta)}` : '—'}
                  </b>
                  <i className="faint">the fastest-moving axis you have</i>
                </div>
                <div>
                  <span className="eyebrow">Needs attention</span>
                  <b className="warn">
                    {slowest
                      ? `${slowest.label} ${slowest.delta >= 0 ? '+' : ''}${Math.round(slowest.delta)}`
                      : '—'}
                  </b>
                  <i className="faint">
                    {!slowest
                      ? 'nothing measured on both ends yet'
                      : slowest.delta < 0
                        ? 'gone backwards this month'
                        : slowest.delta < 25
                          ? 'barely moved in a month'
                          : 'your slowest-moving axis'}
                  </i>
                </div>
              </div>
            ) : (
              <div className="empty">
                <b>NOT ENOUGH DAYS</b>
                <p>
                  A 30-day change needs a reading from thirty days ago. Keep training and this fills in on its
                  own — nothing here is estimated.
                </p>
              </div>
            )}
            {newlyRated.length > 0 && (
              <p className="th-new faint">
                First measured this month:{' '}
                <b>{newlyRated.map((a) => AXIS_LABEL[a]).join(', ')}</b> — counted as new readings, not as growth.
              </p>
            )}
          </div>
        </section>

        {/* --------------------------------------------------- the read */}
        {read.length > 0 && (
          <section className="panel pad style-read fade-up">
            <div className="panel-title">Your style</div>
            {read.map((line, i) => (
              <p key={i} className={i === 0 ? 'sr-lead' : ''}>
                {line}
              </p>
            ))}
          </section>
        )}

        {/* ------------------------------------------------- shape & axes */}
        <section className="prof-mid">
          <div className="panel pad radar-panel">
            <div className="panel-title">Skill profile</div>
            <div className="radar-wrap">
              <SkillRadar ratings={profile.ratings} samples={profile.samples} size={342} />
            </div>
          </div>

          <div className="panel pad axes-panel">
            <div className="panel-title">Axis detail</div>
            <div className="axis-list">
              {SKILL_AXES.map((axis) => {
                const rated = profile.samples[axis] > 0;
                const r = profile.ratings[axis];
                const info = rankFromRating(r);
                const g = gains.find((x) => x.axis === axis);
                return (
                  <div className="axis-item" key={axis}>
                    <div className="ai-top">
                      <span className="ai-name">{AXIS_LABEL[axis]}</span>
                      {g && Math.abs(g.delta) >= 1 && (
                        <span className={`ai-delta mono ${g.delta >= 0 ? 'good' : 'bad'}`}>
                          {g.delta >= 0 ? '+' : ''}
                          {Math.round(g.delta)}
                        </span>
                      )}
                      <span className={`ai-rank ${rated ? '' : 'faint'}`}>{rated ? info.label : 'UNRATED'}</span>
                      <span className="ai-rating mono">{rated ? Math.round(r) : '—'}</span>
                    </div>
                    <div className="ai-bar">
                      <span style={{ width: rated ? `${Math.min(100, (r / 3600) * 100)}%` : '0%' }} />
                      <i style={{ left: `${Math.min(100, (profile.overall / 3600) * 100)}%` }} />
                    </div>
                    <div className="ai-blurb">{AXIS_BLURB[axis]}</div>
                  </div>
                );
              })}
            </div>
            <div className="axis-legend faint">
              The vertical mark on each bar is your overall rating — anything left of it is holding you back.
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- pressure */}
        <section className="prof-pressure">
          <div className="panel pad">
            <div className="panel-title">Pressure retention</div>
            <p className="pp-lead dim">
              The same mechanic, measured on a bench and then measured again with something fighting back.
              Retention is the second divided by the first — it is the difference between knowing a mechanic
              and owning it.
            </p>
            {retention.length ? (
              <div className="pp-list">
                {retention.map((r) => (
                  <div className="pp-row" key={r.axis}>
                    <span className="pp-name">{AXIS_LABEL[r.axis]}</span>
                    <div className="pp-track" title={`${r.isolatedRuns} isolated runs, ${r.liveRuns} live runs`}>
                      <span className="pp-iso" style={{ width: `${Math.min(100, Math.round(r.isolated * 100))}%` }} />
                      <span className="pp-live" style={{ width: `${Math.min(100, Math.round(r.live * 100))}%` }} />
                    </div>
                    <span className="pp-nums mono faint">
                      {Math.round(r.isolated * 100)}% → {Math.round(r.live * 100)}%
                    </span>
                    <b
                      className={`pp-ret mono ${r.retention >= 0.9 ? 'good' : r.retention >= 0.78 ? 'warn' : 'bad'}`}
                      title={
                        r.retention >= 1
                          ? 'Better under pressure than on the bench — rare, and worth knowing.'
                          : 'How much of the isolated number survives an opponent.'
                      }
                    >
                      {Math.round(r.retention * 100)}%
                    </b>
                  </div>
                ))}
                <div className="pp-legend faint">
                  <span>
                    <i className="pp-key-iso" /> isolated
                  </span>
                  <span>
                    <i className="pp-key-live" /> under pressure
                  </span>
                </div>
              </div>
            ) : (
              <div className="empty">
                <b>NOT ENOUGH DATA</b>
                <p>
                  Retention needs at least three runs of a mechanic on its own and three with an opponent. Run
                  a duel and the comparison starts.
                </p>
                <button className="btn sm" onClick={() => onPlay('duel1v1')}>
                  Train 1 v 1
                </button>
              </div>
            )}
          </div>

          <div className="panel pad">
            <div className="panel-title">
              Transfer readiness{focusAxis ? ` · ${AXIS_LABEL[focusAxis]}` : ''}
            </div>
            {ladder.length ? (
              <div className="tr-list">
                {ladder.map((row) => (
                  <TransferStage key={row.stage} row={row} />
                ))}
                <p className="tr-foot faint">
                  Each stage is your best three runs in that context. Mastered at 82.
                </p>
              </div>
            ) : (
              <div className="empty">
                <b>NOT ENOUGH DATA</b>
                <p>Train one axis across isolated, applied and live drills to build its transfer ladder.</p>
              </div>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------- errors */}
        <section className="panel pad prof-errors">
          <div className="panel-title">Your most common mistakes · last 7 days</div>
          {errors.length ? (
            <div className="err-list">
              {errors.slice(0, 6).map((e, i) => {
                const meta = ERRORS[e.code];
                const open = openError === e.code;
                const weeks = open ? errorWeeks(profile, e.code, 4) : [];
                return (
                  <div className={`err-item${open ? ' open' : ''}`} key={e.code}>
                    <button
                      className="err-head"
                      onMouseEnter={() => audio.play('uiHover')}
                      onClick={() => {
                        audio.play('uiClick');
                        setOpenError(open ? null : e.code);
                      }}
                      aria-expanded={open}
                    >
                      <span className="err-rank mono">{i + 1}</span>
                      <span className="err-name">{meta.label}</span>
                      <span className="err-count mono">
                        {e.occurrences} <em>{meta.unit}</em>
                      </span>
                      <span className="err-rate mono">{Math.round(e.rate * 100)}%</span>
                      {e.previousRate !== null && (
                        <span
                          className={`err-trend mono ${e.rate < e.previousRate ? 'good' : 'bad'}`}
                          title="Against the week before"
                        >
                          {e.rate < e.previousRate ? '▼' : '▲'}
                          {Math.abs(Math.round((e.rate - e.previousRate) * 100))}
                        </span>
                      )}
                      <span className="err-chev" aria-hidden>
                        {open ? '−' : '+'}
                      </span>
                    </button>
                    {open && (
                      <div className="err-body">
                        <div className="err-cols">
                          <div>
                            <span className="eyebrow">What it means</span>
                            <p>{meta.meaning}</p>
                          </div>
                          <div>
                            <span className="eyebrow">When it happens</span>
                            <p>{meta.when}</p>
                          </div>
                          <div>
                            <span className="eyebrow">What it costs</span>
                            <p>{meta.cost}</p>
                          </div>
                        </div>
                        <div className="err-weeks">
                          <span className="eyebrow">Week by week · share of opportunities</span>
                          <div className="ew-bars">
                            {(() => {
                              // Scaled against the worst week rather than
                              // against 100%: a habit falling from 16% to 6%
                              // is the story, and four near-flat bars hide it.
                              const peak = Math.max(0.04, ...weeks.map((w) => w.rate ?? 0));
                              return weeks.map((w) => (
                                <div className="ew-col" key={w.label}>
                                  <div className="ew-bar">
                                    <span
                                      style={{
                                        height:
                                          w.rate === null ? '3px' : `${Math.max(6, (w.rate / peak) * 100)}%`,
                                      }}
                                      className={w.rate === null ? 'none' : ''}
                                    />
                                  </div>
                                  <b className="mono">{w.rate === null ? '—' : `${Math.round(w.rate * 100)}%`}</b>
                                  <span className="faint">{w.label}</span>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                        <div className="err-fix">
                          <span className="eyebrow">What fixes it</span>
                          <b style={{ color: DRILLS[meta.fix].accent }}>{DRILLS[meta.fix].name}</b>
                          <span className="faint">Most often in {DRILLS[e.worstDrill].name}.</span>
                          <button className="btn sm" onClick={() => onPlay(meta.fix)}>
                            Train it
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty">
              <b>NOTHING RECURRING</b>
              <p>
                No mistake has crossed the threshold to be named this week. Either you have cleaned them up, or
                the difficulty is too low to produce any — try a harder drill.
              </p>
            </div>
          )}
        </section>

        {/* ------------------------------------------------------- curves */}
        {curve.length > 3 && (
          <section className="panel pad prof-curve">
            <div className="panel-title">Rating over time</div>
            <Sparkline values={curve} width={1080} height={130} />
            <div className="curve-foot faint">
              {profile.dailyMarks.length > 2
                ? `${profile.dailyMarks.length} days of training`
                : `${curve.length} runs`}{' '}
              · from {Math.round(curve[0])} to {Math.round(curve[curve.length - 1])} rating
            </div>
          </section>
        )}

        {/* ------------------------------------------------------ history */}
        <section className="panel pad">
          <div className="panel-title">Practice history</div>
          {sessions.length ? (
            <table className="run-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Drills</th>
                  <th>Length</th>
                  <th>Runs</th>
                  <th>Weakest run</th>
                  <th>AMR</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.at}>
                    <td className="mono">
                      {new Date(s.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </td>
                    <td>
                      {s.drills
                        .slice(0, 3)
                        .map((d) => DRILLS[d].name)
                        .join(', ')}
                      {s.drills.length > 3 && ` +${s.drills.length - 3}`}
                    </td>
                    <td className="mono faint">{s.minutes}m</td>
                    <td className="mono faint">{s.runs}</td>
                    <td className="faint">
                      {s.worst ? `${DRILLS[s.worst.drill].name} ${Math.round(s.worst.performance * 100)}%` : '—'}
                    </td>
                    <td className={`mono ${s.ratingAfter >= s.ratingBefore ? 'good' : 'bad'}`}>
                      {s.ratingAfter >= s.ratingBefore ? '+' : ''}
                      {Math.round(s.ratingAfter - s.ratingBefore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">
              <b>NO SESSIONS YET</b>
              <p>Train a few drills in one sitting and it is filed here with what it changed.</p>
            </div>
          )}
        </section>

        <section className="panel pad recent">
          <div className="panel-title">Recent runs</div>
          {profile.history.length === 0 ? (
            <div className="faint">No runs recorded yet.</div>
          ) : (
            <table className="run-table">
              <thead>
                <tr>
                  <th>Drill</th>
                  <th>Score</th>
                  <th>Performance</th>
                  <th>Level</th>
                  <th>Mistakes</th>
                  <th>Rating after</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {[...profile.history]
                  .reverse()
                  .slice(0, 12)
                  .map((h, i) => (
                    <tr key={i}>
                      <td style={{ color: DRILLS[h.drill].accent }}>{DRILLS[h.drill].name}</td>
                      <td className="mono">{h.score.toLocaleString()}</td>
                      <td>
                        <div className="tiny-bar">
                          <span style={{ width: `${Math.round(h.performance * 100)}%` }} />
                        </div>
                      </td>
                      <td className="mono">{Math.round(h.difficulty * 100)}</td>
                      <td className="faint">
                        {h.errors && h.errors.length
                          ? h.errors.slice(0, 2).map((c) => ERRORS[c]?.label ?? c).join(', ')
                          : '—'}
                      </td>
                      <td className="mono">{Math.round(h.overall)}</td>
                      <td className="faint mono">{timeAgo(h.t)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>

        {/* -------------------------------------------------- other tracks */}
        <section className="prof-tracks">
          <div className="panel pad">
            <span className="eyebrow">Champion path</span>
            <b className="display" style={{ color: '#e7c8ff' }}>
              {titleFor(profile.vayne.peak).name}
            </b>
            <span className="faint mono">{Math.round(profile.vayne.mastery)} mastery</span>
          </div>
          <div className="panel pad">
            <span className="eyebrow">The lab</span>
            <b className="display" style={{ color: '#b8f4ee' }}>
              {apmTitleFor(profile.apm.peak).name}
            </b>
            <span className="faint mono">
              {Math.round(profile.apm.mastery)} mastery ·{' '}
              {profile.apm.bestApm > 0 ? `${Math.round(profile.apm.bestApm)} APM best` : 'no runs yet'}
            </span>
          </div>
          <div className="panel pad">
            <span className="eyebrow">Training volume</span>
            <b className="display">{profile.totalRuns}</b>
            <span className="faint mono">runs · {formatDuration(profile.totalSeconds)}</span>
          </div>
        </section>

        <section className="danger-zone">
          {confirmReset ? (
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <span className="dim">Erase all ranks, bests and history on this device?</span>
              <button
                className="btn sm"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                onClick={onReset}
              >
                Erase everything
              </button>
              <button className="btn ghost sm" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn ghost sm" onClick={() => setConfirmReset(true)}>
              Reset profile
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

/** One rung of the transfer ladder. */
function TransferStage({ row }: { row: TransferRow }) {
  const label =
    row.score === null ? 'NOT ENOUGH RUNS' : row.mastered ? 'MASTERED' : `${Math.round(row.score)}`;
  return (
    <div className={`tr-row${row.mastered ? ' done' : ''}${row.score === null ? ' empty-row' : ''}`}>
      <span className="tr-stage">{row.stage}</span>
      <div className="tr-track">
        <span style={{ width: row.score === null ? '0%' : `${Math.min(100, row.score)}%` }} />
        <i style={{ left: '82%' }} title="Mastery threshold" />
      </div>
      <b className={row.mastered ? 'good' : row.score === null ? 'faint' : ''}>{label}</b>
    </div>
  );
}

const formatDuration = (seconds: number): string => {
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const mins = seconds / 60;
  if (mins < 90) return `${Math.round(mins)} minute${Math.round(mins) === 1 ? '' : 's'}`;
  return `${(mins / 60).toFixed(1)} hours`;
};

const timeAgo = (t: number): string => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export { formatMetric };
