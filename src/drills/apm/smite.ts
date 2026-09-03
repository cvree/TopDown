import { audio } from '../../engine/audio';
import type { AbilitySlot } from '../../engine/input';
import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { AbilityView, HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct } from '../base';
import { ApmDrill, INERT_ATTACK } from './engine';

/** How far the smite reaches. Everything else in the mode follows from this. */
const SMITE_RANGE = 700;
const SMITE_CD = 2.4;

interface Camp {
  actor: Actor;
  /** Damage per second the rest of the world is doing to it. */
  drain: number;
  /** Set once its health drops inside the smite threshold. */
  openedAt: number;
  /** Seconds after the window opens at which the rival takes it. */
  rivalAt: number;
  contested: boolean;
}

/**
 * SMITE — the execute, on a clock you do not own.
 *
 * Three camps burning down in three different places, one smite on a short
 * cooldown, and a rival jungler with his own finger on the key. A camp is
 * only killable once its health is inside the smite's damage, and the deeper
 * into that window you take it the more it is worth — but the rival is
 * reaching for it too, and the camp you are standing next to is never the one
 * about to open.
 *
 * So the mode is pathing and execution at the same time: the smite itself is
 * one keystroke, and every other action in the run is being in the right place
 * to press it.
 */
export class ApmSmiteDrill extends ApmDrill {
  protected readonly targetApm = 105;
  // An objective every five seconds is a very good run.
  protected get targetRate(): number {
    return 12;
  }

