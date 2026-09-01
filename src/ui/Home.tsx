import { useMemo } from 'react';
import { audio } from '../engine/audio';
import { DAILY_SEQUENCE, DRILL_LIST, DRILLS, type DrillGroup, type DrillId } from '../drills/catalog';
import {
  bestAxis,
  drillDifficulty,
  formatMetric,
  recentImprovement,
  trainingPriority,
  type Profile,
} from '../progression/profile';
import { rankFromRating } from '../progression/ranks';
import { AXIS_LABEL, SKILL_AXES } from '../progression/skills';
import { RankEmblem } from './components/RankEmblem';
import { RankMeter, Sparkline } from './components/charts';
import './home.css';

interface Props {
  profile: Profile;
  onPlay: (id: DrillId) => void;
  onDaily: () => void;
  onProfile: () => void;
  onPlacement: () => void;
}

const GROUPS: { id: DrillGroup; title: string; blurb: string }[] = [
  { id: 'FOUNDATION', title: 'Foundation', blurb: 'The inputs everything else is built on.' },
  { id: 'RHYTHM', title: 'Rhythm', blurb: 'Timing between your hands and the game clock.' },
  { id: 'COMBAT', title: 'Combat', blurb: 'All of it at once, against something that fights back.' },
];

export function Home({ profile, onPlay, onDaily, onProfile, onPlacement }: Props) {
  const rank = rankFromRating(profile.overall);
  const best = bestAxis(profile);
  const priority = trainingPriority(profile);
  const improvement = recentImprovement(profile);
  const dailyDone = profile.daily.completed.length;
  const overallSeries = useMemo(
    () => profile.history.slice(-40).map((h) => h.overall),
    [profile.history],
  );

  return (
    <div className="scroll">
      <div className="wrap home">
        <section className="hero">
          <div className="hero-left">
            <div className="eyebrow">Trainer mechanical rank</div>
            <div className="hero-rank-row">
              <RankEmblem tier={rank.tier} size={104} />
              <div>
                <div className="hero-rank display">{profile.placed ? rank.label : 'UNRANKED'}</div>
                <div className="hero-rating mono">
                  {profile.placed ? `${Math.round(profile.overall)} rating` : 'Calibration required'}
                  {profile.placed && profile.peakOverall > profile.overall + 5 && (
                    <span className="faint"> · peak {Math.round(profile.peakOverall)}</span>
                  )}
                </div>
              </div>
            </div>

            {profile.placed ? (
              <div style={{ maxWidth: 420, marginTop: 22 }}>
                <RankMeter
                  progress={rank.progress}
                  label={rank.label}
                  sub={
                    rank.nextAt
                      ? `${Math.max(0, Math.round(rank.nextAt - profile.overall))} rating to the next division`
                      : 'You are at the top of the ladder.'
                  }
                />
              </div>
            ) : (
              <div className="hero-cta">
                <p className="dim" style={{ maxWidth: 440, marginTop: 14 }}>
                  Five short drills read your movement precision, reaction consistency, attack timing and
                  combat profile, then place you on the ladder.
                </p>
                <button
                  className="btn primary lg"
                  onClick={() => {
                    audio.play('uiClick');
                    onPlacement();
                  }}
                >
                  Begin calibration
                </button>
              </div>
            )}

            <p className="disclaimer">
              This rank measures <b>these drills</b> — mechanical execution under controlled conditions.
              It is not a prediction of your League ranked tier, and it does not measure macro, vision or
              decision-making.
            </p>
          </div>

          <div className="hero-right">
            <div className="panel pad skills-card">
              <div className="panel-title">Skill profile</div>
              <div className="skill-rows">
                {SKILL_AXES.map((axis) => {
                  const rated = profile.samples[axis] > 0;
                  const r = profile.ratings[axis];
                  const info = rankFromRating(r);
                  return (
                    <div className="skill-row" key={axis}>
                      <span className="sr-name">{AXIS_LABEL[axis]}</span>
                      <div className="sr-bar">
                        <span style={{ width: rated ? `${Math.min(100, (r / 3600) * 100)}%` : '0%' }} />
                      </div>
                      <span className={`sr-rank ${rated ? '' : 'faint'}`}>
                        {rated ? info.label : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {profile.placed && (
                <div className="skill-callouts">
                  {best && (
                    <div>
                      <span className="eyebrow">Best</span>
                      <b className="good">{AXIS_LABEL[best]}</b>
                    </div>
                  )}
                  {priority && (
                    <div>
                      <span className="eyebrow">Priority</span>
                      <b className="warn">{priority.label}</b>
                    </div>
                  )}
                  <div>
                    <span className="eyebrow">7-day</span>
                    <b className={improvement >= 0 ? 'good' : 'bad'}>
                      {improvement >= 0 ? '+' : ''}
                      {improvement.toFixed(1)}%
                    </b>
                  </div>
                </div>
              )}
              <button className="btn ghost sm" style={{ marginTop: 16 }} onClick={onProfile}>
                Full profile
              </button>
            </div>
          </div>
        </section>

        <section className="daily-strip panel pad" onClick={onDaily} role="button" tabIndex={0}>
          <div>
            <div className="eyebrow">Daily mechanics</div>
            <div className="daily-title display">
              {dailyDone >= DAILY_SEQUENCE.length ? 'COMPLETE FOR TODAY' : `${DAILY_SEQUENCE.length - dailyDone} DRILLS LEFT`}
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
              About 12 minutes · streak {profile.daily.streak} day{profile.daily.streak === 1 ? '' : 's'}
            </div>
          </div>
          <div className="daily-dots">
            {DAILY_SEQUENCE.map((d) => (
              <div className={`dd ${profile.daily.completed.includes(d) ? 'on' : ''}`} key={d}>
                <span>{DRILLS[d].name}</span>
              </div>
            ))}
          </div>
          <button className="btn primary">
            {dailyDone >= DAILY_SEQUENCE.length ? 'Review today' : dailyDone > 0 ? 'Continue' : 'Start'}
          </button>
        </section>

        {overallSeries.length > 4 && (
          <section className="panel pad trend">
            <div>
              <div className="panel-title" style={{ margin: 0 }}>
                Rating trend · last {overallSeries.length} runs
              </div>
            </div>
            <Sparkline values={overallSeries} width={520} height={54} />
            <div className="trend-num">
              <span className="eyebrow">NOW</span>
              <b className="display">{Math.round(profile.overall)}</b>
            </div>
          </section>
        )}

        {GROUPS.map((g) => (
          <section key={g.id} className="group">
            <div className="group-head">
              <h2 className="display">{g.title}</h2>
              <span className="faint">{g.blurb}</span>
            </div>
            <div className="drill-grid">
              {DRILL_LIST.filter((d) => d.group === g.id).map((d) => {
                const best = profile.bests[d.id];
                const diff = drillDifficulty(profile, d.id);
                const headMetric = best ? Object.entries(best.metrics)[0] : null;
                return (
                  <button
                    key={d.id}
                    className="drill-card"
                    style={{ ['--c' as string]: d.accent }}
                    onMouseEnter={() => audio.play('uiHover')}
                    onClick={() => {
                      audio.play('uiClick');
                      onPlay(d.id);
                    }}
                  >
                    <div className="dc-glow" />
                    <div className="dc-top">
                      <span className="dc-name display">{d.name}</span>
                      <span className="dc-tag">{d.tagline}</span>
                    </div>
                    <p className="dc-brief">{d.brief}</p>
                    <div className="dc-transfer">
                      <span className="eyebrow">Transfers to</span>
                      {d.transfers}
                    </div>
                    <div className="dc-foot">
                      <div>
                        <span className="eyebrow">Best</span>
                        <b>{best ? best.score.toLocaleString() : '—'}</b>
                      </div>
                      <div>
                        <span className="eyebrow">{d.keyMetric}</span>
                        <b>
                          {headMetric
                            ? formatMetric(
                                headMetric[1],
                                d.keyMetric.includes('REACTION') || d.keyMetric.includes('SPEED')
                                  ? 'ms'
                                  : d.keyMetric.includes('ERROR')
                                    ? 'units'
                                    : 'pct',
                              )
                            : '—'}
                        </b>
                      </div>
                      <div className="dc-diff">
                        <span className="eyebrow">Level</span>
                        <div className="diff-bars">
                          {Array.from({ length: 10 }).map((_, i) => (
                            <span key={i} className={i < Math.round(diff * 10) ? 'on' : ''} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
