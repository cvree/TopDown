import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
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
} from '../progression/profile';
import { rankFromRating, type RankInfo } from '../progression/ranks';
import type { SkillAxis } from '../progression/skills';
import { ArenaBackdrop } from './components/ArenaBackdrop';
import { GestureNotice, hasBrowserMouseGestures } from './components/GestureNotice';
import { Daily } from './Daily';
import { GameView } from './GameView';
import { Home } from './Home';
import { PlacementIntro, PlacementReveal } from './Placement';
import { ProfileScreen } from './ProfileScreen';
import { RankEmblem } from './components/RankEmblem';
import { RankUp } from './RankUp';
import { Results } from './Results';
import { Settings } from './Settings';
import '../styles/global.css';
import './app.css';

type Route = 'home' | 'profile' | 'daily' | 'settings';

interface Flow {
  kind: 'single' | 'placement' | 'daily';
  index: number;
  queue: DrillId[];
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
  const [flow, setFlow] = useState<Flow | null>(null);
  const [results, setResults] = useState<ResultState | null>(null);
  const [rankUp, setRankUp] = useState<{
    from: RankInfo;
    to: RankInfo;
    driver: { axis: SkillAxis; delta: number } | null;
    headline: { label: string; value: string } | null;
  } | null>(null);
  const [placementIntro, setPlacementIntro] = useState(false);
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

  const inGame = flow !== null && !results && !placementReveal && !interstitial;

  useEffect(() => {
    if (inGame || profile.settings.muted) audio.stopAmbience();
    else audio.startAmbience();
  }, [inGame, profile.settings.muted]);

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
  const runInProgress = flow !== null || placementReveal;
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

  const startSingle = useCallback((id: DrillId) => {
    audio.unlock();
    setResults(null);
    setFlow({ kind: 'single', index: 0, queue: [id], seed: newSeed() });
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
    () => (currentDrill ? drillDifficulty(profile, currentDrill) : 0.35),
    // Difficulty is read once per run; recomputing mid-run would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentDrill, flow?.seed],
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
        };
        report = applyRun(next, result, { placement: flow.kind === 'placement' });
        if (flow.kind === 'daily' || flow.kind === 'single') markDailyComplete(next, result.drill);
        if (flow.kind === 'placement' && flow.index >= flow.queue.length - 1) {
          next.placed = true;
          next.placementRuns = flow.queue.length;
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

  const doReset = useCallback(() => {
    resetProfile();
    const p = newProfile();
    setProfile(p);
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

  if (flow && currentDrill) {
    const context =
      flow.kind === 'placement'
        ? `CALIBRATION ${flow.index + 1} / ${flow.queue.length}`
        : flow.kind === 'daily'
          ? `DAILY ${flow.index + 1} / ${flow.queue.length}`
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
          onComplete={handleComplete}
          onExit={exitToMenu}
          onRetry={retry}
        />
        {interstitial && (
          <div className="interstitial">
            <div className="int-inner">
              <div className="eyebrow">
                {flow.kind === 'placement' ? 'CALIBRATION' : 'DAILY'} {interstitial.step} / {interstitial.total}
              </div>
              <div className="int-name display" style={{ color: DRILLS[interstitial.drill].accent }}>
                {DRILLS[interstitial.drill].name}
              </div>
              <div className="int-brief">{DRILLS[interstitial.drill].brief}</div>
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

  return (
    <div className="app">
      <ArenaBackdrop enabled={!profile.settings.lowFx} />
      <div className="shell">
        <header className="topbar">
          <div className="logo" onClick={() => setRoute('home')}>
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
              <path d="M16 2 L29 26 H3 Z" fill="none" stroke="#c8aa6e" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M16 11 L22 22 H10 Z" fill="#c8aa6e" />
            </svg>
            APEX
            <span className="logo-sub">MECHANICS</span>
          </div>

          <nav className="nav">
            {(['home', 'daily', 'profile', 'settings'] as Route[]).map((r) => (
              <button
                key={r}
                className={route === r ? 'on' : ''}
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.unlock();
                  audio.play('uiClick');
                  setRoute(r);
                }}
              >
                {r === 'home' ? 'TRAIN' : r.toUpperCase()}
              </button>
            ))}
          </nav>

          <div className="topbar-right">
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
          />
        )}
        {route === 'daily' && (
          <Daily profile={profile} onStart={startDaily} onBack={() => setRoute('home')} />
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
      </div>
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
