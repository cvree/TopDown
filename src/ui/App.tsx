import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { newSeed } from '../engine/rng';
import { DRILLS, type DrillId } from '../drills/catalog';
import { RUN_MODES, practiceFor, type RunMode } from '../drills/modes';
import {
  applyRun,
  completePlaylist,
  createPlaylist,
  deletePlaylist,
  drillDifficulty,
  loadProfile,
  newProfile,
  renamePlaylist,
  resetProfile,
  rollDaily,
  saveProfile,
  setPlaylistItems,
  setTuning,
  toggleStarred,
  tuningOf,
  type Playlist,
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
import { Practice, PracticeScreen, openSection, revealDrill } from './Practice';
import { pickNext, startSpec } from './playNext';
import { ActivityEditor, ImportDialog, ShareDialog } from './ActivityEditor';
import { Benchmarks } from './Benchmarks';
import { isApmDrill } from '../progression/apm';
import {
  decodePlaylist,
  defaultTuning,
  encodePlaylist,
  isCustom,
  playlistFromLocation,
  runTuningOf,
  tunedOpts,
  type ActivityTuning,
  type SharedPlaylist,
} from '../progression/tuning';
import { Progress } from './Progress';
import { PatchNotes } from './PatchNotes';
import { RankEmblem } from './components/RankEmblem';
import { Ticker } from './components/Ticker';
import { RankUp } from './RankUp';
import { Results } from './Results';
import { Settings } from './Settings';
import { Study } from './Study';
import { Welcome, type WelcomeResult } from './Welcome';
import { isCalm, setCalm } from './motion';
import { launch, trackLaunches } from './launch';
import {
  BENCH_DIFFICULTY,
  BENCH_SCENARIOS,
  BENCH_TIERS,
  benchFor,
  benchPlace,
  decodeScenario,
  encodeScenario,
  recordBench,
  type BenchScenario,
} from '../progression/benchmarks';
import { recordReaction, type ReactionRun, type ReactionTestId } from '../progression/warmup';
import '../styles/global.css';
import './app.css';

/**
 * The sections.
 *
 * Three in the bar, and setup, study and the patch notes in the corner.
 *
 * **PLAY** is every card you can start — the thirty-second drills for your
 * hands, the three champions, the lane, and a shelf of whatever you have
 * starred and every playlist you have built.
 *
 * **PRACTICE** is the champions in pieces. It is also a segment of PLAY, and
 * stays one; it has its own tab as well so that "practise Katarina" is one
 * click from anywhere.
 *
 * **PROGRESS** is whether any of it is working — and the reaction tests and
 * the benchmark sheet, which measure it at settings that never move.
 *
 * **STUDY** — every champion in League as knowledge — is a chip in the corner:
 * always one click away, never competing with the three things you play.
 *
 * There used to be a warm-up: a daily routine with a streak, reached from a
 * chip on PLAY. It is gone. Its reaction tests and benchmarks were never part
 * of the routine, and moved to PROGRESS.
 */
type Route = 'play' | 'practice' | 'study' | 'progress' | 'settings' | 'patch';

/** The top bar, in order. Setup, study and the patch notes live in the corner. */
const NAV: { route: Route; label: string; hint: string }[] = [
  { route: 'play', label: 'PLAY', hint: 'Thirty-second drills for your hands, a champion in pieces, or a whole lane' },
  { route: 'practice', label: 'PRACTICE', hint: 'Vayne, Twisted Fate and Katarina, one piece at a time' },
  { route: 'progress', label: 'PROGRESS', hint: 'Your scores, reaction tests and benchmarks' },
];

/** A benchmark is one fixed minute for everybody: its lines were cut on sixty seconds. */
const BENCH_SECONDS = 60;

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
  /**
   * The playlist this run is a step of, if it is one: a player's own queue —
   * or a friend's — played through in order with each item's own settings,
   * and looping back to its first item once the last one finishes.
   */
  playlist?: PlaylistFlow;
  /** The favourite's edited settings this run is played on, if any. */
  tuning?: ActivityTuning;
  /**
   * A length, speed or target size no card offers. Scored for the player to
   * see and written to nothing — see `tuning.ts`.
   */
  custom?: boolean;
}

/** A playlist being played. */
interface PlaylistFlow {
  /** The saved playlist, when it is one — for counting completions. */
  id?: string;
  name: string;
  items: DrillId[];
  tunings: ActivityTuning[];
  index: number;
  /** What each item scored this time through, by index. */
  scores: (number | undefined)[];
  /** This time through has been counted as a completion — a retry of the last item is not another. */
  counted?: boolean;
}

