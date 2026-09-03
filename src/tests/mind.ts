/**
 * The mind family.
 *
 * These are the tests nobody trains, and the ones that separate players who
 * have the same hands. What did the minimap say. Is their Flash up. Can you
 * actually kill them. Do your fingers know the combo without you.
 *
 * They are still built out of a canvas and a keyboard, but the thing being
 * measured has moved from the muscle to the model you keep of the game.
 */

import { audio } from '../engine/audio';
import { clamp } from '../engine/math';
import type { Rng } from '../engine/rng';
import {
  C,
  champ,
  disc,
  field,
  floatsDraw,
  floatsUpdate,
  glow,
  hpBar,
  keycap,
  median,
  pop,
  pulse,
  rgba,
  ring,
  rippleDraw,
  rippleUpdate,
  text,
  type FloatText,
  type Ripple,
} from './kit';
import type { Frame, TestResult, TestRunner } from './types';

/* =========================================================== MAP RECALL == */

const RECALL_ROUNDS = 6;
/** How many enemies blink, round by round. */
const RECALL_COUNT = [2, 3, 3, 4, 4, 5];

interface Ping {
  x: number;
  y: number;
}

/**
 * The glance.
 *
 * Good players do not watch the minimap — they photograph it every few seconds
 * and play off the photograph. This measures the photograph: how much of a
 * half-second look you still have when the icons are gone.
 */
export class MapRecallTest implements TestRunner {
  readonly cursor = 'crosshair' as const;

  private round = 0;
  private phase: 'show' | 'blank' | 'answer' | 'review' = 'show';
  private timer = 0;
  private pings: Ping[] = [];
  private guesses: Ping[] = [];
  private scores: number[] = [];
  private roundScores: number[] = [];
  private ripples: Ripple[] = [];
  private floats: FloatText[] = [];
  private rect = { x: 0, y: 0, s: 0 };
  private built = false;

  constructor(private rng: Rng) {}

  /** Look time shrinks from a comfortable glance to a real one. */
  private get showTime(): number {
    return 1.5 - 0.72 * (this.round / RECALL_ROUNDS);
  }

