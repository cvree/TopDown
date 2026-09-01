import { SIM_DT } from '../src/engine/loop';
import { Session } from '../src/engine/session';
import { createDrill, arenaFor } from '../src/drills';
import { DRILLS, type DrillId } from '../src/drills/catalog';
import { derive } from '../src/engine/metrics';
import type { InputEventKind, InputSystem } from '../src/engine/input';
import type { Renderer } from '../src/engine/renderer';
import { dist, norm } from '../src/engine/math';

(globalThis as unknown as { window: unknown }).window = { setTimeout: (f: () => void, m: number) => setTimeout(f, m) };
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ getContext: () => null }) };

class FakeInput { cursor = { x: 0, y: 0 }; queue: InputEventKind[] = []; totalClicks = 0;
  drain() { const q = this.queue; this.queue = []; return q; } push(e: InputEventKind) { this.queue.push(e); } }
const fakeRenderer = { screenToWorld: (x: number, y: number) => ({ x, y }) } as unknown as Renderer;

const id = (process.argv[2] ?? 'kite') as DrillId;
const difficulty = Number(process.argv[3] ?? 0.45);
const meta = DRILLS[id];
const bounds = arenaFor(id);
const input = new FakeInput();
const session = new Session(
  { duration: meta.duration > 0 ? meta.duration : 60, arena: bounds, seed: 12345, difficulty, abilities: meta.abilities },
  input as unknown as InputSystem, fakeRenderer,
);
const drill = createDrill(id, session);
session.attachDrill(drill);
session.countdown = 0;
let t = 0, reactTimer = 0, orbitDir = 1, lastLog = 0;

while (session.phase !== 'ended' && t < (meta.duration > 0 ? meta.duration : 60) + 2) {
  const p = session.world.player;
  if (p && session.phase === 'running') {
    const enemies = session.world.actors.filter((a) => a.alive && a.team === 'enemy');
    const target = enemies.length ? enemies.reduce((a, b) => (a.hp + dist(p.pos, a.pos) * 0.35 <= b.hp + dist(p.pos, b.pos) * 0.35 ? a : b)) : null;
    reactTimer -= SIM_DT;
    if (reactTimer <= 0 && target) {
      reactTimer = 0.05;
      const d = dist(p.pos, target.pos);
      if (p.attackCd <= 0.001 && p.phase !== 'windup' && d - target.radius <= p.attack.range) {
        input.push({ kind: 'move', x: target.pos.x, y: target.pos.y, t: t * 1000 });
      } else if (p.phase !== 'windup') {
        const desired = p.attack.range * 0.94 + target.radius;
        const radial = norm(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
        const tangent = { x: -radial.y, y: radial.x };
        const c = Math.max(-1, Math.min(1, (desired - d) / 180));
        const tw = 0.55 * (1 - Math.abs(c));
        let gx = p.pos.x + (radial.x * c + tangent.x * orbitDir * tw) * 320;
        let gy = p.pos.y + (radial.y * c + tangent.y * orbitDir * tw) * 320;
        const margin = 190;
        if (gx < margin || gx > bounds.w - margin || gy < margin || gy > bounds.h - margin) {
          orbitDir *= -1;
          const toC = norm(bounds.w / 2 - p.pos.x, bounds.h / 2 - p.pos.y);
          gx = p.pos.x + toC.x * 300; gy = p.pos.y + toC.y * 300;
        }
        input.push({ kind: 'move', x: Math.max(50, Math.min(bounds.w - 50, gx)), y: Math.max(50, Math.min(bounds.h - 50, gy)), t: t * 1000 });
      }
    }
    session.cursorWorld = { x: p.pos.x, y: p.pos.y };

    if (t - lastLog >= 5) {
      lastLog = t;
      const e = enemies[0];
      console.log(
        `t=${t.toFixed(0)}s hp=${Math.round(p.hp)} enemies=${enemies.length}` +
        (e ? ` d=${Math.round(dist(p.pos, e.pos))} eSpd=${Math.round(e.moveSpeed)} eDmg=${e.attack.damage} eRange=${e.attack.range} eHp=${Math.round(e.hp)}` : '') +
        ` hits=${session.metrics.m.hitsTaken} atk=${session.metrics.m.attacksCompleted}`,
      );
    }
  }
  session.step(SIM_DT);
  t += SIM_DT;
}
const m = session.metrics.m;
const d = derive(m, session.world.player?.maxHp ?? 760);
console.log(`END t=${t.toFixed(1)} reason=${session.endReason} hits=${m.hitsTaken} hpLost=${Math.round(m.hpLost)} dmg=${Math.round(m.damageDealt)} kills=${m.kills} orb=${(d.orbwalkEfficiency*100).toFixed(0)}%`);
console.log('outcome', JSON.stringify(drill.outcome().keyMetrics.map((k) => `${k.label}=${k.value.toFixed(2)}`)));
