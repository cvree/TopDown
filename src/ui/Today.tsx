import { useCallback, useEffect, useMemo } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import {
  benchmarkRating,
  formatMetric,
  recentImprovement,
  testsAttempted,
  todayKey,
  type Profile,
} from '../progression/profile';
import {
  axisReadings,
  buildPlan,
  lastSession,
  nextInPlan,
  recentImprovements,
  type PlanItem,
} from '../progression/plan';
import { rankFromRating } from '../progression/ranks';
import { AXIS_BLURB, AXIS_LABEL } from '../progression/skills';
import { nextVayneStage, titleFor as vayneTitleFor } from '../progression/vayne';
import {
  WASD_MODULES,
  moduleUnlocked,
  nextWasdModule,
  wasdTitleFor,
} from '../progression/wasd';
import { RankEmblem } from './components/RankEmblem';
import { Sparkline } from './components/charts';
import './today.css';

interface Props {
  profile: Profile;
  /** Runs the whole remaining session as one queue. The one-click path. */
  onStartSession: () => void;
  /** Runs a single drill, from anywhere on the screen. */
  onPlay: (id: DrillId) => void;
  onPlacement: () => void;
  onSection: (route: 'drills' | 'academy' | 'apm' | 'tests' | 'vayne' | 'daily' | 'profile') => void;
}

/**
 * TODAY.
 *
 * The home screen, and it has exactly one job: answer the five questions a
 * player actually arrives with, in the order they arrive in, and then get out
 * of the way.
 *
 *   What should I train today?      — the session, built and sitting there.
 *   What am I currently bad at?     — named, with the gap in rating.
 *   What improved recently?         — what got better, and by how much.
 *   What champion am I training?    — where the path is and what is next.
 *   What should I do next?          — the button. One click, no choosing.
 *
 * Everything else on the screen is a fact, not a decision. The full catalogue
 * still exists a tab away, because on the fortieth session you know what you
 * want; on the fourth, being handed thirty-six drills and a rank is not a
 * home screen, it is a filing cabinet.
 *
 * The streak is here and it is deliberately quiet. A streak that punishes you
 * for a day off is a retention mechanic pretending to be a training tool, and
 * it makes people play tired, which is worse than not playing. So it is drawn
 * as a record of what happened rather than as something you can lose, and the
 * screen says so out loud.
 */