  private build(): void {
    const n = RECALL_COUNT[Math.min(this.round, RECALL_COUNT.length - 1)];
    this.pings = [];
    const m = 0.09;
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 50; tries++) {
        const p = { x: this.rng.range(m, 1 - m), y: this.rng.range(m, 1 - m) };
        // Two icons on top of each other would be one icon, and the recall
        // would be about crowding rather than memory.
        if (this.pings.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 0.19)) {
          this.pings.push(p);
          break;
        }
      }
    }
    this.guesses = [];
    this.phase = 'show';
    this.timer = 0;
    this.built = true;
    audio.play('tick', 0.5);
  }

  prompt(): string {
    if (this.phase === 'show') return 'LOOK — where is everyone?';
    if (this.phase === 'blank') return '…';
    if (this.phase === 'answer') return `CLICK ${this.pings.length - this.guesses.length} MORE`;
    return `${Math.round((this.roundScores[this.roundScores.length - 1] ?? 0) * 100)}% RECALLED`;
  }

  progress(): number {
    return this.round / RECALL_ROUNDS;
  }

  pointerDown(x: number, y: number): void {
    if (this.phase !== 'answer') return;
    const { x: rx, y: ry, s } = this.rect;
    if (x < rx || x > rx + s || y < ry || y > ry + s) return;
    this.guesses.push({ x: (x - rx) / s, y: (y - ry) / s });
    pop(this.ripples, x, y, C.violet, 34, 0.35);
    audio.play('uiClick', 0.5);
    if (this.guesses.length >= this.pings.length) this.grade();
  }

  private grade(): void {
    // Best possible pairing of guesses to icons, not greedy-by-click-order:
    // a sloppy first click must not be allowed to steal the icon that a later,
    // precise click was clearly aiming at. At five icons this is 120 orderings,
    // which is nothing, and it is the difference between a fair score and a
    // score that depends on which one you clicked first.
    const tol = 0.15;
    const n = this.pings.length;
    const credit = (gi: number, pi: number): number => {
      const g = this.guesses[gi];
      const p = this.pings[pi];
      return clamp(1 - Math.hypot(p.x - g.x, p.y - g.y) / tol, 0, 1);
    };

    let bestTotal = -1;
    let bestGot: number[] = [];
    const order: number[] = [];
    const used = new Array<boolean>(n).fill(false);
    const walk = (gi: number, total: number): void => {
      if (gi >= this.guesses.length) {
        if (total > bestTotal) {
          bestTotal = total;
          bestGot = order.map((pi, i) => credit(i, pi));
        }
        return;
      }
      for (let pi = 0; pi < n; pi++) {
        if (used[pi]) continue;
        used[pi] = true;
        order.push(pi);
        walk(gi + 1, total + credit(gi, pi));
        order.pop();
        used[pi] = false;
      }
    };
    walk(0, 0);

    const got = bestGot;
    const roundScore = got.length ? got.reduce((a, b) => a + b, 0) / got.length : 0;
    this.scores.push(...got);
    this.roundScores.push(roundScore);
    this.phase = 'review';
    this.timer = 0;
    this.round++;
    audio.play(roundScore > 0.7 ? 'perfect' : 'fail', 0.6);
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    const s = Math.min(w - 180, h - 190);
    this.rect = { x: (w - s) / 2, y: (h - s) / 2 - 12, s };
    if (!this.built) this.build();
    this.timer += f.dt;
    rippleUpdate(this.ripples, f.dt);
    floatsUpdate(this.floats, f.dt);

    if (this.phase === 'show' && this.timer >= this.showTime) {
      this.phase = 'blank';
      this.timer = 0;
    } else if (this.phase === 'blank' && this.timer > 0.35) {
      this.phase = 'answer';
      this.timer = 0;
    } else if (this.phase === 'answer' && this.timer > 9) {
      // A stall is an answer too. Grade what is there.
      while (this.guesses.length < this.pings.length) this.guesses.push({ x: 9, y: 9 });
      this.grade();
    } else if (this.phase === 'review' && this.timer > 1.5) {
      if (this.round < RECALL_ROUNDS) this.build();
    }

    /* -------------------------------------------------------------- draw */
    field(ctx, w, h, C.violet);
    this.drawMap(ctx);

    const { x: rx, y: ry } = this.rect;
    const at = (p: Ping) => ({ x: rx + p.x * s, y: ry + p.y * s });

    if (this.phase === 'show') {
      const k = pulse(f.t, 3);
      for (const p of this.pings) {
        const q = at(p);
        glow(ctx, q.x, q.y, 26, C.danger, 0.5 + k * 0.3);
        champ(ctx, q.x, q.y, 11, { color: C.danger, glyph: '' });
      }
      // The look-time bar. Watching it drain is half the pressure.
      const left = 1 - this.timer / this.showTime;
      ctx.fillStyle = rgba(C.violet, 0.9);
      ctx.fillRect(rx, ry - 12, s * clamp(left, 0, 1), 4);
    }

    if (this.phase === 'answer' || this.phase === 'review') {
      this.guesses.forEach((g, i) => {
        if (g.x > 1) return;
        const q = at(g);
        ring(ctx, q.x, q.y, 12, rgba(C.violet, 0.9), 2);
        text(ctx, String(i + 1), q.x, q.y, { size: 11, color: C.violet, font: 'mono' });
      });
    }

    if (this.phase === 'review') {
      for (const p of this.pings) {
        const q = at(p);
        ring(ctx, q.x, q.y, 15, rgba(C.danger, 0.8), 2);
        disc(ctx, q.x, q.y, 4, C.danger);
      }
      const rs = this.roundScores[this.roundScores.length - 1] ?? 0;
      text(ctx, `${Math.round(rs * 100)}%`, w / 2, ry + s + 42, {
        size: 34,
        color: rs > 0.7 ? C.good : rs > 0.4 ? C.warn : C.danger,
        font: 'mono',
      });
    }

    rippleDraw(ctx, this.ripples);
    floatsDraw(ctx, this.floats);

    const shownRound = this.phase === 'review' ? this.round : this.round + 1;
    text(ctx, `ROUND ${Math.min(shownRound, RECALL_ROUNDS)} / ${RECALL_ROUNDS}`, w / 2, ry - 30, {
      size: 11,
      color: C.faint,
      track: 4,
    });
  }

  /** A rift, in the six strokes that make one recognisable at 400px. */
  private drawMap(ctx: CanvasRenderingContext2D): void {
    const { x, y, s } = this.rect;
    ctx.save();
    ctx.fillStyle = 'rgba(4,10,16,0.92)';
    ctx.fillRect(x, y, s, s);

    const P = (u: number, v: number): [number, number] => [x + u * s, y + v * s];
    const path = (pts: [number, number][], width: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
    };

    // River first, so the lanes cross over it the way they do on the map.
    path([P(0.12, 0.12), P(0.88, 0.88)], s * 0.085, 'rgba(60,140,190,0.22)');
    // Lanes.
    const lane = 'rgba(190,170,120,0.3)';
    path([P(0.16, 0.84), P(0.84, 0.16)], s * 0.035, lane);
    path([P(0.14, 0.8), P(0.1, 0.16), P(0.8, 0.12)], s * 0.035, lane);
    path([P(0.2, 0.88), P(0.86, 0.9), P(0.88, 0.2)], s * 0.035, lane);
    // Bases.
    disc(ctx, ...P(0.08, 0.92), s * 0.07, 'rgba(60,140,200,0.35)');
    disc(ctx, ...P(0.92, 0.08), s * 0.07, 'rgba(200,70,80,0.35)');

    ctx.strokeStyle = rgba(C.gold, 0.4);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    // Corner brackets, matching the client's frame language.
    const b = 16;
    ctx.strokeStyle = rgba(C.goldHot, 0.8);
    ctx.lineWidth = 2;
    for (const [ox, oy, dx, dy] of [
      [x, y, 1, 1],
      [x + s, y, -1, 1],
      [x, y + s, 1, -1],
      [x + s, y + s, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(ox + dx * b, oy);
      ctx.lineTo(ox, oy);
      ctx.lineTo(ox, oy + dy * b);
      ctx.stroke();
    }
    ctx.restore();
  }

  finished(): boolean {
    return this.round >= RECALL_ROUNDS && this.phase === 'review' && this.timer > 1.5;
  }

  result(): TestResult {
    const acc = this.scores.length ? this.scores.reduce((a, b) => a + b, 0) / this.scores.length : 0;
    const exact = this.scores.filter((v) => v > 0.7).length;
    return {
      primary: acc,
      trials: this.roundScores,
      stats: [
        { label: 'Icons placed well', value: exact, format: 'int', direction: 'higher' },
        { label: 'Icons shown', value: this.scores.length, format: 'int', direction: 'higher' },
        { label: 'Best round', value: this.roundScores.length ? Math.max(...this.roundScores) : 0, format: 'pct', direction: 'higher' },
      ],
      notes: [
        acc < 0.55
          ? 'You are remembering how many, not where. Read positions relative to lanes and river rather than as dots on a square.'
          : 'You are keeping real positions, not a vague count. That is what a glance is supposed to buy.',
        'The look time shrinks every round. By the last one you get about the length of a real glance.',
      ],
    };
  }
}

/* ===================================================== COOLDOWN TRACKER == */

const CD_QUESTIONS = 12;
const ROLES = ['TOP', 'JUNGLE', 'MID', 'BOT', 'SUPPORT'] as const;
const SPELLS: { name: string; cd: number; glyph: string }[] = [
  { name: 'FLASH', cd: 13, glyph: 'F' },
  { name: 'IGNITE', cd: 9, glyph: 'I' },
  { name: 'HEAL', cd: 10, glyph: 'H' },
  { name: 'EXHAUST', cd: 11, glyph: 'X' },
  { name: 'BARRIER', cd: 8, glyph: 'B' },
];

interface Tracked {
  role: string;
  spell: string;
  glyph: string;
  cd: number;
  castAt: number | null;
  flash: number;
}

/**
 * Summoner tracking, compressed.
 *
 * Real cooldowns are five minutes long, which makes them untestable and, more
 * to the point, untrainable — you learn to track them by keeping a clock in
 * your head, not by waiting. So the clocks here run in seconds and the skill
 * is identical: something happened, how long ago, is it back.
 *
 * Nothing on screen counts down. That is the entire test.
 */
export class CooldownsTest implements TestRunner {
  readonly usesKeys = true;
  readonly cursor = 'none' as const;

  private list: Tracked[] = [];
  private t = 0;
  private nextCast = 1.2;
  private nextAsk = 5;
  private asked = 0;
  private correct = 0;
  private times: number[] = [];
  private q: { idx: number; at: number; truth: boolean } | null = null;
  private feedback: { good: boolean; truth: boolean; until: number } | null = null;
  private banner: { text: string; until: number } | null = null;
  private floats: FloatText[] = [];

  constructor(private rng: Rng) {
    const roles = [...ROLES].sort(() => this.rng.next() - 0.5).slice(0, 3);
    for (const role of roles) {
      const spells = [...SPELLS].sort(() => this.rng.next() - 0.5).slice(0, 2);
      for (const s of spells) {
        this.list.push({ role, spell: s.name, glyph: s.glyph, cd: s.cd, castAt: null, flash: 0 });
      }
    }
  }

  prompt(): string {
    if (this.q) return `IS ${this.list[this.q.idx].role} ${this.list[this.q.idx].spell} UP?`;
    if (this.feedback) return this.feedback.good ? 'CORRECT' : `WRONG — it was ${this.feedback.truth ? 'UP' : 'DOWN'}`;
    return 'WATCH WHAT THEY BURN';
  }

  progress(): number {
    return this.asked / CD_QUESTIONS;
  }

  keyDown(code: string): void {
    if (!this.q) return;
    const up = code === 'ArrowRight' || code === 'KeyD';
    const down = code === 'ArrowLeft' || code === 'KeyA';
    if (!up && !down) return;
    this.answer(up);
  }

  private answer(said: boolean): void {
    if (!this.q) return;
    const good = said === this.q.truth;
    if (good) this.correct++;
    this.times.push((this.t - this.q.at) * 1000);
    this.feedback = { good, truth: this.q.truth, until: this.t + 1.1 };
    this.asked++;
    this.q = null;
    this.nextAsk = this.t + this.rng.range(2.4, 4.2);
    audio.play(good ? 'perfect' : 'fail', 0.7);
  }

  private cast(): void {
    // Only spells that are actually available get burned, so the state you are
    // asked to track is always reachable from what you saw.
    const ready = this.list.filter((e) => e.castAt === null || this.t - e.castAt >= e.cd);
    if (ready.length === 0) return;
    const e = this.rng.pick(ready);
    e.castAt = this.t;
    e.flash = 1;
    this.banner = { text: `${e.role} USED ${e.spell}`, until: this.t + 1.3 };
    audio.play('castSummoner', 0.9);
  }

  private ask(): void {
    // Never ask across the boundary: a question you could only get right by
    // luck measures luck.
    const usable = this.list.filter((e) => {
      if (e.castAt === null) return false;
      const since = this.t - e.castAt;
      return Math.abs(since - e.cd) > 1.3;
    });
    if (usable.length === 0) {
      this.nextAsk = this.t + 1.2;
      return;
    }
    const e = this.rng.pick(usable);
    const idx = this.list.indexOf(e);
    this.q = { idx, at: this.t, truth: this.t - (e.castAt as number) >= e.cd };
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.t = f.t;
    floatsUpdate(this.floats, f.dt);
    for (const e of this.list) e.flash = Math.max(0, e.flash - f.dt * 2);

    if (this.feedback && this.t > this.feedback.until) this.feedback = null;
    if (this.banner && this.t > this.banner.until) this.banner = null;

    if (this.t >= this.nextCast) {
      this.cast();
      this.nextCast = this.t + this.rng.range(2.2, 4.6);
    }
    if (!this.q && !this.feedback && this.asked < CD_QUESTIONS && this.t >= this.nextAsk) this.ask();
    // An unanswered question is a wrong answer. Hesitation is the failure mode.
    if (this.q && this.t - this.q.at > 3.2) this.answer(!this.q.truth);

    /* -------------------------------------------------------------- draw */
    field(ctx, w, h, C.cyan);
    const cx = w / 2;

    // The enemy team, drawn as a scoreboard row: portrait, then their spells.
    const roles = [...new Set(this.list.map((e) => e.role))];
    const rowH = 84;
    const top = h / 2 - (roles.length * rowH) / 2 - 40;
    roles.forEach((role, ri) => {
      const y = top + ri * rowH;
      const asked = this.q && this.list[this.q.idx].role === role;
      ctx.fillStyle = asked ? rgba(C.gold, 0.1) : 'rgba(255,255,255,0.022)';
      ctx.fillRect(cx - 210, y - 30, 420, 60);
      ctx.strokeStyle = asked ? rgba(C.goldHot, 0.7) : rgba(C.goldDeep, 0.35);
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 210.5, y - 30.5, 421, 61);

      champ(ctx, cx - 176, y, 20, { color: C.danger, glyph: role[0] });
      text(ctx, role, cx - 142, y, { size: 13, color: C.text, align: 'left', track: 3 });

      const mine = this.list.filter((e) => e.role === role);
      mine.forEach((e, i) => {
        const x = cx + 84 + i * 62;
        const questioned = this.q && this.list[this.q.idx] === e;
        keycap(ctx, x, y, 44, e.glyph, {
          lit: Math.max(e.flash, questioned ? 0.85 : 0),
          color: questioned ? C.goldHot : C.cyanHot,
          sub: e.spell,
        });
      });
    });

    if (this.banner) {
      const k = clamp((this.banner.until - this.t) / 1.3, 0, 1);
      text(ctx, this.banner.text, cx, top - 74, {
        size: 22,
        color: rgba(C.goldHot, 0.4 + k * 0.6),
        track: 6,
        font: 'display',
      });
    }

    if (this.q) {
      const e = this.list[this.q.idx];
      const left = clamp(1 - (this.t - this.q.at) / 3.2, 0, 1);
      text(ctx, `IS ${e.role}'S ${e.spell} UP?`, cx, h - 132, { size: 26, color: C.goldHot, font: 'display', track: 3 });
      ctx.fillStyle = rgba(left < 0.35 ? C.danger : C.gold, 0.9);
      ctx.fillRect(cx - 190, h - 108, 380 * left, 3);
      keycap(ctx, cx - 90, h - 66, 52, '◀', { color: C.danger, sub: 'DOWN' });
      keycap(ctx, cx + 90, h - 66, 52, '▶', { color: C.good, sub: 'UP' });
    } else if (this.feedback) {
      text(ctx, this.feedback.good ? 'CORRECT' : `IT WAS ${this.feedback.truth ? 'UP' : 'DOWN'}`, cx, h - 96, {
        size: 30,
        color: this.feedback.good ? C.good : C.danger,
        font: 'display',
        track: 4,
      });
    } else {
      text(ctx, 'NOTHING COUNTS DOWN FOR YOU. KEEP THE CLOCK YOURSELF.', cx, h - 84, {
        size: 12,
        color: C.faint,
        track: 3,
      });
    }

    text(ctx, `${this.correct} / ${this.asked} CORRECT`, cx, 40, { size: 12, color: C.faint, track: 3, font: 'mono' });
    floatsDraw(ctx, this.floats);
  }

  finished(): boolean {
    return this.asked >= CD_QUESTIONS && !this.q && !this.feedback;
  }

  result(): TestResult {
    const acc = this.asked ? this.correct / this.asked : 0;
    return {
      primary: acc,
      trials: this.times,
      stats: [
        { label: 'Correct', value: this.correct, format: 'int', direction: 'higher' },
        { label: 'Median answer', value: median(this.times), format: 'ms', direction: 'lower' },
        { label: 'Spells tracked', value: this.list.length, format: 'int', direction: 'higher' },
      ],
      notes: [
        acc < 0.7
          ? 'You are guessing on the ones you did not see cast. Say the timer out loud when it happens — that is what the pros are doing on comms.'
          : 'You are holding six clocks at once. Two summoners is what it takes in a real game.',
        'Nothing on the screen ever counts down. The clock has to be yours.',
      ],
    };
  }
}

