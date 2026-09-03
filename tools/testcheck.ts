/**
 * Headless verification of the twelve skill tests.
 *
 * The drills have `simtest`, which asserts that playing correctly scores well
 * and that presence scores nothing. The tests need the same guarantee and one
 * more besides: an instrument that can never finish is broken even if its
 * scoring is perfect, so every test is driven to completion by a player that
 * does nothing at all.
 *
 * Each test is also driven by an *oracle* — a policy that reads the runner's
 * own state and plays it perfectly. The oracle exists to prove the obvious
 * thing that is easy to get wrong: that the grade actually responds to play.
 */

import { Rng } from '../src/engine/rng';
import { createTest } from '../src/tests';
import { gradeTest, TEST_LIST, TESTS, valueForRating, type TestId } from '../src/tests/catalog';
import { RATING_MAX } from '../src/progression/ranks';
import type { Frame, TestRunner } from '../src/tests/types';

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

// The tests draw every frame. Nothing here has to render — it only has to not
// throw — so the 2D context is a proxy that swallows every call and returns
// itself, plus the handful of properties canvas code actually reads back.
const stubCtx = (): CanvasRenderingContext2D => {
  const grad = { addColorStop: () => undefined };
  const noop = () => undefined;
  const target: Record<string, unknown> = {
    measureText: () => ({ width: 8 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    canvas: { width: 1200, height: 700 },
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : noop),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
};

(globalThis as unknown as { window: unknown }).window = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  AudioContext: undefined,
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ getContext: () => null, width: 0, height: 0 }),
};

/* ------------------------------------------------------------------ drive */

const W = 1200;
const H = 700;
const DT = 1 / 60;
/** Two real minutes of frames — longer than any test is allowed to take. */
const MAX_FRAMES = 60 * 130;

type Peek = Record<string, unknown>;

interface Driver {
  /** Called once a frame, before the runner updates. */
  act: (r: TestRunner, peek: Peek, mouse: { x: number; y: number }) => void;
}

const idle: Driver = { act: () => undefined };

/**
 * Someone holding their whole keyboard down and clicking constantly.
 *
 * This is not a scoring check — it is a liveness one. The reaction tests all
 * replay a trial when you answer before the cue, and a run that replays a
 * trial on every frame is a run that never ends.
 */
const MASH_KEYS = [
  'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyD', 'KeyF',
  'KeyA', 'KeyS', 'Space', 'ArrowLeft', 'ArrowRight',
];
const masher: Driver = {
  act: (r, _p, mouse) => {
    for (const k of MASH_KEYS) r.keyDown?.(k);
    r.pointerDown?.(mouse.x, mouse.y, 0);
  },
};

/**
 * Perfect play, per test. These reach into each runner's own state on purpose:
 * the point is not to simulate a human but to establish the ceiling, so that a
 * scoring bug which makes good play indistinguishable from bad play fails here
 * rather than in front of a player.
 */
