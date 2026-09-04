import { audio } from '../../engine/audio';
import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, pct, units } from '../base';
import { DUMMY_ATTACK, WasdDrill, band } from './engine';

type Phase = 'oppose' | 'orbit' | 'split' | 'fire';

const PHASES: { kind: Phase; name: string; brief: string; share: number }[] = [
  { kind: 'oppose', name: 'OPPOSITION', brief: 'Stand in the zone. Never take your cursor off the mark.', share: 0.3 },
  { kind: 'orbit', name: 'ORBIT', brief: 'Circle it at range with the cursor pinned to it.', share: 0.25 },
  { kind: 'split', name: 'SPLIT', brief: 'It runs one way, you go the other. Move the mouse only to follow it.', share: 0.25 },
  { kind: 'fire', name: 'RETREAT AND FIRE', brief: 'Back away from it, and shoot it on every step.', share: 0.2 },
];

/**
 * WASD 02 — CURSOR INDEPENDENCE.
 *
 * This is the module the whole section exists for.
 *
 * Under a mouse, "where I am going" and "where I am looking" are the same
 * instruction — you click a point and both happen. Direct control severs
 * them, and everything people actually want from the scheme is downstream of
 * that: retreating while shooting forward, circling somebody without ever
 * letting the cursor slide off them, dodging one way while committing an
 * ability the other. None of it is hard once the two hands stop asking each
 * other for permission, and none of it is possible until they do.
 *
 * So the drill measures exactly that, and nothing else: it puts a mark
 * somewhere your cursor has to stay, and then puts everywhere your feet have
 * to be on the far side of it. The headline number is not accuracy or speed —
 * it is the share of the run your hands spent pointing different ways.
 */
export class WasdIndependenceDrill extends WasdDrill {
  protected get moduleWeight(): number {
    return 0.75;
  }

  private mark: Actor | null = null;
  private drift: Vec2 = { x: 1, y: 0 };
  private driftCd = 0;

  private phaseIndex = 0;
  private phaseEnd = 0;

  private zone: { pos: Vec2; radius: number; litAt: number } | null = null;
  private zonesHit = 0;
  private zonesMissed = 0;

  /** Seconds the cursor was on the mark, and the run's total. */
  private onMark = 0;
  private aimSamples = 0;
  /** Cursor distance travelled while it was already on the mark. */
  private wastedTravel = 0;
  private lastCursorPos: Vec2 | null = null;
  private lastMarkPos: Vec2 | null = null;

