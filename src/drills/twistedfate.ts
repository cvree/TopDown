import type { BotBehavior } from '../engine/ai';
import type { AbilitySlot } from '../engine/input';
import { clamp, dist } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { AbilityView, HudField } from '../engine/session';
import {
  CARD_COLOR,
  CARD_NAME,
  CARD_ORDER,
  TF_DESTINY,
  TF_GOLD,
  TWISTED_STATS,
  TwistedKit,
  type CardColor,
} from '../engine/twistedfate';
import type { Actor, Vec2 } from '../engine/types';
import type { WorldEvent } from '../engine/world';
import { Drill, band, count, ms, pct, secs, type DrillOutcome } from './base';

/**
 * The Twisted Fate path.
 *
 * Nine stages of one question the rest of this client cannot ask: *can you
 * choose, at speed, from a list that will not wait for you?*
 *
 * Every other mechanic here is analogue. A shot is more or less led, a step is
 * more or less early, a position is more or less good. Pick a Card is not: the
 * wheel is showing exactly one of three faces at any instant, you either take
 * the one you needed or you do not, and the cost of not is measured in whole
 * revolutions. That makes it the only ability in the client where the honest
 * score is a *count of missed opportunities* rather than a distance from
 * perfect — and it makes it the sharpest thing in the client to practise,
 * because there is nowhere in it for a bad habit to hide.
 *
 * The number the path leads with is therefore not "did you lock gold". It is
 * **slots wasted per lock**: the wheel starts on blue and turns at two cards a
 * second, so gold is always exactly two slots away the first time it comes
 * round, and every extra three is a full turn you spent standing in front of
 * somebody deciding.
 *
 *   tfPick     LEARN     the wheel, named card, nothing else happening
 *   tfGold     ISOLATED  gold, and the attack that has to carry it somewhere
 *   tfWild     ISOLATED  three cards in a fan, aimed along a line not at a body
 *   tfDeck     COMBINED  every fourth attack, and where it is allowed to land
 *   tfHold     COMBINED  lock it *before* you need it and walk in loaded
 *   tfPressure PRESSURE  the same wheel with the floor moving under you
 *   tfCombo    PRESSURE  gold, cards, attack — the whole set-up inside the stun
 *   tfGate     TRANSFER  destiny, a channel you have to survive, and a landing
 *   tfFight    TEST      all of it, against people trying to kill you
 */

export type TwistedDrillId =
  | 'tfPick'
  | 'tfGold'
  | 'tfWild'
  | 'tfDeck'
  | 'tfHold'
  | 'tfPressure'
  | 'tfCombo'
  | 'tfGate'
  | 'tfFight';

export const TWISTED_DRILL_IDS: TwistedDrillId[] = [
  'tfPick',
  'tfGold',
  'tfWild',
  'tfDeck',
  'tfHold',
  'tfPressure',
  'tfCombo',
  'tfGate',
  'tfFight',
];

/** What each component of the score is worth, per stage. */
interface Weights {
  /** Taking the card that was asked for. */
  lock?: number;
  /** How few slots of the wheel it cost you. The path's spine. */
  wheel?: number;
  /** Gold cards that landed on something worth stunning. */
  gold?: number;
  /** Cards per Wild Cards cast — the fan, used as a fan. */
  fan?: number;
  /** Casts that went through more than one body. */
  pierce?: number;
  /** Fourth attacks that landed where they were worth something. */
  deck?: number;
  /** Walking into contact with the card already on your hand. */
  carry?: number;
  /** The set-up, completed inside the stun it bought. */
  combo?: number;
  /** Destiny: the channel survived and the landing worth the cooldown. */
  gate?: number;
  /** The attack cycle: on time, nothing cancelled. */
  timing?: number;
  /** Where you stood relative to both reaches. */
  spacing?: number;
  /** Damage per second of run. */
  damage?: number;
  /** Health kept. */
  survival?: number;
  /** Not being hit by the things aimed at you. */
  dodging?: number;
}

interface StageDef {
  id: TwistedDrillId;
  stage: 'LEARN' | 'ISOLATED' | 'COMBINED' | 'PRESSURE' | 'TRANSFER' | 'TEST';
  duration: number;
  abilities: AbilitySlot[];
  loadout: { wildCards?: boolean; pickACard?: boolean; stackedDeck?: boolean; destiny?: boolean };
  weights: Weights;
  /**
   * How many cards a run is expected to be asked for, or — on the stages that
   * do not ask — how many Wild Cards casts it expects. Accuracy over three
   * attempts is not accuracy, and without a floor a player could lock one card
   * perfectly and be scored as flawless.
   */
  expected: number;
  /**
   * Seconds between one card being asked for and the next, at the lowest
   * difficulty. Higher settings shorten it — see {@link TwistedDrill.ask}.
   */
  askEvery: number;
  /**
   * The card this stage always asks for, when it always asks for one.
   *
   * Absent means rotate through all three, which is the honest thing to do on
   * the stages about the wheel: blue costs nothing to reach, red one slot and
   * gold two, and a stage that only ever named gold would be teaching one
   * reflex rather than the skill of arriving at an appointment. The stages
   * about the *stun* name gold and nothing else, because there the card is not
   * the exercise — delivering it is.
   */
  wants?: CardColor;
  /** How clearly the wheel and the ranges are drawn. Fades along the path. */
  clarity: number;
}

