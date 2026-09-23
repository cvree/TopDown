import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { newSeed } from '../engine/rng';
import type { Tape } from '../engine/tape';
import { DRILLS, type DrillId } from '../drills/catalog';
import { RUN_MODES, practiceFor, type RunMode } from '../drills/modes';
import {
  applyRun,
  drillDifficulty,
  loadProfile,
  newProfile,
  resetProfile,
  rollDaily,
  saveProfile,
  type AppSettings,
  type Profile,
  type ProgressReport,
  type RunResult,
} from '../progression/profile';
import { LANE_TIERS, laneTierOf } from '../progression/lane';
import { APM_LEVELS, levelDifficulty, openApmLadderAt } from '../progression/apm';
import { clamp } from '../engine/math';
import { rankFromRating, type RankInfo } from '../progression/ranks';
import { PATCH_NOTES, VERSION } from '../patchnotes/notes';
import type { SkillAxis } from '../progression/skills';
import { ArenaBackdrop, type ArenaStage } from './components/ArenaBackdrop';
import { Boot } from './Boot';
import { MILESTONES, type Milestone } from './boot/variants';
import { Crest } from './components/Crest';
import { GestureNotice, hasBrowserMouseGestures } from './components/GestureNotice';
import { GameView } from './GameView';
import { ErrorBoundary } from './ErrorBoundary';
import { Lab } from './Lab';
import { Practice } from './Practice';
import { Progress } from './Progress';
import { PatchNotes } from './PatchNotes';
import { RankEmblem } from './components/RankEmblem';
import { Ticker } from './components/Ticker';
import { RankUp } from './RankUp';
import { Results } from './Results';
import { Settings } from './Settings';
import { Welcome, type WelcomeResult } from './Welcome';
import { WarmUp, type WarmupSummary } from './WarmUp';
import { isCalm, setCalm } from './motion';
import { launch, trackLaunches } from './launch';
import {
  BENCH_DIFFICULTY,
  BENCH_SCENARIOS,
  BENCH_TIERS,
  benchFor,
  benchPlace,
  encodeScenario,
  recordBench,
  type BenchScenario,
  type ScenarioCode,
} from '../progression/benchmarks';
import {
  drillName,
  finishWarmup,
  lastWarmupOn,
  recordReaction,
  shouldStop,
  type DayRead,
  type ReactionRun,
  type ReactionTestId,
  type StopReason,
  type WarmupPlan,
  type WarmupRep,
} from '../progression/warmup';
import '../styles/global.css';
import './app.css';

/**
 * The sections.
 *
 * Four, and one of them is setup. The client used to have seven tabs, four
 * ladders, a daily plan and a calibration sequence, which between them meant a
 * player had to learn the *client* before they could practise; everything that
 * was really a way of choosing a run is now two buttons on a card.
 *
 * The split between the first two is the whole shape of the trainer, so it is
 * made in the top bar rather than inside a screen. **PRACTICE** is a champion:
 * her lane, her kit in pieces, and every number both are built from. **THE
 * LAB** is not a champion at all — it is thirteen benches measuring how fast
 * your hands are actually right, which is the layer underneath every champion
 * anyone will ever add. The lab spent a release as the third tab of the
 * champion screen and read, from there, as one more thing about Vayne.
 */
type Route = 'warmup' | 'practice' | 'lab' | 'progress' | 'settings' | 'patch';

/** The top bar, in order. Setup and the patch notes live in the corner. */
const NAV: { route: Route; label: string; hint: string }[] = [
  { route: 'warmup', label: 'WARM UP', hint: 'Ten minutes a day: reaction check, your mistake twice, hands, pressure' },
  { route: 'practice', label: 'PLAY', hint: 'Lane against somebody, or rehearse one piece of the champion' },
  { route: 'lab', label: 'TRAIN', hint: 'One-minute drills for your hands' },
  { route: 'progress', label: 'PROGRESS', hint: 'Your scores, and whether they are going up' },
];

/**
 * A ladder's per-rung records, copied one level deeper than a spread goes.
 *
 * `applyRun` writes a champion path's stage record in place — which is right,
 * because a path is a ledger rather than a value — so every ladder it touches
 * has to be handed a copy of its own rungs before it runs. A shallow spread of
 * the path is not enough: it copies the map and shares every record in it.
 */
const copyRungs = <T,>(rungs: T): T =>
  Object.fromEntries(
    Object.entries(rungs as Record<string, object>).map(([k, v]) => [k, { ...v }]),
  ) as T;

