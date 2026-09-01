import { audio } from '../engine/audio';
import { clamp, dist, norm } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { AbilitySlot } from '../engine/input';
import type { AbilityView, HudField } from '../engine/session';
import type { Vec2 } from '../engine/types';
import { Drill, band, count, ms, pct, type DrillOutcome } from './base';

type Slot = 'q' | 'w' | 'e' | 'r';

const ABILITY_NAME: Record<Slot, string> = { q: 'BOLT', w: 'FIELD', e: 'DASH', r: 'PULSE' };

/**
 * COMBOS — sequence under pressure.
 *
 * The prompt changes every repetition, so nothing here can be memorised as a
 * fixed rhythm. It is about getting the right key down in the right order
 * while your other hand is still steering.
 */
export class CombosDrill extends Drill {
  private sequence: Slot[] = [];
  private index = 0;
  private shownAt = 0;
  private window = 3;
  private completed = 0;
  private failed = 0;
  private errors = 0;
  private times: number[] = [];
  private cooldowns: Record<Slot, number> = { q: 0, w: 0, e: 0, r: 0 };
  private idleCd = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.spawnPlayer({ x: w * 0.4, y: h * 0.6 });
    this.spawnDummy();
    this.newSequence();
  }

  private spawnDummy(): void {
    const p = this.s.world.player!;
    const a = this.spawnEnemy('ranger', this.randomPoint(p.pos, 420, 180), { hpScale: 8 });
    a.attack.damage = 18;
    a.attack.range = 460;
    a.label = 'TRAINING';
  }

  private get d(): number {
    return this.s.config.difficulty;
  }

  private newSequence(): void {
    const len = 3 + (this.d > 0.55 ? 1 : 0) + (this.d > 0.85 ? 1 : 0);
    const pool: Slot[] = ['q', 'w', 'e', 'r'];
    const seq: Slot[] = [];
    for (let i = 0; i < len; i++) {
      let pick = pool[this.s.rng.int(0, pool.length)];
      while (seq.length && pick === seq[seq.length - 1]) pick = pool[this.s.rng.int(0, pool.length)];
      seq.push(pick);
    }
    this.sequence = seq;
    this.index = 0;
    this.shownAt = this.s.elapsed;
    this.window = 1.35 + len * (0.62 - this.d * 0.26);
    audio.play('tick');
  }

  update(dt: number): void {
    this.updateBrains(dt);
    if (this.s.world.enemies().length === 0) this.spawnDummy();
    for (const k of Object.keys(this.cooldowns) as Slot[]) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] -= dt;
    }
    if (this.idleCd > 0) {
      this.idleCd -= dt;
      if (this.idleCd <= 0) this.newSequence();
      return;
    }
    if (this.s.elapsed - this.shownAt > this.window) {
      this.failed++;
      this.s.chain = 0;
      audio.setComboPitch(0);
      audio.play('attackCancel');
      const p = this.s.world.player;
      if (p) this.s.micro('TOO SLOW', p.pos, PALETTE.textDim);
      this.idleCd = 0.5;
    }
  }

  onAbility(slot: AbilitySlot, at: Vec2): void {
    if (slot === 'd' || slot === 'f') return;
    const s = slot as Slot;
    if (this.idleCd > 0) return;
    const player = this.s.world.player;
    if (!player) return;

    const expected = this.sequence[this.index];
    this.castVisual(s, at);

    if (s !== expected) {
      this.errors++;
      this.s.chain = 0;
      audio.setComboPitch(0);
      audio.play('attackCancel');
      this.s.micro('WRONG KEY', player.pos, PALETTE.danger);
      this.failed++;
      this.idleCd = 0.45;
      return;
    }

    this.index++;
    audio.play('pickup');
    if (this.index >= this.sequence.length) {
      const t = (this.s.elapsed - this.shownAt) * 1000;
      this.times.push(t);
      this.completed++;
      this.s.chain++;
      this.s.chainBest = Math.max(this.s.chainBest, this.s.chain);
      audio.setComboPitch(this.s.chain);
      audio.play('perfect');
      this.s.micro(`${Math.round(t)}ms`, player.pos, PALETTE.good);
      this.s.fx.ring(player.pos.x, player.pos.y, 20, 150, 0.45, PALETTE.violet, 3, 'shock');
      this.idleCd = 0.35;
    }
  }

  private castVisual(s: Slot, at: Vec2): void {
    const p = this.s.world.player;
    if (!p) return;
    this.cooldowns[s] = 0.35;
    const dir = norm(at.x - p.pos.x, at.y - p.pos.y);
    switch (s) {
      case 'q':
        this.s.world.spawnProjectile({
          pos: { ...p.pos },
          team: 'player',
          ownerId: p.id,
          vel: { x: dir.x * 1500, y: dir.y * 1500 },
          speed: 1500,
          damage: 70,
          radius: 16,
          pierce: true,
          shape: 'shard',
          maxLife: 1.2,
          color: PALETTE.accent,
        });
        break;
      case 'w':
        this.s.world.spawnHazard({
          pos: at,
          team: 'player',
          shape: 'circle',
          radius: 120,
          warn: 0.25,
          active: 1.6,
          damage: 14,
          color: PALETTE.violet,
        });
        break;
      case 'e': {
        const d = Math.min(320, dist(p.pos, at));
        p.pos.x = clamp(p.pos.x + dir.x * d, p.radius, this.s.world.bounds.w - p.radius);
        p.pos.y = clamp(p.pos.y + dir.y * d, p.radius, this.s.world.bounds.h - p.radius);
        p.prev.x = p.pos.x;
        p.prev.y = p.pos.y;
        this.s.fx.ring(p.pos.x, p.pos.y, 8, 90, 0.35, PALETTE.accent, 2.5, 'shock');
        break;
      }
      case 'r':
        this.s.world.spawnHazard({
          pos: { ...p.pos },
          team: 'player',
          shape: 'circle',
          radius: 260,
          warn: 0.12,
          active: 0.25,
          damage: 90,
          color: PALETTE.warn,
        });
        this.s.fx.addShake(4);
        this.s.fx.ring(p.pos.x, p.pos.y, 20, 260, 0.5, PALETTE.warn, 4, 'shock');
        break;
    }
  }

  abilities(): AbilityView[] {
    const expected = this.idleCd > 0 ? null : this.sequence[this.index];
    return super.abilities().map((a) => {
      if (a.slot === 'd' || a.slot === 'f') return a;
      const slot = a.slot as Slot;
      return {
        ...a,
        name: ABILITY_NAME[slot],
        cd: this.idleCd > 0 ? Math.min(1, this.idleCd / 0.5) : 0,
        highlight: slot === expected,
        locked: false,
      };
    });
  }

  paint(out: DrillPaint, _t: number): void {
    const p = this.s.world.player;
    if (!p || this.idleCd > 0) return;
    // The prompt lives in the arena, above your champion — never in a corner
    // the eye has to travel to and back from mid-combo.
    const left = clamp(1 - (this.s.elapsed - this.shownAt) / this.window, 0, 1);
    out.billboards.push({
      kind: 'keys',
      x: p.pos.x,
      y: p.pos.y,
      seq: this.sequence.slice(),
      labels: this.sequence.map((k) => ABILITY_NAME[k]),
      index: this.index,
      progress: left,
    });
  }

  hudFields(): HudField[] {
    const acc = this.completed / Math.max(1, this.completed + this.failed);
    return [
      { label: 'COMBOS', value: `${this.completed}`, tone: 'neutral' },
      { label: 'EXECUTION', value: `${Math.round(acc * 100)}%`, bar: acc, tone: acc > 0.85 ? 'good' : 'warn' },
      { label: 'ERRORS', value: `${this.errors}`, tone: this.errors > 3 ? 'bad' : 'neutral' },
    ];
  }

  liveScore(): number {
    const avg = this.times.length ? this.times.reduce((a, b) => a + b, 0) / this.times.length : 3000;
    const speed = clamp((3000 - avg) / 2200, 0, 1);
    return Math.max(0, Math.round(this.completed * (700 + speed * 900) - this.failed * 520 - this.errors * 280));
  }

  outcome(): DrillOutcome {
    const acc = this.completed / Math.max(1, this.completed + this.failed);
    const avg = this.times.length ? this.times.reduce((a, b) => a + b, 0) / this.times.length : 4000;
    const perCast = this.times.length ? avg / this.sequence.length : 1400;
    const speed = band(perCast, 750, 140);
    const volume = band(this.completed / Math.max(1, this.s.elapsed / 60), 5, 22);

    const performance = clamp(acc * 0.42 + speed * 0.3 + volume * 0.18 + band(this.errors / Math.max(1, this.completed + 1), 0.8, 0) * 0.1, 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (acc > 0.9 && this.completed > 5) helped.push('Almost every sequence landed inside its window.');
    if (perCast < 260) helped.push(`About ${Math.round(perCast)}ms per key — that is a trained hand.`);
    if (this.errors > 3) hurt.push(`${this.errors} wrong keys.`);
    if (acc < 0.7) hurt.push('More sequences expired than completed.');

    const advice =
      this.errors > this.completed * 0.3
        ? 'Read the whole prompt before your first key. Starting early is what causes the wrong second key.'
        : perCast > 400
          ? 'Rest your fingers on QWER between prompts instead of returning to the mouse.'
          : 'Longer sequences are next — raise the difficulty.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { targeting: performance, aim: clamp(speed, 0, 1), combat: performance },
      keyMetrics: [
        pct('execution', 'EXECUTION', acc),
        ms('perCast', 'TIME PER KEY', perCast),
        count('combos', 'SEQUENCES', this.completed),
        count('errors', 'WRONG KEYS', this.errors, 'lower'),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
