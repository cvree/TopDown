import type { BotBehavior } from '../engine/ai';
import { EZREAL_ARCANE, EZREAL_COLOR, EZREAL_STATS, EzrealKit } from '../engine/ezreal';
import type { AbilitySlot } from '../engine/input';
import { clamp, dist, norm } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { AbilityView, HudField } from '../engine/session';
import type { Actor, Vec2 } from '../engine/types';
import type { WorldEvent } from '../engine/world';
import { Drill, band, count, ms, pct, type DrillOutcome } from './base';

/**
 * The Ezreal path.
 *
 * Ten stages of one question asked with steadily less help: *can you aim while
 * you are busy?* Standing still and lining up a shot is not a skill anybody
 * loses games to, so no stage past the first one lets it produce a good score.
 * The headline number is not Q accuracy — it is the share of your landed Qs
 * that left while your own feet were moving.
 *
 * The ladder follows the shape every skill here follows: learn it, isolate it,
 * combine it, do it under pressure, transfer it into a fight, and then be
 * tested on all of it at once.
 *
 *   ezQ        LEARN     travel time and width, against something standing still
 *   ezLead     ISOLATED  the same shot against something that will not
 *   ezStrafe   ISOLATED  the same shot while you are the one moving
 *   ezThread   COMBINED  a gap in a minion wall, which closes
 *   ezWeave    COMBINED  auto, Q out of the backswing, auto
 *   ezMaxRange COMBINED  the outer quarter of the missile, where it is free
 *   ezKite     PRESSURE  something is on you, and it has to still be aimed at
 *   ezShift    PRESSURE  the blink, scored on where it puts you
 *   ezSwitch   TRANSFER  the shot has to move to the target that matters
 *   ezFight    TEST      all of it, against people trying to kill you
 */

export type EzrealDrillId =
  | 'ezQ'
  | 'ezLead'
  | 'ezStrafe'
  | 'ezThread'
  | 'ezWeave'
  | 'ezMaxRange'
  | 'ezKite'
  | 'ezShift'
  | 'ezSwitch'
  | 'ezFight';

export const EZREAL_DRILL_IDS: EzrealDrillId[] = [
  'ezQ',
  'ezLead',
  'ezStrafe',
  'ezThread',
  'ezWeave',
  'ezMaxRange',
  'ezKite',
  'ezShift',
  'ezSwitch',
  'ezFight',
];

/** What each component of the score is worth, per stage. */
interface Weights {
  /** Landing the missile at all. */
  accuracy?: number;
  /** Landing it while your own body was moving. The path's spine. */
  moving?: number;
  /** Landing it on something that was itself moving when you committed. */
  lead?: number;
  /** Weaving the missile into the attack cycle rather than replacing it. */
  weave?: number;
  /** Landing it in the outer quarter of its range. */
  longRange?: number;
  /** Not feeding the missile to whatever is standing in front. */
  thread?: number;
  /** Where the blink put you. */
  shift?: number;
  /** The attack cycle: on time, backswing spent moving, nothing cancelled. */
  timing?: number;
  /** Where you stood relative to both reaches. */
  spacing?: number;
  /** Getting off the old target and onto the new one. */
  switching?: number;
  /** Damage per second of run. */
  damage?: number;
  /** Health kept. */
  survival?: number;
  /** Not being hit by the things aimed at you. */
  dodging?: number;
}

interface StageDef {
  id: EzrealDrillId;
  stage: 'LEARN' | 'ISOLATED' | 'COMBINED' | 'PRESSURE' | 'TRANSFER' | 'TEST';
  duration: number;
  abilities: AbilitySlot[];
  loadout: { mystic?: boolean; flux?: boolean; shift?: boolean };
  weights: Weights;
  /**
   * How many Qs a run is expected to contain. Accuracy over four shots is not
   * accuracy, and without this a player could fire two, hit both, and be
   * scored as perfect.
   */
  expectedCasts: number;
  /** How clearly the range indicators are drawn. Fades along the path. */
  clarity: number;
}

