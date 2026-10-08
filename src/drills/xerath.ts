import type { BotBehavior } from '../engine/ai';
import type { AbilitySlot } from '../engine/input';
import { clamp, dist, distToSegment, norm } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { AbilityView, HudField } from '../engine/session';
import {
  XER_BLUE,
  XER_CORE,
  XER_VIOLET,
  XERATH_STATS,
  XerathKit,
  chargeFor,
  type Blast,
  type XerathLoadout,
} from '../engine/xerath';
import type { Actor, Vec2 } from '../engine/types';
import type { WorldEvent } from '../engine/world';
import { Drill, band, count, pct, secs, type DrillOutcome } from './base';

/**
 * The Xerath path.
 *
 * Nine stages of the question every other path assumes the answer to: *how far
 * away are you when you hit?* Xerath has the longest reach in this client and
 * the slowest feet, and everything he casts lands a beat after he casts it —
 * so a Xerath who is good is two things at once, and both are spacing. He is
 * standing where nobody can reach him, and he is aiming at where they will be.
 *
 * The number the path leads with depends on the stage, but it is always one of
 * those two: pulses landed, centres landed, orbs landed far enough out to
 * matter, time spent in the band between their reach and yours.
 *
 *   xerPulse   LEARN     the charge is the range — let go the moment it reaches
 *   xerEye     ISOLATED  three quarters of a second: aim where they will be
 *   xerOrb     ISOLATED  the farther it flies, the longer they sleep
 *   xerEdge    COMBINED  live in the band: outside their reach, inside yours
 *   xerCombo   COMBINED  stun first, and everything after it is free
 *   xerRetreat PRESSURE  charge while you walk away from somebody
 *   xerRite    PRESSURE  four shots from across the map, rooted
 *   xerWave    TRANSFER  a lane: over the wave with the pulse, never into it with the orb
 *   xerFight   TEST      all of it, against people trying to reach you
 */

export type XerathDrillId =
  | 'xerPulse'
  | 'xerEye'
  | 'xerOrb'
  | 'xerEdge'
  | 'xerCombo'
  | 'xerRetreat'
  | 'xerRite'
  | 'xerWave'
  | 'xerFight';

export const XERATH_DRILL_IDS: XerathDrillId[] = [
  'xerPulse',
  'xerEye',
  'xerOrb',
  'xerEdge',
  'xerCombo',
  'xerRetreat',
  'xerRite',
  'xerWave',
  'xerFight',
];

/** What each component of the score is worth, per stage. */
interface Weights {
  /** Pulses that landed on a champion. */
  pulse?: number;
  /** Pulses let go when they reached rather than held. */
  release?: number;
  /** Eyes that landed, and how many of them on the centre. */
  eye?: number;
  centre?: number;
  /** Orbs that reached a champion, and how far they flew to do it. */
  orb?: number;
  stun?: number;
  /** Time spent outside their reach and inside yours. */
  band?: number;
  /** Dives you let happen. Graded as the share you did not. */
  safe?: number;
  /** Stun, then everything: full combos. */
  combo?: number;
  /** Divers stopped by an orb before they arrived. */
  stop?: number;
  /** Rite shots that landed. */
  rite?: number;
  /** Orbs that a minion did not take. */
  clean?: number;
  /** Damage dealt against damage taken. */
  trade?: number;
  damage?: number;
  survival?: number;
}

interface StageDef {
  id: XerathDrillId;
  stage: 'LEARN' | 'ISOLATED' | 'COMBINED' | 'PRESSURE' | 'TRANSFER' | 'TEST';
  duration: number;
  abilities: AbilitySlot[];
  loadout: XerathLoadout;
  /**
   * Cooldowns this stage brings down, by slot — the same contract the other
   * kits have: a stage about one ability has to contain enough attempts at it
   * to be a rep. Everything else about the ability is League's.
   */
  practice?: Partial<Record<'q' | 'w' | 'e' | 'r', number>>;
  weights: Weights;
  /** How many of the stage's own act a run is expected to contain. */
  expected: number;
  /** How clearly the ranges and the band are drawn. Fades along the path. */
  clarity: number;
  /**
   * How often a body inside a telegraph sees it and walks, at the lowest and
   * highest difficulty. The jukes are the reason the path teaches leading
   * and holding rather than aiming at where somebody is standing.
   */
  juke: [number, number];
}

const STAGES: Record<XerathDrillId, StageDef> = {
  xerPulse: {
    id: 'xerPulse',
    stage: 'LEARN',
    duration: 45,
    abilities: ['q'],
    loadout: { arcanopulse: true },
    practice: { q: 2.5 },
    weights: { pulse: 0.5, release: 0.32, damage: 0.18 },
    expected: 9,
    clarity: 1,
    juke: [0.05, 0.3],
  },
  xerEye: {
    id: 'xerEye',
    stage: 'ISOLATED',
    duration: 50,
    abilities: ['w'],
    loadout: { eye: true },
    practice: { w: 2.5 },
    weights: { centre: 0.46, eye: 0.34, damage: 0.2 },
    expected: 10,
    clarity: 0.85,
    juke: [0.15, 0.55],
  },
  xerOrb: {
    id: 'xerOrb',
    stage: 'ISOLATED',
    duration: 50,
    abilities: ['e'],
    loadout: { orb: true },
    practice: { e: 3 },
    weights: { orb: 0.46, stun: 0.32, clean: 0.22 },
    expected: 9,
    clarity: 0.8,
    juke: [0, 0],
  },
  xerEdge: {
    id: 'xerEdge',
    stage: 'COMBINED',
    duration: 60,
    abilities: ['q', 'w'],
    loadout: { arcanopulse: true, eye: true },
    weights: { band: 0.36, safe: 0.24, pulse: 0.24, release: 0.08, damage: 0.08 },
    expected: 6,
    clarity: 0.7,
    juke: [0.1, 0.4],
  },
  xerCombo: {
    id: 'xerCombo',
    stage: 'COMBINED',
    duration: 60,
    abilities: ['q', 'w', 'e'],
    loadout: { arcanopulse: true, eye: true, orb: true },
    // The orb is the bottleneck on purpose: the Eye and the pulse come back
    // twice for every stun, so a player who throws them whenever they are up
    // throws half of them at a body that can walk.
    practice: { q: 2.5, w: 2.5, e: 5 },
    weights: { combo: 0.46, orb: 0.2, centre: 0.14, pulse: 0.1, damage: 0.1 },
    expected: 7,
    clarity: 0.6,
    // The slippery one: anything thrown at a body that can walk is walked out
    // of, more often than not. A body that cannot walk cannot.
    juke: [0.55, 0.9],
  },
  xerRetreat: {
    id: 'xerRetreat',
    stage: 'PRESSURE',
    duration: 45,
    abilities: ['q', 'w', 'e'],
    loadout: { arcanopulse: true, eye: true, orb: true },
    // One orb per diver: the stage is about where the orb lands, and a diver
    // that arrives while it is down is a lesson about cooldowns instead.
    practice: { e: 5 },
    weights: { stop: 0.3, survival: 0.28, stun: 0.12, pulse: 0.14, damage: 0.16 },
    expected: 6,
    clarity: 0.45,
    juke: [0.1, 0.4],
  },
  xerRite: {
    id: 'xerRite',
    stage: 'PRESSURE',
    duration: 40,
    abilities: ['r'],
    loadout: { rite: true },
    practice: { r: 8 },
    weights: { rite: 0.7, damage: 0.3 },
    expected: 12,
    clarity: 0.4,
    juke: [0.2, 0.6],
  },
  xerWave: {
    id: 'xerWave',
    stage: 'TRANSFER',
    duration: 60,
    abilities: ['q', 'w', 'e'],
    loadout: { arcanopulse: true, eye: true, orb: true },
    weights: { trade: 0.36, pulse: 0.18, orb: 0.14, survival: 0.18, damage: 0.14 },
    expected: 6,
    clarity: 0.2,
    juke: [0.15, 0.5],
  },
  xerFight: {
    id: 'xerFight',
    stage: 'TEST',
    duration: 0,
    abilities: ['q', 'w', 'e', 'r'],
    loadout: { arcanopulse: true, eye: true, orb: true, rite: true },
    practice: { r: 12 },
    weights: { pulse: 0.14, centre: 0.08, orb: 0.12, band: 0.16, safe: 0.1, survival: 0.22, damage: 0.18 },
    expected: 8,
    clarity: 0,
    juke: [0.2, 0.6],
  },
};

