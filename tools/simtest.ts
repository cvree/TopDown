/**
 * Headless verification of the simulation and scoring.
 *
 * This drives the real Session/World/drill code with synthetic input policies
 * and asserts the thing the whole product rests on: that playing *correctly*
 * scores well and that spamming does not. It runs without a browser.
 */
import { GameLoop, SIM_DT } from '../src/engine/loop';
import { Session, type ViewProjection } from '../src/engine/session';
import { createDrill, arenaFor } from '../src/drills';
import { DRILLS, type DrillId } from '../src/drills/catalog';
import { derive } from '../src/engine/metrics';
import type { InputEventKind, InputSystem, MovementScheme } from '../src/engine/input';
import { dist, norm } from '../src/engine/math';
import type { VayneKit } from '../src/engine/vayne';
import { VAYNE_STATS } from '../src/engine/vayne';
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
  | 'wasd'
  | 'wasdHold'
  | 'vayneTumble'
  | 'vayneBolts'
  | 'vayneCondemn'
  | 'vayneKit';

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

const runDrill = (id: DrillId, policy: Policy, difficulty: number, seed = 12345, scheme: MovementScheme = 'click') => {
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
          case 'orbwalk': {
            // A competent orbwalker: attack the instant the timer is up, then
            // spend the whole free window circling at the edge of range —
            // tangentially, with a radial correction, steering off the walls
            // rather than running into them.
            reactTimer = 0.05;
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
            // Disciplined spacing: attack when ready, otherwise sit at the
            // outer edge of your own range and match their movement.
            reactTimer = 0.05;
            if (!target) break;
            const d = dist(p.pos, target.pos);
            const want = p.attack.range * 0.9 + target.radius;
            if (p.attackCd <= 0.001 && p.phase !== 'windup' && d - target.radius <= p.attack.range) {
              input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
              break;
            }
            if (p.phase === 'windup') break;
            if (Math.abs(d - want) < 26) break;
            const radial = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
            const sign = d < want ? 1 : -1;
            const gx = p.pos.x + radial.x * sign * 300;
            const gy = p.pos.y + radial.y * sign * 300;
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
          case 'idle':
            reactTimer = 1;
            break;
        }
      }
      if (policy !== 'aim' && policy !== 'vayneBolts' && policy !== 'vayneCondemn') {
        session.cursorWorld = { x: p.pos.x, y: p.pos.y };
      }
    }

    session.step(SIM_DT);
    t += SIM_DT;
  }

  const out = drill.outcome();
  const m = session.metrics.m;
  const d = derive(m, session.world.player?.maxHp ?? 720);
  return { out, m, d, session };
};

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
line(`  holding : inBand ${pct(spaceGood.out.keyMetrics[0].value)}  spacingErr ${spaceGood.d.avgSpacingError.toFixed(0)}u  hp ${pct(spaceGood.d.hpRetained)}  perf ${pct(spaceGood.out.performance)}`);
line(`  idle    : inBand ${pct(spaceIdle.out.keyMetrics[0].value)}  perf ${pct(spaceIdle.out.performance)}`);
expect('holding the band scores well', spaceGood.out.performance > 0.6, pct(spaceGood.out.performance));
expect('holding beats drifting', spaceGood.out.performance > spaceIdle.out.performance * 1.8, `${pct(spaceGood.out.performance)} vs ${pct(spaceIdle.out.performance)}`);

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
  ['lasthit', 'orbwalk'],
  ['skillshot', 'lead'],
] as [DrillId, Policy][]) {
  const r = runDrill(id, policy, 0.35);
  line(`  ${id.padEnd(13)} correct play perf ${pct(r.out.performance)}  score ${r.out.score}  ${r.out.keyMetrics.slice(0, 2).map((k) => `${k.label} ${k.value.toFixed(2)}`).join('  ')}`);
  expect(`${id} rewards correct play`, r.out.performance > 0.55, pct(r.out.performance));
}

line('\n=== Honesty: doing nothing scores near zero everywhere ===');
for (const id of ['movement', 'aim', 'skillshot', 'kite', 'spacing', 'lasthit', 'targetswitch', 'combos'] as DrillId[]) {
  const r = runDrill(id, 'idle', 0.4);
  line(`  ${id.padEnd(13)} idle perf ${pct(r.out.performance)}  score ${r.out.score}`);
  expect(`${id} cannot be passed by doing nothing`, r.out.performance < 0.3, pct(r.out.performance));
}

line('\n=== SPACING / MOVEMENT / LAST HIT / TARGET SWITCH / COMBOS / SKILLSHOT run clean ===');
for (const id of ['spacing', 'movement', 'lasthit', 'targetswitch', 'combos', 'skillshot'] as DrillId[]) {
  const r = runDrill(id, id === 'skillshot' ? 'lead' : 'orbwalk', 0.4);
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
    'never releasing the keys never attacks',
    wasdHold.m.attacksCompleted === 0 && wasdGood.out.performance > wasdHold.out.performance * 1.5,
    `${wasdHold.m.attacksCompleted} attacks, perf ${pct(wasdHold.out.performance)}`,
  );
  expect('WASD cannot be passed by doing nothing', wasdIdle.out.performance < 0.3, pct(wasdIdle.out.performance));
  expect(
    'WASD and click orbwalking land in the same band',
    Math.abs(wasdGood.out.performance - kiteGood.out.performance) < 0.25,
    `${pct(wasdGood.out.performance)} vs ${pct(kiteGood.out.performance)}`,
  );
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
