import { ARCHETYPES } from './archetypes';
import { angleDelta, clamp, dist, norm, v2 } from './math';
import type { Rng } from './rng';
import type { Actor, AiTuning, ArchetypeDef, ArchetypeId, Vec2 } from './types';
import { NAV_CONTACT, World } from './world';

/**
 * Difficulty is expressed entirely through behaviour. A "harder" Ranger is not
 * a Ranger with more health — it reacts sooner, leads your movement better,
 * misses by less, holds its spacing tighter and uses its ability more often.
 */
export const TUNING_FLOOR: AiTuning = {
  reactionDelay: 0.46,
  aimError: 175,
  prediction: 0.1,
  dodgeSkill: 0.05,
  spacingDiscipline: 0.32,
  aggression: 0.5,
  tempo: 0.82,
};

export const TUNING_CEILING: AiTuning = {
  reactionDelay: 0.075,
  aimError: 14,
  prediction: 0.95,
  dodgeSkill: 0.75,
  spacingDiscipline: 1.0,
  aggression: 1.7,
  tempo: 1.3,
};

/**
 * How long a body has to be going nowhere before it is treated as wedged, and
 * how long it commits to getting out.
 *
 * A third of a second is longer than any legitimate hesitation — a step around
 * another unit, a shove, a frame against a corner — and short enough that a
 * player never watches a bot grind. The detour is longer than the stuck window
 * on purpose: a body that turned around and immediately re-decided would walk
 * straight back into the thing it just left.
 */
const STUCK_SECONDS = 0.3;
const DETOUR_SECONDS = 0.75;
/** How far along a wall the two ways round are compared before choosing. */
const DETOUR_LOOK = 360;

/** `level` runs 0..1 and interpolates every behavioural knob. */
export const tuningFor = (level: number): AiTuning => {
  const t = clamp(level, 0, 1);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    reactionDelay: mix(TUNING_FLOOR.reactionDelay, TUNING_CEILING.reactionDelay),
    aimError: mix(TUNING_FLOOR.aimError, TUNING_CEILING.aimError),
    prediction: mix(TUNING_FLOOR.prediction, TUNING_CEILING.prediction),
    dodgeSkill: mix(TUNING_FLOOR.dodgeSkill, TUNING_CEILING.dodgeSkill),
    spacingDiscipline: mix(TUNING_FLOOR.spacingDiscipline, TUNING_CEILING.spacingDiscipline),
    aggression: mix(TUNING_FLOOR.aggression, TUNING_CEILING.aggression),
    tempo: mix(TUNING_FLOOR.tempo, TUNING_CEILING.tempo),
  };
};

interface Snapshot {
  t: number;
  pos: Vec2;
  vel: Vec2;
}

/**
 * What a bot is *for*.
 *
 * A bot in a mechanics trainer is not an opponent, it is a situation
 * generator: its only job is to make the player face a decision they will
 * face in a real game. Three behaviours are therefore banned outright, and
 * every one of these exists to replace one of them.
 *
 *  - **Straight-line chasing** teaches you to run in a straight line away
 *    from it, which is the opposite of kiting. `chase` arcs instead, and the
 *    arc drifts, so the correct answer keeps changing.
 *  - **Random jitter** teaches nothing, because noise has no read. `erratic`
 *    commits to every direction it picks for long enough to be read and
 *    punished — it is unpredictable, not twitchy.
 *  - **Predictable loops** get solved once and then ignored. `irregular`
 *    is driven by summed incommensurate periods, so it never repeats.
 *
 * The rest are situations: something that will not let you leave (`tether`),
 * something that waits and then commits (`diver`), something that punishes
 * you for stepping toward it (`bait`), something that will not let you close
 * (`retreat`), and something that holds its distance and circles (`strafe`).
 */
export type BotBehavior =
  | 'chase'
  | 'retreat'
  | 'strafe'
  | 'tether'
  | 'diver'
  | 'bait'
  | 'erratic'
  | 'irregular';