/* ======================================================= EXECUTE CHECK == */

const EXEC_ROUNDS = 14;

interface Source {
  label: string;
  dmg: number;
  count: number;
}

interface ExecRound {
  hp: number;
  maxHp: number;
  shield: number;
  sources: Source[];
  total: number;
  kill: boolean;
  close: boolean;
}

/**
 * The all-in.
 *
 * Their health, your damage, one second. Most lost duels are not lost to
 * reactions — they are lost to arithmetic finished half a second after the
 * window closed. This forces the arithmetic into the window.
 */
export class ExecuteTest implements TestRunner {
  readonly usesKeys = true;
  readonly cursor = 'none' as const;

  private round: ExecRound | null = null;
  private index = 0;
  private askedAt = 0;
  private correct = 0;
  private closeCorrect = 0;
  private closeTotal = 0;
  private times: number[] = [];
  private feedback: { good: boolean; r: ExecRound; until: number } | null = null;
  private t = 0;
  private ripples: Ripple[] = [];

  constructor(private rng: Rng) {}

  /** The answer window closes as the run goes on. */
  private get window(): number {
    return 1.75 - 0.75 * (this.index / EXEC_ROUNDS);
  }

  private build(): void {
    const sources: Source[] = [];
    const kinds = [
      { label: 'Q', lo: 180, hi: 420 },
      { label: 'AUTO', lo: 90, hi: 210 },
      { label: 'E', lo: 140, hi: 360 },
      { label: 'IGNITE', lo: 120, hi: 260 },
      { label: 'R', lo: 350, hi: 780 },
    ];
    const n = this.rng.int(2, 4);
    const chosen = [...kinds].sort(() => this.rng.next() - 0.5).slice(0, n);
    for (const k of chosen) {
      const count = k.label === 'AUTO' ? this.rng.int(1, 4) : 1;
      sources.push({ label: k.label, dmg: Math.round(this.rng.range(k.lo, k.hi) / 5) * 5, count });
    }
    const total = sources.reduce((a, s) => a + s.dmg * s.count, 0);

    // Margins tighten: early rounds are obvious, late ones are within 6%.
    const tight = 0.34 - 0.28 * (this.index / EXEC_ROUNDS);
    const margin = total * this.rng.range(0.02, tight);
    const killable = this.rng.chance(0.5);
    const shield = this.rng.chance(0.3) ? Math.round(this.rng.range(60, 260) / 10) * 10 : 0;
    const effective = killable ? total - margin : total + margin;
    const hp = Math.max(40, Math.round((effective - shield) / 5) * 5);
    // Their max health follows from where the bar needs to sit, not the other
    // way round: a fixed max would leave every round showing a sliver of red.
    const maxHp = Math.round((hp + shield) / this.rng.range(0.18, 0.62) / 10) * 10;

    const r: ExecRound = {
      hp,
      maxHp,
      shield,
      sources,
      total,
      kill: total >= hp + shield,
      close: Math.abs(total - (hp + shield)) / total < 0.1,
    };
    this.round = r;
    this.askedAt = this.t;
    if (r.close) this.closeTotal++;
    audio.play('abilityReady', 0.5);
  }