/** One run: a mode of a mode. */
interface Flow {
  drill: DrillId;
  mode: RunMode;
  seed: number;
  /**
   * What the menu chose, where the menu chooses.
   *
   * Every other mode in the client works out its own difficulty from the
   * ladder and its own length from the run mode, and that is right: a rep is
   * comparable precisely because nobody picked its settings. The lane is the
   * one place the choice belongs to the player — which opponent, and how long
   * a lane — because those are not settings, they are the thing being played.
   */
  difficulty?: number;
  duration?: number;
  /**
   * The lab's rung, when the lab is what is being played.
   *
   * It travels beside the difficulty rather than being inferred from it: the
   * record this run writes belongs to a *level*, and reading a level back out
   * of a difficulty is a second opinion about the same fact and a second
   * chance for the two to disagree.
   */
  level?: number;
  /**
   * The rung an infinite run settled at, once it has been played.
   *
   * Kept on the flow rather than read back out of the result, because the
   * button that uses it — "play the level it found" — has to still be right
   * after the results screen has been dismissed and re-entered.
   */
  heldLevel?: number;
  /**
   * The seed is part of what is being played, not a fresh roll per attempt:
   * a benchmark or a pasted code is one particular minute, and "run again"
   * has to mean that minute again.
   */
  fixedSeed?: boolean;
  /** The benchmark this run is being scored against, if it is one. */
  bench?: string;
  /** The warm-up this run is a step of, if it is one. */
  warm?: WarmState;
  /**
   * Where a rewind asked this run to restart: the tape so far and the step to
   * rebuild to. Set by the rewind key, cleared by anything that starts a new
   * attempt.
   */
  rewind?: { tape: Tape; steps: number; still?: string | null };
  /**
   * Rewinds taken in this attempt. Any at all makes it practice: a run you can
   * go back inside is a run whose score could be edited, so it is scored for
   * you to see and written to nothing.
   */
  rewinds?: number;
}

/** The same run, as a new attempt: no rewind to rebuild, none taken. */
const fresh = (f: Flow): Flow => ({ ...f, rewind: undefined, rewinds: undefined });

/** A warm-up in progress: the plan, which step is on screen, and what the steps before it scored. */
interface WarmState {
  plan: WarmupPlan;
  step: number;
  /** Indexed by step. The calibration step never has one. */
  reps: (WarmupRep | undefined)[];
  calibration: ReactionRun | null;
  day: DayRead;
}

interface ResultState {
  result: RunResult;
  report: ProgressReport;
  bounds: { w: number; h: number };
  /** This drill's score the run before, for the line under the number. */
  lastScore: number | null;
}

/** The most recent score of a drill in the history, before the run being shown. */
const lastScoreOf = (p: Profile, drill: DrillId): number | null => {
  for (let i = p.history.length - 1; i >= 0; i--) if (p.history[i].drill === drill) return p.history[i].score;
  return null;
};