export const BOT_BEHAVIORS: BotBehavior[] = [
  'chase',
  'retreat',
  'strafe',
  'tether',
  'diver',
  'bait',
  'erratic',
  'irregular',
];

/** One line each, for a drill that wants to name what it just spawned. */
export const BEHAVIOR_LABELS: Record<BotBehavior, string> = {
  chase: 'CHASER',
  retreat: 'RUNNER',
  strafe: 'STRAFER',
  tether: 'TETHER',
  diver: 'DIVER',
  bait: 'BAIT',
  erratic: 'ERRATIC',
  irregular: 'IRREGULAR',
};

/** What each archetype does when a drill does not say otherwise. */
const DEFAULT_BEHAVIOR: Record<ArchetypeId, BotBehavior> = {
  ranger: 'strafe',
  diver: 'chase',
  artillery: 'retreat',
  controller: 'strafe',
  duelist: 'erratic',
  juggernaut: 'chase',
};

export class EnemyBrain {
  readonly actor: Actor;
  readonly def: ArchetypeDef;
  tune: AiTuning;
  /** Distance this unit tries to hold. Drills may override it. */
  preferredRange: number;

  /** What situation this unit exists to create. Drills may override it. */
  behavior: BotBehavior;
  /** Where a tethered unit will not leave, and how far it will go. */
  anchor: Vec2 | null = null;
  leash = 520;

  private history: Snapshot[] = [];
  private abilityCd: number;
  private repathCd = 0;
  private strafeDir = 1;
  private strafeCd = 0;
  private dashTime = 0;
  private dashVel = v2();
  private dodgeCd = 0;
  private rng: Rng;
  /**
   * Phase offsets for the irregular walk.
   *
   * Three periods with no common multiple, seeded per unit. Summed, they give
   * a heading that drifts continuously and never comes back around — which is
   * what "unpredictable" has to mean if it is not going to mean "noise".
   */
  private readonly phase: [number, number, number];
  /** Seconds left on a committed erratic heading, and what it is. */
  private commitFor = 0;
  private commitDir = v2();
  /** Diver / bait state: how long the current stance has left. */
  private stanceFor = 0;
  private committed = false;
  /**
   * Where it last actually saw you, and for how long it has not.
   *
   * A bot that keeps tracking a champion it has no vision of is the reason
   * fog of war in most games is decoration. This one loses you the moment you
   * break its line — behind a wall, into a bush, under Final Hour — walks to
   * the last place it had a read on, and then stands there wondering. That is
   * the behaviour that makes breaking vision worth doing, and the behaviour
   * that punishes walking back out along the line you left by.
   */
  private lastSeen: Vec2 | null = null;
  private lostFor = 0;
  /** Seconds until it commits to its next guess about where you went. */
  private searchCd = 0;
  /**
   * The wall problem, and why it is solved here rather than in the steering.
   *
   * Every behaviour above answers "where do I want to be standing", and the
   * walk toward that answer is a straight line that stops dead against
   * terrain. So a bot whose preferred spot sits behind a rock does not go
   * around the rock: it leans on it, reissuing the same impossible order eight
   * times a second while the confinement pass eats every step, and it does
   * that until the run ends. That is the "spam walk into walls" a player sees.
   *
   * The fix is deliberately *reactive*. A bot that pre-emptively steers around
   * every wall in front of it is a different opponent — it stops committing to
   * a charge, it never ends up with terrain at its back, and the modes built
   * on bots arriving at you stop working. So nothing changes until a body has
   * actually failed to move: only then does it turn, pick a heading with real
   * room in it, and commit to that heading long enough to get out, and only
   * until the way it wanted to go is clear again.
   *
   * `slideSide` is what keeps it stable. Without a remembered side a wedged
   * body picks left, then right, then left, and vibrates against the wall
   * instead of travelling along it.
   */
  private slideSide: 1 | -1 = 1;
  /** How long it has been under orders and not moving. */
  private stuckFor = 0;
  private lastPos: Vec2 | null = null;
  /** Seconds left of a committed detour, and the heading it commits to. */
  private detourFor = 0;
  private detourDir = v2();

