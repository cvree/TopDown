import { useMemo } from 'react';
import { audio } from '../engine/audio';
import { heroFor } from '../engine/heroes';
import { DRILLS, type DrillId } from '../drills/catalog';
import {
  dailyComplete,
  dailyPlan,
  type Profile,
} from '../progression/profile';
import {
  axisGains,
  errorRollup,
  insights,
  pressureRetention,
  recommend,
} from '../progression/coach';
import { ERRORS } from '../progression/errors';
import { rankFromRating } from '../progression/ranks';
import { AXIS_LABEL, SKILL_AXES } from '../progression/skills';
import { RankEmblem } from './components/RankEmblem';
import { Sparkline, useCountUp } from './components/charts';
import './today.css';

/**
 * TODAY.
 *
 * The strongest screen in the product, and the only one with a job this
 * blunt: there should never be a moment on it where someone wonders what to
 * click. One session, planned for them, one button that starts it, and
 * underneath it the honest answer to "what am I actually bad at".
 *
 * Everything here is measured. Where it has not been measured yet, the screen
 * says so and offers the run that would measure it — it never fills the space
 * with a plausible-looking number.
 */

interface Props {
  profile: Profile;
  onStartSession: () => void;
  onPlay: (id: DrillId) => void;
  onCalibrate: () => void;
  onOpenProgress: () => void;
  onOpenSummary: () => void;
  /** Controls, camera and audio — the setup step of the first-run flow. */
  onSetup: () => void;
  /** The drill browser, for a player who would rather not be diagnosed. */
  onExplore: () => void;
}

/** Under ninety seconds a block is stated in seconds — rounding a 45-second
 *  drill up to "1m" makes the five rows add up to more than the header. */
