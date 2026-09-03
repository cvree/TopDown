import { codeLabel, defaultsFor, type AbilitySlot } from '../../engine/input';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { AbilityView, HudField } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms } from '../base';
import { ApmDrill, KeyCooldowns } from './engine';

const SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r', 'd', 'f'];
const NAME: Record<string, string> = { q: 'BOLT', w: 'FIELD', e: 'DASH', r: 'PULSE', d: 'FLASH', f: 'IGNITE' };
const PRESS_CD = 0.28;

/**
 * KEY COORDINATION — the left hand, alone.
 *
 * A queue of keys runs above your champion and only the front one is legal.
 * Answer it and the queue advances; answer the wrong one and the chain is
 * gone. The window shrinks as your chain grows, so the mode converges on the
 * fastest cadence you can actually hold rather than the fastest one you can
 * reach for a second and a half.
 *
 * It is the closest thing here to a rhythm game, and it is on purpose: the
 * queue means your eyes are always one key ahead of your fingers, which is
 * exactly the habit that makes a combo come out clean under pressure.
 */
export class ApmKeysDrill extends ApmDrill {
  protected readonly targetApm = 235;

  private queue: AbilitySlot[] = [];
  private shownAt = 0;
  private window = 1.2;
  private keys = new KeyCooldowns();
  private wrongKeys = 0;
  private lateKeys = 0;
  private gaps: number[] = [];
  private lastHitAt = 0;
  /** What is printed on the key, which the control scheme decides. */
  private glyph: Record<string, string> = {};

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w / 2, y: h / 2 }, { range: 0, damage: 0 });
    p.moveSpeed = 0;
    // The prompt has to show the key your hand is on, not the slot's name.
    // Under WASD the ability row moves one seat over, and a mode about keys
    // that prints the wrong letter is worse than no prompt at all.
    const binds = defaultsFor(this.s.scheme);
    for (const slot of SLOTS) this.glyph[slot] = codeLabel(binds[slot].primary);
    for (let i = 0; i < 6; i++) this.push();
    this.arm();
  }

  /** Never the same key twice running: this is coordination, not a trill. */
  private push(): void {
    let pick = SLOTS[this.s.rng.int(0, SLOTS.length)];
    const last = this.queue[this.queue.length - 1];
    let guard = 0;
    while (pick === last && guard++ < 8) pick = SLOTS[this.s.rng.int(0, SLOTS.length)];
    this.queue.push(pick);
  }

  private arm(): void {
    this.shownAt = this.s.elapsed;
    this.window = clamp((1.25 - this.d * 0.42) / this.tempo, 0.3, 1.4);
  }

  private advance(): void {
    this.queue.shift();
    this.push();
    this.arm();
  }

  protected tick(dt: number): void {
    this.keys.tick(dt);
    if (this.s.elapsed - this.shownAt > this.window) {
      this.lateKeys++;
      const p = this.s.world.player;
      this.fumble(p ? p.pos : { x: 0, y: 0 }, 'TOO SLOW', { input: false, cost: 50 });
      this.advance();
    }
  }

  onAbility(slot: AbilitySlot): void {
    const p = this.s.world.player;
    if (!p) return;
    this.keys.set(slot, PRESS_CD);
    const expected = this.queue[0];
    const age = this.s.elapsed - this.shownAt;

    if (slot !== expected) {
      this.wrongKeys++;
      this.fumble(p.pos, `WRONG · ${this.glyph[expected] ?? expected.toUpperCase()}`);
      this.advance();
      return;
    }

    if (this.lastHitAt > 0) this.gaps.push((this.s.elapsed - this.lastHitAt) * 1000);
    this.lastHitAt = this.s.elapsed;
    this.hit(p.pos, {
      quality: clamp(1 - age / this.window, 0, 1),
      value: 85,
      reaction: age * 1000,
      label: this.glyph[slot] ?? slot.toUpperCase(),
    });
    this.advance();
  }

  /** The mouse has no job in this mode, and pretending otherwise costs APM. */
  onClick(pos: Vec2): boolean {
    this.stray(pos);
    return true;
  }

  abilities(): AbilityView[] {
    const expected = this.queue[0];
    return SLOTS.map((slot) => ({
      slot,
      name: NAME[slot],
      cd: clamp(this.keys.get(slot) / PRESS_CD, 0, 1),
      highlight: slot === expected,
      locked: false,
    }));
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    const left = clamp(1 - (this.s.elapsed - this.shownAt) / this.window, 0, 1);
    // The queue sits above the champion, where the eye already is. A prompt in
    // a corner is a prompt you pay travel time for on every single key.
    out.billboards.push({
      kind: 'keys',
      x: p.pos.x,
      y: p.pos.y,
      seq: this.queue.slice(0, 5).map((k) => this.glyph[k] ?? k),
      labels: this.queue.slice(0, 5).map((k) => NAME[k]),
      index: 0,
      progress: left,
    });
    out.markers.push({
      kind: 'ring',
      x: p.pos.x,
      y: p.pos.y,
      radius: p.radius + 62,
      color: left < 0.3 ? PALETTE.danger : this.flow.color,
      alpha: 0.6,
      width: 4,
      progress: left,
      rise: 1.2,
    });
  }

  private medianGap(): number {
    if (!this.gaps.length) return 0;
    const s = [...this.gaps].sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  protected modeField(): HudField {
    const gap = this.medianGap();
    return {
      label: 'KEY GAP',
      value: gap ? `${Math.round(gap)}ms` : '—',
      bar: clamp(1 - gap / 900, 0, 1),
      tone: gap && gap < 300 ? 'good' : gap && gap < 520 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.55 + performance * 0.45, 0, 1),
      targeting: clamp(accuracy * 0.6 + performance * 0.4, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      ms('gap', 'TIME PER KEY', this.medianGap()),
      count('wrong', 'WRONG KEYS', this.wrongKeys, 'lower'),
      count('late', 'KEYS MISSED', this.lateKeys, 'lower'),
    ];
  }

  protected notes() {
    const gap = this.medianGap();
    return {
      helped: gap > 0 && gap < 260 ? [`About ${Math.round(gap)}ms between keys — that is a trained hand.`] : [],
      hurt: this.wrongKeys > this.hits * 0.15 ? ['Wrong keys, not slow keys, are what is costing you here.'] : [],
      advice:
        this.wrongKeys > this.hits * 0.15
          ? 'Read two keys ahead and let your fingers pre-position. Reading one at a time is what produces the wrong key.'
          : gap > 480
            ? 'Rest your fingers on the row between prompts. Returning to a home position after every key is the cost you are paying.'
            : null,
    };
  }
}