export const xerathStage = (id: XerathDrillId): StageDef => STAGES[id];

export const isXerathDrill = (id: string): id is XerathDrillId => id in STAGES;

/**
 * The reach of whoever is hunting him: the distance from which they can walk
 * and dash onto him before he can do anything about it. Drawn on the floor as
 * a red ring around them, with his own fourteen hundred and fifty around them
 * in blue — and the floor between the two is the band he lives in.
 */
export const THREAT_RANGE = 700;
/** What a dive costs when it arrives. */
const DIVE_DAMAGE = 140;
/** How long inside the ring before the dive goes. */
const DIVE_TELL = 0.45;
/** How fast it closes the last of the gap, in units a second. */
const DIVE_SPEED = 1400;

/** One dodge in progress: a body that saw the telegraph, and where it is going. */
interface Juke {
  until: number;
  to: Vec2;
}

/** The hunter on the band stages: what it is doing about you. */
interface Threat {
  id: number;
  /** Seconds you have been inside its ring. */
  inside: number;
  /** The dash, while it is happening. */
  dash: { to: Vec2 } | null;
  /** Backing off after a dive, until this time. */
  backUntil: number;
}

export class XerathDrill extends Drill {
  readonly def: StageDef;
  readonly kit: XerathKit;

  /** The champion the stage is built around, when there is exactly one. Public for the clips and the harness. */
  focusId = -1;
  /** The hunter on the band stages. */
  threat: Threat | null = null;

  /** Bodies mid-dodge, by id. Their brains are not consulted until it ends. */
  private jukes = new Map<number, Juke>();
  /** Which blasts each body has already decided about. */
  private decided = new Set<string>();
  private seenResults = 0;
  private seenOrb: XerathKit['lastOrb'] = null;
  /** Orbs that landed on a champion, and what followed inside the stun. */
  private combos: { targetId: number; at: number; until: number; centre: boolean; pulse: boolean; done: boolean }[] = [];
  private respawnCd = 0;
  private waveCd = 0;
  private diverCd = 0;
  private reloadCd = 0;
  private kills = 0;
  private dives = 0;
  /** Divers that an orb caught before they arrived. */
  private stopped = 0;
  private diversSent = 0;
  /** Seconds in the band, and seconds that counted toward it. */
  private bandTime = 0;
  private bandClock = 0;
  private dealtToChamps = 0;
  private takenFromChamps = 0;

  constructor(session: import('../engine/session').Session, id: XerathDrillId) {
    super(session);
    this.def = STAGES[id];
    this.kit = new XerathKit(session, this.def.loadout, this.def.practice ?? {});
  }

  // ----------------------------------------------------------------- setup

  setup(): void {
    const { w, h } = this.s.world.bounds;
    // The stages with somebody hunting him start him mid-floor, with room to
    // back away in every direction; the benches start him at one end, facing
    // the length of the floor his reach needs.
    const hunted = this.def.id === 'xerEdge' || this.def.id === 'xerRetreat';
    const p = this.kit.spawn(hunted ? { x: w * 0.45, y: h * 0.5 } : { x: w * 0.24, y: h * 0.55 });
    if (this.def.id !== 'xerFight') {
      p.maxHp = 1500;
      p.hp = 1500;
    } else {
      p.maxHp = 1000;
      p.hp = 1000;
    }
    if (this.def.id === 'xerFight') this.buildTerrain();

    switch (this.def.id) {
      case 'xerPulse':
        this.focusId = this.spawnTarget('strafe', this.pulseDistance(), true).id;
        break;
      case 'xerEye':
        this.focusId = this.spawnTarget('irregular', 760, true).id;
        break;
      case 'xerOrb':
        this.focusId = this.spawnTarget('strafe', 900, true).id;
        this.waveCd = 2;
        break;
      case 'xerEdge':
        this.spawnThreat(1150);
        break;
      case 'xerCombo':
        this.focusId = this.spawnTarget('strafe', 700, true).id;
        break;
      case 'xerRetreat':
        this.diverCd = 1.4;
        break;
      case 'xerRite':
        for (let i = 0; i < 2; i++) this.spawnRunner();
        break;
      case 'xerWave':
        this.focusId = this.spawnMage().id;
        this.spawnWave(5, 520);
        this.waveCd = 6;
        break;
      case 'xerFight':
        this.spawnThreat(1250);
        this.focusId = this.spawnMage().id;
        this.spawnWave(4, 560);
        this.waveCd = 7;
        break;
    }
  }

  /** Two pillars to hide a pulse behind, and to be cornered against. */
  private buildTerrain(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.walls = [
      { x: w * 0.5, y: h * 0.2, w: 90, h: 240 },
      { x: w * 0.5, y: h * 0.8, w: 90, h: 240 },
    ];
  }

  /** How far the next pulse target stands: anywhere the charge has to think about. */
  private pulseDistance(): number {
    return this.s.rng.range(780, 1360);
  }

  /** Somebody to hit. Endless and harmless before the pressure stages. */
  private spawnTarget(behavior: BotBehavior, range: number, harmless: boolean): Actor {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const ang = this.s.rng.range(-0.5, 0.5);
    const at = p
      ? { x: clamp(p.pos.x + Math.cos(ang) * range, 140, w - 140), y: clamp(p.pos.y + Math.sin(ang) * range, 140, h - 140) }
      : { x: w * 0.7, y: h * 0.5 };
    const a = this.spawnEnemy('duelist', at, { hpScale: 2.4, behavior });
    a.attack.damage = harmless ? 0 : 10 + this.s.config.difficulty * 10;
    a.label = 'TARGET';
    a.maxHp = 60000;
    a.hp = 60000;
    const brain = this.lastBrain;
    if (brain) {
      brain.preferredRange = range;
      brain.signature = false;
    }
    a.moveSpeed = 220 + this.s.config.difficulty * 150;
    return a;
  }

