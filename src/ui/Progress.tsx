import { useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, DRILL_LIST, type DrillId } from '../drills/catalog';
import { formatMetric, recentImprovement, type Profile } from '../progression/profile';
import { axisReadings, changeOverDays, recentImprovements } from '../progression/plan';
import { rankFromRating } from '../progression/ranks';
import { AXIS_BLURB, AXIS_LABEL, SKILL_AXES, type SkillAxis } from '../progression/skills';
import { apmTitleFor } from '../progression/apm';
import { titleFor } from '../progression/vayne';
import { RankEmblem } from './components/RankEmblem';
import { Sparkline } from './components/charts';
import './progress.css';

interface Props {
  profile: Profile;
  onRename: (name: string) => void;
  onReset: () => void;
  onPlay: (id: DrillId) => void;
}

/**
 * PROGRESS.
 *
 * "Am I getting better?" — and nothing else above the fold.
 *
 * This was the profile screen, and it was an analytics dashboard: seven
 * callout tiles, a radar, ten axis rows with a paragraph of definition each, a
 * rank curve, a personal-best grid of thirty-nine cards, and a twelve-row run
 * table. Somewhere in there were the three facts a returning player is
 * actually after, and they were the three hardest to find.
 *
 * They are the screen now. Thirty-day change, then the mechanical profile with
 * the strongest, the weakest and the fastest-improving axis called out by
 * name. Everything else is still here, one press below, where it belongs: a
 * record you consult rather than a wall you arrive at.
 */
