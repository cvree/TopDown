/**
 * Headless verification of the simulation and scoring.
 *
 * This drives the real Session/World/drill code with synthetic input policies
 * and asserts the thing the whole product rests on: that playing *correctly*
 * scores well and that spamming does not. It runs without a browser.
 */
import { GameLoop, SIM_DT } from '../src/engine/loop';
import { Session, type TumbleAim, type ViewProjection } from '../src/engine/session';
import { createDrill, arenaFor } from '../src/drills';
import { APM_DRILL_IDS, type LabSolution } from '../src/drills/apm';
import { DRILLS, type DrillId } from '../src/drills/catalog';
import { derive } from '../src/engine/metrics';
import { InputSystem, WASD_BINDINGS, type AbilitySlot, type InputEventKind, type MovementScheme } from '../src/engine/input';
import { angleDelta, dist, norm } from '../src/engine/math';
import { ARCHETYPES } from '../src/engine/archetypes';
import { EnemyBrain, tuningFor, type BotBehavior } from '../src/engine/ai';
import type { Actor, Vec2 } from '../src/engine/types';
import { incomingDamage } from '../src/engine/lane';
import type { VayneKit } from '../src/engine/vayne';
import { VAYNE_STATS } from '../src/engine/vayne';
import {
  APM_LEVELS,
  APM_MODES,
  CLEAR_AT,
  STAR_AT,
  applyApmRun,
  clearedThrough,
  emptyApmProgress,
  levelDifficulty,
  levelStars,
  modeMastery,
  recommendedLevel,
  seedApmLadder,
} from '../src/progression/apm';
import { Rng } from '../src/engine/rng';
import { World } from '../src/engine/world';

type Policy =
  | 'orbwalk'
  | 'spam'
  | 'idle'
  | 'standStill'
  | 'dodge'
  | 'aim'
  | 'hold'
  | 'nodes'
  | 'priority'
  | 'sequence'
  | 'lead'
  | 'lastHit'
  | 'wasd'
  | 'wasdHold'
  | 'wasdMash'
  | 'wasdCommand'
  | 'vayneTumble'
  | 'vayneBolts'
  | 'vayneCondemn'
  | 'vayneKit'
  | 'vayneWasd'
  | 'apmOrbwalk'
  | 'lab'
  | 'labWasd';