  /** The band stages' hunter: walks at you, and dives you if you let it in. */
  private spawnThreat(range: number): Actor {
    const p = this.s.world.player;
    const at = p ? this.awayFrom(p.pos, range) : { x: this.s.world.bounds.w * 0.75, y: this.s.world.bounds.h * 0.5 };
    // It stalks rather than chases: it hovers just outside its own reach and
    // then commits, for a couple of seconds at a time, at full pace. Holding
    // the band is answering the commits — backing off as it comes and
    // stepping back up to range when it settles — not outrunning it forever.
    const a = this.spawnEnemy('diver', at, { hpScale: 1.4, behavior: 'diver' });
    a.label = 'ASSASSIN';
    a.attack.damage = 0;
    if (this.def.stage !== 'TEST') {
      a.maxHp = 60000;
      a.hp = 60000;
    }
    // Slower than he walks, faster than he charges: the band can be kept on
    // foot, and it cannot be kept while standing still holding Q.
    a.moveSpeed = 245 + this.s.config.difficulty * 70;
    const brain = this.lastBrain;
    if (brain) {
      brain.preferredRange = THREAT_RANGE + 160;
      brain.signature = false;
    }
    this.threat = { id: a.id, inside: 0, dash: null, backUntil: 0 };
    return a;
  }

  /** A point this far from somewhere, on the far side of the arena from the nearest wall. */
  private awayFrom(from: Vec2, range: number): Vec2 {
    const { w, h } = this.s.world.bounds;
    for (let i = 0; i < 30; i++) {
      const ang = this.s.rng.range(0, Math.PI * 2);
      const c = { x: from.x + Math.cos(ang) * range, y: from.y + Math.sin(ang) * range };
      if (c.x > 140 && c.x < w - 140 && c.y > 140 && c.y < h - 140) return c;
    }
    return this.randomPoint(from, range * 0.7, 140);
  }

  /** A diver on the retreat stage: fragile, fast, and coming for you. */
  private spawnDiver(): Actor {
    const p = this.s.world.player;
    const at = p ? this.awayFrom(p.pos, 1150) : this.edgePoint();
    const a = this.spawnEnemy('diver', at, { hpScale: 1, behavior: 'chase' });
    a.label = 'DIVER';
    a.maxHp = 380 + this.s.config.difficulty * 120;
    a.hp = a.maxHp;
    a.attack.damage = 20 + this.s.config.difficulty * 18;
    a.moveSpeed = 300 + this.s.config.difficulty * 60;
    const brain = this.lastBrain;
    if (brain) {
      brain.preferredRange = 80;
      brain.signature = false;
    }
    this.diversSent++;
    return a;
  }

  /** A low champion running for home, somewhere across the map: the Rite's prey. */
  private spawnRunner(): Actor {
    const p = this.s.world.player;
    const at = p ? this.awayFrom(p.pos, this.s.rng.range(1100, 1700)) : this.randomPoint(null, 0, 160);
    const a = this.spawnEnemy('duelist', at, { hpScale: 1, behavior: 'irregular' });
    a.label = 'LOW';
    a.maxHp = 260;
    a.hp = 200;
    a.attack.damage = 0;
    // Running, and running fast — a shot at their feet lands where they were.
    a.moveSpeed = 320 + this.s.config.difficulty * 130;
    const brain = this.lastBrain;
    if (brain) {
      brain.preferredRange = dist(at, p?.pos ?? at);
      brain.signature = false;
    }
    return a;
  }

  /** The lane's other mage: holds its own range behind its wave and shoots you if you step into it. */
  private spawnMage(): Actor {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const at = { x: clamp((p?.pos.x ?? w * 0.25) + 1050, 200, w - 160), y: clamp((p?.pos.y ?? h / 2) + this.s.rng.range(-120, 120), 160, h - 160) };
    const a = this.spawnEnemy('ranger', at, { hpScale: 1.2, behavior: 'tether', anchor: at, leash: 260 });
    a.label = 'MAGE';
    a.attack.damage = 34 + this.s.config.difficulty * 20;
    if (this.def.stage !== 'TEST') {
      a.maxHp = 60000;
      a.hp = 60000;
    }
    const brain = this.lastBrain;
    if (brain) brain.preferredRange = 540;
    return a;
  }

  /** A line of minions across the way, walking at him. */
  private spawnWave(n: number, ahead: number): void {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const cx = p ? clamp(p.pos.x + ahead, 220, w - 220) : w * 0.55;
    const cy = p ? p.pos.y : h * 0.5;
    for (let i = 0; i < n; i++) {
      const a = this.s.world.spawnActor({
        pos: { x: cx + this.s.rng.range(-26, 26), y: clamp(cy + (i - (n - 1) / 2) * 90, 120, h - 120) },
        team: 'enemy',
        maxHp: 300,
        radius: 24,
        moveSpeed: 60,
        isMinion: true,
        unitKind: i % 2 ? 'caster' : 'melee',
        label: 'MINION',
        attack: { attackSpeed: 0.6, windupRatio: 0.3, backswingRatio: 0.3, range: 120, damage: 5, projectileSpeed: 0 },
      });
      a.order = { kind: 'attackMove', pos: { x: a.pos.x - 420, y: a.pos.y } };
    }
  }

  /**
   * The orb stage's minions: three of them walking across the line between
   * him and the target, rather than at him. They are in the way some of the
   * time and never all of it, so a clear line is something you wait or step
   * for, and a blocked orb is a choice.
   */
  private spawnCrossing(): void {
    const p = this.s.world.player;
    const t = this.s.world.byId(this.focusId);
    const { h } = this.s.world.bounds;
    if (!p) return;
    const mid = t ? { x: (p.pos.x + t.pos.x) / 2, y: (p.pos.y + t.pos.y) / 2 } : { x: p.pos.x + 450, y: p.pos.y };
    const down = this.s.rng.chance(0.5);
    for (let i = 0; i < 3; i++) {
      const y = down ? 90 : h - 90;
      const a = this.s.world.spawnActor({
        pos: { x: mid.x + (i - 1) * 70, y },
        team: 'enemy',
        maxHp: 300,
        radius: 24,
        moveSpeed: 150,
        isMinion: true,
        unitKind: i % 2 ? 'caster' : 'melee',
        label: 'MINION',
        attack: { attackSpeed: 0.6, windupRatio: 0.3, backswingRatio: 0.3, range: 120, damage: 0, projectileSpeed: 0 },
      });
      a.order = { kind: 'move', pos: { x: a.pos.x, y: down ? h - 60 : 60 } };
    }
  }

  // ---------------------------------------------------------------- runtime

  onStart(): void {
    this.s.setBanner(this.def.stage, 1.2, { key: 'stage' });
  }

  update(dt: number): void {
    this.kit.update(dt);
    this.stepJukes();
    this.stepBrains(dt);
    this.stepThreat(dt);
    this.pollResults();
    this.pollOrb();

    const p = this.s.world.player;
    const t = this.s.world.byId(this.threat?.id ?? -1);
    if (p && t && t.alive) {
      this.bandClock += dt;
      const d = dist(p.pos, t.pos);
      if (d >= THREAT_RANGE && d <= XERATH_STATS.qMaxRange) this.bandTime += dt;
    }

    if (this.def.id === 'xerRetreat' || (this.def.id === 'xerFight' && this.kills >= 2)) this.stepDivers(dt);
    this.repopulate(dt);

    if (this.def.id === 'xerOrb' || this.def.id === 'xerWave' || this.def.id === 'xerFight') {
      this.waveCd -= dt;
      const minions = this.s.world.enemies().filter((e) => e.isMinion);
      if (this.def.id === 'xerOrb') {
        // A crossing minion that has crossed is gone: it walked off the floor.
        for (const m of minions) {
          if (m.pos.y < 80 || m.pos.y > this.s.world.bounds.h - 80) {
            if (!m.order || dist(m.pos, m.order.pos) < 40) {
              m.alive = false;
              m.hp = 0;
            }
          }
        }
      }
      if (minions.filter((m) => m.alive).length < 2 && this.waveCd <= 0) {
        this.waveCd = this.def.id === 'xerOrb' ? 5 : 7;
        // On the orb stage the wave drifts across the line rather than at
        // him: it is there to be thrown around, not through.
        if (this.def.id === 'xerOrb') this.spawnCrossing();
        else this.spawnWave(5, 520);
      }
    }
  }