const ORACLE: Record<TestId, Driver> = {
  flashReact: { act: (r, p) => p.phase === 'cue' && r.keyDown?.('KeyF') },
  soundCue: { act: (r, p) => p.phase === 'cue' && r.keyDown?.('Space') },
  keyCast: {
    act: (r, p) => {
      if (p.phase !== 'cue') return;
      r.keyDown?.(['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyD', 'KeyF'][p.target as number]);
    },
  },
  dodgeRead: {
    act: (r, p) => {
      if (p.phase !== 'cue') return;
      // Axes 0 and 1 travel horizontally, so the safe keys are vertical.
      r.keyDown?.((p.axis as number) < 2 ? 'KeyW' : 'KeyA');
    },
  },
  flick: {
    act: (r, p, mouse) => {
      const t = p.target as { x: number; y: number };
      if (!p.placed || !t) return;
      mouse.x = t.x;
      mouse.y = t.y;
      r.pointerDown?.(t.x, t.y, 0);
    },
  },
  lead: {
    act: (r, p) => {
      if (p.missile || (p.cooldown as number) > 0 || !p.inited) return;
      const aim = (p.intercept as () => { x: number; y: number } | null).call(p);
      if (aim) r.pointerDown?.(aim.x, aim.y, 0);
    },
  },
  csClock: {
    act: (r, p) => {
      if (p.phase !== 'fall') return;
      const centre = ((p.bandStart as number) + (p.bandEnd as number)) / 2;
      if ((p.timer as number) >= centre - (p.windup as number)) r.keyDown?.('Space');
    },
  },
  track: {
    act: (_r, p, mouse) => {
      const t = p.p as { x: number; y: number };
      mouse.x = t.x;
      mouse.y = t.y;
    },
  },
  mapRecall: {
    act: (r, p) => {
      if (p.phase !== 'answer') return;
      const pings = p.pings as { x: number; y: number }[];
      const guesses = p.guesses as unknown[];
      const rect = p.rect as { x: number; y: number; s: number };
      const next = pings[guesses.length];
      if (next) r.pointerDown?.(rect.x + next.x * rect.s, rect.y + next.y * rect.s, 0);
    },
  },
  cooldowns: {
    act: (r, p) => {
      const q = p.q as { truth: boolean } | null;
      if (q) r.keyDown?.(q.truth ? 'ArrowRight' : 'ArrowLeft');
    },
  },
  execute: {
    act: (r, p) => {
      const round = p.round as { kill: boolean } | null;
      if (round) r.keyDown?.(round.kill ? 'ArrowRight' : 'ArrowLeft');
    },
  },
  comboRecall: {
    act: (r, p) => {
      if (p.phase !== 'go') return;
      const seq = p.seq as number[];
      const at = p.at as number;
      r.keyDown?.(['KeyQ', 'KeyW', 'KeyE', 'KeyR'][seq[at]]);
    },
  },
};

interface Outcome {
  frames: number;
  finished: boolean;
  value: number;
  rating: number;
}

const drive = (id: TestId, driver: Driver, seed = 4242): Outcome => {
  const runner = createTest(id, new Rng(seed));
  const peek = runner as unknown as Peek;
  const ctx = stubCtx();
  const mouse = { x: W / 2, y: H / 2, inside: true, down: false };
  let t = 0;
  let frames = 0;

  while (frames < MAX_FRAMES && !runner.finished()) {
    driver.act(runner, peek, mouse);
    t += DT;
    frames++;
    const frame: Frame = { ctx, w: W, h: H, t, dt: DT, mouse };
    runner.update(frame);
    // The prompt and the rail are read every frame by the shell; a test that
    // throws in either is broken even though nothing else would notice.
    runner.prompt();
    runner.progress();
  }

  const finished = runner.finished();
  const res = runner.result();
  return { frames, finished, value: res.primary, rating: gradeTest(id, res.primary) };
};

/* ------------------------------------------------------------------ checks */

line('\n=== Grading tables are well formed ===');
for (const meta of TEST_LIST) {
  const a = meta.anchors;
  const ratingsRise = a.every((pt, i) => i === 0 || pt[1] > a[i - 1][1]);
  const lower = meta.primaryDirection === 'lower';
  const valuesMove = a.every((pt, i) => i === 0 || (lower ? pt[0] < a[i - 1][0] : pt[0] > a[i - 1][0]));
  expect(`${meta.name}: ratings rise`, ratingsRise, a.map((x) => x[1]).join(','));
  expect(
    `${meta.name}: values move the way the test says they do`,
    valuesMove,
    `${meta.primaryDirection}: ${a.map((x) => x[0]).join(',')}`,
  );
  expect(`${meta.name}: table spans the full ladder`, a[0][1] === 0 && a[a.length - 1][1] === RATING_MAX, `${a[0][1]}..${a[a.length - 1][1]}`);
}