  prompt(): string {
    if (this.feedback) {
      const r = this.feedback.r;
      return `${r.total} damage vs ${r.hp + r.shield} effective — ${r.kill ? 'KILL' : 'NO KILL'}`;
    }
    return 'GO or NO — you have about a second';
  }

  progress(): number {
    return this.index / EXEC_ROUNDS;
  }

  keyDown(code: string): void {
    if (!this.round) return;
    const go = code === 'ArrowRight' || code === 'KeyD';
    const no = code === 'ArrowLeft' || code === 'KeyA';
    if (!go && !no) return;
    this.answer(go);
  }

  private answer(go: boolean): void {
    const r = this.round;
    if (!r) return;
    const good = go === r.kill;
    if (good) {
      this.correct++;
      if (r.close) this.closeCorrect++;
    }
    this.times.push((this.t - this.askedAt) * 1000);
    this.feedback = { good, r, until: this.t + 1.15 };
    this.round = null;
    this.index++;
    audio.play(good ? (r.kill ? 'kill' : 'perfect') : 'fail', 0.8);
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.t = f.t;
    rippleUpdate(this.ripples, f.dt);

    if (this.feedback && this.t > this.feedback.until) this.feedback = null;
    if (!this.round && !this.feedback && this.index < EXEC_ROUNDS) this.build();
    // Out of time is a wrong answer — in game, so is thinking about it.
    if (this.round && this.t - this.askedAt > this.window) this.answer(!this.round.kill);

    /* -------------------------------------------------------------- draw */
    field(ctx, w, h, C.danger);
    const cx = w / 2;
    const cy = h / 2;
    const r = this.round ?? this.feedback?.r ?? null;
    if (!r) return;

    const showing = this.round !== null;

    champ(ctx, cx, cy - 118, 34, { color: C.danger, glyph: '✦' });

    // Their bar, with the shield laid over the end of it the way the client does.
    const bw = Math.min(520, w - 160);
    const bx = cx - bw / 2;
    const by = cy - 58;
    hpBar(ctx, bx, by, bw, 26, r.hp / r.maxHp, C.danger, 10);
    if (r.shield > 0) {
      const sw = (bw * r.shield) / r.maxHp;
      ctx.fillStyle = rgba(C.goldHot, 0.55);
      ctx.fillRect(bx + (bw * r.hp) / r.maxHp, by, sw, 26);
    }
    text(ctx, `${r.hp}${r.shield ? ` + ${r.shield} SHIELD` : ''}`, cx, by + 13, {
      size: 15,
      color: '#ffffff',
      font: 'mono',
    });
    text(ctx, 'THEIR EFFECTIVE HEALTH', cx, by - 18, { size: 10, color: C.faint, track: 4 });

    // Your damage, itemised. Never summed for you — summing it is the test.
    const rowY = cy + 14;
    text(ctx, 'YOUR DAMAGE', cx, rowY - 8, { size: 10, color: C.gold, track: 4 });
    const cellW = 118;
    const totalW = r.sources.length * cellW;
    r.sources.forEach((s, i) => {
      const x = cx - totalW / 2 + i * cellW + cellW / 2;
      keycap(ctx, x, rowY + 40, 42, s.label.length > 1 ? s.label[0] : s.label, {
        color: C.cyanHot,
        lit: 0.35,
      });
      text(ctx, s.count > 1 ? `${s.dmg} ×${s.count}` : `${s.dmg}`, x, rowY + 76, {
        size: 15,
        color: C.text,
        font: 'mono',
      });
      text(ctx, s.label, x, rowY + 94, { size: 9, color: C.faint, track: 2 });
    });

    if (showing) {
      const left = clamp(1 - (this.t - this.askedAt) / this.window, 0, 1);
      ctx.fillStyle = rgba(left < 0.35 ? C.danger : C.gold, 0.95);
      ctx.fillRect(cx - 200, h - 116, 400 * left, 4);
      keycap(ctx, cx - 100, h - 70, 54, '◀', { color: C.dim, sub: 'WALK' });
      keycap(ctx, cx + 100, h - 70, 54, '▶', { color: C.danger, sub: 'ALL IN' });
    } else if (this.feedback) {
      const fb = this.feedback;
      text(ctx, fb.good ? 'CORRECT' : 'WRONG', cx, h - 96, {
        size: 30,
        color: fb.good ? C.good : C.danger,
        font: 'display',
        track: 5,
      });
      text(ctx, `${fb.r.total} vs ${fb.r.hp + fb.r.shield}  —  ${fb.r.kill ? 'KILLABLE' : 'NOT KILLABLE'}`, cx, h - 62, {
        size: 14,
        color: C.dim,
        font: 'mono',
      });
    }

    text(ctx, `${this.correct} / ${this.index} CORRECT`, cx, 40, { size: 12, color: C.faint, track: 3, font: 'mono' });
    rippleDraw(ctx, this.ripples);
  }