class FakeInput {
  cursor = { x: 0, y: 0 };
  queue: InputEventKind[] = [];
  totalClicks = 0;
  /** The held WASD direction, polled by the session exactly as the real one is. */
  dir = { x: 0, y: 0 };
  drain(): InputEventKind[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
  push(e: InputEventKind): void {
    this.queue.push(e);
  }
  moveVector(): { x: number; y: number } {
    return this.dir;
  }
}

/** The kit behind a Vayne drill, for the policies that have to read it. */
const kitOf = (drill: unknown): VayneKit | null => (drill as { kit?: VayneKit }).kit ?? null;

const fakeRenderer: ViewProjection = {
  screenToWorld: (x: number, y: number) => ({ x, y }),
};

const runDrill = (
  id: DrillId,
  policy: Policy,
  difficulty: number,
  seed = 12345,
  scheme: MovementScheme = 'click',
  tumbleAim: TumbleAim = 'hands',
) => {
  const meta = DRILLS[id];
  const bounds = arenaFor(id);
  const input = new FakeInput();
  const session = new Session(
    {
      duration: meta.duration > 0 ? meta.duration : 60,
      arena: bounds,
      seed,
      difficulty,
      abilities: meta.abilities,
      scheme,
      tumbleAim,
    },
    input as unknown as InputSystem,
    fakeRenderer,
  );
  const drill = createDrill(id, session);
  session.attachDrill(drill);

  // Skip the countdown: this harness is about mechanics, not presentation.
  session.countdown = 0;

  let t = 0;
  let reactTimer = 0;
  let orbitDir = 1;
  /** When the lab policy last issued an input, for its human rate limit. */
  let lastLabInput = -1;
  const maxT = (meta.duration > 0 ? meta.duration : 60) + 2;

  while (session.phase !== 'ended' && t < maxT) {
    const p = session.world.player;
    if (p && session.phase === 'running') {
      const enemies = session.world.actors.filter((a) => a.alive && a.team === 'enemy');
      const target = enemies.length
        ? enemies.reduce((a, b) => {
            const sa = a.hp + dist(p.pos, a.pos) * 0.35;
            const sb = b.hp + dist(p.pos, b.pos) * 0.35;
            return sa <= sb ? a : b;
          })
        : null;

      reactTimer -= SIM_DT;
      if (reactTimer <= 0) {
        switch (policy) {
          case 'apmOrbwalk':
          case 'orbwalk': {
            // A competent orbwalker: attack the instant the timer is up, then
            // spend the whole free window circling at the edge of range —
            // tangentially, with a radial correction, steering off the walls
            // rather than running into them.
            //
            // The APM variant runs at a human cadence rather than the sim's.
            // Twenty commands a second is not a fast player, it is a macro,
            // and the APM modes are built to refuse to pay one.
            reactTimer = policy === 'apmOrbwalk' ? 0.2 : 0.05;
            if (!target) break;
            const d = dist(p.pos, target.pos);
            const inRange = d - target.radius <= p.attack.range;
            if (p.attackCd <= 0.001 && p.phase !== 'windup' && inRange) {
              input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
              break;
            }
            if (p.phase === 'windup') break;

            const desired = p.attack.range * 0.94 + target.radius;
            const radial = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            const tangent = { x: -radial.y, y: radial.x };
            const spin = orbitDir;
            // Positive when too close: push out. Negative when too far: pull in.
            const correction = Math.max(-1, Math.min(1, (desired - d) / 180));
            const tw = 0.55 * (1 - Math.abs(correction));
            let gx = p.pos.x + (radial.x * correction + tangent.x * spin * tw) * 320;
            let gy = p.pos.y + (radial.y * correction + tangent.y * spin * tw) * 320;
            // Wall avoidance: bend back toward the middle before getting pinned.
            const margin = 190;
            if (gx < margin || gx > bounds.w - margin || gy < margin || gy > bounds.h - margin) {
              orbitDir *= -1;
              const toCentre = norm(bounds.w / 2 - p.pos.x, bounds.h / 2 - p.pos.y);
              gx = p.pos.x + toCentre.x * 300;
              gy = p.pos.y + toCentre.y * 300;
            }
            input.push({
              kind: 'move',
              x: Math.max(50, Math.min(bounds.w - 50, gx)),
              y: Math.max(50, Math.min(bounds.h - 50, gy)),
              t: t * 1000,
            });
            break;
          }
          case 'lastHit': {
            // Farming a lane the way it is meant to be farmed: hold the
            // attack until the shot will actually secure the kill, and stand
            // at the back of your own wave the rest of the time.
            //
            // It leans on exactly the read the drill draws for you — where the
            // health bar will be once everything already in the air arrives —
            // which is the point: if playing to the trainer's own indicator
            // did not beat swinging at everything, the indicator would be
            // teaching the wrong thing.
            reactTimer = 0.03;
            const w = session.world;
            const minions = w.actors.filter((a) => a.alive && a.team === 'enemy' && a.isMinion);
            let pick: (typeof minions)[number] | null = null;
            for (const m of minions) {
              const gap = dist(p.pos, m.pos) - m.radius;
              if (gap > p.attack.range) continue;
              if (incomingDamage(w, m, Infinity, { only: p.id }) > 0) continue; // already committed
              const lead = (1 / p.attack.attackSpeed) * p.attack.windupRatio + gap / p.attack.projectileSpeed;
              const at = m.hp - incomingDamage(w, m, lead, { exclude: p.id });
              if (at <= 0 || at > p.attack.damage) continue;
              if (!pick || m.hp < pick.hp) pick = m;
            }
            if (pick && p.attackCd <= 0.001 && p.phase !== 'windup') {
              input.push({ kind: 'move', x: pick.pos.x, y: pick.pos.y, t: t * 1000 });
              break;
            }
            if (p.phase === 'windup') break;
            const near = minions.filter((m) => m.pos.x < bounds.w * 0.62);
            if (near.length) {
              const cx = near.reduce((sum, m) => sum + m.pos.x, 0) / near.length;
              const cy = near.reduce((sum, m) => sum + m.pos.y, 0) / near.length;
              const gx = Math.min(cx - 430, bounds.w * 0.55);
              const gy = cy + 90;
              if (Math.hypot(gx - p.pos.x, gy - p.pos.y) > 40) {
                input.push({ kind: 'move', x: gx, y: gy, t: t * 1000 });
              }
            }
            break;
          }
          case 'spam': {
            // A player mashing move commands: every windup dies mid-swing.
            reactTimer = 0.12;
            const a = session.rng.angle();
            input.push({
              kind: 'attackMove',
              x: Math.max(60, Math.min(bounds.w - 60, p.pos.x + Math.cos(a) * 300)),
              y: Math.max(60, Math.min(bounds.h - 60, p.pos.y + Math.sin(a) * 300)),
              t: t * 1000,
            });
            break;
          }
          case 'standStill': {
            // Attacks, never moves: good DPS, no orbwalking.
            reactTimer = 0.1;
            if (target) input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
            break;
          }
          case 'dodge': {
            // Moves away from the nearest inbound projectile.
            reactTimer = 0.08;
            let best: { x: number; y: number } | null = null;
            let bd = Infinity;
            for (const pr of session.world.projectiles) {
              if (pr.team !== 'enemy') continue;
              const d = dist(p.pos, pr.pos);
              if (d < bd) {
                bd = d;
                best = pr.vel;
              }
            }
            if (best && bd < 420) {
              const perp = norm(-best.y, best.x);
              input.push({
                kind: 'move',
                x: Math.max(60, Math.min(bounds.w - 60, p.pos.x + perp.x * 300)),
                y: Math.max(60, Math.min(bounds.h - 60, p.pos.y + perp.y * 300)),
                t: t * 1000,
              });
            }
            break;
          }
          case 'aim': {
            reactTimer = 0.22;
            if (target) {
              input.cursor = { x: target.pos.x, y: target.pos.y };
              session.cursorWorld = { x: target.pos.x, y: target.pos.y };
              input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
            }
            break;
          }
          case 'hold': {
            // Disciplined spacing: attack when ready, otherwise hold the outer
            // edge of your own range and match their movement.
            //
            // The correction is radial *and* tangential, and it turns before
            // it reaches the floor edge. Backing away in a straight line is
            // how a real player gets cornered and it is not what competent
            // spacing looks like — a policy that did it would be testing the
            // arena's walls rather than the drill's scoring.
            reactTimer = 0.05;
            if (!target) break;
            const d = dist(p.pos, target.pos);
            const want = p.attack.range * 0.9 + target.radius;
            if (p.attackCd <= 0.001 && p.phase !== 'windup' && d - target.radius <= p.attack.range) {
              input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
              break;
            }
            if (p.phase === 'windup') break;
            const radial = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            const tangent = { x: -radial.y, y: radial.x };
            // Inside their reach is an emergency, not a small error: leave
            // first and re-space afterwards. Correcting proportionally from in
            // there means strolling out of a threat range, which is how a real
            // player eats four autos deciding what to do.
            const danger = target.attack.range + p.radius + 50;
            const correction = d < danger ? 1 : Math.max(-1, Math.min(1, (want - d) / 140));
            const tw = 0.7 * (1 - Math.abs(correction));
            let gx = p.pos.x + (radial.x * correction + tangent.x * orbitDir * tw) * 300;
            let gy = p.pos.y + (radial.y * correction + tangent.y * orbitDir * tw) * 300;
            // Pinned: go *around* them rather than into the wall. Walking to
            // the middle of the floor would be walking at the thing you are
            // spacing against, which no competent player does.
            const margin = 220;
            if (gx < margin || gx > bounds.w - margin || gy < margin || gy > bounds.h - margin) {
              const toCentre = norm(bounds.w / 2 - p.pos.x, bounds.h / 2 - p.pos.y);
              orbitDir = tangent.x * toCentre.x + tangent.y * toCentre.y >= 0 ? 1 : -1;
              gx = p.pos.x + tangent.x * orbitDir * 320;
              gy = p.pos.y + tangent.y * orbitDir * 320;
            }
            input.push({
              kind: 'move',
              x: Math.max(50, Math.min(bounds.w - 50, gx)),
              y: Math.max(50, Math.min(bounds.h - 50, gy)),
              t: t * 1000,
            });
            break;
          }
          case 'nodes': {
            // Move straight onto whichever node is lit.
            reactTimer = 0.1;
            const nodes = (drill as unknown as { nodes: { pos: { x: number; y: number } }[] }).nodes;
            const n = nodes?.[0];
            if (n) input.push({ kind: 'move', x: n.pos.x, y: n.pos.y, t: t * 1000 });
            break;
          }
          case 'priority': {
            // Click whichever unit is currently flagged as the priority.
            reactTimer = 0.2;
            const d = drill as unknown as { priorityId: number; dummies: { id: number; pos: { x: number; y: number } }[] };
            const want = d.dummies?.find((x) => x.id === d.priorityId);
            if (want) {
              session.cursorWorld = { x: want.pos.x, y: want.pos.y };
              input.push({ kind: 'move', x: want.pos.x, y: want.pos.y, t: t * 1000 });
            }
            break;
          }
          case 'sequence': {
            // Press the next key in the shown combo.
            reactTimer = 0.16;
            const d = drill as unknown as { sequence: string[]; index: number; idleCd: number };
            if (d.idleCd > 0) break;
            const slot = d.sequence?.[d.index];
            if (slot) {
              input.push({ kind: 'ability', slot: slot as 'q', x: p.pos.x + 200, y: p.pos.y, t: t * 1000 });
            }
            break;
          }
          case 'lead': {
            // A competent skillshot player: lead the nearest dummy by its
            // travel-time-adjusted position and fire the instant the shot is
            // off cooldown.
            reactTimer = 0.05;
            const cds = (drill as unknown as { cooldowns: Record<'q' | 'w' | 'e' | 'r', number> }).cooldowns;
            if (!target || !cds || cds.q > 0) break;
            const speed = 2050;
            let leadT = dist(p.pos, target.pos) / speed;
            for (let i = 0; i < 3; i++) {
              const predicted = { x: target.pos.x + target.vel.x * leadT, y: target.pos.y + target.vel.y * leadT };
              leadT = dist(p.pos, predicted) / speed;
            }
            const aim = { x: target.pos.x + target.vel.x * leadT, y: target.pos.y + target.vel.y * leadT };
            input.push({ kind: 'ability', slot: 'q', x: aim.x, y: aim.y, t: t * 1000 });
            break;
          }
          case 'wasd': {
            // WASD orbwalking: hold a direction through the free window,
            // release it to let the attack start, and never hold one through
            // a windup. The same rhythm as the click policy, other hand.
            reactTimer = 0.02;
            if (!target) {
              input.dir = { x: 0, y: 0 };
              break;
            }
            if (p.phase === 'windup') {
              input.dir = { x: 0, y: 0 };
              break;
            }
            const d = dist(p.pos, target.pos);
            const inRange = d - target.radius <= p.attack.range;
            if (p.attackCd <= 0.001 && inRange) {
              input.dir = { x: 0, y: 0 };
              if (p.targetId !== target.id) {
                input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
              }
              break;
            }
            const desired = p.attack.range * 0.92 + target.radius;
            const radial = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            const tangent = { x: -radial.y, y: radial.x };
            const correction = Math.max(-1, Math.min(1, (desired - d) / 180));
            let gx = radial.x * correction + tangent.x * orbitDir * 0.6;
            let gy = radial.y * correction + tangent.y * orbitDir * 0.6;
            const margin = 190;
            if (
              p.pos.x < margin ||
              p.pos.x > bounds.w - margin ||
              p.pos.y < margin ||
              p.pos.y > bounds.h - margin
            ) {
              orbitDir *= -1;
              const toCentre = norm(bounds.w / 2 - p.pos.x, bounds.h / 2 - p.pos.y);
              gx = toCentre.x;
              gy = toCentre.y;
            }
            input.dir = { x: gx, y: gy };
            break;
          }
          case 'wasdHold': {
            // Never lets go of the keys. Under direct control that means the
            // attack never starts, which is exactly the mistake being priced.
            reactTimer = 0.1;
            if (target && p.targetId !== target.id) {
              input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
            }
            const a = session.rng.angle();
            input.dir = { x: Math.cos(a), y: Math.sin(a) };
            break;
          }
          case 'wasdMash': {
            // Never lets go of the keys and mashes the attack command.
            //
            // The premise of the whole scheme is on trial here: an attack
            // command plants your feet until the shot leaves, so a command
            // fired half a cycle early buys nothing but standing still. If
            // mashing outscored timing, the attack command would be a cheat
            // code rather than a mechanic.
            reactTimer = 0.06;
            if (!target) {
              input.dir = { x: 0, y: 0 };
              break;
            }
            input.push({ kind: 'attackMove', x: target.pos.x, y: target.pos.y, t: t * 1000 });
            const away = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            input.dir = { x: -away.y, y: away.x };
            break;
          }
          case 'wasdCommand': {
            // The other legitimate WASD rhythm: keep the keys down the whole
            // run and buy every attack with a command timed onto the tick.
            // It should land in the same band as releasing the keys — it is
            // the same skill, expressed with the other hand — and it must not
            // beat it, because nothing about it is harder.
            reactTimer = 0.02;
            if (!target) {
              input.dir = { x: 0, y: 0 };
              break;
            }
            const dC = dist(p.pos, target.pos);
            const inRangeC = dC - target.radius <= p.attack.range;
            if (p.attackCd <= 0.001 && p.phase !== 'windup' && inRangeC) {
              input.push({ kind: 'attackMove', x: target.pos.x, y: target.pos.y, t: t * 1000 });
            }
            const desiredC = p.attack.range * 0.92 + target.radius;
            const radialC = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            const tangentC = { x: -radialC.y, y: radialC.x };
            const corrC = Math.max(-1, Math.min(1, (desiredC - dC) / 180));
            let gxC = radialC.x * corrC + tangentC.x * orbitDir * 0.6;
            let gyC = radialC.y * corrC + tangentC.y * orbitDir * 0.6;
            const marginC = 190;
            if (p.pos.x < marginC || p.pos.x > bounds.w - marginC || p.pos.y < marginC || p.pos.y > bounds.h - marginC) {
              orbitDir *= -1;
              const toCentre = norm(bounds.w / 2 - p.pos.x, bounds.h / 2 - p.pos.y);
              gxC = toCentre.x;
              gyC = toCentre.y;
            }
            input.dir = { x: gxC, y: gyC };
            break;
          }
          case 'vayneTumble': {
            // Orbwalk, and spend the tumble in the backswing every time it is
            // up — the behaviour the drill exists to reward.
            reactTimer = 0.03;
            const kit = kitOf(drill);
            if (!target) break;
            if (kit && p.phase === 'backswing' && kit.tumbleCd <= 0) {
              const away = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
              input.push({
                kind: 'ability',
                slot: 'q',
                x: p.pos.x + away.x * 320,
                y: p.pos.y + away.y * 320,
                t: t * 1000,
              });
              break;
            }
            if (p.phase === 'windup') break;
            const d = dist(p.pos, target.pos);
            const inRange = d - target.radius <= p.attack.range;
            if (p.attackCd <= 0.001 && inRange) {
              input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
              break;
            }
            const desired = p.attack.range * 0.92 + target.radius;
            const radial = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            const tangent = { x: -radial.y, y: radial.x };
            const correction = Math.max(-1, Math.min(1, (desired - d) / 180));
            let gx = p.pos.x + (radial.x * correction + tangent.x * orbitDir * 0.55) * 320;
            let gy = p.pos.y + (radial.y * correction + tangent.y * orbitDir * 0.55) * 320;
            const margin = 190;
            if (gx < margin || gx > bounds.w - margin || gy < margin || gy > bounds.h - margin) {
              orbitDir *= -1;
              const toCentre = norm(bounds.w / 2 - p.pos.x, bounds.h / 2 - p.pos.y);
              gx = p.pos.x + toCentre.x * 300;
              gy = p.pos.y + toCentre.y * 300;
            }
            input.push({
              kind: 'move',
              x: Math.max(50, Math.min(bounds.w - 50, gx)),
              y: Math.max(50, Math.min(bounds.h - 50, gy)),
              t: t * 1000,
            });
            break;
          }
          case 'vayneBolts': {
            // Never abandons a stack: stays on the unit holding stacks until
            // the bolts fire, then takes whichever target is marked.
            reactTimer = 0.12;
            const kit = kitOf(drill);
            const marked = (drill as unknown as { priorityId: number }).priorityId;
            const held = kit && kit.stacks > 0 ? session.world.byId(kit.stackTargetId) : undefined;
            const want = held && held.alive ? held : session.world.byId(marked) ?? target;
            if (!want || !want.alive) break;
            session.cursorWorld = { x: want.pos.x, y: want.pos.y };
            input.push({ kind: 'move', x: want.pos.x, y: want.pos.y, t: t * 1000 });
            break;
          }
          case 'vayneCondemn': {
            // Condemns the first charger that has terrain waiting behind it,
            // and otherwise keeps attacking.
            reactTimer = 0.06;
            const kit = kitOf(drill);
            if (kit && kit.condemnCd <= 0) {
              for (const e of session.world.enemies()) {
                if (dist(p.pos, e.pos) - e.radius > VAYNE_STATS.condemnRange) continue;
                const dir = norm(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
                const path = session.world.terrainAlong(e.pos, dir, VAYNE_STATS.condemnPush, e.radius);
                if (!path.hit) continue;
                session.cursorWorld = { x: e.pos.x, y: e.pos.y };
                input.push({ kind: 'ability', slot: 'e', x: e.pos.x, y: e.pos.y, t: t * 1000 });
                break;
              }
            }
            if (target && p.attackCd <= 0.001 && p.phase !== 'windup') {
              input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
            }
            break;
          }
          case 'vayneWasd': {
            // The Vayne rhythm, driven with the keys instead of the mouse.
            //
            // The mouse is deliberately parked on the pursuer the whole time —
            // that is where a WASD player's cursor actually lives, because the
            // cursor is what chooses the target. So every tumble here is
            // pressed with the cursor pointing *at* the thing being escaped,
            // which is precisely the case the aim setting exists to resolve.
            reactTimer = 0.02;
            const kit = kitOf(drill);
            if (!target) {
              input.dir = { x: 0, y: 0 };
              break;
            }
            session.cursorWorld = { x: target.pos.x, y: target.pos.y };
            const away = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            if (p.phase === 'windup') {
              input.dir = { x: 0, y: 0 };
              break;
            }
            if (kit && p.phase === 'backswing' && kit.tumbleCd <= 0) {
              input.dir = { x: away.x, y: away.y };
              input.push({ kind: 'ability', slot: 'q', x: target.pos.x, y: target.pos.y, t: t * 1000 });
              break;
            }
            const dW = dist(p.pos, target.pos);
            const inRangeW = dW - target.radius <= p.attack.range;
            if (p.attackCd <= 0.001 && inRangeW) {
              input.dir = { x: 0, y: 0 };
              if (p.targetId !== target.id) {
                input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
              }
              break;
            }
            const desiredW = p.attack.range * 0.92 + target.radius;
            const radialW = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            const tangentW = { x: -radialW.y, y: radialW.x };
            const correctionW = Math.max(-1, Math.min(1, (desiredW - dW) / 180));
            let gxW = radialW.x * correctionW + tangentW.x * orbitDir * 0.6;
            let gyW = radialW.y * correctionW + tangentW.y * orbitDir * 0.6;
            const marginW = 190;
            if (
              p.pos.x < marginW ||
              p.pos.x > bounds.w - marginW ||
              p.pos.y < marginW ||
              p.pos.y > bounds.h - marginW
            ) {
              orbitDir *= -1;
              const toCentre = norm(bounds.w / 2 - p.pos.x, bounds.h / 2 - p.pos.y);
              gxW = toCentre.x;
              gyW = toCentre.y;
            }
            input.dir = { x: gxW, y: gyW };
            break;
          }
          case 'vayneKit': {
            // The whole champion: orbwalk, tumble in the backswing, condemn
            // into terrain, and open the ultimate once the fight is joined.
            reactTimer = 0.04;
            const kit = kitOf(drill);
            if (kit && !kit.inFinalHour && kit.hourCd <= 0 && target && dist(p.pos, target.pos) < 700) {
              input.push({ kind: 'ability', slot: 'r', x: p.pos.x, y: p.pos.y, t: t * 1000 });
              break;
            }
            if (kit && kit.condemnCd <= 0) {
              for (const e of session.world.enemies()) {
                if (dist(p.pos, e.pos) - e.radius > VAYNE_STATS.condemnRange) continue;
                const dir = norm(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
                const path = session.world.terrainAlong(e.pos, dir, VAYNE_STATS.condemnPush, e.radius);
                if (!path.hit) continue;
                input.push({ kind: 'ability', slot: 'e', x: e.pos.x, y: e.pos.y, t: t * 1000 });
                break;
              }
            }
            if (!target) break;
            if (kit && p.phase === 'backswing' && kit.tumbleCd <= 0) {
              const away = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
              input.push({
                kind: 'ability',
                slot: 'q',
                x: p.pos.x + away.x * 320,
                y: p.pos.y + away.y * 320,
                t: t * 1000,
              });
              break;
            }
            if (p.phase === 'windup') break;
            const d = dist(p.pos, target.pos);
            const inRange = d - target.radius <= p.attack.range;
            if (p.attackCd <= 0.001 && inRange) {
              input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
              break;
            }
            const desired = p.attack.range * 0.9 + target.radius;
            const radial = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            const tangent = { x: -radial.y, y: radial.x };
            const correction = Math.max(-1, Math.min(1, (desired - d) / 180));
            let gx = p.pos.x + (radial.x * correction + tangent.x * orbitDir * 0.5) * 300;
            let gy = p.pos.y + (radial.y * correction + tangent.y * orbitDir * 0.5) * 300;
            const margin = 200;
            if (gx < margin || gx > bounds.w - margin || gy < margin || gy > bounds.h - margin) {
              orbitDir *= -1;
              const toCentre = norm(bounds.w / 2 - p.pos.x, bounds.h / 2 - p.pos.y);
              gx = p.pos.x + toCentre.x * 300;
              gy = p.pos.y + toCentre.y * 300;
            }
            input.push({
              kind: 'move',
              x: Math.max(60, Math.min(bounds.w - 60, gx)),
              y: Math.max(60, Math.min(bounds.h - 60, gy)),
              t: t * 1000,
            });
            break;
          }
          // ---------------------------------------------------------- the lab
          case 'lab':
          case 'labWasd': {
            // Thirteen modes, one policy. Every lab drill can say what a
            // perfect player would do at this instant, including the modes
            // where that is "nothing", so the harness does not need thirteen
            // sets of internals — and cannot accidentally be scored well by a
            // strategy the drill never asked for.
            //
            // The poll is fast and the *inputs* are rate-limited instead. A
            // timing mode needs to be looked at every few milliseconds to be
            // played properly; no mode should be answerable three hundred
            // times a minute faster than a person could answer it.
            reactTimer = 0.04;
            const sol = (drill as unknown as { solution?: () => LabSolution }).solution?.();
            if (!sol) break;
            if (policy === 'labWasd') {
              input.dir = sol.wait || !sol.dir ? { x: 0, y: 0 } : { x: sol.dir.x, y: sol.dir.y };
              if (sol.dir) break;
            }
            if (sol.wait) break;
            if (t - lastLabInput < LAB_MIN_GAP) break;
            if (sol.keys && sol.keys.length) {
              lastLabInput = t;
              // A chord goes in one step, which is exactly what it is asking a
              // pair of fingers for.
              for (const k of sol.keys) input.push({ kind: 'ability', slot: k, x: p.pos.x, y: p.pos.y, t: t * 1000 });
              break;
            }
            if (sol.click) {
              lastLabInput = t;
              const x = Math.max(40, Math.min(bounds.w - 40, sol.click.x));
              const y = Math.max(40, Math.min(bounds.h - 40, sol.click.y));
              input.cursor = { x, y };
              session.cursorWorld = { x, y };
              input.push({ kind: 'move', x, y, t: t * 1000 });
            }
            break;
          }
          case 'idle':
            reactTimer = 1;
            break;
        }
      }
      const ownsCursor =
        policy === 'aim' ||
        policy === 'vayneWasd' ||
        policy === 'vayneBolts' ||
        policy === 'vayneCondemn' ||
        policy === 'lab' ||
        policy === 'labWasd';
      if (!ownsCursor) {
        session.cursorWorld = { x: p.pos.x, y: p.pos.y };
      }
    }

    session.step(SIM_DT);
    t += SIM_DT;
  }

  const out = drill.outcome();
  const m = session.metrics.m;
  const d = derive(m, session.world.player?.maxHp ?? 720);
  return { out, m, d, session, drill };
};

/**
 * The shortest gap the lab policy will leave between two inputs.
 *
 * Three hundred actions a minute is at the top of what a very fast person
 * sustains, and every mode's par sits under it. Without a floor here the
 * harness would report four-figure rates and quietly stop being evidence that
 * a *person* can score well.
 */
const LAB_MIN_GAP = 0.2;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Averages a drill over several seeds — arena compositions vary a lot. */
const avgRun = (id: DrillId, policy: Policy, difficulty: number, seeds = [7, 1234, 99991, 424242]) => {
  const runs = seeds.map((sd) => runDrill(id, policy, difficulty, sd));
  return {
    perf: runs.reduce((a, r) => a + r.out.performance, 0) / runs.length,
    kills: runs.reduce((a, r) => a + r.m.kills, 0) / runs.length,
    survived: runs.reduce((a, r) => a + r.m.survivalTime, 0) / runs.length,
    hp: runs.reduce((a, r) => a + r.d.hpRetained, 0) / runs.length,
    wins: runs.filter((r) => r.m.survived && r.m.kills > 0 && r.session.world.enemies().length === 0).length,
    n: runs.length,
  };
};
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

// Minimal browser shims so the audio and fx modules import cleanly.
(globalThis as unknown as { window: unknown }).window = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  AudioContext: undefined,
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ getContext: () => null, width: 0, height: 0 }),
};

