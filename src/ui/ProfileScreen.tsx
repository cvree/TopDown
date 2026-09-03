import { useMemo, useState } from 'react';
import { DRILLS, DRILL_LIST } from '../drills/catalog';
import {
  bestAxis,
  drillDifficulty,
  formatMetric,
  recentImprovement,
  trainingPriority,
  type Profile,
} from '../progression/profile';
import { percentileForRating, rankFromRating } from '../progression/ranks';
import { AXIS_BLURB, AXIS_LABEL, SKILL_AXES } from '../progression/skills';
import { apmTitleFor } from '../progression/apm';
import { titleFor } from '../progression/vayne';
import { RankEmblem } from './components/RankEmblem';
import { SkillRadar, Sparkline } from './components/charts';
import './profile.css';

interface Props {
  profile: Profile;
  onRename: (name: string) => void;
  onReset: () => void;
  onPlay: (id: (typeof DRILL_LIST)[number]['id']) => void;
}

export function ProfileScreen({ profile, onRename, onReset, onPlay }: Props) {
  const rank = rankFromRating(profile.overall);
  const best = bestAxis(profile);
  const priority = trainingPriority(profile);
  const improvement = recentImprovement(profile);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.name);
  const [confirmReset, setConfirmReset] = useState(false);

  const curve = useMemo(() => {
    if (profile.dailyMarks.length > 2) return profile.dailyMarks.map((d) => d.overall);
    return profile.history.slice(-60).map((h) => h.overall);
  }, [profile]);

  const topPct = 1 - percentileForRating(profile.overall);

  return (
    <div className="scroll">
      <div className="wrap prof">
        <section className="prof-head fade-up">
          <div className="prof-id">
            <RankEmblem tier={rank.tier} size={128} />
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
                Trainer mechanical rank
              </div>
              <div className="prof-rank display">{profile.placed ? rank.label : 'UNRANKED'}</div>
              <div className="prof-stats mono">
                <span>{Math.round(profile.overall)} rating</span>
                <span>peak {Math.round(profile.peakOverall)}</span>
                {profile.placed && <span>top {topPct < 0.01 ? '<1' : Math.round(topPct * 100)}%</span>}
              </div>
            </div>
          </div>

          <div className="prof-callouts">
            <div className="pc">
              <span className="eyebrow">Best skill</span>
              <b className="good">{best ? AXIS_LABEL[best] : '—'}</b>
            </div>
            <div className="pc">
              <span className="eyebrow">Training priority</span>
              <b className="warn">{priority ? priority.label : '—'}</b>
              {priority && <i>{priority.reason}</i>}
            </div>
            <div className="pc">
              <span className="eyebrow">Daily streak</span>
              <b>{profile.daily.streak}</b>
            </div>
            <div className="pc">
              <span className="eyebrow">Recent change</span>
              <b className={improvement >= 0 ? 'good' : 'bad'}>
                {improvement >= 0 ? '+' : ''}
                {improvement.toFixed(1)}%
              </b>
            </div>
            <div className="pc">
              <span className="eyebrow">Runs</span>
              <b>{profile.totalRuns}</b>
              <i>{formatDuration(profile.totalSeconds)}</i>
            </div>
            {/* The champion path and the APM ladder are separate claims from
                the rank, so they are stated separately rather than folded into
                the ladder. */}
            <div className="pc">
              <span className="eyebrow">Vayne path</span>
              <b style={{ color: '#e7c8ff' }}>{titleFor(profile.vayne.peak).name}</b>
              <i>{Math.round(profile.vayne.mastery)} mastery</i>
            </div>
            <div className="pc">
              <span className="eyebrow">APM ladder</span>
              <b style={{ color: '#b8f4ee' }}>{apmTitleFor(profile.apm.peak).name}</b>
              <i>
                {Math.round(profile.apm.mastery)} mastery ·{' '}
                {profile.apm.bestApm > 0 ? `${Math.round(profile.apm.bestApm)} APM best` : 'no runs yet'}
              </i>
            </div>
          </div>
        </section>

        <section className="prof-mid">
          <div className="panel pad radar-panel">
            <div className="panel-title">Skill profile</div>
            <div className="radar-wrap">
              <SkillRadar ratings={profile.ratings} samples={profile.samples} size={360} />
            </div>
          </div>

          <div className="panel pad axes-panel">
            <div className="panel-title">Axis detail</div>
            <div className="axis-list">
              {SKILL_AXES.map((axis) => {
                const rated = profile.samples[axis] > 0;
                const r = profile.ratings[axis];
                const info = rankFromRating(r);
                return (
                  <div className="axis-item" key={axis}>
                    <div className="ai-top">
                      <span className="ai-name">{AXIS_LABEL[axis]}</span>
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

        {curve.length > 3 && (
          <section className="panel pad prof-curve">
            <div className="panel-title">Rank progression</div>
            <Sparkline values={curve} width={1080} height={130} />
            <div className="curve-foot faint">
              {profile.dailyMarks.length > 2
                ? `${profile.dailyMarks.length} days of training`
                : `${curve.length} runs`}{' '}
              · from {Math.round(curve[0])} to {Math.round(curve[curve.length - 1])} rating
            </div>
          </section>
        )}

        <section className="panel pad">
          <div className="panel-title">Personal bests</div>
          <div className="best-grid">
            {DRILL_LIST.map((d) => {
              const b = profile.bests[d.id];
              return (
                <button className="best-card" key={d.id} onClick={() => onPlay(d.id)} style={{ ['--c' as string]: d.accent }}>
                  <div className="bc-name display">{d.name}</div>
                  <div className="bc-score display">{b ? b.score.toLocaleString() : '—'}</div>
                  <div className="bc-metrics">
                    {b
                      ? Object.entries(b.metrics)
                          .slice(0, 3)
                          .map(([k, v]) => {
                            const km = d.keyMetric;
                            void km;
                            return (
                              <div key={k}>
                                <span>{k}</span>
                                <b>
                                  {formatMetric(
                                    v,
                                    k.toLowerCase().includes('reaction') || k.toLowerCase().includes('switch') || k.toLowerCase().includes('cast')
                                      ? 'ms'
                                      : k.toLowerCase().includes('err')
                                        ? 'units'
                                        : v <= 1 && v >= 0
                                          ? 'pct'
                                          : 'int',
                                  )}
                                </b>
                              </div>
                            );
                          })
                      : <div className="faint">Never played</div>}
                  </div>
                  <div className="bc-diff">
                    <span className="eyebrow">Level</span>
                    <div className="diff-bars">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <span key={i} className={i < Math.round(drillDifficulty(profile, d.id) * 10) ? 'on' : ''} />
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
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
                      <td className="mono">{Math.round(h.overall)}</td>
                      <td className="faint mono">{timeAgo(h.t)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="danger-zone">
          {confirmReset ? (
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <span className="dim">Erase all ranks, bests and history on this device?</span>
              <button className="btn sm" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={onReset}>
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