  private orbitArc = 0;
  private lastAngle: number | null = null;
  private shots = 0;
  private shotsWhileRetreating = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.66 });
    p.maxHp = 3000;
    p.hp = 3000;
    const m = this.s.world.spawnActor({
      pos: { x: w * 0.5, y: h * 0.3 },
      team: 'enemy',
      maxHp: 200000,
      radius: 34,
      moveSpeed: 0,
      attack: { ...DUMMY_ATTACK },
      label: 'MARK',
      immovable: true,
    });
    this.mark = m;
    this.phaseEnd = this.s.config.duration * PHASES[0].share;
  }

  onStart(): void {
    this.s.setBanner(`${PHASES[0].name} · ${PHASES[0].brief}`, 2.6);
    this.newZone();
  }

  private get phase() {
    return PHASES[Math.min(this.phaseIndex, PHASES.length - 1)];
  }

  private advancePhase(): void {
    if (this.phaseIndex >= PHASES.length - 1) return;
    this.phaseIndex++;
    let acc = 0;
    for (let i = 0; i <= this.phaseIndex; i++) acc += PHASES[i].share;
    this.phaseEnd = this.s.config.duration * acc;
    this.s.setBanner(`${this.phase.name} · ${this.phase.brief}`, 2.4);
    audio.play('flowTier', { intensity: 0.7 });
    this.zone = null;
    this.lastAngle = null;
    if (this.phase.kind !== 'orbit') this.newZone();
  }

  // ------------------------------------------------------------------ zones

  /**
   * A zone on the far side of the champion from the mark.
   *
   * The opposition is the whole task, so it is guaranteed rather than left to
   * chance: the zone is placed in the hemisphere pointing away from the mark,
   * which means walking to it and looking at the mark cannot be the same
   * motion however you approach it.
   */
  private newZone(): void {
    const p = this.player;
    const m = this.mark;
    if (!p || !m) return;
    const { w, h } = this.s.world.bounds;
    const away = Math.atan2(p.pos.y - m.pos.y, p.pos.x - m.pos.x);
    const spread = this.phase.kind === 'split' ? 0.55 : 0.85;
    const reach = this.phase.kind === 'split' ? 380 + this.d * 160 : 280 + this.d * 140;
    const radius = 74 - this.d * 22;

    // The zone has to be somewhere you are not already standing.
    //
    // Clamping the candidate into the arena is what makes that a real
    // question: against a corner, the ideal point is outside the floor, the
    // clamp drags it back to the champion's feet, and the zone is completed
    // on the frame it appears — which spawns another one in the same place.
    // A run against a wall used to produce thousands of "tasks" that way. So
    // candidates are tried until one lands clear, and the fallback aims at
    // the middle of the arena, which is always somewhere to walk to.
    let pos: Vec2 | null = null;
    for (let i = 0; i < 24 && !pos; i++) {
      const angle = away + this.s.rng.range(-spread, spread);
      const c = {
        x: clamp(p.pos.x + Math.cos(angle) * reach, 120, w - 120),
        y: clamp(p.pos.y + Math.sin(angle) * reach, 120, h - 120),
      };
      if (dist(c, p.pos) > radius + 150) pos = c;
    }
    if (!pos) {
      const toCentre = Math.atan2(h / 2 - p.pos.y, w / 2 - p.pos.x);
      pos = {
        x: clamp(p.pos.x + Math.cos(toCentre) * reach, 120, w - 120),
        y: clamp(p.pos.y + Math.sin(toCentre) * reach, 120, h - 120),
      };
    }

    this.tasks++;
    this.zone = { pos, radius, litAt: this.s.elapsed };
    audio.play('tick', { intensity: 0.7 });
  }

  // ------------------------------------------------------------------ frame

  protected tickModule(dt: number): void {
    const p = this.player;
    const m = this.mark;
    if (!p || !m) return;
    if (this.s.elapsed >= this.phaseEnd) this.advancePhase();

    this.driftMark(dt, m);
    this.sampleAim(dt, m);

    switch (this.phase.kind) {
      case 'orbit':
        this.tickOrbit(dt, p, m);
        break;
      default:
        this.tickZone(dt, p);
        break;
    }
  }

  /** The mark wanders, so the cursor has real work to do holding it. */
  private driftMark(dt: number, m: Actor): void {
    const { w, h } = this.s.world.bounds;
    this.driftCd -= dt;
    if (this.driftCd <= 0) {
      this.driftCd = this.s.rng.range(0.7, 1.8);
      const a = this.s.rng.next() * Math.PI * 2;
      this.drift = { x: Math.cos(a), y: Math.sin(a) };
    }
    // In the split phase it actively runs, which is what makes "follow it with
    // the mouse only" an instruction with teeth.
    const speed = (this.phase.kind === 'split' ? 210 : 110) * (0.7 + this.d * 0.6);
    m.pos.x = clamp(m.pos.x + this.drift.x * speed * dt, 120, w - 120);
    m.pos.y = clamp(m.pos.y + this.drift.y * speed * dt, 120, h - 120);
    if (m.pos.x <= 121 || m.pos.x >= w - 121) this.drift.x *= -1;
    if (m.pos.y <= 121 || m.pos.y >= h - 121) this.drift.y *= -1;
    m.hp = m.maxHp;
  }

  /**
   * Two numbers at once: whether the cursor is on the mark, and how much the
   * mouse moved while it was already there.
   *
   * The second one is the tell for somebody still steering with the mouse out
   * of habit. If the cursor is on the target and the hand keeps sweeping, that
   * travel is buying nothing — it is the old scheme's reflex firing.
   */
  private sampleAim(dt: number, m: Actor): void {
    const c = this.s.cursorWorld;
    const d = dist(c, m.pos);
    const on = d < m.radius + 46;
    this.aimSamples += dt;
    if (on) this.onMark += dt;
    if (this.lastCursorPos && this.lastMarkPos) {
      const step = dist(this.lastCursorPos, c);
      // The mark moves, so tracking it is travel the drill asked for. Waste is
      // only the part of the sweep that exceeds what following it required —
      // otherwise a player doing exactly the right thing would be billed for
      // every unit the mark drifted.
      const tracked = dist(this.lastMarkPos, m.pos);
      const excess = Math.max(0, step - tracked);
      if (step > 0.5) {
        if (on) this.wastedTravel += excess * clamp(1 - d / (m.radius + 46), 0, 1);
        else this.noteUsefulTravel(step);
      }
    }
    this.lastCursorPos = { x: c.x, y: c.y };
    this.lastMarkPos = { x: m.pos.x, y: m.pos.y };
  }

  private tickZone(_dt: number, p: Actor): void {
    const z = this.zone;
    if (!z) {
      this.newZone();
      return;
    }
    const d = dist(p.pos, z.pos);
    if (d < z.radius) {
      const m = this.mark;
      const onMark = m ? dist(this.s.cursorWorld, m.pos) < m.radius + 46 : false;
      this.zonesHit++;
      if (onMark) {
        this.award(z.pos, {
          value: 140,
          quality: 0.85,
          reaction: (this.s.elapsed - z.litAt) * 1000,
          label: 'HANDS SPLIT',
        });
      } else {
        // Arriving is half the task. Arriving having dragged the cursor along
        // with you is the habit the module is here to break.
        this.solved++;
        this.scoreAcc += 40;
        this.s.micro('CURSOR CAME WITH YOU', p.pos, PALETTE.warn);
      }
      this.zone = null;
      this.newZone();
      return;
    }
    // A zone that has stood for too long is a zone you walked away from.
    if (this.s.elapsed - z.litAt > 6.5) {
      this.zonesMissed++;
      this.penalize(z.pos, 'ZONE LOST', 70);
      this.zone = null;
      this.newZone();
    }
  }

  /**
   * Circling: angular travel around the mark, counted only while the range is
   * held and the cursor is on it. Anything else is walking in a circle.
   */
  private tickOrbit(_dt: number, p: Actor, m: Actor): void {
    const d = dist(p.pos, m.pos);
    const inBand = d > 260 && d < p.attack.range + 60;
    const onMark = dist(this.s.cursorWorld, m.pos) < m.radius + 46;
    const angle = Math.atan2(p.pos.y - m.pos.y, p.pos.x - m.pos.x);
    if (this.lastAngle !== null && inBand && onMark) {
      let step = angle - this.lastAngle;
      while (step > Math.PI) step -= Math.PI * 2;
      while (step < -Math.PI) step += Math.PI * 2;
      // A teleport-sized jump is a phase change, not an arc.
      if (Math.abs(step) < 0.6) {
        this.orbitArc += Math.abs(step);
        // A sixth of a turn, held the whole way round, is one unit of the task.
        // `if` rather than `while`: one arc can only be completed once per
        // step, and a loop here would pay out repeatedly on a single frame.
        if (this.orbitArc > (this.solvedArcs + 1) * (Math.PI / 3)) {
          this.solvedArcs++;
          this.tasks++;
          this.award(p.pos, { value: 110, quality: 0.8, label: '60° HELD' });
        }
      }
    }
    this.lastAngle = angle;
  }

  private solvedArcs = 0;

  onEvents(events: readonly WorldEvent[]): void {
    if (this.phase.kind !== 'fire') return;
    const pid = this.s.world.playerId;
    const p = this.player;
    const m = this.mark;
    if (!p || !m) return;
    for (const e of events) {
      if (e.type !== 'attackRelease' || e.actorId !== pid) continue;
      this.shots++;
      this.tasks++;
      // Was the shot taken while the feet were carrying you away from it?
      const z = this.zone;
      const away = z ? dist(z.pos, m.pos) > dist(p.pos, m.pos) : false;
      const retreating = away || dist(p.pos, m.pos) > p.attack.range * 0.8;
      if (retreating) {
        this.shotsWhileRetreating++;
        this.award(p.pos, { value: 150, quality: 0.85, label: 'FIRED ON THE BACK FOOT' });
      } else {
        this.solved++;
        this.scoreAcc += 45;
        this.s.micro('STOOD AND SHOT', p.pos, PALETTE.warn);
      }
    }
  }

  // ------------------------------------------------------------------ paint

  protected paintModule(out: DrillPaint, t: number): void {
    const p = this.player;
    const m = this.mark;
    if (!p || !m) return;
    const onMark = dist(this.s.cursorWorld, m.pos) < m.radius + 46;

    out.markers.push({
      kind: 'ring',
      x: m.pos.x,
      y: m.pos.y,
      radius: m.radius + 46,
      color: onMark ? PALETTE.good : PALETTE.danger,
      alpha: 0.75,
      width: onMark ? 3 : 2,
      fill: onMark ? 0.1 : 0,
      dash: onMark ? 0 : 20,
      spin: 0.7,
      rise: 0.8,
    });
    out.billboards.push({
      kind: 'label',
      x: m.pos.x,
      y: m.pos.y,
      text: onMark ? 'HELD' : 'CURSOR HERE',
      color: onMark ? PALETTE.good : PALETTE.danger,
      size: 13,
    });

    const z = this.zone;
    if (z) {
      out.markers.push({
        kind: 'ring',
        x: z.pos.x,
        y: z.pos.y,
        radius: z.radius,
        color: PALETTE.accent,
        alpha: 0.8,
        width: 3,
        fill: 0.14,
        dash: 24,
        spin: -0.4,
        rise: 0.7,
      });
      out.billboards.push({
        kind: 'label',
        x: z.pos.x,
        y: z.pos.y,
        text: 'FEET HERE',
        color: PALETTE.accent,
        size: 13,
      });
      // The line between the two tasks, which is the picture of the module.
      out.markers.push({
        kind: 'line',
        x: z.pos.x,
        y: z.pos.y,
        x2: m.pos.x,
        y2: m.pos.y,
        halfWidth: 1.5,
        color: PALETTE.textFaint,
        alpha: 0.2,
        rise: 0.3,
      });
    }

    if (this.phase.kind === 'orbit') {
      out.markers.push({
        kind: 'ring',
        x: m.pos.x,
        y: m.pos.y,
        radius: 260,
        color: PALETTE.warn,
        alpha: 0.3,
        width: 2,
        rise: 0.4,
      });
      out.markers.push({
        kind: 'ring',
        x: m.pos.x,
        y: m.pos.y,
        radius: p.attack.range + 60,
        color: PALETTE.warn,
        alpha: 0.3,
        width: 2,
        rise: 0.4,
      });
    }
    if (this.phase.kind === 'fire') this.paintCadence(out);
    void t;
  }

  // -------------------------------------------------------------------- hud

  private aimUptime(): number {
    return clamp(this.onMark / Math.max(0.5, this.aimSamples), 0, 1);
  }

  private wasteRatio(): number {
    return this.cursorTravel > 200 ? clamp(this.wastedTravel / this.cursorTravel, 0, 1) : 0;
  }

  protected moduleField(): HudField {
    const a = this.aimUptime();
    return {
      label: 'CURSOR ON MARK',
      value: `${Math.round(a * 100)}%`,
      bar: a,
      tone: a > 0.8 ? 'good' : a > 0.55 ? 'warn' : 'bad',
    };
  }

  protected quality(): number {
    const aim = this.aimUptime();
    const answered = this.tasks > 0 ? clamp(this.solved / this.tasks, 0, 1) : 0;
    const indep = this.independence();
    const waste = band(this.wasteRatio(), 0.55, 0.08);
    return clamp(aim * 0.34 + indep * 0.28 + answered * 0.22 + waste * 0.16, 0, 1);
  }

  protected axisSplit(performance: number): Partial<Record<SkillAxis, number>> {
    return {
      movement: performance,
      aim: clamp(this.aimUptime() * 0.6 + performance * 0.4, 0, 1),
      targeting: performance,
    };
  }

  protected moduleMetrics(): KeyMetric[] {
    return [
      pct('aimUptime', 'CURSOR ON MARK', this.aimUptime()),
      pct('zoneRate', 'ZONES REACHED', this.tasks > 0 ? this.solved / this.tasks : 0),
      units('waste', 'CURSOR TRAVEL WASTED', this.wastedTravel),
      count('arcs', '60° ARCS HELD', this.solvedArcs),
      count('retreatShots', 'SHOTS ON THE BACK FOOT', this.shotsWhileRetreating),
      count('zonesLost', 'ZONES LOST', this.zonesMissed, 'lower'),
    ];
  }

  protected notes() {
    const indep = this.independence();
    return {
      helped: indep > 0.5 ? ['Your feet and your cursor spent most of the run disagreeing. That is the whole skill.'] : [],
      hurt:
        indep < 0.25
          ? ['Your cursor followed your feet almost everywhere. That is the click scheme, played on a keyboard.']
          : [],
      advice:
        this.aimUptime() < 0.5
          ? 'Put the cursor on the mark and then forget the mouse exists. Your left hand can solve the zone without it.'
          : indep < 0.3
            ? 'Try it deliberately: hold A and point the cursor right. It feels wrong for about a minute and then it never does again.'
            : this.wasteRatio() > 0.45
              ? 'Your mouse is still steering. It moved a long way while it was already on target — that travel is buying nothing.'
              : null,
    };
  }
}
