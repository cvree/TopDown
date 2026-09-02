/**
 * The drill → renderer drawing contract.
 *
 * Drills used to reach for a CanvasRenderingContext2D and stroke arcs. In a 3D
 * arena that is the wrong altitude: a drill knows it wants "a countdown ring
 * around this node", not how a ring is rasterised. So drills now emit a small
 * list of intents and the renderer decides that a ground marker is real
 * geometry lying on the floor and a billboard is crisp 2D anchored to a world
 * point. Neither side has to know about the other's coordinate system.
 */

export interface MarkerBase {
  x: number;
  y: number;
  color: string;
  alpha?: number;
  /** Stroke width in world units. */
  width?: number;
  /** Interior wash, 0..1. */
  fill?: number;
  /** Dash count around the ring; 0 for solid. */
  dash?: number;
  /** Radians per second. */
  spin?: number;
  /** Height above the floor; later markers win. */
  rise?: number;
}

export type GroundMarker =
  | (MarkerBase & { kind: 'ring'; radius: number; progress?: number })
  | (MarkerBase & { kind: 'disc'; radius: number })
  | (MarkerBase & { kind: 'sector'; radius: number; a0: number; a1: number })
  | (MarkerBase & { kind: 'line'; x2: number; y2: number; halfWidth: number; progress?: number })
  | (MarkerBase & { kind: 'cross'; radius: number });

export type Billboard =
  /** A row of ability keys with the next one highlighted — the combo prompt. */
  | { kind: 'keys'; x: number; y: number; seq: string[]; labels: string[]; index: number; progress: number }
  /** A short piece of text anchored above a world point. */
  | { kind: 'label'; x: number; y: number; text: string; color: string; size?: number; sub?: string }
  /** A thin horizontal progress bar, e.g. a closing reaction window. */
  | { kind: 'timerBar'; x: number; y: number; progress: number; color: string; width?: number; lift?: number }
  /** A downward caret marking the priority target. */
  | { kind: 'caret'; x: number; y: number; color: string; lift?: number };

export interface DrillPaint {
  markers: GroundMarker[];
  billboards: Billboard[];
}

export const clearPaint = (p: DrillPaint): void => {
  p.markers.length = 0;
  p.billboards.length = 0;
};

export const newPaint = (): DrillPaint => ({ markers: [], billboards: [] });
