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
  | { kind: 'caret'; x: number; y: number; color: string; lift?: number }
  /**
   * The attack cadence, drawn as the one bar the WASD academy is built around.
   *
   * A basic attack is not an event, it is four stretches of time, and only two
   * of them behave the same way when you move. Drawing them as one segmented
   * bar — committed, release, free, ready — is what turns "do not move too
   * early" from advice into something you can watch happen.
   */
  | {
      kind: 'cadence';
      x: number;
      y: number;
      /** Share of the cycle spent winding up, and in backswing. */
      windup: number;
      backswing: number;
      /** Where in the cycle the champion is, 0..1 from the attack starting. */
      head: number;
      phase: 'idle' | 'windup' | 'backswing' | 'ready';
      /** True while a direction is held — the bar says what that is costing. */
      moving: boolean;
      note?: string;
    };

/**
 * An annotation drawn onto one unit's health bar.
 *
 * The health bar is where a last-hitter's eyes already are, so that is where
 * the teaching has to happen — not in a panel at the side of the screen. A
 * plate can say three things about a bar: how much damage is already on its
 * way to it, where your own next attack would leave it, and whether the unit
 * is takeable right now.
 */
export interface PlateMark {
  actorId: number;
  /**
   * Share of maximum health already committed by attacks in flight — missiles
   * on the way plus windups that cannot be called back. Drawn as a hatched
   * slice at the end of the bar, so damage always visibly comes from somewhere.
   */
  incoming?: number;
  /**
   * Share of maximum health your own next attack removes. Drawn as a tick, so
   * "is it under my auto yet" becomes a distance you can see rather than a
   * number you have to guess.
   */
  threshold?: number;
  /**
   * ready  — fire now and it is yours.
   * soon   — one more allied hit and it enters your window.
   * losing — it dies before your attack could land; let it go.
   */
  tone?: 'ready' | 'soon' | 'losing';
  /** A short caption under the bar, e.g. "FIRE". */
  note?: string;
}

export interface DrillPaint {
  markers: GroundMarker[];
  billboards: Billboard[];
  /** Health-bar annotations, keyed by actor id. */
  plates: PlateMark[];
}

export const clearPaint = (p: DrillPaint): void => {
  p.markers.length = 0;
  p.billboards.length = 0;
  p.plates.length = 0;
};

export const newPaint = (): DrillPaint => ({ markers: [], billboards: [], plates: [] });
