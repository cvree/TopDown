import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { newSeed } from '../engine/rng';
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
import { rankFromRating, type RankInfo } from '../progression/ranks';
import { PATCH_NOTES, VERSION } from '../patchnotes/notes';
import type { SkillAxis } from '../progression/skills';
import { ArenaBackdrop } from './components/ArenaBackdrop';
import { Boot } from './Boot';
import { Crest } from './components/Crest';
import { GestureNotice, hasBrowserMouseGestures } from './components/GestureNotice';
import { GameView } from './GameView';
import { ErrorBoundary } from './ErrorBoundary';
import { Practice } from './Practice';
import { Progress } from './Progress';
import { PatchNotes } from './PatchNotes';
import { RankEmblem } from './components/RankEmblem';
import { RankUp } from './RankUp';
import { Results } from './Results';
import { Settings } from './Settings';
import '../styles/global.css';
import './app.css';

/**
 * The sections.
 *
 * Three, and one of them is setup. The client used to have seven tabs, four
 * ladders, a daily plan and a calibration sequence, which between them meant a
 * player had to learn the *client* before they could practise; everything that
 * was really a way of choosing a run is now two buttons on a card.
 */
type Route = 'practice' | 'progress' | 'settings' | 'patch';

/** The top bar, in order. Setup and the patch notes live in the corner. */
const NAV: { route: Route; label: string }[] = [
  { route: 'practice', label: 'PRACTICE' },
  { route: 'progress', label: 'PROGRESS' },
];

/** One run: a mode of a mode. */
interface Flow {
  drill: DrillId;
  mode: RunMode;
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
  const [route, setRoute] = useState<Route>('practice');
  const [flow, setFlow] = useState<Flow | null>(null);
  const [results, setResults] = useState<ResultState | null>(null);
  const [rankUp, setRankUp] = useState<{
    from: RankInfo;
    to: RankInfo;
    driver: { axis: SkillAxis; delta: number } | null;
    headline: { label: string; value: string } | null;
  } | null>(null);
  // The cold open. `booted` gates the client; `arenaReady` is the real signal
  // the boot screen is waiting on — the arena's first rendered frame.
  const [booted, setBooted] = useState(false);
  const [arenaReady, setArenaReady] = useState(false);
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

  const inGame = flow !== null && !results;

  useEffect(() => {
    if (!booted || inGame || profile.settings.muted) audio.stopAmbience();
    else audio.startAmbience();
  }, [booted, inGame, profile.settings.muted]);

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

  const startRun = useCallback((drill: DrillId, mode: RunMode) => {
    audio.unlock();
    setResults(null);
    setFlow({ drill, mode, seed: newSeed() });
  }, []);

  const difficulty = useMemo(
    () => (flow ? drillDifficulty(profile, flow.drill) : 0.35),
    // Difficulty is read once per run; recomputing mid-run would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow?.drill, flow?.seed],
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
          survive: { ...prev.survive },
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
          recentBests: [...prev.recentBests],
        };
        report = applyRun(next, result, {});
        return next;
      });

      // React 19 batches the state update above; read the report next tick.
      window.setTimeout(() => {
        const rep = report;
        if (!rep) return;
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
    audio.play('uiBack');
  }, []);

  /** The other mode of the run you just played, without going back to the menu. */
  const switchMode = useCallback(() => {
    if (!flow) return;
    setResults(null);
    setRankUp(null);
    setFlow({ ...flow, mode: flow.mode === 'play' ? 'survive' : 'play', seed: newSeed() });
  }, [flow]);

  // Opening the notes is what marks them read; nothing else clears the dot,
  // and a player who never opens them keeps it. The marking is done by the
  // screen itself, one frame in, so it can still show you what was new.
  const markPatchRead = useCallback(() => {
    setProfile((p) => (p.seenVersion === VERSION ? p : { ...p, seenVersion: VERSION }));
  }, []);

  const doReset = useCallback(() => {
    resetProfile();
    setProfile(newProfile());
    setRoute('practice');
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
          key={`${flow.drill}-${flow.mode}-${flow.seed}`}
          drill={flow.drill}
          mode={flow.mode}
          difficulty={difficulty}
          seed={flow.seed}
          settings={profile.settings}
          context={`${DRILLS[flow.drill].name} · ${RUN_MODES[flow.mode].label}`}
          onComplete={handleComplete}
          onExit={exitToMenu}
          onRetry={retry}
        />
        {results && (
          <Results
            result={results.result}
            report={results.report}
            bounds={results.bounds}
            onRetry={retry}
            onExit={exitToMenu}
            onNext={switchMode}
            nextLabel={`Try ${RUN_MODES[flow.mode === 'play' ? 'survive' : 'play'].label}`}
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
        onReady={() => setArenaReady(true)}
      />
      {!booted && <Boot ready={arenaReady} onEnter={() => setBooted(true)} />}
      {booted && (
        <div className="shell">
          <header className="topbar">
            <div className="logo" onClick={() => setRoute('practice')}>
              <Crest size={26} />
              APEX
              <span className="logo-sub">VAYNE</span>
            </div>

            <nav className="nav">
              {NAV.map((n) => (
                <button
                  key={n.route}
                  className={route === n.route ? 'on' : ''}
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
            </nav>

            <div className="topbar-right">
              {/* Setup: always reachable, never a nav tab — it is a thing you
                  do once and then forget about. */}
              <button
                className={`gear-chip${route === 'settings' ? ' on' : ''}`}
                title="Controls, audio and video"
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
                  <div className="rc-rating mono">{profile.placed ? Math.round(profile.overall) : '—'}</div>
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
            {route === 'practice' && (
              <Practice profile={profile} onPlay={startRun} />
            )}
            {route === 'progress' && (
              <Progress
                profile={profile}
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

const formatHead = (v: number, f: string): string => {
  if (f === 'pct') return `${Math.round(v * 100)}%`;
  if (f === 'ms') return `${Math.round(v)}ms`;
  if (f === 'units') return `${Math.round(v)}u`;
  if (f === 'sec') return `${v.toFixed(1)}s`;
  return `${Math.round(v)}`;
};