const STAGES: Record<EzrealDrillId, StageDef> = {
  ezQ: {
    id: 'ezQ',
    stage: 'LEARN',
    duration: 45,
    abilities: ['q'],
    loadout: { mystic: true },
    weights: { accuracy: 0.62, longRange: 0.12, damage: 0.14, moving: 0.12 },
    expectedCasts: 9,
    clarity: 1,
  },
  ezLead: {
    id: 'ezLead',
    stage: 'ISOLATED',
    duration: 55,
    abilities: ['q'],
    loadout: { mystic: true },
    weights: { accuracy: 0.34, lead: 0.3, moving: 0.14, longRange: 0.1, damage: 0.12 },
    expectedCasts: 11,
    clarity: 0.85,
  },
  ezStrafe: {
    id: 'ezStrafe',
    stage: 'ISOLATED',
    duration: 60,
    abilities: ['q'],
    loadout: { mystic: true },
    weights: { moving: 0.4, accuracy: 0.2, lead: 0.14, dodging: 0.14, damage: 0.12 },
    expectedCasts: 12,
    clarity: 0.7,
  },
  ezThread: {
    id: 'ezThread',
    stage: 'COMBINED',
    duration: 60,
    abilities: ['q'],
    loadout: { mystic: true },
    weights: { thread: 0.36, accuracy: 0.22, moving: 0.22, damage: 0.1, longRange: 0.1 },
    expectedCasts: 12,
    clarity: 0.6,
  },
  ezWeave: {
    id: 'ezWeave',
    stage: 'COMBINED',
    duration: 60,
    abilities: ['q'],
    loadout: { mystic: true },
    weights: { weave: 0.34, timing: 0.24, accuracy: 0.16, moving: 0.16, damage: 0.1 },
    expectedCasts: 13,
    clarity: 0.5,
  },
  ezMaxRange: {
    id: 'ezMaxRange',
    stage: 'COMBINED',
    duration: 60,
    abilities: ['q'],
    loadout: { mystic: true },
    weights: { longRange: 0.36, accuracy: 0.18, spacing: 0.2, moving: 0.14, damage: 0.12 },
    expectedCasts: 12,
    clarity: 0.45,
  },
  ezKite: {
    id: 'ezKite',
    stage: 'PRESSURE',
    duration: 65,
    abilities: ['q'],
    loadout: { mystic: true },
    weights: { timing: 0.24, moving: 0.24, spacing: 0.16, accuracy: 0.14, survival: 0.14, damage: 0.08 },
    expectedCasts: 12,
    clarity: 0.35,
  },
  ezShift: {
    id: 'ezShift',
    stage: 'PRESSURE',
    duration: 65,
    abilities: ['q', 'e'],
    loadout: { mystic: true, shift: true },
    weights: { shift: 0.3, dodging: 0.22, moving: 0.18, accuracy: 0.14, damage: 0.16 },
    expectedCasts: 11,
    clarity: 0.3,
  },
  ezSwitch: {
    id: 'ezSwitch',
    stage: 'TRANSFER',
    duration: 60,
    abilities: ['q', 'w'],
    loadout: { mystic: true, flux: true },
    weights: { switching: 0.32, accuracy: 0.18, moving: 0.2, lead: 0.14, damage: 0.16 },
    expectedCasts: 12,
    clarity: 0.2,
  },
  ezFight: {
    id: 'ezFight',
    stage: 'TEST',
    duration: 0,
    abilities: ['q', 'w', 'e'],
    loadout: { mystic: true, flux: true, shift: true },
    weights: {
      moving: 0.2,
      timing: 0.16,
      accuracy: 0.12,
      spacing: 0.12,
      shift: 0.1,
      survival: 0.16,
      damage: 0.14,
    },
    expectedCasts: 13,
    clarity: 0,
  },
};

export const ezrealStage = (id: EzrealDrillId): StageDef => STAGES[id];

export const isEzrealDrill = (id: string): id is EzrealDrillId => id in STAGES;