export function App() {
  const [profile, setProfile] = useState<Profile>(() => {
    const p = loadProfile();
    rollDaily(p);
    return p;
  });
  // The profile as of the last render, for the two places that have to build
  // the next one synchronously: a run finishing and a warm-up closing.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  // A returning player opens on the warm-up; a new one on the champion, which
  // the walkthrough is about to send them past anyway.
  const [route, setRouteNow] = useState<Route>(() => (profile.onboarded ? 'warmup' : 'practice'));
  const routeRef = useRef(route);
  routeRef.current = route;
  /**
   * Go somewhere, as a move rather than a swap: the new screen comes in from
   * the side its tab is on. Screens outside the tab order (setup, the patch
   * notes) simply cross-fade.
   */
  const setRoute = useCallback((next: Route | ((r: Route) => Route)) => {
    const to = typeof next === 'function' ? next(routeRef.current) : next;
    const from = routeRef.current;
    if (to === from) return;
    const a = NAV.findIndex((n) => n.route === from);
    const b = NAV.findIndex((n) => n.route === to);
    const dir = a >= 0 && b >= 0 ? Math.sign(b - a) : 0;
    const root = document.documentElement.style;
    root.setProperty('--nav-x', String(dir));
    root.setProperty('--nav-y', dir === 0 ? '1' : '0');
    setRouteNow(to);
  }, []);
  const [warmSummary, setWarmSummary] = useState<WarmupSummary | null>(null);
  const [benchNote, setBenchNote] = useState<{ eyebrow: string; line: string; tone?: 'good' | 'warn' } | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [results, setResults] = useState<ResultState | null>(null);
  const [rankUp, setRankUp] = useState<{
    from: RankInfo;
    to: RankInfo;
    driver: { axis: SkillAxis; delta: number } | null;
    headline: { label: string; value: string } | null;
  } | null>(null);
  // The cold open. `booted` gates the client; `arenaStage` is what the boot
  // screen's loading bar is actually measuring — the arena reporting each
  // piece of itself as it lands, ending with its first rendered frame.
  const [booted, setBooted] = useState(false);
  const [arenaStage, setArenaStage] = useState<Milestone>('boot');
  // Milestones only ever go forwards. The backdrop can bail out at any point
  // and jump straight to `frame`, and a late `scene` from a torn-down build
  // must never walk the bar backwards.
  const onArenaStage = useCallback((s: ArenaStage) => {
    setArenaStage((prev) => (MILESTONES.indexOf(s) > MILESTONES.indexOf(prev) ? s : prev));
  }, []);
  const enterClient = useCallback(() => setBooted(true), []);
  /**
   * The walkthrough. Null is "not showing"; the two live values are the only
   * two reasons it is ever on screen — a first run, or the "?" in the top bar.
   *
   * A first run opens it automatically the moment the client is entered, so
   * the very first thing anybody ever sees is six plain questions rather than
   * a grid of thirteen cards written in a vocabulary they have not been given.
   */
  const [tour, setTour] = useState<'first' | 'replay' | null>(null);
  /** Moves whenever the results on screen are left, so a pending rank-up knows it is stale. */
  const rankToken = useRef(0);
  const saveTimer = useRef(0);

  // Persist, but never on the frame a run ends — writes are debounced so a
  // localStorage stall can't stutter the results reveal.
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveProfile(profile), 220);
    return () => window.clearTimeout(saveTimer.current);
  }, [profile]);

  useEffect(() => {
    audio.masterVolume = profile.settings.masterVolume;
    audio.sfxVolume = profile.settings.sfxVolume;
    audio.musicVolume = profile.settings.musicVolume;
    audio.muted = profile.settings.muted;
    // The buzzer, the refusal and the failure tone. Everything else — every
    // confirmation, every telegraph, the whole arena — is untouched.
    audio.negativeSfx = profile.settings.negativeFeedback === true;
    audio.applyVolumes();
  }, [profile.settings]);

  // Which card started a run, so its picture can become the run.
  useEffect(() => trackLaunches(), []);

  // Reduced effects is also a request for calm motion; so is the OS switch.
  useEffect(() => setCalm(profile.settings.lowFx), [profile.settings.lowFx]);

  // Opened once, on the frame the client is entered, and never again — the
  // profile is marked the moment it is dismissed either way.
  useEffect(() => {
    if (booted && !profile.onboarded) setTour('first');
  }, [booted, profile.onboarded]);

  const inGame = flow !== null && !results;

  useEffect(() => {
    if (!booted || inGame || profile.settings.muted) audio.stopAmbience();
    else audio.startAmbience();
  }, [booted, inGame, profile.settings.muted]);

  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setProfile((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  }, []);

  // ------------------------------------------------------------ Esc = setup
  //
  // Escape is the settings key everywhere in the client, not only inside a
  // run: it opens this screen from any menu and closes it again. A player who
  // wants to change a binding should never have to go looking for the gear —
  // and the same key doing the same thing in the menus and in a drill is what
  // makes it findable in the first place.
  //
  // Inside a run GameView owns Escape (it has a session to pause first), so
  // this only listens while there is no run on screen.
  useEffect(() => {
    if (!booted || flow || tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || e.defaultPrevented) return;
      const el = document.activeElement;
      // The settings search box clears itself on Escape before the screen
      // closes, so a search in progress is not a trapdoor out of the section
      // you were reading.
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.value !== '') return;
        el.blur();
      }
      e.preventDefault();
      audio.play(route === 'settings' ? 'uiBack' : 'uiTab');
      setRoute((r) => (r === 'settings' ? 'practice' : 'settings'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booted, flow, route, tour]);

  // -------------------------------------------------------------- back guard
  //
  // Opera ships mouse gestures on by default, and two of them are built from
  // the exact inputs this trainer uses: right-drag-left and the right+left
  // "rocker" both mean Back. A stray one used to unload the page and take the
  // run with it, which reads as the game restarting at random.
  //
  // While a run is live an extra history entry sits on top of the stack, so a
  // Back lands here instead of off-site: we swallow it, re-arm, and the run
  // carries on. Esc is still the way out. The entry is popped again the moment
  // the run ends, so Back behaves normally everywhere else on the site.
  const runInProgress = flow !== null;
  const guard = useRef({ armed: false, live: false });
  guard.current.live = runInProgress;

  useEffect(() => {
    if (!runInProgress) return;
    guard.current.armed = true;
    window.history.pushState({ apexBackGuard: true }, '');
    return () => {
      if (!guard.current.armed) return;
      guard.current.armed = false;
      window.history.back();
    };
  }, [runInProgress]);

  useEffect(() => {
    const onPop = () => {
      const g = guard.current;
      // Not our entry: let the browser navigate as the player asked.
      if (!g.armed) return;
      g.armed = false;
      if (!g.live) return;
      g.armed = true;
      window.history.pushState({ apexBackGuard: true }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ------------------------------------------------------------- flow start

  const startRun = useCallback(
    (
      drill: DrillId,
      mode: RunMode,
      opts: {
        difficulty?: number;
        duration?: number;
        level?: number;
        seed?: number;
        bench?: string;
        warm?: WarmState;
      } = {},
    ) => {
      audio.unlock();
      // From a card, the card's picture grows into the run; see launch.ts.
      launch(() => {
        setResults(null);
        setBenchNote(null);
        setFlow({
          drill,
          mode,
          seed: opts.seed ?? newSeed(),
          fixedSeed: opts.seed !== undefined,
          difficulty: opts.difficulty,
          duration: opts.duration,
          level: opts.level,
          bench: opts.bench,
          warm: opts.warm,
        });
      });
    },
    [],
  );

  const difficulty = useMemo(
    () => (flow ? flow.difficulty ?? drillDifficulty(profile, flow.drill) : 0.35),
    // Difficulty is read once per run; recomputing mid-run would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow?.drill, flow?.seed, flow?.difficulty],
  );

  // ---------------------------------------------------------- run finished

  const handleComplete = useCallback(
    (result: RunResult, bounds: { w: number; h: number }) => {
      if (!flow) return;
      if (result.endReason === 'abort') {
        // An instant reset is a fresh attempt, not a recorded run.
        setFlow({ ...fresh(flow), seed: flow.fixedSeed ? flow.seed : newSeed() });
        return;
      }

      // A rewound run is practice. It is scored against a copy of the profile
      // so the results screen can show everything it normally shows — and the
      // copy is thrown away, so no record, ladder, rating or benchmark moves.
      if (flow.rewinds) {
        const report = applyRun(structuredClone(profileRef.current), result, flow.level ? { level: flow.level } : {});
        const lastScore = lastScoreOf(profileRef.current, result.drill);
        window.setTimeout(() => setResults({ result, report, bounds, lastScore }), 0);
        return;
      }

      // A warm-up step keeps what it scored, so the next step can be chosen
      // and the summary can compare set two with set one. A retried step
      // overwrites its own slot rather than adding one.
      if (flow.warm) {
        const w = flow.warm;
        const reps = [...w.reps];
        reps[w.step] = { drill: result.drill, score: result.score, performance: result.performance };
        setFlow((f) => (f ? { ...f, warm: { ...w, reps } } : f));
      }

      // The rung the tide settled at, kept for the button that offers to play
      // it for score. Read off the run's own metric rather than recomputed,
      // so the menu and the ladder are quoting the same number.
      if (flow.mode === 'infinite') {
        const held = result.keyMetrics.find((m) => m.id === 'labHeld')?.value;
        if (held !== undefined) setFlow((f) => (f ? { ...f, heldLevel: held } : f));
      }

      // Computed here, synchronously, from the profile as it stands, and then
      // handed to React — rather than inside a state updater and read back a
      // tick later. An updater only runs early when it is the first update of
      // its batch; a warm-up step queues one before it, and the report came
      // back empty.
      const prev = profileRef.current;
      const next: Profile = {
        ...prev,
        ratings: { ...prev.ratings },
        samples: { ...prev.samples },
        difficulty: { ...prev.difficulty },
        bests: { ...prev.bests },
        survive: { ...prev.survive },
        history: [...prev.history],
        daily: { ...prev.daily, completed: [...prev.daily.completed] },
        dailyMarks: [...prev.dailyMarks],
        // The champion paths are written in place by applyRun, so they have
        // to be copied down to the records or the previous state would move
        // with them — and a "previous" that moves is a results screen that
        // cannot tell you what changed.
        vayne: { ...prev.vayne, stages: copyRungs(prev.vayne.stages) },
        twisted: { ...prev.twisted, stages: copyRungs(prev.twisted.stages) },
        ezreal: { ...prev.ezreal, stages: copyRungs(prev.ezreal.stages) },
        recentBests: [...prev.recentBests],
        bench: Object.fromEntries(Object.entries(prev.bench).map(([k, v]) => [k, v && { ...v }])),
      };
      const report: ProgressReport = applyRun(next, result, flow.level ? { level: flow.level } : {});
      // A new record is shown landing in its row the next time PROGRESS is
      // opened, once. Remembered by the run's own timestamp.
      const newest = next.history[next.history.length - 1];
      if (report.newBestScore && newest) next.freshRecords = [...prev.freshRecords.slice(-9), newest.t];
      // A benchmark is only a benchmark on its own terms: its seed, its
      // difficulty, one minute. A run that was re-rolled or reset is not.
      const b = flow.bench ? benchFor(result.drill, result.seed) : null;
      if (b && result.mode === 'play' && Math.abs(result.difficulty - BENCH_DIFFICULTY) < 1e-6) {
        const before = benchPlace(b, next.bench[b.id]?.best ?? null).tier;
        const beat = recordBench(next.bench, b.id, result.score);
        const after = benchPlace(b, next.bench[b.id]?.best ?? null).tier;
        const name = (t: number) => (t >= 0 ? BENCH_TIERS[t] : 'UNRANKED');
        const first = (next.bench[b.id]?.runs ?? 0) === 1;
        const fmtN = (v: number) => Math.round(v).toLocaleString('en-US');
        const up = after < b.thresholds.length - 1 ? `${BENCH_TIERS[after + 1]} is at ${fmtN(b.thresholds[after + 1])}.` : 'Top of the sheet.';
        setBenchNote({
          eyebrow: `Benchmark · ${b.label}`,
          line: first
            ? `First run on this benchmark: ${fmtN(result.score)} — ${name(after)}. ${up}`
            : after > before
              ? `${name(before)} → ${name(after)}. New record: ${fmtN(result.score)}. ${up}`
              : beat
                ? `New record: ${fmtN(result.score)} — still ${name(after)}. ${up}`
                : `Record stands at ${fmtN(next.bench[b.id]?.best ?? 0)} (${name(after)}). Same seed on RUN AGAIN.`,
          tone: after > before || (beat && !first) ? 'good' : undefined,
        });
      }
      profileRef.current = next;
      setProfile(next);

      window.setTimeout(() => {
        const rep = report;
        setResults({ result, report: rep, bounds, lastScore: lastScoreOf(prev, result.drill) });
        if (rep.promoted) {
          const driver = rep.axisChanges.reduce<{ axis: SkillAxis; delta: number } | null>(
            (acc, c) => (!acc || c.delta > acc.delta ? { axis: c.axis, delta: c.delta } : acc),
            null,
          );
          const head = result.keyMetrics[0];
          // After the number has landed, not over it: one voice at a time.
          // Anything that leaves these results first — a retry, the next
          // run, the menu — cancels it.
          const token = rankToken.current;
          window.setTimeout(
            () => {
              if (rankToken.current !== token) return;
              setRankUp({
                from: rep.rankBefore,
                to: rep.rankAfter,
                driver,
                headline: head
                  ? { label: `Best ${head.label.toLowerCase()}`, value: formatHead(head.value, head.format) }
                  : null,
              });
            },
            isCalm() ? 0 : 1300,
          );
        }
      }, 0);
    },
    [flow],
  );

  // The ceremony, on demand — for the recorder and nobody else. Off unless
  // ?debug is present, exactly like the arena's own handle, so it never ships
  // as a stray global and never touches a record: it only puts the overlay up.
  useEffect(() => {
    if (typeof location === 'undefined' || !location.search.includes('debug')) return;
    const w = window as unknown as { __apexShow?: unknown };
    w.__apexShow = {
      rankUp: (fromRating: number, toRating: number) =>
        setRankUp({
          from: rankFromRating(fromRating),
          to: rankFromRating(toRating),
          driver: { axis: 'movement', delta: Math.round(toRating - fromRating) },
          headline: null,
        }),
    };
    return () => {
      delete w.__apexShow;
    };
  }, []);

  /** A rule was explained in a run; it will not be explained again. */
  const onTaught = useCallback((key: string) => {
    setProfile((p) => (p.taught.includes(key) ? p : { ...p, taught: [...p.taught, key] }));
  }, []);

  /** Go back inside this run: remount it rebuilt to `steps`, same seed. */
  const onRewind = useCallback((tape: Tape, steps: number, still: string | null) => {
    setResults(null);
    setRankUp(null);
    rankToken.current++;
    setFlow((f) => (f ? { ...f, rewind: { tape, steps, still }, rewinds: (f.rewinds ?? 0) + 1 } : f));
  }, []);

  const retry = useCallback(() => {
    if (!flow) return;
    setResults(null);
    setRankUp(null);
    rankToken.current++;
    setBenchNote(null);
    setFlow({ ...fresh(flow), seed: flow.fixedSeed ? flow.seed : newSeed() });
  }, [flow]);

  /**
   * Close a warm-up: write the session, extend the streak, and put the summary
   * on the warm-up screen. `stopped` is the stop rule firing, or a player who
   * left after the two sets that were the point of it.
   */
  const finishWarm = useCallback((w: WarmState, stopped: StopReason | null) => {
    const reps = w.reps.filter((r): r is WarmupRep => !!r);
    const prev = profileRef.current;
    const next: Profile = { ...prev, warmup: structuredClone(prev.warmup) };
    const previous = lastWarmupOn(prev.warmup, w.plan.focus, Date.now());
    const done = finishWarmup(next, w.plan, reps, w.calibration, w.day, stopped);
    profileRef.current = next;
    setProfile(next);
    setWarmSummary({ session: done.session, ...done.streak, streak: next.warmup.streak, previous });
    setResults(null);
    setRankUp(null);
    rankToken.current++;
    setFlow(null);
    setRouteNow('warmup');
    audio.play('personalBest');
  }, []);

  const exitToMenu = useCallback(() => {
    // Leaving a warm-up after its two sets still counts: those were the
    // point of it. Leaving before them is simply leaving.
    if (flow?.warm && flow.warm.reps.filter(Boolean).length >= 2) {
      finishWarm(flow.warm, 'left');
      return;
    }
    setResults(null);
    setRankUp(null);
    rankToken.current++;
    setFlow(null);
    audio.play('uiBack');
  }, [flow, finishWarm]);

  /**
   * The other mode of the run you just played, without going back to the menu.
   *
   * The lane has no other mode — it is one shape of run with an opponent
   * attached — so there the same button means the next opponent up, at the
   * same length. That is the thing a player actually wants after a lane that
   * went well, and it is the one place in the client where "harder" is a
   * choice rather than a consequence of the ladder.
   */
  const switchMode = useCallback(() => {
    if (!flow) return;
    if (flow.warm) {
      const w = flow.warm;
      const next = warmNext(w);
      if (next === null) {
        finishWarm(w, w.step === 2 && warmStops(w) ? 'rule' : null);
        return;
      }
      const step = w.plan.steps[next];
      setResults(null);
      setRankUp(null);
      rankToken.current++;
      setFlow({
        drill: step.drill ?? w.plan.focus,
        mode: 'play',
        seed: newSeed(),
        difficulty: step.difficulty,
        level: step.level,
        warm: { ...w, step: next },
      });
      return;
    }
    // A benchmark's "next" is the next row of the sheet, the way a KovaaK's
    // playlist runs: six minutes, six rows, one key between them.
    if (flow.bench) {
      const nb = nextBench(flow.bench);
      if (nb?.drill && nb.seed !== undefined) {
        setResults(null);
        setRankUp(null);
        rankToken.current++;
        setBenchNote(null);
        setFlow({ drill: nb.drill, mode: 'play', seed: nb.seed, fixedSeed: true, difficulty: BENCH_DIFFICULTY, bench: nb.id });
        return;
      }
    }
    setResults(null);
    setRankUp(null);
    rankToken.current++;
    if (flow.drill === 'lanePhase') {
      const i = LANE_TIERS.findIndex((t) => t.id === laneTierOf(flow.difficulty ?? 0.32).id);
      const next = LANE_TIERS[Math.min(LANE_TIERS.length - 1, i + 1)];
      setFlow({ ...fresh(flow), difficulty: next.difficulty, seed: newSeed() });
      return;
    }
    // An infinite run's "next" is the rung it just found, played for score:
    // the whole point of the tide is to hand you a level worth playing, and
    // the only way to put one on the board is a one-minute rep at it.
    if (flow.mode === 'infinite') {
      const held = clamp(Math.round(flow.heldLevel ?? flow.level ?? 1), 1, APM_LEVELS);
      setFlow({
        ...fresh(flow),
        mode: 'play',
        level: held,
        difficulty: levelDifficulty(held),
        heldLevel: undefined,
        seed: newSeed(),
      });
      return;
    }
    // A surge run's "next" is the same rung played straight: the streak was
    // the difficulty, so the only way to find out what the rung is actually
    // worth is to play it with the floor nailed down.
    if (flow.mode === 'surge') {
      setFlow({ ...fresh(flow), mode: 'play', seed: newSeed() });
      return;
    }
    setFlow({ ...fresh(flow), mode: flow.mode === 'play' ? 'survive' : 'play', seed: newSeed() });
  }, [flow, finishWarm]);

  // ------------------------------------------------------------- warm-up

  const startWarm = useCallback(
    (plan: WarmupPlan, calibration: ReactionRun | null, day: DayRead) => {
      setWarmSummary(null);
      const first = plan.steps.findIndex((s) => s.drill);
      const step = plan.steps[first];
      if (!step?.drill) return;
      startRun(step.drill, 'play', {
        difficulty: step.difficulty,
        level: step.level,
        warm: { plan, step: first, reps: [], calibration, day },
      });
    },
    [startRun],
  );

  const onReaction = useCallback((test: ReactionTestId, run: ReactionRun) => {
    setProfile((p) => {
      const next: Profile = { ...p, warmup: structuredClone(p.warmup) };
      recordReaction(next.warmup, test, run);
      return next;
    });
  }, []);

  const playBench = useCallback(
    (b: BenchScenario) => {
      if (!b.drill || b.seed === undefined) return;
      startRun(b.drill, 'play', { difficulty: BENCH_DIFFICULTY, seed: b.seed, bench: b.id });
    },
    [startRun],
  );

  const playCode = useCallback(
    (c: ScenarioCode) => {
      // A pasted benchmark code is the benchmark, and records as one.
      const b = c.mode === 'play' && Math.abs(c.difficulty - BENCH_DIFFICULTY) < 1e-6 ? benchFor(c.drill, c.seed) : null;
      startRun(c.drill, c.mode, { difficulty: c.difficulty, seed: c.seed, bench: b?.id });
    },
    [startRun],
  );

  // Opening the notes is what marks them read; nothing else clears the dot,
  // and a player who never opens them keeps it. The marking is done by the
  // screen itself, one frame in, so it can still show you what was new.
  const markPatchRead = useCallback(() => {
    setProfile((p) => (p.seenVersion === VERSION ? p : { ...p, seenVersion: VERSION }));
  }, []);

  /**
   * What the walkthrough hands back.
   *
   * Three things, and each of them is an ordinary setting somebody could have
   * reached themselves: their name, the way they move, and the level every
   * drill card opens on. Nothing here is a gate and nothing is awarded — the
   * measured level only moves where the arrows start.
   */
  const finishTour = useCallback((r: WelcomeResult) => {
    setProfile((p) => {
      const next: Profile = {
        ...p,
        name: r.name,
        onboarded: true,
        settings: { ...p.settings, movementScheme: r.scheme },
        apm: { ...p.apm, modes: { ...p.apm.modes } },
      };
      openApmLadderAt(next.apm, r.level);
      return next;
    });
    setTour(null);
    setRouteNow('lab');
  }, []);

  const skipTour = useCallback(() => {
    setProfile((p) => (p.onboarded ? p : { ...p, onboarded: true }));
    setTour(null);
    audio.play('uiBack');
  }, []);

  const doReset = useCallback(() => {
    resetProfile();
    setProfile(newProfile());
    setRouteNow('practice');
    // A wiped profile has never been onboarded, so the walkthrough is the
    // right first screen again — the same one a new player gets.
    setTour('first');
  }, []);

  const rank = rankFromRating(profile.overall);
  // Only ever shown to browsers that actually ship gestures, and only until
  // it has been read once.
  const showGestureNotice = useMemo(
    () => !profile.settings.gestureNoticeDismissed && hasBrowserMouseGestures(),
    [profile.settings.gestureNoticeDismissed],
  );

  // ------------------------------------------------------------------ render

  if (flow) {
    return (
      <>
        <GameView
          key={`${flow.drill}-${flow.mode}-${flow.seed}-${flow.rewinds ?? 0}`}
          rewind={flow.rewind ?? null}
          onRewind={onRewind}
          taught={profile.taught}
          onTaught={onTaught}
          drill={flow.drill}
          mode={flow.mode}
          difficulty={difficulty}
          durationOverride={flow.duration}
          seed={flow.seed}
          settings={profile.settings}
          onSettingsChange={patchSettings}
          context={
            (flow.drill === 'lanePhase'
              ? `LANE PHASE · ${laneTierOf(difficulty).label}`
              : flow.mode === 'infinite'
                ? `${DRILLS[flow.drill].name} · ENDLESS · started at level ${flow.level ?? 1}`
                : flow.mode === 'surge'
                  ? `${DRILLS[flow.drill].name} · SURGE · from level ${flow.level ?? 1}`
                  : `${DRILLS[flow.drill].name} · ${RUN_MODES[flow.mode].label}`) +
            (flow.rewinds ? ` · REWOUND ×${flow.rewinds} · PRACTICE ONLY` : '')
          }
          onComplete={handleComplete}
          onExit={exitToMenu}
          onRetry={retry}
        />
        {results && (
          <Results
            result={results.result}
            report={results.report}
            bounds={results.bounds}
            lastScore={results.lastScore}
            onRetry={retry}
            onExit={exitToMenu}
            onNext={switchMode}
            code={
              flow.warm || flow.mode === 'infinite' || flow.mode === 'surge'
                ? null
                : encodeScenario({ drill: flow.drill, mode: flow.mode, difficulty, seed: flow.seed })
            }
            banner={
              flow.rewinds
                ? {
                    eyebrow: `Rewound ×${flow.rewinds} · practice`,
                    line: 'Scored for you to see, and written to nothing — no record, ladder, rating or benchmark moved. Run again for one that counts.',
                    tone: 'warn',
                  }
                : flow.warm
                  ? warmBanner(flow.warm)
                  : benchNote
            }
            nextLabel={
              flow.warm
                ? warmNextLabel(flow.warm)
                : flow.bench && nextBench(flow.bench)
                  ? `Next benchmark: ${nextBench(flow.bench)?.label}`
                : flow.drill === 'lanePhase'
                ? `Lane against ${
                    LANE_TIERS[
                      Math.min(
                        LANE_TIERS.length - 1,
                        LANE_TIERS.findIndex((t) => t.id === laneTierOf(flow.difficulty ?? 0.32).id) + 1,
                      )
                    ].label
                  }`
                : flow.mode === 'infinite'
                  ? `Play level ${clamp(Math.round(flow.heldLevel ?? flow.level ?? 1), 1, APM_LEVELS)} for a score`
                  : flow.mode === 'surge'
                    ? `Play level ${clamp(Math.round(flow.level ?? 1), 1, APM_LEVELS)} at a fixed speed`
                    : `Try ${RUN_MODES[flow.mode === 'play' ? 'survive' : 'play'].label}`
            }
          />
        )}
        {rankUp && (
          <RankUp
            from={rankUp.from}
            to={rankUp.to}
            driver={rankUp.driver}
            headline={rankUp.headline}
            onDone={() => setRankUp(null)}
          />
        )}
      </>
    );
  }

  // A profile that has read an older release, or none at all, has something
  // waiting. A brand-new profile starts level with the build and does not.
  const unreadPatch = profile.seenVersion !== VERSION;

  return (
    <div className="app">
      <ArenaBackdrop
        enabled={!profile.settings.lowFx}
        hero={profile.settings.hero}
        onStage={onArenaStage}
      />
      {!booted && <Boot stage={arenaStage} onEnter={enterClient} />}
      {booted && tour && (
        <Welcome
          key={tour}
          name={profile.name}
          scheme={profile.settings.movementScheme}
          replay={tour === 'replay'}
          onDone={finishTour}
          onSkip={skipTour}
        />
      )}
      {booted && (
        <div className="shell">
          <header className="topbar">
            <div className="logo" onClick={() => setRoute('practice')}>
              <Crest size={26} />
              APEX
              {/* The subtitle used to be one champion's name, from when there
                  was one. It is what the client trains, which is now a pair. */}
              <span className="logo-sub">THE RIFT</span>
            </div>

            <nav className="nav">
              {NAV.map((n) => (
                <button
                  key={n.route}
                  className={route === n.route ? 'on' : ''}
                  title={n.hint}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    audio.unlock();
                    audio.play('uiTab');
                    setRoute(n.route);
                  }}
                >
                  {n.label}
                </button>
              ))}
              <NavInk index={NAV.findIndex((n) => n.route === route)} />
            </nav>

            <div className="topbar-right">
              {/* Setup: always reachable, never a nav tab — it is a thing you
                  do once and then forget about. */}
              {/* The walkthrough, on a button, forever. A tour you can only
                  ever see once is a tour nobody trusts themselves to skip. */}
              <button
                className="help-chip"
                title="How this works — the walkthrough again"
                aria-label="Show me around"
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiTab');
                  setTour('replay');
                }}
              >
                ?
              </button>
              <button
                className={`gear-chip${route === 'settings' ? ' on' : ''}`}
                title="Controls, audio and video — Esc"
                aria-label="Settings"
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiTab');
                  setRoute('settings');
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <circle cx="12" cy="12" r="3.2" />
                  <path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1" />
                </svg>
                <span>SETUP</span>
              </button>
              {/* The build, and whether there is anything in it you have not
                  read. A version number in a corner is also the first thing
                  anyone needs when reporting that something behaves oddly. */}
              <button
                className={`ver-chip${route === 'patch' ? ' on' : ''}`}
                title={
                  unreadPatch
                    ? `New in v${VERSION} — ${PATCH_NOTES[0].name}`
                    : `Running v${VERSION} — patch notes`
                }
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiTab');
                  setRoute('patch');
                }}
              >
                {unreadPatch && <i className="ver-dot" />}v{VERSION}
                <span>PATCH NOTES</span>
              </button>
              <div className="rank-chip" onClick={() => setRoute('progress')}>
                <RankEmblem tier={rank.tier} size={30} />
                <div>
                  <div className="rc-label">{profile.placed ? rank.label : 'UNRANKED'}</div>
                  <div className="rc-rating mono">
                    {profile.placed ? <Ticker value={Math.round(profile.overall)} format={(n) => String(Math.round(n))} /> : '—'}
                  </div>
                </div>
              </div>
            </div>
          </header>

          {showGestureNotice && (
            <GestureNotice onDismiss={() => patchSettings({ gestureNoticeDismissed: true })} />
          )}

          <ErrorBoundary
            key={`route-${route}`}
            what={NAV.find((n) => n.route === route)?.label ?? 'This screen'}
            onExit={() => setRoute('practice')}
            exitLabel="Back to practice"
          >
            {route === 'warmup' && (
              <WarmUp
                profile={profile}
                settings={profile.settings}
                summary={warmSummary}
                onDismissSummary={() => setWarmSummary(null)}
                onStart={startWarm}
                onReaction={onReaction}
                onBench={playBench}
                onCode={playCode}
              />
            )}
            {route === 'practice' && (
              <Practice profile={profile} settings={profile.settings} onPlay={startRun} />
            )}
            {route === 'lab' && (
              <Lab
                profile={profile}
                settings={profile.settings}
                onPlay={startRun}
                onFixControls={() => setRoute('settings')}
              />
            )}
            {route === 'progress' && (
              <Progress
                profile={profile}
                onRecordsSeen={(seen: number[]) =>
                  setProfile((p) => ({ ...p, freshRecords: p.freshRecords.filter((t) => !seen.includes(t)) }))
                }
                onRename={(name: string) => setProfile((p) => ({ ...p, name }))}
                onReset={doReset}
                // Progress still diagnoses in terms of the whole catalogue of
                // mechanics; the menu only offers Vayne, so a "fix this" button
                // starts the mode that trains the thing it named.
                onPlay={(id) => startRun(practiceFor(id), 'play')}
              />
            )}
            {route === 'settings' && (
              <Settings settings={profile.settings} onChange={patchSettings} onBack={() => setRoute('practice')} />
            )}
            {route === 'patch' && (
              <PatchNotes seen={profile.seenVersion} onRead={markPatchRead} onBack={() => setRoute('practice')} />
            )}
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}