  /** Brains, except for anybody halfway through walking out of a telegraph or a dive. */
  private stepBrains(dt: number): void {
    const now = this.s.world.time;
    for (const b of this.brains) {
      const j = this.jukes.get(b.actor.id);
      if (j && now < j.until && b.actor.rootedFor <= 0) {
        b.actor.order = { kind: 'move', pos: j.to };
        continue;
      }
      if (j) this.jukes.delete(b.actor.id);
      if (this.threat && b.actor.id === this.threat.id && (this.threat.dash || now < this.threat.backUntil)) continue;
      b.update(this.s.world, dt);
    }
    for (let i = this.brains.length - 1; i >= 0; i--) {
      if (!this.brains[i].actor.alive) this.brains.splice(i, 1);
    }
  }

  /**
   * THE JUKE.
   *
   * Every telegraph he puts down is drawn for them as well as for you, and a
   * body inside one may see it and walk — once per blast, after a reaction,
   * by the shortest way out. What that buys the path: a pulse at somebody
   * standing in the middle of a long line still lands, the centre of an Eye
   * does not unless it was led, and nothing thrown at a stunned body is ever
   * walked out of. Which is the whole reason the combo stage exists.
   */
  private stepJukes(): void {
    const now = this.s.world.time;
    const d = this.s.config.difficulty;
    const [lo, hi] = this.def.juke;
    const chance = lo + (hi - lo) * d;
    if (chance <= 0) return;
    const reaction = 0.42 - 0.2 * d;
    for (const b of this.kit.blasts) {
      if (now - b.castAt < reaction) continue;
      for (const a of this.s.world.enemies()) {
        if (a.isMinion || a.rootedFor > 0) continue;
        const key = `${b.id}:${a.id}`;
        if (this.decided.has(key)) continue;
        const out = this.escapeFrom(b, a);
        if (!out) continue;
        this.decided.add(key);
        if (!this.s.rng.chance(chance)) continue;
        this.jukes.set(a.id, { until: b.firesAt + 0.05, to: out });
      }
    }
    if (this.decided.size > 400) this.decided.clear();
  }

  /** The nearest point outside a blast, if this body is inside it (or its centre). */
  private escapeFrom(b: Blast, a: Actor): Vec2 | null {
    const margin = a.radius + 40;
    if (b.shape === 'circle') {
      const g = dist(a.pos, b.to);
      if (g > b.radius + a.radius) return null;
      const away = g < 1 ? { x: 1, y: 0 } : norm(a.pos.x - b.to.x, a.pos.y - b.to.y);
      return { x: b.to.x + away.x * (b.radius + margin), y: b.to.y + away.y * (b.radius + margin) };
    }
    if (distToSegment(a.pos, b.from, b.to) > b.radius + a.radius) return null;
    const dir = norm(b.to.x - b.from.x, b.to.y - b.from.y);
    const side = (a.pos.x - b.from.x) * dir.y - (a.pos.y - b.from.y) * dir.x >= 0 ? 1 : -1;
    const perp = { x: dir.y * side, y: -dir.x * side };
    const along = (a.pos.x - b.from.x) * dir.x + (a.pos.y - b.from.y) * dir.y;
    const foot = { x: b.from.x + dir.x * along, y: b.from.y + dir.y * along };
    return { x: foot.x + perp.x * (b.radius + margin), y: foot.y + perp.y * (b.radius + margin) };
  }

  /**
   * The hunter's dive.
   *
   * It walks at him at a pace he can outwalk — but not while he charges, at
   * half his speed. Inside its ring for a beat and it goes: a dash, a hit, and
   * a walk back out to try again. Stunned, it does nothing at all.
   */
  private stepThreat(dt: number): void {
    const th = this.threat;
    if (!th) return;
    const t = this.s.world.byId(th.id);
    const p = this.s.world.player;
    if (!t || !t.alive || !p || !p.alive) return;
    const now = this.s.world.time;

    if (th.dash) {
      const to = th.dash.to;
      const g = dist(t.pos, p.pos);
      const step = DIVE_SPEED * dt;
      if (g <= p.radius + t.radius + 20 || t.rootedFor > 0) {
        th.dash = null;
        if (t.rootedFor <= 0) {
          this.s.world.damage(p, DIVE_DAMAGE + this.s.config.difficulty * 80, t);
          this.dives++;
          this.s.micro('DIVED', p.pos, PALETTE.danger);
          this.s.fx.badFlash(0.2, PALETTE.danger);
        }
        th.backUntil = now + 1.8;
        const away = norm(t.pos.x - p.pos.x, t.pos.y - p.pos.y);
        t.order = { kind: 'move', pos: { x: t.pos.x + away.x * 900, y: t.pos.y + away.y * 900 } };
        th.inside = 0;
        return;
      }
      void to;
      const d = norm(p.pos.x - t.pos.x, p.pos.y - t.pos.y);
      this.s.world.place(t, t.pos.x + d.x * Math.min(step, g), t.pos.y + d.y * Math.min(step, g));
      t.order = null;
      return;
    }
    if (now < th.backUntil) return;
    if (t.rootedFor > 0) {
      th.inside = 0;
      return;
    }
    const g = dist(t.pos, p.pos);
    if (g < THREAT_RANGE) th.inside += dt;
    else th.inside = Math.max(0, th.inside - dt * 2);
    if (th.inside >= DIVE_TELL) {
      th.dash = { to: { ...p.pos } };
      this.s.fx.ring(t.pos.x, t.pos.y, t.radius, t.radius + 80, 0.3, PALETTE.danger, 4, 'shock');
    }
  }

  /** The retreat stage: one diver at a time, from somewhere across the floor. */
  private stepDivers(dt: number): void {
    this.diverCd -= dt;
    const live = this.s.world.enemies().filter((e) => !e.isMinion && e.label === 'DIVER').length;
    if (this.diverCd > 0 || live > 1) return;
    this.diverCd = 6.5 - this.s.config.difficulty * 2;
    this.spawnDiver();
    this.s.setBanner('INCOMING', 1, { tone: 'critical', key: 'incoming' });
  }