const STAGES: Record<TwistedDrillId, StageDef> = {
  tfPick: {
    id: 'tfPick',
    stage: 'LEARN',
    duration: 45,
    abilities: ['w'],
    loadout: { pickACard: true },
    weights: { lock: 0.44, wheel: 0.34, damage: 0.1, timing: 0.12 },
    // Reachable at the *lowest* difficulty, on purpose. The volume gate is
    // there to stop a player being graded on three presses, and a harder run
    // asks for more cards — so a ceiling only a hard run could reach would
    // turn the gate into a difficulty bonus, which is the opposite of a gate.
    expected: 7,
    askEvery: 5.8,
    clarity: 1,
  },
  tfGold: {
    id: 'tfGold',
    stage: 'ISOLATED',
    duration: 55,
    abilities: ['w'],
    loadout: { pickACard: true },
    weights: { gold: 0.36, wheel: 0.26, lock: 0.14, timing: 0.12, damage: 0.12 },
    expected: 8,
    askEvery: 6.2,
    wants: 'gold',
    clarity: 0.85,
  },
  tfWild: {
    id: 'tfWild',
    stage: 'ISOLATED',
    duration: 55,
    abilities: ['q'],
    loadout: { wildCards: true },
    weights: { fan: 0.34, pierce: 0.28, spacing: 0.14, damage: 0.14, timing: 0.1 },
    expected: 9,
    askEvery: 0,
    clarity: 0.8,
  },
  tfDeck: {
    id: 'tfDeck',
    stage: 'COMBINED',
    duration: 60,
    abilities: ['q'],
    loadout: { wildCards: true, stackedDeck: true },
    weights: { deck: 0.38, timing: 0.2, fan: 0.14, damage: 0.14, spacing: 0.14 },
    expected: 8,
    askEvery: 0,
    clarity: 0.65,
  },
  tfHold: {
    id: 'tfHold',
    stage: 'COMBINED',
    duration: 60,
    abilities: ['w'],
    loadout: { pickACard: true, stackedDeck: true },
    weights: { carry: 0.4, gold: 0.2, wheel: 0.16, timing: 0.12, damage: 0.12 },
    expected: 5,
    askEvery: 0,
    wants: 'gold',
    clarity: 0.55,
  },
  tfPressure: {
    id: 'tfPressure',
    stage: 'PRESSURE',
    duration: 60,
    abilities: ['q', 'w'],
    loadout: { pickACard: true, wildCards: true, stackedDeck: true },
    weights: { lock: 0.26, wheel: 0.24, dodging: 0.22, damage: 0.14, timing: 0.14 },
    expected: 9,
    askEvery: 6,
    clarity: 0.4,
  },
  tfCombo: {
    id: 'tfCombo',
    stage: 'PRESSURE',
    duration: 65,
    abilities: ['q', 'w'],
    loadout: { pickACard: true, wildCards: true, stackedDeck: true },
    weights: { combo: 0.34, gold: 0.2, wheel: 0.14, damage: 0.16, survival: 0.16 },
    expected: 7,
    askEvery: 0,
    wants: 'gold',
    clarity: 0.3,
  },
  tfGate: {
    id: 'tfGate',
    stage: 'TRANSFER',
    duration: 65,
    abilities: ['q', 'w', 'r'],
    loadout: { pickACard: true, wildCards: true, stackedDeck: true, destiny: true },
    weights: { gate: 0.38, dodging: 0.18, damage: 0.16, wheel: 0.12, survival: 0.16 },
    expected: 5,
    askEvery: 0,
    clarity: 0.2,
  },
  tfFight: {
    id: 'tfFight',
    stage: 'TEST',
    duration: 0,
    abilities: ['q', 'w', 'e', 'r'],
    loadout: { pickACard: true, wildCards: true, stackedDeck: true, destiny: true },
    weights: {
      gold: 0.14,
      wheel: 0.14,
      combo: 0.12,
      deck: 0.1,
      fan: 0.1,
      timing: 0.1,
      survival: 0.16,
      damage: 0.14,
    },
    expected: 8,
    askEvery: 0,
    clarity: 0,
  },
};

export const twistedStage = (id: TwistedDrillId): StageDef => STAGES[id];

export const isTwistedDrill = (id: string): id is TwistedDrillId => id in STAGES;

/**
 * How long the gate's ring is announced before it lights, and how long it
 * then stays lit.
 *
 * The second number is the important one and it is deliberately shorter than
 * Destiny and the Gate take together ({@link TWISTED_STATS.rChannel} plus
 * {@link TWISTED_STATS.rGateChannel} is three full seconds): a player who
 * presses the ultimate when the ring lights cannot arrive, and a player who
 * presses it on the telegraph arrives with time to spare. That gap is the
 * entire stage.
 */
const GATE_TELEGRAPH = 3;
const GATE_OPEN_FOR = 2.8;

/** One card asked for, and what became of it. */
interface Ask {
  want: CardColor;
  at: number;
  /** Seconds from the ask to the correct card being on the hand, or null. */
  tookMs: number | null;
  wrong: boolean;
}

/** One approach: something walks at you, and you either had a card or not. */
interface Contact {
  at: number;
  /** What was on the hand when it arrived. */
  held: CardColor | null;
}

export class TwistedDrill extends Drill {
  readonly def: StageDef;
  readonly kit: TwistedKit;

  /** The unit the stage is currently pointing at, if it names one. */
  priorityId = -1;
  /**
   * Where the gate is being asked to land, on the stage that asks.
   *
   * It exists before it is open. `opensAt` is the whole design of the stage:
   * the ring is drawn dim two and a half seconds early, and the window it then
   * holds is shorter than Destiny and the Gate take together — so a player who
   * starts the ultimate when the ring lights has already missed it, and a
   * player who starts it on the telegraph walks in with a second to spare.
   * That is the roam, and it is the one thing about the ultimate a sixty
   * second rep can teach.
   */
  gateZone: { pos: Vec2; radius: number; opensAt: number; until: number } | null = null;

  private asks: Ask[] = [];
  private askCd = 0;
  private lastLocks = 0;
  private lastGoldOnChamps = 0;
  private lastGates = 0;

  private contacts: Contact[] = [];
  private contactCd = 0;
  private contactWarned = false;

  /** Live set-ups: a stun landed, and what has connected inside it since. */
  private setups: { targetId: number; until: number; card: boolean; auto: boolean }[] = [];
  private combos = 0;
  private setupsOffered = 0;

  private respawnCd = 0;
  private waveCd = 0;
  private hazardCd = 0;
  private gateCd = 0;
  private gatesLandedInZone = 0;
  private gateZonesOffered = 0;
  /**
   * Rings that opened while the ultimate could actually have answered them.
   *
   * The denominator, and it has to be this one rather than the count of rings:
   * Destiny is on a twenty-two second cooldown and the ring opens more often
   * than that, so grading against every ring would be marking a player down
   * for a window that no play of any kind could have reached. A chance is a
   * ring that opened with the ultimate up, armed, or already channelling.
   */
  private gateChances = 0;
  private kills = 0;
  /** Rolling picture of whether the player is actually driving the champion. */
  private movingTime = 0;
  private totalTime = 0;

  constructor(session: import('../engine/session').Session, id: TwistedDrillId) {
    super(session);
    this.def = STAGES[id];
    this.kit = new TwistedKit(session, this.def.loadout);
  }

  // ----------------------------------------------------------------- setup

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.kit.spawn({ x: w * 0.3, y: h * 0.58 });
    // Every stage runs its full clock. Health is a graded cost, not a fail
    // state — except in the test, where it is the whole point.
    if (this.def.id !== 'tfFight') {
      p.maxHp = 1500;
      p.hp = 1500;
    } else {
      p.maxHp = 1000;
      p.hp = 1000;
    }
    if (this.def.id === 'tfWild' || this.def.id === 'tfGate' || this.def.id === 'tfFight') {
      this.buildTerrain();
    }

