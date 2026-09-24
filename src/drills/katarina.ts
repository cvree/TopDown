import type { BotBehavior } from '../engine/ai';
import type { AbilitySlot } from '../engine/input';
import { clamp, dist, norm } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { AbilityView, HudField } from '../engine/session';
import {
  KAT_LOTUS,
  KAT_RED,
  KAT_STEEL,
  KATARINA_STATS,
  KatarinaKit,
  type KatarinaLoadout,
  type Take,
} from '../engine/katarina';
import type { Actor, Vec2 } from '../engine/types';
import type { WorldEvent } from '../engine/world';
import { Drill, band, count, pct, secs, type DrillOutcome } from './base';

/**
 * The Katarina path.
 *
 * Nine stages of one question the rest of this client cannot ask: *can you be
 * standing in the right place a second from now?*
 *
 * Everything else here is about the present. A shot leads a body by the time
 * the missile takes, a roll is early or late against a windup that is already
 * running, a card is the face showing *now*. Katarina's daggers are the only
 * thing in the client that you put somewhere and then have to *meet* — they
 * land on their own clock, they lie there for four seconds, and the damage, the
 * cooldown and the reason she has a combo at all are all in the picking up. A
 * dagger nobody takes is a cast that did nothing.
 *
 * So the number the path leads with is **daggers taken**: of the ones that
 * reached the floor, the share you were standing on in time. Every stage after
 * the first adds one more reason you might not be.
 *
 *   katPrep    LEARN     one dagger, straight up, and the second and a quarter
 *   katBlade   ISOLATED  it lands behind what it hit — so throw at what is in front
 *   katShunpo  ISOLATED  blink onto the floor, and the blink comes back
 *   katBlink   COMBINED  throw it, then be there the moment it lands
 *   katDance   COMBINED  in, drop, take — without chasing yourself out of it
 *   katReset   PRESSURE  a kill is a cooldown; arrive at the next one with it
 *   katLotus   PRESSURE  the one ability you lose by moving
 *   katEntry   TRANSFER  a fight that is already happening, and when to join it
 *   katFight   TEST      all of it, against people trying to kill you
 */

export type KatarinaDrillId =
  | 'katPrep'
  | 'katBlade'
  | 'katShunpo'
  | 'katBlink'
  | 'katDance'
  | 'katReset'
  | 'katLotus'
  | 'katEntry'
  | 'katFight';

export const KATARINA_DRILL_IDS: KatarinaDrillId[] = [
  'katPrep',
  'katBlade',
  'katShunpo',
  'katBlink',
  'katDance',
  'katReset',
  'katLotus',
  'katEntry',
  'katFight',
];

/** What each component of the score is worth, per stage. */
interface Weights {
  /** Daggers taken, of the ones that reached the floor. The path's spine. */
  take?: number;
  /** Takes whose slash reached a champion. */
  slash?: number;
  /** How soon after landing a dagger was taken. */
  quick?: number;
  /** Bodies per Bouncing Blade. */
  bounce?: number;
  /** Takes that arrived by Shunpo. */
  route?: number;
  /** In, drop, take — completed. */
  trade?: number;
  /** Voracity paid out. */
  reset?: number;
  /** Lotuses kept, and how many champions they reached. */
  lotus?: number;
  /** Fights joined when they were ready to be joined. */
  entry?: number;
  /** The attack cycle: on time, nothing cancelled. */
  timing?: number;
  /** Damage per second of run. */
  damage?: number;
  /** Health kept. */
  survival?: number;
}

interface StageDef {
  id: KatarinaDrillId;
  stage: 'LEARN' | 'ISOLATED' | 'COMBINED' | 'PRESSURE' | 'TRANSFER' | 'TEST';
  duration: number;
  abilities: AbilitySlot[];
  loadout: KatarinaLoadout;
  /**
   * Cooldowns this stage brings down, by slot. See `KatarinaKit.practice`: a
   * stage about one ability has to contain enough attempts at it to be a rep.
   */
  practice?: Partial<Record<'q' | 'w' | 'e' | 'r', number>>;
  weights: Weights;
  /**
   * How many of the stage's own act a run is expected to contain — daggers,
   * trades, resets, lotuses or fights, whichever the stage is about. Accuracy
   * over two attempts is not accuracy, and without a floor a player could
   * take one dagger perfectly and be scored as flawless.
   */
  expected: number;
  /** How clearly the daggers and the ranges are drawn. Fades along the path. */
  clarity: number;
}