  finished(): boolean {
    return this.index >= EXEC_ROUNDS && !this.feedback;
  }

  result(): TestResult {
    const acc = this.index ? this.correct / this.index : 0;
    return {
      primary: acc,
      trials: this.times,
      stats: [
        { label: 'Median decision', value: median(this.times), format: 'ms', direction: 'lower' },
        { label: 'Close calls', value: this.closeTotal ? this.closeCorrect / this.closeTotal : 0, format: 'pct', direction: 'higher' },
        { label: 'Correct', value: this.correct, format: 'int', direction: 'higher' },
      ],
      notes: [
        acc < 0.7
          ? 'Round the numbers. Nobody adds 215 + 95×3 in a fight — they add 200 + 300 and leave a margin.'
          : 'You are doing the arithmetic inside the window, which is the only place it counts.',
        this.closeTotal > 0 && this.closeCorrect / this.closeTotal < 0.5
          ? 'The close ones are where you die. When it is within ten percent, the correct answer is usually no.'
          : 'You held up on the close ones — that is the discipline that stops coinflip all-ins.',
      ],
    };
  }
}

/* ======================================================== COMBO MEMORY == */

const COMBO_ROUNDS = 9;
/** What a dropped sequence is worth. Deliberately the bottom of the ladder. */
const BROKEN_COMBO = 4400;
const COMBO_LEN = [3, 3, 4, 4, 5, 5, 6, 6, 7];
const COMBO_KEYS = ['Q', 'W', 'E', 'R'] as const;
const COMBO_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'];