    switch (this.def.id) {
      case 'tfPick':
        // Nothing is happening on purpose. The wheel is the whole stage, and a
        // stage that made you dodge while learning it would be teaching two
        // things and measuring neither.
        this.spawnDummy('strafe', { still: true, harmless: true, endless: true });
        break;
      case 'tfGold':
        this.spawnDummy('strafe');
        break;
      case 'tfWild':
        // A body at the end of a line of bodies, strung out *away* from you
        // rather than across you — which is what a wave in a lane actually
        // looks like from the champion standing behind it, and the only
        // geometry in which three cards in a fan are worth more than one
        // missile. Aimed at the champion the middle card threads the whole
        // column; aimed anywhere else it clips one minion and stops mattering.
        this.spawnLaneWave(5);
        this.spawnDummy('retreat', { far: true });
        break;
      case 'tfDeck':
        this.spawnDummy('irregular');
        this.spawnWave(4);
        this.pickPriority();
        break;
      case 'tfHold':
        // Nothing on the field to start with. The stage is the approach, and
        // an approach has to be approached from somewhere.
        this.contactCd = 4;
        break;
      case 'tfPressure':
        this.spawnDummy('irregular');
        this.spawnPressure();
        break;
      case 'tfCombo':
        this.spawnHunter();
        break;
      case 'tfGate':
        this.spawnPressure();
        this.gateCd = 4;
        break;
      case 'tfFight':
        this.spawnHunter();
        this.spawnDummy('erratic');
        this.spawnWave(4);
        break;
    }

