import { flushSync } from 'react-dom';

/**
 * The client's motion, in code.
 *
 * The CSS half lives in `global.css` as tokens — five durations, three curves,
 * a stagger. This is the other half: the handful of things a stylesheet cannot
 * do on its own, built on the same numbers so a number that counts up in code
 * and a panel that settles in CSS feel like the same physics.
 *
 * Everything here is presentation. None of it is imported by the simulation,
 * and none of it can change what a run scored.
 */

/** The durations, in milliseconds — the same five as `--dur-1…5`. */
export const DUR = { 1: 120, 2: 180, 3: 240, 4: 320, 5: 560 } as const;

/** The delay between siblings in a staggered entrance, as `--stagger`. */
export const STAGGER = 45;

// ------------------------------------------------------------------ calm

let calmSetting = false;

/**
 * Whether motion should be calm: the OS asked for reduced motion, or the
 * player switched on Reduced effects. Either way the answer is the same — a
 * complete client with nothing travelling across the screen.
 */
export const isCalm = (): boolean => {
  if (calmSetting) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
};

/** Put the client's motion setting on the document root, where the CSS reads it (`data-motion`). */
export const setCalm = (lowFx: boolean): void => {
  calmSetting = lowFx;
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.motion = isCalm() ? 'calm' : 'full';
};

// -------------------------------------------------------------- springs

export interface Spring {
  stiffness: number;
  damping: number;
  mass?: number;
}

/** The two springs the stylesheet samples: `--ease-spring` and `--ease-forge`. */
export const SPRINGS = {
  settle: { stiffness: 260, damping: 26 },
  forge: { stiffness: 320, damping: 24 },
} satisfies Record<string, Spring>;

export interface SpringState {
  x: number;
  v: number;
}

/**
 * One step of a spring towards `target`, semi-implicit Euler. Stable at any
 * frame rate the client will see, because long frames are cut into short ones.
 * Returns whether it has come to rest.
 */
export const stepSpring = (s: SpringState, target: number, sp: Spring, dt: number): boolean => {
  const m = sp.mass ?? 1;
  let left = Math.min(dt, 0.1);
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    const a = (-sp.stiffness * (s.x - target) - sp.damping * s.v) / m;
    s.v += a * h;
    s.x += s.v * h;
    left -= h;
  }
  const rest = Math.abs(s.x - target) < 1e-3 && Math.abs(s.v) < 1e-2;
  if (rest) {
    s.x = target;
    s.v = 0;
  }
  return rest;
};

/**
 * A spring as a CSS `linear()` easing, plus how long it takes to settle. This
 * is where the two curves in `global.css` came from; it is kept so a new one
 * can be made the same way rather than drawn by eye.
 */
export const springCurve = (sp: Spring, samples = 24): { css: string; ms: number } => {
  const s: SpringState = { x: 0, v: 0 };
  const trace: [number, number][] = [];
  let t = 0;
  while (t < 3) {
    const rest = stepSpring(s, 1, sp, 1 / 600);
    t += 1 / 600;
    trace.push([t, s.x]);
    if (rest && t > 0.1) break;
  }
  const pts: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const at = (t * i) / samples;
    const hit = trace.find((p) => p[0] >= at) ?? trace[trace.length - 1];
    pts.push(Math.round(hit[1] * 1000) / 1000);
  }
  pts[0] = 0;
  pts[pts.length - 1] = 1;
  return { css: `linear(${pts.join(', ')})`, ms: Math.round(t * 1000) };
};

// ------------------------------------------------------------- helpers

/** The delay for the `i`th sibling of a staggered entrance, capped so a long list never drags. */
export const stagger = (i: number, step = STAGGER, cap = 8): number => (isCalm() ? 0 : Math.min(i, cap) * step);

/** The strong ease-out the tokens use, for code that animates numbers. */
export const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);

/**
 * Animate a number from `from` to `to` over `ms`, calling `onFrame` with each
 * value. Calm motion jumps straight to the end. Returns a cancel function.
 */
export const tween = (
  from: number,
  to: number,
  ms: number,
  onFrame: (v: number) => void,
  ease: (t: number) => number = easeOut,
): (() => void) => {
  if (isCalm() || ms <= 0 || typeof requestAnimationFrame !== 'function') {
    onFrame(to);
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    onFrame(from + (to - from) * ease(k));
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
};

// ----------------------------------------------------- screen changes

/**
 * A change of state as a View Transition, for the one change that is a
 * shared-element move: a card opening into a run (see `launch.ts`). Tabs do
 * not use it — they are a plain CSS entrance, which captures nothing and
 * never holds the page still.
 *
 * The update runs synchronously inside the transition so the browser captures
 * the right before and after; without the API, or with calm motion, it simply
 * runs. `className` goes on the root for the life of the transition.
 */
export const viewTransition = (update: () => void, className?: string): void => {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || isCalm() || typeof doc.startViewTransition !== 'function') {
    update();
    return;
  }
  const root = doc.documentElement;
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    flushSync(update);
  };
  try {
    if (className) root.classList.add(className);
    const vt = doc.startViewTransition(run);
    const done = () => {
      if (className) root.classList.remove(className);
    };
    vt.finished.then(done, done);
    // The browser has to paint the old screen once before it can hand over,
    // and on a slow machine with the arena running behind it that can take
    // several frames. A click is never allowed to wait on a flourish: if the
    // hand-over has not happened almost at once, the move is dropped and the
    // screen simply changes.
    window.setTimeout(() => {
      if (!ran) vt.skipTransition();
    }, 150);
  } catch {
    if (className) root.classList.remove(className);
    run();
  }
};