const STAGES: Record<KatarinaDrillId, StageDef> = {
  katPrep: {
    id: 'katPrep',
    stage: 'LEARN',
    duration: 45,
    abilities: ['w'],
    loadout: { preparation: true },
    // Preparation is on eleven seconds in League and a minute of eleven-second
    // gaps is four attempts, which is not a rep. The dagger, the landing and
    // the pickup are untouched; only how often you get to try is.
    practice: { w: 4.5 },
    weights: { take: 0.36, slash: 0.34, quick: 0.18, damage: 0.12 },
    // Reachable at the *lowest* difficulty, for the reason the card path's
    // first stage is: a ceiling only a hard run could reach turns the volume
    // gate into a difficulty bonus.
    expected: 7,
    clarity: 1,
  },
  katBlade: {
    id: 'katBlade',
    stage: 'ISOLATED',
    duration: 55,
    abilities: ['q'],
    loadout: { bouncingBlade: true },
    weights: { slash: 0.36, take: 0.24, bounce: 0.16, quick: 0.12, damage: 0.12 },
    expected: 6,
    clarity: 0.85,
  },
  katShunpo: {
    id: 'katShunpo',
    stage: 'ISOLATED',
    duration: 55,
    abilities: ['e'],
    loadout: { shunpo: true },
    weights: { take: 0.34, route: 0.3, slash: 0.2, quick: 0.16 },
    expected: 14,
    clarity: 0.8,
  },
  katBlink: {
    id: 'katBlink',
    stage: 'COMBINED',
    duration: 60,
    abilities: ['q', 'e'],
    loadout: { bouncingBlade: true, shunpo: true },
    weights: { route: 0.3, slash: 0.26, quick: 0.2, take: 0.14, damage: 0.1 },
    expected: 7,
    clarity: 0.65,
  },
  katDance: {
    id: 'katDance',
    stage: 'COMBINED',
    duration: 60,
    abilities: ['w', 'e'],
    loadout: { preparation: true, shunpo: true },
    practice: { w: 6 },
    weights: { trade: 0.42, take: 0.2, slash: 0.14, timing: 0.12, damage: 0.12 },
    expected: 7,
    clarity: 0.55,
  },
  katReset: {
    id: 'katReset',
    stage: 'PRESSURE',
    duration: 60,
    abilities: ['q', 'w', 'e'],
    loadout: { bouncingBlade: true, preparation: true, shunpo: true },
    weights: { reset: 0.4, take: 0.14, damage: 0.18, survival: 0.16, timing: 0.12 },
    // Resets come often here on purpose — three fragile bodies, always three —
    // so the count that means something is a high one: a reset every three
    // seconds or so is a player arriving at every next target with the kit.
    expected: 18,
    clarity: 0.4,
  },
  katLotus: {
    id: 'katLotus',
    stage: 'PRESSURE',
    duration: 60,
    abilities: ['e', 'r'],
    loadout: { shunpo: true, deathLotus: true },
    // Three lotuses a minute is an anecdote. Four is still few, and it is the
    // most a run can hold without the waves arriving faster than the ultimate
    // could ever answer them.
    practice: { r: 14 },
    weights: { lotus: 0.5, survival: 0.24, damage: 0.26 },
    expected: 4,
    clarity: 0.35,
  },
  katEntry: {
    id: 'katEntry',
    stage: 'TRANSFER',
    duration: 65,
    abilities: ['q', 'w', 'e', 'r'],
    loadout: { bouncingBlade: true, preparation: true, shunpo: true, deathLotus: true },
    weights: { entry: 0.38, reset: 0.2, survival: 0.24, damage: 0.18 },
    expected: 4,
    clarity: 0.2,
  },
  katFight: {
    id: 'katFight',
    stage: 'TEST',
    duration: 0,
    abilities: ['q', 'w', 'e', 'r'],
    loadout: { bouncingBlade: true, preparation: true, shunpo: true, deathLotus: true },
    weights: {
      take: 0.16,
      slash: 0.12,
      reset: 0.14,
      lotus: 0.1,
      timing: 0.1,
      survival: 0.2,
      damage: 0.18,
    },
    expected: 8,
    clarity: 0,
  },
};

export const katarinaStage = (id: KatarinaDrillId): StageDef => STAGES[id];

export const isKatarinaDrill = (id: string): id is KatarinaDrillId => id in STAGES;

/**
 * The entry stage's fight: how fast it bleeds, how low it bottoms out, and
 * the line under which joining it is on time.
 *
 * Seven per cent a second takes a group from full to the line in about six
 * and a half seconds, which is long enough that waiting is a decision and
 * short enough that a run holds four of them. The floor is there so the fight
 * never finishes itself: it is waiting for her, and a fight that ended
 * without her would be grading the drain rather than the entry.
 */
const ENTRY_DRAIN = 0.07;
const ENTRY_FLOOR = 0.2;
const ENTRY_LINE = 0.55;
/** How long a fight waits for her before it is over without her. */
const ENTRY_LIFE = 17;

/** In, drop, take: one trade on the dance stage, and how far it got. */
interface Trade {
  targetId: number;
  at: number;
  daggerId: number | null;
  done: boolean;
}

/** One fight on the entry stage. */
interface Group {
  ids: number[];
  anchor: Vec2;
  spawnedAt: number;
  /** When she first touched it, and how healthy it was then. */
  enteredAt: number | null;
  healthAtEntry: number;
  settled: boolean;
}

export class KatarinaDrill extends Drill {
  readonly def: StageDef;
  readonly kit: KatarinaKit;

  /** The champion the stage is built around, when there is exactly one. */
  focusId = -1;
  /** The entry stage's current fight. Public so a clip or a harness can read it. */
  group: Group | null = null;

  private seenTake: Take | null = null;
  private seenShunpo: KatarinaKit['lastShunpo'] = null;
  private seenW = 0;
  private trades: Trade[] = [];
  private groups: Group[] = [];
  private respawnCd = 0;
  private waveCd = 0;
  private floorCd = 0;
  private huntCd = 0;
  private groupCd = 0;
  private drainCd = 0;
  private kills = 0;
  private movingTime = 0;
  private totalTime = 0;

  constructor(session: import('../engine/session').Session, id: KatarinaDrillId) {
    super(session);
    this.def = STAGES[id];
    this.kit = new KatarinaKit(session, this.def.loadout, this.def.practice ?? {});
  }

  // ----------------------------------------------------------------- setup

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.kit.spawn({ x: w * 0.28, y: h * 0.56 });
    // Every stage runs its full clock. Health is a graded cost, not a fail
    // state — except in the test, where it is the whole point.
    if (this.def.id !== 'katFight') {
      p.maxHp = 1500;
      p.hp = 1500;
    } else {
      p.maxHp = 1100;
      p.hp = 1100;
    }
    if (this.def.id === 'katFight' || this.def.id === 'katEntry') this.buildTerrain();

