/**
 * Headless verification of the one thing that happens before anything else:
 * reading a saved profile back out of storage and drawing the client with it.
 *
 * The simulation has `simtest`, which never opens the client, and the client
 * is where a returning player meets their profile — so this drives the load
 * path with profiles written by builds that no longer exist, and by builds
 * that never existed, and then renders every screen that reads one.
 *
 * The rule it enforces: a profile that has been saved must never be able to
 * take a screen down. A drill can leave the catalogue, a record can be half
 * written, a whole section can be missing — the client comes up, and comes up
 * with the rank its owner earned.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { isDrillId, type DrillId } from '../src/drills/catalog';
import { BootClock } from '../src/ui/boot/clock';
import { MILESTONES, SHOWS, castBoot } from '../src/ui/boot/variants';
import { isErrorCode } from '../src/progression/errors';
import { applyRun, loadProfile, newProfile, saveProfile, type Profile, type RunResult } from '../src/progression/profile';
import { LANE_TIERS } from '../src/progression/lane';
import { MetricsRecorder, derive } from '../src/engine/metrics';
import { CLICK_ACTIONS, WASD_ACTIONS, findConflicts, mayShareCode, resolveBindings } from '../src/engine/input';
import { buildPlan, axisReadings, lastSession, recentImprovements } from '../src/progression/plan';
import {
  errorRollup,
  insights,
  plateaus,
  pressureRetention,
  recommend,
  transferLadder,
} from '../src/progression/coach';

const line = (s: string) => console.log(s);
let failures = 0;
const expect = (label: string, cond: boolean, detail: string) => {
  if (!cond) {
    failures++;
    line(`  ✗ ${label} — ${detail}`);
  } else {
    line(`  ✓ ${label}`);
  }
};

/* ------------------------------------------------------------------ shims */

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as unknown as { window: unknown }).window = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  AudioContext: undefined,
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

const STORAGE_KEY = 'apex.profile.v1';

const load = (raw: unknown): Profile => {
  store.set(STORAGE_KEY, JSON.stringify(raw));
  return loadProfile();
};

/* ------------------------------------------------- profiles from the past */

/**
 * The APM lab replaced thirteen in-game modes with thirteen bench modes under
 * new ids, and the profile version did not move with it. These are the ids a
 * profile saved before that release is still full of.
 */
const RETIRED_DRILLS = [
  'apmAim',
  'apmAim2',
  'apmAimMap',
  'apmPrecision',
  'apmKeys',
  'apmDodge',
  'apmDodgeCd',
  'apmKite',
  'apmDefKite',
  'apmLastHit',
  'apmLastHit2',
  'apmSpacing',
  'apmSmite',
];