line('\n=== KITE: correct orbwalking vs. spam vs. standing still ===');
const kiteGood = runDrill('kite', 'orbwalk', 0.45);
const kiteSpam = runDrill('kite', 'spam', 0.45);
const kiteStill = runDrill('kite', 'standStill', 0.45);

line(`  orbwalk   : orbwalk ${pct(kiteGood.d.orbwalkEfficiency)}  attackEff ${pct(kiteGood.d.attackEfficiency)}  moveEff ${pct(kiteGood.d.moveEfficiency)}  cancels ${kiteGood.m.attacksCancelled}  chain ${kiteGood.m.maxChain}  dmg ${Math.round(kiteGood.m.damageDealt)}  hpLost ${Math.round(kiteGood.m.hpLost)}  perf ${pct(kiteGood.out.performance)}  score ${kiteGood.out.score}`);
line(`  spam      : orbwalk ${pct(kiteSpam.d.orbwalkEfficiency)}  cancels ${kiteSpam.m.attacksCancelled}  dmg ${Math.round(kiteSpam.m.damageDealt)}  perf ${pct(kiteSpam.out.performance)}  score ${kiteSpam.out.score}`);
line(`  standStill: orbwalk ${pct(kiteStill.d.orbwalkEfficiency)}  attackEff ${pct(kiteStill.d.attackEfficiency)}  moveEff ${pct(kiteStill.d.moveEfficiency)}  hpLost ${Math.round(kiteStill.m.hpLost)}  perf ${pct(kiteStill.out.performance)}  score ${kiteStill.out.score}`);