    if (this.def.wants) this.kit.want = this.def.wants;
    if (this.def.askEvery > 0) this.ask();
  }

  /** Two pillars: something for the fan to be blocked by, and a gate to clear. */
  private buildTerrain(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.walls = [
      { x: w * 0.56, y: h * 0.2, w: 80, h: 240 },
      { x: w * 0.56, y: h * 0.82, w: 80, h: 240 },
    ];
  }

  private spawnDummy(
    behavior: BotBehavior,
    opts: { still?: boolean; close?: boolean; far?: boolean; harmless?: boolean; endless?: boolean } = {},
  ): Actor {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const want = opts.close ? 380 : opts.far ? 860 : 620;
    const at = p
      ? { x: clamp(p.pos.x + want, 120, w - 120), y: clamp(p.pos.y - this.s.rng.range(-200, 200), 120, h - 120) }
      : { x: w * 0.7, y: h * 0.5 };
    const a = this.spawnEnemy('ranger', at, { hpScale: 2.8, behavior });
    a.attack.range = 320;
    a.attack.damage = opts.harmless ? 0 : 22;
    a.label = 'TARGET';
    // The learning stage's target is a training dummy in the literal sense:
    // enough health that it is still standing at the end of the run, whatever
    // the difficulty. Everything on that stage other than the wheel has to be
    // a constant, and a target that dies sooner on one setting than another is
    // a stage where the *damage* term moves when the slider does — which reads
    // back as "the hardest setting scored best" and is nothing of the kind.
    if (opts.endless) {
      a.maxHp = 60000;
      a.hp = 60000;
    }
    const brain = this.lastBrain;
    if (brain) brain.preferredRange = opts.still ? 460 : opts.close ? 300 : opts.far ? 840 : 560;
    if (opts.still) a.moveSpeed = 0;
    else a.moveSpeed = 200 + this.s.config.difficulty * 120;
    return a;
  }

  /** Something that will not let the player stand still. */
  private spawnPressure(): Actor {
    const pos = this.randomPoint(this.s.world.player?.pos ?? null, 760, 140);
    const a = this.spawnEnemy('artillery', pos, { hpScale: 1.7, behavior: 'retreat' });
    a.attack.damage = 26;
    a.label = 'SHELLER';
    const brain = this.lastBrain;
    if (brain) brain.preferredRange = 700;
    return a;
  }

  /**
   * Something that is coming for you specifically.
   *
   * `fragile` is the approach stage's, and it is not a difficulty setting: that
   * stage is about the card you were already holding when somebody arrived, so
   * the arrival has to *end* — a hunter still standing when the next one walks
   * in turns a series of approaches into one long fight, which is the one thing
   * the mode is not about.
   */
  private spawnHunter(opts: { fragile?: boolean } = {}): Actor {
    const pos = this.randomPoint(this.s.world.player?.pos ?? null, 640, 150);
    const a = this.spawnEnemy('diver', pos, { hpScale: opts.fragile ? 0.42 : 1.2, behavior: 'diver' });
    a.moveSpeed = 172 + this.s.config.difficulty * 84;
    a.attack.damage = 22 + this.s.config.difficulty * 22;
    a.label = 'HUNTER';
    return a;
  }

  /** A line of bodies to shoot along rather than at. */
  private spawnWave(n: number): void {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const cx = p ? clamp(p.pos.x + 520, 220, w - 220) : w * 0.55;
    for (let i = 0; i < n; i++) {
      const a = this.s.world.spawnActor({
        pos: { x: cx + this.s.rng.range(-30, 30), y: h * 0.22 + ((i + 0.5) * h * 0.56) / n },
        team: 'enemy',
        maxHp: 200,
        radius: 24,
        moveSpeed: 62,
        isMinion: true,
        unitKind: 'melee',
        label: 'MINION',
        attack: { attackSpeed: 0.6, windupRatio: 0.3, backswingRatio: 0.3, range: 130, damage: 8, projectileSpeed: 0 },
      });
      a.order = { kind: 'attackMove', pos: { x: a.pos.x - 700, y: a.pos.y } };
    }
  }

  /**
   * A wave seen down the lane rather than across it.
   *
   * `spawnWave` builds the wall every other mode wants — a line of bodies
   * *between* you and something, which is what threading is about. This is the
   * other view of the same wave, the one you get standing behind your own
   * minions, and it is the only arrangement in which the fan's whole point is
   * visible: one press, one line, everything on it.
   */
  private spawnLaneWave(n: number): void {
    const p = this.s.world.player;
    const { w, h } = this.s.world.bounds;
    const x0 = p ? p.pos.x + 380 : w * 0.3;
    const y0 = p ? p.pos.y : h * 0.5;
    for (let i = 0; i < n; i++) {
      const a = this.s.world.spawnActor({
        pos: {
          x: clamp(x0 + i * 105, 140, w - 140),
          y: clamp(y0 + this.s.rng.range(-46, 46), 140, h - 140),
        },
        team: 'enemy',
        maxHp: 200,
        radius: 24,
        moveSpeed: 62,
        isMinion: true,
        unitKind: i < 2 ? 'melee' : 'caster',
        label: 'MINION',
        attack: { attackSpeed: 0.6, windupRatio: 0.3, backswingRatio: 0.3, range: 130, damage: 8, projectileSpeed: 0 },
      });
      a.order = { kind: 'attackMove', pos: { x: a.pos.x - 700, y: a.pos.y } };
    }
  }

  private pickPriority(): void {
    const champs = this.s.world.enemies().filter((e) => !e.isMinion);
    if (!champs.length) return;
    const next = this.s.rng.pick(champs);
    this.priorityId = next.id;
  }

  // ------------------------------------------------------------- the asking

  /**
   * Name a card.
   *
   * The wheel always starts on blue, so *which* card is asked for is not a
   * cosmetic choice: blue costs nothing to reach, red one slot and gold two,
   * and a stage that only ever asked for gold would be teaching one reflex
   * rather than the skill of arriving at an appointment. The learning stage
   * therefore rotates through all three, and the later ones — where the card
   * that matters is the one that stuns — ask for gold and nothing else.
   */
  private ask(): void {
    const prev = this.asks[this.asks.length - 1]?.want;
    const pool = CARD_ORDER.filter((c) => c !== prev);
    const want = this.def.wants ?? this.s.rng.pick(pool.length ? pool : CARD_ORDER);
    this.kit.want = want;
    this.asks.push({ want, at: this.s.elapsed, tookMs: null, wrong: false });
    // The wheel turns at the same speed at every difficulty — it is the
    // champion, not a setting — so what a harder run changes is how often it
    // is asked for. Pick a Card is on four seconds and gold is up to a second
    // and a half away, so at the low end there is room to lose a turn and
    // catch up, and at the top there is not: the only way to keep pace is to
    // take the card the first time it comes round, every single time.
    this.askCd = this.def.askEvery * (1 - 0.32 * this.s.config.difficulty);
    this.s.setBanner(CARD_NAME[want], 1.1, { tone: 'critical', key: 'ask' });
    const p = this.s.world.player;
    if (p) this.s.fx.ring(p.pos.x, p.pos.y, p.radius + 10, p.radius + 90, 0.4, CARD_COLOR[want], 3, 'pulse');
  }

  private get openAsk(): Ask | undefined {
    const last = this.asks[this.asks.length - 1];
    return last && last.tookMs === null && !last.wrong ? last : undefined;
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

    this.pollLocks();
    this.pollGold();
    this.pollGates();
    this.expireSetups();

    if (this.def.askEvery > 0) {
      this.askCd -= dt;
      if (this.askCd <= 0) {
        // An ask that ran out unanswered is a missed appointment, and the
        // ledger keeps it as one rather than quietly replacing it.
        const open = this.openAsk;
        if (open) open.wrong = true;
        this.ask();
      }
    }

    if (this.def.id === 'tfHold') this.stepApproach(dt);
    if (this.def.id === 'tfGate') this.stepGateZone(dt);

    this.repopulate(dt);

    if (this.def.id === 'tfWild' || this.def.id === 'tfDeck' || this.def.id === 'tfFight') {
      this.waveCd -= dt;
      const minions = this.s.world.enemies().filter((e) => e.isMinion);
      if (minions.length < 2 && this.waveCd <= 0) {
        this.waveCd = 5;
        if (this.def.id === 'tfWild') this.spawnLaneWave(5);
        else this.spawnWave(4);
      }
    }

    // Pressure stages drop zones on the player's feet, so "stand still and
    // watch the wheel" is not a position anybody gets to hold.
    //
    // The gate stage is deliberately not on this list. Its channel roots you
    // for a second and a half, a zone lands every two, and a zone aimed at
    // where you are standing cannot be dodged by somebody who cannot move —
    // so zones there would not be asking you to pick your moment, they would
    // be charging you for the ultimate existing. What presses you on that
    // stage is a shelling unit you have to be out of position for, which is a
    // thing a choice can answer.
    if (this.def.id === 'tfPressure' || this.def.id === 'tfFight') {
      this.hazardCd -= dt;
      if (this.hazardCd <= 0 && p) {
        this.hazardCd = 2.2 - this.s.config.difficulty * 0.6;
        const lead = this.s.rng.range(0.15, 0.5);
        this.s.world.spawnHazard({
          pos: { x: p.pos.x + p.vel.x * lead, y: p.pos.y + p.vel.y * lead },
          team: 'enemy',
          shape: 'circle',
          radius: 126,
          warn: 0.95 - this.s.config.difficulty * 0.25,
          active: 0.3,
          damage: 50,
          color: PALETTE.hazard,
        });
      }
    }
  }

  /** Keep the field populated. A stage that empties itself stops teaching. */
  private repopulate(dt: number): void {
    if (this.def.id === 'tfHold') return;
    const champs = this.s.world.enemies().filter((e) => !e.isMinion);
    // One shelling unit on the gate stage, not two. Its whole ask is three
    // seconds of standing still, and two artillery zones inside three seconds
    // is not pressure on the decision — it is the decision being taken away.
    const wanted = this.def.id === 'tfFight' ? 2 : 1;
    if (champs.length >= wanted) return;
    this.respawnCd -= dt;
    if (this.respawnCd > 0) return;
    this.respawnCd = 1.4;
    switch (this.def.id) {
      case 'tfCombo':
        this.spawnHunter();
        break;
      case 'tfGate':
        this.spawnPressure();
        break;
      case 'tfFight':
        if (champs.length === 0) this.spawnHunter();
        else this.spawnDummy('erratic');
        break;
      case 'tfWild':
        this.spawnDummy('retreat', { far: true });
        break;
      case 'tfPick':
        this.spawnDummy('strafe', { still: true, harmless: true, endless: true });
        break;
      default:
        this.spawnDummy('irregular');
        if (this.def.id === 'tfDeck') this.pickPriority();
        break;
    }
  }

  /** Did a lock happen this frame, and was it the one that was asked for? */
  private pollLocks(): void {
    const locks = this.kit.stats.wLocks;
    if (locks === this.lastLocks) return;
    this.lastLocks = locks;
    const held = this.kit.held;
    const open = this.openAsk;
    if (!open || !held) return;
    if (held === open.want) open.tookMs = (this.s.elapsed - open.at) * 1000;
    else open.wrong = true;
  }

  /**
   * A gold card landing on a champion opens a set-up.
   *
   * The stun is a second and a half, and a second and a half is exactly long
   * enough for a fan and an attack if you had both ready and nothing like long
   * enough if you have to think about it. What the combo stage scores is the
   * share of the stuns you bought that you then actually used.
   */
  private pollGold(): void {
    const n = this.kit.stats.goldOnChampions;
    if (n === this.lastGoldOnChamps) return;
    this.lastGoldOnChamps = n;
    const target = this.nearestChampion();
    if (!target) return;
    this.setupsOffered++;
    this.setups.push({
      targetId: target.id,
      until: this.s.elapsed + TWISTED_STATS.goldStun,
      card: false,
      auto: false,
    });
    // No banner: the card's own word lands on the target, and a stun is
    // over before a banner could have been read.
  }

  private expireSetups(): void {
    for (let i = this.setups.length - 1; i >= 0; i--) {
      if (this.s.elapsed < this.setups[i].until) continue;
      this.setups.splice(i, 1);
    }
  }

  private nearestChampion(): Actor | null {
    const p = this.s.world.player;
    if (!p) return null;
    let best: Actor | null = null;
    let bd = Infinity;
    for (const a of this.s.world.enemies()) {
      if (a.isMinion || !a.alive) continue;
      const d = dist(p.pos, a.pos);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /**
   * The approach.
   *
   * A hunter walks in on a clock the player can see. Everything about this
   * stage is the two seconds *before* it arrives: a wheel started then is a
   * wheel that finishes while somebody is already hitting you, and the whole
   * point of a card that waits indefinitely is that it never has to be.
   */
  private stepApproach(dt: number): void {
    this.contactCd -= dt;
    if (!this.contactWarned && this.contactCd <= 2.5) {
      this.contactWarned = true;
      this.s.setBanner('INCOMING', 1, { tone: 'critical', key: 'incoming' });
      audioSafeTelegraph(this.s);
    }
    if (this.contactCd > 0) return;
    // Long enough that the wheel can come round between approaches, and that
    // is not a comfort setting — Pick a Card is on six seconds and a card is
    // eaten by the first attack of the fight, so an approach every eight
    // seconds would make arriving loaded a thing no play could achieve and the
    // mode would be measuring the cooldown rather than the habit.
    this.contactCd = 12.5 - this.s.config.difficulty * 2.5;
    this.contactWarned = false;
    // What was on the hand at the moment it arrived is the whole measurement,
    // and it is taken here — before the fight — rather than after it, because
    // afterwards is when everybody has a card.
    this.contacts.push({ at: this.s.elapsed, held: this.kit.held });
    if (this.kit.held === 'gold') {
      this.s.micro('LOADED', this.s.world.player?.pos ?? { x: 0, y: 0 }, TF_GOLD);
    } else {
      this.s.micro('EMPTY HANDED', this.s.world.player?.pos ?? { x: 0, y: 0 }, PALETTE.danger);
    }
    this.spawnHunter({ fragile: true });
  }

  /**
   * The gate's landing zone.
   *
   * A ring somewhere on the far side of the floor, open for a few seconds.
   * Destiny takes a second and a half and the gate another, so the zone is
   * deliberately shorter than both together plus a walk: you cannot get there
   * on foot, and you cannot start the ultimate when the ring appears and still
   * make it. The only way in is to have had Destiny up already, which is the
   * habit the stage is for.
   */
  private stepGateZone(dt: number): void {
    const zone = this.gateZone;
    if (zone) {
      // The moment it lights. Announced, because a window you cannot see
      // coming is a reaction test and this is a planning one.
      if (this.s.elapsed >= zone.opensAt && this.s.elapsed - dt < zone.opensAt) {
        this.s.setBanner('GATE OPEN', 1, { tone: 'critical', key: 'gate' });
        this.s.fx.ring(zone.pos.x, zone.pos.y, 20, zone.radius, 0.5, TF_DESTINY, 4, 'shock');
      }
      if (this.s.elapsed > zone.until) this.gateZone = null;
    }
    this.gateCd -= dt;
    if (this.gateZone || this.gateCd > 0) return;
    const p = this.s.world.player;
    const pos = this.randomPoint(p?.pos ?? null, 1100, 220);
    const opensAt = this.s.elapsed + GATE_TELEGRAPH;
    this.gateZone = { pos, radius: 210, opensAt, until: opensAt + GATE_OPEN_FOR };
    this.gateZonesOffered++;
    // A chance is a ring the ultimate could have answered: up by the time it
    // lights, already armed, or already channelling. Grading against the rest
    // would be marking a player down for a window no play could reach.
    if (this.kit.gateArmed > 0 || this.kit.rCd <= GATE_TELEGRAPH || this.kit.destiny !== null) this.gateChances++;
    // One ring per ultimate, near enough, so the question the stage asks is
    // *when* rather than *which*.
    this.gateCd = TWISTED_STATS.rCd + GATE_TELEGRAPH - this.s.config.difficulty * 3;
    this.s.setBanner('GATE OPENING', 1.1, { tone: 'critical', key: 'gate' });
    this.s.fx.ring(pos.x, pos.y, 20, 210, 0.6, TF_DESTINY, 3, 'pulse');
  }

  private pollGates(): void {
    const n = this.kit.stats.gates;
    if (n === this.lastGates) return;
    this.lastGates = n;
    const zone = this.gateZone;
    const at = this.kit.lastGate?.to;
    if (!zone || !at) return;
    if (this.s.elapsed < zone.opensAt) return;
    if (dist(at, zone.pos) <= zone.radius) {
      this.gatesLandedInZone++;
      this.gateZone = null;
      this.gateCd = Math.max(this.gateCd, 4);
      this.s.micro('ON THE MARK', at, TF_DESTINY);
      this.s.fx.ring(at.x, at.y, 10, zone.radius, 0.6, PALETTE.good, 4, 'shock');
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    this.kit.onEvents(events);
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type === 'death' && e.byPlayer) {
        const victim = this.s.world.byId(e.actorId);
        if (!victim?.isMinion) this.kills++;
        if (this.def.id === 'tfDeck' && e.actorId === this.priorityId) this.pickPriority();
      }
      if (e.type !== 'attackLand' || e.actorId !== pid) continue;
      // Which half of the set-up landed. A fan and an attack inside the stun
      // is the combo; either one alone is half of it and scores nothing.
      const setup = this.setups.find((s) => s.targetId === e.targetId);
      if (!setup) continue;
      const wasCard = e.meta !== undefined && this.kit.wasWildCard(e.meta);
      if (wasCard) setup.card = true;
      else setup.auto = true;
      if (setup.card && setup.auto) {
        this.combos++;
        this.setups = this.setups.filter((s) => s !== setup);
        this.s.micro('SET-UP', e.pos ?? this.s.world.player?.pos ?? { x: 0, y: 0 }, TF_GOLD);
        this.s.fx.addFlash(0.14, TF_GOLD);
      }
    }
    if (this.def.id === 'tfFight' && this.s.world.enemies().filter((x) => !x.isMinion).length === 0 && this.kills >= 4) {
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
   * THE WHEEL, ON THE FLOOR.
   *
   * The single most useful thing this path draws, and the reason it is drawn
   * under the champion rather than in a corner of the HUD: the wheel is a
   * *tempo*, and a tempo belongs where your eyes already are. Three arcs — one
   * per card, in the order they come — and a head sweeping round them at two
   * cards a second. Watching it once tells a player everything the paragraph
   * above the stage could not: gold is a third of a turn away, it will be there
   * shortly, and it will be gone again just as fast.
   */
  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    const c = this.def.clarity;

    if (this.kit.loadout.wildCards && c > 0.05) {
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: TWISTED_STATS.qRange,
        color: TF_GOLD,
        alpha: 0.14 * c,
        width: 2.5,
        dash: 90,
        spin: 0.05,
        rise: 1.2,
      });
    }

    const wheel = this.kit.wheel;
    if (wheel !== 'idle') {
      const r = p.radius + 54;
      const span = (Math.PI * 2) / CARD_ORDER.length;
      for (let i = 0; i < CARD_ORDER.length; i++) {
        const card = CARD_ORDER[i];
        const lit = wheel === 'held' ? this.kit.held === card : this.kit.showing === card;
        // Arcs, not wedges. Three filled pie slices at this radius are a
        // bright disc sitting on top of the champion you are supposed to be
        // watching; three bands at the rim are a dial he stands in the middle
        // of. `inner` is what makes the difference.
        const band = lit ? 9 : 4;
        out.markers.push({
          kind: 'sector',
          x: p.pos.x,
          y: p.pos.y,
          radius: r + band,
          inner: r,
          a0: -Math.PI / 2 + i * span + 0.07,
          a1: -Math.PI / 2 + (i + 1) * span - 0.07,
          color: CARD_COLOR[card],
          alpha: lit ? 0.95 : 0.3,
          width: band,
          fill: 0,
          rise: 1.4,
        });
      }
      if (wheel === 'spinning') {
        // The head. Where it is *now* is the card you would take if you pressed
        // this instant, and how fast it is moving is the whole difficulty.
        const idx = CARD_ORDER.indexOf(this.kit.showing ?? 'blue');
        const a = -Math.PI / 2 + (idx + this.kit.slotPhase) * span;
        out.markers.push({
          kind: 'line',
          x: p.pos.x + Math.cos(a) * (r - 26),
          y: p.pos.y + Math.sin(a) * (r - 26),
          x2: p.pos.x + Math.cos(a) * (r + 18),
          y2: p.pos.y + Math.sin(a) * (r + 18),
          halfWidth: 5,
          color: '#ffffff',
          alpha: 0.85,
          rise: 1.6,
        });
        out.billboards.push({
          kind: 'timerBar',
          x: p.pos.x,
          y: p.pos.y,
          progress: this.kit.windowLeft / TWISTED_STATS.wWindow,
          color: CARD_COLOR[this.kit.showing ?? 'blue'],
          lift: 96,
        });
      }
    }

    // What the stage is asking for, above your own head, for as long as the
    // ask is open. A card named in a banner two seconds ago is a card nobody
    // is still thinking about.
    const open = this.openAsk;
    if (open) {
      out.billboards.push({
        kind: 'label',
        x: p.pos.x,
        y: p.pos.y,
        text: CARD_NAME[open.want],
        color: CARD_COLOR[open.want],
        size: 20,
        sub: 'lock it',
        lift: 210,
      });
    } else if (this.kit.held && this.def.id === 'tfHold') {
      out.billboards.push({
        kind: 'label',
        x: p.pos.x,
        y: p.pos.y,
        text: CARD_NAME[this.kit.held],
        color: CARD_COLOR[this.kit.held],
        size: 18,
        sub: 'loaded',
        lift: 210,
      });
    }

    // Stacked Deck, as four pips rather than a number, because the thing you
    // need to know at a glance is *is the next one the fourth*.
    if (this.kit.loadout.stackedDeck && c > 0.05) {
      const stacks = this.kit.deckStacks;
      for (let i = 0; i < TWISTED_STATS.deckEvery; i++) {
        const a = -Math.PI / 2 + (i - 1.5) * 0.22;
        out.markers.push({
          kind: 'cross',
          x: p.pos.x + Math.cos(a) * (p.radius + 86),
          y: p.pos.y + Math.sin(a) * (p.radius + 86),
          radius: 9,
          color: i < stacks ? TF_GOLD : PALETTE.textDim,
          alpha: i < stacks ? 0.85 : 0.3,
          width: 3,
          rise: 1.3,
        });
      }
    }

    // The unit the stage wants the fourth attack on.
    const cur = this.s.world.byId(this.priorityId);
    if (this.def.id === 'tfDeck' && cur && cur.alive) {
      out.billboards.push({ kind: 'caret', x: cur.pos.x, y: cur.pos.y, color: TF_GOLD, lift: 74 });
    }

    // A live set-up, drawn as the clock it actually is.
    for (const s of this.setups) {
      const target = this.s.world.byId(s.targetId);
      if (!target || !target.alive) continue;
      out.markers.push({
        kind: 'ring',
        x: target.pos.x,
        y: target.pos.y,
        radius: target.radius + 26,
        color: TF_GOLD,
        alpha: 0.7,
        width: 4,
        progress: clamp((s.until - this.s.elapsed) / TWISTED_STATS.goldStun, 0, 1),
        rise: 1.6,
      });
    }

    const zone = this.gateZone;
    if (zone) {
      const open = this.s.elapsed >= zone.opensAt;
      out.markers.push({
        kind: 'ring',
        x: zone.pos.x,
        y: zone.pos.y,
        radius: zone.radius,
        color: TF_DESTINY,
        alpha: open ? 0.55 : 0.22,
        width: open ? 4 : 2,
        fill: open ? 0.1 : 0,
        dash: open ? 30 : 60,
        spin: open ? 0.35 : 0.12,
        // Before it lights, the arc is the countdown to it. After, it is the
        // countdown of it — same ring, same reading, opposite urgency.
        progress: open
          ? clamp((zone.until - this.s.elapsed) / GATE_OPEN_FOR, 0, 1)
          : clamp(1 - (zone.opensAt - this.s.elapsed) / GATE_TELEGRAPH, 0, 1),
        rise: 1.1,
      });
      if (open) out.billboards.push({ kind: 'caret', x: zone.pos.x, y: zone.pos.y, color: TF_DESTINY, lift: 80 });
    }

    // The channel, as a bar over his head. An ultimate that can be taken off
    // you has to be one you can watch being taken.
    const ch = this.kit.channelProgress;
    if (ch !== null) {
      out.billboards.push({
        kind: 'timerBar',
        x: p.pos.x,
        y: p.pos.y,
        progress: ch,
        color: TF_DESTINY,
        lift: 112,
        width: 120,
      });
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: p.radius + 30 + 6 * Math.sin(t * 9),
        color: TF_DESTINY,
        alpha: 0.6,
        width: 3,
        rise: 1.5,
      });
    }

    // Where the gate is reaching to, while it is armed.
    if (this.kit.gateArmed > 0 && !this.kit.casting) {
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: TWISTED_STATS.rGateRange,
        color: TF_DESTINY,
        alpha: 0.12,
        width: 2,
        dash: 120,
        spin: -0.06,
        rise: 1,
      });
    }

    const gate = this.kit.lastGate;
    if (gate && this.s.world.time - gate.at < 0.7) {
      const a = 1 - (this.s.world.time - gate.at) / 0.7;
      out.markers.push({
        kind: 'line',
        x: gate.from.x,
        y: gate.from.y,
        x2: gate.to.x,
        y2: gate.to.y,
        halfWidth: 9,
        color: TF_DESTINY,
        alpha: 0.4 * a,
        rise: 1.5,
      });
    }
  }

  // -------------------------------------------------------------------- hud

  hudFields(): HudField[] {
    const st = this.kit.stats;
    const d = derive(this.s.metrics.m);
    const fields: HudField[] = [];

    if (this.kit.loadout.pickACard) {
      const waste = this.kit.wastedPerLock;
      const tone = waste < 0.6 ? 'good' : waste < 1.8 ? 'warn' : 'bad';
      fields.push({ label: 'WHEEL WASTE', value: waste.toFixed(1), bar: band(waste, 3, 0), tone });
    }

    switch (this.def.id) {
      case 'tfPick': {
        const acc = this.kit.lockAccuracy;
        fields.push({ label: 'RIGHT CARD', value: `${Math.round(acc * 100)}%`, bar: acc, tone: acc > 0.7 ? 'good' : 'warn' });
        break;
      }
      case 'tfGold':
        fields.push({ label: 'GOLD LANDED', value: `${st.goldOnChampions}`, tone: 'good' });
        break;
      case 'tfWild': {
        const per = this.kit.cardsPerCast;
        fields.push({ label: 'CARDS / CAST', value: per.toFixed(1), bar: per / 3, tone: per > 1.6 ? 'good' : 'warn' });
        fields.push({ label: 'THROUGH TWO', value: `${st.qMultiHits}`, tone: 'good' });
        break;
      }
      case 'tfDeck':
        fields.push({
          label: 'FOURTH ON TARGET',
          value: `${st.deckOnChampions}/${st.deckProcs}`,
          tone: st.deckOnMinions > st.deckOnChampions ? 'bad' : 'good',
        });
        break;
      case 'tfHold': {
        const loaded = this.contacts.filter((c) => c.held === 'gold').length;
        fields.push({
          label: 'LOADED ON CONTACT',
          value: `${loaded}/${this.contacts.length}`,
          tone: loaded === this.contacts.length ? 'good' : 'warn',
        });
        break;
      }
      case 'tfCombo':
        fields.push({
          label: 'SET-UPS USED',
          value: `${this.combos}/${this.setupsOffered}`,
          tone: this.combos >= this.setupsOffered ? 'good' : 'warn',
        });
        break;
      case 'tfGate':
        fields.push({
          label: 'GATES ON THE MARK',
          value: `${this.gatesLandedInZone}/${Math.max(this.gateChances, this.gatesLandedInZone)}`,
          tone: this.gatesLandedInZone > 0 ? 'good' : 'warn',
        });
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

  liveScore(): number {
    const st = this.kit.stats;
    const m = this.s.metrics.m;
    const right = this.asks.filter((a) => a.tookMs !== null).length;
    return Math.max(
      0,
      Math.round(
        m.damageDealt * 6 +
          right * 380 +
          st.goldOnChampions * 460 +
          st.qMultiHits * 240 +
          st.qCardHits * 70 +
          st.deckOnChampions * 300 +
          this.combos * 700 +
          this.gatesLandedInZone * 900 +
          this.contacts.filter((c) => c.held === 'gold').length * 420 +
          this.kills * 1400 -
          st.slotsWasted * 90 -
          st.wExpired * 260 -
          st.deckOnMinions * 160 -
          st.qWastedWindup * 220 -
          st.rInterrupted * 300 -
          m.hpLost * 2,
      ),
    );
  }

  private avgAskMs(): number {
    const done = this.asks.filter((a) => a.tookMs !== null).map((a) => a.tookMs as number);
    if (!done.length) return 3000;
    return done.reduce((a, b) => a + b, 0) / done.length;
  }

  // ---------------------------------------------------------------- outcome

  outcome(): DrillOutcome {
    const st = this.kit.stats;
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? TWISTED_STATS.hp);
    const w = this.def.weights;

    // Only the asks that got an answer of some kind. The last card named in a
    // run is routinely still open when the clock stops, and counting it as a
    // miss would mean a shorter cadence flattered a run and a longer one
    // docked it — a scoring artefact of *when the whistle went*, which is the
    // one thing about a rep that is nobody's doing.
    const resolved = this.asks.filter((a) => a.tookMs !== null || a.wrong);
    const answered = resolved.filter((a) => a.tookMs !== null).length;
    const asked = resolved.length;
    // Share *and* count, for the same reason the Ezreal path needs both: a
    // player who is asked for three cards and locks two of them is not 67%
    // accurate at anything, they have simply not played the stage yet.
    const lockShare = asked > 0 ? clamp(answered / asked, 0, 1) : 0;
    const lock = lockShare * band(answered, 0, Math.max(3, this.def.expected * 0.6));

    // The spine. Zero waste is a perfect score and three — a whole revolution
    // thrown away on every single lock — is nothing.
    const wheel = st.wLocks > 0 ? band(this.kit.wastedPerLock, 3, 0) * band(st.wLocks, 0, Math.max(3, this.def.expected * 0.6)) : 0;

    const gold = band(st.goldOnChampions, 0, Math.max(3, this.def.expected * 0.7));
    const fan = band(this.kit.cardsPerCast, 0.3, 2.2) * band(st.qCasts, 1, Math.max(4, this.def.expected * 0.7));
    const pierce = st.qCasts > 0 ? clamp(st.qMultiHits / st.qCasts, 0, 1) : 0;
    const deck =
      st.deckProcs > 0
        ? clamp(st.deckOnChampions / st.deckProcs, 0, 1) * band(st.deckProcs, 0, Math.max(3, this.def.expected * 0.6))
        : 0;
    const carry = this.contacts.length
      ? clamp(this.contacts.filter((c) => c.held === 'gold').length / this.contacts.length, 0, 1) *
        band(this.contacts.length, 0, 3)
      : 0;
    const combo = this.setupsOffered > 0 ? clamp(this.combos / this.setupsOffered, 0, 1) : 0;
    // A gate is scored on three things, and landing on the mark is only the
    // first: a channel you survived and a landing that can actually reach
    // something are the other two, and a gate with neither is a walk.
    // Arriving on the mark is most of it; surviving the channel at all is the
    // rest. Where the ring happens to be relative to a threat is not the
    // player's doing, so `gatesOnTarget` is reported and not graded.
    const gate = this.gateChances
      ? clamp(
          (this.gatesLandedInZone * 0.78 + Math.max(0, st.gates - st.rInterrupted) * 0.22) / this.gateChances,
          0,
          1,
        )
      : 0;

    const damage = band(m.damageDealt / Math.max(1, this.s.elapsed), 14, 58);
    const dodging = clamp(d.dodgeRate * 0.5 + band(m.hazardExposure, 6, 0.2) * 0.5, 0, 1);

    const parts: [number | undefined, number][] = [
      [w.lock, lock],
      [w.wheel, wheel],
      [w.gold, gold],
      [w.fan, fan],
      [w.pierce, pierce],
      [w.deck, deck],
      [w.carry, carry],
      [w.combo, combo],
      [w.gate, gate],
      [w.timing, d.attackTiming],
      [w.spacing, d.advantageousSpacing],
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

    // Two multiplicative gates, both there because the alternative is a player
    // who locks one card and is told they are elite.
    //
    // Volume: a handful of presses is not a measurement.
    // Presence: past the learning stage, a champion nobody is driving does not
    // get graded on choice-making — standing still is what makes the wheel easy
    // and it is exactly what nobody gets to do in a game.
    const acts =
      this.def.askEvery > 0
        ? asked
        : Math.max(st.wLocks, st.qCasts, st.deckProcs, this.contacts.length, this.gateChances);
    const volume = band(acts, 1, this.def.expected);
    const driving = this.totalTime > 1 ? clamp(this.movingTime / this.totalTime, 0, 1) : 0;
    const presence = this.def.stage === 'LEARN' ? 1 : band(driving, 0.1, 0.45);
    const performance = clamp(raw * (0.42 + 0.58 * volume) * (0.5 + 0.5 * presence), 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    const waste = this.kit.wastedPerLock;
    if (st.wLocks > 3 && waste < 0.4) helped.push('You are taking the card the first time it comes round.');
    if (lockShare > 0.8 && asked > 4) helped.push(`${answered} of ${asked} cards locked as asked.`);
    if (st.goldOnChampions > 3) helped.push(`${st.goldOnChampions} gold cards landed on somebody who minded.`);
    if (this.kit.cardsPerCast > 1.8) helped.push('Your fans are going through the wave rather than into it.');
    if (st.deckProcs > 2 && st.deckOnMinions === 0) helped.push('Every fourth attack went where it was worth something.');
    if (this.combos > 0 && this.combos === this.setupsOffered) helped.push('Every stun you bought, you used.');
    if (this.gatesLandedInZone > 0) helped.push(`${this.gatesLandedInZone} gates that arrived exactly where they were asked to.`);

    if (st.wLocks > 2 && waste >= 1.5)
      hurt.push(`${waste.toFixed(1)} wasted card-slots per lock — you are letting the wheel come round again.`);
    if (st.wExpired > 0) hurt.push(`${st.wExpired} spins that ran out without a card taken.`);
    if (st.wWrong > st.wRight && st.wLocks > 3) hurt.push('More wrong cards than right ones. Watch the wheel, not the keyboard.');
    if (st.deckOnMinions > st.deckOnChampions && st.deckProcs > 2)
      hurt.push(`${st.deckOnMinions} fourth attacks fed to a minion.`);
    if (st.cardsOnMinions > 2) hurt.push(`${st.cardsOnMinions} cards spent on a minion.`);
    if (st.onTheEdge > 2) hurt.push(`${st.onTheEdge} locks taken with under a tenth of a second of the slot left.`);
    if (st.rInterrupted > 0) hurt.push(`${st.rInterrupted} channels broken. Destiny is not something you press while being hit.`);
    if (this.setupsOffered > 0 && this.combos === 0 && this.def.weights.combo)
      hurt.push('You stunned somebody and then did nothing with the second and a half you bought.');
    if (driving < 0.25 && this.def.stage !== 'LEARN') hurt.push('You barely moved. Every score on this path past the first is gated on that.');

    const advice =
      st.wLocks > 2 && waste >= 1.5
        ? 'Press W the instant the card you want lights, not once you have thought about it. The wheel is half a second a card — if you are deciding while it turns, you have already missed it.'
        : st.wExpired > 0
          ? 'A spin you never lock is worse than a wrong card: it costs the cooldown and buys nothing. Take something.'
          : st.deckOnMinions > st.deckOnChampions && st.deckProcs > 2
            ? 'Count to four. The fourth attack is worth three of the others and it goes wherever your last click went.'
            : this.setupsOffered > 0 && this.combos < this.setupsOffered
              ? 'The gold card is the start of the sentence, not the end of it. Cards and an attack, inside the stun, every time.'
              : driving < 0.25 && this.def.stage !== 'LEARN'
                ? 'Keep moving while you pick. Standing still is what makes the wheel easy and it is the one thing you will not get to do.'
                : 'That is the shape of him. Take it to the next stage and keep the feet going.';

    const metrics = [];
    if (this.kit.loadout.pickACard) {
      metrics.push(count('tfLocks', 'CARDS LOCKED', st.wLocks));
      metrics.push(count('tfWaste', 'WASTED CARD-SLOTS', st.slotsWasted, 'lower'));
    }
    if (w.lock) {
      metrics.push(pct('tfRight', 'RIGHT CARD', lockShare));
      metrics.push(ms('tfAsk', 'TIME TO THE CARD', this.avgAskMs()));
    }
    if (w.gold) metrics.push(count('tfGold', 'GOLD CARDS LANDED', st.goldOnChampions));
    if (w.fan) metrics.push(pct('tfFan', 'CARDS CONNECTING PER CAST', clamp(this.kit.cardsPerCast / 3, 0, 1)));
    if (w.pierce) metrics.push(count('tfThrough', 'FANS THROUGH TWO OR MORE', st.qMultiHits));
    if (w.deck) metrics.push(pct('tfDeck', 'FOURTH ATTACKS ON TARGET', st.deckProcs > 0 ? st.deckOnChampions / st.deckProcs : 0));
    if (w.carry) {
      metrics.push(pct('tfCarry', 'LOADED ON CONTACT', this.contacts.length ? this.contacts.filter((c) => c.held === 'gold').length / this.contacts.length : 0));
      metrics.push(secs('tfHold', 'LONGEST CARD HELD', st.longestHold));
    }
    if (w.combo) metrics.push(pct('tfCombo', 'STUNS FOLLOWED UP', combo));
    if (w.gate) {
      metrics.push(count('tfGates', 'GATES ON THE MARK', this.gatesLandedInZone));
      metrics.push(count('tfBroken', 'CHANNELS BROKEN', st.rInterrupted, 'lower'));
    }
    if (w.timing) metrics.push(pct('timing', 'ATTACK TIMING', d.attackTiming));
    metrics.push(count('damage', 'DAMAGE DEALT', Math.round(m.damageDealt)));

    return {
      score: this.liveScore(),
      performance,
      axisPerformance: {
        // The wheel is a hand-speed problem before it is anything else: it is
        // a three-way choice resolved in under half a second, which is the
        // definition of the tempo axis.
        tempo: clamp(wheel * 0.6 + lockShare * 0.4, 0, 1),
        targeting: clamp((this.kit.loadout.stackedDeck ? deck : 0) * 0.5 + gold * 0.5, 0, 1),
        movement: clamp(driving, 0, 1),
        ...(w.fan || w.pierce ? { skillshot: clamp(fan * 0.6 + pierce * 0.4, 0, 1), aim: clamp(fan, 0, 1) } : {}),
        ...(w.timing ? { kiting: d.attackTiming } : {}),
        ...(w.spacing ? { spacing: d.advantageousSpacing } : {}),
        ...(w.dodging ? { dodging } : {}),
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

/**
 * The approach's warning noise.
 *
 * Kept as a function rather than inlined so the stage reads as what it is —
 * a telegraph, two and a half seconds out — and so there is exactly one place
 * to change if it ever wants a voice of its own.
 */
const audioSafeTelegraph = (s: import('../engine/session').Session): void => {
  const p = s.world.player;
  if (p) s.fx.ring(p.pos.x, p.pos.y, 40, 260, 0.5, PALETTE.warn, 3, 'pulse');
};
