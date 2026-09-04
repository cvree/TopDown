/**
 * Headless verification of the one thing that happens before anything else:
 * reading a saved profile back out of storage and drawing the client with it.
 *
 * The simulation has `simtest` and the instruments have `testcheck`. Neither
 * of them ever opens the client, and the client is where a returning player
 * meets their profile — so this drives the load path with profiles written by
 * builds that no longer exist, and by builds that never existed, and then
 * renders every screen that reads one.
 *
 * The rule it enforces: a profile that has been saved must never be able to
 * take a screen down. A drill can leave the catalogue, a record can be half
 * written, a whole section can be missing — the client comes up, and comes up
 * with the rank its owner earned.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { isDrillId, type DrillId } from '../src/drills/catalog';
import { isErrorCode } from '../src/progression/errors';
import { isTestId } from '../src/tests/catalog';
import { loadProfile, newProfile, saveProfile, type Profile } from '../src/progression/profile';
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
    tests: { reaction: { best: 210, bestRating: 1500, last: 230, attempts: 4, at: now, history: [] }, aRetiredTest: { best: 1 } },
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
  dailyMarks: null,
  errorLog: [{ code: 'NOT_A_CODE', drill: 'movement', t: Date.now(), count: 1, rate: 0.5 }, null],
  tests: null,
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

section('A profile from a build whose catalogue has moved on still loads', () => {
  const p = load(legacyProfile());
  const stale = drillRefs(p).filter((id) => !isDrillId(id));
  expect('nothing stored names a drill that no longer exists', stale.length === 0, stale.join(', '));
  expect('every logged mistake is still a named mistake', p.errorLog.every((e) => isErrorCode(e.code)), 'a stale code survived');
  expect('every test record is still a test', Object.keys(p.tests).every(isTestId), Object.keys(p.tests).join(', '));

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

line('\n=== Every screen that reads a profile draws it, on every profile ===');

// The screens are imported lazily and typed loosely on purpose: this is a
// smoke test of the render, not of the props, and every one of them takes a
// different set of callbacks it never calls here.
const screens = async (): Promise<[string, (p: Profile) => unknown][]> => {
  const noop = () => undefined;
  const [{ Today }, { Home }, { Progress }, { Records }, { Academy }, { Apm }, { Vayne }, { Tests }] =
    await Promise.all([
      import('../src/ui/Today'),
      import('../src/ui/Home'),
      import('../src/ui/Progress'),
      import('../src/ui/Records'),
      import('../src/ui/Academy'),
      import('../src/ui/Apm'),
      import('../src/ui/Vayne'),
      import('../src/ui/Tests'),
    ]);
  return [
    ['TODAY', (profile) => createElement(Today as any, { profile, onStartSession: noop, onPlay: noop, onPlacement: noop, onSection: noop })],
    ['DRILLS', (profile) => createElement(Home as any, { profile, onPlay: noop, onDaily: noop, onProfile: noop, onPlacement: noop, onVayne: noop, onAcademy: noop, onApm: noop })],
    ['PROGRESS', (profile) => createElement(Progress as any, { profile, onRename: noop, onReset: noop, onPlay: noop })],
    ['RECORDS', (profile) => createElement(Records as any, { profile, onPlay: noop, onTests: noop, onTrain: noop })],
    ['ACADEMY', (profile) => createElement(Academy as any, { profile, onPlay: noop, onBack: noop, onAdoptKeys: noop })],
    ['LAB', (profile) => createElement(Apm as any, { profile, focus: null, onPlay: noop, onBack: noop, onPlacement: noop })],
    ['CHAMPION', (profile) => createElement(Vayne as any, { profile, onPlay: noop, onBack: noop })],
    ['TESTS', (profile) => createElement(Tests as any, { profile, onRun: noop, onBack: noop })],
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