export class EzrealDrill extends Drill {
  readonly def: StageDef;
  readonly kit: EzrealKit;

  /** The unit the stage is currently asking for, if it names one. */
  priorityId = -1;
  private markCd = 0;
  private switchAskedAt = -1;
  private switchTimes: number[] = [];
  private respawnCd = 0;
  private waveCd = 0;
  private hazardCd = 0;
  private kills = 0;
  /** Rolling picture of whether the player is actually driving the champion. */
  private movingTime = 0;
  private totalTime = 0;

  constructor(session: import('../engine/session').Session, id: EzrealDrillId) {
    super(session);
    this.def = STAGES[id];
    this.kit = new EzrealKit(session, this.def.loadout);
  }

  // ----------------------------------------------------------------- setup

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.kit.spawn({ x: w * 0.28, y: h * 0.62 });
    // Every stage runs its full clock. Health is a graded cost, not a fail
    // state — except in the test, where it is the whole point.
    if (this.def.id !== 'ezFight') {
      p.maxHp = 1500;
      p.hp = 1500;
    } else {
      // The test is the one stage health is a fail state on, so it gets enough
      // of it for a competent run to last — and not enough for a careless one.
      p.maxHp = 980;
      p.hp = 980;
    }
    if (this.def.id === 'ezThread' || this.def.id === 'ezFight') this.buildTerrain();