/** What is drawn over the client, if anything. */
type Modal =
  | { kind: 'edit'; id: DrillId; justStarred: boolean }
  | { kind: 'editItem'; playlist: string; index: number }
  | { kind: 'share'; playlist: string }
  | { kind: 'import'; shared: SharedPlaylist };

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
  // the next one synchronously: a run finishing.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  // Every session opens on PLAY — the drills and the champions are the
  // client now, and a screen that opened somewhere else first said otherwise
  // on every single sign-in.
  const [route, setRouteNow] = useState<Route>('play');
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
  /** EDIT ACTIVITY, a share dialog or a playlist somebody sent — at most one. */
  const [modal, setModal] = useState<Modal | null>(null);
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
    if (!booted || flow || tour || modal) return;
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
      setRoute((r) => (r === 'settings' ? 'play' : 'settings'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booted, flow, route, tour, modal]);

  // ------------------------------------------------------ a shared link
  //
  // A link somebody sent opens the client straight onto their playlist. It is
  // read once, after the boot screen, and taken out of the address bar so a
  // reload does not ask again.
  useEffect(() => {
    if (!booted) return;
    const code = playlistFromLocation();
    if (!code) return;
    try {
      window.history.replaceState(null, '', `${location.pathname}${location.search.replace(/[?&]playlist=[^&]*/, '')}`);
    } catch {
      // A sandboxed frame may refuse; the prompt still comes up once.
    }
    const r = decodePlaylist(code);
    if (!('error' in r)) setModal({ kind: 'import', shared: r });
  }, [booted]);

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
        playlist?: PlaylistFlow;
        tuning?: ActivityTuning;
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
          playlist: opts.playlist,
          tuning: opts.tuning,
          custom: opts.tuning ? isCustom(drill, opts.tuning) : undefined,
        });
      });
    },
    [],
  );

  /**
   * How a favourite or a playlist row is started: the settings its own card
   * would use, with the player's edit laid over them.
   */
  const tunedStart = useCallback(
    (drill: DrillId, t: ActivityTuning) => tunedOpts(drill, t, startSpec(profileRef.current, drill).opts, isApmDrill(drill)),
    [],
  );

  /** A playlist's step `index`, as a run. */
  const playlistFlow = useCallback(
    (pl: PlaylistFlow, index: number): Flow => {
      const drill = pl.items[index];
      const tuning = pl.tunings[index] ?? defaultTuning(drill);
      const o = tunedStart(drill, tuning);
      return {
        drill,
        mode: 'play',
        seed: newSeed(),
        difficulty: o.difficulty,
        duration: o.duration,
        level: o.level,
        tuning,
        custom: isCustom(drill, tuning),
        playlist: { ...pl, index },
      };
    },
    [tunedStart],
  );

  /** Start a playlist from its first item — its one PLAY button. */
  const playPlaylist = useCallback(
    (pl: { id?: string; name: string; items: DrillId[]; tunings: ActivityTuning[] }) => {
      if (!pl.items.length) return;
      const f = playlistFlow({ id: pl.id, name: pl.name, items: pl.items, tunings: pl.tunings, index: 0, scores: [] }, 0);
      startRun(f.drill, 'play', {
        difficulty: f.difficulty,
        duration: f.duration,
        level: f.level,
        tuning: f.tuning,
        playlist: f.playlist,
      });
    },
    [startRun, playlistFlow],
  );

  /** A starred activity, on the settings it was edited to. */
  const playFavorite = useCallback(
    (id: DrillId, t?: ActivityTuning) => {
      const tuning = t ?? tuningOf(profileRef.current, id);
      startRun(id, 'play', { ...tunedStart(id, tuning), tuning });
    },
    [startRun, tunedStart],
  );

  /** Starring opens EDIT ACTIVITY; unstarring just unstars. */
  const toggleStar = useCallback((id: DrillId) => {
    const was = profileRef.current.stars.includes(id);
    setProfile((p) => toggleStarred(p, id));
    if (!was) setModal({ kind: 'edit', id, justStarred: true });
  }, []);
  const addPlaylist = useCallback((name: string, items: DrillId[]) => setProfile((p) => createPlaylist(p, name, items)), []);
  const removePlaylist = useCallback((id: string) => setProfile((p) => deletePlaylist(p, id)), []);
  const relabelPlaylist = useCallback((id: string, name: string) => setProfile((p) => renamePlaylist(p, id, name)), []);
  const editPlaylist = useCallback(
    (id: string, items: DrillId[], tunings: ActivityTuning[]) => setProfile((p) => setPlaylistItems(p, id, items, tunings)),
    [],
  );

  /** A pasted playlist code or link, or a scenario code. Returns why not, or null. */
  const openCode = useCallback(
    (text: string): string | null => {
      const t = text.trim();
      if (t.includes('APX1.')) {
        const r = decodePlaylist(t);
        if ('error' in r) return r.error;
        setModal({ kind: 'import', shared: r });
        return null;
      }
      const c = decodeScenario(t);
      if ('error' in c) return `${c.error} Playlist codes start with APX1.`;
      // A pasted benchmark code is the benchmark, and records as one.
      const b = c.mode === 'play' && Math.abs(c.difficulty - BENCH_DIFFICULTY) < 1e-6 ? benchFor(c.drill, c.seed) : null;
      startRun(c.drill, c.mode, { difficulty: c.difficulty, seed: c.seed, bench: b?.id, duration: b ? BENCH_SECONDS : undefined });
      return null;
    },
    [startRun],
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
        setFlow({ ...flow, seed: flow.fixedSeed ? flow.seed : newSeed() });
        return;
      }

      // Finishing the last item is finishing the playlist — counted here, on
      // the run, so leaving from its results screen still counts.
      const finished =
        flow.playlist && flow.playlist.id && !flow.playlist.counted && flow.playlist.index + 1 >= flow.playlist.items.length
          ? flow.playlist.id
          : null;

      // A playlist remembers what each step scored, for the line at the end.
      if (flow.playlist) {
        const pl = flow.playlist;
        const scores = [...pl.scores];
        scores[pl.index] = result.score;
        setFlow((f) => (f && f.playlist ? { ...f, playlist: { ...f.playlist, scores, counted: f.playlist.counted || !!finished } } : f));
      }

      // A custom run is practice. It is scored against a copy of the profile
      // so the results screen can show everything it normally shows — and the
      // copy is thrown away, so no record, ladder, rating or benchmark moves.
      if (flow.custom) {
        if (finished) setProfile((p) => completePlaylist(p, finished));
        const report = applyRun(structuredClone(profileRef.current), result, flow.level ? { level: flow.level } : {});
        const lastScore = lastScoreOf(profileRef.current, result.drill);
        window.setTimeout(() => setResults({ result, report, bounds, lastScore }), 0);
        return;
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
      // its batch; a playlist step queues one before it, and the report came
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
        katarina: { ...prev.katarina, stages: copyRungs(prev.katarina.stages) },
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
      const saved = finished ? completePlaylist(next, finished) : next;
      profileRef.current = saved;
      setProfile(saved);

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


  const retry = useCallback(() => {
    if (!flow) return;
    setResults(null);
    setRankUp(null);
    rankToken.current++;
    setBenchNote(null);
    setFlow({ ...flow, seed: flow.fixedSeed ? flow.seed : newSeed() });
  }, [flow]);


  const exitToMenu = useCallback(() => {
    // Back on PLAY or PRACTICE, the card you just played is the one in view.
    if (flow && (routeRef.current === 'play' || routeRef.current === 'practice')) revealDrill(flow.drill);
    setResults(null);
    setRankUp(null);
    rankToken.current++;
    setFlow(null);
    audio.play('uiBack');
  }, [flow]);

  /**
   * The other mode of the run you just played, without going back to the menu.
   *
   * The lane has no other mode — it is one shape of run with an opponent
   * attached — so there the same button means the next opponent up, at the
   * same length. That is the thing a player actually wants after a lane that
   * went well, and it is the one place in the client where "harder" is a
   * choice rather than a consequence of the ladder.
   */
  const nextStep = useCallback(() => {
    if (!flow) return;
    // A playlist's "next" is the next item in the queue, always PLAY, looping
    // back to the first item once the last one finishes — the same shape as
    // running the benchmark sheet start to finish, for a list the player built
    // rather than one this client shipped with.
    if (flow.playlist) {
      const pl = flow.playlist;
      const last = pl.index + 1 >= pl.items.length;
      // Round again from the top, with a clean sheet of scores.
      const index = last ? 0 : pl.index + 1;
      setResults(null);
      setRankUp(null);
      rankToken.current++;
      setBenchNote(null);
      setFlow(playlistFlow(last ? { ...pl, scores: [], counted: false } : pl, index));
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
        setFlow({
          drill: nb.drill,
          mode: 'play',
          seed: nb.seed,
          fixedSeed: true,
          difficulty: BENCH_DIFFICULTY,
          duration: BENCH_SECONDS,
          bench: nb.id,
        });
        return;
      }
    }
    // A free run's "next" is the coach's next pick — the same answer PLAY
    // NEXT gives on the menu, asked of the profile this run just wrote, and
    // never the drill you just finished: that one is RUN AGAIN.
    const pick = pickNext(profileRef.current, flow.drill);
    setResults(null);
    setRankUp(null);
    rankToken.current++;
    setBenchNote(null);
    setFlow({ drill: pick.drill, mode: 'play', seed: newSeed(), ...pick.opts });
  }, [flow, playlistFlow]);

  /**
   * The other shape of the run you just played, for a free run: SURVIVE after
   * PLAY and back, the next opponent up after a lane, the level an endless run
   * found played for a score. It used to be the results screen's "next"; it
   * is its second button now, one click from where it always was.
   */
  const altMode = useCallback(() => {
    if (!flow) return;
    setResults(null);
    setRankUp(null);
    rankToken.current++;
    if (flow.drill === 'lanePhase') {
      const i = LANE_TIERS.findIndex((t) => t.id === laneTierOf(flow.difficulty ?? 0.32).id);
      const next = LANE_TIERS[Math.min(LANE_TIERS.length - 1, i + 1)];
      setFlow({ ...flow, difficulty: next.difficulty, seed: newSeed() });
      return;
    }
    // An infinite run's "next" is the rung it just found, played for score:
    // the whole point of the tide is to hand you a level worth playing, and
    // the only way to put one on the board is a one-minute rep at it.
    if (flow.mode === 'infinite') {
      const held = clamp(Math.round(flow.heldLevel ?? flow.level ?? 1), 1, APM_LEVELS);
      setFlow({
        ...flow,
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
      setFlow({ ...flow, mode: 'play', seed: newSeed() });
      return;
    }
    setFlow({ ...flow, mode: flow.mode === 'play' ? 'survive' : 'play', seed: newSeed() });
  }, [flow]);

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
      startRun(b.drill, 'play', { difficulty: BENCH_DIFFICULTY, duration: BENCH_SECONDS, seed: b.seed, bench: b.id });
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
   * Two things, and each of them is an ordinary setting somebody could have
   * reached themselves: the way they move, and the level every drill card
   * opens on. Nothing here is a gate and nothing is awarded — the measured
   * level only moves where the arrows start.
   *
   * On a first run it also starts the first run: PULSE at level one, the
   * simplest thing in the client — two keys, one lit square — so the rule
   * every drill shares (cursor on the square, then the key) is learned where
   * nothing else is asking for attention. Whatever the test measured is where
   * every card opens afterwards. Leaving that run lands on PLAY's drills.
   */
  const finishTour = useCallback(
    (r: WelcomeResult) => {
      setProfile((p) => {
        const next: Profile = {
          ...p,
          onboarded: true,
          settings: { ...p.settings, movementScheme: r.scheme },
          apm: { ...p.apm, modes: { ...p.apm.modes } },
        };
        openApmLadderAt(next.apm, r.level);
        return next;
      });
      const first = tour === 'first';
      setTour(null);
      openSection('drills');
      setRouteNow('play');
      if (first) startRun('apmPulse', 'play', { difficulty: levelDifficulty(1), level: 1 });
    },
    [tour, startRun],
  );

  const skipTour = useCallback(() => {
    setProfile((p) => (p.onboarded ? p : { ...p, onboarded: true }));
    setTour(null);
    audio.play('uiBack');
  }, []);

  const doReset = useCallback(() => {
    resetProfile();
    setProfile(newProfile());
    setRouteNow('play');
    // A wiped profile has never been onboarded, so the walkthrough is the
    // right first screen again — the same one a new player gets.
    setTour('first');
  }, []);

  const rank = rankFromRating(profile.overall);

  /** Whatever is drawn over the client: one dialog at a time. */
  const renderModal = () => {
    if (!modal) return null;
    const close = () => setModal(null);
    if (modal.kind === 'edit') {
      const id = modal.id;
      const save = (t: ActivityTuning) => {
        const next = setTuning(profileRef.current, id, t);
        profileRef.current = next;
        setProfile(next);
        setModal(null);
      };
      return (
        <ActivityEditor
          key={`edit-${id}`}
          id={id}
          initial={tuningOf(profile, id)}
          eyebrow={modal.justStarred ? '★ starred — now make it yours' : 'your favourite, your way'}
          onSave={save}
          onSaveAndPlay={(t) => {
            save(t);
            playFavorite(id, t);
          }}
          onClose={close}
        />
      );
    }
    if (modal.kind === 'editItem') {
      const pl = profile.playlists.find((x) => x.id === modal.playlist);
      const id = pl?.items[modal.index];
      if (!pl || !id) return null;
      return (
        <ActivityEditor
          key={`item-${pl.id}-${modal.index}`}
          id={id}
          initial={pl.tunings[modal.index] ?? defaultTuning(id)}
          title="EDIT PLAYLIST ITEM"
          eyebrow={`${pl.name} · ${modal.index + 1} of ${pl.items.length} · this playlist only`}
          onSave={(t) => {
            const tunings = [...pl.tunings];
            tunings[modal.index] = t;
            editPlaylist(pl.id, pl.items, tunings);
            setModal(null);
          }}
          onClose={close}
        />
      );
    }
    if (modal.kind === 'share') {
      const pl = profile.playlists.find((x) => x.id === modal.playlist);
      if (!pl) return null;
      const shared = { name: pl.name, items: pl.items, tunings: pl.tunings };
      return <ShareDialog playlist={shared} code={encodePlaylist(shared)} onClose={close} />;
    }
    const shared = modal.shared;
    // Saved first either way, so a friend's playlist is kept — and counted
    // when it is finished — whether it is played now or later.
    const keep = (): Playlist => {
      const next = createPlaylist(profileRef.current, shared.name, shared.items, shared.tunings);
      profileRef.current = next;
      setProfile(next);
      setModal(null);
      return next.playlists[next.playlists.length - 1];
    };
    return (
      <ImportDialog
        playlist={shared}
        onSave={() => {
          keep();
          audio.play('uiClick');
          openSection('favorites');
        }}
        onSaveAndPlay={() => playPlaylist(keep())}
        onClose={close}
      />
    );
  };
  // Only ever shown to browsers that actually ship gestures, and only until
  // it has been read once.
  const showGestureNotice = useMemo(
    () => !profile.settings.gestureNoticeDismissed && hasBrowserMouseGestures(),
    [profile.settings.gestureNoticeDismissed],
  );

  /**
   * What "next" means after a free run: the coach's next pick, never the drill
   * just played. Null inside a playlist or a benchmark sheet, which each have
   * a next of their own.
   */
  const freeNext = useMemo(
    () =>
      results && flow && !flow.playlist && !(flow.bench && nextBench(flow.bench))
        ? pickNext(profile, flow.drill)
        : null,
    // The pick is read once per results screen, off the profile the run wrote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results],
  );

  // ------------------------------------------------------------------ render

  if (flow) {
    return (
      <>
        <GameView
          key={`${flow.drill}-${flow.mode}-${flow.seed}`}
          tuning={runTuningOf(flow.tuning)}
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
            (flow.playlist ? ` · ${flow.playlist.name} · ${flow.playlist.index + 1}/${flow.playlist.items.length}` : '') +
            (flow.custom ? ' · CUSTOM · PRACTICE ONLY' : '')
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
            onNext={nextStep}
            onAlt={freeNext ? altMode : undefined}
            code={
              flow.custom || flow.mode === 'infinite' || flow.mode === 'surge' || flow.playlist
                ? null
                : encodeScenario({ drill: flow.drill, mode: flow.mode, difficulty, seed: flow.seed })
            }
            banner={
              flow.playlist
                ? playlistBanner(flow.playlist, !!flow.custom)
                : flow.custom
                  ? {
                      eyebrow: 'Custom settings · practice',
                      line: 'Played on your own length, speed or target size: scored for you to see, and written to nothing — no record, ladder or rating moved.',
                      tone: 'warn',
                    }
                  : benchNote
            }
            nextLabel={
              flow.playlist
                ? flow.playlist.index + 1 >= flow.playlist.items.length
                  ? `Finish · play ${flow.playlist.name} again`
                  : `Next ${flow.playlist.index + 2}/${flow.playlist.items.length}: ${DRILLS[flow.playlist.items[flow.playlist.index + 1]].name}`
                : flow.bench && nextBench(flow.bench)
                  ? `Next benchmark: ${nextBench(flow.bench)?.label}`
                : freeNext
                  ? `Next: ${DRILLS[freeNext.drill].name}`
                  : 'Next drill'
            }
            nextWhy={freeNext?.why}
            altLabel={
              flow.drill === 'lanePhase'
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
          scheme={profile.settings.movementScheme}
          replay={tour === 'replay'}
          onDone={finishTour}
          onSkip={skipTour}
        />
      )}
      {booted && (
        <div className="shell">
          <header className="topbar">
            <div className="logo">
              <Crest size={26} />
              APEX
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
              {/* STUDY: every champion in League, as a quiz and a reference.
                  In the corner rather than the bar, so the bar is the three
                  things you play — and still one click from anywhere. */}
              <button
                className={`gear-chip study-chip${route === 'study' ? ' on' : ''}`}
                title="Study every champion: passives, abilities, cooldowns, ranges, matchups"
                aria-label="Study"
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiTab');
                  setRoute('study');
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                  <path d="M3 5.5C5.8 4.3 8.9 4.4 12 6c3.1-1.6 6.2-1.7 9-.5v13c-2.8-1.2-5.9-1.1-9 .5-3.1-1.6-6.2-1.7-9-.5z" />
                  <path d="M12 6v13" />
                </svg>
                <span>STUDY</span>
              </button>
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
            onExit={() => setRoute('play')}
            exitLabel="Back to PLAY"
          >
            {route === 'play' && (
              <Practice
                profile={profile}
                settings={profile.settings}
                onPlay={startRun}
                onFixControls={() => setRoute('settings')}
                onToggleStar={toggleStar}
                onPlayFavorite={(id) => playFavorite(id)}
                onEditFavorite={(id) => setModal({ kind: 'edit', id, justStarred: false })}
                onPlayPlaylist={(pl: Playlist) => playPlaylist(pl)}
                onCreatePlaylist={addPlaylist}
                onDeletePlaylist={removePlaylist}
                onRenamePlaylist={relabelPlaylist}
                onSetPlaylistItems={editPlaylist}
                onEditPlaylistItem={(id, index) => setModal({ kind: 'editItem', playlist: id, index })}
                onSharePlaylist={(id) => setModal({ kind: 'share', playlist: id })}
                onCode={openCode}
                keysLive={!tour && !modal}
              />
            )}
            {route === 'practice' && (
              <PracticeScreen profile={profile} settings={profile.settings} onPlay={startRun} onToggleStar={toggleStar} />
            )}
            {route === 'study' && <Study />}
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
                measurements={
                  <Benchmarks profile={profile} settings={profile.settings} onReaction={onReaction} onBench={playBench} />
                }
              />
            )}
            {route === 'settings' && (
              <Settings settings={profile.settings} onChange={patchSettings} onBack={() => setRoute('play')} />
            )}
            {route === 'patch' && (
              <PatchNotes seen={profile.seenVersion} onRead={markPatchRead} onBack={() => setRoute('play')} />
            )}
          </ErrorBoundary>
        </div>
      )}
      {booted && !tour && modal && renderModal()}
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

/**
 * The banner a playlist run shows: which queue, and where in it — and on the
 * last item, the whole way through, score by score.
 */
const playlistBanner = (pl: PlaylistFlow, custom: boolean): { eyebrow: string; line: string; tone?: 'good' | 'warn' } => {
  const last = pl.index + 1 >= pl.items.length;
  const tag = custom ? ' · custom settings, written to nothing' : '';
  if (!last) return { eyebrow: `Playlist · ${pl.name}`, line: `${pl.index + 1} of ${pl.items.length} — ${DRILLS[pl.items[pl.index]].name}${tag}` };
  const scores = pl.items.map((id, i) => `${DRILLS[id].name} ${(pl.scores[i] ?? 0).toLocaleString('en-US')}`);
  const total = pl.scores.reduce<number>((n, v) => n + (v ?? 0), 0);
  return {
    eyebrow: `Playlist complete · ${pl.name}`,
    line: `All ${pl.items.length} done — ${scores.join(' · ')}. Total ${total.toLocaleString('en-US')}.${custom ? ' This last one was on custom settings: written to nothing.' : ''}`,
    tone: 'good',
  };
};

/** The benchmark row after this one, wrapping, skipping the reaction rows. */
const nextBench = (id: string): BenchScenario | null => {
  const rows = BENCH_SCENARIOS.filter((b) => b.kind === 'drill');
  const i = rows.findIndex((b) => b.id === id);
  return i < 0 ? null : rows[(i + 1) % rows.length];
};