const blockLength = (seconds: number): string =>
  seconds >= 90 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds)}s`;

const ROLE_HINT: Record<string, string> = {
  WARMUP: 'Hands first',
  PRIMARY: 'The thing that is wrong',
  SECONDARY: 'Support skill',
  COMBINED: 'In context',
  TRANSFER: 'Against an opponent',
};

export function Today({
  profile,
  onStartSession,
  onPlay,
  onCalibrate,
  onOpenProgress,
  onOpenSummary,
  onSetup,
  onExplore,
}: Props) {
  const plan = useMemo(() => dailyPlan(profile), [profile]);
  const done = profile.daily.completed;
  const complete = dailyComplete(profile);
  const nextBlock = plan.blocks.find((b) => !done.includes(b.drill));
  const rank = rankFromRating(profile.overall);
  const amr = useCountUp(profile.placed ? profile.overall : 0, 900, 120);

  const recs = useMemo(() => recommend(profile, 1), [profile]);
  const topRec = recs[0] ?? null;
  const errors = useMemo(() => errorRollup(profile, 7), [profile]);
  const topError = errors[0] ?? null;
  const retention = useMemo(() => pressureRetention(profile), [profile]);
  const finds = useMemo(() => insights(profile), [profile]);

  // The weakest measured axis, and what it costs.
  const weakest = useMemo(() => {
    const rated = SKILL_AXES.filter((a) => profile.samples[a] > 0);
    if (!rated.length) return null;
    const axis = rated.reduce((a, b) => (profile.ratings[a] <= profile.ratings[b] ? a : b));
    return { axis, rating: profile.ratings[axis], drop: retention.find((r) => r.axis === axis) ?? null };
  }, [profile, retention]);

  // Recent improvement. Only things that actually moved, in the last week.
  const gains = useMemo(() => axisGains(profile, 7).filter((g) => g.delta >= 4).slice(0, 3), [profile]);
  const fixes = useMemo(
    () =>
      errors
        .filter((e) => e.previousRate !== null && e.previousRate - e.rate > 0.03)
        .slice(0, 2),
    [errors],
  );
  const hasImprovement = gains.length > 0 || fixes.length > 0;

  const curve = useMemo(
    () => profile.dailyMarks.slice(-30).map((m) => m.overall),
    [profile.dailyMarks],
  );

  // Seven days, marked where training actually happened. Deliberately not a
  // streak counter with a warning on it: a missed day is information, not a
  // punishment, and the panel never says anything was lost.
  const week = useMemo(() => {
    const trained = new Set(profile.dailyMarks.map((m) => m.date));
    const out: { key: string; label: string; done: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ key, label: 'SMTWTFS'[d.getDay()], done: trained.has(key) });
    }
    return out;
  }, [profile.dailyMarks]);

  const hero = heroFor(profile.settings.hero);
  const minutesToday = profile.daily.seconds / 60;

  /* ------------------------------------------------------- unplaced state */
  if (!profile.placed) {
    return (
      <div className="scroll">
        <div className="wrap today">
          <div className="today-cal panel pad fade-up">
            <div className="eyebrow">Welcome to APEX</div>
            <h1 className="display tc-title foil">MEASURE FIRST</h1>
            <div className="ornament">
              <i />
            </div>
            <p className="tc-body">
              Nothing here is worth showing you until it has been measured. Five short drills read your
              movement precision, reaction consistency, attack timing, spacing and combat profile — about
              eight minutes — and every screen after that is built out of what they find.
            </p>
            <div className="tc-seq">
              {['MOVEMENT', 'AIM', 'DODGE', 'KITE', '1 v 1'].map((n, i) => (
                <span key={n}>
                  <b className="mono">{i + 1}</b>
                  {n}
                </span>
              ))}
            </div>
            <div className="tc-actions">
              <button className="btn primary lg" onClick={onCalibrate}>
                Take the mechanical assessment
              </button>
              <button className="btn lg" onClick={onSetup}>
                Calibrate your setup first
              </button>
              <button className="btn ghost lg" onClick={onExplore}>
                Explore training
              </button>
            </div>
            <p className="tc-foot faint">
              The recommended order is setup, then assessment, then your first session — but nothing here is
              locked, and you can pick drills yourself at any point.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- placed */
  return (
    <div className="scroll">
      <div className="wrap today">
        <div className="today-grid">
          {/* ------------------------------------------------ main column */}
          <div className="today-main">
            <section className={`panel pad session-card fade-up${complete ? ' is-done' : ''}`}>
              <div className="sc-head">
                <div>
                  <div className="eyebrow">{complete ? 'Session complete' : "Today's session"}</div>
                  <h1 className="display sc-focus">{plan.focus.toUpperCase()}</h1>
                  <p className="sc-sub dim">{plan.subtitle}</p>
                </div>
                <div className="sc-meta">
                  <div className="scm">
                    <span className="eyebrow">Length</span>
                    <b className="mono">{plan.minutes} MIN</b>
                  </div>
                  <div className="scm">
                    <span className="eyebrow">Champion</span>
                    <b style={{ color: hero.accent }}>{hero.name}</b>
                  </div>
                  <div className="scm">
                    <span className="eyebrow">Done</span>
                    <b className="mono">
                      {done.filter((d) => plan.blocks.some((b) => b.drill === d)).length} / {plan.blocks.length}
                    </b>
                  </div>
                </div>
              </div>

              <ol className="sc-list">
                {plan.blocks.map((b) => {
                  const isDone = done.includes(b.drill);
                  const isNext = !isDone && b.drill === nextBlock?.drill;
                  const d = DRILLS[b.drill];
                  return (
                    <li
                      key={b.drill}
                      className={`sc-row${isDone ? ' done' : ''}${isNext ? ' next' : ''}`}
                      style={{ ['--c' as string]: d.accent }}
                    >
                      <span className="sc-mark" aria-hidden>
                        {isDone ? '✓' : isNext ? '▸' : ''}
                      </span>
                      <span className="sc-role eyebrow">{b.label}</span>
                      <button
                        className="sc-name display"
                        onClick={() => onPlay(b.drill)}
                        onMouseEnter={() => audio.play('uiHover')}
                        title={`Play ${d.name} on its own`}
                      >
                        {d.name}
                      </button>
                      <span className="sc-dur mono">{blockLength(b.seconds)}</span>
                      {isNext && <p className="sc-why">{b.why}</p>}
                      {!isNext && <span className="sc-hint faint">{ROLE_HINT[b.role]}</span>}
                    </li>
                  );
                })}
              </ol>

              <div className="sc-actions">
                {complete ? (
                  <>
                    <button className="btn primary lg" onClick={onOpenSummary}>
                      View session summary
                    </button>
                    <span className="sc-done-note dim">
                      {Math.round(minutesToday)} quality minutes · {profile.daily.reps.toLocaleString()} reps.
                      Stop here — the next session is tomorrow.
                    </span>
                  </>
                ) : (
                  <>
                    <button className="btn primary lg" onClick={onStartSession}>
                      {done.length > 0 ? 'Continue training' : "Start today's training"}
                    </button>
                    {nextBlock && (
                      <span className="sc-next-note dim">
                        Next up: <b>{DRILLS[nextBlock.drill].name}</b> · {ROLE_HINT[nextBlock.role].toLowerCase()}
                      </span>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* ------------------------------------------ the current focus */}
            <section className="panel pad focus-card fade-up">
              <div className="panel-title">Your current focus</div>
              {weakest ? (
                <div className="fc-grid">
                  <div className="fc-weak">
                    <span className="eyebrow">Primary weakness</span>
                    <b className="display fc-axis">{AXIS_LABEL[weakest.axis].toUpperCase()}</b>
                    <div className="fc-rating mono">{Math.round(weakest.rating)} AMR</div>
                    {weakest.drop && weakest.drop.retention < 0.95 && (
                      <div className="fc-drop bad">
                        ↓ {Math.round((1 - weakest.drop.retention) * 100)}% worse under combat pressure
                      </div>
                    )}
                  </div>

                  <div className="fc-error">
                    {topError ? (
                      <>
                        <span className="eyebrow">Most common mistake</span>
                        <b className="fc-code">{ERRORS[topError.code].label.toUpperCase()}</b>
                        <p className="fc-mean">{ERRORS[topError.code].meaning}</p>
                        <div className="fc-count mono faint">
                          {topError.occurrences} {ERRORS[topError.code].unit} across {topError.runs} run
                          {topError.runs === 1 ? '' : 's'} this week
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="eyebrow">Most common mistake</span>
                        <b className="fc-code faint">NOTHING RECURRING</b>
                        <p className="fc-mean">
                          No mistake has appeared often enough this week to name. Train something harder and it
                          will.
                        </p>
                      </>
                    )}
                  </div>

                  <div className="fc-rec">
                    <span className="eyebrow">Recommended</span>
                    {topRec ? (
                      <>
                        <span className="fc-rec-head">{topRec.headline}</span>
                        <b className="display fc-drill" style={{ color: DRILLS[topRec.drill].accent }}>
                          {DRILLS[topRec.drill].name}
                        </b>
                        <p className="fc-reason">{topRec.reason}</p>
                        <button className="btn" onClick={() => onPlay(topRec.drill)}>
                          Train this
                        </button>
                      </>
                    ) : (
                      <p className="fc-reason faint">Run today's session and a recommendation will follow it.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="empty">
                  <b>NOT ENOUGH DATA</b>
                  <p>Complete a session and APEX can tell you what is actually holding you back.</p>
                </div>
              )}
            </section>

            {/* -------------------------------------------- what has moved */}
            <section className="panel pad improve-card fade-up">
              <div className="panel-title">Recent improvement</div>
              {hasImprovement ? (
                <div className="ic-list">
                  {gains.map((g) => (
                    <div className="ic-row" key={g.axis}>
                      <span className="ic-name">{g.label}</span>
                      <span className="ic-detail mono faint">
                        {Math.round(g.from)} → {Math.round(g.to)}
                      </span>
                      <span className="ic-delta good mono">+{Math.round(g.delta)}</span>
                    </div>
                  ))}
                  {fixes.map((f) => (
                    <div className="ic-row" key={f.code}>
                      <span className="ic-name">{ERRORS[f.code].label}</span>
                      <span className="ic-detail mono faint">
                        {Math.round((f.previousRate as number) * 100)}% → {Math.round(f.rate * 100)}% of
                        opportunities
                      </span>
                      <span className="ic-delta good mono">
                        −{Math.round(((f.previousRate as number) - f.rate) * 100)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <b>NOT ENOUGH DATA</b>
                  <p>
                    Improvement needs two points to measure between. Train on {profile.dailyMarks.length < 2 ? 'a second day' : 'a few more days'} and
                    this fills in with what actually moved.
                  </p>
                </div>
              )}
            </section>
          </div>

          {/* ------------------------------------------------- right column */}
          <aside className="today-side">
            <button className="amr-block" onClick={onOpenProgress} onMouseEnter={() => audio.play('uiHover')}>
              <RankEmblem tier={rank.tier} size={72} />
              <div className="amr-text">
                <span className="eyebrow">APEX mechanical rating</span>
                <b className="display amr-num">{Math.round(amr)}</b>
                <span className="amr-rank">{rank.label}</span>
              </div>
              <div className="amr-meter">
                <span style={{ width: `${Math.round(rank.progress * 100)}%` }} />
              </div>
              <i className="brk tl" />
              <i className="brk tr" />
              <i className="brk bl" />
              <i className="brk br" />
            </button>

            {curve.length > 3 && (
              <div className="panel pad side-trend">
                <div className="panel-title">Rating · {curve.length} days</div>
                <Sparkline values={curve} width={268} height={52} />
                <div className="st-foot mono faint">
                  {Math.round(curve[0])} → {Math.round(curve[curve.length - 1])}
                </div>
              </div>
            )}

            <div className="panel pad side-axes">
              <div className="panel-title">Skill dimensions</div>
              <div className="sa-list">
                {SKILL_AXES.map((axis) => {
                  const rated = profile.samples[axis] > 0;
                  const r = profile.ratings[axis];
                  return (
                    <div className="sa-row" key={axis}>
                      <span className="sa-name">{AXIS_LABEL[axis]}</span>
                      <div className="sa-bar">
                        <span style={{ width: rated ? `${Math.min(100, (r / 3600) * 100)}%` : '0%' }} />
                      </div>
                      <span className={`sa-val mono${rated ? '' : ' faint'}`}>
                        {rated ? Math.round(r) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel pad side-rhythm">
              <div className="panel-title">Training rhythm</div>
              <div className="sr-week">
                {week.map((d) => (
                  <span key={d.key} className={d.done ? 'on' : ''} title={d.key}>
                    {d.label}
                  </span>
                ))}
              </div>
              <div className="sr-lines">
                <div>
                  <span>This week</span>
                  <b className="mono">
                    {week.filter((d) => d.done).length} session{week.filter((d) => d.done).length === 1 ? '' : 's'}
                  </b>
                </div>
                <div>
                  <span>Quality minutes today</span>
                  <b className="mono">{Math.round(minutesToday)}</b>
                </div>
                <div>
                  <span>Consecutive days</span>
                  <b className="mono">{profile.daily.streak}</b>
                </div>
              </div>
            </div>

            {finds.length > 0 && (
              <div className="panel pad side-insights">
                <div className="panel-title">Insights</div>
                {finds.map((f) => (
                  <div className={`ins ins-${f.kind}`} key={f.id}>
                    <b>{f.title}</b>
                    <p>{f.body}</p>
                    {f.drill && (
                      <button className="ins-link" onClick={() => onPlay(f.drill as DrillId)}>
                        Train {DRILLS[f.drill].name} →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