/**
 * The line under the open tab, as one piece of gold that travels.
 *
 * It used to be drawn by each tab for itself, so changing tabs was one line
 * vanishing and another appearing somewhere else. One line that slides from
 * the tab you left to the tab you chose says where you went. Transform only:
 * it is positioned with a translate and sized with a scale off a 100px base.
 */
function NavInk({ index }: { index: number }) {
  const ref = useRef<HTMLElement>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const nav = ref.current?.parentElement;
    if (!nav) return;
    const measure = () => {
      const b = index >= 0 ? nav.querySelectorAll('button')[index] : null;
      setBox(b ? { x: b.offsetLeft + 14, w: Math.max(0, b.offsetWidth - 28) } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [index]);
  return (
    <i
      ref={ref}
      className="nav-ink"
      aria-hidden
      style={box ? { transform: `translateX(${box.x}px) scaleX(${box.w / 100})` } : { opacity: 0 }}
    />
  );
}

const formatHead = (v: number, f: string): string => {
  if (f === 'pct') return `${Math.round(v * 100)}%`;
  if (f === 'ms') return `${Math.round(v)}ms`;
  if (f === 'units') return `${Math.round(v)}u`;
  if (f === 'sec') return `${v.toFixed(1)}s`;
  if (f === 'rate') return v.toFixed(1);
  return `${Math.round(v)}`;
};

/** The benchmark row after this one, wrapping, skipping the reaction rows. */
const nextBench = (id: string): BenchScenario | null => {
  const rows = BENCH_SCENARIOS.filter((b) => b.kind === 'drill');
  const i = rows.findIndex((b) => b.id === id);
  return i < 0 ? null : rows[(i + 1) % rows.length];
};

// ------------------------------------------------------------ warm-up steps

/** Whether the stop rule fires on this warm-up's two sets. */
const warmStops = (w: WarmState): boolean => shouldStop(w.reps[1]?.performance, w.reps[2]?.performance, w.day);

/** The next step to play, or null when the routine is over. */
const warmNext = (w: WarmState): number | null => {
  if (w.step === 2 && warmStops(w)) return null;
  const n = w.step + 1;
  return n < w.plan.steps.length ? n : null;
};

const warmNextLabel = (w: WarmState): string => {
  const n = warmNext(w);
  if (n === null) return w.step === 2 && warmStops(w) ? 'Stop here — finish the warm-up' : 'Finish the warm-up';
  const s = w.plan.steps[n];
  const runs = w.plan.steps.filter((x) => x.drill).length;
  const at = w.plan.steps.slice(0, n + 1).filter((x) => x.drill).length;
  return `Next ${at}/${runs}: ${s.label} · ${s.drill ? drillName(s.drill) : ''}`;
};

const warmBanner = (w: WarmState): { eyebrow: string; line: string; tone?: 'good' | 'warn' } => {
  const s = w.plan.steps[w.step];
  const runs = w.plan.steps.filter((x) => x.drill).length;
  const at = w.plan.steps.slice(0, w.step + 1).filter((x) => x.drill).length;
  const eyebrow = `Warm-up · ${at} of ${runs} · ${s.label}`;
  const a = w.reps[1];
  const b = w.reps[2];
  if (w.step === 2 && a && b) {
    const d = Math.round((b.performance - a.performance) * 100);
    if (warmStops(w))
      return {
        eyebrow,
        line: `Set 2 was ${-d} points under set 1, on a slow day. That is tiredness, not practice — the routine stops here, and it counts.`,
        tone: 'warn',
      };
    return {
      eyebrow,
      line:
        d > 0
          ? `Set 2 beat set 1 by ${d} performance point${d === 1 ? '' : 's'}.`
          : d === 0
            ? 'Set 2 matched set 1 exactly.'
            : `Set 2 was ${-d} point${d === -1 ? '' : 's'} under set 1 — normal variance on its own; carry on.`,
      tone: d > 0 ? 'good' : undefined,
    };
  }
  return { eyebrow, line: s.reason };
};