/**
 * Sequence memory into sequence execution.
 *
 * A combo you have to think about is a combo you cast too late. This shows one,
 * hides it, and asks your hands to play it back — which is exactly what happens
 * when your eyes are on the fight instead of your ability bar.
 */
export class ComboRecallTest implements TestRunner {
  readonly usesKeys = true;
  readonly cursor = 'none' as const;

  private round = 0;
  private phase: 'show' | 'go' | 'review' = 'show';
  private seq: number[] = [];
  private at = 0;
  private timer = 0;
  private startedAt = 0;
  private norm: number[] = [];
  /** Every round, with a broken one recorded at its true cost rather than
   *  dropped — see `result()`. */
  private rounds: number[] = [];
  private failed = 0;
  private completed = 0;
  private longest = 0;
  private litFade = [0, 0, 0, 0];
  private lastOk = true;
  private floats: FloatText[] = [];

  constructor(private rng: Rng) {
    this.build();
  }

  private get stepTime(): number {
    return 0.44 - 0.13 * (this.round / COMBO_ROUNDS);
  }

  private build(): void {
    const len = COMBO_LEN[Math.min(this.round, COMBO_LEN.length - 1)];
    this.seq = [];
    for (let i = 0; i < len; i++) {
      // No immediate repeats: a doubled key is a different (easier) test.
      let k = this.rng.int(0, 4);
      if (i > 0 && k === this.seq[i - 1]) k = (k + 1 + this.rng.int(0, 3)) % 4;
      this.seq.push(k);
    }
    this.phase = 'show';
    this.timer = 0;
    this.at = 0;
  }