export function Today({ profile, onStartSession, onPlay, onPlacement, onSection }: Props) {
  const rank = rankFromRating(profile.overall);
  const plan = useMemo(() => buildPlan(profile), [profile]);
  const next = nextInPlan(plan);
  const { strengths, weaknesses, unrated } = useMemo(() => axisReadings(profile), [profile]);
  const improvements = useMemo(() => recentImprovements(profile), [profile]);
  const previous = useMemo(() => lastSession(profile), [profile]);
  const trend = recentImprovement(profile);
  const overallSeries = useMemo(() => profile.history.slice(-40).map((h) => h.overall), [profile.history]);

  const start = useCallback(() => {
    audio.play('uiClick');
    if (!profile.placed) onPlacement();
    else onStartSession();
  }, [profile.placed, onPlacement, onStartSession]);

  // Enter starts the session. A client you can drive from the keyboard is a
  // client; one you can only click is a web page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  const remaining = plan.items.filter((i) => !i.done);
  const minutesLeft = remaining.reduce((n, i) => n + i.minutes, 0);

  return (
    <div className="scroll">
      <div className="wrap today fade-up">
        {/* -------------------------------------------------- the answer */}
        <section className="td-hero">
          <div className="td-hero-l">
            <div className="td-datestrip">
              <span className="eyebrow">Today</span>
              <i />
              <span className="mono faint">{longDate()}</span>
            </div>

            {profile.placed ? (
              <>
                <h1 className="td-h1 display">{plan.headline}</h1>
                <p className="td-lead">
                  {remaining.length === 0
                    ? 'Today’s session is finished. Anything you run now is extra — pick a section, or run the whole thing again.'
                    : `${remaining.length} ${remaining.length === 1 ? 'piece' : 'pieces'} left, about ${Math.round(minutesLeft)} minutes. Every one of them is here for a reason, and the reason is written next to it.`}
                </p>
                <div className="td-start">
                  <button className="btn primary lg td-play" onClick={start} onMouseEnter={() => audio.play('uiHover')}>
                    {plan.done === 0 ? 'START TODAY’S SESSION' : remaining.length ? 'CONTINUE SESSION' : 'RUN IT AGAIN'}
                    <span className="td-play-key">ENTER</span>
                  </button>
                  {next && (
                    <div className="td-nextup">
                      <span className="eyebrow">Next up</span>
                      <b style={{ color: DRILLS[next.drill].accent }}>{DRILLS[next.drill].name}</b>
                      <i>{Math.round(next.minutes * 60)}s · {next.label.toLowerCase()}</i>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <h1 className="td-h1 display">CALIBRATION FIRST</h1>
                <p className="td-lead">
                  Five short drills read your movement precision, reaction consistency, attack timing and
                  combat profile, then place you on the ladder. It takes about eight minutes and you only do
                  it once — after that this screen builds you a session every day.
                </p>
                <div className="td-start">
                  <button className="btn primary lg td-play" onClick={start} onMouseEnter={() => audio.play('uiHover')}>
                    BEGIN CALIBRATION
                    <span className="td-play-key">ENTER</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ------------------------------------------------ the rating */}
          <button className="td-rank" onClick={() => onSection('profile')} onMouseEnter={() => audio.play('uiHover')}>
            <RankEmblem tier={rank.tier} size={78} />
            <div className="td-rank-t">
              <span className="eyebrow">APEX skill rating</span>
              <b className="display">{profile.placed ? rank.label : 'UNRANKED'}</b>
              <i className="mono">{profile.placed ? Math.round(profile.overall) : '—'}</i>
            </div>
            {profile.placed && (
              <div className="td-rank-meter">
                <span style={{ width: `${Math.round(rank.progress * 100)}%` }} />
              </div>
            )}
            <div className="td-rank-row">
              <span>
                <em className={trend >= 0 ? 'good' : 'bad'}>
                  {trend >= 0 ? '+' : ''}
                  {trend.toFixed(1)}%
                </em>
                7-day
              </span>
              <span>
                <em className="mono">{profile.totalRuns}</em>
                runs
              </span>
              <span>
                <em className="mono">{Math.round(profile.totalSeconds / 60)}</em>
                min trained
              </span>
            </div>
            <i className="brk tl" />
            <i className="brk tr" />
            <i className="brk bl" />
            <i className="brk br" />
          </button>
        </section>

        {/* ------------------------------------------------ the session */}
        {profile.placed && (
          <section className="panel pad td-session">
            <div className="panel-title">
              Today’s session
              <span className="td-session-len mono">
                {plan.done} / {plan.items.length} done · ~{Math.round(plan.minutes)} min
              </span>
            </div>
            <div className="td-pieces">
              {plan.items.map((item, i) => (
                <Piece key={item.drill} item={item} index={i} onPlay={onPlay} />
              ))}
            </div>
            <p className="set-note">
              The session is rebuilt after every run, so finishing a piece changes what the rest of it says.
              Nothing here is compulsory — it is the order a coach would pick if you had not asked.
            </p>
          </section>
        )}

        {/* --------------------------------------------------- the reads */}
        <div className="td-grid">
          {/* what am I bad at */}
          <section className="panel pad td-card">
            <div className="panel-title">What you are worst at</div>
            {profile.placed && weaknesses.length ? (
              <div className="td-axes">
                {weaknesses.map((r) => (
                  <div className="td-axis" key={r.axis}>
                    <div className="td-axis-h">
                      <b>{AXIS_LABEL[r.axis]}</b>
                      <span className="mono bad">{Math.round(r.gap)}</span>
                    </div>
                    <div className="td-axis-bar">
                      <span style={{ width: `${Math.min(100, (r.rating / 3600) * 100)}%` }} />
                    </div>
                    <p>{AXIS_BLURB[r.axis]}</p>
                  </div>
                ))}
                {unrated.length > 0 && (
                  <p className="td-unrated">
                    <b>{unrated.length}</b> {unrated.length === 1 ? 'axis has' : 'axes have'} no data yet
                    {' — '}
                    {unrated.map((a) => AXIS_LABEL[a]).join(', ')}. An unmeasured axis is a guess, not a
                    strength.
                  </p>
                )}
              </div>
            ) : (
              <p className="td-empty">Calibrate, and this becomes the three things actually holding you back.</p>
            )}
          </section>

          {/* what improved */}
          <section className="panel pad td-card">
            <div className="panel-title">What improved</div>
            {improvements.length ? (
              <div className="td-pbs">
                {improvements.map((imp) => (
                  <div className="td-pb" key={`${imp.drill}${imp.label}${imp.at}`}>
                    <span className="td-pb-d" style={{ ['--c' as string]: DRILLS[imp.drill].accent }}>
                      {DRILLS[imp.drill].name}
                    </span>
                    <b>{imp.label}</b>
                    <span className="mono">{formatMetric(imp.value, imp.format)}</span>
                    <i className={imp.delta >= 0 ? 'good' : 'bad'}>
                      {imp.delta >= 0 ? '+' : ''}
                      {Math.abs(imp.delta) > 999 ? '999' : imp.delta.toFixed(1)}%
                    </i>
                  </div>
                ))}
              </div>
            ) : (
              <p className="td-empty">
                Personal bests from the last week land here. Beat one of your own numbers and it appears with
                what it beat.
              </p>
            )}
            {strengths.length > 0 && (
              <div className="td-strengths">
                <span className="eyebrow">Carrying you</span>
                {strengths.map((r) => (
                  <span className="td-strength" key={r.axis}>
                    <b>{AXIS_LABEL[r.axis]}</b>
                    <i className="mono good">+{Math.round(r.gap)}</i>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* champion */}
          <ChampionCard profile={profile} onPlay={onPlay} onSection={onSection} />

          {/* academy */}
          <AcademyCard profile={profile} onPlay={onPlay} onSection={onSection} />

          {/* last session */}
          <section className="panel pad td-card">
            <div className="panel-title">Last session</div>
            {previous ? (
              <>
                <div className="td-prev">
                  <div>
                    <span className="eyebrow">When</span>
                    <b>{relative(previous.at)}</b>
                  </div>
                  <div>
                    <span className="eyebrow">Ran</span>
                    <b className="mono">{previous.runs}</b>
                  </div>
                  <div>
                    <span className="eyebrow">Minutes</span>
                    <b className="mono">{Math.round(previous.minutes)}</b>
                  </div>
                  <div>
                    <span className="eyebrow">Rating</span>
                    <b className={previous.ratingAfter >= previous.ratingBefore ? 'good mono' : 'bad mono'}>
                      {previous.ratingAfter >= previous.ratingBefore ? '+' : ''}
                      {Math.round(previous.ratingAfter - previous.ratingBefore)}
                    </b>
                  </div>
                </div>
                <div className="td-prev-rows">
                  {previous.best && (
                    <div>
                      <span className="eyebrow">Best run</span>
                      <b style={{ color: DRILLS[previous.best.drill].accent }}>{DRILLS[previous.best.drill].name}</b>
                      <i className="mono">{Math.round(previous.best.performance * 100)}%</i>
                    </div>
                  )}
                  {previous.worst && (
                    <div>
                      <span className="eyebrow">Worst run</span>
                      <b style={{ color: DRILLS[previous.worst.drill].accent }}>{DRILLS[previous.worst.drill].name}</b>
                      <i className="mono">{Math.round(previous.worst.performance * 100)}%</i>
                      <button
                        className="btn sm"
                        onClick={() => {
                          audio.play('uiClick');
                          onPlay(previous.worst!.drill);
                        }}
                      >
                        Run it
                      </button>
                    </div>
                  )}
                </div>
                {overallSeries.length > 4 && (
                  <div className="td-spark">
                    <Sparkline values={overallSeries} width={300} height={38} />
                    <span className="faint">Rating · last {overallSeries.length} runs</span>
                  </div>
                )}
              </>
            ) : (
              <p className="td-empty">
                Your first session will be summarised here — what you ran, what moved, and the one drill that
                went worst, so you can start the next one with it.
              </p>
            )}
          </section>

          {/* consistency */}
          <section className="panel pad td-card td-streak">
            <div className="panel-title">Consistency</div>
            <div className="td-streak-top">
              <b className="mono">{profile.daily.streak}</b>
              <span>
                consecutive {profile.daily.streak === 1 ? 'day' : 'days'} with a full daily set
              </span>
            </div>
            <div className="td-days">
              {lastFourteen(profile).map((d) => (
                <i key={d.date} className={d.trained ? 'on' : ''} title={d.date} />
              ))}
            </div>
            <p className="td-streak-note">
              Fourteen days, one mark each. Missing a day costs you nothing and takes nothing away — the marks
              are a record of what happened, not a thing to protect. Training tired is worse than resting.
            </p>
            <div className="td-bench">
              <span className="eyebrow">Benchmarks</span>
              <b className="mono">
                {testsAttempted(profile) > 0 ? Math.round(benchmarkRating(profile)) : '—'}
              </b>
              <i>{testsAttempted(profile)} / 12 tests taken</i>
              <button
                className="btn sm"
                onClick={() => {
                  audio.play('uiClick');
                  onSection('tests');
                }}
              >
                Tests
              </button>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------- everything else */}
        <section className="td-more">
          <span className="eyebrow">Everything else</span>
          <div className="td-more-row">
            {(
              [
                { r: 'drills', name: 'ALL DRILLS', sub: 'the full catalogue, chosen by you' },
                { r: 'academy', name: 'WASD ACADEMY', sub: 'nine modules on the keys' },
                { r: 'apm', name: 'APM TRAINER', sub: 'thirteen modes, ten levels each' },
                { r: 'tests', name: 'SKILL TESTS', sub: 'twelve benchmarks, one number each' },
                { r: 'vayne', name: 'VAYNE PATH', sub: 'one champion, learned in order' },
                { r: 'daily', name: 'DAILY SET', sub: 'the same five, every day' },
              ] as const
            ).map((s) => (
              <button
                key={s.r}
                className="td-more-btn"
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiTab');
                  onSection(s.r);
                }}
              >
                <b>{s.name}</b>
                <span>{s.sub}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** One piece of the session: what, why, how long, and a way to jump to it. */
function Piece({ item, index, onPlay }: { item: PlanItem; index: number; onPlay: (id: DrillId) => void }) {
  const meta = DRILLS[item.drill];
  return (
    <div
      className={`td-piece${item.done ? ' done' : ''}`}
      style={{ ['--c' as string]: meta.accent }}
    >
      <div className="tp-n mono">{item.done ? '✓' : String(index + 1).padStart(2, '0')}</div>
      <div className="tp-body">
        <div className="tp-head">
          <span className="eyebrow">{item.label}</span>
          <b>{meta.name}</b>
          <i className="mono">{Math.round(item.minutes * 60)}s</i>
        </div>
        <p>{item.reason}</p>
      </div>
      <button
        className="btn sm"
        onMouseEnter={() => audio.play('uiHover')}
        onClick={() => {
          audio.play('uiClick');
          onPlay(item.drill);
        }}
      >
        {item.done ? 'Again' : 'Run'}
      </button>
    </div>
  );
}

function ChampionCard({
  profile,
  onPlay,
  onSection,
}: {
  profile: Profile;
  onPlay: (id: DrillId) => void;
  onSection: (r: 'vayne') => void;
}) {
  const runs = Object.values(profile.vayne.stages).reduce((n, s) => n + s.runs, 0);
  const stage = nextVayneStage(profile.vayne);
  const title = vayneTitleFor(profile.vayne.peak);
  const meta = DRILLS[stage.id];

  return (
    <section className="panel pad td-card td-champ">
      <div className="panel-title">Your champion</div>
      <div className="td-champ-top">
        <div className="td-champ-name display">VAYNE</div>
        <div className="td-champ-mast">
          <b className="mono">{Math.round(profile.vayne.mastery)}</b>
          <span>mastery</span>
        </div>
      </div>
      <div className="td-champ-title">{title.name}</div>
      <p className="td-champ-blurb">{runs > 0 ? title.blurb : 'The path is here whenever you want it. It is four stages and it is gated, because the reason people cannot play her is never the ultimate.'}</p>
      <div className="td-champ-next" style={{ ['--c' as string]: meta.accent }}>
        <span className="eyebrow">{runs > 0 ? 'Next stage' : 'Starts with'}</span>
        <b>{meta.name}</b>
        <i>{stage.title}</i>
        <div className="td-champ-btns">
          <button
            className="btn sm"
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiClick');
              onPlay(stage.id);
            }}
          >
            Run it
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              audio.play('uiTab');
              onSection('vayne');
            }}
          >
            The path
          </button>
        </div>
      </div>
    </section>
  );
}

function AcademyCard({
  profile,
  onPlay,
  onSection,
}: {
  profile: Profile;
  onPlay: (id: DrillId) => void;
  onSection: (r: 'academy') => void;
}) {
  const w = profile.wasd;
  const mod = nextWasdModule(w);
  const unlocked = moduleUnlocked(w, mod);
  const cleared = WASD_MODULES.filter((m) => w.modules[m.id].best >= m.gate).length;
  const title = wasdTitleFor(w.peak);
  const meta = DRILLS[mod.id];

  return (
    <section className="panel pad td-card td-acad">
      <div className="panel-title">The academy</div>
      <div className="td-acad-top">
        <div className="td-acad-prog">
          {WASD_MODULES.map((m) => (
            <i
              key={m.id}
              className={w.modules[m.id].best >= m.gate ? 'on' : w.modules[m.id].runs > 0 ? 'part' : ''}
              title={m.title}
            />
          ))}
        </div>
        <span className="mono faint">
          {cleared} / {WASD_MODULES.length}
        </span>
      </div>
      <div className="td-acad-title">{title.name}</div>
      <p className="td-champ-blurb">{title.blurb}</p>
      <div className="td-champ-next" style={{ ['--c' as string]: meta.accent }}>
        <span className="eyebrow">{unlocked ? 'Next module' : 'Locked'}</span>
        <b>{meta.name}</b>
        <i>{mod.purpose}</i>
        <div className="td-champ-btns">
          <button
            className="btn sm"
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiClick');
              onPlay(mod.id);
            }}
          >
            Run it
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              audio.play('uiTab');
              onSection('academy');
            }}
          >
            The course
          </button>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- helpers */

const longDate = (): string =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

const relative = (t: number): string => {
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  return `${Math.floor(days / 7)} weeks ago`;
};

/** The last fourteen days, and whether anything was run on each. */
const lastFourteen = (p: Profile): { date: string; trained: boolean }[] => {
  const days = new Set(
    p.history.map((h) => {
      const d = new Date(h.t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }),
  );
  const out: { date: string; trained: boolean }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date: key, trained: days.has(key) || (i === 0 && p.daily.completed.length > 0 && key === todayKey()) });
  }
  return out;
};
