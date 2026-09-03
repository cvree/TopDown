import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { heroFor, type HeroId } from '../engine/heroes';
import { newSeed } from '../engine/rng';
import { DAILY_SEQUENCE, DRILLS, PLACEMENT_SEQUENCE, type DrillId } from '../drills/catalog';
import {
  applyRun,
  drillDifficulty,
  loadProfile,
  markDailyComplete,
  newProfile,
  resetProfile,
  rollDaily,
  saveProfile,
  type AppSettings,
  type Profile,
  type ProgressReport,
  type RunResult,
  type TestReport,
  applyTestRun,
} from '../progression/profile';
import { APM_LEVELS, isApmDrill, levelDifficulty, recommendedLevel, seedApmLadder } from '../progression/apm';
import { rankFromRating, type RankInfo } from '../progression/ranks';
import { PATCH_NOTES, VERSION } from '../patchnotes/notes';
import type { TestId } from '../tests/catalog';
import type { TestResult } from '../tests/types';
import type { SkillAxis } from '../progression/skills';
import { ArenaBackdrop } from './components/ArenaBackdrop';
import { Boot } from './Boot';
import { Crest } from './components/Crest';
import { GestureNotice, hasBrowserMouseGestures } from './components/GestureNotice';
import { HeroSelect } from './HeroSelect';
import { HeroSigil } from './components/HeroSigil';
import { Apm } from './Apm';
import { Daily } from './Daily';
import { GameView } from './GameView';
import { Home } from './Home';
import { PatchNotes } from './PatchNotes';
import { PlacementIntro, PlacementReveal } from './Placement';
import { ProfileScreen } from './ProfileScreen';
import { RankEmblem } from './components/RankEmblem';
import { RankUp } from './RankUp';
import { Results } from './Results';
import { Settings } from './Settings';
import { TestRun } from './TestRun';
import { Tests } from './Tests';
import { Vayne } from './Vayne';
import '../styles/global.css';
import './app.css';

type Route = 'home' | 'profile' | 'daily' | 'apm' | 'tests' | 'vayne' | 'settings' | 'patch';

interface Flow {
  kind: 'single' | 'placement' | 'daily';
  index: number;
  queue: DrillId[];
  seed: number;
  /** The APM ladder rung this run was launched at, if it is an APM mode. */
  level?: number;
  /** A double-length APM run. */
  endurance?: boolean;
}

/** A skill test in progress. Deliberately separate from the drill flow — a
 *  test does not queue, does not feed the ladder and does not end a daily. */
interface TestFlow {
  id: TestId;
  seed: number;
}

interface ResultState {
  result: RunResult;
  report: ProgressReport;
  bounds: { w: number; h: number };
}