  /** Keep the field populated. A stage that empties itself stops teaching. */
  private repopulate(dt: number): void {
    const champs = this.s.world.enemies().filter((e) => !e.isMinion);
    if (this.def.id === 'xerPulse') {
      // A pulse target changes distance every few seconds, so no two pulses
      // need the same charge.
      this.reloadCd -= dt;
      const t = this.s.world.byId(this.focusId);
      if (this.reloadCd <= 0 && t) {
        this.reloadCd = 5;
        const brain = this.brains.find((b) => b.actor.id === t.id);
        if (brain) brain.preferredRange = this.pulseDistance();
      }
    }
    if (this.def.id === 'xerRite') {
      if (champs.length >= 2) return;
      this.respawnCd -= dt;
      if (this.respawnCd > 0) return;
      this.respawnCd = 0.6;
      this.spawnRunner();
      return;
    }
    if (this.def.id === 'xerRetreat') return;
    this.respawnCd -= dt;
    if (this.respawnCd > 0) return;
    const alive = (label: string) => champs.some((c) => c.label === label);
    switch (this.def.id) {
      case 'xerPulse':
      case 'xerEye':
      case 'xerOrb':
      case 'xerCombo':
        if (alive('TARGET')) return;
        this.focusId =
          this.def.id === 'xerPulse'
            ? this.spawnTarget('strafe', this.pulseDistance(), true).id
            : this.def.id === 'xerEye'
              ? this.spawnTarget('irregular', 760, true).id
              : this.spawnTarget('strafe', this.def.id === 'xerOrb' ? 900 : 700, true).id;
        break;
      case 'xerEdge':
        if (alive('ASSASSIN')) return;
        this.spawnThreat(1150);
        break;
      case 'xerWave':
        if (alive('MAGE')) return;
        this.focusId = this.spawnMage().id;
        break;
      case 'xerFight':
        if (!alive('MAGE')) this.focusId = this.spawnMage().id;
        else if (!alive('ASSASSIN')) this.spawnThreat(1250);
        else return;
        break;
      default:
        return;
    }
    this.respawnCd = 1.4;
  }

  /** A blast landed: whatever the stage wants to know about it. */
  private pollResults(): void {
    const all = this.kit.results;
    const n = Math.min(this.kit.resolved - this.seenResults, all.length);
    if (n <= 0) return;
    this.seenResults = this.kit.resolved;
    const fresh = all.slice(all.length - n);
    const p = this.s.world.player;
    for (const r of fresh) {
      // On the Eye's bench a centre's slow would make the next Eye easy: a
      // body crawling at forty per cent needs no leading. Every Eye there is
      // asked of a body at full pace.
      if (this.def.id === 'xerEye') {
        for (const id of r.champions) {
          const a = this.s.world.byId(id);
          if (a) {
            a.slowFor = 0;
            a.slowFactor = 1;
          }
        }
      }
      for (const c of this.combos) {
        if (c.done || !r.champions.includes(c.targetId) || r.blast.castAt > c.until) continue;
        if (r.blast.kind === 'w' && r.centre) c.centre = true;
        if (r.blast.kind === 'q') c.pulse = true;
        if (c.centre && c.pulse) {
          c.done = true;
          if (p) this.s.micro('COMBO', p.pos, XER_BLUE);
        }
      }
      if (p && r.champions.length > 0) {
        const tag = r.blast.kind === 'w' && r.centre ? 'CENTRE' : r.blast.kind === 'r' ? 'HIT' : r.held > 0 ? 'HELD' : null;
        if (tag) this.s.micro(tag, r.blast.to, r.blast.kind === 'r' ? XER_VIOLET : XER_BLUE);
      }
      if (p && r.short) this.s.micro('SHORT', r.blast.to, PALETTE.warn);
    }
  }

  /** An orb landed: the combo it opens, and whether it stopped a dive. */
  private pollOrb(): void {
    const o = this.kit.lastOrb;
    if (!o || o === this.seenOrb) return;
    this.seenOrb = o;
    if (!o.champion) return;
    this.combos.push({ targetId: o.targetId, at: o.at, until: o.at + o.stun + 0.3, centre: false, pulse: false, done: false });
    const t = this.s.world.byId(o.targetId);
    const p = this.s.world.player;
    // Stopped: the diver was still well out when the orb caught it.
    if (t && p && t.label === 'DIVER' && dist(t.pos, p.pos) > 420) this.stopped++;
  }

