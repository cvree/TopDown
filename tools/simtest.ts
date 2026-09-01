/**
 * Headless verification of the simulation and scoring.
 *
 * This drives the real Session/World/drill code with synthetic input policies
 * and asserts the thing the whole product rests on: that playing *correctly*
 * scores well and that spamming does not. It runs without a browser.
 */
import { GameLoop, SIM_DT } from '../src/engine/loop';
import { Session } from '../src/engine/session';
import { createDrill, arenaFor } from '../src/drills';
import { DRILLS, type DrillId } from '../src/drills/catalog';
import { derive } from '../src/engine/metrics';
import type { InputEventKind, InputSystem } from '../src/engine/input';
import type { Renderer } from '../src/engine/renderer';
import { dist, norm } from '../src/engine/math';

type Policy = 'orbwalk' | 'spam' | 'idle' | 'standStill' | 'dodge' | 'aim' | 'hold' | 'nodes' | 'priority' | 'sequence';

class FakeInput {
  cursor = { x: 0, y: 0 };
  queue: InputEventKind[] = [];
  totalClicks = 0;
  drain(): InputEventKind[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
  push(e: InputEventKind): void {
    this.queue.push(e);
  }
}

const fakeRenderer = {
  screenToWorld: (x: number, y: number) => ({ x, y }),
} as unknown as Renderer;

const runDrill = (id: DrillId, policy: Policy, difficulty: number, seed = 12345) => {
  const meta = DRILLS[id];
  const bounds = arenaFor(id);
  const input = new FakeInput();
  const session = new Session(
    { duration: meta.duration > 0 ? meta.duration : 60, arena: bounds, seed, difficulty, abilities: meta.abilities },
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
          case 'idle':
            reactTimer = 1;
            break;
        }
      }
      if (policy !== 'aim') session.cursorWorld = { x: p.pos.x, y: p.pos.y };
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

line('\n=== Every drill rewards playing it correctly ===');
for (const [id, policy] of [
  ['movement', 'nodes'],
  ['targetswitch', 'priority'],
  ['combos', 'sequence'],
  ['lasthit', 'orbwalk'],
] as [DrillId, Policy][]) {
  const r = runDrill(id, policy, 0.35);
  line(`  ${id.padEnd(13)} correct play perf ${pct(r.out.performance)}  score ${r.out.score}  ${r.out.keyMetrics.slice(0, 2).map((k) => `${k.label} ${k.value.toFixed(2)}`).join('  ')}`);
  expect(`${id} rewards correct play`, r.out.performance > 0.55, pct(r.out.performance));
}

line('\n=== Honesty: doing nothing scores near zero everywhere ===');
for (const id of ['movement', 'aim', 'kite', 'spacing', 'lasthit', 'targetswitch', 'combos'] as DrillId[]) {
  const r = runDrill(id, 'idle', 0.4);
  line(`  ${id.padEnd(13)} idle perf ${pct(r.out.performance)}  score ${r.out.score}`);
  expect(`${id} cannot be passed by doing nothing`, r.out.performance < 0.3, pct(r.out.performance));
}

line('\n=== SPACING / MOVEMENT / LAST HIT / TARGET SWITCH / COMBOS run clean ===');
for (const id of ['spacing', 'movement', 'lasthit', 'targetswitch', 'combos'] as DrillId[]) {
  const r = runDrill(id, id === 'movement' ? 'orbwalk' : 'orbwalk', 0.4);
  const finite = Number.isFinite(r.out.performance) && Number.isFinite(r.out.score);
  line(`  ${id.padEnd(13)} perf ${pct(r.out.performance)}  score ${r.out.score}  metrics ${r.out.keyMetrics.length}`);
  expect(`${id} produces finite, in-range results`, finite && r.out.performance >= 0 && r.out.performance <= 1, `perf=${r.out.performance}`);
}

line(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
void GameLoop;
process.exit(failures === 0 ? 0 : 1);