/** A profile with a real history, half of it in drills that no longer exist. */
const legacyProfile = (): Record<string, unknown> => {
  const now = Date.now();
  const history: unknown[] = [];
  const errorLog: unknown[] = [];
  for (let i = 0; i < 40; i++) {
    const retired = RETIRED_DRILLS[i % RETIRED_DRILLS.length];
    const live: DrillId = (['movement', 'aim', 'kite', 'dodge'] as DrillId[])[i % 4];
    const drill = i % 2 === 0 ? retired : live;
    history.push({
      drill,
      t: now - (40 - i) * 3600_000,
      score: 600 + i * 4,
      performance: 0.5 + (i % 7) * 0.03,
      difficulty: 0.4,
      overall: 1100 + i,
      key: 0.7,
      keyId: 'pathEff',
      axes: { movement: 0.6, aim: 0.55 },
    });
    errorLog.push({ code: 'EARLY_MOVE', t: now - (40 - i) * 3600_000, drill, count: 2, rate: 0.18 });
  }
  return {
    version: 1,
    name: 'RETURNING',
    createdAt: now - 86_400_000 * 60,
    placed: true,
    placementRuns: 5,
    onboarded: true,
    seenVersion: '1.2.0',
    ratings: { movement: 1420, aim: 1310, kiting: 1275, dodging: 1180 },
    samples: { movement: 20, aim: 14, kiting: 9, dodging: 6 },
    overall: 1327,
    peakOverall: 1350,
    difficulty: { movement: 0.55, aim: 0.5 },
    bests: {
      apmAim: { score: 940, metrics: { apm: 128 }, at: now - 86_400_000 },
      apmSmite: { score: 610, metrics: { hit: 0.8 }, at: now - 86_400_000 * 3 },
      movement: { score: 1180, metrics: { pathEff: 0.91 }, at: now - 7200_000 },
    },
    history,
    daily: {
      date: '2026-01-01',
      completed: ['apmKeys', 'movement'],
      streak: 4,
      lastCompletedDate: '2026-01-01',
      startOverall: 1300,
    },
    settings: { hero: 'someoneWhoLeftTheRoster', movementScheme: 'click' },
    totalRuns: 40,
    totalSeconds: 3600,
    // The lab's own ladder, keyed by the mode names of the day.
    apm: { seeded: true, seededTo: 3, bestApm: 128, bestApmMode: 'apmAim', modes: { apmAim: { unlocked: 4, lastLevel: 3, runs: 12, levels: [] } } },
    dailyMarks: [{ date: '2026-01-01', overall: 1300, ratings: { movement: 1400 } }],
    errorLog,
    recentBests: [
      { drill: 'apmAim', id: 'apm', label: 'APM', value: 128, previous: 120, format: 'int', direction: 'higher', at: now - 3600_000 },
      { drill: 'movement', id: 'pathEff', label: 'PATH', value: 0.91, previous: 0.88, format: 'pct', direction: 'higher', at: now - 1800_000 },
    ],
  };
};

/** A profile that is wrong in every way a written-out object can be wrong. */
const hostileProfile = (): Record<string, unknown> => ({
  version: 1,
  name: null,
  placed: true,
  onboarded: true,
  ratings: null,
  samples: undefined,
  overall: 900,
  bests: { movement: null, notADrill: { score: 5 } },
  history: [null, { drill: null }, { drill: 'movement', t: Date.now(), score: 1, performance: 0.4, difficulty: 0.3, overall: 900, key: 0, keyId: 'x' }],
  daily: { completed: null },
  settings: null,
  vayne: { stages: { vayneTumble: null, vayneBolts: { best: 0.7 }, notAStage: { best: 1 } }, mastery: 200, peak: -4 },
  ezreal: { stages: { ezQ: { best: 0.5, difficulty: 0.4 } } },
  apm: { modes: null },
  wasd: null,
  lane: { tiers: { gold: { runs: 'lots', bestCsPerMin: null }, notATier: { runs: 4 } } },
  dailyMarks: null,
  errorLog: [{ code: 'NOT_A_CODE', drill: 'movement', t: Date.now(), count: 1, rate: 0.5 }, null],
  recentBests: null,
});

/* ---------------------------------------------------------------- helpers */

// Written defensively on purpose: this has to be able to report on a profile
// the load path let through in a state it should not have.
const drillRefs = (p: Profile): string[] =>
  [
    ...(p.history ?? []).map((h) => h?.drill),
    ...Object.keys(p.bests ?? {}),
    ...(p.recentBests ?? []).map((b) => b?.drill),
    ...(p.errorLog ?? []).map((e) => e?.drill),
    ...(p.daily?.completed ?? []),
  ].map((id) => String(id));

/** A block of checks, run so that one throwing is a failure and not the end. */
const section = (title: string, body: () => void): void => {
  line(`\n=== ${title} ===`);
  try {
    body();
  } catch (e) {
    expect(title, false, (e as Error).message);
  }
};

/* ------------------------------------------------------------ the checks */

/* --------------------------------------------------------- the cold open */

/*
 * The loading bar is the first thing anybody ever sees this product do, and
 * the only screen every single player sees every single time. Two failures
 * matter more than anything else it could get wrong: sitting still, which
 * reads as a hang, and claiming to be finished when it is not, which reads
 * as a lie the moment the client comes up half-built. Both are properties of
 * a pure model, so both are checked here rather than by looking at it.
 */