  onEvents(events: readonly WorldEvent[]): void {
    this.kit.onEvents(events);
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type === 'death' && e.byPlayer) {
        const victim = this.s.world.byId(e.actorId);
        if (victim && !victim.isMinion) {
          this.kills++;
          if (this.threat && victim.id === this.threat.id) this.threat = null;
        }
      }
      if (e.type === 'damage') {
        const target = this.s.world.byId(e.targetId);
        const source = this.s.world.byId(e.actorId);
        if (e.actorId === pid && target && !target.isMinion) this.dealtToChamps += e.amount ?? 0;
        if (e.targetId === pid && source && !source.isMinion) this.takenFromChamps += e.amount ?? 0;
      }
    }
    if (this.def.id === 'xerFight' && this.kills >= 5) {
      this.endReason = 'complete';
      this.s.forceEnd = true;
    }
  }

  onAbility(slot: AbilitySlot, at: Vec2): void {
    if (this.summoner(slot, at)) return;
    this.kit.cast(slot, at);
  }

  onAbilityRelease(slot: AbilitySlot, at: Vec2): void {
    this.kit.release(slot, at);
  }

  abilities(): AbilityView[] {
    return this.kit.bar(super.abilities());
  }

  // ------------------------------------------------------------------ paint

  /**
   * THE RANGES, ON THE FLOOR.
   *
   * Xerath is a champion of distances, so this path draws them where they
   * are: the pulse growing out of him while it charges, with the length it
   * has reached printed at the end of it; every telegraph he has put down,
   * closing on the moment it lands; and — on the stages with a hunter — the
   * hunter's reach in red and his own in blue, around the hunter, so the band
   * between them is a place on the floor you can stand in.
   */
  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    const c = this.def.clarity;
    const now = this.s.world.time;
    const cur = this.s.cursorWorld;

    // The charge: the line, as long as it is now, and how far it could go.
    if (this.kit.charge) {
      const reach = this.kit.reachNow;
      const d = norm(cur.x - p.pos.x, cur.y - p.pos.y);
      const full = this.kit.held >= XERATH_STATS.qChargeTime;
      out.markers.push({
        kind: 'line',
        x: p.pos.x,
        y: p.pos.y,
        x2: p.pos.x + d.x * reach,
        y2: p.pos.y + d.y * reach,
        halfWidth: XERATH_STATS.qHalfWidth,
        color: full ? PALETTE.warn : XER_BLUE,
        alpha: 0.32,
        fill: 0.12,
        rise: 1.3,
      });
      out.markers.push({ kind: 'ring', x: p.pos.x, y: p.pos.y, radius: reach, color: XER_BLUE, alpha: 0.5, width: 5, dash: 90, rise: 1.2 });
      out.markers.push({ kind: 'ring', x: p.pos.x, y: p.pos.y, radius: XERATH_STATS.qMaxRange, color: XER_BLUE, alpha: 0.2 + 0.15 * c, width: 4, dash: 140, rise: 1 });
      const left = clamp((XERATH_STATS.qHoldLimit - this.kit.held) / (XERATH_STATS.qHoldLimit - XERATH_STATS.qChargeTime), 0, 1);
      out.billboards.push({
        kind: 'timerBar',
        x: p.pos.x,
        y: p.pos.y,
        progress: full ? left : this.kit.held / XERATH_STATS.qChargeTime,
        color: full ? PALETTE.warn : XER_BLUE,
        lift: 112,
        width: 120,
      });
      if (c > 0.3) {
        out.billboards.push({
          kind: 'label',
          x: p.pos.x + d.x * reach,
          y: p.pos.y + d.y * reach,
          text: full ? 'LET GO' : `${Math.round(reach)}`,
          color: full ? PALETTE.warn : XER_CORE,
          size: 13,
          lift: 40,
        });
      }
    }

    // Everything he has put down and is waiting on.
    for (const b of this.kit.blasts) {
      const total = Math.max(0.01, b.firesAt - b.castAt);
      const left = clamp((b.firesAt - now) / total, 0, 1);
      const color = b.kind === 'r' ? XER_VIOLET : XER_BLUE;
      if (b.shape === 'line') {
        out.markers.push({ kind: 'line', x: b.from.x, y: b.from.y, x2: b.to.x, y2: b.to.y, halfWidth: b.radius, color, alpha: 0.5, fill: 0.2, progress: 1 - left, rise: 1.4 });
      } else {
        out.markers.push({ kind: 'ring', x: b.to.x, y: b.to.y, radius: b.radius, color, alpha: 0.55, width: 3, fill: 0.08, progress: 1 - left, rise: 1.4 });
        if (b.kind === 'w') out.markers.push({ kind: 'disc', x: b.to.x, y: b.to.y, radius: XERATH_STATS.wCentre, color: XER_CORE, alpha: 0.35, rise: 1.5 });
        out.markers.push({ kind: 'ring', x: b.to.x, y: b.to.y, radius: b.radius * left, color, alpha: 0.3, width: 2, rise: 1.45 });
      }
    }

    // The aim, while the path is still drawing it: the orb's lane and the Eye's circle under the cursor.
    if (c > 0.5 && !this.kit.busy) {
      if (this.kit.loadout.orb && this.kit.eCd <= 0) {
        const d = norm(cur.x - p.pos.x, cur.y - p.pos.y);
        out.markers.push({
          kind: 'line',
          x: p.pos.x,
          y: p.pos.y,
          x2: p.pos.x + d.x * XERATH_STATS.eRange,
          y2: p.pos.y + d.y * XERATH_STATS.eRange,
          halfWidth: XERATH_STATS.eRadius,
          color: XER_BLUE,
          alpha: 0.12 * c,
          rise: 1.05,
        });
      }
      if (this.kit.loadout.eye && this.kit.wCd <= 0) {
        const g = Math.min(dist(p.pos, cur), XERATH_STATS.wRange);
        const d = norm(cur.x - p.pos.x, cur.y - p.pos.y);
        const at = { x: p.pos.x + d.x * g, y: p.pos.y + d.y * g };
        out.markers.push({ kind: 'ring', x: at.x, y: at.y, radius: XERATH_STATS.wRadius, color: XER_BLUE, alpha: 0.16 * c, width: 2, dash: 30, rise: 1.05 });
        out.markers.push({ kind: 'ring', x: at.x, y: at.y, radius: XERATH_STATS.wCentre, color: XER_CORE, alpha: 0.3 * c, width: 2, rise: 1.05 });
      }
    }

    // His own reach, faint, while the path draws it.
    if (c > 0.05 && !this.kit.charge) {
      if (this.kit.loadout.arcanopulse) {
        out.markers.push({ kind: 'ring', x: p.pos.x, y: p.pos.y, radius: XERATH_STATS.qMaxRange, color: XER_BLUE, alpha: 0.08 * c, width: 2, dash: 140, spin: 0.03, rise: 1 });
        out.markers.push({ kind: 'ring', x: p.pos.x, y: p.pos.y, radius: XERATH_STATS.qMinRange, color: XER_BLUE, alpha: 0.08 * c, width: 1.5, dash: 80, spin: -0.03, rise: 1 });
      }
      if (this.kit.loadout.eye) {
        out.markers.push({ kind: 'ring', x: p.pos.x, y: p.pos.y, radius: XERATH_STATS.wRange, color: XER_CORE, alpha: 0.07 * c, width: 1.5, dash: 100, rise: 1 });
      }
    }

    // The band: the hunter's reach, and his own, around the hunter.
    const th = this.threat;
    const hunter = th ? this.s.world.byId(th.id) : undefined;
    if (th && hunter && hunter.alive) {
      const g = dist(p.pos, hunter.pos);
      const inside = g < THREAT_RANGE;
      const inBand = !inside && g <= XERATH_STATS.qMaxRange;
      out.markers.push({
        kind: 'ring',
        x: hunter.pos.x,
        y: hunter.pos.y,
        radius: THREAT_RANGE,
        color: PALETTE.danger,
        // Drawn heavy: at League's camera a thin ring on stone is invisible,
        // and this ring is the whole stage.
        alpha: inside ? 0.85 : 0.6,
        width: inside ? 12 : 8,
        fill: inside ? 0.1 : 0.05,
        dash: 48,
        spin: 0.15,
        progress: inside ? 1 - clamp(th.inside / DIVE_TELL, 0, 1) : undefined,
        rise: 1.1,
      });
      out.markers.push({
        kind: 'ring',
        x: hunter.pos.x,
        y: hunter.pos.y,
        radius: XERATH_STATS.qMaxRange,
        color: inBand ? PALETTE.good : XER_BLUE,
        alpha: inBand ? 0.6 : 0.3 + 0.2 * c,
        width: 7,
        dash: 120,
        spin: -0.05,
        rise: 1.05,
      });
      if (c > 0.15 || inside) {
        out.billboards.push({
          kind: 'label',
          x: p.pos.x,
          y: p.pos.y,
          text: inside ? 'TOO CLOSE' : inBand ? 'IN THE BAND' : 'TOO FAR',
          color: inside ? PALETTE.danger : inBand ? PALETTE.good : PALETTE.warn,
          size: 12,
          sub: `${Math.round(g)}`,
          lift: 150,
        });
      }
    }

    // The Rite: where the next shot would land, and the shots left.
    if (this.kit.rite) {
      out.markers.push({ kind: 'ring', x: cur.x, y: cur.y, radius: XERATH_STATS.rRadius, color: XER_VIOLET, alpha: 0.5, width: 3, dash: 24, spin: 1.4, rise: 1.3 });
      out.markers.push({ kind: 'ring', x: p.pos.x, y: p.pos.y, radius: p.radius + 24 + 4 * Math.sin(t * 9), color: XER_VIOLET, alpha: 0.7, width: 3, rise: 1.5 });
      out.billboards.push({
        kind: 'label',
        x: p.pos.x,
        y: p.pos.y,
        text: `${this.kit.rite.shotsLeft} LEFT`,
        color: XER_VIOLET,
        size: 13,
        lift: 140,
      });
    }

    // On the pulse stage: how far the target is, so the charge it needs is a number before it is a feel.
    if (this.def.id === 'xerPulse' && c > 0.5) {
      const tg = this.s.world.byId(this.focusId);
      if (tg && tg.alive) {
        out.billboards.push({ kind: 'label', x: tg.pos.x, y: tg.pos.y, text: `${Math.round(dist(tg.pos, p.pos))}`, color: XER_CORE, size: 11, lift: 120 });
      }
    }
  }

  // -------------------------------------------------------------------- hud

  private combosDone(): number {
    return this.combos.filter((c) => c.done).length;
  }

  private bandShare(): number {
    return this.bandClock > 1 ? clamp(this.bandTime / this.bandClock, 0, 1) : 0;
  }

  hudFields(): HudField[] {
    const st = this.kit.stats;
    const fields: HudField[] = [];
    switch (this.def.id) {
      case 'xerPulse':
        fields.push({ label: 'PULSES LANDED', value: `${st.qHits}/${st.qCasts}`, bar: this.kit.pulseRate, tone: this.kit.pulseRate > 0.6 ? 'good' : 'warn' });
        fields.push({ label: 'HELD TOO LONG', value: `${this.kit.overcharge.toFixed(2)}s`, tone: this.kit.overcharge < 0.25 ? 'good' : 'bad' });
        break;
      case 'xerEye':
        fields.push({ label: 'CENTRES', value: `${st.wCentre}/${st.wCasts}`, bar: this.kit.centreRate, tone: this.kit.centreRate > 0.4 ? 'good' : 'warn' });
        fields.push({ label: 'EYES LANDED', value: `${st.wHits}`, tone: 'neutral' });
        break;
      case 'xerOrb':
        fields.push({ label: 'ORBS LANDED', value: `${st.eHits}/${st.eCasts}`, bar: this.kit.orbRate, tone: this.kit.orbRate > 0.5 ? 'good' : 'warn' });
        fields.push({ label: 'AVERAGE STUN', value: `${this.kit.stunAvg.toFixed(2)}s`, tone: this.kit.stunAvg > 1.4 ? 'good' : 'neutral' });
        break;
      case 'xerEdge':
      case 'xerFight': {
        const share = this.bandShare();
        fields.push({ label: 'IN THE BAND', value: `${Math.round(share * 100)}%`, bar: share, tone: share > 0.6 ? 'good' : share > 0.35 ? 'warn' : 'bad' });
        fields.push({ label: 'DIVED', value: `${this.dives}`, tone: this.dives === 0 ? 'good' : 'bad' });
        fields.push({ label: 'PULSES LANDED', value: `${st.qHits}/${st.qCasts}`, tone: 'neutral' });
        break;
      }
      case 'xerCombo':
        fields.push({ label: 'COMBOS', value: `${this.combosDone()}/${this.combos.length}`, tone: this.combosDone() > 0 ? 'good' : 'neutral' });
        fields.push({ label: 'ORBS LANDED', value: `${st.eHits}/${st.eCasts}`, tone: 'neutral' });
        break;
      case 'xerRetreat':
        fields.push({ label: 'DIVERS STOPPED', value: `${this.stopped}/${this.diversSent}`, tone: this.stopped > 0 ? 'good' : 'neutral' });
        fields.push({ label: 'AVERAGE STUN', value: `${this.kit.stunAvg.toFixed(2)}s`, tone: 'neutral' });
        break;
      case 'xerRite':
        fields.push({ label: 'SHOTS LANDED', value: `${st.rHits}/${st.rShots}`, bar: this.kit.riteRate, tone: this.kit.riteRate > 0.5 ? 'good' : 'warn' });
        fields.push({ label: 'KILLS', value: `${this.kills}`, tone: 'neutral' });
        break;
      case 'xerWave': {
        const ratio = this.tradeRatio();
        fields.push({ label: 'TRADE', value: `${Math.round(this.dealtToChamps)} : ${Math.round(this.takenFromChamps)}`, bar: ratio, tone: ratio > 0.6 ? 'good' : 'warn' });
        fields.push({ label: 'ORBS BLOCKED', value: `${st.eBlocked}`, tone: st.eBlocked === 0 ? 'good' : 'bad' });
        break;
      }
    }
    return fields;
  }

  /** Damage dealt to champions as a share of all champion damage exchanged. */
  private tradeRatio(): number {
    const total = this.dealtToChamps + this.takenFromChamps;
    return total > 0 ? this.dealtToChamps / total : 0;
  }

  liveScore(): number {
    const st = this.kit.stats;
    const m = this.s.metrics.m;
    return Math.max(
      0,
      Math.round(
        m.damageDealt * 4 +
          st.qHits * 380 +
          st.wHits * 220 +
          st.wCentre * 420 +
          st.eHits * 360 +
          st.eStunSum * 200 +
          st.rHits * 520 +
          st.followUps * 260 +
          this.combosDone() * 900 +
          this.stopped * 800 +
          this.kills * 1200 +
          this.bandTime * 60 -
          this.dives * 700 -
          st.qFizzles * 400 -
          st.eBlocked * 150 -
          m.hpLost * 2,
      ),
    );
  }

  /** The stage's own count, scaled to the run's clock (see the Katarina path). */
  private expected(): number {
    const own = this.def.duration;
    const run = this.s.config.duration;
    if (own <= 0 || run <= 0 || run >= own) return this.def.expected;
    return Math.max(2, this.def.expected * clamp(run / own, 0.25, 1));
  }

  // ---------------------------------------------------------------- outcome

  outcome(): DrillOutcome {
    const st = this.kit.stats;
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? XERATH_STATS.hp);
    const w = this.def.weights;
    const expected = this.expected();
    const want = Math.max(3, expected * 0.6);

    const pulse = st.qCasts > 0 ? this.kit.pulseRate * band(st.qCasts, 0, want) : 0;
    // Let go when it reached: a quarter of a second over is fine, a second is a habit.
    const release = st.qHits > 0 ? band(this.kit.overcharge, 1.0, 0.15) * band(st.qHits, 0, want) * (st.qFizzles > 0 ? 0.7 : 1) : 0;
    const eye = st.wCasts > 0 ? this.kit.eyeRate * band(st.wCasts, 0, want) : 0;
    const centre = st.wCasts > 0 ? clamp(this.kit.centreRate / 0.6, 0, 1) * band(st.wCasts, 0, want) : 0;
    const orb = st.eCasts > 0 ? this.kit.orbRate * band(st.eCasts, 0, want) : 0;
    const stun = st.eHits > 0 ? band(this.kit.stunAvg, 0.8, 1.8) : 0;
    const bandShare = this.bandShare();
    const bandScore = band(bandShare, 0.2, 0.8);
    const minutes = Math.max(0.25, this.s.elapsed / 60);
    const safe = band(this.dives / minutes, 4, 0);
    // Completed, and clean: of the Eyes and pulses thrown, the share that went
    // at a body the orb was holding. A player who throws everything at
    // everything completes combos too — by accident, between the misses.
    const followCasts = st.qCasts + st.wCasts;
    const onHeld = followCasts > 0 ? clamp(st.followUps / followCasts, 0, 1) : 0;
    const combo =
      this.combos.length > 0 ? clamp(this.combosDone() / Math.max(this.combos.length, want * 0.6), 0, 1) * (0.35 + 0.65 * onHeld) : 0;
    const stop = this.diversSent > 0 ? clamp(this.stopped / this.diversSent, 0, 1) : 0;
    const rite = st.rShots > 0 ? this.kit.riteRate * band(st.rShots, 0, want) : 0;
    const clean = st.eCasts > 0 ? clamp(1 - st.eBlocked / st.eCasts, 0, 1) * band(st.eCasts, 0, want) : 0;
    const trade = band(this.tradeRatio(), 0.3, 0.85) * band(this.dealtToChamps, 0, 800);
    const damage = band(m.damageDealt / Math.max(1, this.s.elapsed), 12, 70);

    const parts: [number | undefined, number][] = [
      [w.pulse, pulse],
      [w.release, release],
      [w.eye, eye],
      [w.centre, centre],
      [w.orb, orb],
      [w.stun, stun],
      [w.band, bandScore],
      [w.safe, safe],
      [w.combo, combo],
      [w.stop, stop],
      [w.rite, rite],
      [w.clean, clean],
      [w.trade, trade],
      [w.damage, damage],
      [w.survival, d.hpRetained],
    ];
    let raw = 0;
    let total = 0;
    for (const [weight, value] of parts) {
      if (weight === undefined) continue;
      raw += weight * value;
      total += weight;
    }
    raw = total > 0 ? raw / total : 0;

    // Volume: the stage's own act, often enough to be a measurement. A pulse
    // that landed once in a minute is not a habit, it is an accident.
    const acts = (() => {
      switch (this.def.id) {
        case 'xerPulse':
          return st.qCasts;
        case 'xerEye':
          return st.wCasts;
        case 'xerOrb':
          return st.eCasts;
        case 'xerCombo':
          return st.eHits * 1.5;
        case 'xerRite':
          return st.rShots;
        case 'xerRetreat':
          return st.eCasts + st.qCasts;
        default:
          return st.qCasts + st.wCasts + st.eCasts;
      }
    })();
    const volume = band(acts, 1, expected);
    const performance = clamp(raw * (0.42 + 0.58 * volume), 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (st.qCasts > 3 && this.kit.pulseRate > 0.7) helped.push(`${st.qHits} of ${st.qCasts} pulses landed.`);
    if (st.qHits > 3 && this.kit.overcharge < 0.25) helped.push('You let the pulse go the moment it reached. That is the whole habit.');
    if (st.wCasts > 3 && this.kit.centreRate > 0.45) helped.push(`${st.wCentre} Eyes on the centre — you are aiming where they will be.`);
    if (st.eHits > 2 && this.kit.stunAvg > 1.5) helped.push(`Your orbs are flying far: ${this.kit.stunAvg.toFixed(1)}s of stun each.`);
    if (this.bandClock > 10 && bandShare > 0.65) helped.push(`${Math.round(bandShare * 100)}% of the run in the band — out of their reach, inside yours.`);
    if (this.combosDone() > 1) helped.push(`${this.combosDone()} full combos: stun, centre, pulse.`);
    if (this.stopped > 1) helped.push(`${this.stopped} divers stopped before they arrived.`);
    if (st.followUps > 2) helped.push(`${st.followUps} casts landed on somebody who could not walk.`);

    if (st.qHits > 2 && this.kit.overcharge > 0.6) hurt.push(`You held the pulse ${this.kit.overcharge.toFixed(1)}s longer than it needed, on average — slowed, and visible, for nothing.`);
    if (st.qShort > 1) hurt.push(`${st.qShort} pulses aimed true and let go too early. They stopped short.`);
    if (st.qFizzles > 0) hurt.push(`${st.qFizzles} pulses held until they fizzled.`);
    if (st.wCasts > 3 && this.kit.centreRate < 0.2) hurt.push('Your Eyes land, but almost never on the centre. Aim where they will be in three quarters of a second.');
    if (st.eBlocked > 1) hurt.push(`${st.eBlocked} orbs caught by a minion. Look at the line before you throw it.`);
    if (this.dives > 1) hurt.push(`Dived ${this.dives} times. Every one of those was you standing inside the red ring.`);
    if (this.bandClock > 10 && bandShare < 0.35) hurt.push('You spent most of the run too close or too far. Live between the two rings.');
    if (this.combos.length > 2 && this.combosDone() < this.combos.length / 3) hurt.push('Orbs landed, and the stun was spent without a centre and a pulse on it.');

    const advice =
      this.dives > 1 || (this.bandClock > 10 && bandShare < 0.35)
        ? 'Stand where the red ring cannot reach you and the blue ring can reach them. Charge while you walk backwards, and let go early.'
        : st.qHits > 2 && this.kit.overcharge > 0.6
          ? 'Release the pulse the moment its end touches them. Every tenth of a second after that is you, slowed, waiting.'
          : st.qShort > 1
            ? 'The pulse grows with the hold. Watch its end, not the target, and let go when the end is past them.'
            : st.wCasts > 3 && this.kit.centreRate < 0.25
              ? 'The Eye lands three quarters of a second after you press it. Put the centre where they are walking to.'
              : st.eBlocked > 1
                ? 'Shocking Orb stops at the first body. Throw it around the wave, or wait for the gap.'
                : this.combos.length > 2 && this.combosDone() < this.combos.length / 3
                  ? 'A stunned body cannot juke. The second the orb lands: Eye on their feet, then the pulse.'
                  : 'That is the shape of him. Take it to the next stage and keep the distance in your head.';

    const metrics = [];
    if (w.pulse) metrics.push(pct('xerPulse', 'PULSES LANDED', this.kit.pulseRate));
    if (w.release) metrics.push(secs('xerHold', 'HELD PAST NEED', this.kit.overcharge, 'lower'));
    if (w.centre) metrics.push(pct('xerCentre', 'EYE CENTRES', this.kit.centreRate));
    if (w.eye) metrics.push(pct('xerEye', 'EYES LANDED', this.kit.eyeRate));
    if (w.orb) metrics.push(pct('xerOrb', 'ORBS LANDED', this.kit.orbRate));
    if (w.stun) metrics.push(secs('xerStun', 'AVERAGE STUN', this.kit.stunAvg));
    if (w.band) metrics.push(pct('xerBand', 'TIME IN THE BAND', bandShare));
    if (w.safe) metrics.push(count('xerDived', 'TIMES DIVED', this.dives, 'lower'));
    if (w.combo) metrics.push(count('xerCombo', 'COMBOS', this.combosDone()));
    if (w.stop) metrics.push(count('xerStopped', 'DIVERS STOPPED', this.stopped));
    if (w.rite) metrics.push(pct('xerRite', 'RITE SHOTS LANDED', this.kit.riteRate));
    if (w.trade) metrics.push(pct('xerTrade', 'TRADE WON', this.tradeRatio()));
    if (st.eCasts > 0) metrics.push(count('xerBlocked', 'ORBS BLOCKED', st.eBlocked, 'lower'));
    metrics.push(count('damage', 'DAMAGE DEALT', Math.round(m.damageDealt)));

    return {
      score: this.liveScore(),
      performance,
      axisPerformance: {
        // He is a champion of distances, and keeping one is the spacing axis
        // before it is anything else.
        spacing: clamp(w.band ? bandScore * 0.7 + safe * 0.3 : Math.max(release, stun, pulse * 0.6), 0, 1),
        targeting: clamp(Math.max(pulse, centre, orb, rite), 0, 1),
        ...(w.band || w.stop ? { movement: clamp(w.band ? bandScore : stop, 0, 1) } : {}),
        ...(w.combo ? { tempo: combo } : {}),
        ...(this.def.stage === 'TEST' || this.def.stage === 'PRESSURE' ? { combat: performance } : {}),
      },
      keyMetrics: metrics,
      helped,
      hurt,
      advice,
      effectiveDifficulty: this.def.stage === 'TEST' ? this.s.config.difficulty + 0.08 : undefined,
    };
  }

  /** How long a pulse would have to charge to reach this point, for a clip or a harness. */
  chargeTo(at: Vec2): number {
    const p = this.s.world.player;
    return p ? chargeFor(dist(p.pos, at) + 40) : 0;
  }
}
