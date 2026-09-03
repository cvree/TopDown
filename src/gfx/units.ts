import * as THREE from 'three';
import { ARCHETYPES } from '../engine/archetypes';
import { DEFAULT_HERO, HEROES, isHeroId, type HeroId } from '../engine/heroes';
import type { Actor, ArchetypeId } from '../engine/types';
import type { World } from '../engine/world';
import { ChampionRig, type RigSpec } from './champions';

/**
 * Keeps one rig alive per simulation actor and drives it from the world state.
 *
 * Positions are interpolated with the loop's `alpha` so a 240Hz simulation
 * still looks smooth on a 60Hz panel, and the animation state is read straight
 * off the actor — the attack windup you see is literally the windup timer the
 * scoring reads, never a separate visual approximation of it.
 */

type VisualKey = ArchetypeId | HeroId | 'minionMelee' | 'minionCaster' | 'minionCannon' | 'dummy';

/** Hero ids and archetype ids share one namespace here, so they may not collide. */
const isHeroKey = (k: VisualKey): k is HeroId => isHeroId(k);

const ENEMY_RING = '#ff4d42';
const ALLY_RING = '#5fe0ff';

const VISUALS: Record<VisualKey, Omit<RigSpec, 'height' | 'radius' | 'ringColor'>> = {
  // Every playable body comes from the roster rather than being restated
  // here: the champion you picked in settings, the one the Vayne path spawns
  // and the one standing in the menu backdrop are then provably the same
  // champion. At this camera distance the outline and the colour are the whole
  // of a champion's identity, which is exactly what a `HeroLook` carries.
  ...(Object.fromEntries(Object.entries(HEROES).map(([id, h]) => [id, h.look])) as Record<
    HeroId,
    Omit<RigSpec, 'height' | 'radius' | 'ringColor'>
  >),
  ranger: {
    build: 'lean',
    primary: '#46a37e',
    secondary: '#1d4436',
    accent: '#6dffb4',
    skin: '#c9a583',
    weapon: 'bow',
    headgear: 'hood',
    cape: true,
  },
  diver: {
    build: 'heavy',
    primary: '#c25a34',
    secondary: '#43201a',
    accent: '#ff9257',
    skin: '#b98763',
    weapon: 'greatsword',
    headgear: 'horns',
    cape: false,
  },
  artillery: {
    build: 'lean',
    primary: '#8158d4',
    secondary: '#2b1b4d',
    accent: '#d6a2ff',
    skin: '#cdb6d8',
    weapon: 'staff',
    headgear: 'crown',
    cape: true,
  },
  controller: {
    build: 'medium',
    primary: '#4088cf',
    secondary: '#16334f',
    accent: '#79d4ff',
    skin: '#c6b09a',
    weapon: 'staff',
    headgear: 'hood',
    cape: true,
  },
  duelist: {
    build: 'lean',
    primary: '#d6ac36',
    secondary: '#4a3810',
    accent: '#ffdc6b',
    skin: '#d2ab84',
    weapon: 'daggers',
    headgear: 'none',
    cape: false,
  },
  juggernaut: {
    build: 'heavy',
    primary: '#c94570',
    secondary: '#421425',
    accent: '#ff6f9c',
    skin: '#a97f6b',
    weapon: 'hammer',
    headgear: 'helm',
    cape: false,
  },
  // The three lane minions. They differ by silhouette before they differ by
  // colour, because at this camera distance the outline is what you actually
  // read: the melee is a squat blade, the caster carries a staff, and the
  // cannon is a slab twice the mass of either. Which one is dying matters —
  // a cannon is worth three casters — so they must never be confusable.
  minionMelee: {
    build: 'small',
    primary: '#9c8a6c',
    secondary: '#3a3226',
    accent: '#ffca7a',
    skin: '#9d8465',
    weapon: 'sword',
    headgear: 'none',
    cape: false,
  },
  minionCaster: {
    build: 'small',
    primary: '#8b7f9c',
    secondary: '#2e2838',
    accent: '#b6a2ff',
    skin: '#9d8465',
    weapon: 'staff',
    headgear: 'hood',
    cape: true,
  },
  minionCannon: {
    build: 'heavy',
    primary: '#7d6a4e',
    secondary: '#2b2419',
    accent: '#ffb457',
    skin: '#8d7455',
    weapon: 'hammer',
    headgear: 'helm',
    cape: false,
  },
  dummy: {
    build: 'medium',
    primary: '#828a97',
    secondary: '#33373d',
    accent: '#9fb2c6',
    skin: '#8b6f52',
    weapon: 'none',
    headgear: 'none',
    cape: false,
  },
};

const visualKeyFor = (a: Actor, playerId: number): VisualKey => {
  // A drill that named a champion outranks everything, including the roster:
  // the Vayne path is about a specific body and must always get it.
  if (a.visual && isHeroId(a.visual)) return a.visual;
  if (a.id === playerId) return DEFAULT_HERO;
  if (a.unitKind === 'caster') return 'minionCaster';
  if (a.unitKind === 'cannon') return 'minionCannon';
  if (a.isMinion) return 'minionMelee';
  if (a.archetype && a.archetype in VISUALS) return a.archetype;
  return 'dummy';
};