section('The loading bar cannot stall, cannot lie, and cannot go backwards', () => {
  /** Run a clock for `secs` at a jittery frame rate, sampling every tick. */
  const run = (secs: number, marks: [number, (typeof MILESTONES)[number]][] = [], step = 0.016) => {
    const clock = new BootClock(0, 2.5);
    const samples: { t: number; p: number; pct: number; done: boolean }[] = [];
    let pending = marks.slice();
    for (let t = 0; t <= secs; t += step) {
      const now = t * 1000;
      pending = pending.filter(([at, m]) => (t >= at ? (clock.mark(m, now), false) : true));
      const r = clock.tick(now);
      samples.push({ t, p: r.p, pct: r.pct, done: r.done });
    }
    return { clock, samples };
  };

  const everything: [number, (typeof MILESTONES)[number]][] = [
    [0.4, 'scene'],
    [0.8, 'rigs'],
    [1.1, 'frame'],
  ];

  const quick = run(4, everything);
  expect(
    'a fast machine still gets the ceremony',
    quick.samples.find((s) => s.pct === 100)!.t >= 2.4,
    'the bar filled before the floor was served',
  );
  expect('a fast machine reaches a hundred', quick.samples[quick.samples.length - 1].pct === 100, 'it never arrived');
  {
    // The other half of the same promise: a full bar must not then wait. On a
    // machine with everything already in memory the ceremony is the only
    // thing left to serve, and the bar has to arrive with it, not before it.
    const full = quick.samples.find((s) => s.pct === 100)!.t;
    const open = quick.samples.find((s) => s.done)!.t;
    expect('a full bar is never left standing at the door', open - full < 0.35, `it sat at 100% for ${(open - full).toFixed(2)}s`);
  }

  // Monotonicity, on every shape of load there is.
  for (const [what, marks] of [
    ['everything arrives', everything],
    ['nothing ever arrives', [] as [number, (typeof MILESTONES)[number]][]],
    ['the terrain lands and nothing else does', [[0.5, 'scene']] as [number, (typeof MILESTONES)[number]][]],
  ] as const) {
    const { samples } = run(12, marks.slice() as [number, (typeof MILESTONES)[number]][]);
    const back = samples.find((s, i) => i > 0 && s.p < samples[i - 1].p - 1e-9);
    expect(`the bar never goes backwards when ${what}`, back === undefined, `it fell at ${back?.t.toFixed(2)}s`);
  }

  // The stall test: a machine that reports nothing at all for twelve seconds
  // must still have a bar that is visibly moving the whole way through it.
  {
    const { samples } = run(12);
    let worst = 0;
    let worstAt = 0;
    for (let i = 0; i < samples.length; i++) {
      const j = samples.findIndex((s, k) => k > i && s.pct > samples[i].pct);
      const gap = j < 0 ? samples[samples.length - 1].t - samples[i].t : samples[j].t - samples[i].t;
      if (gap > worst) {
        worst = gap;
        worstAt = samples[i].t;
      }
    }
    expect(
      'a bar waiting on a silent machine never rests for a second',
      worst < 1,
      `it sat on one number for ${worst.toFixed(2)}s at ${worstAt.toFixed(1)}s`,
    );
  }

  // Honesty: the hundredth percent belongs to a frame that exists.
  {
    const { samples } = run(30);
    expect('a bar with no first frame never claims to be finished', samples.every((s) => s.pct <= 99), 'it hit 100 on nothing');
    const last = samples[samples.length - 1];
    expect('and it does not pretend it is nearly there either', last.p < 0.93, `it reached ${last.p.toFixed(3)}`);
  }

  // The main thread disappearing for half a second is the normal case on the
  // machines this screen exists for: the model is a function of elapsed time,
  // so it must come back where it would have been, not where it left off.
  {
    const smooth = new BootClock(0, 2.5);
    const stalled = new BootClock(0, 2.5);
    for (let t = 0; t <= 3; t += 0.016) smooth.tick(t * 1000);
    for (const t of [0, 0.4, 1.7, 2.2, 3]) stalled.tick(t * 1000);
    const drift = Math.abs(smooth.read(3000).p - stalled.read(3000).p);
    expect('a stalled main thread costs the bar nothing', drift < 0.02, `it drifted ${(drift * 100).toFixed(1)}%`);
  }

  // Giving up is the promise that no machine can hold anybody here forever.
  {
    const clock = new BootClock(0, 2.5);
    for (let t = 0; t <= 9; t += 0.05) clock.tick(t * 1000);
    clock.giveUp(9000);
    for (let t = 9; t <= 11; t += 0.05) clock.tick(t * 1000);
    expect('giving up lets the player in', clock.read(11000).done, 'the gate never opened');
  }

  // A first frame proves the terrain and the champions exist, said or not.
  {
    const clock = new BootClock(0, 2.5);
    clock.mark('frame', 500);
    expect('a first frame implies everything before it', clock.marks.every((m) => m !== null), 'a milestone was left outstanding');
  }

  // The value handed to the compositor is where the bar is going, never
  // somewhere it has already been.
  {
    const clock = new BootClock(0, 2.5);
    let ok = true;
    for (let t = 0; t <= 8; t += 0.05) {
      const r = clock.tick(t * 1000);
      const ahead = clock.projected(t * 1000, 0.9);
      if (ahead < r.p - 1e-9 || ahead > 1) ok = false;
    }
    expect('the bar is always aimed forwards and never past the end', ok, 'a projection was behind or over');
  }
});