    switch (this.def.id) {
      case 'ezQ':
        this.spawnDummy('strafe', { still: true });
        break;
      case 'ezLead':
        this.spawnDummy('irregular');
        break;
      case 'ezStrafe':
        this.spawnDummy('irregular');
        this.spawnPressure();
        break;
      case 'ezThread':
        this.spawnDummy('retreat');
        this.spawnWave();
        break;
      case 'ezWeave':
        this.spawnDummy('strafe', { close: true });
        break;
      case 'ezMaxRange':
        this.spawnDummy('retreat', { far: true });
        break;
      case 'ezKite':
        this.spawnHunter();
        break;
      case 'ezShift':
        // The threat here is deliberately short-ranged. A blink can only both
        // escape a unit and keep it inside your own reach when its reach is
        // shorter than yours — against something that shells from 880 units
        // "safe and still shooting" is not a place that exists, so scoring a
        // blink against one would be marking an impossible answer wrong.
        this.spawnDummy('strafe');
        this.spawnHunter();
        break;
      case 'ezSwitch':
        this.spawnDummy('irregular');
        this.spawnDummy('strafe');
        this.spawnDummy('bait');
        this.pickPriority();
        break;
      case 'ezFight':
        // Something that wants to be on top of you, something that will not
        // hold a line, zones landing on the ground you are standing on, and a
        // wave in the way. This is the stage the other nine exist to make
        // survivable.
        this.spawnHunter();
        this.spawnDummy('erratic');
        this.spawnWave();
        break;
    }
  }

  /** Two pillars, so threading and blinking both have geometry to work with. */
  private buildTerrain(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.walls = [
      { x: w * 0.52, y: h * 0.24, w: 70, h: 260 },
      { x: w * 0.52, y: h * 0.78, w: 70, h: 260 },
    ];
  }

  private spawnDummy(behavior: BotBehavior, opts: { still?: boolean; close?: boolean; far?: boolean } = {}): Actor {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const want = opts.close ? 430 : opts.far ? 900 : 720;
    const at = p
      ? { x: clamp(p.pos.x + want, 120, w - 120), y: clamp(p.pos.y - this.s.rng.range(-220, 220), 120, h - 120) }
      : { x: w * 0.7, y: h * 0.5 };
    const a = this.spawnEnemy('ranger', at, { hpScale: 2.6, behavior });
    a.attack.range = 300;
    a.attack.damage = this.def.id === 'ezQ' || this.def.id === 'ezLead' ? 0 : 22;
    a.label = 'TARGET';
    const brain = this.lastBrain;
    if (brain) {
      brain.preferredRange = opts.close ? 320 : opts.far ? 880 : 620;
      if (opts.still) brain.preferredRange = 700;
    }
    if (opts.still) {
      a.moveSpeed = 0;
    } else {
      a.moveSpeed = 210 + this.s.config.difficulty * 120;
    }
    return a;
  }

  /** Something that will not let the player stand still. */
  private spawnPressure(): Actor {
    const pos = this.randomPoint(this.s.world.player?.pos ?? null, 780, 140);
    const a = this.spawnEnemy('artillery', pos, { hpScale: 1.6, behavior: 'retreat' });
    a.attack.damage = 26;
    a.label = 'SHELLER';
    // Inside the missile's reach on purpose. A shelling unit that sits outside
    // everything you own is a hazard generator, not an opponent, and there is
    // nothing to practise against one.
    const brain = this.lastBrain;
    if (brain) brain.preferredRange = 640;
    return a;
  }

  /** Something that is coming for you specifically. */
  private spawnHunter(): Actor {
    const pos = this.randomPoint(this.s.world.player?.pos ?? null, 620, 150);
    const a = this.spawnEnemy('diver', pos, { hpScale: 1.15, behavior: 'diver' });
    a.moveSpeed = 176 + this.s.config.difficulty * 84;
    a.attack.damage = 24 + this.s.config.difficulty * 22;
    a.label = 'HUNTER';
    return a;
  }

  /** A line of bodies between you and what you want to hit. */
  private spawnWave(): void {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const cx = p ? clamp(p.pos.x + 380, 200, w - 200) : w * 0.5;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = this.s.world.spawnActor({
        pos: { x: cx + this.s.rng.range(-40, 40), y: h * 0.2 + ((i + 0.5) * h * 0.6) / n },
        team: 'enemy',
        maxHp: 190,
        radius: 24,
        moveSpeed: 60,
        isMinion: true,
        unitKind: 'melee',
        label: 'MINION',
        attack: { attackSpeed: 0.6, windupRatio: 0.3, backswingRatio: 0.3, range: 130, damage: 8, projectileSpeed: 0 },
      });
      a.order = { kind: 'attackMove', pos: { x: a.pos.x - 700, y: a.pos.y } };
    }
  }

  private pickPriority(): void {
    const champs = this.s.world.enemies().filter((e) => !e.isMinion);
    if (!champs.length) return;
    const next = this.s.rng.pick(champs.filter((e) => e.id !== this.priorityId).length ? champs.filter((e) => e.id !== this.priorityId) : champs);
    this.priorityId = next.id;
    this.switchAskedAt = this.s.elapsed;
    this.markCd = this.s.rng.range(6, 9) - this.s.config.difficulty * 1.6;
    this.s.fx.ring(next.pos.x, next.pos.y, next.radius + 6, next.radius + 76, 0.5, PALETTE.warn, 3, 'shock');
    this.s.micro('SWITCH', next.pos, PALETTE.warn);
  }

  // ---------------------------------------------------------------- runtime

  onStart(): void {
    this.s.setBanner(this.def.stage, 1.2);
  }

  update(dt: number): void {
    this.kit.update(dt);
    this.updateBrains(dt);

    const p = this.s.world.player;
    if (p) {
      this.totalTime += dt;
      if (Math.hypot(p.vel.x, p.vel.y) > 20) this.movingTime += dt;
    }

    if (this.def.id === 'ezSwitch') {
      this.markCd -= dt;
      const cur = this.s.world.byId(this.priorityId);
      if (this.markCd <= 0 || !cur || !cur.alive) this.pickPriority();
    }

    // Keep the field populated. A stage that empties itself stops teaching.
    const champs = this.s.world.enemies().filter((e) => !e.isMinion);
    const wanted = this.def.id === 'ezSwitch' ? 3 : this.def.id === 'ezShift' || this.def.id === 'ezFight' ? 2 : 1;
    if (champs.length < wanted) {
      this.respawnCd -= dt;
      if (this.respawnCd <= 0) {
        this.respawnCd = 1.4;
        if (this.def.id === 'ezKite') this.spawnHunter();
        else if (this.def.id === 'ezFight') {
          if (champs.length === 0) this.spawnHunter();
          else this.spawnDummy('erratic');
        } else if (this.def.id === 'ezShift' && champs.length >= 1) this.spawnHunter();
        else this.spawnDummy(this.def.id === 'ezMaxRange' ? 'retreat' : 'irregular', { far: this.def.id === 'ezMaxRange' });
      }
    }

    if (this.def.id === 'ezThread' || this.def.id === 'ezFight') {
      this.waveCd -= dt;
      const minions = this.s.world.enemies().filter((e) => e.isMinion);
      if (minions.length < 2 && this.waveCd <= 0) {
        this.waveCd = 5;
        this.spawnWave();
      }
    }

    // Pressure stages drop zones on the player's feet, so "stand still and
    // aim" is not a position anybody can hold.
    if (this.def.id === 'ezStrafe' || this.def.id === 'ezShift' || this.def.id === 'ezFight') {
      this.hazardCd -= dt;
      if (this.hazardCd <= 0 && p) {
        this.hazardCd = (this.def.id === 'ezShift' ? 2.0 : 2.2) - this.s.config.difficulty * 0.6;
        const lead = this.s.rng.range(0.15, 0.5);
        this.s.world.spawnHazard({
          pos: { x: p.pos.x + p.vel.x * lead, y: p.pos.y + p.vel.y * lead },
          team: 'enemy',
          shape: 'circle',
          radius: 128,
          warn: 0.95 - this.s.config.difficulty * 0.25,
          active: 0.3,
          damage: 52,
          color: PALETTE.hazard,
        });
      }
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    this.kit.onEvents(events);
    for (const e of events) {
      if (e.type === 'death' && e.byPlayer) {
        const victim = this.s.world.byId(e.actorId);
        if (!victim?.isMinion) this.kills++;
        if (this.def.id === 'ezSwitch' && e.actorId === this.priorityId) this.pickPriority();
      }
      // The switch clock stops on the first damage the new target takes.
      if (
        this.def.id === 'ezSwitch' &&
        e.type === 'attackLand' &&
        e.actorId === this.s.world.playerId &&
        e.targetId === this.priorityId &&
        this.switchAskedAt >= 0
      ) {
        this.switchTimes.push((this.s.elapsed - this.switchAskedAt) * 1000);
        this.s.metrics.noteTargetSwitch((this.s.elapsed - this.switchAskedAt) * 1000);
        this.switchAskedAt = -1;
      }
    }
    if (this.def.id === 'ezFight' && this.s.world.enemies().filter((x) => !x.isMinion).length === 0 && this.kills >= 4) {
      this.endReason = 'complete';
      this.s.forceEnd = true;
    }
  }

  onAbility(slot: AbilitySlot, at: Vec2): void {
    this.kit.cast(slot, at);
  }

  abilities(): AbilityView[] {
    return this.kit.bar(super.abilities());
  }

  // ------------------------------------------------------------------ paint

  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    const c = this.def.clarity;

    if (c > 0.05) {
      // How far the missile reaches. Drawn plainly at the start of the path
      // and progressively not at all, because the range of your own Q is
      // something you are supposed to end up knowing.
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: EZREAL_STATS.qRange,
        color: EZREAL_COLOR,
        alpha: 0.16 * c,
        width: 2.5,
        dash: 90,
        spin: 0.05,
        rise: 1.2,
      });
      // The outer quarter, where the shot is free.
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: EZREAL_STATS.qRange * 0.75,
        color: PALETTE.good,
        alpha: 0.1 * c,
        width: 2,
        dash: 60,
        spin: -0.05,
        rise: 1.2,
      });
    }

    if (this.def.id === 'ezSwitch') {
      const cur = this.s.world.byId(this.priorityId);
      if (cur && cur.alive) {
        out.billboards.push({ kind: 'caret', x: cur.pos.x, y: cur.pos.y, color: PALETTE.warn, lift: 74 });
      }
    }

    for (const e of this.s.world.enemies()) {
      if (this.kit.hasMark(e.id)) {
        out.markers.push({
          kind: 'ring',
          x: e.pos.x,
          y: e.pos.y,
          radius: e.radius + 16 + 3 * Math.sin(t * 7),
          color: EZREAL_ARCANE,
          alpha: 0.6,
          width: 3,
          rise: 1.6,
        });
      }
    }

    // The blink's landing, briefly, so where it put you is visible rather than
    // something you have to infer from the score afterwards.
    const shift = this.kit.lastShift;
    if (shift && this.s.world.time - shift.at < 0.6) {
      const a = 1 - (this.s.world.time - shift.at) / 0.6;
      out.markers.push({
        kind: 'line',
        x: shift.from.x,
        y: shift.from.y,
        x2: shift.to.x,
        y2: shift.to.y,
        halfWidth: 8,
        color: EZREAL_ARCANE,
        alpha: 0.4 * a,
        rise: 1.5,
      });
    }
  }

  // -------------------------------------------------------------------- hud

  hudFields(): HudField[] {
    const st = this.kit.stats;
    const d = derive(this.s.metrics.m);
    const acc = this.kit.accuracy;
    const moving = this.kit.movingAccuracy;
    const fields: HudField[] = [
      { label: 'Q ACCURACY', value: `${Math.round(acc * 100)}%`, bar: acc, tone: acc > 0.6 ? 'good' : acc > 0.38 ? 'warn' : 'bad' },
      {
        label: 'ON THE MOVE',
        value: `${Math.round(moving * 100)}%`,
        bar: moving,
        tone: moving > 0.65 ? 'good' : moving > 0.4 ? 'warn' : 'bad',
      },
    ];
    switch (this.def.id) {
      case 'ezThread':
        fields.push({ label: 'BLOCKED', value: `${st.qBlocked}`, tone: st.qBlocked > 3 ? 'bad' : 'good' });
        break;
      case 'ezWeave':
        fields.push({ label: 'WEAVES', value: `${st.weaveCycles}`, tone: 'good' });
        break;
      case 'ezMaxRange':
        fields.push({ label: 'MAX RANGE', value: `${st.qHitsLong}/${st.qHits}`, tone: 'good' });
        break;
      case 'ezShift':
        fields.push({ label: 'SHIFTS', value: `${st.eKeptRange}/${st.eCasts}`, tone: 'good' });
        break;
      case 'ezSwitch':
        fields.push({ label: 'SWITCH', value: `${Math.round(this.avgSwitch())}ms`, tone: this.avgSwitch() < 900 ? 'good' : 'warn' });
        break;
      default:
        fields.push({
          label: 'LATE',
          value: `${Math.round(d.attackLatency)}ms`,
          bar: d.attackPunctuality,
          tone: d.attackLatency < 110 ? 'good' : 'warn',
        });
        break;
    }
    return fields;
  }

  private avgSwitch(): number {
    if (!this.switchTimes.length) return 2000;
    return this.switchTimes.reduce((a, b) => a + b, 0) / this.switchTimes.length;
  }

  liveScore(): number {
    const st = this.kit.stats;
    const m = this.s.metrics.m;
    return Math.max(
      0,
      Math.round(
        m.damageDealt * 6 +
          st.qHitsMoving * 420 +
          (st.qHits - st.qHitsMoving) * 150 +
          st.qHitsLong * 160 +
          st.weaveCycles * 200 +
          st.eKeptRange * 260 +
          this.kills * 1400 -
          st.qBlocked * 220 -
          st.qWastedWindup * 260 -
          m.hpLost * 2,
      ),
    );
  }

  // ---------------------------------------------------------------- outcome

  outcome(): DrillOutcome {
    const st = this.kit.stats;
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? 700);
    const w = this.def.weights;

    const attempts = Math.max(0, st.qCasts - st.qBlocked);
    const accuracy = attempts > 0 ? clamp(st.qHits / attempts, 0, 1) : 0;
    // Share *and* count. A share alone is free for anybody who never stands
    // still: a player firing at random while running in circles lands two Qs
    // by accident, both while moving, and reads as 100% "landed on the move".
    // The harness found exactly that scoring 54% on the kiting stage. Landing
    // them on the move has to mean landing a real number of them.
    const movingShare = st.qHits > 0 ? clamp(st.qHitsMoving / st.qHits, 0, 1) : 0;
    const moving = movingShare * band(st.qHitsMoving, 0, Math.max(3, this.def.expectedCasts * 0.45));
    const lead = st.qHits > 0 ? clamp(st.qHitsOnMovers / st.qHits, 0, 1) : 0;
    const longRange = st.qHits > 0 ? clamp(st.qHitsLong / st.qHits, 0, 1) : 0;
    const thread = st.qCasts > 0 ? clamp(1 - st.qBlocked / st.qCasts, 0, 1) : 0;
    const weave = band(st.weaveCycles, 1, Math.max(4, this.def.expectedCasts * 0.55));
    // Getting out is most of a blink's value; getting out and still being able
    // to shoot is the rest of it. A blink that ends inside somebody's range
    // scores nothing at all, which is the correct price for a thirteen-second
    // cooldown spent moving into the thing you were escaping.
    const shift = st.eCasts > 0 ? clamp((st.eToSafety * 0.6 + st.eKeptRange * 0.4) / st.eCasts, 0, 1) : 0;
    // Poke stages are played from outside your own auto range on purpose, so
    // the pocket is the wrong question there. What is asked instead is simply
    // whether anything could ever reach you.
    const standoff = band(d.overstepRate, 0.3, 0.02);
    const switching = this.switchTimes.length ? band(this.avgSwitch(), 1800, 420) : 0;
    const damage = band(m.damageDealt / Math.max(1, this.s.elapsed), 14, 58);
    const dodging = clamp(d.dodgeRate * 0.5 + band(m.hazardExposure, 6, 0.2) * 0.5, 0, 1);

    const parts: [number | undefined, number][] = [
      [w.accuracy, accuracy],
      [w.moving, moving],
      [w.lead, lead],
      [w.weave, weave],
      [w.longRange, longRange],
      [w.thread, thread],
      [w.shift, shift],
      [w.timing, d.attackTiming],
      [w.spacing, this.def.id === 'ezMaxRange' ? standoff : d.advantageousSpacing],
      [w.switching, switching],
      [w.damage, damage],
      [w.survival, d.hpRetained],
      [w.dodging, dodging],
    ];
    let raw = 0;
    let total = 0;
    for (const [weight, value] of parts) {
      if (weight === undefined) continue;
      raw += weight * value;
      total += weight;
    }
    raw = total > 0 ? raw / total : 0;

    // Two gates, both multiplicative, both there because the alternative is a
    // player who fires three perfect shots from a standstill and is told they
    // are elite.
    //
    // Volume: accuracy over a handful of casts is not a measurement.
    // Presence: a champion nobody is driving does not get to be graded on aim.
    const volume = band(st.qCasts, 1, this.def.expectedCasts);
    const driving = this.totalTime > 1 ? clamp(this.movingTime / this.totalTime, 0, 1) : 0;
    const presence = this.def.stage === 'LEARN' ? 1 : band(driving, 0.12, 0.5);
    const performance = clamp(raw * (0.42 + 0.58 * volume) * (0.45 + 0.55 * presence), 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (movingShare > 0.75 && st.qHits > 6) helped.push(`${Math.round(movingShare * 100)}% of your Qs left while you were moving.`);
    if (longRange > 0.4) helped.push('You are hitting at the far end of the missile, where it is free.');
    if (st.weaveCycles > 6) helped.push(`${st.weaveCycles} clean auto-Q weaves.`);
    if (st.qBlocked === 0 && st.qCasts > 8) helped.push('Nothing ate a single one of your Qs.');
    if (st.eKeptRange > 0 && st.eKeptRange === st.eCasts) helped.push('Every blink left you out of their reach and inside your own.');
    if (movingShare < 0.4 && st.qHits > 4) hurt.push('Most of your Qs were fired standing still. That is the shot nobody has to dodge.');
    if (st.qWastedWindup > 2) hurt.push(`${st.qWastedWindup} autos thrown away by pressing Q mid-windup.`);
    if (st.qBlocked > 3) hurt.push(`${st.qBlocked} Qs eaten by something that was not your target.`);
    if (accuracy < 0.4 && st.qCasts > 6) hurt.push(`${Math.round(accuracy * 100)}% accuracy — you are firing where they are, not where they will be.`);
    if (driving < 0.3 && this.def.stage !== 'LEARN') hurt.push('You barely moved. Every score on this path is gated on that.');
    if (st.eIntoDanger > 0) hurt.push(`${st.eIntoDanger} blinks that ended inside somebody's range.`);

    const advice =
      driving < 0.3 && this.def.stage !== 'LEARN'
        ? 'Aim while you move. A stationary Ezreal lands more Qs and loses more games — every stage past the first is weighted to say so.'
        : movingShare < 0.45 && st.qHits > 4
          ? 'Stop planting your feet to aim. Commit the direction while you are already travelling; the cast time roots you for a quarter second either way.'
          : accuracy < 0.45
            ? 'Lead them. The missile takes half a second to cross its own range — aim at where they will be when it arrives.'
            : st.qWastedWindup > 2
              ? 'Q out of the backswing, never out of the windup. The auto is already paid for by then.'
              : 'This is the shape. Take it to the next stage and keep the feet moving.';

    const metrics = [
      pct('qAcc', 'Q ACCURACY', accuracy),
      pct('qMoving', 'LANDED ON THE MOVE', movingShare),
      count('qHits', 'MYSTIC SHOTS LANDED', st.qHits),
    ];
    if (w.lead) metrics.push(pct('qLead', 'LANDED ON A MOVER', lead));
    if (w.longRange) metrics.push(pct('qLong', 'LANDED AT MAX RANGE', longRange));
    if (w.thread) metrics.push(count('qBlocked', 'QS BLOCKED', st.qBlocked, 'lower'));
    if (w.weave) metrics.push(count('weaves', 'AUTO-Q WEAVES', st.weaveCycles));
    if (w.shift) metrics.push(pct('shift', 'BLINKS THAT PAID', shift));
    if (w.switching) metrics.push(ms('switch', 'SWITCH SPEED', this.avgSwitch()));
    if (w.timing) metrics.push(pct('timing', 'ATTACK TIMING', d.attackTiming));
    if (w.spacing) metrics.push(pct('advantage', 'ADVANTAGEOUS SPACING', d.advantageousSpacing));
    metrics.push(count('damage', 'DAMAGE DEALT', Math.round(m.damageDealt)));

    return {
      score: this.liveScore(),
      performance,
      axisPerformance: {
        skillshot: clamp(accuracy * 0.5 + movingShare * 0.3 + lead * 0.2, 0, 1),
        aim: clamp(accuracy * 0.6 + longRange * 0.4, 0, 1),
        movement: clamp(driving, 0, 1),
        ...(w.timing ? { kiting: d.attackTiming } : {}),
        ...(w.spacing ? { spacing: d.advantageousSpacing } : {}),
        ...(w.switching ? { targeting: switching } : {}),
        ...(this.def.stage === 'TEST' ? { combat: performance } : {}),
      },
      keyMetrics: metrics,
      helped,
      hurt,
      advice,
      effectiveDifficulty:
        this.def.stage === 'TEST' ? this.s.config.difficulty * 0.25 + 0.75 * this.s.config.difficulty + 0.08 : undefined,
    };
  }
}

/** Direction from `a` to `b`, unit length. Shared by the stages that draw one. */
export const towards = (a: Vec2, b: Vec2): Vec2 => norm(b.x - a.x, b.y - a.y);

/** Distance helper kept here so the stages do not each import the maths. */
export const gap = (a: Actor, b: Actor): number => dist(a.pos, b.pos) - a.radius - b.radius;