expect('orbwalking beats spamming', kiteGood.out.performance > kiteSpam.out.performance * 1.5, `${pct(kiteGood.out.performance)} vs ${pct(kiteSpam.out.performance)}`);
expect('orbwalking beats standing still', kiteGood.out.performance > kiteStill.out.performance, `${pct(kiteGood.out.performance)} vs ${pct(kiteStill.out.performance)}`);
expect('good orbwalk efficiency is high', kiteGood.d.orbwalkEfficiency > 0.62, pct(kiteGood.d.orbwalkEfficiency));
expect('spam produces many cancels', kiteSpam.m.attacksCancelled > 5, `${kiteSpam.m.attacksCancelled}`);
expect('orbwalk produces few cancels', kiteGood.m.attacksCancelled <= 2, `${kiteGood.m.attacksCancelled}`);
expect('orbwalk deals real damage', kiteGood.m.damageDealt > 400, `${Math.round(kiteGood.m.damageDealt)}`);
expect('standing still takes more damage than kiting', kiteStill.m.hpLost > kiteGood.m.hpLost, `${Math.round(kiteStill.m.hpLost)} vs ${Math.round(kiteGood.m.hpLost)}`);

line('\n=== DODGE: reacting vs. idle ===');
const dodgeGood = runDrill('dodge', 'dodge', 0.4);
const dodgeIdle = runDrill('dodge', 'idle', 0.4);
line(`  reacting: hits ${dodgeGood.m.hitsTaken}  survived ${dodgeGood.m.survivalTime.toFixed(1)}s  nearMiss ${dodgeGood.m.nearMisses}  perf ${pct(dodgeGood.out.performance)}`);
line(`  idle    : hits ${dodgeIdle.m.hitsTaken}  survived ${dodgeIdle.m.survivalTime.toFixed(1)}s  perf ${pct(dodgeIdle.out.performance)}`);
expect('dodging beats standing still', dodgeGood.out.performance > dodgeIdle.out.performance, `${pct(dodgeGood.out.performance)} vs ${pct(dodgeIdle.out.performance)}`);
expect('idle player actually gets hit', dodgeIdle.m.hitsTaken > 2, `${dodgeIdle.m.hitsTaken}`);

line('\n=== 1v1: fighting vs. idle ===');
const duelGood = runDrill('duel1v1', 'orbwalk', 0.4);
const duelIdle = runDrill('duel1v1', 'idle', 0.4);
line(`  fighting: kills ${duelGood.m.kills}  survived ${duelGood.m.survivalTime.toFixed(1)}s  hp ${pct(duelGood.d.hpRetained)}  perf ${pct(duelGood.out.performance)}  score ${duelGood.out.score}`);
line(`  idle    : kills ${duelIdle.m.kills}  survived ${duelIdle.m.survivalTime.toFixed(1)}s  perf ${pct(duelIdle.out.performance)}`);
expect('fighting beats idling in 1v1', duelGood.out.performance > duelIdle.out.performance, `${pct(duelGood.out.performance)} vs ${pct(duelIdle.out.performance)}`);
expect('a competent player can win the 1v1', duelGood.m.kills >= 1, `${duelGood.m.kills} kills`);
expect('an idle player dies', !duelIdle.m.survived, 'idle player survived');

line('\n=== 1v2 / 1v3 are meaningfully harder (averaged over seeds) ===');
const a1 = avgRun('duel1v1', 'orbwalk', 0.4);
const a2 = avgRun('duel1v2', 'orbwalk', 0.4);
const a3 = avgRun('duel1v3', 'orbwalk', 0.4);
for (const [name, a] of [['1v1', a1], ['1v2', a2], ['1v3', a3]] as [string, typeof a1][]) {
  line(`  ${name}: perf ${pct(a.perf)}  wins ${a.wins}/${a.n}  kills ${a.kills.toFixed(1)}  survived ${a.survived.toFixed(1)}s  hp ${pct(a.hp)}`);
}
expect('1v1 is the most forgiving arena', a1.perf > a2.perf && a1.perf > a3.perf, `${pct(a1.perf)} / ${pct(a2.perf)} / ${pct(a3.perf)}`);
expect('1v3 takes more of your health than 1v2', a3.hp < a2.hp + 0.05, `${pct(a3.hp)} vs ${pct(a2.hp)}`);
expect('every arena is winnable at least sometimes', a2.wins > 0 && a3.wins > 0, `1v2 ${a2.wins}/${a2.n}, 1v3 ${a3.wins}/${a3.n}`);

line('\n=== A strong player can win 1v2 at a gentle difficulty ===');
const easy2 = runDrill('duel1v2', 'orbwalk', 0.15);
line(`  1v2 @0.15: kills ${easy2.m.kills}/2  survived ${easy2.m.survivalTime.toFixed(1)}s  hp ${pct(easy2.d.hpRetained)}  perf ${pct(easy2.out.performance)}`);
expect('1v2 is winnable at low difficulty', easy2.m.kills >= 1, `${easy2.m.kills} kills`);

line('\n=== Difficulty actually changes outcomes (not just HP) ===');
const easy = runDrill('duel1v1', 'orbwalk', 0.1);
const hard = runDrill('duel1v1', 'orbwalk', 0.95);
line(`  easy(0.10): perf ${pct(easy.out.performance)}  hp ${pct(easy.d.hpRetained)}  survived ${easy.m.survivalTime.toFixed(1)}s`);
line(`  hard(0.95): perf ${pct(hard.out.performance)}  hp ${pct(hard.d.hpRetained)}  survived ${hard.m.survivalTime.toFixed(1)}s`);
expect('the same policy performs worse at high difficulty', hard.out.performance < easy.out.performance, `${pct(hard.out.performance)} vs ${pct(easy.out.performance)}`);

line('\n=== AIM: clicking targets vs. nothing ===');
const aimGood = runDrill('aim', 'aim', 0.4);
const aimIdle = runDrill('aim', 'idle', 0.4);
line(`  clicking: hits ${aimGood.m.reactionTimes.length}  perf ${pct(aimGood.out.performance)}  score ${aimGood.out.score}`);
line(`  idle    : perf ${pct(aimIdle.out.performance)}`);
expect('clicking targets beats idling', aimGood.out.performance > aimIdle.out.performance, `${pct(aimGood.out.performance)} vs ${pct(aimIdle.out.performance)}`);

line('\n=== SPACING: holding the band vs. drifting ===');
const spaceGood = runDrill('spacing', 'hold', 0.4);
const spaceIdle = runDrill('spacing', 'idle', 0.4);
const spaceBlind = (r: ReturnType<typeof runDrill>) => r.out.keyMetrics.find((k) => k.id === 'blind')?.value ?? 0;
line(`  holding : advantage ${pct(spaceGood.out.keyMetrics[0].value)}  blind ${pct(spaceBlind(spaceGood))}  pocketUse ${pct(spaceGood.d.pocketUse)}  overstep ${pct(spaceGood.d.overstepRate)}  hp ${pct(spaceGood.d.hpRetained)}  perf ${pct(spaceGood.out.performance)}`);
line(`  idle    : advantage ${pct(spaceIdle.out.keyMetrics[0].value)}  perf ${pct(spaceIdle.out.performance)}`);
expect('holding the pocket scores well', spaceGood.out.performance > 0.6, pct(spaceGood.out.performance));
expect('holding beats drifting', spaceGood.out.performance > spaceIdle.out.performance * 1.8, `${pct(spaceGood.out.performance)} vs ${pct(spaceIdle.out.performance)}`);
expect('a competent player holds the pocket most of the run', spaceGood.out.keyMetrics[0].value > 0.6, pct(spaceGood.out.keyMetrics[0].value));
expect('and still holds it once the ranges are hidden', spaceBlind(spaceGood) > 0.55, pct(spaceBlind(spaceGood)));
expect('and trades from it rather than waiting in it', spaceGood.d.pocketUse > 0.5, pct(spaceGood.d.pocketUse));

line('\n=== SKILLSHOT: leading a juking target vs. idle ===');
const shotGood = runDrill('skillshot', 'lead', 0.35);
const shotIdle = runDrill('skillshot', 'idle', 0.35);
line(`  leading : hitRate ${pct(shotGood.out.keyMetrics[0].value)}  landed ${shotGood.out.keyMetrics[1].value}  chain ${shotGood.out.keyMetrics[3].value}  perf ${pct(shotGood.out.performance)}  score ${shotGood.out.score}`);
line(`  idle    : hitRate ${pct(shotIdle.out.keyMetrics[0].value)}  perf ${pct(shotIdle.out.performance)}`);
expect('leading beats idling in skillshot', shotGood.out.performance > shotIdle.out.performance, `${pct(shotGood.out.performance)} vs ${pct(shotIdle.out.performance)}`);
expect('a competent player lands most shots on a juking dummy', shotGood.out.keyMetrics[0].value > 0.55, pct(shotGood.out.keyMetrics[0].value));

line('\n=== Every drill rewards playing it correctly ===');
for (const [id, policy] of [
  ['movement', 'nodes'],
  ['targetswitch', 'priority'],
  ['combos', 'sequence'],
  ['lasthit', 'lastHit'],
  ['skillshot', 'lead'],
] as [DrillId, Policy][]) {
  const r = runDrill(id, policy, 0.35);
  line(`  ${id.padEnd(13)} correct play perf ${pct(r.out.performance)}  score ${r.out.score}  ${r.out.keyMetrics.slice(0, 2).map((k) => `${k.label} ${k.value.toFixed(2)}`).join('  ')}`);
  expect(`${id} rewards correct play`, r.out.performance > 0.55, pct(r.out.performance));
}

line('\n=== LAST HIT: a lane rewards patience, not volume ===');
{
  const drillOf = (r: ReturnType<typeof runDrill>) => r.drill as unknown as Record<string, number>;
  const patient = runDrill('lasthit', 'lastHit', 0.45);
  const greedy = runDrill('lasthit', 'orbwalk', 0.45);
  const dp = drillOf(patient);
  const dg = drillOf(greedy);
  const accOf = (r: ReturnType<typeof runDrill>) => r.out.keyMetrics.find((k) => k.id === 'csAcc')?.value ?? 0;
  line(
    `  patient : cs ${dp.cs}  perfect ${dp.perfect}  missed ${dp.missed}  wasted ${dp.wastedHits}  acc ${pct(accOf(patient))}  perf ${pct(patient.out.performance)}`,
  );
  line(
    `  greedy  : cs ${dg.cs}  perfect ${dg.perfect}  missed ${dg.missed}  wasted ${dg.wastedHits}  acc ${pct(accOf(greedy))}  perf ${pct(greedy.out.performance)}`,
  );
  expect('waiting for the kill window beats swinging at everything', patient.out.performance > greedy.out.performance + 0.15, `${pct(patient.out.performance)} vs ${pct(greedy.out.performance)}`);
  expect('patience secures a higher share of the wave', accOf(patient) > accOf(greedy), `${pct(accOf(patient))} vs ${pct(accOf(greedy))}`);
  expect('a patient run wastes almost no attacks', dp.wastedHits <= dg.wastedHits, `${dp.wastedHits} vs ${dg.wastedHits}`);
  expect('the lane actually produces farm', dp.cs > 15, `${dp.cs} cs`);
}