section('The cold open is never quite the same screen twice', () => {
  expect('every show names every piece of work', SHOWS.every((s) => s.phases.length === MILESTONES.length), 'a show is short a phase');
  expect('every show is identifiable', new Set(SHOWS.map((s) => s.id)).size === SHOWS.length, 'two shows share an id');

  // The whole point of remembering the last show is that a random pick from
  // six repeats one load in six, which is exactly often enough for somebody
  // to decide it is not random at all.
  store.delete('apex.boot.last');
  let repeats = 0;
  let previous = '';
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const cast = castBoot(Math.random);
    if (cast.show.id === previous) repeats++;
    previous = cast.show.id;
    seen.add(`${cast.show.id}/${cast.exit}`);
  }
  expect('no show ever runs twice in a row', repeats === 0, `${repeats} loads repeated`);
  expect('every show gets cast', seen.size >= SHOWS.length, `${seen.size} combinations in 400 loads`);
  expect('and every door gets used', seen.size >= SHOWS.length * 3, `only ${seen.size} of 18 combinations appeared`);

  // Deterministic given its randomness, so a bad cast can always be replayed.
  store.delete('apex.boot.last');
  const a = castBoot(() => 0.5);
  store.delete('apex.boot.last');
  const b = castBoot(() => 0.5);
  expect('a cast is reproducible from its randomness', a.show.id === b.show.id && a.epigraph === b.epigraph, 'two identical draws differed');
  expect('the pacing always leaves before the ceiling', a.pacing.loadAt + a.pacing.minShow < a.pacing.maxWait, 'the floor outlasts the ceiling');
});

section('A profile from a build whose catalogue has moved on still loads', () => {
  const p = load(legacyProfile());
  const stale = drillRefs(p).filter((id) => !isDrillId(id));
  expect('nothing stored names a drill that no longer exists', stale.length === 0, stale.join(', '));
  expect('every logged mistake is still a named mistake', p.errorLog.every((e) => isErrorCode(e.code)), 'a stale code survived');

  // The ladder is per axis, not per drill, so none of it is lost with them.
  expect('the rank comes back with its owner', p.overall === 1327 && p.peakOverall === 1350, `${p.overall}/${p.peakOverall}`);
  expect('per-axis ratings survive', p.ratings.movement === 1420 && p.samples.movement === 20, `${p.ratings.movement}/${p.samples.movement}`);
  expect('lifetime totals survive', p.totalRuns === 40 && p.totalSeconds === 3600, `${p.totalRuns}/${p.totalSeconds}`);
  expect('the streak survives', p.daily.streak === 4, String(p.daily.streak));

  // And the runs that are still playable are still there.
  expect('runs in drills that still exist are kept', p.history.length === 20, String(p.history.length));
  expect('records in drills that still exist are kept', Boolean(p.bests.movement), Object.keys(p.bests).join(', '));
  expect('a champion the roster no longer has reads back as one it does', p.settings.hero !== 'someoneWhoLeftTheRoster' && p.settings.hero.length > 0, p.settings.hero);
});