line('\n=== Grading is monotonic and inverts cleanly ===');
for (const meta of TEST_LIST) {
  const a = meta.anchors;
  const lower = meta.primaryDirection === 'lower';
  const worst = a[0][0];
  const best = a[a.length - 1][0];

  // Sweep the table and confirm the grade never moves the wrong way.
  let prev = -1;
  let monotone = true;
  for (let i = 0; i <= 60; i++) {
    const v = worst + ((best - worst) * i) / 60;
    const g = gradeTest(meta.id, v);
    if (g < prev - 1e-6) monotone = false;
    prev = g;
  }
  expect(`${meta.name}: grade rises with better play`, monotone, 'grade went backwards mid-table');

  const offTheEnd = lower ? worst * 1.6 : worst * 0.4;
  expect(`${meta.name}: floor is Iron`, gradeTest(meta.id, offTheEnd) === 0, `${gradeTest(meta.id, offTheEnd)}`);
  expect(
    `${meta.name}: ceiling is Challenger`,
    gradeTest(meta.id, lower ? best * 0.5 : best * 1.5) === RATING_MAX,
    `${gradeTest(meta.id, lower ? best * 0.5 : best * 1.5)}`,
  );

  // valueForRating is what the results card promises you for the next tier;
  // it has to be the true inverse or the promise is a lie.
  const mid = a[Math.floor(a.length / 2)];
  const back = valueForRating(meta.id, mid[1]);
  expect(`${meta.name}: next-tier target inverts the grade`, Math.abs(back - mid[0]) < 1e-6, `${back} vs ${mid[0]}`);
}

line('\n=== Every test finishes, even when nobody plays it ===');
for (const meta of TEST_LIST) {
  const out = drive(meta.id, idle);
  line(
    `  ${meta.name.padEnd(18)} idle  ${(out.frames / 60).toFixed(1)}s  value ${out.value.toFixed(1)}  rating ${Math.round(out.rating)}`,
  );
  expect(`${meta.name} terminates with no input`, out.finished, `still running after ${(out.frames / 60).toFixed(0)}s`);
}

line('\n=== Every test finishes, even when somebody mashes it ===');
for (const meta of TEST_LIST) {
  const out = drive(meta.id, masher);
  line(
    `  ${meta.name.padEnd(18)} mash  ${(out.frames / 60).toFixed(1)}s  value ${out.value.toFixed(1)}  rating ${Math.round(out.rating)}`,
  );
  expect(`${meta.name} terminates under mashing`, out.finished, `still running after ${(out.frames / 60).toFixed(0)}s`);
  expect(`${meta.name} cannot be passed by mashing`, out.rating < 900, `rating ${Math.round(out.rating)}`);
}

line('\n=== Honesty: doing nothing cannot score ===');
for (const meta of TEST_LIST) {
  const out = drive(meta.id, idle);
  // Cooldowns and Execute are two-way calls, so silence is scored as the wrong
  // answer every time — the bottom of the ladder, not merely a poor grade.
  expect(`${meta.name} cannot be passed by presence`, out.rating < 400, `rating ${Math.round(out.rating)}`);
}

line('\n=== Perfect play beats presence, on every instrument ===');
for (const meta of TEST_LIST) {
  const good = drive(meta.id, ORACLE[meta.id]);
  const bad = drive(meta.id, idle);
  line(
    `  ${meta.name.padEnd(18)} oracle value ${good.value.toFixed(1)} → ${Math.round(good.rating)}   idle ${bad.value.toFixed(1)} → ${Math.round(bad.rating)}`,
  );
  expect(`${meta.name}: the oracle finishes`, good.finished, `${(good.frames / 60).toFixed(0)}s`);
  expect(
    `${meta.name}: playing well outranks doing nothing`,
    good.rating > bad.rating,
    `${Math.round(good.rating)} vs ${Math.round(bad.rating)}`,
  );
  expect(
    `${meta.name}: perfect play reaches the top of the ladder`,
    good.rating > 2400,
    `only reached ${Math.round(good.rating)} — the ceiling may be unreachable`,
  );
}

line('\n=== Runs are reproducible from a seed ===');
for (const meta of TEST_LIST) {
  const a = drive(meta.id, ORACLE[meta.id], 909);
  const b = drive(meta.id, ORACLE[meta.id], 909);
  expect(`${meta.name}: same seed, same run`, Math.abs(a.value - b.value) < 1e-6, `${a.value} vs ${b.value}`);
}

void TESTS;
line(`\n${failures === 0 ? 'ALL TEST CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