export function Progress({ profile, onRename, onReset, onPlay }: Props) {
  const rank = rankFromRating(profile.overall);
  const { all, unrated } = useMemo(() => axisReadings(profile), [profile]);
  const window30 = useMemo(() => changeOverDays(profile, 30), [profile]);
  const improvement = useMemo(() => recentImprovements(profile, 30, 1)[0] ?? null, [profile]);
  const trend = recentImprovement(profile);

  const strongest = useMemo(() => pick(all, (a, b) => b.rating - a.rating), [all]);
  const weakest = useMemo(() => pick(all, (a, b) => a.rating - b.rating), [all]);
  // The fastest mover is only interesting if it actually moved. An axis that
  // gained 0.2% is not "fastest improving", it is noise with a superlative.
  const fastest = useMemo(() => {
    const top = pick(all, (a, b) => b.trend - a.trend);
    return top && top.trend > 1 ? top : null;
  }, [all]);

  const curve = useMemo(() => {
    if (profile.dailyMarks.length > 2) return profile.dailyMarks.map((d) => d.overall);
    return profile.history.slice(-60).map((h) => h.overall);
  }, [profile]);

  const [detail, setDetail] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.name);
  const [confirmReset, setConfirmReset] = useState(false);

  const maxRating = Math.max(1, ...SKILL_AXES.map((a) => profile.ratings[a]), profile.overall);

  return (
    <div className="scroll">
      <div className="wrap prog fade-up">
        <div className="page-head">
          <div>
            <span className="eyebrow">Progress</span>
            {editing ? (
              <input
                className="prog-name display"
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
              <h1 className="display" onClick={() => setEditing(true)} title="Click to rename">
                {profile.name}
              </h1>
            )}
          </div>
          <div className="prog-rank">
            <RankEmblem tier={rank.tier} size={44} />
            <div>
              <b className="display">{profile.placed ? rank.label : 'UNRANKED'}</b>
              <span className="mono">
                {Math.round(profile.overall)} · peak {Math.round(profile.peakOverall)}
              </span>
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------- 30-day change */}
        <section className="prog-window">
          <div className="sec-head">
            {window30 ? `${window30.days}-day change` : '30-day change'}
            <span className="sec-note">
              {profile.totalRuns} runs · {formatDuration(profile.totalSeconds)}
            </span>
          </div>
          <div className="prog-window-row">
            <div className="stat lg">
              <span className="stat-k">Overall</span>
              <span className={`stat-v ${(window30?.delta ?? 0) >= 0 ? 'good' : 'bad'}`}>
                {window30 ? `${window30.delta >= 0 ? '+' : ''}${Math.round(window30.delta)}` : '—'}
              </span>
              <span className="stat-s">
                {window30 ? `${Math.round(window30.from)} → ${Math.round(profile.overall)} rating` : 'Train for a few days'}
              </span>
            </div>

            <div className="stat lg">
              <span className="stat-k">Fastest improving</span>
              <span className="stat-v">{fastest ? AXIS_LABEL[fastest.axis] : '—'}</span>
              <span className="stat-s">
                {fastest ? `+${fastest.trend.toFixed(1)}% over recent runs` : 'Nothing has moved much yet'}
              </span>
            </div>

            <div className="stat lg">
              <span className="stat-k">Weakest area</span>
              <span className="stat-v">{weakest ? AXIS_LABEL[weakest.axis] : '—'}</span>
              <span className="stat-s">
                {weakest ? `${Math.round(weakest.gap)} behind your overall` : 'Not enough data'}
              </span>
            </div>

            <div className="stat lg">
              <span className="stat-k">Most improved number</span>
              <span className="stat-v">
                {improvement ? formatMetric(improvement.value, improvement.format) : '—'}
              </span>
              <span className="stat-s">
                {improvement
                  ? `${improvement.label} on ${DRILLS[improvement.drill].name}`
                  : 'Beat one of your own bests'}
              </span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ mechanical profile */}
        <section className="prog-profile">
          <div className="sec-head">
            Mechanical profile
            <span className="sec-note">
              {trend >= 0 ? '+' : ''}
              {trend.toFixed(1)}% · 7 days
            </span>
          </div>
          <div className="prog-axes">
            {SKILL_AXES.map((axis) => {
              const rated = profile.samples[axis] > 0;
              const r = profile.ratings[axis];
              const flag =
                strongest?.axis === axis
                  ? 'strongest'
                  : weakest?.axis === axis
                    ? 'weakest'
                    : fastest?.axis === axis
                      ? 'fastest'
                      : null;
              return (
                <button
                  key={axis}
                  className={`prog-axis${flag ? ` ${flag}` : ''}${rated ? '' : ' unrated'}`}
                  title={AXIS_BLURB[axis]}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    const d = drillForAxis(axis);
                    if (!d) return;
                    audio.play('uiClick');
                    onPlay(d);
                  }}
                >
                  <span className="pa-name">{AXIS_LABEL[axis]}</span>
                  <span className="pa-bar">
                    <i style={{ width: rated ? `${(r / maxRating) * 100}%` : '0%' }} />
                    <em style={{ left: `${(profile.overall / maxRating) * 100}%` }} />
                  </span>
                  <span className="pa-rating mono">{rated ? Math.round(r) : '—'}</span>
                  {flag && <span className="pa-flag">{flag}</span>}
                </button>
              );
            })}
          </div>
          <p className="prog-legend">
            The mark on every bar is your overall rating. Anything left of it is holding the rest back —
            click a row to train it.
            {unrated.length > 0 && (
              <>
                {' '}
                <b>{unrated.length}</b> {unrated.length === 1 ? 'axis has' : 'axes have'} never been
                measured; an unmeasured axis is a guess, not a strength.
              </>
            )}
          </p>
        </section>

        {/* ------------------------------------------------------- the curve */}
        {curve.length > 3 && (
          <section className="prog-curve">
            <div className="sec-head">
              Rating over time
              <span className="sec-note">
                {profile.dailyMarks.length > 2 ? `${profile.dailyMarks.length} days` : `${curve.length} runs`}
              </span>
            </div>
            <Sparkline values={curve} width={1140} height={120} />
          </section>
        )}

        {/* ---------------------------------------------------- the two tracks */}
        <section className="prog-tracks">
          <div className="stat">
            <span className="stat-k">Champion path</span>
            <span className="stat-v" style={{ color: '#e7c8ff' }}>
              {titleFor(profile.vayne.peak).name}
            </span>
            <span className="stat-s">{Math.round(profile.vayne.mastery)} mastery</span>
          </div>
          <div className="stat">
            <span className="stat-k">APM ladder</span>
            <span className="stat-v" style={{ color: '#b8f4ee' }}>
              {apmTitleFor(profile.apm.peak).name}
            </span>
            <span className="stat-s">
              {profile.apm.bestApm > 0
                ? `${Math.round(profile.apm.bestApm)} APM best`
                : 'no runs yet'}
            </span>
          </div>
          <div className="stat">
            <span className="stat-k">Daily streak</span>
            <span className="stat-v">{profile.daily.streak}</span>
            <span className="stat-s">
              {profile.daily.streak === 1 ? 'day' : 'days'} with a full set — a record, not a thing to protect
            </span>
          </div>
        </section>

        {/* ----------------------------------------------------- the archive */}
        <section className="prog-more">
          <button className="link" onClick={() => setDetail((d) => !d)}>
            {detail ? 'Hide the record' : 'Every best, and every run'}
          </button>

          {detail && (
            <div className="prog-detail fade-up">
              <div className="sec-head">Personal bests</div>
              <div className="prog-bests">
                {DRILL_LIST.filter((d) => profile.bests[d.id]).map((d) => (
                  <button
                    key={d.id}
                    className="prog-best"
                    style={{ ['--c' as string]: d.accent }}
                    onClick={() => onPlay(d.id)}
                  >
                    <b>{d.name}</b>
                    <em className="mono">{profile.bests[d.id]!.score.toLocaleString()}</em>
                  </button>
                ))}
                {DRILL_LIST.every((d) => !profile.bests[d.id]) && (
                  <p className="prog-none">Nothing recorded yet.</p>
                )}
              </div>

              <div className="sec-head" style={{ marginTop: 32 }}>
                Recent runs
              </div>
              {profile.history.length === 0 ? (
                <p className="prog-none">No runs recorded yet.</p>
              ) : (
                <div className="prog-runs">
                  {[...profile.history]
                    .reverse()
                    .slice(0, 15)
                    .map((h, i) => (
                      <div className="prog-run" key={i}>
                        <b style={{ color: DRILLS[h.drill].accent }}>{DRILLS[h.drill].name}</b>
                        <span className="mono">{h.score.toLocaleString()}</span>
                        <span className="meter">
                          <span style={{ width: `${Math.round(h.performance * 100)}%` }} />
                        </span>
                        <span className="mono">{Math.round(h.overall)}</span>
                        <span className="mono prog-when">{timeAgo(h.t)}</span>
                      </div>
                    ))}
                </div>
              )}

              <div className="prog-danger">
                {confirmReset ? (
                  <>
                    <span>Erase all ranks, bests and history on this device?</span>
                    <button className="btn sm prog-erase" onClick={onReset}>
                      Erase everything
                    </button>
                    <button className="btn ghost sm" onClick={() => setConfirmReset(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="link" onClick={() => setConfirmReset(true)}>
                    Reset profile
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- helpers */

const pick = <T,>(xs: T[], cmp: (a: T, b: T) => number): T | null =>
  xs.length ? [...xs].sort(cmp)[0] : null;

/** The drill that trains an axis hardest, so a row on this screen is a link. */
const drillForAxis = (axis: SkillAxis): DrillId | null => {
  let best: DrillId | null = null;
  let weight = 0;
  for (const meta of DRILL_LIST) {
    const w = meta.axes[axis] ?? 0;
    if (w > weight) {
      weight = w;
      best = meta.id;
    }
  }
  return best;
};

const formatDuration = (seconds: number): string => {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 90) return `${Math.round(mins)} min`;
  return `${(mins / 60).toFixed(1)} hours`;
};

const timeAgo = (t: number): string => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