section('A profile that is wrong in every way still loads', () => {
  const p = load(hostileProfile());
  const stale = drillRefs(p).filter((id) => !isDrillId(id));
  expect('nothing stored names a drill that no longer exists', stale.length === 0, stale.join(', '));
  expect('a null record is not mistaken for a record', Object.values(p.bests).every(Boolean), Object.keys(p.bests).join(', '));
  expect('half-written history entries are dropped', p.history.length === 1, String(p.history.length));
  expect('a mistake with no name is dropped', p.errorLog.length === 0, String(p.errorLog.length));
  expect('the champion track comes back whole', Object.keys(p.vayne.stages).length === 4 && p.vayne.stages.vayneTumble.best === 0, JSON.stringify(p.vayne.stages.vayneTumble));
  expect('a mastery of 200 is not a mastery', p.vayne.mastery <= 100 && p.vayne.peak >= 0, `${p.vayne.mastery}/${p.vayne.peak}`);
  expect('the academy comes back whole', Object.keys(p.wasd.modules).length === 9, String(Object.keys(p.wasd.modules).length));
  expect('the lab comes back whole', Object.keys(p.apm.modes).length === 13, String(Object.keys(p.apm.modes).length));
  expect('settings come back complete', typeof p.settings.movementScheme === 'string', String(p.settings.movementScheme));
});

section('The range indicator setting means what the profile meant by it', () => {
  // The setting stopped being a boolean when the ring stopped being permanent.
  // `false` was a real choice — never draw it — and is kept; `true` was the
  // default nobody picked, and honouring it would opt every existing profile
  // out of the feature that replaced it.
  const withShowRange = (v: unknown) => {
    const raw = legacyProfile();
    (raw.settings as Record<string, unknown>).showRange = v;
    return load(raw).settings.rangeDisplay;
  };
  expect('a profile that hid the ring still hides it', withShowRange(false) === 'off', String(withShowRange(false)));
  expect('a profile that never chose gets the check', withShowRange(true) === 'check', String(withShowRange(true)));
  expect('a profile from before the setting existed gets the check', load(legacyProfile()).settings.rangeDisplay === 'check', String(load(legacyProfile()).settings.rangeDisplay));
  const explicit = legacyProfile();
  (explicit.settings as Record<string, unknown>).rangeDisplay = 'always';
  expect('an explicit choice is left alone', load(explicit).settings.rangeDisplay === 'always', String(load(explicit).settings.rangeDisplay));
  const nonsense = legacyProfile();
  (nonsense.settings as Record<string, unknown>).rangeDisplay = 'sometimes';
  expect('and nonsense is not a choice', load(nonsense).settings.rangeDisplay === 'check', String(load(nonsense).settings.rangeDisplay));
});

section('The WASD scheme ships the layout it promises', () => {
  const b = resolveBindings('wasd', {});
  expect('the left hand keeps W A S D', b.moveUp.primary === 'KeyW' && b.moveLeft.primary === 'KeyA' && b.moveDown.primary === 'KeyS' && b.moveRight.primary === 'KeyD', JSON.stringify([b.moveUp, b.moveLeft, b.moveDown, b.moveRight]));
  expect('Q is on right click', b.q.primary === 'Mouse2', b.q.primary);
  expect('W and E are on E and Shift', b.w.primary === 'KeyE' && b.e.primary === 'ShiftLeft', `${b.w.primary}/${b.e.primary}`);
  expect('the ultimate stays on R', b.r.primary === 'KeyR', b.r.primary);
  expect('the summoners are on the digits', b.d.primary === 'Digit1' && b.f.primary === 'Digit2', `${b.d.primary}/${b.f.primary}`);
  expect('stop is out of the way, on X', b.stop.primary === 'KeyX', b.stop.primary);
  expect('both mouse orders are on left click', b.move.primary === 'Mouse0' && b.attackMove.secondary === 'Mouse0', `${b.move.primary}/${b.attackMove.secondary}`);
  expect('and that is not reported as a clash', findConflicts(b, WASD_ACTIONS).size === 0, [...findConflicts(b, WASD_ACTIONS).keys()].join(', '));
  expect('a fresh profile stores no WASD rebinds', Object.keys(newProfile().settings.wasdBindings).length === 0, JSON.stringify(newProfile().settings.wasdBindings));
  expect('the click scheme is untouched', resolveBindings('click', {}).q.primary === 'KeyQ' && resolveBindings('click', {}).move.primary === 'Mouse2', 'the click defaults moved');
});