  prompt(): string {
    if (this.phase === 'show') return 'WATCH';
    if (this.phase === 'go') return `PLAY IT BACK — ${this.seq.length - this.at} LEFT`;
    return this.lastOk ? 'CLEAN' : 'BROKEN — wrong key';
  }

  progress(): number {
    return this.round / COMBO_ROUNDS;
  }

  keyDown(code: string): void {
    if (this.phase !== 'go') return;
    const k = COMBO_CODES.indexOf(code);
    if (k < 0) return;
    this.litFade[k] = 1;
    if (k !== this.seq[this.at]) {
      this.failed++;
      this.rounds.push(BROKEN_COMBO);
      this.lastOk = false;
      this.phase = 'review';
      this.timer = 0;
      this.round++;
      audio.play('castRefuse', 0.9);
      return;
    }
    audio.play((['castQ', 'castW', 'castE', 'castR'] as const)[k], 0.75);
    this.at++;
    if (this.at >= this.seq.length) {
      const ms = (this.timer - this.startedAt) * 1000;
      // Normalised to a five-key combo so a three and a seven are comparable.
      const n = (ms / this.seq.length) * 5;
      this.norm.push(n);
      this.rounds.push(n);
      this.completed++;
      this.longest = Math.max(this.longest, this.seq.length);
      this.lastOk = true;
      this.phase = 'review';
      this.timer = 0;
      this.round++;
      audio.play('perfect', 0.8);
    }
  }