/**
 * A minion's livery.
 *
 * Both sides of a lane run the same three bodies, so the only thing keeping
 * "mine" apart from "theirs" is colour, and it has to survive being glanced at
 * for a tenth of a second in a pile of twelve units. Blue-steel against
 * blood-iron, with the accent doing most of the work.
 */
const teamTint = (spec: Omit<RigSpec, 'height' | 'radius' | 'ringColor'>, ally: boolean): typeof spec => ({
  ...spec,
  primary: ally ? '#4a6f9c' : '#9c4a42',
  secondary: ally ? '#1b2c44' : '#3d1a17',
  accent: ally ? '#7fd2ff' : '#ff9a6a',
});

interface Entry {
  rig: ChampionRig;
  /** Visual key plus team: the same body in the other livery is a rebuild. */
  key: string;
  death: number;
  cast: number;
  /** Facing is smoothed: the simulation can snap it, the model should not. */
  facing: number;
}

export class UnitLayer {
  private entries = new Map<number, Entry>();
  private time = 0;

  constructor(private readonly parent: THREE.Object3D) {}

  /** Fires a cast pose on the next few frames — drills call this on ability use. */
  castOn(actorId: number): void {
    const e = this.entries.get(actorId);
    if (e) e.cast = 1;
  }

  sync(world: World, alpha: number, dt: number, hoverId: number | null): void {
    this.time += dt;
    const seen = new Set<number>();

    for (const a of world.actors) {
      seen.add(a.id);
      // Structures are drawn by their own layer; a turret is not a body with
      // legs and no amount of rig tuning makes it read as one.
      if (a.unitKind === 'turret') continue;
      let e = this.entries.get(a.id);
      const visual = visualKeyFor(a, world.playerId);
      const key = `${visual}:${a.team}`;
      if (!e || e.key !== key) {
        e?.rig.dispose();
        const rig = new ChampionRig(this.specFor(a, visual));
        this.parent.add(rig.group);
        e = { rig, key, death: 0, cast: 0, facing: a.facing };
        this.entries.set(a.id, e);
      }

      const x = a.prev.x + (a.pos.x - a.prev.x) * alpha;
      const y = a.prev.y + (a.pos.y - a.prev.y) * alpha;
      e.rig.setPosition(x, y);

      // Shortest-arc facing smoothing.
      let d = a.facing - e.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      e.facing += d * Math.min(1, dt * 18);

      if (!a.alive) e.death = Math.min(1, e.death + dt * 1.6);
      e.cast = Math.max(0, e.cast - dt * 3.2);

      const cycle = 1 / Math.max(0.05, a.attack.attackSpeed);
      const phaseTotal =
        a.phase === 'windup' ? cycle * a.attack.windupRatio : a.phase === 'backswing' ? cycle * a.attack.backswingRatio : 1;
      const phaseT = a.phase === 'idle' ? 0 : 1 - Math.max(0, Math.min(1, a.phaseTime / Math.max(0.0001, phaseTotal)));

      e.rig.update(dt, {
        speed: Math.hypot(a.vel.x, a.vel.y) / Math.max(1, a.moveSpeed),
        facing: e.facing,
        phase: a.phase,
        phaseT,
        time: this.time,
        hitFlash: a.hitFlash,
        death: e.death,
        cast: e.cast,
        hp01: a.maxHp > 0 ? a.hp / a.maxHp : 1,
        hovered: hoverId === a.id,
        rooted: a.rootedFor > 0,
      });
      e.rig.visible = e.death < 0.999;
    }

    for (const [id, e] of this.entries) {
      if (!seen.has(id)) {
        e.rig.dispose();
        this.entries.delete(id);
      }
    }
  }

  private specFor(a: Actor, key: VisualKey): RigSpec {
    const arch = a.archetype ? ARCHETYPES[a.archetype] : null;
    const ally = a.team === 'player';
    const minion = key === 'minionMelee' || key === 'minionCaster' || key === 'minionCannon';
    const base = minion ? teamTint(VISUALS[key], ally) : VISUALS[key];
    // Champion height scales with the collision radius so a juggernaut really
    // does loom over a duelist, exactly as its radius promises.
    const height = a.radius * (minion ? 4.5 : 5.4);
    return {
      ...base,
      height,
      radius: a.radius,
      ringColor: ally ? ALLY_RING : ENEMY_RING,
      // A hero and a minion keep their own accent; an enemy archetype takes
      // the colour its card is printed in, so the two can never disagree.
      accent: isHeroKey(key) || minion ? base.accent : arch?.color ?? base.accent,
    };
  }

  dispose(): void {
    for (const e of this.entries.values()) e.rig.dispose();
    this.entries.clear();
  }
}