section('One button may carry both mouse orders, and nothing else may double up', () => {
  const shared = resolveBindings('wasd', { move: { primary: 'Mouse0' } });
  expect('move and attack-move on one button is a layout, not a clash', findConflicts(shared, WASD_ACTIONS).size === 0, [...findConflicts(shared, WASD_ACTIONS).keys()].join(', '));
  const stolen = resolveBindings('wasd', { stop: { primary: 'Mouse0' } });
  expect('a third action on that button still clashes', findConflicts(stolen, WASD_ACTIONS).size > 0, 'the clash went unreported');
  const keyed = resolveBindings('click', { move: { primary: 'KeyA' } });
  expect('sharing a key rather than a button is still a clash', findConflicts(keyed, CLICK_ACTIONS).size > 0, 'the clash went unreported');
  expect('the pair is only ever move and attack-move', mayShareCode('move', 'attackMove', 'Mouse0') && !mayShareCode('move', 'q', 'Mouse0') && !mayShareCode('move', 'attackMove', 'KeyA'), 'the exception is wider than it should be');
});

section('A saved profile survives the round trip unchanged', () => {
  const before = load(legacyProfile());
  saveProfile(before);
  const after = loadProfile();
  expect('loading a profile the client wrote changes nothing', JSON.stringify(after) === JSON.stringify(before), 'the second load differed');
});

section('Everything the home screen asks a profile, on every profile', () => {
  const cases: [string, Profile][] = [
    ['a new profile', newProfile()],
    ['a profile from an older catalogue', load(legacyProfile())],
    ['a profile that is wrong in every way', load(hostileProfile())],
  ];
  const reads: [string, (p: Profile) => unknown][] = [
    ['buildPlan', buildPlan],
    ['axisReadings', axisReadings],
    ['lastSession', lastSession],
    ['recentImprovements', (p) => recentImprovements(p)],
    ['errorRollup', (p) => errorRollup(p, 7)],
    ['recommend', (p) => recommend(p, 3)],
    ['insights', insights],
    ['pressureRetention', (p) => pressureRetention(p)],
    ['plateaus', plateaus],
    ['transferLadder', (p) => transferLadder(p, 'movement')],
  ];
  for (const [what, p] of cases) {
    for (const [name, fn] of reads) {
      try {
        fn(p);
        expect(`${name} reads ${what}`, true, '');
      } catch (e) {
        expect(`${name} reads ${what}`, false, (e as Error).message);
      }
    }
  }
});

section('The lane ladder survives a profile that is wrong about it', () => {
  const p = load(hostileProfile());
  expect(
    'every tier comes back, whatever was stored',
    LANE_TIERS.every((t) => typeof p.lane.tiers[t.id]?.runs === 'number'),
    Object.keys(p.lane.tiers).join(', '),
  );
  expect('a run count that was a word comes back as a number', p.lane.tiers.gold.runs === 0, `${p.lane.tiers.gold.runs}`);
  expect('and a tier that does not exist is dropped', p.lane.tiers.notATier === undefined, 'a stale tier survived');
});