line('\n=== LAST HIT: every point of damage has an owner ===');
{
  // The premise of the whole drill: nothing drains. Run the lane with no
  // player input at all and assert that every minion that died was killed by
  // a unit that is still identifiable, and that the enemy laner farms.
  const r = runDrill('lasthit', 'idle', 0.7);
  const d = r.drill as unknown as Record<string, number>;
  line(`  unattended lane: enemy minions lost ${d.missed}  to your turret ${d.missedToTurret}  rival cs ${d.rivalCs}  your cs ${d.cs}`);
  expect('minions kill each other without you', d.missed > 10, `${d.missed}`);
  expect('an unattended lane is farmed by the rival', d.rivalCs > 4, `${d.rivalCs}`);
  expect('doing nothing farms nothing', d.cs === 0, `${d.cs}`);
}

line('\n=== Honesty: doing nothing scores near zero everywhere ===');
for (const id of ['movement', 'aim', 'skillshot', 'kite', 'spacing', 'lasthit', 'targetswitch', 'combos'] as DrillId[]) {
  const r = runDrill(id, 'idle', 0.4);
  line(`  ${id.padEnd(13)} idle perf ${pct(r.out.performance)}  score ${r.out.score}`);
  expect(`${id} cannot be passed by doing nothing`, r.out.performance < 0.3, pct(r.out.performance));
}

line('\n=== SPACING / MOVEMENT / LAST HIT / TARGET SWITCH / COMBOS / SKILLSHOT run clean ===');
for (const id of ['spacing', 'movement', 'lasthit', 'targetswitch', 'combos', 'skillshot'] as DrillId[]) {
  const r = runDrill(id, id === 'skillshot' ? 'lead' : id === 'lasthit' ? 'lastHit' : 'orbwalk', 0.4);
  const finite = Number.isFinite(r.out.performance) && Number.isFinite(r.out.score);
  line(`  ${id.padEnd(13)} perf ${pct(r.out.performance)}  score ${r.out.score}  metrics ${r.out.keyMetrics.length}`);
  expect(`${id} produces finite, in-range results`, finite && r.out.performance >= 0 && r.out.performance <= 1, `perf=${r.out.performance}`);
}

line('\n=== WASD: the same rhythm with the other hand ===');
{
  const wasdGood = runDrill('kite', 'wasd', 0.45, 12345, 'wasd');
  const wasdHold = runDrill('kite', 'wasdHold', 0.45, 12345, 'wasd');
  const wasdIdle = runDrill('kite', 'idle', 0.45, 12345, 'wasd');
  line(`  wasd orbwalk: orbwalk ${pct(wasdGood.d.orbwalkEfficiency)}  moveEff ${pct(wasdGood.d.moveEfficiency)}  attacks ${wasdGood.m.attacksCompleted}  cancels ${wasdGood.m.attacksCancelled}  dmg ${Math.round(wasdGood.m.damageDealt)}  perf ${pct(wasdGood.out.performance)}`);
  line(`  keys held  : attacks ${wasdHold.m.attacksCompleted}  dmg ${Math.round(wasdHold.m.damageDealt)}  perf ${pct(wasdHold.out.performance)}`);
  line(`  idle       : perf ${pct(wasdIdle.out.performance)}`);
  expect('WASD orbwalking actually attacks', wasdGood.m.attacksCompleted > 20, `${wasdGood.m.attacksCompleted}`);
  expect('WASD orbwalking uses its free window', wasdGood.d.moveEfficiency > 0.5, pct(wasdGood.d.moveEfficiency));
  expect('WASD orbwalking scores well', wasdGood.out.performance > 0.5, pct(wasdGood.out.performance));
  expect(
    'holding the keys without commanding a shot never attacks',
    wasdHold.m.attacksCompleted <= 1 && wasdGood.out.performance > wasdHold.out.performance * 1.5,
    `${wasdHold.m.attacksCompleted} attacks, perf ${pct(wasdHold.out.performance)}`,
  );
  expect('WASD cannot be passed by doing nothing', wasdIdle.out.performance < 0.3, pct(wasdIdle.out.performance));
  expect(
    'WASD and click orbwalking land in the same band',
    Math.abs(wasdGood.out.performance - kiteGood.out.performance) < 0.25,
    `${pct(wasdGood.out.performance)} vs ${pct(kiteGood.out.performance)}`,
  );
}

line('\n=== Bots generate situations, not straight lines ===');
{
  // Each behaviour is put in a bare arena against a player that either stands
  // still or walks at it, and asked to prove it does the thing it is named
  // after. The three banned behaviours are asserted against directly: no
  // straight-line chasing, no jitter, no loop.
  const observe = (
    behavior: BotBehavior,
    drive: (p: Actor, t: number) => void,
    seconds = 12,
    preferredRange?: number,
  ) => {
    const world = new World({ w: 2400, h: 2400 }, new Rng(77));
    const p = world.spawnPlayer({ x: 1200, y: 1200 });
    p.directControl = true;
    const def = ARCHETYPES.ranger;
    const e = world.spawnActor({
      pos: { x: 1200, y: 700 },
      team: 'enemy',
      maxHp: 4000,
      radius: def.radius,
      moveSpeed: def.moveSpeed,
      attack: { ...def.attack },
      archetype: 'ranger',
    });
    const brain = new EnemyBrain(e, 'ranger', tuningFor(0.5), new Rng(31));
    brain.behavior = behavior;
    brain.anchor = { x: 1200, y: 700 };
    brain.leash = 420;
    if (preferredRange !== undefined) brain.preferredRange = preferredRange;
    const track: { d: number; pos: Vec2; heading: number }[] = [];
    let t = 0;
    let last = { ...e.pos };
    while (t < seconds) {
      drive(p, t);
      brain.update(world, SIM_DT);
      world.step(SIM_DT);
      t += SIM_DT;
      const moved = dist(last, e.pos);
      if (moved > 0.5) {
        track.push({ d: dist(p.pos, e.pos), pos: { ...e.pos }, heading: Math.atan2(e.pos.y - last.y, e.pos.x - last.x) });
        last = { ...e.pos };
      }
    }
    return { world, player: p, enemy: e, brain, track };
  };

  const still = (_p: Actor) => {};
  const walkAt = (p: Actor) => {
    world0.setMoveDir(p, 0, -1);
  };
  // `walkAt` needs a world to talk to; the observer owns one, so route through
  // the player's own move direction instead.
  void walkAt;
  const approach = (p: Actor) => {
    p.moveDir = { x: 0, y: -1 };
  };
  const world0 = new World({ w: 10, h: 10 }, new Rng(1));

  // CHASE must close, and must not do it in a straight line.
  {
    // A chaser with a melee unit's preferred range: the whole question is
    // whether it arrives, and by what path.
    const r = observe('chase', still, 12, 140);
    const headings = r.track.map((s) => s.heading);
    const spread = Math.max(...headings) - Math.min(...headings);
    expect('a chaser actually closes the gap', dist(r.player.pos, r.enemy.pos) < 400, `${dist(r.player.pos, r.enemy.pos).toFixed(0)}u`);
    expect('a chaser does not walk a straight line', spread > 0.5, `heading spread ${spread.toFixed(2)}rad`);
  }

  // RETREAT must refuse to be caught while a player walks straight at it.
  {
    const r = observe('retreat', approach, 10);
    expect('a runner keeps its distance from an approaching player', dist(r.player.pos, r.enemy.pos) > 300, `${dist(r.player.pos, r.enemy.pos).toFixed(0)}u`);
  }

  // TETHER must never leave its leash, however far the player walks off.
  {
    const r = observe('tether', (p) => {
      p.moveDir = { x: 1, y: 1 };
    }, 14);
    const worst = Math.max(...r.track.map((s) => dist(s.pos, r.brain.anchor!)));
    expect('a tether never leaves its leash', worst < r.brain.leash + 90, `${worst.toFixed(0)}u vs leash ${r.brain.leash}`);
  }

  // BAIT must leave when reached for.
  {
    const r = observe('bait', approach, 10);
    expect('a bait backs off when you step toward it', dist(r.player.pos, r.enemy.pos) > 380, `${dist(r.player.pos, r.enemy.pos).toFixed(0)}u`);
  }

  // ERRATIC must commit: headings held long enough to be read, not jitter.
  {
    const r = observe('erratic', still, 14);
    let flips = 0;
    for (let i = 1; i < r.track.length; i++) {
      if (Math.abs(angleDelta(r.track[i].heading, r.track[i - 1].heading)) > 1.2) flips++;
    }
    const perSecond = flips / 14;
    expect('erratic commits rather than jitters', perSecond < 5, `${perSecond.toFixed(1)} hard turns/s`);
    expect('erratic is genuinely unpredictable', flips > 4, `${flips} direction changes in 14s`);
  }

  // IRREGULAR must never come back around: no position is revisited on a period.
  {
    const r = observe('irregular', still, 24);
    // Compare the second half of the path against the first at every lag: a
    // looping walk has one lag where the two line up almost exactly.
    const pts = r.track.map((s) => s.pos);
    let best = Infinity;
    for (let lag = Math.floor(pts.length * 0.25); lag < pts.length - 40; lag += 4) {
      let sum = 0;
      let n = 0;
      for (let i = 0; i + lag < pts.length; i += 3) {
        sum += dist(pts[i], pts[i + lag]);
        n++;
      }
      if (n > 8) best = Math.min(best, sum / n);
    }
    expect('an irregular walk never repeats itself', best > 60, `closest repeat ${best.toFixed(0)}u apart`);
  }
}

line('\n=== A direction change is instant, not a stand-still ===');
{
  // Rolling A into D must turn you around on the frame D goes down. Summing
  // the axis instead would cancel to zero for as long as both keys are held,
  // which is a quarter-second of standing still in the middle of every
  // direction change — the exact moment a diver catches you.
  const input = new InputSystem({
    bindings: WASD_BINDINGS,
    quickCast: true,
    activeSlots: new Set<AbilitySlot>(),
    scheme: 'wasd',
  });
  const down = (code: string) => (input as unknown as { press(c: string): void }).press(code);
  const up = (code: string) => (input as unknown as { release(c: string): void }).release(code);

  down('KeyA');
  const left = input.moveVector();
  down('KeyD');
  const rolled = input.moveVector();
  up('KeyD');
  const backToLeft = input.moveVector();
  up('KeyA');
  const stopped = input.moveVector();

  expect('A alone walks left', left.x === -1, `${left.x}`);
  expect('rolling A into D turns you right immediately', rolled.x === 1, `${rolled.x} (summing would give 0)`);
  expect('releasing D hands the axis straight back to A', backToLeft.x === -1, `${backToLeft.x}`);
  expect('releasing both stops you', stopped.x === 0 && stopped.y === 0, `${stopped.x},${stopped.y}`);

  // Diagonals stay unit length once the world normalises them.
  down('KeyW');
  down('KeyD');
  const diag = input.moveVector();
  const world = new World({ w: 1000, h: 1000 }, new Rng(9));
  const body = world.spawnPlayer({ x: 500, y: 500 });
  world.setMoveDir(body, diag.x, diag.y);
  const speedOf = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
  world.step(1 / 240);
  const diagSpeed = speedOf(body.vel);
  world.setMoveDir(body, 1, 0);
  world.step(1 / 240);
  const straightSpeed = speedOf(body.vel);
  expect(
    'a diagonal is exactly as fast as a straight line',
    Math.abs(diagSpeed - straightSpeed) < 0.001,
    `${diagSpeed.toFixed(2)} vs ${straightSpeed.toFixed(2)}`,
  );
}