  update(f: Frame): void {
    const { ctx, w, h } = f;
    this.timer += f.dt;
    for (let i = 0; i < 4; i++) this.litFade[i] = Math.max(0, this.litFade[i] - f.dt * 3);
    floatsUpdate(this.floats, f.dt);

    if (this.phase === 'show') {
      const idx = Math.floor(this.timer / this.stepTime);
      if (idx < this.seq.length) {
        if (idx !== this.at) {
          this.at = idx;
          this.litFade[this.seq[idx]] = 1;
          audio.play('tick', 0.5);
        }
      } else if (this.timer > this.seq.length * this.stepTime + 0.3) {
        this.phase = 'go';
        this.at = 0;
        this.startedAt = this.timer;
        audio.play('go', 0.8);
      }
    } else if (this.phase === 'go' && this.timer - this.startedAt > 6) {
      this.failed++;
      this.rounds.push(BROKEN_COMBO);
      this.lastOk = false;
      this.phase = 'review';
      this.timer = 0;
      this.round++;
    } else if (this.phase === 'review' && this.timer > 0.9) {
      if (this.round < COMBO_ROUNDS) this.build();
    }

    /* -------------------------------------------------------------- draw */
    field(ctx, w, h, C.violet);
    const cx = w / 2;
    const cy = h / 2;

    // The sequence, as a row of slots — filled as you play it back.
    const slot = 46;
    const gap = 10;
    const total = this.seq.length * slot + (this.seq.length - 1) * gap;
    this.seq.forEach((k, i) => {
      const x = cx - total / 2 + i * (slot + gap) + slot / 2;
      const showing = this.phase === 'show' && i <= this.at;
      const played = this.phase === 'go' && i < this.at;
      const revealed = this.phase === 'review' && !this.lastOk;
      const visible = showing || played || revealed;
      keycap(ctx, x, cy - 60, slot, visible ? COMBO_KEYS[k] : '?', {
        // A revealed answer is lit rather than merely shown, so a failed round
        // ends with the sequence you were supposed to play burned onto it.
        lit: showing && i === this.at ? 1 : revealed ? 0.7 : played ? 0.5 : 0,
        color: revealed ? C.danger : C.violet,
        dim: !visible,
      });
    });

    // The bar you actually press, so eyes can stay on the slots.
    const size = 62;
    const bt = COMBO_KEYS.length * size + (COMBO_KEYS.length - 1) * 14;
    COMBO_KEYS.forEach((k, i) => {
      const x = cx - bt / 2 + i * (size + 14) + size / 2;
      keycap(ctx, x, cy + 74, size, k, { lit: this.litFade[i], color: C.cyanHot });
    });

    if (this.phase === 'go') {
      const el = (this.timer - this.startedAt) * 1000;
      text(ctx, `${Math.round(el)}ms`, cx, cy + 148, { size: 20, color: C.faint, font: 'mono' });
    } else if (this.phase === 'review') {
      text(ctx, this.lastOk ? `${Math.round(this.norm[this.norm.length - 1] ?? 0)}ms / 5 KEYS` : 'BROKEN', cx, cy + 148, {
        size: this.lastOk ? 24 : 22,
        color: this.lastOk ? C.good : C.danger,
        font: this.lastOk ? 'mono' : 'display',
        track: this.lastOk ? 0 : 6,
      });
    } else {
      text(ctx, 'WATCH', cx, cy + 148, { size: 20, color: rgba(C.dim, 0.6), track: 8 });
    }

    text(ctx, `ROUND ${Math.min(this.round + 1, COMBO_ROUNDS)} / ${COMBO_ROUNDS}`, cx, 40, {
      size: 11,
      color: C.faint,
      track: 4,
    });
    floatsDraw(ctx, this.floats);
  }

  finished(): boolean {
    return this.round >= COMBO_ROUNDS && this.phase === 'review' && this.timer > 0.9;
  }

  result(): TestResult {
    // A broken combo enters the median at its true cost rather than being
    // dropped: scoring only the sequences you finished would let one lucky
    // fast round outrank eight dead ones.
    const med = this.rounds.length ? median(this.rounds) : BROKEN_COMBO;
    return {
      primary: med,
      trials: this.rounds,
      stats: [
        { label: 'Sequences clean', value: this.completed, format: 'int', direction: 'higher' },
        { label: 'Longest combo', value: this.longest, format: 'int', direction: 'higher' },
        { label: 'Broken', value: this.failed, format: 'int', direction: 'lower' },
      ],
      notes: [
        this.failed > 3
          ? 'You are recalling the sequence one key at a time. Chunk it — three keys is one thing, not three things.'
          : 'You are playing sequences back as units rather than as lists. That is what makes a combo fast.',
        'Times are normalised to five keys, so a three-key round and a seven-key round are the same number.',
      ],
    };
  }
}