    switch (this.def.id) {
      case 'katPrep':
        this.focusId = this.spawnTarget('strafe', 300, { harmless: true }).id;
        break;
      case 'katBlade':
        // A wave between her and the champion, the way a lane stands. Aimed
        // at the champion the dagger comes down behind them; aimed at the
        // minion in front of them it comes down *on* them.
        this.spawnWave(4, 440);
        this.focusId = this.spawnTarget('strafe', 820, { harmless: true }).id;
        break;
      case 'katShunpo':
        this.focusId = this.spawnTarget('irregular', 520, { harmless: true }).id;
        this.floorCd = 0.6;
        break;
      case 'katBlink':
        this.spawnWave(4, 420);
        this.focusId = this.spawnTarget('irregular', 600, {}).id;
        break;
      case 'katDance':
        this.focusId = this.spawnTarget('irregular', 480, {}).id;
        break;
      case 'katReset':
        for (let i = 0; i < 3; i++) this.spawnScrapper();
        break;
      case 'katLotus':
        this.huntCd = 2.5;
        break;
      case 'katEntry':
        this.groupCd = 1.2;
        break;
      case 'katFight':
        this.spawnHunter();
        this.spawnTarget('erratic', 620, {});
        this.spawnWave(4, 520);
        break;
    }
  }

  /** Two pillars: something to route around, and something to be caught on. */
  private buildTerrain(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.walls = [
      { x: w * 0.55, y: h * 0.18, w: 80, h: 220 },
      { x: w * 0.55, y: h * 0.84, w: 80, h: 220 },
    ];
  }

  /**
   * The body a stage is built around.
   *
   * Endless on every stage before the reset stage, for the reason the card
   * path's dummy is: those stages are about the dagger, and a target that dies
   * sooner on one setting than another moves the damage term with the slider.
   */
  private spawnTarget(behavior: BotBehavior, range: number, opts: { harmless?: boolean }): Actor {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const at = p
      ? { x: clamp(p.pos.x + range, 140, w - 140), y: clamp(p.pos.y + this.s.rng.range(-160, 160), 140, h - 140) }
      : { x: w * 0.7, y: h * 0.5 };
    const a = this.spawnEnemy('duelist', at, { hpScale: 2.6, behavior });
    a.attack.damage = opts.harmless ? 0 : 8 + this.s.config.difficulty * 8;
    a.label = 'TARGET';
    if (this.def.stage !== 'PRESSURE' && this.def.stage !== 'TEST') {
      a.maxHp = 60000;
      a.hp = 60000;
    }
    const brain = this.lastBrain;
    if (brain) brain.preferredRange = range;
    a.moveSpeed = 150 + this.s.config.difficulty * 140;
    return a;
  }

  /** Fragile, and dangerous enough to matter: the reset stage's champions. */
  private spawnScrapper(): Actor {
    const p = this.s.world.player;
    const pos = this.randomPoint(p?.pos ?? null, 420, 150);
    const a = this.spawnEnemy('duelist', pos, { hpScale: 0.75 + this.s.config.difficulty * 0.35, behavior: 'irregular' });
    a.attack.damage = 6 + this.s.config.difficulty * 8;
    a.moveSpeed = 200 + this.s.config.difficulty * 90;
    a.label = 'SCRAPPER';
    return a;
  }

  /** Something that is coming for you specifically. */
  private spawnHunter(at?: Vec2, fragile = false): Actor {
    const pos = at ?? this.randomPoint(this.s.world.player?.pos ?? null, 640, 150);
    const a = this.spawnEnemy('diver', pos, { hpScale: fragile ? 0.62 : 1.1, behavior: 'diver' });
    a.moveSpeed = 190 + this.s.config.difficulty * 90;
    a.attack.damage = fragile ? 12 + this.s.config.difficulty * 12 : 18 + this.s.config.difficulty * 18;
    a.label = 'HUNTER';
    return a;
  }

  /** A line of minions standing across the way, walking at her. */
  private spawnWave(n: number, ahead: number): void {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const cx = p ? clamp(p.pos.x + ahead, 220, w - 220) : w * 0.55;
    const cy = p ? p.pos.y : h * 0.5;
    for (let i = 0; i < n; i++) {
      const a = this.s.world.spawnActor({
        pos: { x: cx + this.s.rng.range(-26, 26), y: clamp(cy + (i - (n - 1) / 2) * 120, 120, h - 120) },
        team: 'enemy',
        maxHp: 260,
        radius: 24,
        moveSpeed: 62,
        isMinion: true,
        unitKind: i % 2 ? 'caster' : 'melee',
        label: 'MINION',
        attack: { attackSpeed: 0.6, windupRatio: 0.3, backswingRatio: 0.3, range: 120, damage: 6, projectileSpeed: 0 },
      });
      a.order = { kind: 'attackMove', pos: { x: a.pos.x - 520, y: a.pos.y } };
    }
  }

  /**
   * The entry stage's fight: three champions, already busy with somebody.
   *
   * Tethered to one spot, so the fight stays where it is and she is the one
   * who has to decide to go to it. They shoot anybody who walks into range —
   * at full health that is a price, and at half health it is the fight
   * finishing itself around her.
   */
  private spawnGroup(): void {
    const p = this.s.world.player;
    const anchor = this.randomPoint(p?.pos ?? null, 760, 260);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 + this.s.rng.range(-0.3, 0.3);
      const pos = { x: anchor.x + Math.cos(ang) * 120, y: anchor.y + Math.sin(ang) * 120 };
      const a = this.spawnEnemy('ranger', pos, { hpScale: 0.95, behavior: 'tether', anchor, leash: 170 });
      a.attack.damage = 22 + this.s.config.difficulty * 16;
      a.label = 'IN A FIGHT';
      ids.push(a.id);
    }
    const g: Group = { ids, anchor, spawnedAt: this.s.elapsed, enteredAt: null, healthAtEntry: 1, settled: false };
    this.group = g;
    this.groups.push(g);
  }

  private groupHealth(g: Group): number {
    let hp = 0;
    let max = 0;
    for (const id of g.ids) {
      const a = this.s.world.byId(id);
      if (!a) continue;
      max += a.maxHp;
      if (a.alive) hp += a.hp;
    }
    return max > 0 ? hp / max : 0;
  }

  private groupAlive(g: Group): Actor[] {
    return g.ids.map((id) => this.s.world.byId(id)).filter((a): a is Actor => !!a && a.alive);
  }

  // ---------------------------------------------------------------- runtime

  onStart(): void {
    this.s.setBanner(this.def.stage, 1.2, { key: 'stage' });
  }

  update(dt: number): void {
    this.kit.update(dt);
    this.updateBrains(dt);

    const p = this.s.world.player;
    if (p) {
      this.totalTime += dt;
      if (Math.hypot(p.vel.x, p.vel.y) > 20) this.movingTime += dt;
    }

    this.pollTakes();
    this.pollTrades();

    if (this.def.id === 'katShunpo') this.stepFloor(dt);
    if (this.def.id === 'katLotus') this.stepHunt(dt);
    if (this.def.id === 'katEntry') this.stepEntry(dt);

    this.repopulate(dt);

    if (this.def.id === 'katBlade' || this.def.id === 'katBlink' || this.def.id === 'katFight') {
      this.waveCd -= dt;
      const minions = this.s.world.enemies().filter((e) => e.isMinion);
      if (minions.length < 2 && this.waveCd <= 0) {
        this.waveCd = 4;
        this.spawnWave(4, this.def.id === 'katFight' ? 520 : 430);
      }
    }
  }

  /** Keep the field populated. A stage that empties itself stops teaching. */
  private repopulate(dt: number): void {
    if (this.def.id === 'katLotus' || this.def.id === 'katEntry') return;
    const champs = this.s.world.enemies().filter((e) => !e.isMinion);
    const wanted = this.def.id === 'katReset' ? 3 : this.def.id === 'katFight' ? 2 : 1;
    if (champs.length >= wanted) return;
    this.respawnCd -= dt;
    if (this.respawnCd > 0) return;
    // A reset is only worth something if the next target is already there.
    this.respawnCd = this.def.id === 'katReset' ? 0.9 : 1.4;
    switch (this.def.id) {
      case 'katReset':
        this.spawnScrapper();
        break;
      case 'katFight':
        if (champs.length === 0) this.spawnHunter();
        else this.spawnTarget('erratic', 620, {});
        break;
      case 'katPrep':
        this.focusId = this.spawnTarget('strafe', 300, { harmless: true }).id;
        break;
      case 'katBlade':
        this.focusId = this.spawnTarget('strafe', 820, { harmless: true }).id;
        break;
      case 'katShunpo':
        this.focusId = this.spawnTarget('irregular', 520, { harmless: true }).id;
        break;
      default:
        this.focusId = this.spawnTarget('irregular', 520, {}).id;
        break;
    }
  }

  /**
   * The Shunpo stage's floor: daggers nobody threw, near somebody worth
   * slashing, and never more than two at once.
   *
   * They are dropped rather than laid — half a second in the air — so every
   * one of them arrives as a thing you can see coming and plan a route to,
   * which is what a real dagger is.
   */
  private stepFloor(dt: number): void {
    this.floorCd -= dt;
    if (this.floorCd > 0) return;
    const out = this.kit.daggers.length;
    if (out >= 2) return;
    this.floorCd = 1.5 - this.s.config.difficulty * 0.45;
    const p = this.s.world.player;
    const t = this.s.world.byId(this.focusId);
    if (!p) return;
    let at: Vec2 | null = null;
    for (let i = 0; i < 24 && !at; i++) {
      const base = t && t.alive ? t.pos : p.pos;
      const ang = this.s.rng.range(0, Math.PI * 2);
      const r = this.s.rng.range(110, 250);
      const c = { x: base.x + Math.cos(ang) * r, y: base.y + Math.sin(ang) * r };
      const g = dist(c, p.pos);
      if (g >= 320 && g <= KATARINA_STATS.eRange - 40) at = c;
    }
    const { w, h } = this.s.world.bounds;
    const pos = at ?? this.randomPoint(p.pos, 320, 160);
    this.kit.dropDagger({ x: clamp(pos.x, 120, w - 120), y: clamp(pos.y, 120, h - 120) }, 0.5, 'floor');
  }

  /** The lotus stage: three hunters at a time, from three sides. */
  private stepHunt(dt: number): void {
    this.huntCd -= dt;
    const alive = this.s.world.enemies().filter((e) => !e.isMinion).length;
    if (this.huntCd > 0 || alive > 1) return;
    this.huntCd = 14 - this.s.config.difficulty * 2;
    const p = this.s.world.player;
    const c = p?.pos ?? { x: this.s.world.bounds.w / 2, y: this.s.world.bounds.h / 2 };
    const { w, h } = this.s.world.bounds;
    const base = this.s.rng.range(0, Math.PI * 2);
    for (let i = 0; i < 3; i++) {
      const ang = base + (i / 3) * Math.PI * 2;
      const at = {
        x: clamp(c.x + Math.cos(ang) * 620, 120, w - 120),
        y: clamp(c.y + Math.sin(ang) * 620, 120, h - 120),
      };
      this.spawnHunter(at, true);
    }
    this.s.setBanner('INCOMING', 1, { tone: 'critical', key: 'incoming' });
  }

  /**
   * The entry stage: a fight bleeding on its own, and the moment she joins it.
   *
   * The drain is the rest of her team, doing the rest of the fight. What is
   * graded is how healthy that fight was when she first touched it: on the
   * line or under it is an entry, above it is a dive into three people at full
   * health, and never is a fight her team lost without her.
   */
  private stepEntry(dt: number): void {
    const g = this.group;
    if (g) {
      this.drainCd -= dt;
      if (this.drainCd <= 0) {
        this.drainCd = 0.25;
        for (const a of this.groupAlive(g)) {
          if (a.hp / a.maxHp <= ENTRY_FLOOR) continue;
          this.s.world.damage(a, a.maxHp * ENTRY_DRAIN * 0.25);
        }
      }
      const gone = this.groupAlive(g).length === 0;
      if (gone || this.s.elapsed - g.spawnedAt > ENTRY_LIFE) {
        g.settled = true;
        // Whatever is left of a fight she never joined simply leaves.
        for (const a of this.groupAlive(g)) {
          a.alive = false;
          a.hp = 0;
        }
        this.group = null;
        this.groupCd = 1.5;
        if (g.enteredAt === null) this.s.micro('FIGHT LOST WITHOUT YOU', g.anchor, PALETTE.danger);
      }
    }
    if (this.group) return;
    this.groupCd -= dt;
    if (this.groupCd > 0) return;
    this.spawnGroup();
    this.s.setBanner('A FIGHT', 1, { tone: 'critical', key: 'fight' });
  }

  /** A take happened: whatever the stage wants to know about it. */
  private pollTakes(): void {
    const t = this.kit.lastTake;
    if (!t || t === this.seenTake) return;
    this.seenTake = t;
    for (const tr of this.trades) {
      if (tr.done || tr.daggerId !== t.dagger.id) continue;
      if (t.champions > 0) {
        tr.done = true;
        const p = this.s.world.player;
        if (p) this.s.micro('TRADE', p.pos, KAT_RED);
      }
    }
  }

  /**
   * In, drop, take.
   *
   * A trade starts on a Shunpo onto a champion, is armed by Preparation inside
   * the next beat, and is completed by taking that same dagger with a champion
   * inside the slash. Every other order of those three things is a player who
   * blinked in, or dropped a dagger, and those are not the same skill.
   */
  private pollTrades(): void {
    if (this.def.id !== 'katDance') return;
    const sh = this.kit.lastShunpo;
    if (sh && sh !== this.seenShunpo) {
      this.seenShunpo = sh;
      const target = this.s.world.byId(sh.targetId);
      if (target && !target.isMinion) this.trades.push({ targetId: target.id, at: this.s.elapsed, daggerId: null, done: false });
    }
    const w = this.kit.stats.wCasts;
    if (w !== this.seenW) {
      this.seenW = w;
      const open = this.trades[this.trades.length - 1];
      const dropped = [...this.kit.daggers].reverse().find((d) => d.source === 'w');
      if (open && open.daggerId === null && dropped && this.s.elapsed - open.at <= 0.8) open.daggerId = dropped.id;
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    this.kit.onEvents(events);
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type === 'death' && e.byPlayer) {
        const victim = this.s.world.byId(e.actorId);
        if (victim && !victim.isMinion) this.kills++;
      }
      // The entry: the first time she touches the fight, and what state the
      // fight was in when she did.
      if (e.type === 'damage' && e.actorId === pid && this.group && this.group.enteredAt === null) {
        if (this.group.ids.includes(e.targetId ?? -1)) {
          const g = this.group;
          g.enteredAt = this.s.elapsed;
          g.healthAtEntry = this.groupHealth(g);
          const p = this.s.world.player;
          if (p) {
            const onTime = g.healthAtEntry <= ENTRY_LINE;
            this.s.micro(onTime ? 'ON TIME' : 'TOO EARLY', p.pos, onTime ? PALETTE.good : PALETTE.danger);
          }
        }
      }
    }
    if (this.def.id === 'katFight' && this.s.world.enemies().filter((x) => !x.isMinion).length === 0 && this.kills >= 4) {
      this.endReason = 'complete';
      this.s.forceEnd = true;
    }
  }

  onAbility(slot: AbilitySlot, at: Vec2): void {
    if (this.summoner(slot, at)) return;
    this.kit.cast(slot, at);
  }

  abilities(): AbilityView[] {
    return this.kit.bar(super.abilities());
  }

  // ------------------------------------------------------------------ paint

  /**
   * THE DAGGERS, ON THE FLOOR.
   *
   * The most useful thing this path draws, and it is drawn where the dagger
   * is rather than in a corner of the HUD: a dagger is a *place*, and the only
   * question about it is whether you will be standing there. In the air it is
   * a ring closing on the spot it will land; on the floor it is the blade and
   * the reach you have to get inside, with the ring running down its four
   * seconds.
   */
  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    const c = this.def.clarity;
    const now = this.s.world.time;

    for (const d of this.kit.daggers) {
      const inAir = now < d.landsAt;
      if (inAir) {
        const total = Math.max(0.01, d.landsAt - d.thrownAt);
        const left = clamp((d.landsAt - now) / total, 0, 1);
        out.markers.push({
          kind: 'ring',
          x: d.pos.x,
          y: d.pos.y,
          radius: 28 + 90 * left,
          color: KAT_STEEL,
          alpha: 0.5,
          width: 3,
          rise: 1.3,
        });
        out.markers.push({ kind: 'cross', x: d.pos.x, y: d.pos.y, radius: 10, color: KAT_STEEL, alpha: 0.45, width: 2, rise: 1.3 });
        continue;
      }
      out.markers.push({ kind: 'cross', x: d.pos.x, y: d.pos.y, radius: 16, color: KAT_RED, alpha: 0.95, width: 4, rise: 1.5 });
      out.markers.push({
        kind: 'ring',
        x: d.pos.x,
        y: d.pos.y,
        radius: KATARINA_STATS.pickupRadius,
        color: KAT_RED,
        alpha: 0.25 + 0.35 * c,
        width: 2.5,
        fill: 0.06,
        dash: 24,
        progress: clamp((d.expiresAt - now) / KATARINA_STATS.daggerLife, 0, 1),
        rise: 1.2,
      });
    }

    // Where a Bouncing Blade would come down, while it is up — the one piece
    // of the kit a player cannot see without being told, drawn while the
    // path is still telling.
    if (this.kit.loadout.bouncingBlade && this.kit.qCd <= 0 && c > 0.5) {
      const cur = this.s.cursorWorld;
      let best: Actor | null = null;
      let bd = Infinity;
      for (const a of this.s.world.enemies()) {
        if (dist(a.pos, p.pos) > KATARINA_STATS.qRange + a.radius) continue;
        const g = dist(a.pos, cur);
        if (g < bd) {
          bd = g;
          best = a;
        }
      }
      if (best) {
        const d = norm(best.pos.x - p.pos.x, best.pos.y - p.pos.y);
        const land = { x: best.pos.x + d.x * KATARINA_STATS.qLandBehind, y: best.pos.y + d.y * KATARINA_STATS.qLandBehind };
        out.markers.push({
          kind: 'line',
          x: best.pos.x,
          y: best.pos.y,
          x2: land.x,
          y2: land.y,
          halfWidth: 3,
          color: KAT_STEEL,
          alpha: 0.28 * c,
          rise: 1.1,
        });
        out.markers.push({ kind: 'cross', x: land.x, y: land.y, radius: 12, color: KAT_STEEL, alpha: 0.4 * c, width: 2, rise: 1.1 });
      }
    }

    // Her reach: the blade's and the blink's, faint, while the path draws them.
    if (c > 0.05) {
      if (this.kit.loadout.bouncingBlade) {
        out.markers.push({ kind: 'ring', x: p.pos.x, y: p.pos.y, radius: KATARINA_STATS.qRange, color: KAT_STEEL, alpha: 0.1 * c, width: 2, dash: 80, spin: 0.05, rise: 1 });
      }
      if (this.kit.loadout.shunpo) {
        out.markers.push({ kind: 'ring', x: p.pos.x, y: p.pos.y, radius: KATARINA_STATS.eRange, color: KAT_RED, alpha: 0.1 * c, width: 2, dash: 110, spin: -0.04, rise: 1 });
      }
    }

    // The slash, around her, whenever a landed dagger is close enough that
    // taking it is the next thing she does — so who will be inside is a thing
    // you can see before you step.
    if (c > 0.3 && this.kit.daggerNear(p.pos, KATARINA_STATS.pickupRadius + 160)) {
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: KATARINA_STATS.slashRadius,
        color: KAT_RED,
        alpha: 0.22 * c,
        width: 2,
        dash: 40,
        rise: 1.2,
      });
    }

    // The lotus, and the clock on it.
    const ch = this.kit.channelProgress;
    if (ch !== null) {
      out.billboards.push({ kind: 'timerBar', x: p.pos.x, y: p.pos.y, progress: 1 - ch, color: KAT_LOTUS, lift: 112, width: 120 });
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: KATARINA_STATS.rRange,
        color: KAT_LOTUS,
        alpha: 0.35,
        width: 3,
        dash: 18,
        spin: 2.4,
        rise: 1.4,
      });
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: p.radius + 26 + 5 * Math.sin(t * 14),
        color: KAT_LOTUS,
        alpha: 0.7,
        width: 3,
        rise: 1.5,
      });
    }

    // The entry stage's fight: how healthy it is, over it, as the one number
    // the decision is about.
    const g = this.group;
    if (g) {
      const hp = this.groupHealth(g);
      const ready = hp <= ENTRY_LINE;
      out.markers.push({
        kind: 'ring',
        x: g.anchor.x,
        y: g.anchor.y,
        radius: 260,
        color: ready ? PALETTE.good : PALETTE.warn,
        alpha: ready ? 0.4 : 0.2,
        width: ready ? 4 : 2,
        dash: 36,
        spin: 0.2,
        progress: clamp(hp, 0, 1),
        rise: 1.1,
      });
      if (g.enteredAt === null) {
        out.billboards.push({
          kind: 'label',
          x: g.anchor.x,
          y: g.anchor.y,
          text: ready ? 'GO' : 'WAIT',
          color: ready ? PALETTE.good : PALETTE.warn,
          size: 18,
          sub: `${Math.round(hp * 100)}%`,
          lift: 170,
        });
      }
    }

    // The last blink, for a beat, so the route is something you watch.
    const sh = this.kit.lastShunpo;
    if (sh && now - sh.at < 0.5) {
      const a = 1 - (now - sh.at) / 0.5;
      out.markers.push({ kind: 'line', x: sh.from.x, y: sh.from.y, x2: sh.to.x, y2: sh.to.y, halfWidth: 7, color: KAT_RED, alpha: 0.35 * a, rise: 1.5 });
    }
  }

  // -------------------------------------------------------------------- hud

  hudFields(): HudField[] {
    const st = this.kit.stats;
    const fields: HudField[] = [];
    const settled = st.daggersTaken + st.daggersExpired;
    if (this.def.id !== 'katLotus' && this.def.id !== 'katEntry') {
      const rate = this.kit.takeRate;
      fields.push({
        label: 'DAGGERS TAKEN',
        value: `${st.daggersTaken}/${settled}`,
        bar: rate,
        tone: settled === 0 ? 'neutral' : rate > 0.75 ? 'good' : rate > 0.45 ? 'warn' : 'bad',
      });
    }
    switch (this.def.id) {
      case 'katPrep':
      case 'katBlade':
        fields.push({ label: 'SLASHES ON TARGET', value: `${st.slashOnChampions}`, tone: 'good' });
        break;
      case 'katShunpo':
      case 'katBlink':
        fields.push({ label: 'TAKEN BY SHUNPO', value: `${st.takenByShunpo}`, tone: 'good' });
        break;
      case 'katDance': {
        const done = this.trades.filter((t) => t.done).length;
        fields.push({ label: 'TRADES', value: `${done}/${this.trades.length}`, tone: done >= this.trades.length ? 'good' : 'warn' });
        break;
      }
      case 'katReset':
      case 'katFight':
        fields.push({ label: 'RESETS', value: `${st.resets}`, tone: st.resets > 0 ? 'good' : 'neutral' });
        break;
      case 'katLotus':
        fields.push({
          label: 'LOTUSES KEPT',
          value: `${st.rCompleted + st.rShunpoOut}/${st.rCasts}`,
          tone: st.rMoved > 0 ? 'bad' : 'good',
        });
        fields.push({ label: 'CHAMPIONS / SPIN', value: this.kit.lotusSpread.toFixed(1), bar: this.kit.lotusSpread / 3, tone: 'neutral' });
        break;
      case 'katEntry': {
        const settledGroups = this.groups.filter((x) => x.settled || x.enteredAt !== null);
        const onTime = settledGroups.filter((x) => x.enteredAt !== null && x.healthAtEntry <= ENTRY_LINE).length;
        fields.push({ label: 'ENTRIES ON TIME', value: `${onTime}/${settledGroups.length}`, tone: onTime === settledGroups.length ? 'good' : 'warn' });
        fields.push({ label: 'RESETS', value: `${st.resets}`, tone: 'neutral' });
        break;
      }
    }
    return fields;
  }

  liveScore(): number {
    const st = this.kit.stats;
    const m = this.s.metrics.m;
    return Math.max(
      0,
      Math.round(
        m.damageDealt * 5 +
          st.daggersTaken * 320 +
          st.slashOnChampions * 360 +
          st.takenByShunpo * 160 +
          st.qHits * 60 +
          st.resets * 900 +
          st.rCompleted * 700 +
          st.rHits * 18 +
          this.trades.filter((t) => t.done).length * 600 +
          this.entriesOnTime() * 1100 +
          this.kills * 1200 -
          st.daggersExpired * 180 -
          st.rMoved * 500 -
          m.hpLost * 2,
      ),
    );
  }

  private entriesOnTime(): number {
    return this.groups.filter((g) => g.enteredAt !== null && g.healthAtEntry <= ENTRY_LINE).length;
  }

  // ---------------------------------------------------------------- outcome

  outcome(): DrillOutcome {
    const st = this.kit.stats;
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? KATARINA_STATS.hp);
    const w = this.def.weights;
    const want = Math.max(3, this.def.expected * 0.6);

    const settled = st.daggersTaken + st.daggersExpired;
    const takes = st.daggersTaken;
    // Share *and* count, as on every other path: two daggers taken out of two
    // is not a hundred per cent of anything, it is a stage not yet played.
    const take = this.kit.takeRate * band(settled, 0, want);
    const slash = takes > 0 ? clamp(st.slashOnChampions / takes, 0, 1) * band(takes, 0, want) : 0;
    const quick = takes > 0 ? band(this.kit.takeDelay, 1.6, 0.15) * band(takes, 0, want) : 0;
    const bounce = st.qCasts > 0 ? band(this.kit.bladeHitsPerCast, 1, 3) * band(st.qCasts, 0, want) : 0;
    const route = takes > 0 ? clamp(st.takenByShunpo / takes, 0, 1) * band(st.takenByShunpo, 0, want) : 0;
    const tradesDone = this.trades.filter((t) => t.done).length;
    const trade = this.trades.length > 0 ? clamp(tradesDone / this.trades.length, 0, 1) * band(tradesDone, 0, want) : 0;
    const reset = band(st.resets, 0, this.def.expected);
    const kept = st.rCompleted + st.rShunpoOut;
    const lotus = st.rCasts > 0 ? clamp(kept / st.rCasts, 0, 1) * band(this.kit.lotusSpread, 0.5, 2.2) : 0;
    const groupsSettled = this.groups.filter((g) => g.settled || g.enteredAt !== null).length;
    const onTime = this.entriesOnTime();
    const entry = groupsSettled > 0 ? clamp(onTime / groupsSettled, 0, 1) : 0;

    const damage = band(m.damageDealt / Math.max(1, this.s.elapsed), 16, 80);

    const parts: [number | undefined, number][] = [
      [w.take, take],
      [w.slash, slash],
      [w.quick, quick],
      [w.bounce, bounce],
      [w.route, route],
      [w.trade, trade],
      [w.reset, reset],
      [w.lotus, lotus],
      [w.entry, entry],
      [w.timing, d.attackTiming],
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

    // Two multiplicative gates, both there because the alternative is a player
    // who takes one dagger and is told they are elite.
    //
    // Volume: the stage's own act, often enough to be a measurement.
    // Presence: past the learning stage, a champion nobody is driving is not
    // graded on routing — standing still is what makes a dagger easy to meet.
    const acts = (() => {
      switch (this.def.id) {
        case 'katPrep':
        case 'katDance':
          return st.wCasts;
        case 'katBlade':
        case 'katBlink':
          return st.qCasts;
        case 'katShunpo':
          return settled;
        case 'katReset':
          return st.takedowns;
        case 'katLotus':
          return st.rCasts;
        case 'katEntry':
          return groupsSettled;
        default:
          return Math.max(st.takedowns * 2, st.qCasts, st.eCasts);
      }
    })();
    const volume = band(acts, 1, this.def.expected);
    const driving = this.totalTime > 1 ? clamp(this.movingTime / this.totalTime, 0, 1) : 0;
    const presence = this.def.stage === 'LEARN' ? 1 : band(driving, 0.08, 0.35);
    const performance = clamp(raw * (0.42 + 0.58 * volume) * (0.5 + 0.5 * presence), 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (settled > 3 && this.kit.takeRate > 0.8) helped.push(`${takes} of ${settled} daggers taken. You are meeting them.`);
    if (takes > 3 && st.slashOnChampions / takes > 0.7) helped.push('Your slashes are landing on somebody who minds.');
    if (takes > 3 && this.kit.takeDelay < 0.4) helped.push('You are on the dagger when it lands, not after.');
    if (st.takenByShunpo > 3) helped.push(`${st.takenByShunpo} daggers taken by Shunpo — the blink is coming back as fast as you use it.`);
    if (st.resets > 2) helped.push(`${st.resets} resets. The second target is being reached with the kit up.`);
    if (tradesDone > 2) helped.push(`${tradesDone} full trades: in, drop, take.`);
    if (st.rCasts > 0 && st.rMoved === 0 && this.kit.lotusSpread > 1.5) helped.push('Every lotus kept, and every one of them caught more than one.');
    if (onTime > 1) helped.push(`${onTime} fights joined at the right moment.`);

    if (settled > 3 && this.kit.takeRate < 0.5) hurt.push(`${st.daggersExpired} daggers left on the floor. Each one is a cast that did nothing.`);
    if (takes > 3 && st.slashOnChampions / takes < 0.4) hurt.push('You are taking daggers with nobody inside the slash.');
    if (st.rMoved > 0) hurt.push(`${st.rMoved} lotuses cancelled by moving. Let go of the mouse.`);
    const early = this.groups.filter((g) => g.enteredAt !== null && g.healthAtEntry > ENTRY_LINE).length;
    if (early > 0) hurt.push(`${early} fights dived while they were still healthy.`);
    const missed = this.groups.filter((g) => g.settled && g.enteredAt === null).length;
    if (missed > 0) hurt.push(`${missed} fights that finished without you.`);
    if (this.trades.length > 2 && tradesDone < this.trades.length / 2) hurt.push('You blink in and then chase them away from your own dagger.');
    if (driving < 0.2 && this.def.stage !== 'LEARN') hurt.push('You barely moved. Every score on this path past the first is gated on that.');

    const advice =
      settled > 3 && this.kit.takeRate < 0.6
        ? 'Before you throw a dagger, know where you will be when it lands. If the answer is "wherever the fight goes", do not throw it yet.'
        : st.rMoved > 0
          ? 'Death Lotus ends the instant you move. Press R, take your hand off the mouse, and leave with Shunpo if you have to leave at all.'
          : early > 0
            ? 'Wait for the fight to happen. Three people at full health is a death; three people at half is a pentakill.'
            : takes > 3 && st.slashOnChampions / takes < 0.4
              ? 'The slash is around you, not around the dagger. Take it from the side the enemy is on.'
              : this.trades.length > 2 && tradesDone < this.trades.length / 2
                ? 'The haste is the trap. Stay by the dagger you dropped — they will still be in reach when it lands.'
                : 'That is the shape of her. Take it to the next stage and keep the route in your head.';

    const metrics = [];
    metrics.push(pct('katTake', 'DAGGERS TAKEN', this.kit.takeRate));
    if (w.slash) metrics.push(count('katSlash', 'SLASHES ON A CHAMPION', st.slashOnChampions));
    if (w.quick) metrics.push(secs('katDelay', 'DAGGER LAY THERE FOR', this.kit.takeDelay, 'lower'));
    if (w.bounce) metrics.push(count('katBounce', 'BLADE HITS', st.qHits));
    if (w.route) metrics.push(count('katRoute', 'TAKEN BY SHUNPO', st.takenByShunpo));
    if (w.trade) metrics.push(pct('katTrade', 'TRADES COMPLETED', this.trades.length ? tradesDone / this.trades.length : 0));
    if (w.reset) metrics.push(count('katReset', 'RESETS', st.resets));
    if (w.lotus) {
      metrics.push(count('katLotus', 'LOTUSES KEPT', kept));
      metrics.push(count('katMoved', 'LOTUSES CANCELLED BY MOVING', st.rMoved, 'lower'));
    }
    if (w.entry) metrics.push(pct('katEntry', 'ENTRIES ON TIME', entry));
    if (w.timing) metrics.push(pct('timing', 'ATTACK TIMING', d.attackTiming));
    metrics.push(count('damage', 'DAMAGE DEALT', Math.round(m.damageDealt)));

    return {
      score: this.liveScore(),
      performance,
      axisPerformance: {
        // A dagger is a place in the future, and getting to places is the
        // movement axis before it is anything else.
        movement: clamp(take * 0.6 + driving * 0.4, 0, 1),
        spacing: clamp(slash * 0.7 + quick * 0.3, 0, 1),
        ...(w.route || w.trade ? { tempo: clamp(Math.max(route, trade), 0, 1) } : {}),
        ...(w.bounce ? { targeting: bounce } : {}),
        ...(w.reset || w.entry ? { targeting: clamp(Math.max(reset, entry), 0, 1) } : {}),
        ...(w.timing ? { kiting: d.attackTiming } : {}),
        ...(this.def.stage === 'TEST' || w.lotus ? { combat: performance } : {}),
      },
      keyMetrics: metrics,
      helped,
      hurt,
      advice,
      effectiveDifficulty: this.def.stage === 'TEST' ? this.s.config.difficulty + 0.08 : undefined,
    };
  }
}