export function App() {
  const [profile, setProfile] = useState<Profile>(() => {
    const p = loadProfile();
    rollDaily(p);
    return p;
  });
  const [route, setRoute] = useState<Route>('home');
  // Which mode the APM section opens on, so a click in the drill rail lands on
  // the mode it named rather than on whatever was last selected.
  const [apmFocus, setApmFocus] = useState<DrillId | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [results, setResults] = useState<ResultState | null>(null);
  const [rankUp, setRankUp] = useState<{
    from: RankInfo;
    to: RankInfo;
    driver: { axis: SkillAxis; delta: number } | null;
    headline: { label: string; value: string } | null;
  } | null>(null);
  const [testFlow, setTestFlow] = useState<TestFlow | null>(null);
  const [testOutcome, setTestOutcome] = useState<{ report: TestReport; result: TestResult } | null>(null);
  const [placementIntro, setPlacementIntro] = useState(false);
  // The cold open. `booted` gates the client; `arenaReady` is the real signal
  // the boot screen is waiting on — the arena's first rendered frame.
  const [booted, setBooted] = useState(false);
  const [arenaReady, setArenaReady] = useState(false);
  const [placementReveal, setPlacementReveal] = useState(false);
  const [interstitial, setInterstitial] = useState<{ drill: DrillId; step: number; total: number } | null>(null);
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
    audio.applyVolumes();
  }, [profile.settings]);

  const inGame = (flow !== null && !results && !placementReveal && !interstitial) || testFlow !== null;

  useEffect(() => {
    if (!booted || inGame || profile.settings.muted) audio.stopAmbience();
    else audio.startAmbience();
  }, [booted, inGame, profile.settings.muted]);

  // A profile that was calibrated before the APM ladder existed still gets its
  // starting rung set — once, the first time the section is opened.
  useEffect(() => {
    if (route !== 'apm' || !profile.placed || profile.apm.seeded) return;
    setProfile((p) => {
      if (p.apm.seeded) return p;
      const apm = { ...p.apm, modes: { ...p.apm.modes } };
      for (const id of Object.keys(apm.modes) as (keyof typeof apm.modes)[]) {
        apm.modes[id] = { ...apm.modes[id], levels: apm.modes[id].levels.map((l) => ({ ...l })) };
      }
      seedApmLadder(apm, p.overall);
      return { ...p, apm };
    });
  }, [route, profile.placed, profile.apm.seeded]);

  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setProfile((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  }, []);

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
  const runInProgress = flow !== null || placementReveal || testFlow !== null;
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

  // Launching an APM mode from anywhere but the section itself plays the rung
  // the section would have put you on, so a quick run from the drill rail and
  // a deliberate one from the ladder are the same run.
  const startSingle = useCallback(
    (id: DrillId) => {
      audio.unlock();
      setResults(null);
      // The section remembers the last mode you touched, wherever you started
      // it from, so coming back from a run lands on its ladder.
      if (isApmDrill(id)) setApmFocus(id);
      setFlow({
        kind: 'single',
        index: 0,
        queue: [id],
        seed: newSeed(),
        level: isApmDrill(id) ? recommendedLevel(profile.apm, id) : undefined,
      });
    },
    [profile.apm],
  );

  /** One APM mode, at a rung the player chose. */
  const startApm = useCallback((id: DrillId, level: number, endurance: boolean) => {
    audio.unlock();
    setApmFocus(id);
    setResults(null);
    setFlow({ kind: 'single', index: 0, queue: [id], seed: newSeed(), level, endurance });
  }, []);

  // ------------------------------------------------------------ skill tests

  const startTest = useCallback((id: TestId) => {
    audio.unlock();
    setTestOutcome(null);
    setTestFlow({ id, seed: newSeed() });
  }, []);

  const completeTest = useCallback(
    (value: number, res: TestResult) => {
      const live = testFlow;
      if (!live) return;
      let report: TestReport | null = null;
      setProfile((prev) => {
        const next: Profile = { ...prev, tests: { ...prev.tests } };
        report = applyTestRun(next, live.id, value);
        return next;
      });
      // Same reason as the drill path: React batches, so read the report next tick.
      window.setTimeout(() => {
        const rep = report;
        if (!rep) return;
        setTestOutcome({ report: rep, result: res });
      }, 0);
    },
    [testFlow],
  );

  const retryTest = useCallback(() => {
    setTestOutcome(null);
    setTestFlow((f) => (f ? { ...f, seed: newSeed() } : null));
  }, []);

  const exitTest = useCallback(() => {
    setTestFlow(null);
    setTestOutcome(null);
    audio.play('uiBack');
  }, []);

  const startPlacement = useCallback(() => {
    audio.unlock();
    setPlacementIntro(false);
    setResults(null);
    setFlow({ kind: 'placement', index: 0, queue: [...PLACEMENT_SEQUENCE], seed: newSeed() });
    setInterstitial({ drill: PLACEMENT_SEQUENCE[0], step: 1, total: PLACEMENT_SEQUENCE.length });
  }, []);

  const startDaily = useCallback(() => {
    audio.unlock();
    const remaining = DAILY_SEQUENCE.filter((d) => !profile.daily.completed.includes(d));
    if (remaining.length === 0) return;
    setResults(null);
    setFlow({ kind: 'daily', index: 0, queue: remaining, seed: newSeed() });
  }, [profile.daily.completed]);

  // Placement moves through its drills without stopping at a results screen —
  // the reveal at the end is the payoff, and breaking it up would blunt it.
  useEffect(() => {
    if (!interstitial) return;
    const t = window.setTimeout(() => setInterstitial(null), 1500);
    return () => window.clearTimeout(t);
  }, [interstitial]);

  const currentDrill = flow ? flow.queue[flow.index] : null;
  const difficulty = useMemo(
    () =>
      currentDrill
        ? // An APM rung *is* the difficulty. Everything else is adaptive.
          flow?.level !== undefined && isApmDrill(currentDrill)
          ? levelDifficulty(flow.level)
          : drillDifficulty(profile, currentDrill)
        : 0.35,
    // Difficulty is read once per run; recomputing mid-run would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentDrill, flow?.seed, flow?.level],
  );

  // ---------------------------------------------------------- run finished

  const handleComplete = useCallback(
    (result: RunResult, bounds: { w: number; h: number }) => {
      if (!flow) return;
      if (result.endReason === 'abort') {
        // An instant reset is a fresh attempt, not a recorded run.
        setFlow({ ...flow, seed: newSeed() });
        return;
      }

      let report: ProgressReport | null = null;
      setProfile((prev) => {
        const next: Profile = {
          ...prev,
          ratings: { ...prev.ratings },
          samples: { ...prev.samples },
          difficulty: { ...prev.difficulty },
          bests: { ...prev.bests },
          history: [...prev.history],
          daily: { ...prev.daily, completed: [...prev.daily.completed] },
          dailyMarks: [...prev.dailyMarks],
          // The champion path is written in place by applyRun, so it has to be
          // copied down to the records or the previous state would move too.
          vayne: {
            ...prev.vayne,
            stages: Object.fromEntries(
              Object.entries(prev.vayne.stages).map(([k, v]) => [k, { ...v }]),
            ) as typeof prev.vayne.stages,
          },
          // Same for the APM ladder, one level deeper: the per-level records
          // are the things applyRun writes.
          apm: {
            ...prev.apm,
            modes: Object.fromEntries(
              Object.entries(prev.apm.modes).map(([k, v]) => [k, { ...v, levels: v.levels.map((l) => ({ ...l })) }]),
            ) as typeof prev.apm.modes,
          },
        };
        report = applyRun(next, result, {
          placement: flow.kind === 'placement',
          level: flow.level,
          endurance: flow.endurance,
        });
        if (flow.kind === 'daily' || flow.kind === 'single') markDailyComplete(next, result.drill);
        if (flow.kind === 'placement' && flow.index >= flow.queue.length - 1) {
          next.placed = true;
          next.placementRuns = flow.queue.length;
          // Calibration also opens the APM ladder somewhere sensible. A player
          // who placed high has already shown what the bottom rungs teach.
          seedApmLadder(next.apm, next.overall);
        }
        return next;
      });

      // React 19 batches the state update above; read the report next tick.
      window.setTimeout(() => {
        const rep = report;
        if (!rep) return;

        if (flow.kind === 'placement') {
          if (flow.index >= flow.queue.length - 1) {
            setFlow(null);
            setPlacementReveal(true);
          } else {
            const nextIndex = flow.index + 1;
            setFlow({ ...flow, index: nextIndex, seed: newSeed() });
            setInterstitial({ drill: flow.queue[nextIndex], step: nextIndex + 1, total: flow.queue.length });
          }
          return;
        }

        setResults({ result, report: rep, bounds });
        if (rep.promoted) {
          const driver = rep.axisChanges.reduce<{ axis: SkillAxis; delta: number } | null>(
            (acc, c) => (!acc || c.delta > acc.delta ? { axis: c.axis, delta: c.delta } : acc),
            null,
          );
          const head = result.keyMetrics[0];
          setRankUp({
            from: rep.rankBefore,
            to: rep.rankAfter,
            driver,
            headline: head
              ? { label: `Best ${head.label.toLowerCase()}`, value: formatHead(head.value, head.format) }
              : null,
          });
        }
      }, 0);
    },
    [flow],
  );

  const retry = useCallback(() => {
    if (!flow) return;
    setResults(null);
    setRankUp(null);
    setFlow({ ...flow, seed: newSeed() });
  }, [flow]);

  const exitToMenu = useCallback(() => {
    setResults(null);
    setRankUp(null);
    setFlow(null);
    setInterstitial(null);
    audio.play('uiBack');
  }, []);

  const nextInFlow = useCallback(() => {
    if (!flow) return;
    if (flow.index >= flow.queue.length - 1) {
      exitToMenu();
      setRoute(flow.kind === 'daily' ? 'daily' : 'home');
      return;
    }
    setResults(null);
    setRankUp(null);
    setFlow({ ...flow, index: flow.index + 1, seed: newSeed() });
  }, [flow, exitToMenu]);

  const finishPlacement = useCallback(() => {
    setPlacementReveal(false);
    setRoute('home');
    audio.play('uiClick');
  }, []);

  // Opening the notes is what marks them read; nothing else clears the dot,
  // and a player who never opens them keeps it. The marking is done by the
  // screen itself, one frame in, so it can still show you what was new.
  const markPatchRead = useCallback(() => {
    setProfile((p) => (p.seenVersion === VERSION ? p : { ...p, seenVersion: VERSION }));
  }, []);

  const chooseHero = useCallback((hero: HeroId) => {
    setProfile((p) => ({ ...p, onboarded: true, settings: { ...p.settings, hero } }));
  }, []);

  const doReset = useCallback(() => {
    resetProfile();
    const p = newProfile();
    setProfile(p);
    // A wiped profile is a new player: `onboarded` is false again, so the
    // next thing they see is champion select.
    setRoute('home');
  }, []);

  const rank = rankFromRating(profile.overall);
  // Only ever shown to browsers that actually ship gestures, and only until
  // it has been read once.
  const showGestureNotice = useMemo(
    () => !profile.settings.gestureNoticeDismissed && hasBrowserMouseGestures(),
    [profile.settings.gestureNoticeDismissed],
  );

  // ------------------------------------------------------------------ render

  if (placementReveal) {
    const axes = PLACEMENT_SEQUENCE.map((id) => {
      const axis = Object.keys(DRILLS[id].axes)[0] as SkillAxis;
      return { axis, rating: profile.ratings[axis] };
    });
    return (
      <PlacementReveal
        rank={rankFromRating(profile.overall)}
        rating={profile.overall}
        axes={axes}
        onDone={finishPlacement}
      />
    );
  }

  if (placementIntro) {
    return <PlacementIntro onBegin={startPlacement} onCancel={() => setPlacementIntro(false)} />;
  }

  if (testFlow) {
    return (
      <TestRun
        key={`${testFlow.id}-${testFlow.seed}`}
        id={testFlow.id}
        seed={testFlow.seed}
        report={testOutcome?.report ?? null}
        result={testOutcome?.result ?? null}
        onComplete={completeTest}
        onRetry={retryTest}
        onExit={exitTest}
      />
    );
  }

  if (flow && currentDrill) {
    const context =
      flow.kind === 'placement'
        ? `CALIBRATION ${flow.index + 1} / ${flow.queue.length}`
        : flow.kind === 'daily'
          ? `DAILY ${flow.index + 1} / ${flow.queue.length}`
          : // An APM run always says which rung it is, because the rung is the
            // whole claim the run makes.
            flow.level !== undefined && isApmDrill(currentDrill)
            ? `APM · LEVEL ${flow.level} / ${APM_LEVELS}${flow.endurance ? ' · ENDURANCE' : ''}`
            : undefined;
    return (
      <>
        <GameView
          key={`${currentDrill}-${flow.seed}`}
          drill={currentDrill}
          difficulty={difficulty}
          seed={flow.seed}
          settings={profile.settings}
          context={context}
          durationScale={flow.endurance ? 2 : 1}
          onComplete={handleComplete}
          onExit={exitToMenu}
          onRetry={retry}
        />
        {interstitial && (
          <div
            className="interstitial"
            style={{ ['--c' as string]: DRILLS[interstitial.drill].accent }}
          >
            <div className="int-inner">
              <div className="int-step">
                {Array.from({ length: interstitial.total }).map((_, i) => (
                  <i key={i} className={i < interstitial.step ? 'on' : ''} />
                ))}
                <span className="eyebrow">
                  {flow.kind === 'placement' ? 'CALIBRATION' : 'DAILY'} {interstitial.step} / {interstitial.total}
                </span>
              </div>
              <div className="int-name display">{DRILLS[interstitial.drill].name}</div>
              <div className="ornament">
                <i />
              </div>
              <div className="int-brief">{DRILLS[interstitial.drill].brief}</div>
              {/* Runs for exactly as long as the card is up, so the wait has a
                  visible end rather than being an unexplained pause. */}
              <div className="int-bar">
                <span />
              </div>
            </div>
          </div>
        )}
        {results && (
          <Results
            result={results.result}
            report={results.report}
            bounds={results.bounds}
            onRetry={retry}
            onExit={exitToMenu}
            onNext={flow.queue.length > 1 ? nextInFlow : undefined}
            nextLabel={
              flow.index < flow.queue.length - 1 ? `Next: ${DRILLS[flow.queue[flow.index + 1]].name}` : 'Finish'
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

  // The first-run flow. It waits for the boot gate — champion select is the
  // payoff for pressing the key, not something behind it — and it is the same
  // screen the settings page opens later, so a player only ever learns it once.
  const onboarding = booted && !profile.onboarded;
  // A profile that has read an older release, or none at all, has something
  // waiting. A brand-new profile starts level with the build and does not.
  const unreadPatch = profile.seenVersion !== VERSION;

  return (
    <div className="app">
      <ArenaBackdrop
        enabled={!profile.settings.lowFx}
        hero={profile.settings.hero}
        onReady={() => setArenaReady(true)}
      />
      {!booted && <Boot ready={arenaReady} onEnter={() => setBooted(true)} />}
      {onboarding && (
        <HeroSelect initial={profile.settings.hero} lowFx={profile.settings.lowFx} onConfirm={chooseHero} />
      )}
      {/* The client is unmounted, not merely covered, while the boot gate or
          champion select is up. Both of those are driven by bare keypresses,
          and so is the client — Enter plays the selected drill — so leaving it
          alive underneath means one Enter both locks in a champion and
          launches calibration. */}
      {booted && !onboarding && (
        <div className="shell">
          <header className="topbar">
            <div className="logo" onClick={() => setRoute('home')}>
              <Crest size={26} />
              APEX
              <span className="logo-sub">MECHANICS</span>
            </div>

            <nav className="nav">
              {(['home', 'daily', 'apm', 'tests', 'vayne', 'profile', 'settings'] as Route[]).map((r) => (
                <button
                  key={r}
                  className={route === r ? 'on' : ''}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    audio.unlock();
                    audio.play('uiTab');
                    setRoute(r);
                  }}
                >
                  {r === 'home' ? 'TRAIN' : r.toUpperCase()}
                </button>
              ))}
            </nav>

            <div className="topbar-right">
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
              {/* Who you are, always on screen, one click from changing it. A
                  champion you picked and then never see again is a form field. */}
              <button
                className="hero-chip"
                style={{ ['--c' as string]: heroFor(profile.settings.hero).accent }}
                title={`Playing as ${heroFor(profile.settings.hero).name} — click to change`}
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiTab');
                  setRoute('settings');
                }}
              >
                <HeroSigil hero={profile.settings.hero} size={22} />
                <span>{heroFor(profile.settings.hero).name}</span>
              </button>
              <div className="rank-chip" onClick={() => setRoute('profile')}>
                <RankEmblem tier={rank.tier} size={30} />
                <div>
                  <div className="rc-label">{profile.placed ? rank.label : 'UNRANKED'}</div>
                  <div className="rc-rating mono">{profile.placed ? Math.round(profile.overall) : '—'}</div>
                </div>
              </div>
            </div>
          </header>

          {showGestureNotice && (
            <GestureNotice onDismiss={() => patchSettings({ gestureNoticeDismissed: true })} />
          )}

          {route === 'home' && (
            <Home
              profile={profile}
              onPlay={startSingle}
              onDaily={() => setRoute('daily')}
              onProfile={() => setRoute('profile')}
              onPlacement={() => setPlacementIntro(true)}
              onVayne={() => setRoute('vayne')}
              onApm={(id) => {
                setApmFocus(id ?? null);
                setRoute('apm');
              }}
            />
          )}
          {route === 'apm' && (
            <Apm
              profile={profile}
              focus={apmFocus}
              onPlay={startApm}
              onBack={() => setRoute('home')}
              onPlacement={() => setPlacementIntro(true)}
            />
          )}
          {route === 'daily' && (
            <Daily profile={profile} onStart={startDaily} onBack={() => setRoute('home')} />
          )}
          {route === 'tests' && (
            <Tests profile={profile} onRun={startTest} onBack={() => setRoute('home')} />
          )}
          {route === 'vayne' && (
            <Vayne profile={profile} onPlay={startSingle} onBack={() => setRoute('home')} />
          )}
          {route === 'profile' && (
            <ProfileScreen
              profile={profile}
              onRename={(name) => setProfile((p) => ({ ...p, name }))}
              onReset={doReset}
              onPlay={startSingle}
            />
          )}
          {route === 'settings' && (
            <Settings settings={profile.settings} onChange={patchSettings} onBack={() => setRoute('home')} />
          )}
          {route === 'patch' && (
            <PatchNotes
              seen={profile.seenVersion}
              onRead={markPatchRead}
              onBack={() => setRoute('home')}
            />
          )}
        </div>
      )}
    </div>
  );
}

const formatHead = (v: number, f: string): string => {
  if (f === 'pct') return `${Math.round(v * 100)}%`;
  if (f === 'ms') return `${Math.round(v)}ms`;
  if (f === 'units') return `${Math.round(v)}u`;
  if (f === 'sec') return `${v.toFixed(1)}s`;
  return `${Math.round(v)}`;
};
