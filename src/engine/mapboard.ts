/**
 * THE MAP BOARD — the drill → minimap drawing contract.
 *
 * The minimap in the bottom-right corner has always shown the arena. For the
 * lab it shows something else: a two-lane board with your blip in one of them
 * and a bad orb falling slowly toward one of them, which you get out of the
 * way of with a key while your hands are busy with the mode itself.
 *
 * It is deliberately in the corner and deliberately small. Every mode in the
 * lab measures a pair of hands doing one thing well; the board measures
 * whether that survives *something else being true somewhere else on the
 * screen* — which is the actual skill the minimap asks of you in a real game,
 * and the one thing a bench of pads in the middle of the floor could never
 * teach on its own.
 *
 * Coordinates are normalised — 0..1 across the board and 0..1 down it — so the
 * drill never learns how many pixels the minimap happens to be today.
 */

export interface BoardOrb {
  /** 0 at the left edge of the board, 1 at the right. */
  x: number;
  /** 0 at the top, 1 at the floor where it lands. */
  y: number;
  /** Radius, as a share of the board's width. */
  r: number;
  /** The lane it will land in. */
  lane: number;
  /** True once it can no longer change lanes — the read is committed. */
  committed: boolean;
  /** True while it is falling on the lane the player is standing in. */
  onYou: boolean;
}

export interface BoardLane {
  /** The key that moves you here, printed as the player's own binding. */
  key: string;
  /** True while something is falling into this lane. */
  threatened: boolean;
}

export interface MapBoard {
  lanes: BoardLane[];
  /**
   * Where the blip is, in lanes. Fractional while it slides across, because a
   * dodge you cannot see happen is a dodge you never learn the timing of.
   */
  player: number;
  orbs: BoardOrb[];
  /** 0..1, fading: something landed on you. */
  hurt: number;
  /** 0..1, fading: you got out of the way in time. */
  clean: number;
  /** Consecutive orbs answered correctly. */
  streak: number;
  /** The caption under the board — what it is asking for right now. */
  note: string;
  /** The mode's accent, so the board belongs to the run it is part of. */
  color: string;
}