line('\n=== The attack command: timing beats mashing ===');
{
  const cmd = runDrill('kite', 'wasdCommand', 0.45, 12345, 'wasd');
  const mash = runDrill('kite', 'wasdMash', 0.45, 12345, 'wasd');
  const rel = runDrill('kite', 'wasd', 0.45, 12345, 'wasd');
  line(
    `  commanded : attacks ${cmd.m.attacksCompleted}  late ${cmd.d.attackLatency.toFixed(0)}ms  early ${cmd.m.earlyCommands}/${cmd.m.attackCommands}  halt ${cmd.m.haltTime.toFixed(1)}s  moveEff ${pct(cmd.d.moveEfficiency)}  timing ${pct(cmd.d.attackTiming)}  perf ${pct(cmd.out.performance)}`,
  );
  line(
    `  mashing   : attacks ${mash.m.attacksCompleted}  late ${mash.d.attackLatency.toFixed(0)}ms  early ${mash.m.earlyCommands}/${mash.m.attackCommands}  halt ${mash.m.haltTime.toFixed(1)}s  moveEff ${pct(mash.d.moveEfficiency)}  timing ${pct(mash.d.attackTiming)}  perf ${pct(mash.out.performance)}`,
  );
  line(
    `  released  : attacks ${rel.m.attacksCompleted}  late ${rel.d.attackLatency.toFixed(0)}ms  moveEff ${pct(rel.d.moveEfficiency)}  timing ${pct(rel.d.attackTiming)}  perf ${pct(rel.out.performance)}`,
  );
  expect('a commanded shot is a real way to attack', cmd.m.attacksCompleted > 20, `${cmd.m.attacksCompleted}`);
  expect('timing the command beats mashing it', cmd.out.performance > mash.out.performance * 1.4, `${pct(cmd.out.performance)} vs ${pct(mash.out.performance)}`);
  expect('mashing buys nothing but standing still', mash.m.haltTime > 6 && mash.d.moveEfficiency < cmd.d.moveEfficiency, `halt ${mash.m.haltTime.toFixed(1)}s, moveEff ${pct(mash.d.moveEfficiency)} vs ${pct(cmd.d.moveEfficiency)}`);
  expect('a timed command wastes almost no commands', cmd.m.earlyCommands / Math.max(1, cmd.m.attackCommands) < 0.25, `${cmd.m.earlyCommands}/${cmd.m.attackCommands}`);
  expect('commanding and releasing land in the same band', Math.abs(cmd.out.performance - rel.out.performance) < 0.2, `${pct(cmd.out.performance)} vs ${pct(rel.out.performance)}`);
  expect('mashing is punished by the timing read', mash.d.attackTiming < cmd.d.attackTiming, `${pct(mash.d.attackTiming)} vs ${pct(cmd.d.attackTiming)}`);
}

line('\n=== Attack timing is measured, not guessed ===');
{
  // A player who takes every shot the instant it comes up, versus one who
  // waits half a cycle every time. Same attack count is impossible — that is
  // the point — but the *latency* is what has to separate them.
  const sharp = runDrill('kite', 'orbwalk', 0.35);
  const slow = runDrill('kite', 'standStill', 0.35);
  line(`  sharp     : late ${sharp.d.attackLatency.toFixed(0)}ms  punctuality ${pct(sharp.d.attackPunctuality)}  backswingUse ${pct(sharp.d.backswingUse)}  downtime ${pct(sharp.d.downtimeRate)}  timing ${pct(sharp.d.attackTiming)}`);
  line(`  standing  : late ${slow.d.attackLatency.toFixed(0)}ms  punctuality ${pct(slow.d.attackPunctuality)}  backswingUse ${pct(slow.d.backswingUse)}  downtime ${pct(slow.d.downtimeRate)}  timing ${pct(slow.d.attackTiming)}`);
  expect('an orbwalker takes its shots on time', sharp.d.attackPunctuality > 0.7, pct(sharp.d.attackPunctuality));
  expect('an orbwalker spends its backswing moving', sharp.d.backswingUse > 0.7, pct(sharp.d.backswingUse));
  expect('standing still throws the backswing away', slow.d.backswingUse < 0.35, pct(slow.d.backswingUse));
  expect('the timing read separates the two', sharp.d.attackTiming > slow.d.attackTiming + 0.15, `${pct(sharp.d.attackTiming)} vs ${pct(slow.d.attackTiming)}`);
}

line('\n=== An attack command plants the feet, and pays for being early ===');
{
  const world = new World({ w: 2000, h: 2000 }, new Rng(3));
  const p = world.spawnPlayer({ x: 500, y: 500 });
  p.directControl = true;
  const e = world.spawnActor({ pos: { x: 900, y: 500 }, team: 'enemy' });
  world.issueAttackHere(p, e.id);
  world.setMoveDir(p, 0, -1);

  // Ready: the command is free and the shot leaves immediately.
  const freeCost = world.requestFire(p);
  world.step(1 / 240);
  expect('a command on the tick costs nothing', freeCost === 0 && p.phase === 'windup', `cost ${freeCost}, phase ${p.phase}`);

  // Mid-cooldown: the command is refused, and the champion stands still for it.
  for (let i = 0; i < 240 && p.phase !== 'idle'; i++) world.step(1 / 240);
  const before = { ...p.pos };
  const earlyCost = world.requestFire(p);
  for (let i = 0; i < 24; i++) world.step(1 / 240);
  const travelled = dist(before, p.pos);
  expect('an early command costs real distance', earlyCost > 0.2 && travelled < 4, `cost ${earlyCost.toFixed(2)}, moved ${travelled.toFixed(1)}u`);

  // And the halt is bounded: it never swallows a whole cooldown.
  for (let i = 0; i < 240 && (p.fireRequest ?? 0) > 0; i++) world.step(1 / 240);
  expect('the halt is bounded', (p.fireRequest ?? 0) === 0, `${p.fireRequest}`);
}

line('\n=== A held direction obeys the windup law, exactly as a click does ===');
{
  const world = new World({ w: 1000, h: 1000 }, new Rng(1));
  const p = world.spawnPlayer({ x: 500, y: 500 });
  const e = world.spawnActor({ pos: { x: 700, y: 500 }, team: 'enemy' });
  world.beginAttack(p, e);
  world.clearEvents();
  world.setMoveDir(p, 1, 0);
  const cancelled = world.events.some((ev) => ev.type === 'attackCancel');
  expect('a direction taken mid-windup cancels the attack', cancelled && p.phase === 'idle', p.phase);

  // And the backswing is free, which is the half that makes orbwalking work.
  world.setMoveDir(p, 0, 0);
  world.beginAttack(p, e);
  for (let i = 0; i < 400 && p.phase !== 'backswing'; i++) world.step(1 / 240);
  world.clearEvents();
  world.setMoveDir(p, 1, 0);
  expect(
    'a direction taken in the backswing is free',
    p.phase === 'backswing' && !world.events.some((ev) => ev.type === 'attackCancel'),
    p.phase,
  );
}

line('\n=== CONDEMN: a wall behind them is a stun; open ground is not ===');
{
  const world = new World({ w: 2000, h: 2000 }, new Rng(2));
  world.walls = [{ x: 1200, y: 1000, w: 60, h: 600 }];
  const from = { x: 900, y: 1000 };
  const intoWall = world.terrainAlong({ x: 1050, y: 1000 }, { x: 1, y: 0 }, 430, 30);
  const intoAir = world.terrainAlong({ x: 1050, y: 1000 }, { x: -1, y: 0 }, 430, 30);
  void from;
  expect('terrain in the path is found', intoWall.hit && intoWall.distance < 130, `${intoWall.distance.toFixed(0)}u hit=${intoWall.hit}`);
  expect('open ground is not a wall', !intoAir.hit, `${intoAir.distance.toFixed(0)}u`);
  const pinned = world.terrainAlong({ x: 1900, y: 1000 }, { x: 1, y: 0 }, 430, 30);
  expect('the arena edge counts as terrain', pinned.hit, `${pinned.distance.toFixed(0)}u`);
}

line('\n=== VAYNE: each stage rewards playing it the way it is taught ===');
{
  const tumble = runDrill('vayneTumble', 'vayneTumble', 0.35);
  const tumbleIdle = runDrill('vayneTumble', 'idle', 0.35);
  line(`  tumble  : rhythm ${pct(tumble.out.keyMetrics[0].value)}  used ${tumble.out.keyMetrics[1].value}  thrown ${tumble.out.keyMetrics[2].value}  orbwalk ${pct(tumble.d.orbwalkEfficiency)}  perf ${pct(tumble.out.performance)}`);
  expect('tumbling in the backswing scores well', tumble.out.performance > 0.55, pct(tumble.out.performance));
  expect('a clean run throws away almost no windups', tumble.out.keyMetrics[2].value <= 2, `${tumble.out.keyMetrics[2].value}`);
  expect('tumble beats doing nothing', tumble.out.performance > tumbleIdle.out.performance * 2, `${pct(tumble.out.performance)} vs ${pct(tumbleIdle.out.performance)}`);

  const bolts = runDrill('vayneBolts', 'vayneBolts', 0.35);
  const boltsSwitch = runDrill('vayneBolts', 'orbwalk', 0.35);
  line(`  bolts   : efficiency ${pct(bolts.out.keyMetrics[0].value)}  procs ${bolts.out.keyMetrics[1].value}  dropped ${bolts.out.keyMetrics[2].value}  perf ${pct(bolts.out.performance)}`);
  line(`  switcher: efficiency ${pct(boltsSwitch.out.keyMetrics[0].value)}  procs ${boltsSwitch.out.keyMetrics[1].value}  dropped ${boltsSwitch.out.keyMetrics[2].value}  perf ${pct(boltsSwitch.out.performance)}`);
  expect('finishing stacks scores well', bolts.out.performance > 0.55, pct(bolts.out.performance));
  expect('finishing stacks beats target-hopping', bolts.out.performance > boltsSwitch.out.performance, `${pct(bolts.out.performance)} vs ${pct(boltsSwitch.out.performance)}`);
  expect('a disciplined run drops few stacks', bolts.out.keyMetrics[2].value <= boltsSwitch.out.keyMetrics[2].value, `${bolts.out.keyMetrics[2].value} vs ${boltsSwitch.out.keyMetrics[2].value}`);

  const condemn = runDrill('vayneCondemn', 'vayneCondemn', 0.35);
  line(`  condemn : wallRate ${pct(condemn.out.keyMetrics[0].value)}  stuns ${condemn.out.keyMetrics[1].value}  missed ${condemn.out.keyMetrics[3].value}  perf ${pct(condemn.out.performance)}`);
  expect('condemning into terrain scores well', condemn.out.performance > 0.55, pct(condemn.out.performance));
  expect('a wall-aware player actually lands wall stuns', condemn.out.keyMetrics[1].value >= 3, `${condemn.out.keyMetrics[1].value}`);

  const hunt = runDrill('vayneHunt', 'vayneKit', 0.3);
  line(`  hunt    : kit ${pct(hunt.out.keyMetrics[1].value)}  kills ${hunt.out.keyMetrics[2].value}  procs ${hunt.out.keyMetrics[3].value}  hp ${pct(hunt.d.hpRetained)}  perf ${pct(hunt.out.performance)}`);
  expect('the full kit wins the hunt', hunt.m.kills >= 1, `${hunt.m.kills} kills`);
  expect('the hunt rewards playing the champion', hunt.out.performance > 0.45, pct(hunt.out.performance));
}