  constructor(actor: Actor, archetype: ArchetypeId, tune: AiTuning, rng: Rng) {
    this.actor = actor;
    this.def = ARCHETYPES[archetype];
    this.tune = tune;
    this.preferredRange = this.def.preferredRange;
    this.rng = rng;
    this.behavior = DEFAULT_BEHAVIOR[archetype];
    this.anchor = { ...actor.pos };
    // Stagger the first ability so a 1v3 does not open with three ults at once.
    this.abilityCd = this.def.abilityCd * rng.range(0.35, 0.9);
    this.strafeDir = rng.chance(0.5) ? 1 : -1;
    this.phase = [rng.range(0, 6.283), rng.range(0, 6.283), rng.range(0, 6.283)];
    this.stanceFor = rng.range(0.8, 2.2);
  }

  /** Position of the player as this AI currently believes it to be. */
  private perceived(world: World): Snapshot | null {
    const target = world.time - this.tune.reactionDelay;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].t <= target) return this.history[i];
    }
    return this.history[0] ?? null;
  }

  update(world: World, dt: number): void {
    const me = this.actor;
    if (!me.alive) return;
    const player = world.player;
    if (!player || !player.alive) {
      me.order = null;
      me.targetId = null;
      return;
    }

    // Perception is gated on vision before anything else reads it: everything
    // downstream — the reaction delay, the lead, the spacing — is built on
    // this history, so a bot that cannot see you simply stops learning where
    // you are rather than pretending to react late.
    const canSee = world.canSee(me.team, player);
    if (canSee) {
      this.lostFor = 0;
      this.lastSeen = { x: player.pos.x, y: player.pos.y };
      this.history.push({ t: world.time, pos: { ...player.pos }, vel: { ...player.vel } });
      if (this.history.length > 240) this.history.shift();
    } else {
      this.lostFor += dt;
    }

    // A unit being shoved through the air, or stunned against a wall, is not
    // making decisions. Condemn is supposed to buy Vayne real time.
    if (me.knockback || me.rootedFor > 0) {
      me.order = null;
      this.dashTime = 0;
      if (this.abilityCd > 0) this.abilityCd -= dt;
      return;
    }

    if (this.abilityCd > 0) this.abilityCd -= dt;
    if (this.repathCd > 0) this.repathCd -= dt;
    if (this.strafeCd > 0) this.strafeCd -= dt;
    if (this.dodgeCd > 0) this.dodgeCd -= dt;

    // Dash movement overrides normal steering while it lasts. It is clipped to
    // the terrain at the cast and confined the same way every other body is
    // while it runs, so a diver leaping at somebody standing behind a rock
    // arrives at the rock instead of inside it — and, more to the point, does
    // not spend the following second embedded in geometry.
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      world.place(me, me.pos.x + this.dashVel.x * dt, me.pos.y + this.dashVel.y * dt);
      me.order = null;
      return;
    }

    // Vision lost, and lost for long enough that its own reaction delay has
    // run out: it has nothing left to aim at, so it hunts.
    //
    // Two phases, and the order of them is the whole behaviour. First it walks
    // to the exact spot it last had a read on — which is what makes retreating
    // along the line you arrived by such a bad idea. Then, having found
    // nothing there, it starts guessing, and the guesses tighten around where
    // you actually are the longer it has been looking. Breaking vision has to
    // buy you *time*, not safety: a bush you can stand in forever is not a
    // mechanic, it is an exploit, and a fight the player can simply opt out of
    // is not a fight this mode can score.
    if (!canSee && this.lostFor > this.tune.reactionDelay + 0.2) {
      me.targetId = null;
      const last = this.lastSeen;
      if (last && dist(me.pos, last) > 110) {
        me.order = { kind: 'attackMove', pos: { ...last } };
        return;
      }
      this.searchCd -= dt;
      if (this.searchCd <= 0) {
        this.searchCd = 1.2;
        const warmth = clamp((this.lostFor - 1.5) / 7, 0, 1);
        const spread = 780 * (1 - warmth);
        this.lastSeen = {
          x: clamp(player.pos.x + this.rng.gauss() * spread, 80, world.bounds.w - 80),
          y: clamp(player.pos.y + this.rng.gauss() * spread, 80, world.bounds.h - 80),
        };
      } else if (!last) {
        me.order = null;
      }
      return;
    }

    const seen = this.perceived(world);
    if (!seen) return;

    // Lead the target by however much prediction this difficulty grants.
    const lead = this.tune.prediction * this.tune.reactionDelay;
    const believed: Vec2 = {
      x: seen.pos.x + seen.vel.x * lead,
      y: seen.pos.y + seen.vel.y * lead,
    };

    me.targetId = player.id;

    const d = dist(me.pos, player.pos);
    const pref = this.preferredRange;
    // Spacing discipline tightens the deadzone the AI is happy to sit in.
    const slack = 130 * (1.3 - this.tune.spacingDiscipline);
    const aggr = this.def.aggression * this.tune.aggression;

    // Dodge an inbound player projectile by stepping perpendicular to it.
    if (this.dodgeCd <= 0 && this.tryDodge(world, me)) {
      this.dodgeCd = 0.55;
      return;
    }

    // Signature ability.
    if (this.abilityCd <= 0 && d < this.def.attack.range * 1.9) {
      this.castAbility(world, me, player, believed);
      this.abilityCd = this.def.abilityCd / Math.max(0.4, this.tune.aggression);
      return;
    }

    const inRange = d - player.radius <= me.attack.range;

    // The AI orbwalks too: it holds still to attack, then repositions in the
    // backswing window, which is exactly the rhythm the player is learning.
    const freeToMove = me.phase !== 'windup';

    if (!freeToMove) return;

    let goal = this.steer(world, me, player, believed, { d, pref, slack, aggr, inRange, dt });
    if (goal) goal = this.unwedge(world, me, goal, dt);

    if (goal && this.repathCd <= 0) {
      this.repathCd = 0.08;
      goal.x = clamp(goal.x, me.radius + 10, world.bounds.w - me.radius - 10);
      goal.y = clamp(goal.y, me.radius + 10, world.bounds.h - me.radius - 10);
      me.order = { kind: 'attackMove', pos: goal };
    } else if (!goal) {
      me.order = { kind: 'attackTarget', pos: { ...player.pos }, targetId: player.id };
    }
  }

  /**
   * The goal a behaviour asked for, or a way out of the wall it is standing in.
   *
   * Called every frame with the freshly steered goal, and it does nothing at
   * all in the ordinary case — which is most of the run, and the point. It
   * only speaks up once a body under orders has stopped covering ground, and
   * "stopped covering ground" is measured against what this body could have
   * covered in the time, so it stays true of a mode that hands out a different
   * move speed.
   */
  private unwedge(world: World, me: Actor, goal: Vec2, dt: number): Vec2 {
    const travelled = this.lastPos ? dist(me.pos, this.lastPos) : Infinity;
    this.lastPos = { x: me.pos.x, y: me.pos.y };

    if (this.detourFor > 0) {
      this.detourFor -= dt;
      // The detour ends the moment the way it actually wanted to go opens up:
      // a body that keeps sliding along a wall after clearing its corner is
      // one that has left the fight to finish a manoeuvre nobody needed.
      if (world.navigate(me.pos, goal, me.radius, this.slideSide).clear) {
        this.detourFor = 0;
      } else {
        this.stuckFor = 0;
        return { x: me.pos.x + this.detourDir.x * 300, y: me.pos.y + this.detourDir.y * 300 };
      }
    }

    const wants = dist(me.pos, goal) > 60 && me.phase !== 'windup' && me.rootedFor <= 0;
    // Two ways to be getting nowhere, and the second one is the one that used
    // to go unnoticed. A body flat against a wall is not always still: the
    // heading a behaviour hands it wanders by half a radian either way, so it
    // slides up and down the face for the whole run, covering ground the
    // whole time and arriving nowhere. Pushing into terrain *is* the symptom;
    // standing still is only its most obvious form.
    const heading = norm(goal.x - me.pos.x, goal.y - me.pos.y);
    const pressing = world.roomAhead(me.pos, heading, NAV_CONTACT * 2, me.radius) < NAV_CONTACT;
    if (wants && (pressing || travelled < me.moveSpeed * dt * 0.3)) this.stuckFor += dt;
    else this.stuckFor = 0;
    if (this.stuckFor < STUCK_SECONDS) return goal;

    // Wedged. Getting out of a wall is not the same manoeuvre as walking
    // around one: the way past a face is *along* it, at a right angle to the
    // direction that will not go, and a detour that insisted on making
    // progress toward the goal would rule out the only heading that works.
    // So the detour is lateral and committed, and it is committed because a
    // body that re-decided every frame would turn back into the wall the
    // instant leaning became marginally more direct than leaving.
    this.stuckFor = 0;
    const left = { x: -heading.y, y: heading.x };
    const right = { x: heading.y, y: -heading.x };
    // Which way round. Room first — a side with a second wall on it is not a
    // side — and then whether going that way actually opens the approach,
    // which is what tells the near end of a wall from the far one.
    const look = (d: Vec2) => {
      const room = world.roomAhead(me.pos, d, DETOUR_LOOK, me.radius);
      const at = { x: me.pos.x + d.x * room, y: me.pos.y + d.y * room };
      return { room, opens: room > DETOUR_LOOK * 0.8 && world.navigate(at, goal, me.radius, 1).clear };
    };
    const l = look(left);
    const r = look(right);
    if (l.opens !== r.opens) this.slideSide = l.opens ? 1 : -1;
    else if (Math.abs(l.room - r.room) > 60) this.slideSide = l.room > r.room ? 1 : -1;
    this.detourDir = this.slideSide === 1 ? left : right;
    this.detourFor = DETOUR_SECONDS;
    return { x: me.pos.x + this.detourDir.x * 300, y: me.pos.y + this.detourDir.y * 300 };
  }

  /**
   * Where this unit wants to be standing, one behaviour at a time.
   *
   * Returning null means "nothing to say" — the caller falls back to holding
   * the target, which is what a unit standing exactly where it wants to be
   * should do. Everything here returns a *point*, never a velocity, because
   * the world already knows how to walk somewhere and duplicating that here
   * is how two movement systems start disagreeing about collision.
   */
  private steer(
    world: World,
    me: Actor,
    player: Actor,
    believed: Vec2,
    ctx: { d: number; pref: number; slack: number; aggr: number; inRange: boolean; dt: number },
  ): Vec2 | null {
    const { d, pref, slack, inRange, dt } = ctx;
    const toPlayer = norm(believed.x - me.pos.x, believed.y - me.pos.y);
    const away = { x: -toPlayer.x, y: -toPlayer.y };
    const tangent = { x: -toPlayer.y, y: toPlayer.x };
    const at = (dir: Vec2, amount: number): Vec2 => ({ x: me.pos.x + dir.x * amount, y: me.pos.y + dir.y * amount });
    const blend = (a: Vec2, b: Vec2, t: number): Vec2 => norm(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

    if (this.stanceFor > 0) this.stanceFor -= dt;
    if (this.commitFor > 0) this.commitFor -= dt;

    switch (this.behavior) {
      case 'chase': {
        // Never a straight line. The approach bends by an amount that itself
        // drifts, so the player cannot solve it once and then walk the same
        // escape angle for sixty seconds.
        if (d < pref) return this.holdRing(me, believed, pref, tangent, toPlayer, ctx);
        const bend = Math.sin(world.time * 0.7 + this.phase[0]) * 0.55 * (1 - this.tune.spacingDiscipline * 0.4);
        return at(blend(toPlayer, tangent, bend * this.strafeDir), 420);
      }

      case 'retreat': {
        // Will not be caught, but will not run forever either: it turns and
        // trades the moment it has bought itself room.
        if (d < pref * 0.92) return at(blend(away, tangent, 0.35 * this.strafeDir), 340);
        if (d > pref * 1.3) return at(toPlayer, 300);
        return this.holdRing(me, believed, pref, tangent, toPlayer, ctx);
      }

      case 'strafe':
        if (d > pref + slack) return at(toPlayer, 380);
        if (d < pref - slack) return at(away, 300);
        return this.holdRing(me, believed, pref, tangent, toPlayer, ctx);

      case 'tether': {
        // Something you cannot simply walk away from — but only inside its
        // leash. Chasing it out of the circle is the mistake it is testing.
        const anchor = this.anchor ?? me.pos;
        const home = dist(me.pos, anchor);
        if (home > this.leash) {
          const back = norm(anchor.x - me.pos.x, anchor.y - me.pos.y);
          return at(back, Math.min(400, home));
        }
        if (d > pref + slack) {
          const want = at(toPlayer, 400);
          // Never step outside the leash to reach you.
          if (dist(want, anchor) > this.leash) {
            const back = norm(anchor.x - want.x, anchor.y - want.y);
            return { x: want.x + back.x * (dist(want, anchor) - this.leash), y: want.y + back.y * (dist(want, anchor) - this.leash) };
          }
          return want;
        }
        return this.holdRing(me, believed, pref, tangent, toPlayer, ctx);
      }

      case 'diver': {
        // Waits at the edge, then commits everything for a window. The
        // telegraph is the pause: it stops circling just before it goes.
        if (this.stanceFor <= 0) {
          this.committed = !this.committed;
          this.stanceFor = this.committed
            ? this.rng.range(1.6, 2.6)
            : this.rng.range(1.4, 2.8) / Math.max(0.5, this.tune.aggression);
        }
        if (this.committed) return at(toPlayer, 460);
        const ring = Math.max(pref, me.attack.range + 220);
        if (d < ring * 0.85) return at(blend(away, tangent, 0.3 * this.strafeDir), 320);
        return this.holdRing(me, believed, ring, tangent, toPlayer, ctx);
      }

      case 'bait': {
        // Offers itself, then leaves the moment you reach for it. The read is
        // your own velocity: step toward it and it is already gone.
        const closing = player.vel.x * toPlayer.x + player.vel.y * toPlayer.y < -40;
        const edge = player.attack.range + me.radius + 40;
        if (closing && d < edge * 1.25) return at(blend(away, tangent, 0.45 * this.strafeDir), 400);
        if (d > edge * 1.15) return at(toPlayer, 340);
        return this.holdRing(me, believed, edge, tangent, toPlayer, ctx);
      }

      case 'erratic': {
        // Unpredictable, never twitchy: every heading it picks is held long
        // enough to be seen, aimed at, and punished. Jitter would be easier
        // to write and would teach nothing, because noise has no read.
        if (this.commitFor <= 0) {
          this.commitFor = this.rng.range(0.35, 0.75);
          const spread = d > pref * 1.4 ? 1.0 : 2.4;
          const base = Math.atan2(toPlayer.y, toPlayer.x);
          const a = base + this.rng.gauss() * spread;
          this.commitDir = { x: Math.cos(a), y: Math.sin(a) };
        }
        // Bounded: it is erratic inside the fight, not a unit that wanders off.
        if (d > pref * 1.8) return at(toPlayer, 380);
        return at(this.commitDir, 320);
      }

      case 'irregular': {
        // Three periods with no common multiple. It looks deliberate, it is
        // never random, and it does not come back around — so a player cannot
        // memorise it, only track it.
        const t = world.time;
        const wobble =
          Math.sin(t * 0.83 + this.phase[0]) * 0.6 +
          Math.sin(t * 1.31 + this.phase[1]) * 0.3 +
          Math.sin(t * 2.17 + this.phase[2]) * 0.18;
        const radial = clamp((pref - d) / 220, -1, 1);
        const dir = norm(toPlayer.x * -radial + tangent.x * wobble, toPlayer.y * -radial + tangent.y * wobble);
        // Speed modulates too, so the lead a player computes keeps going stale.
        const pace = 220 + 180 * (0.5 + 0.5 * Math.sin(t * 0.61 + this.phase[2]));
        void inRange;
        return at(dir, pace);
      }
    }
  }

  /**
   * Circling at a chosen radius: the one movement every behaviour shares.
   *
   * It corrects toward the ring and travels along it at the same time, so a
   * unit holding a distance is always moving — a bot that stands still while
   * it waits for its attack timer is a bot the player never has to track.
   */
  private holdRing(
    me: Actor,
    believed: Vec2,
    radius: number,
    tangent: Vec2,
    toPlayer: Vec2,
    ctx: { d: number; inRange: boolean },
  ): Vec2 {
    if (this.strafeCd <= 0) {
      this.strafeCd = this.rng.range(0.7, 1.6);
      if (this.rng.chance(0.32)) this.strafeDir *= -1;
    }
    const correction = clamp((ctx.d - radius) / 200, -1, 1);
    const amount = 170 * (0.6 + this.tune.spacingDiscipline * 0.6);
    const dir = norm(
      toPlayer.x * correction + tangent.x * this.strafeDir,
      toPlayer.y * correction + tangent.y * this.strafeDir,
    );
    void believed;
    return { x: me.pos.x + dir.x * amount, y: me.pos.y + dir.y * amount };
  }

  /** Steps out of the path of a player projectile if this difficulty allows. */
  private tryDodge(world: World, me: Actor): boolean {
    if (!this.rng.chance(this.tune.dodgeSkill)) return false;
    for (const p of world.projectiles) {
      if (p.team !== 'player' || p.targetId != null) continue;
      const toMe = { x: me.pos.x - p.pos.x, y: me.pos.y - p.pos.y };
      const d = Math.hypot(toMe.x, toMe.y);
      if (d > 420 || d < 40) continue;
      const travel = Math.atan2(p.vel.y, p.vel.x);
      const bearing = Math.atan2(toMe.y, toMe.x);
      if (Math.abs(angleDelta(travel, bearing)) > 0.45) continue;
      const side = angleDelta(travel, bearing) > 0 ? 1 : -1;
      const a = travel + (Math.PI / 2) * side;
      // Sidestepping into a rock is not a sidestep, and unlike an approach
      // there is nothing to be gained by committing to it: the whole move is
      // one step, so it may as well be a step that exists.
      const want = { x: me.pos.x + Math.cos(a) * 260, y: me.pos.y + Math.sin(a) * 260 };
      const routed = world.navigate(me.pos, want, me.radius, side as 1 | -1);
      me.order = {
        kind: 'move',
        pos: {
          x: clamp(routed.pos.x, me.radius, world.bounds.w - me.radius),
          y: clamp(routed.pos.y, me.radius, world.bounds.h - me.radius),
        },
      };
      return true;
    }
    return false;
  }

  private aimAt(target: Vec2, from: Vec2): Vec2 {
    // Aim error scales with distance so far shots are the sloppy ones.
    const d = Math.hypot(target.x - from.x, target.y - from.y);
    const spread = (this.tune.aimError * d) / 600;
    return {
      x: target.x + this.rng.gauss() * spread * 0.5,
      y: target.y + this.rng.gauss() * spread * 0.5,
    };
  }

  /**
   * How long a dash may run before it would end inside terrain.
   *
   * A dash that ends in a wall does not stop there: the confinement pass shoves
   * the body back out, so the unit arrives somewhere it never aimed at with its
   * telegraph drawn somewhere else. Clipping the duration stops the leap at the
   * rock, which is what a player who stepped behind one is owed.
   */
  private clipDash(world: World, me: Actor, dir: Vec2, speed: number, seconds: number): number {
    const reach = world.terrainAlong(me.pos, dir, speed * seconds, me.radius);
    return clamp(reach.distance / speed, 0, seconds);
  }

  private castAbility(world: World, me: Actor, player: Actor, believed: Vec2): void {
    const aim = this.aimAt(believed, me.pos);
    const dir = norm(aim.x - me.pos.x, aim.y - me.pos.y);
    const col = this.def.color;

    switch (this.def.id) {
      case 'ranger': {
        // A long piercing bolt. Punishes standing in a straight line.
        world.spawnProjectile({
          pos: { ...me.pos },
          team: 'enemy',
          ownerId: me.id,
          vel: { x: dir.x * 1350, y: dir.y * 1350 },
          speed: 1350,
          damage: 55,
          radius: 17,
          pierce: true,
          shape: 'shard',
          maxLife: 1.5,
          color: col,
        });
        break;
      }
      case 'diver': {
        // Commits to a straight dash. Sidestepping it is the whole lesson.
        const d = dist(me.pos, player.pos);
        const speed = 1500;
        this.dashVel = { x: dir.x * speed, y: dir.y * speed };
        this.dashTime = this.clipDash(world, me, dir, speed, clamp(d / speed, 0.08, 0.45));
        // The dash gets a real telegraph — it is meant to be sidestepped, not
        // to feel like an ambush.
        world.spawnHazard({
          pos: { ...me.pos },
          end: { x: me.pos.x + dir.x * 700, y: me.pos.y + dir.y * 700 },
          team: 'enemy',
          shape: 'line',
          width: 44,
          warn: 0.3,
          active: 0.22,
          damage: 32,
          color: col,
        });
        break;
      }
      case 'artillery': {
        world.spawnHazard({
          pos: aim,
          team: 'enemy',
          shape: 'circle',
          radius: 132,
          warn: clamp(1.15 - this.tune.aggression * 0.35, 0.55, 1.2),
          active: 0.3,
          damage: 85,
          color: col,
        });
        break;
      }
      case 'controller': {
        world.spawnProjectile({
          pos: { ...me.pos },
          team: 'enemy',
          ownerId: me.id,
          vel: { x: dir.x * 1150, y: dir.y * 1150 },
          speed: 1150,
          damage: 30,
          radius: 19,
          shape: 'orb',
          maxLife: 1.3,
          effect: { root: 0.75 },
          color: col,
        });
        break;
      }
      case 'duelist': {
        // Dashes past you, then immediately threatens. Trains target switching.
        const speed = 1700;
        this.dashVel = { x: dir.x * speed, y: dir.y * speed };
        this.dashTime = this.clipDash(world, me, dir, speed, 0.2);
        me.attackCd = Math.min(me.attackCd, 0.1);
        break;
      }
      case 'juggernaut': {
        world.spawnHazard({
          pos: { ...me.pos },
          team: 'enemy',
          shape: 'ring',
          radius: 265,
          width: 150,
          warn: 0.8,
          active: 0.3,
          damage: 70,
          color: col,
        });
        break;
      }
    }
  }
}

export const applyTuningToActor = (a: Actor, def: ArchetypeDef, tune: AiTuning): void => {
  a.attack = { ...def.attack, attackSpeed: def.attack.attackSpeed * tune.tempo };
  a.moveSpeed = def.moveSpeed * (0.94 + tune.tempo * 0.08);
};