section('A lane run is recorded against the opponent it was played against', () => {
  const p = newProfile();
  const blank = new MetricsRecorder().m;
  const lane = (csPerMin: number, csLead: number, goldLead: number, score: number): RunResult => ({
    drill: 'lanePhase',
    mode: 'play',
    seed: 1,
    difficulty: LANE_TIERS[2].difficulty,
    score,
    performance: 0.6,
    axisPerformance: { lastHitting: 0.6 },
    metrics: blank,
    derived: derive(blank, 800),
    keyMetrics: [
      { id: 'csPerMin', label: 'CS PER MINUTE', value: csPerMin, format: 'rate', direction: 'higher' },
      { id: 'csLead', label: 'CS DIFFERENCE', value: csLead, format: 'int', direction: 'higher' },
      { id: 'goldLead', label: 'GOLD DIFFERENCE', value: goldLead, format: 'int', direction: 'higher' },
    ],
    endReason: 'time',
    seconds: 150,
    strikes: 0,
    helped: [],
    hurt: [],
    advice: '',
  });
  const first = applyRun(p, lane(6.2, 4, 220, 900));
  expect('the report carries the lane record', first.lane !== null, 'no lane in the report');
  expect('the run lands on the tier it was played at', p.lane.tiers.gold.runs === 1, `${p.lane.tiers.gold.runs}`);
  expect('and a lane won on gold is counted', p.lane.tiers.gold.wins === 1, `${p.lane.tiers.gold.wins}`);
  applyRun(p, lane(4.1, -6, -300, 400));
  expect('a worse lane does not overwrite the record', p.lane.tiers.gold.bestCsPerMin === 6.2, `${p.lane.tiers.gold.bestCsPerMin}`);
  expect('but it is still counted as a lane played', p.lane.tiers.gold.runs === 2, `${p.lane.tiers.gold.runs}`);
  expect('and a lane lost on gold is not a win', p.lane.tiers.gold.wins === 1, `${p.lane.tiers.gold.wins}`);
  expect('nothing lands on a tier that was not played', p.lane.tiers.iron.runs === 0, `${p.lane.tiers.iron.runs}`);
});

line('\n=== Every screen that reads a profile draws it, on every profile ===');

// The screens are imported lazily and typed loosely on purpose: this is a
// smoke test of the render, not of the props, and every one of them takes a
// different set of callbacks it never calls here.
const screens = async (): Promise<[string, (p: Profile) => unknown][]> => {
  const noop = () => undefined;
  const [{ Practice, SECTION_IDS }, { Lab }, { Progress }] =
    await Promise.all([
      import('../src/ui/Practice'),
      import('../src/ui/Lab'),
      import('../src/ui/Progress'),
    ]);
  return [
    // Every tab, not only the one a fresh mount opens on. Each section reads a
    // different corner of a stored profile and is only rendered while its own
    // tab is open — so a check that drew the default tab would be checking the
    // least of the screen.
    ...SECTION_IDS.map(
      (id): [string, (p: Profile) => unknown] => [
        `PRACTICE · ${id.toUpperCase()}`,
        (profile) =>
          createElement(Practice as any, {
            profile,
            settings: profile.settings,
            onPlay: noop,
            initialSection: id,
          }),
      ],
    ),
    // The lab is its own screen now, and its cards still read further into a
    // saved record than anything else in the client: thirteen modes, ten level
    // records each, and an infinite ledger under every one of them.
    ['THE LAB', (profile) => createElement(Lab as any, { profile, onPlay: noop })],
    ['PROGRESS', (profile) => createElement(Progress as any, { profile, onRename: noop, onReset: noop, onPlay: noop })],
  ];
};

const main = async (): Promise<void> => {
  const list = await screens();
  const cases: [string, Profile][] = [
    ['a new profile', newProfile()],
    ['a profile from an older catalogue', load(legacyProfile())],
    ['a profile that is wrong in every way', load(hostileProfile())],
  ];
  for (const [what, p] of cases) {
    for (const [name, el] of list) {
      try {
        const html = renderToStaticMarkup(el(p) as never);
        expect(`${name} draws ${what}`, html.length > 0, 'nothing was drawn');
      } catch (e) {
        expect(`${name} draws ${what}`, false, (e as Error).message);
      }
    }
  }

  line(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
};

void main();