line('\n=== Honesty: the Vayne path cannot be passed by presence ===');
for (const id of ['vayneTumble', 'vayneBolts', 'vayneCondemn', 'vayneHunt'] as DrillId[]) {
  const r = runDrill(id, 'idle', 0.4);
  line(`  ${id.padEnd(13)} idle perf ${pct(r.out.performance)}  score ${r.out.score}`);
  expect(`${id} cannot be passed by doing nothing`, r.out.performance < 0.3, pct(r.out.performance));
}

line('\n=== THE LAB: every mode pays for correct play and nothing else ===');
{
  const cases: [DrillId, Policy][] = APM_DRILL_IDS.map((id) => [id as DrillId, 'lab' as Policy]);
  // One policy plays all thirteen, off each drill's own statement of what
  // correct play is — so a new mode is covered the moment it exists, and a
  // mode that cannot say what correct play is does not ship.
  expect(
    'every lab mode is covered by these checks',
    cases.length === APM_DRILL_IDS.length,
    `${cases.length} cases for ${APM_DRILL_IDS.length} modes`,
  );
  for (const [id, policy] of cases) {
    const good = runDrill(id, policy, 0.35);
    const idle = runDrill(id, 'idle', 0.35);
    const apm = good.out.keyMetrics.find((k) => k.id === 'apm')?.value ?? 0;
    const finite = Number.isFinite(good.out.performance) && Number.isFinite(good.out.score);
    line(
      `  ${id.padEnd(13)} played ${pct(good.out.performance)} @ ${Math.round(apm)} APM  score ${good.out.score}` +
        `   idle ${pct(idle.out.performance)} score ${idle.out.score}`,
    );
    const inner = (good as unknown as { session: { drill: unknown } }).session.drill as unknown as {
      hits: number; fumbles: number; strays: number; expiries: number; bestChain: number; pushes?: number;
    };
    line(
      `      hits ${inner.hits}  fumbles ${inner.fumbles}  strays ${inner.strays}  expiries ${inner.expiries}` +
        `  chain ${inner.bestChain}${inner.pushes === undefined ? '' : `  pushes ${inner.pushes}`}  correct/min ${Math.round(good.out.keyMetrics.find((k) => k.id === 'correctApm')?.value ?? 0)}`,
    );
    expect(`${id} produces finite, in-range results`, finite && good.out.performance >= 0 && good.out.performance <= 1, `perf=${good.out.performance}`);
    expect(`${id} rewards playing it`, good.out.performance > 0.4, pct(good.out.performance));
    expect(`${id} cannot be passed by doing nothing`, idle.out.performance < 0.3, pct(idle.out.performance));
    expect(`${id} counts actions per minute`, apm > 30, `${Math.round(apm)} APM`);
  }
}

line('\n=== THE LAB: speed alone is not a score ===');
{
  // Mashing the field at random is faster than playing it. It must not pay.
  const played = runDrill('apmField', 'lab', 0.35);
  const mashed = runDrill('apmField', 'spam', 0.35);
  const mashedApm = mashed.out.keyMetrics.find((k) => k.id === 'apm')?.value ?? 0;
  const playedApm = played.out.keyMetrics.find((k) => k.id === 'apm')?.value ?? 0;
  line(`  played: ${pct(played.out.performance)} @ ${Math.round(playedApm)} APM  score ${played.out.score}`);
  line(`  mashed: ${pct(mashed.out.performance)} @ ${Math.round(mashedApm)} APM  score ${mashed.out.score}`);
  expect('clicking at nothing scores below playing', mashed.out.performance < played.out.performance * 0.6, pct(mashed.out.performance));
  expect('clicking at nothing scores near zero', mashed.out.score < played.out.score * 0.35, `${mashed.out.score} vs ${played.out.score}`);
}

line('\n=== THE LAB: the flow ladder is what the score is made of ===');
{
  const r = runDrill('apmSequence', 'lab', 0.35);
  const chain = r.out.keyMetrics.find((k) => k.id === 'chain')?.value ?? 0;
  line(`  best chain ${chain}  perfects and multiplier folded into score ${r.out.score}`);
  expect('a clean run actually chains', chain >= 13, `${chain}`);
}

line('\n=== THE LAB: the movement command, driven with the keys ===');
{
  // VECTOR counts commands, and under WASD a command is a key going down or a
  // heading changing rather than a click on the ground. If that is not counted
  // the whole mode silently becomes a click-scheme feature.
  const keys = runDrill('apmVector', 'labWasd', 0.35, 12345, 'wasd');
  const clicks = runDrill('apmVector', 'lab', 0.35, 12345);
  const idle = runDrill('apmVector', 'idle', 0.35, 12345, 'wasd');
  const keyApm = keys.out.keyMetrics.find((k) => k.id === 'apm')?.value ?? 0;
  const clickApm = clicks.out.keyMetrics.find((k) => k.id === 'apm')?.value ?? 0;
  line(`  wasd   : ${pct(keys.out.performance)} @ ${Math.round(keyApm)} APM  score ${keys.out.score}`);
  line(`  clicks : ${pct(clicks.out.performance)} @ ${Math.round(clickApm)} APM  score ${clicks.out.score}`);
  line(`  wasd idle: ${pct(idle.out.performance)}`);
  expect('WASD movement is counted as APM', keyApm > 30, `${Math.round(keyApm)} APM`);
  expect('WASD heading calls reward playing them', keys.out.performance > 0.4, pct(keys.out.performance));
  expect('the click scheme scores the same mode', clicks.out.performance > 0.4, pct(clicks.out.performance));
  expect('WASD idling still scores nothing', idle.out.performance < 0.3, pct(idle.out.performance));
}

line('\n=== THE LAB: restraint is paid for, and is not a rate ===');
{
  // GO / NO-GO is the mode with a fourth verb behind it. A player who holds
  // the barred pads has to score well; a player who presses everything has to
  // be fast and score badly, which is the whole reason hold() is not hit().
  const held = runDrill('apmGate', 'lab', 0.4);
  const mashed = runDrill('apmGate', 'spam', 0.4);
  const heldApm = held.out.keyMetrics.find((k) => k.id === 'apm')?.value ?? 0;
  const mashedApm = mashed.out.keyMetrics.find((k) => k.id === 'apm')?.value ?? 0;
  const holds = held.out.keyMetrics.find((k) => k.id === 'held')?.value ?? 0;
  line(`  held  : ${pct(held.out.performance)} @ ${Math.round(heldApm)} APM  ${holds} correctly held  score ${held.out.score}`);
  line(`  mashed: ${pct(mashed.out.performance)} @ ${Math.round(mashedApm)} APM  score ${mashed.out.score}`);
  expect('withholding is recorded', holds > 3, `${holds} holds`);
  expect('pressing everything scores far below holding', mashed.out.performance < held.out.performance * 0.6, pct(mashed.out.performance));
  expect('a hold is not an action', heldApm < 400, `${Math.round(heldApm)} APM`);
}