  private camps: Camp[] = [];
  private cd = 0;
  private taken = 0;
  private stolen = 0;
  private wasted = 0;
  private lostToDrain = 0;
  private windowTimes: number[] = [];
  private spawnCd = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    // The champion is a delivery system for one key: no attacks, no accidents.
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.5 }, { range: 0, damage: 0 });
    void p;
    for (let i = 0; i < this.campCount(); i++) this.spawnCamp(i);
  }

  private campCount(): number {
    return 2 + Math.floor(this.d * 2);
  }

  /** The health at or below which a smite kills. */
  private threshold(): number {
    return 420;
  }

  private spawnCamp(index: number): void {
    const { w, h } = this.s.world.bounds;
    // Spread the camps around the rim so that no two windows can be answered
    // from the same spot — the walk between them is most of the drill.
    const ang = this.s.rng.angle() + (index * Math.PI * 2) / 3;
    const pos = {
      x: clamp(w / 2 + Math.cos(ang) * w * 0.32, 180, w - 180),
      y: clamp(h / 2 + Math.sin(ang) * h * 0.3, 160, h - 160),
    };
    const maxHp = 1500 + this.s.rng.range(-200, 400);
    const a = this.s.world.spawnActor({
      pos,
      team: 'enemy',
      maxHp: Math.round(maxHp),
      radius: 46,
      moveSpeed: 0,
      // Read as a heavy thing standing on a point rather than as a champion:
      // at a glance you should be able to tell an objective from a person.
      archetype: 'juggernaut',
      label: 'OBJECTIVE',
      attack: { ...INERT_ATTACK },
    });
    this.camps.push({
      actor: a,
      drain: (170 + this.d * 150) * (0.8 + this.s.rng.next() * 0.5),
      openedAt: -1,
      rivalAt: clamp(1.5 - this.d * 0.8, 0.45, 1.6) + this.s.rng.range(0, 0.45),
      contested: false,
    });
    this.s.fx.ring(pos.x, pos.y, 20, 160, 0.5, PALETTE.warn, 3, 'range');
  }

  protected tick(dt: number): void {
    if (this.cd > 0) {
      this.cd = Math.max(0, this.cd - dt);
      if (this.cd === 0) audio.play('abilityReady', { intensity: 0.7 });
    }

    const th = this.threshold();
    for (let i = this.camps.length - 1; i >= 0; i--) {
      const c = this.camps[i];
      const a = c.actor;
      a.hp -= c.drain * dt;

      if (a.hp <= th && c.openedAt < 0) {
        c.openedAt = this.s.elapsed;
        audio.play('telegraph', { intensity: 1, pan: this.s.panOf(a.pos) });
        this.s.fx.ring(a.pos.x, a.pos.y, 30, 220, 0.6, PALETTE.warn, 4, 'shock');
        this.s.setBanner('SMITE WINDOW', 0.8);
      }

      // The rival's finger. He is not fast, but he is never late twice.
      if (c.openedAt >= 0 && !c.contested && this.s.elapsed - c.openedAt > c.rivalAt) {
        c.contested = true;
        this.stolen++;
        this.fumble(a.pos, 'STOLEN', { input: false, cost: 120 });
        this.retire(i, PALETTE.danger);
        continue;
      }

      if (a.hp <= 0) {
        this.lostToDrain++;
        this.fumble(a.pos, 'LOST', { input: false, cost: 90 });
        this.retire(i, PALETTE.textFaint);
      }
    }

    this.spawnCd -= dt;
    if (this.camps.length < this.campCount() && this.spawnCd <= 0) {
      this.spawnCd = 0.6;
      this.spawnCamp(this.camps.length);
    }
  }

  private retire(index: number, color: string): void {
    const c = this.camps[index];
    c.actor.alive = false;
    this.camps.splice(index, 1);
    this.s.fx.ring(c.actor.pos.x, c.actor.pos.y, 40, 10, 0.35, color, 2, 'impact');
    this.s.world.actors = this.s.world.actors.filter((x) => x.alive || x.id === this.s.world.playerId);
  }

  /** The camp the cursor is asking for: nearest to the cursor, inside range. */
  private aimedCamp(p: Actor): Camp | null {
    let best: Camp | null = null;
    let bd = Infinity;
    for (const c of this.camps) {
      if (dist(p.pos, c.actor.pos) - c.actor.radius > SMITE_RANGE) continue;
      const d = dist(this.s.cursorWorld, c.actor.pos);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  onAbility(slot: AbilitySlot): void {
    if (slot !== 'd') return;
    const p = this.s.world.player;
    if (!p) return;
    if (this.cd > 0) {
      this.stray(p.pos);
      return;
    }

    const c = this.aimedCamp(p);
    this.cd = SMITE_CD;
    if (!c) {
      // Smite into empty air. It is a real input and it costs a real cooldown.
      this.wasted++;
      this.fumble(this.s.cursorWorld, 'OUT OF RANGE', { cost: 90 });
      return;
    }

    const th = this.threshold();
    if (c.actor.hp > th) {
      this.wasted++;
      this.fumble(c.actor.pos, 'TOO EARLY');
      this.s.fx.ring(c.actor.pos.x, c.actor.pos.y, 20, 120, 0.35, PALETTE.danger, 3, 'impact');
      return;
    }

    // Deeper into the window is worth more: the health you let it keep is the
    // margin the rival was reaching for.
    const depth = clamp(1 - c.actor.hp / th, 0, 1);
    const wait = c.openedAt >= 0 ? (this.s.elapsed - c.openedAt) * 1000 : 0;
    this.windowTimes.push(wait);
    this.taken++;
    const idx = this.camps.indexOf(c);
    this.hit(c.actor.pos, {
      quality: depth,
      value: 260,
      reaction: wait,
      label: depth > 0.8 ? 'STOLEN BACK' : 'SMITED',
      color: PALETTE.warn,
    });
    this.s.fx.kill(c.actor.pos, PALETTE.warn);
    if (idx >= 0) this.retire(idx, PALETTE.warn);
  }

  abilities(): AbilityView[] {
    const p = this.s.world.player;
    const aimed = p ? this.aimedCamp(p) : null;
    const ready = this.cd <= 0 && aimed !== null && aimed.actor.hp <= this.threshold();
    return super.abilities().map((a) =>
      a.slot === 'd'
        ? { ...a, name: 'SMITE', locked: false, cd: clamp(this.cd / SMITE_CD, 0, 1), highlight: ready }
        : a,
    );
  }

  protected paintMode(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    const th = this.threshold();
    if (p) {
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: SMITE_RANGE,
        color: this.cd > 0 ? PALETTE.textFaint : PALETTE.warn,
        alpha: 0.28,
        width: 2,
        dash: 24,
        spin: 0.2,
        rise: 0.4,
      });
    }
    for (const c of this.camps) {
      const a = c.actor;
      const inRange = p ? dist(p.pos, a.pos) - a.radius <= SMITE_RANGE : false;
      const open = a.hp <= th;
      const left = open && c.openedAt >= 0 ? clamp(1 - (this.s.elapsed - c.openedAt) / c.rivalAt, 0, 1) : 1;
      const col = open ? (inRange ? PALETTE.warn : PALETTE.danger) : PALETTE.textDim;
      out.markers.push({
        kind: 'ring',
        x: a.pos.x,
        y: a.pos.y,
        radius: a.radius + 22,
        color: col,
        alpha: open ? 0.95 : 0.5,
        width: open ? 7 : 3,
        progress: open ? left : clamp((a.hp - th) / Math.max(1, a.maxHp - th), 0, 1),
        rise: 2.2,
      });
      if (open) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 9);
        out.markers.push({
          kind: 'disc',
          x: a.pos.x,
          y: a.pos.y,
          radius: a.radius * (0.5 + pulse * 0.25),
          color: col,
          alpha: 0.35 + pulse * 0.3,
          fill: 0.8,
          width: 1,
          rise: 2.4,
        });
        out.billboards.push({
          kind: 'label',
          x: a.pos.x,
          y: a.pos.y,
          text: inRange ? 'SMITE' : 'GET THERE',
          color: col,
          size: 22,
          sub: `${Math.max(0, Math.round(a.hp))} HP`,
        });
      }
    }
  }

  /** Walking to the next camp is the action this mode counts. */
  onClick(pos: Vec2): boolean {
    this.noteMove(pos);
    return false;
  }

  private avgWindow(): number {
    return this.windowTimes.length ? this.windowTimes.reduce((a, b) => a + b, 0) / this.windowTimes.length : 0;
  }

  private takeRate(): number {
    return this.taken / Math.max(1, this.taken + this.stolen + this.lostToDrain);
  }

  protected modeField(): HudField {
    const rate = this.takeRate();
    return {
      label: 'OBJECTIVES',
      value: `${this.taken}`,
      bar: rate,
      tone: rate > 0.8 ? 'good' : rate > 0.55 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    void accuracy;
    return {
      tempo: clamp(speed * 0.5 + performance * 0.5, 0, 1),
      lastHitting: clamp(this.takeRate() * 0.65 + performance * 0.35, 0, 1),
      movement: performance,
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      pct('secured', 'OBJECTIVES SECURED', this.takeRate()),
      count('taken', 'SMITES LANDED', this.taken),
      ms('window', 'REACTION INSIDE WINDOW', this.avgWindow()),
      count('stolen', 'LOST TO THE RIVAL', this.stolen, 'lower'),
    ];
  }

  protected notes() {
    return {
      helped: this.stolen === 0 && this.taken > 5 ? ['The rival did not take a single objective off you.'] : [],
      hurt: this.wasted > 3 ? [`${this.wasted} smites thrown at full health or empty ground.`] : [],
      advice:
        this.stolen > this.taken * 0.4
          ? 'Be standing on the next camp before its window opens. A smite you have to walk to is a smite he already pressed.'
          : this.wasted > 3
            ? 'Watch the health number, not the bar. Smite only kills inside its own damage, and early is the same as missing.'
            : null,
    };
  }
}
