export type { Vec2 } from './math';
import type { Vec2 } from './math';

/** Arena coordinates are "units", sized to feel like League distances. */
export const UNIT = 1;

export type Team = 'player' | 'enemy' | 'neutral';

export type AttackPhase = 'idle' | 'windup' | 'backswing';

export interface AttackProfile {
  /** Attacks per second. */
  attackSpeed: number;
  /** Fraction of the attack cycle spent winding up before damage is committed. */
  windupRatio: number;
  /** Fraction of the cycle spent in backswing — cancellable for free. */
  backswingRatio: number;
  range: number;
  damage: number;
  /** 0 for melee/hitscan; otherwise units per second. */
  projectileSpeed: number;
  /** Look of the missile this attack throws. Defaults to a bolt. */
  projectileShape?: ProjectileShape;
  projectileRadius?: number;
  projectileColor?: string;
}

/**
 * What a body *is*, as far as the rest of the game is concerned.
 *
 * Kept separate from the archetype because archetypes describe how a champion
 * fights, and a siege minion is not a champion fighting badly — it is a
 * different class of thing, with its own silhouette, its own targeting rules
 * and its own place in a lane.
 */
export type UnitKind = 'champion' | 'melee' | 'caster' | 'cannon' | 'turret';

export interface Actor {
  id: number;
  team: Team;
  pos: Vec2;
  /** Previous position, kept for render interpolation. */
  prev: Vec2;
  vel: Vec2;
  radius: number;
  moveSpeed: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  facing: number;

  attack: AttackProfile;
  phase: AttackPhase;
  /** Seconds remaining in the current phase. */
  phaseTime: number;
  /** Seconds until the next attack may begin. */
  attackCd: number;
  targetId: number | null;

  /** Destination of the current move order, if any. */
  order: { kind: 'move' | 'attackMove' | 'attackTarget' | 'hold'; pos: Vec2; targetId?: number } | null;

  /**
   * A held movement direction, unit length, or null. Set by the WASD scheme;
   * while it is set it overrides order pathing entirely.
   */
  moveDir: Vec2 | null;
  /**
   * This actor is driven directly rather than by pathing: orders may still
   * pick targets, but they never walk it anywhere. Only ever set on the
   * player, and only under the WASD scheme.
   */
  directControl?: boolean;

  /** Visual/analysis bookkeeping. */
  lastAttackAt: number;
  hitFlash: number;
  archetype?: ArchetypeId;
  label?: string;
  /** Crowd control / movement lock. */
  rootedFor: number;
  slowFactor: number;
  slowFor: number;
  /** Marks minions in the last-hit drill. */
  isMinion?: boolean;
  /** What class of body this is. Absent means an ordinary champion. */
  unitKind?: UnitKind;
  /** Nothing shoves this actor: structures hold their ground. */
  immovable?: boolean;
  /**
   * Not drawn at all — no body, no bar, no indicators.
   *
   * The APM lab needs a player actor because input, metrics and the camera all
   * hang off one, but it does not want a champion standing in the middle of a
   * bench of pads. This is how a run has a body without showing one.
   */
  hidden?: boolean;
  goldValue?: number;
  /** Set when a unit was killed by the player this frame. */
  killedByPlayer?: boolean;
  /** Per-actor accent colour index for rendering. */
  tint?: number;
  /** Overrides the silhouette the renderer picks for this actor. */
  visual?: 'nightHunter';
  /** Seconds this actor is untargetable — Vayne's Final Hour tumble. */
  invisibleFor?: number;
  /** Active knockback: direction, remaining distance, speed. */
  knockback?: { dir: Vec2; remaining: number; speed: number } | null;
}

export type ProjectileShape = 'bolt' | 'orb' | 'shard' | 'wave';

export interface Projectile {
  id: number;
  team: Team;
  ownerId: number;
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  radius: number;
  speed: number;
  damage: number;
  /** Homing projectiles track an actor; skillshots fly straight. */
  targetId: number | null;
  life: number;
  maxLife: number;
  shape: ProjectileShape;
  pierce: boolean;
  hitIds?: Set<number>;
  /** True once the projectile has passed within a near-miss radius of the player. */
  grazed?: boolean;
  /** Crowd control applied on hit. */
  effect?: { root?: number; slow?: { factor: number; dur: number } };
  color?: string;
  trail: Vec2[];
}

export type HazardShape = 'circle' | 'line' | 'cone' | 'ring';

export interface Hazard {
  id: number;
  team: Team;
  shape: HazardShape;
  pos: Vec2;
  /** For line/cone: the far end / direction anchor. */
  end?: Vec2;
  radius: number;
  /** Half-width for line hazards. */
  width?: number;
  /** Seconds of telegraph remaining before it goes live. */
  warn: number;
  warnTotal: number;
  /** Seconds the hazard stays active once live. */
  active: number;
  activeTotal: number;
  damage: number;
  /** Rotational sweep speed for moving hazards, radians/sec. */
  spin?: number;
  /** True once it has damaged the player (single-tick hazards). */
  consumed?: boolean;
  tickCd?: number;
  color?: string;
}

export type ArchetypeId =
  | 'ranger'
  | 'diver'
  | 'artillery'
  | 'controller'
  | 'duelist'
  | 'juggernaut';

export interface ArchetypeDef {
  id: ArchetypeId;
  name: string;
  blurb: string;
  /** What this archetype forces the player to practise. */
  teaches: string;
  color: string;
  baseHp: number;
  radius: number;
  moveSpeed: number;
  attack: AttackProfile;
  /** Preferred distance to the player, in units. */
  preferredRange: number;
  /** How eager it is to close distance, 0..1. */
  aggression: number;
  /** Cooldown of its signature ability. */
  abilityCd: number;
}

/** Difficulty knobs — none of these are "more HP". */
export interface AiTuning {
  /** Seconds before the AI reacts to a change in player state. */
  reactionDelay: number;
  /** Standard deviation of its aim error, in units at 600 range. */
  aimError: number;
  /** How far ahead it leads a moving target, 0..1 of perfect prediction. */
  prediction: number;
  /** Chance per dodge opportunity that it sidesteps a player skillshot. */
  dodgeSkill: number;
  /** Multiplier on how tightly it holds preferred range. */
  spacingDiscipline: number;
  /** Multiplier on ability usage frequency. */
  aggression: number;
  /** Multiplier on its attack speed and move speed (kept subtle). */
  tempo: number;
}

/** An axis-aligned block of terrain. Actors cannot walk through it. */
export interface Wall {
  /** Centre. */
  x: number;
  y: number;
  /** Full extents. */
  w: number;
  h: number;
}
