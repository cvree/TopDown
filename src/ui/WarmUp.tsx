import { useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { defaultsFor, resolveBindings, type Bindings } from '../engine/input';
import type { AppSettings, Profile } from '../progression/profile';
import { todayKey } from '../progression/profile';
import { ERRORS } from '../progression/errors';
import {
  BENCH_DIFFICULTY,
  BENCH_QUORUM,
  BENCH_SCENARIOS,
  BENCH_TIERS,
  BENCH_TIER_COLORS,
  benchCode,
  benchPlace,
  benchSummary,
  benchValue,
  decodeScenario,
  type BenchScenario,
  type ScenarioCode,
} from '../progression/benchmarks';
import {
  FREEZE_EVERY,
  MAX_FREEZES,
  REACTION_META,
  REACTION_TESTS,
  buildWarmup,
  drillName,
  readDay,
  reactionBaseline,
  streakState,
  type DayRead,
  type ReactionRun,
  type ReactionTestId,
  type WarmupPlan,
  type WarmupSession,
} from '../progression/warmup';
import { ReactionTest } from './ReactionTest';
import './warmup.css';

/**
 * WARM UP — the section you open every day.
 *
 * Four things on one screen, in the order a session uses them: today's
 * routine behind one button, the four reaction tests, the benchmark sheet,
 * and a box to paste a scenario code a friend sent. The first is the reason
 * the section exists; the other three are the measurements it is built on.
 */

/** What the app hands back once a routine has been closed. */
export interface WarmupSummary {
  session: WarmupSession;
  extended: boolean;
  froze: number;
  earned: boolean;
  /** The streak after this routine. */
  streak: number;
  /** Last time this focus was warmed up, for "vs last time". */
  previous: WarmupSession | null;
}

interface Props {
  profile: Profile;
  settings: AppSettings;
  summary: WarmupSummary | null;
  onDismissSummary: () => void;
  onStart: (plan: WarmupPlan, calibration: ReactionRun | null, day: DayRead) => void;
  onReaction: (test: ReactionTestId, run: ReactionRun) => void;
  onBench: (b: BenchScenario) => void;
  onCode: (code: ScenarioCode) => void;
}

const bindingsOf = (settings: AppSettings | undefined): Bindings => {
  const scheme = settings?.movementScheme === 'wasd' ? 'wasd' : 'click';
  try {
    return resolveBindings(scheme, scheme === 'wasd' ? settings?.wasdBindings : settings?.bindings);
  } catch {
    return defaultsFor(scheme);
  }
};

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function WarmUp({ profile, settings, summary, onDismissSummary, onStart, onReaction, onBench, onCode }: Props) {
  const today = todayKey();
  const plan = useMemo(() => buildWarmup(profile, today), [profile, today]);
  const bindings = useMemo(() => bindingsOf(settings), [settings]);
  const w = profile.warmup;
  const streak = streakState(w, today);
  const [testing, setTesting] = useState<{ test: ReactionTestId; calibrate: boolean } | null>(null);
  const calib = useRef<ReactionRun | null>(null);
  const calibDay = useRef<DayRead>('unknown');

  const startRoutine = () => {
    audio.unlock();
    audio.play('uiClick');
    calib.current = null;
    setTesting({ test: 'visual', calibrate: true });
  };

  return (
    <div className="scroll">
      <div className="wrap wu fade-up">
        <header className="pr-head">
          <div className="eyebrow">Ten minutes a day · come back tomorrow</div>
          <h1 className="display pr-h1">WARM UP</h1>
          <p className="dim pr-lead">
            One button: a reaction check, two sets on the mistake you made most yesterday, one lab
            bench for your hands, and the same habit under pressure. Then one sentence to take
            into your next game.
          </p>
        </header>

        {summary && <SummaryCard summary={summary} onDismiss={onDismissSummary} />}

        <section className="panel pad wu-today">
          <div className="wu-today-head">
            <div>
              <div className="panel-title">Today’s routine · about {plan.minutes} minutes</div>
              <p className="wu-headline">{plan.headline}</p>
            </div>
            <StreakBadge streak={w.streak} best={w.bestStreak} freezes={w.freezes} state={streak.state} missed={streak.missed} />
          </div>

          <ol className="wu-steps">
            {plan.steps.map((s, i) => (
              <li key={i} className={`wu-step k-${s.kind}`}>
                <span className="wu-step-n mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="wu-step-l">{s.label}</span>
                <b className="wu-step-d">{s.drill ? drillName(s.drill) : REACTION_META.visual.label}</b>
                <span className="wu-step-r dim">{s.reason}</span>
              </li>
            ))}
          </ol>

          <div className="wu-go">
            <button className="btn primary lg" type="button" onClick={startRoutine}>
              {streak.state === 'done' ? 'WARM UP AGAIN' : 'START THE WARM-UP'}
            </button>
            <span className="dim wu-go-note">
              {streak.state === 'done'
                ? 'Today already counts. Another round is practice, not streak.'
                : 'Any finished routine counts — even one that stops early because you were getting worse.'}
            </span>
          </div>
          <WeekStrip profile={profile} today={today} />
        </section>

        <section className="panel pad">
          <div className="panel-title">Reaction tests</div>
          <p className="dim wu-sub">
            Thirty seconds each. They move with sleep and tiredness far more than with skill, which is
            what makes them a good thermometer. Every figure includes your screen, browser and mouse.
          </p>
          <div className="wu-rx">
            {REACTION_TESTS.map((id) => {
              const m = REACTION_META[id];
              const rec = w.reaction[id];
              const last = rec.runs[rec.runs.length - 1];
              const base = reactionBaseline(rec);
              return (
                <button
                  key={id}
                  type="button"
                  className="wu-rx-card"
                  style={{ ['--c' as string]: m.accent }}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    audio.unlock();
                    audio.play('uiClick');
                    setTesting({ test: id, calibrate: false });
                  }}
                >
                  <b className="display">{m.label}</b>
                  <span className="wu-rx-ask">{m.ask}</span>
                  <span className="wu-rx-num mono">
                    {rec.best !== null ? (
                      <>
                        {rec.best}
                        <small>ms best</small>
                      </>
                    ) : (
                      <small>not taken yet</small>
                    )}
                  </span>
                  <span className="wu-rx-meta mono dim">
                    {last ? `last ${last.median} ms` : m.why}
                    {base !== null ? ` · normal ${Math.round(base)}` : ''}
                  </span>
                  <Spark values={rec.runs.slice(-20).map((r) => r.median)} />
                </button>
              );
            })}
          </div>
        </section>

        <BenchSheet profile={profile} onBench={onBench} onTest={(t) => setTesting({ test: t, calibrate: false })} />

        <CodeBox onCode={onCode} />
      </div>

      {testing && (
        <ReactionTest
          key={`${testing.test}-${testing.calibrate}`}
          test={testing.test}
          bindings={bindings}
          best={w.reaction[testing.test].best}
          baseline={reactionBaseline(w.reaction[testing.test])}
          once={testing.calibrate}
          doneLabel={testing.calibrate ? 'START THE ROUTINE' : 'DONE'}
          onRecord={(run) => {
            if (testing.calibrate) {
              calib.current = run;
              // Your normal is read *before* today's run is added to it.
              calibDay.current = readDay(run, reactionBaseline(w.reaction.visual));
            }
            onReaction(testing.test, run);
          }}
          onClose={() => {
            const t = testing;
            setTesting(null);
            if (t.calibrate && calib.current) onStart(plan, calib.current, calibDay.current);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- summary

const DAY_LINE: Record<DayRead, string> = {
  sharp: 'You were quicker than your normal today.',
  normal: 'A normal day on the thermometer.',
  slow: 'Slower than your normal today — worth knowing before a ranked game.',
  unknown: 'Three more calibrations and the thermometer will know your normal.',
};

function SummaryCard({ summary, onDismiss }: { summary: WarmupSummary; onDismiss: () => void }) {
  const { session, previous } = summary;
  const [a, b] = session.reps;
  const within = a && b ? b.performance - a.performance : null;
  const prevBest = previous ? Math.max(...previous.reps.slice(0, 2).map((r) => r.performance)) : null;
  const nowBest = a ? Math.max(a.performance, b?.performance ?? 0) : null;
  const pts = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}`;
  return (
    <section className="panel pad wu-sum fade-in">
      <div className="wu-sum-top">
        <div>
          <div className="eyebrow">{session.stoppedEarly ? 'Stopped early — and it counts' : 'Warm-up complete'}</div>
          <h2 className="display wu-sum-h">{session.stoppedEarly ? 'COME BACK TOMORROW' : 'READY FOR RANKED'}</h2>
        </div>
        <button className="btn ghost" type="button" onClick={onDismiss}>
          Close
        </button>
      </div>

      <div className="wu-sum-grid">
        {within !== null && (
          <div className="wu-sum-cell">
            <span className="mono">{pts(within)}</span>
            <i>set 2 against set 1, in performance points</i>
          </div>
        )}
        {prevBest !== null && nowBest !== null && (
          <div className="wu-sum-cell">
            <span className="mono">{pts(nowBest - prevBest)}</span>
            <i>against your last warm-up on {session.focus ? drillName(session.focus) : 'this'} — did it stick overnight?</i>
          </div>
        )}
        {session.calibration !== null && (
          <div className="wu-sum-cell">
            <span className="mono">{session.calibration} ms</span>
            <i>{DAY_LINE[session.day]}</i>
          </div>
        )}
        <div className="wu-sum-cell">
          <span className="mono">{summary.streak}</span>
          <i>
            {summary.extended ? 'days in a row' : 'days in a row — today had already counted'}
            {summary.froze > 0 ? ` · ${summary.froze} freeze${summary.froze > 1 ? 's' : ''} spent on missed days` : ''}
            {summary.earned ? ' · a freeze was banked' : ''}
          </i>
        </div>
      </div>

      {session.stoppedEarly && (
        <p className="wu-sum-stop">
          Your second set was clearly worse than your first on a day your reactions were slower than
          normal. Past that point you are rehearsing tiredness, so the routine stopped. That is a
          finished warm-up, not a failed one.
        </p>
      )}

      {session.intention && (
        <blockquote className="wu-intent">
          <span className="eyebrow">In your next ranked game</span>
          {session.intention}
          {session.focusError && <small className="dim">because of {ERRORS[session.focusError].label.toUpperCase()}</small>}
        </blockquote>
      )}
    </section>
  );
}

// ----------------------------------------------------------------- streak

function StreakBadge({
  streak,
  best,
  freezes,
  state,
  missed,
}: {
  streak: number;
  best: number;
  freezes: number;
  state: ReturnType<typeof streakState>['state'];
  missed: number;
}) {
  const line =
    state === 'done'
      ? 'done today'
      : state === 'alive'
        ? 'warm up today to keep it'
        : state === 'frozen'
          ? `${missed} missed day${missed > 1 ? 's' : ''} — a freeze will cover ${missed > 1 ? 'them' : 'it'}`
          : state === 'broken'
            ? 'it starts again today'
            : 'your first day';
  const shown = state === 'broken' ? 0 : streak;
  return (
    <div className={`wu-streak s-${state}`} title={`Every ${FREEZE_EVERY} days in a row banks a freeze, up to ${MAX_FREEZES}. A freeze covers a missed day automatically.`}>
      <span className="wu-streak-n mono">{shown}</span>
      <span className="wu-streak-l">
        DAY STREAK
        <i>{line}</i>
        <i>
          best {best} · freezes {'◆'.repeat(freezes)}
          {'◇'.repeat(Math.max(0, MAX_FREEZES - freezes))}
        </i>
      </span>
    </div>
  );
}

/** The last fourteen days: done, frozen or missed. */
function WeekStrip({ profile, today }: { profile: Profile; today: string }) {
  const done = new Set(profile.warmup.sessions.map((s) => s.date));
  const frozen = new Set(profile.warmup.frozen);
  const days: { key: string; label: string }[] = [];
  const d = new Date();
  for (let i = 13; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    days.push({ key: todayKey(x), label: 'SMTWTFS'[x.getDay()] });
  }
  return (
    <div className="wu-week" aria-label="The last fourteen days">
      {days.map((x) => (
        <i
          key={x.key}
          className={`${done.has(x.key) ? 'done' : frozen.has(x.key) ? 'frozen' : ''}${x.key === today ? ' today' : ''}`}
          title={`${x.key}${done.has(x.key) ? ' — warmed up' : frozen.has(x.key) ? ' — freeze' : ''}`}
        >
          {x.label}
        </i>
      ))}
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="wu-spark" viewBox="0 0 100 24" aria-hidden="true" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(1, hi - lo);
  // Lower is better, so down on the page is up in skill: the line is flipped
  // to make an improving run of tests climb.
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${2 + ((v - lo) / span) * 20}`).join(' ');
  return (
    <svg className="wu-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// -------------------------------------------------------------- benchmarks

function BenchSheet({
  profile,
  onBench,
  onTest,
}: {
  profile: Profile;
  onBench: (b: BenchScenario) => void;
  onTest: (t: ReactionTestId) => void;
}) {
  const sum = benchSummary(profile.bench, profile.warmup);
  const tier = sum.tier >= 0 ? BENCH_TIERS[sum.tier] : null;
  return (
    <section className="panel pad wu-bench">
      <div className="wu-bench-head">
        <div>
          <div className="panel-title">Benchmarks · provisional</div>
          <p className="dim wu-sub">
            Eight fixed scenarios — same seed, same difficulty ({BENCH_DIFFICULTY}), same minute for everybody — so
            a score here means the same thing on anybody’s screen. You hold a tier once {BENCH_QUORUM} of the eight
            reach it. MASTER is exactly what the trainer’s scripted reference player scores; the lines will be
            re-cut from real players once there are enough of them. An APEX benchmark, not a League rank.
          </p>
        </div>
        <div className="wu-bench-badge" style={{ ['--c' as string]: tier ? BENCH_TIER_COLORS[tier] : 'var(--text-3)' }}>
          <b className="display">{tier ?? 'UNRANKED'}</b>
          <span className="mono">
            {sum.points} / {sum.max} pts
          </span>
          <i className="mono dim">{sum.played}/8 played</i>
        </div>
      </div>

      <div className="wu-bench-rows">
        {BENCH_SCENARIOS.map((b) => {
          const v = benchValue(b, profile.bench, profile.warmup);
          const place = benchPlace(b, v);
          const t = place.tier >= 0 ? BENCH_TIERS[place.tier] : null;
          const next = place.tier < BENCH_TIERS.length - 1 ? BENCH_TIERS[place.tier + 1] : null;
          const code = benchCode(b);
          return (
            <div className="wu-bench-row" key={b.id}>
              <span className="wu-b-name">
                <b>{b.label}</b>
                <i className="dim">{b.skill}</i>
              </span>
              <span className="wu-b-val mono">{v !== null ? `${fmt(v)} ${b.unit}` : '—'}</span>
              <span className="wu-b-tier" style={{ ['--c' as string]: t ? BENCH_TIER_COLORS[t] : 'var(--text-4)' }}>
                {t ?? 'UNRANKED'}
              </span>
              <span className="wu-b-bar" title={next ? `${next} at ${fmt(b.thresholds[place.tier + 1])} ${b.unit}` : 'top tier'}>
                <i style={{ width: `${Math.round(place.toNext * 100)}%`, ['--c' as string]: next ? BENCH_TIER_COLORS[next] : BENCH_TIER_COLORS.APEX }} />
                <em className="mono">{next ? `${next} ${fmt(b.thresholds[place.tier + 1])}` : 'TOP'}</em>
              </span>
              <span className="wu-b-go">
                {code && <code className="mono dim" title="Scenario code — send it to a friend">{code}</code>}
                <button
                  className="btn"
                  type="button"
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    audio.unlock();
                    audio.play('uiClick');
                    if (b.kind === 'reaction' && b.test) onTest(b.test);
                    else onBench(b);
                  }}
                >
                  {b.kind === 'reaction' ? 'TEST' : 'PLAY'}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- codes

function CodeBox({ onCode }: { onCode: (c: ScenarioCode) => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = () => {
    const r = decodeScenario(text);
    if ('error' in r) {
      setErr(r.error);
      audio.play('castRefuse');
      return;
    }
    setErr(null);
    audio.unlock();
    audio.play('uiClick');
    onCode(r);
  };
  return (
    <section className="panel pad wu-code">
      <div className="panel-title">Play a scenario code</div>
      <p className="dim wu-sub">
        Every results screen prints a code for the minute you just played. Paste one a friend sent and you get
        the same start — same spawns, same wave, same opening move from the other side. After that it answers
        what <em>you</em> do, so it is the same course, not the same recording.
      </p>
      <form
        className="wu-code-row"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <input
          className="mono"
          value={text}
          placeholder="vayneTumble-P50-fl4ma-J"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setErr(null);
          }}
          aria-label="Scenario code"
        />
        <button className="btn primary" type="submit" disabled={!text.trim()}>
          PLAY CODE
        </button>
      </form>
      {err && <p className="wu-code-err">{err}</p>}
    </section>
  );
}