line('\n=== APM LADDER: ten explicit levels, and nothing moves on its own ===');
{
  expect(
    'every mode is on the ladder exactly once',
    APM_MODES.length === APM_DRILL_IDS.length &&
      APM_DRILL_IDS.every((id) => APM_MODES.filter((m) => m.id === id).length === 1),
    `${APM_MODES.length} modes for ${APM_DRILL_IDS.length} drills`,
  );

  const rungs = Array.from({ length: APM_LEVELS }, (_, i) => levelDifficulty(i + 1));
  expect(
    'a rung is harder than the one below it',
    rungs.every((d, i) => i === 0 || d > rungs[i - 1]),
    rungs.map((d) => Math.round(d * 100)).join(' '),
  );
  expect(
    'the ladder spans the difficulty range',
    rungs[0] < 0.12 && rungs[APM_LEVELS - 1] > 0.95,
    `${Math.round(rungs[0] * 100)} .. ${Math.round(rungs[APM_LEVELS - 1] * 100)}`,
  );

  // A fresh ladder starts closed above rung one, and only a cleared run opens
  // the next. This is the property the whole section rests on: a level is a
  // place you went, not a number the app inferred about you.
  const p = emptyApmProgress();
  expect('a fresh ladder opens on level 1 only', p.modes.apmPulse.unlocked === 1, `${p.modes.apmPulse.unlocked}`);

  const failed = applyApmRun(p, {
    drill: 'apmPulse',
    level: 1,
    performance: CLEAR_AT - 0.05,
    score: 900,
    apm: 120,
    endurance: false,
  });
  expect('a run short of the gate opens nothing', !failed.cleared && p.modes.apmPulse.unlocked === 1, `${p.modes.apmPulse.unlocked}`);

  const cleared = applyApmRun(p, {
    drill: 'apmPulse',
    level: 1,
    performance: CLEAR_AT + 0.02,
    score: 1200,
    apm: 140,
    endurance: false,
  });
  expect('clearing a rung opens the next one', cleared.unlockedTo === 2, `${cleared.unlockedTo}`);

  const taken = applyApmRun(p, {
    drill: 'apmPulse',
    level: 2,
    performance: STAR_AT[2] + 0.02,
    score: 2400,
    apm: 190,
    endurance: false,
  });
  expect('taking a rung outright opens two', taken.skipped && taken.unlockedTo === 4, `${taken.unlockedTo}`);
  expect('three stars need the top mark', taken.starsAfter === 3, `${taken.starsAfter}`);

  // A worse run is a warm-up: it counts, and it takes nothing away.
  const before = p.modes.apmPulse.levels[1].best;
  const warmup = applyApmRun(p, {
    drill: 'apmPulse',
    level: 2,
    performance: 0.3,
    score: 300,
    apm: 60,
    endurance: false,
  });
  expect(
    'a worse run cannot lower a record',
    p.modes.apmPulse.levels[1].best === before && warmup.starsAfter === 3,
    `${Math.round(p.modes.apmPulse.levels[1].best * 100)}%`,
  );
  expect('but it is still counted as a run', p.modes.apmPulse.levels[1].runs === 2, `${p.modes.apmPulse.levels[1].runs}`);

  // An endurance run is longer, so it may set a rate record and never a score.
  const scoreBefore = p.modes.apmPulse.levels[1].bestScore;
  applyApmRun(p, {
    drill: 'apmPulse',
    level: 2,
    performance: 0.9,
    score: scoreBefore * 4,
    apm: 260,
    endurance: true,
  });
  expect(
    'an endurance run sets no score record',
    p.modes.apmPulse.levels[1].bestScore === scoreBefore,
    `${p.modes.apmPulse.levels[1].bestScore} vs ${scoreBefore * 4}`,
  );
  expect('an endurance run may still set a rate record', p.modes.apmPulse.levels[1].bestApm === 260, `${p.modes.apmPulse.levels[1].bestApm}`);

  expect('cleared-through reads the highest cleared rung', clearedThrough(p.modes.apmPulse) === 2, `${clearedThrough(p.modes.apmPulse)}`);
  expect(
    'the ladder points at the first rung that is not properly taken',
    recommendedLevel(p, 'apmPulse') === 3,
    `${recommendedLevel(p, 'apmPulse')}`,
  );

  // Mastery weights the top of the ladder, so the same stars are worth more
  // higher up. Without that, thirty stars at the bottom would read as a
  // finished mode.
  const low = emptyApmProgress();
  const high = emptyApmProgress();
  low.modes.apmPulse.levels[0].best = 1;
  high.modes.apmPulse.levels[APM_LEVELS - 1].best = 1;
  expect(
    'three stars high on the ladder are worth more than three stars low',
    modeMastery(high.modes.apmPulse) > modeMastery(low.modes.apmPulse) * 5,
    `${modeMastery(high.modes.apmPulse).toFixed(1)} vs ${modeMastery(low.modes.apmPulse).toFixed(1)}`,
  );
  expect(
    'a full ladder is full mastery',
    Math.round(
      modeMastery({
        levels: Array.from({ length: APM_LEVELS }, () => ({ runs: 1, best: 1, bestScore: 1, bestApm: 1 })),
        unlocked: APM_LEVELS,
        lastLevel: APM_LEVELS,
        runs: APM_LEVELS,
      }),
    ) === 100,
    'weighted stars',
  );
  expect(
    'stars are the gate, then two harder marks',
    levelStars({ runs: 1, best: CLEAR_AT, bestScore: 0, bestApm: 0 }) === 1 &&
      levelStars({ runs: 1, best: STAR_AT[1], bestScore: 0, bestApm: 0 }) === 2 &&
      levelStars({ runs: 1, best: CLEAR_AT - 0.01, bestScore: 0, bestApm: 0 }) === 0,
    `${Math.round(STAR_AT[0] * 100)}/${Math.round(STAR_AT[1] * 100)}/${Math.round(STAR_AT[2] * 100)}`,
  );

  // Calibration opens rungs; it never awards one.
  const seeded = emptyApmProgress();
  const opened = seedApmLadder(seeded, 2400);
  expect('calibration opens the ladder without scoring it', opened > 1 && seeded.mastery === 0, `level ${opened}, mastery ${seeded.mastery}`);
  expect(
    'and it opens the same rung on every mode',
    APM_DRILL_IDS.every((id) => seeded.modes[id].unlocked === opened),
    `${opened}`,
  );
  const unplaced = emptyApmProgress();
  expect('an unrated player starts at the bottom', seedApmLadder(unplaced, 0) === 1, 'level 1');
}

line('\n=== The Vayne path, driven with the keys ===');
{
  const kitOfRun = (r: { drill: unknown }) => kitOf(r.drill)!;

  const mouse = runDrill('vayneTumble', 'vayneTumble', 0.35);
  const keys = runDrill('vayneTumble', 'vayneWasd', 0.35, 12345, 'wasd');
  const keysIdle = runDrill('vayneTumble', 'idle', 0.35, 12345, 'wasd');
  const kMouse = kitOfRun(mouse).stats;
  const kKeys = kitOfRun(keys).stats;

  line(
    `  mouse: rhythm ${pct(kMouse.tumblesClean / Math.max(1, kMouse.tumbles))}  tumbles ${kMouse.tumbles}  perf ${pct(mouse.out.performance)}`,
  );
  line(
    `  keys : rhythm ${pct(kKeys.tumblesClean / Math.max(1, kKeys.tumbles))}  tumbles ${kKeys.tumbles}  trigger ${Math.round(keys.d.triggerDelay)}ms  perf ${pct(keys.out.performance)}`,
  );
  expect('WASD Vayne rewards playing her properly', keys.out.performance > 0.55, pct(keys.out.performance));
  expect('WASD Vayne cannot be passed by doing nothing', keysIdle.out.performance < 0.3, pct(keysIdle.out.performance));
  // The promise the whole scheme rests on: a run means the same thing under
  // either hand. If this band ever widens, one of the two schemes has quietly
  // become the easy one.
  expect(
    'the same rhythm scores the same under either hand',
    Math.abs(keys.out.performance - mouse.out.performance) < 0.25,
    `${pct(keys.out.performance)} vs ${pct(mouse.out.performance)}`,
  );

  // Trigger discipline: the mistake only WASD can make, and the proof that it
  // is being watched. `wasdHold` never lets go of the keys at all.
  const stuck = runDrill('vayneTumble', 'wasdHold', 0.35, 12345, 'wasd');
  line(
    `  trigger: clean ${Math.round(keys.d.triggerDelay)}ms (${pct(keys.d.triggerDiscipline)})  never released ${Math.round(stuck.d.triggerDelay)}ms (${pct(stuck.d.triggerDiscipline)})`,
  );
  expect('a clean release scores as trigger discipline', keys.d.triggerDiscipline > 0.8, pct(keys.d.triggerDiscipline));
  expect('never releasing the keys is measured as held fire', stuck.m.heldFire > 3, `${stuck.m.heldFire.toFixed(1)}s`);
  expect('never releasing the keys destroys trigger discipline', stuck.d.triggerDiscipline < 0.2, pct(stuck.d.triggerDiscipline));

  // The aiming rule. Identical inputs, identical seed — the only difference is
  // which hand the dash listens to, and the cursor is on the pursuer
  // throughout. Under `hands` the tumbles leave; under `cursor` they arrive.
  const cursorAim = runDrill('vayneTumble', 'vayneWasd', 0.35, 12345, 'wasd', 'cursor');
  const kCursor = kitOfRun(cursorAim).stats;
  const inwardHands = kKeys.tumblesInward / Math.max(1, kKeys.tumbles);
  const inwardCursor = kCursor.tumblesInward / Math.max(1, kCursor.tumbles);
  line(`  aim hands : ${kKeys.tumblesInward} of ${kKeys.tumbles} tumbles went toward the pursuer (${pct(inwardHands)})`);
  line(`  aim cursor: ${kCursor.tumblesInward} of ${kCursor.tumbles} tumbles went toward the pursuer (${pct(inwardCursor)})`);
  expect('the keys aim the tumble away from the fight', inwardHands < 0.1, pct(inwardHands));
  expect('the cursor aim sends the same press into the fight', inwardCursor > 0.8, pct(inwardCursor));
}

line('\n=== A key taken through the windup costs the attack, and says so ===');
{
  // The click scheme already asserts this for a click. The point here is that
  // the *coaching* can tell the two apart: the world sees one cancel either
  // way, and only the session knows which hand made it.
  const input = new FakeInput();
  const session = new Session(
    {
      duration: 60,
      arena: arenaFor('vayneTumble'),
      seed: 4242,
      difficulty: 0.35,
      abilities: DRILLS.vayneTumble.abilities,
      scheme: 'wasd',
    },
    input as unknown as InputSystem,
    fakeRenderer,
  );
  session.attachDrill(createDrill('vayneTumble', session));
  session.countdown = 0;

  // One step to leave the countdown — orders are ignored until the run is
  // actually running — then park the pursuer in range and take the target.
  session.step(SIM_DT);
  const p = session.world.player!;
  const foe = session.world.actors.find((a) => a.alive && a.team === 'enemy')!;
  foe.pos.x = p.pos.x + 300;
  foe.pos.y = p.pos.y;
  input.push({ kind: 'move', x: foe.pos.x, y: foe.pos.y, t: 0 });
  let guard = 0;
  while (p.phase !== 'windup' && guard++ < 4000) {
    foe.pos.x = p.pos.x + 300;
    foe.pos.y = p.pos.y;
    session.step(SIM_DT);
  }
  expect('an attack starts with the keys up', p.phase === 'windup', p.phase);

  const before = session.metrics.m.windupBreaks;
  input.dir = { x: 0, y: -1 };
  session.step(SIM_DT);
  expect('a direction taken in the windup cancels the attack', p.phase !== 'windup', p.phase);
  expect(
    'and is counted as a windup broken by the keys',
    session.metrics.m.windupBreaks === before + 1,
    `${session.metrics.m.windupBreaks}`,
  );
}

line('\n=== Losing focus pauses a run, and never un-pauses one ===');
{
  // A gesture-opened background tab can fire window blur *and*
  // visibilitychange for one switch, so the pause has to be idempotent —
  // and it must never resume a run the player paused deliberately.
  const input = new FakeInput();
  const session = new Session(
    { duration: 60, arena: arenaFor('kite'), seed: 4242, difficulty: 0.4, abilities: DRILLS.kite.abilities },
    input as unknown as InputSystem,
    fakeRenderer,
  );
  session.attachDrill(createDrill('kite', session));
  session.countdown = 0;
  session.step(SIM_DT);
  expect('a run starts out running', session.phase === 'running', session.phase);

  input.push({ kind: 'blur', t: 0 });
  session.step(SIM_DT);
  expect('losing focus pauses the run', session.phase === 'paused', session.phase);

  input.push({ kind: 'blur', t: 0 });
  session.step(SIM_DT);
  expect('a second blur does not resume it', session.phase === 'paused', session.phase);

  input.push({ kind: 'pause', t: 0 });
  session.step(SIM_DT);
  expect('Esc still resumes', session.phase === 'running', session.phase);

  input.push({ kind: 'pause', t: 0 });
  session.step(SIM_DT);
  input.push({ kind: 'blur', t: 0 });
  session.step(SIM_DT);
  expect('blur cannot resume a deliberate pause', session.phase === 'paused', session.phase);
}

line(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
void GameLoop;
process.exit(failures === 0 ? 0 : 1);
