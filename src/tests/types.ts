/**
 * Skill tests.
 *
 * A test is not a drill. A drill is a 60-second run in the 3D arena that moves
 * your ladder rating; a test is a 20-second instrument that measures exactly
 * one thing and hands you a number you can chase. Reaction. Prediction. Recall.
 *
 * They live in their own tiny 2D world on purpose: no camera, no pathing, no
 * champion — nothing between the cue and your hand. That is the only way a
 * reaction number means anything.
 *
 * Every test implements this one interface, so the shell (countdown, canvas,
 * input, results, personal bests) is written once and every test gets it.
 */

import type { Rng } from '../engine/rng';

export type Fmt = 'ms' | 'pct' | 'int' | 'sec' | 'units' | 'apm';

export interface Stat {
  label: string;
  value: number;
  format: Fmt;
  /** Which way is better. Drives the colour on the results screen. */
  direction?: 'higher' | 'lower';
}

export interface TestResult {
  /** The headline number. Graded against the test's anchors. */
  primary: number;
  /** Per-trial values, oldest first — drawn as the run's trace. */
  trials: number[];
  stats: Stat[];
  /** One or two plain-language lines about how it actually went. */
  notes: string[];
}

export interface Frame {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels. The context is already scaled for DPR. */
  w: number;
  h: number;
  /** Seconds since the countdown ended. */
  t: number;
  dt: number;
  mouse: { x: number; y: number; inside: boolean; down: boolean };
}

export interface TestRunner {
  /** The line in the banner. Changes as the test moves through its phases. */
  prompt(): string;
  /** 0..1 for the rail under the banner. */
  progress(): number;
  /** Simulate and draw one frame. */
  update(f: Frame): void;

  pointerDown?(x: number, y: number, button: number): void;
  pointerUp?(x: number, y: number, button: number): void;
  /** `code` is a KeyboardEvent.code ('KeyQ', 'Space', 'ArrowLeft'). */
  keyDown?(code: string): void;

  finished(): boolean;
  result(): TestResult;

  /** How the pointer should look while this test is live. */
  readonly cursor?: 'crosshair' | 'none' | 'default';
  /** Tests that read the keyboard say so, so the shell can hint at it. */
  readonly usesKeys?: boolean;
}

export type TestFactory = (rng: Rng) => TestRunner;
