/**
 * The Card Master's kit.
 *
 * The client already teaches two halves of a champion and it teaches them with
 * two champions. Vayne is *rhythm* — when in the attack cycle a button belongs.
 * Ezreal is *aim while moving* — where a missile has to go when both of you are
 * travelling. Twisted Fate is the third thing, and it is the one neither of
 * them can touch: **choosing under a clock that does not stop for you.**
 *
 * Pick a Card is unlike anything else in the game. Every other ability in
 * League asks *where* and *when*; this one asks *which*, and it asks it while a
 * wheel turns at two cards a second whether or not you have decided. Get it
 * right and the next attack is a stun. Get it wrong and it is a slightly harder
 * auto-attack — and, far worse, you have spent the wheel and have to spin it
 * again in front of somebody who has watched you do it.
 *
 * So the kit is built around four facts, each of which a stage of the path is
 * about:
 *
 *  - **The wheel is a metronome, not a menu.** Blue, red, gold, blue, red,
 *    gold, half a second each, forever. Locking gold is not a decision; it is
 *    an *appointment*, and the whole skill is arriving at it without waiting
 *    for the wheel to come round again. That is why the number this kit leads
 *    with is not "did you lock gold" but **how many card-slots you burned
 *    getting there** — the minimum is two, and every extra three is a whole
 *    revolution a real opponent spent walking away.
 *  - **A locked card waits.** It sits on the hand until an attack lands,
 *    indefinitely, exactly as in League. Which means the good habit is to lock
 *    it *before* you need it, and the bad one is to start the wheel when the
 *    fight is already happening. One stage is entirely about that difference.
 *  - **Wild Cards is three missiles, not one.** They leave in a fan and they
 *    pierce, so the aim problem is a *line* through a crowd rather than a point
 *    on a body: aimed at one target you land one card, aimed along the wave you
 *    land nine.
 *  - **Stacked Deck counts for you and spends for you.** Every fourth attack
 *    is worth three, and the fourth attack goes wherever your last click went —
 *    which, for most players, is a caster minion.
 *
 * As with the other kits, this one owns its state and knows nothing about
 * drills, so every Twisted Fate stage shares one implementation of him.
 */
import { audio } from './audio';
import type { AbilitySlot } from './input';
import { clamp, dist, norm } from './math';
import { PALETTE } from './palette';
import type { AbilityView, Session } from './session';
import type { Actor, Vec2 } from './types';
import type { WorldEvent } from './world';

/** His own gold, and the three faces of the wheel. */
export const TF_GOLD = '#ffcf5c';
export const TF_BLUE = '#5cc8ff';
export const TF_RED = '#ff6155';
/** Destiny: the one colour on him that is not a card. */
export const TF_DESTINY = '#b07bff';

export type CardColor = 'blue' | 'red' | 'gold';

/** The wheel's order, and it never changes. That is the entire point of it. */
export const CARD_ORDER: CardColor[] = ['blue', 'red', 'gold'];

export const CARD_COLOR: Record<CardColor, string> = {
  blue: TF_BLUE,
  red: TF_RED,
  gold: TF_GOLD,
};

export const CARD_NAME: Record<CardColor, string> = {
  blue: 'BLUE CARD',
  red: 'RED CARD',
  gold: 'GOLD CARD',
};

export const TWISTED_STATS = {
  hp: 690,
  moveSpeed: 330,
  radius: 26,
  attack: {
    // Stacked Deck's attack speed is folded in here rather than applied later:
    // it is a passive with no condition on it, so a champion who has the point
    // simply attacks this fast and there is no state for anyone to track.
    attackSpeed: 0.78,
    windupRatio: 0.26,
    backswingRatio: 0.32,
    range: 525,
    damage: 54,
    projectileSpeed: 1600,
    projectileColor: TF_GOLD,
  },

  /** Q — Wild Cards. Three of them, in a fan, and they go through people. */
  qRange: 1450,
  qSpeed: 1000,
  qRadius: 30,
  qDamage: 58,
  /**
   * League's, maxed — and the same four seconds the wheel is on, which is not
   * a coincidence and is the reason the combo exists at all. Wild Cards and
   * Pick a Card come down together as they are levelled, so a Twisted Fate who
   * has taken them where every Twisted Fate takes them has one fan for every
   * card, arriving at the same time. Leave them on different cooldowns and the
   * set-up stage would be asking for something the kit cannot supply.
   */
  qCd: 4,
  /** Rank one, for the reference table. Nothing reads it but the codex. */
  qLeagueCd: 6,
  qCast: 0.25,
  /** Radians between one card and the next. League's fan is 28° across. */
  qFan: 0.2443,

  /**
   * W — Pick a Card.
   *
   * Two presses. The first starts the wheel, the second takes whatever is
   * showing. Half a second a card is League's, and it is the number the entire
   * champion is balanced on: fast enough that gold is a reaction rather than a
   * choice, slow enough that a calm player gets it every time.
   */
  wCycle: 0.5,
  /** How long the wheel spins unattended before it gives up and refunds. */
  wWindow: 6,
  /**
   * League's, maxed.
   *
   * Pick a Card is six seconds at rank one and four once it is maxed, and
   * every Twisted Fate has it there long before the wheel is the thing
   * deciding his fights — so four is the number the champion is actually
   * played on, not a practice discount like Condemn's or Flash's. It matters
   * more than it looks: the wheel takes up to a second and a half to reach
   * gold, so a four-second cooldown is what turns "first pass or second" from
   * a preference into something you can be late for.
   */
  wCd: 4,
  /** Rank one, for the reference table. Nothing reads it but the codex. */
  wLeagueCd: 6,
  /** Seconds off W when a blue card is spent — this client's version of mana. */
  blueRefund: 2.2,
  blueDamage: 44,
  redDamage: 56,
  /** Red splashes. This is its radius around whatever the attack landed on. */
  redSplash: 260,
  redSlow: 0.45,
  redSlowFor: 2.5,
  goldDamage: 48,
  goldStun: 1.5,

  /** E — Stacked Deck. Every fourth attack, and it is worth having. */
  deckEvery: 4,
  deckDamage: 88,

  /**
   * R — Destiny, and the Gate that follows it.
   *
   * League's is a two-part ultimate on a cooldown measured in minutes: reveal
   * the map, then choose somewhere on it and take a second and a half to
   * arrive. The reveal is a macro tool and a sixty-second rep cannot teach one.
   * The *gate* is not — it is a choice of a place and a channel you have to
   * survive, and that is a mechanic, so this client charges it at a cooldown a
   * rep can actually contain and leaves the rest of it League's.
   */
  rChannel: 1.5,
  rRevealFor: 6,
  /** Seconds after the reveal in which the gate may still be taken. */
  rGateArmed: 8,
  rGateRange: 2200,
  rGateChannel: 1.5,
  rCd: 22,
  /**
   * Damage inside one channel that breaks it.
   *
   * League breaks this with crowd control rather than damage, and nothing in
   * this client's arena can hard-CC the player — so the honest translation is
   * a threshold rather than a trigger: a shell, a graze or one melee swing is
   * a price you pay and keep channelling, and a rotation landing on you while
   * you stand still for three seconds is the punish the real ability has. Set
   * below one artillery zone and it would not be a decision, it would be a tax
   * on pressing R at all.
   */
  rInterruptAt: 190,
} as const;

export interface TwistedLoadout {
  wildCards?: boolean;
  pickACard?: boolean;
  stackedDeck?: boolean;
  destiny?: boolean;
}

export type TwistedCastResult = 'cast' | 'refused' | 'locked' | 'noTarget';

/** What the wheel is doing right now, for the HUD and for the stages. */
export type WheelState = 'idle' | 'spinning' | 'held';

/** Everything the Twisted Fate stages score, measured by the kit itself. */
export interface TwistedStats {
  /** Times the wheel was started. */
  wSpins: number;
  /** Times a card was actually taken off it. */
  wLocks: number;
  /** Spins that ran the whole window out without a lock. */
  wExpired: number;
  /** Locks, by face. */
  locked: Record<CardColor, number>;
  /**
   * Card-slots burned across every lock.
   *
   * The wheel starts on blue, so blue costs 0 slots, red 1 and gold 2. Anything
   * above that is a revolution you did not need, and three of them is a whole
   * turn of the wheel — which, in a fight, is a second and a half of standing
   * there deciding.
   */
  slotsSpent: number;
  /** The same figure with the minimum removed: pure waste. */
  slotsWasted: number;
  /** Locks that took the card the stage asked for. */
  wRight: number;
  /** Locks that took something else. */
  wWrong: number;
  /** Summed milliseconds left in the slot at the moment of each lock. */
  edgeMsSum: number;
  /** Locks taken with under 90ms of the slot left — very nearly a miss. */
  onTheEdge: number;

  /** Cards actually spent by an attack landing. */
  cardsSpent: number;
  /** Cards spent on a minion. The classic way to throw a gold card away. */
  cardsOnMinions: number;
  /** Gold cards that landed on a champion, and the stuns they bought. */
  goldOnChampions: number;
  goldStuns: number;
  redSlows: number;
  /** Attacks that landed while a card was still sitting unspent on the hand. */
  cardsHeldThrough: number;
  /** Longest a card was carried before it was spent, in seconds. */
  longestHold: number;

  qCasts: number;
  /** Individual cards that connected — up to three per cast. */
  qCardHits: number;
  /** Casts that landed at least one card. */
  qCastsThatHit: number;
  /** Casts that landed two or more. The fan, used as a fan. */
  qMultiHits: number;
  /** Cards that connected with a champion rather than a minion. */
  qOnChampions: number;
  /** Q pressed during the attack windup — an auto thrown away for a fan. */
  qWastedWindup: number;

  /** Fourth attacks — the ones Stacked Deck pays for. */
  deckProcs: number;
  /** Fourth attacks that landed on a champion. */
  deckOnChampions: number;
  /** Fourth attacks fed to a minion. */
  deckOnMinions: number;

  rCasts: number;
  /** Destiny channels broken by damage. */
  rInterrupted: number;
  gates: number;
  /** Gates that ended outside every threat's reach. */
  gatesToSafety: number;
  /** Gates that arrived inside your own attack range of something. */
  gatesOnTarget: number;
  /** Destinies spent without ever taking the gate. */
  gatesMissed: number;

  attacksLanded: number;
}

const emptyStats = (): TwistedStats => ({
  wSpins: 0,
  wLocks: 0,
  wExpired: 0,
  locked: { blue: 0, red: 0, gold: 0 },
  slotsSpent: 0,
  slotsWasted: 0,
  wRight: 0,
  wWrong: 0,
  edgeMsSum: 0,
  onTheEdge: 0,
  cardsSpent: 0,
  cardsOnMinions: 0,
  goldOnChampions: 0,
  goldStuns: 0,
  redSlows: 0,
  cardsHeldThrough: 0,
  longestHold: 0,
  qCasts: 0,
  qCardHits: 0,
  qCastsThatHit: 0,
  qMultiHits: 0,
  qOnChampions: 0,
  qWastedWindup: 0,
  deckProcs: 0,
  deckOnChampions: 0,
  deckOnMinions: 0,
  rCasts: 0,
  rInterrupted: 0,
  gates: 0,
  gatesToSafety: 0,
  gatesOnTarget: 0,
  gatesMissed: 0,
  attacksLanded: 0,
});

/** One of the three cards in flight, and which cast threw it. */
interface TrackedCard {
  id: number;
  castNo: number;
}

/** A Wild Cards cast that has been committed to but has not left yet. */
interface PendingFan {
  dir: Vec2;
  releaseAt: number;
}

/** The ultimate, mid-sentence. */
interface DestinyState {
  /** What the channel is for. */
  kind: 'reveal' | 'gate';
  /** When it finishes. */
  endsAt: number;
  startedAt: number;
  /** Damage taken since it began. */
  damage: number;
  /** Where the gate is going, for the gate channel only. */
  to?: Vec2;
}

export class TwistedKit {
  readonly stats: TwistedStats = emptyStats();
  readonly loadout: Required<TwistedLoadout>;

  qCd = 0;
  wCd = 0;
  rCd = 0;

  /** The card on the hand, waiting for an attack. */
  held: CardColor | null = null;
  /** The card loaded into the attack currently winding up. */
  private charged: CardColor | null = null;
  /** Cards already thrown, in the order their missiles will land. */
  private flying: { card: CardColor; at: number }[] = [];
  /** When the current spin started, or null when the wheel is still. */
  private spinFrom: number | null = null;
  /** When the card now on the hand was locked, for the hold read. */
  private heldFrom = 0;

  /**
   * The card the stage is asking for, if it asks for one.
   *
   * Set by the drill, read by the kit, and the reason the kit can score a lock
   * as right or wrong at all. Null means any card counts, which is the honest
   * answer on the stages that are about the wheel rather than about gold.
   */
  want: CardColor | null = null;

  /** Attacks landed since the last Stacked Deck proc. */
  private deckCount = 0;

  /** The ultimate, if it is doing anything. */
  destiny: DestinyState | null = null;
  /** Seconds of reveal left. */
  revealFor = 0;
  /** Seconds left in which the gate may be taken. */
  gateArmed = 0;
  /** Where the last gate went, so a stage can draw it. */
  lastGate: { from: Vec2; to: Vec2; at: number } | null = null;
  /** Every Wild Cards missile in the air, and which cast threw it. */
  private cards: TrackedCard[] = [];
  private pendingFan: PendingFan | null = null;
  private castNo = 0;
  /** Cards landed per cast, so a fan can be scored as a fan. */
  private hitsPerCast = new Map<number, number>();
  private pendingDamage: { targetId: number; amount: number }[] = [];

  constructor(
    private readonly s: Session,
    loadout: TwistedLoadout = { pickACard: true },
  ) {
    this.loadout = {
      wildCards: loadout.wildCards ?? false,
      pickACard: loadout.pickACard ?? false,
      stackedDeck: loadout.stackedDeck ?? false,
      destiny: loadout.destiny ?? false,
    };
  }

  /** Spawns the player as Twisted Fate and returns him. */
  spawn(pos: Vec2): Actor {
    const p = this.s.world.spawnPlayer(pos, { ...TWISTED_STATS.attack });
    p.maxHp = TWISTED_STATS.hp;
    p.hp = TWISTED_STATS.hp;
    p.moveSpeed = TWISTED_STATS.moveSpeed;
    p.radius = TWISTED_STATS.radius;
    p.label = 'TWISTED FATE';
    // The body is the path's, not the profile's. A silhouette you picked in
    // settings, doing Pick a Card's animation, would be a smaller lie than a
    // body that does not match the bar — and it would still be one.
    p.visual = 'twistedFate';
    return p;
  }

  // ----------------------------------------------------------------- wheel

  /**
   * What the wheel is doing, in one word.
   *
   * A card loaded into an attack that has not landed yet counts as held, and
   * that is not a nicety. Cancel that attack and the card comes back — so a
   * wheel started in the gap would leave you holding two, which is a state
   * League does not have and this kit should not either. Treating the windup
   * as part of holding closes the gap at the only place it can be closed:
   * before the second card exists.
   */
  get wheel(): WheelState {
    if (this.held || this.charged) return 'held';
    return this.spinFrom === null ? 'idle' : 'spinning';
  }

  /** How many card-slots have gone by since the wheel started. */
  private slotsElapsed(): number {
    if (this.spinFrom === null) return 0;
    return Math.floor((this.s.world.time - this.spinFrom) / TWISTED_STATS.wCycle);
  }

  /** The face currently showing, or null while the wheel is still. */
  get showing(): CardColor | null {
    if (this.spinFrom === null) return null;
    return CARD_ORDER[this.slotsElapsed() % CARD_ORDER.length];
  }

  /** How far through the current slot the wheel is, 0..1. */
  get slotPhase(): number {
    if (this.spinFrom === null) return 0;
    const t = (this.s.world.time - this.spinFrom) / TWISTED_STATS.wCycle;
    return t - Math.floor(t);
  }

  /** Seconds left in the spin window before the wheel gives up. */
  get windowLeft(): number {
    if (this.spinFrom === null) return 0;
    return Math.max(0, TWISTED_STATS.wWindow - (this.s.world.time - this.spinFrom));
  }

  /**
   * The fewest slots that could ever reach a given face.
   *
   * Blue is free, red is one and gold is two, because the wheel always starts
   * on blue. It is the floor every lock is measured against, and it is what
   * makes "you took gold" and "you took gold *well*" two different facts.
   */
  static minSlotsTo(card: CardColor): number {
    return CARD_ORDER.indexOf(card);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    if (this.qCd > 0) this.qCd = Math.max(0, this.qCd - dt);
    if (this.wCd > 0) this.wCd = Math.max(0, this.wCd - dt);
    if (this.rCd > 0) this.rCd = Math.max(0, this.rCd - dt);
    if (this.revealFor > 0) this.revealFor = Math.max(0, this.revealFor - dt);
    if (this.gateArmed > 0) {
      this.gateArmed = Math.max(0, this.gateArmed - dt);
      // A destiny that was never turned into a gate is a destiny that bought
      // six seconds of looking at people. The stages that grade it say so.
      if (this.gateArmed === 0 && !this.destiny) this.stats.gatesMissed++;
    }

    // The wheel gives up on its own. In League that refunds most of the
    // cooldown; here it simply costs you the spin, which is the part worth
    // learning not to do.
    if (this.spinFrom !== null && this.windowLeft <= 0) {
      this.spinFrom = null;
      this.stats.wExpired++;
      this.s.micro('WHEEL LOST', this.s.world.player?.pos ?? { x: 0, y: 0 }, PALETTE.danger);
      this.wCd = TWISTED_STATS.wCd * 0.5;
    }

    this.stepDestiny();

    const fan = this.pendingFan;
    if (fan && this.s.world.time >= fan.releaseAt) {
      this.pendingFan = null;
      this.releaseFan(fan);
    }

    if (this.pendingDamage.length) {
      const player = this.s.world.player;
      for (const hit of this.pendingDamage) {
        const t = this.s.world.byId(hit.targetId);
        if (t && t.alive) this.s.world.damage(t, hit.amount, player);
      }
      this.pendingDamage.length = 0;
    }

    // Cards that are gone and never reported a hit simply missed.
    for (let i = this.cards.length - 1; i >= 0; i--) {
      if (this.s.world.projectiles.some((p) => p.id === this.cards[i].id)) continue;
      this.cards.splice(i, 1);
    }

    // A card thrown at somebody who died mid-flight never arrives. Expiring it
    // here keeps the ledger honest rather than crediting it to the next attack.
    const now = this.s.world.time;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      if (now - this.flying[i].at > 3) this.flying.splice(i, 1);
    }

    if (this.held) {
      this.stats.longestHold = Math.max(this.stats.longestHold, now - this.heldFrom);
    }
  }

  /** The ultimate's two channels, both of which can be taken off you. */
  private stepDestiny(): void {
    const d = this.destiny;
    if (!d) return;
    const p = this.s.world.player;
    if (!p || !p.alive) {
      this.destiny = null;
      return;
    }
    // Channelling roots. It is re-applied every frame rather than set once,
    // because anything else in the kit is free to root you for longer and the
    // longer root has to win.
    p.rootedFor = Math.max(p.rootedFor, Math.min(0.12, d.endsAt - this.s.world.time));

    if (d.damage >= TWISTED_STATS.rInterruptAt) {
      this.destiny = null;
      this.stats.rInterrupted++;
      this.gateArmed = 0;
      this.s.micro('CHANNEL BROKEN', p.pos, PALETTE.danger);
      this.s.fx.badFlash(0.22, PALETTE.danger);
      audio.play('castRefuse', { pan: this.s.panOf(p.pos) });
      return;
    }
    if (this.s.world.time < d.endsAt) return;

    this.destiny = null;
    if (d.kind === 'reveal') {
      this.revealFor = TWISTED_STATS.rRevealFor;
      this.gateArmed = TWISTED_STATS.rGateArmed;
      this.s.fx.ring(p.pos.x, p.pos.y, 20, 620, 0.7, TF_DESTINY, 4, 'shock');
      this.s.micro('DESTINY', p.pos, TF_DESTINY);
      audio.play('castR', { pan: this.s.panOf(p.pos) });
    } else if (d.to) {
      this.arrive(p, d.to);
    }
  }

  /** The gate opening, and what the landing was worth. */
  private arrive(p: Actor, to: Vec2): void {
    const from = { ...p.pos };
    const landing = this.s.world.clearOfTerrain(to, p.radius);
    p.pos.x = landing.x;
    p.pos.y = landing.y;
    p.prev.x = landing.x;
    p.prev.y = landing.y;
    this.stats.gates++;
    this.gateArmed = 0;

    // Where it put you, in the two terms that decide whether a gate was worth
    // taking: nothing can reach you, and you can reach something. A gate that
    // only satisfies the first is a retreat, which is a fine thing to do and a
    // poor thing to spend an ultimate on.
    const threat = this.nearestHostile(landing);
    if (threat) {
      const gap = dist(landing, threat.pos);
      if (gap > threat.attack.range + p.radius) this.stats.gatesToSafety++;
      if (gap <= p.attack.range + threat.radius) this.stats.gatesOnTarget++;
    }

    this.lastGate = { from, to: { ...landing }, at: this.s.world.time };
    this.s.fx.ring(from.x, from.y, 8, 150, 0.5, TF_DESTINY, 4, 'shock');
    this.s.fx.ring(landing.x, landing.y, 8, 150, 0.5, TF_DESTINY, 4, 'pulse');
    this.s.fx.trace([from, { ...landing }], TF_DESTINY, 0.5, 5);
    this.s.fx.burst(landing.x, landing.y, 16, { color: TF_DESTINY, speed: 260, life: 0.4, size: 2.4 });
    this.s.micro('GATE', landing, TF_DESTINY);
    audio.play('gateEnter', { pan: this.s.panOf(landing) });
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    for (const e of events) {
      // Anything landing on the player while he is channelling is a vote to
      // stop him, and enough of them carry it.
      if (this.destiny && e.type === 'damage' && e.targetId === pid) {
        this.destiny.damage += e.amount ?? 0;
      }

      if (e.actorId !== pid) continue;
      switch (e.type) {
        case 'attackStart':
          // The card is loaded into the shot here rather than when it lands, so
          // a second attack started before the first arrives cannot also carry
          // it. Cancel the windup and it comes straight back to the hand.
          if (this.held) {
            this.charged = this.held;
            this.held = null;
          }
          break;
        case 'attackCancel':
          if (this.charged) {
            this.returned(this.charged);
            this.charged = null;
          }
          break;
        case 'attackRelease': {
          if (!this.charged) break;
          const target = this.s.world.byId(e.targetId);
          // No missile leaves if the target is already gone, so neither does
          // the card. League keeps it too.
          if (!target || !target.alive) {
            this.returned(this.charged);
            this.charged = null;
          } else {
            this.flying.push({ card: this.charged, at: this.s.world.time });
            this.charged = null;
          }
          break;
        }
        case 'attackLand': {
          const card = e.meta !== undefined ? this.cards.find((c) => c.id === e.meta) : undefined;
          if (card) this.onCardLanded(card, e);
          else this.onAutoLanded(e);
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * A card coming back to the hand, from a cancelled windup or a target that
   * died before the missile left.
   *
   * The belt to the brace above: nothing *should* be able to start a wheel in
   * that gap any more, but if anything ever does, the card that comes back
   * wins and the spin is torn up with its cooldown refunded — because the one
   * state this kit must never reach is two cards at once, and a wheel nobody
   * can lock is a wheel that reads as broken for six seconds.
   */
  private returned(card: CardColor): void {
    this.held = card;
    this.heldFrom = this.s.world.time;
    if (this.spinFrom !== null) {
      this.spinFrom = null;
      this.wCd = 0;
    }
  }

  // ------------------------------------------------------------- the attack

  private onAutoLanded(e: WorldEvent): void {
    const target = this.s.world.byId(e.targetId);
    this.stats.attacksLanded++;
    if (this.held) this.stats.cardsHeldThrough++;

    // Stacked Deck counts every attack, card or no card, exactly as in League.
    this.deckCount++;
    if (this.loadout.stackedDeck && this.deckCount >= TWISTED_STATS.deckEvery) {
      this.deckCount = 0;
      this.stats.deckProcs++;
      if (target) {
        if (target.isMinion) this.stats.deckOnMinions++;
        else this.stats.deckOnChampions++;
        this.pendingDamage.push({ targetId: target.id, amount: TWISTED_STATS.deckDamage });
        this.s.fx.ring(target.pos.x, target.pos.y, 6, 74, 0.34, TF_GOLD, 3, 'shock');
        this.s.micro('STACKED DECK', target.pos, TF_GOLD);
        audio.play('perfect', { pan: this.s.panOf(target.pos) });
      }
    }

    const spent = this.flying.shift();
    if (!spent || !target) return;
    this.spend(spent.card, target);
  }

  /** What a card does when the attack carrying it arrives. */
  private spend(card: CardColor, target: Actor): void {
    this.stats.cardsSpent++;
    if (target.isMinion) this.stats.cardsOnMinions++;
    const colour = CARD_COLOR[card];

    switch (card) {
      case 'blue':
        this.pendingDamage.push({ targetId: target.id, amount: TWISTED_STATS.blueDamage });
        // The mana back, in the only currency this client has: the wheel comes
        // round sooner. A blue card is not nothing — it is simply the one you
        // take when nothing better is on offer.
        this.wCd = Math.max(0, this.wCd - TWISTED_STATS.blueRefund);
        break;
      case 'red': {
        this.pendingDamage.push({ targetId: target.id, amount: TWISTED_STATS.redDamage });
        let caught = 0;
        for (const a of this.s.world.actors) {
          if (!a.alive || a.team === 'player') continue;
          if (dist(a.pos, target.pos) > TWISTED_STATS.redSplash) continue;
          if (a.id !== target.id) {
            this.pendingDamage.push({ targetId: a.id, amount: Math.round(TWISTED_STATS.redDamage * 0.6) });
          }
          a.slowFactor = Math.min(a.slowFactor, 1 - TWISTED_STATS.redSlow);
          a.slowFor = Math.max(a.slowFor, TWISTED_STATS.redSlowFor);
          caught++;
        }
        if (caught > 0) this.stats.redSlows++;
        this.s.fx.ring(target.pos.x, target.pos.y, 10, TWISTED_STATS.redSplash, 0.45, TF_RED, 4, 'shock');
        break;
      }
      case 'gold': {
        this.pendingDamage.push({ targetId: target.id, amount: TWISTED_STATS.goldDamage });
        target.rootedFor = Math.max(target.rootedFor, TWISTED_STATS.goldStun);
        // A stun is not a root. Whatever it was about to do is gone too.
        if (target.phase === 'windup') {
          target.phase = 'idle';
          target.phaseTime = 0;
          this.s.world.emit({ type: 'attackCancel', actorId: target.id, amount: 0 });
        }
        this.stats.goldStuns++;
        if (!target.isMinion) this.stats.goldOnChampions++;
        this.s.fx.ring(target.pos.x, target.pos.y, 6, 120, 0.5, TF_GOLD, 4, 'shock');
        this.s.fx.addShake(0.3);
        break;
      }
    }

    this.s.micro(CARD_NAME[card], target.pos, colour);
    audio.play(card === 'gold' ? 'perfect' : 'castW', { pan: this.s.panOf(target.pos) });
  }

  // ------------------------------------------------------------- wild cards

  private onCardLanded(card: TrackedCard, e: WorldEvent): void {
    const target = this.s.world.byId(e.targetId);
    this.stats.qCardHits++;
    const before = this.hitsPerCast.get(card.castNo) ?? 0;
    this.hitsPerCast.set(card.castNo, before + 1);
    if (before === 0) this.stats.qCastsThatHit++;
    if (before === 1) this.stats.qMultiHits++;
    if (target && !target.isMinion) this.stats.qOnChampions++;
    if (before >= 1) this.s.micro('THROUGH', e.pos ?? target?.pos ?? { x: 0, y: 0 }, TF_GOLD);
  }

  // ------------------------------------------------------------------ casts

  cast(slot: AbilitySlot, at: Vec2): TwistedCastResult {
    switch (slot) {
      case 'q':
        return this.wildCards(at);
      case 'w':
        return this.pickACard();
      case 'r':
        return this.ultimate(at);
      default:
        return 'locked';
    }
  }

  /**
   * Q — Wild Cards.
   *
   * One press, three missiles, and they pierce. Aimed at a body it is a worse
   * Mystic Shot; aimed *along* a line of bodies it is the widest wave clear in
   * the game. The stage that teaches it is about nothing else.
   */
  private wildCards(at: Vec2): TwistedCastResult {
    if (!this.loadout.wildCards) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.destiny) return 'refused';
    if (this.pendingFan) return 'refused';
    if (this.qCd > 0) return 'refused';

    const dir = norm(at.x - p.pos.x, at.y - p.pos.y);
    if (dir.x === 0 && dir.y === 0) return 'refused';

    this.stats.qCasts++;
    this.qCd = TWISTED_STATS.qCd;
    if (p.phase === 'windup') {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.stats.qWastedWindup++;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
      this.s.micro('CANCELLED THE AUTO', p.pos, PALETTE.danger);
    }
    p.rootedFor = Math.max(p.rootedFor, TWISTED_STATS.qCast);
    p.facing = Math.atan2(dir.y, dir.x);
    this.pendingFan = { dir, releaseAt: this.s.world.time + TWISTED_STATS.qCast };
    audio.play('castQ', { pan: this.s.panOf(p.pos) });
    return 'cast';
  }

  private releaseFan(fan: PendingFan): void {
    const p = this.s.world.player;
    if (!p || !p.alive) return;
    const base = Math.atan2(fan.dir.y, fan.dir.x);
    const no = ++this.castNo;
    for (const off of [-TWISTED_STATS.qFan, 0, TWISTED_STATS.qFan]) {
      const a = base + off;
      const d = { x: Math.cos(a), y: Math.sin(a) };
      const shot = this.s.world.spawnProjectile({
        pos: { x: p.pos.x + d.x * p.radius, y: p.pos.y + d.y * p.radius },
        team: 'player',
        ownerId: p.id,
        vel: { x: d.x * TWISTED_STATS.qSpeed, y: d.y * TWISTED_STATS.qSpeed },
        speed: TWISTED_STATS.qSpeed,
        damage: TWISTED_STATS.qDamage,
        radius: TWISTED_STATS.qRadius,
        shape: 'shard',
        color: TF_GOLD,
        pierce: true,
        maxLife: TWISTED_STATS.qRange / TWISTED_STATS.qSpeed,
      });
      this.cards.push({ id: shot.id, castNo: no });
    }
    this.s.fx.ring(p.pos.x, p.pos.y, p.radius, p.radius + 44, 0.22, TF_GOLD, 2, 'pulse');
  }

  /**
   * W — Pick a Card.
   *
   * The first press starts the wheel. The second takes whatever is showing —
   * *whatever is showing*, not whatever you meant, which is the entire lesson
   * and the reason this is the only ability in the client whose score is a
   * measure of how many chances you let go past.
   */
  private pickACard(): TwistedCastResult {
    if (!this.loadout.pickACard) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';

    if (this.spinFrom === null) {
      if (this.held || this.charged) return 'refused';
      if (this.wCd > 0) return 'refused';
      this.spinFrom = this.s.world.time;
      this.stats.wSpins++;
      audio.play('castArm', { pan: this.s.panOf(p.pos) });
      return 'cast';
    }

    const face = this.showing;
    if (!face) return 'refused';
    const slots = this.slotsElapsed();
    const edgeMs = (1 - this.slotPhase) * TWISTED_STATS.wCycle * 1000;

    this.held = face;
    this.heldFrom = this.s.world.time;
    this.spinFrom = null;
    this.wCd = TWISTED_STATS.wCd;
    this.stats.wLocks++;
    this.stats.locked[face]++;
    this.stats.slotsSpent += slots;
    this.stats.slotsWasted += Math.max(0, slots - TwistedKit.minSlotsTo(face));
    this.stats.edgeMsSum += edgeMs;
    if (edgeMs < 90) this.stats.onTheEdge++;
    if (this.want) {
      if (face === this.want) this.stats.wRight++;
      else this.stats.wWrong++;
    }

    this.s.micro(CARD_NAME[face], p.pos, CARD_COLOR[face]);
    this.s.fx.ring(p.pos.x, p.pos.y, p.radius, p.radius + 54, 0.3, CARD_COLOR[face], 3, 'pulse');
    audio.play(this.want && face === this.want ? 'perfect' : 'castW', { pan: this.s.panOf(p.pos) });
    return 'cast';
  }

  /**
   * R — Destiny, then the Gate.
   *
   * The first press is a second and a half of standing still for a look at the
   * map. The second is a second and a half of standing still for a place on it.
   * Both can be taken off you, which is what makes *when* the interesting half
   * of an ability whose *where* looks like the whole question.
   */
  private ultimate(at: Vec2): TwistedCastResult {
    if (!this.loadout.destiny) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.destiny) return 'refused';

    if (this.gateArmed > 0) {
      const d = norm(at.x - p.pos.x, at.y - p.pos.y);
      const want = dist(p.pos, at);
      const reach = Math.min(want, TWISTED_STATS.rGateRange);
      const to = want < 1 ? { ...p.pos } : { x: p.pos.x + d.x * reach, y: p.pos.y + d.y * reach };
      this.destiny = {
        kind: 'gate',
        startedAt: this.s.world.time,
        endsAt: this.s.world.time + TWISTED_STATS.rGateChannel,
        damage: 0,
        to,
      };
      if (p.phase === 'windup') {
        p.phase = 'idle';
        p.phaseTime = 0;
        this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
      }
      audio.play('castR', { pan: this.s.panOf(p.pos) });
      return 'cast';
    }

    if (this.rCd > 0) return 'refused';
    this.rCd = TWISTED_STATS.rCd;
    this.stats.rCasts++;
    this.destiny = {
      kind: 'reveal',
      startedAt: this.s.world.time,
      endsAt: this.s.world.time + TWISTED_STATS.rChannel,
      damage: 0,
    };
    if (p.phase === 'windup') {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
    }
    audio.play('castArm', { pan: this.s.panOf(p.pos) });
    return 'cast';
  }

  /** The closest living hostile to a point, minions included. */
  private nearestHostile(at: Vec2): Actor | null {
    let best: Actor | null = null;
    let bd = Infinity;
    for (const a of this.s.world.actors) {
      if (!a.alive || a.team === 'player') continue;
      const d = dist(at, a.pos);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------- ui

  bar(base: AbilityView[]): AbilityView[] {
    return base.map((a) => {
      switch (a.slot) {
        case 'q':
          return this.loadout.wildCards
            ? { ...a, name: 'WILD CARDS', locked: false, cd: clamp(this.qCd / TWISTED_STATS.qCd, 0, 1) }
            : a;
        case 'w': {
          if (!this.loadout.pickACard) return a;
          // The bar is the wheel. While it turns, the slot carries the face
          // rather than the ability's name, because the name is not the thing
          // you are looking at — the card is.
          const face = this.showing;
          const card = this.held ?? this.charged;
          // The *held* card is named here; the spinning one deliberately is
          // not. The bar is drawn from a HUD snapshot and the wheel turns twice
          // a second, so a bar tracking the face is a bar that says GOLD while
          // the floor says BLUE — the client contradicting itself about the one
          // fact the whole champion turns on. The dial under his feet is the
          // live read-out; this slot says what you are holding, and otherwise
          // says what the button does.
          const name = card ? CARD_NAME[card] : 'PICK A CARD';
          // The cooldown reported is the real one, always — including while
          // the wheel is turning, when it is zero because nothing has been
          // spent yet. The client reads *a slot whose cooldown went up* as
          // "that cast happened", which is what gives a cast its pose, its
          // sound and its ring; reporting zero through the lock would mean the
          // one press on this champion that actually costs something is also
          // the one press that gets no feedback at all.
          return {
            ...a,
            name,
            locked: false,
            highlight: card !== null || face !== null,
            cd: clamp(this.wCd / TWISTED_STATS.wCd, 0, 1),
          };
        }
        case 'e':
          return this.loadout.stackedDeck
            ? {
                ...a,
                name: `STACKED DECK ${this.deckCount}/${TWISTED_STATS.deckEvery}`,
                locked: false,
                highlight: this.deckCount === TWISTED_STATS.deckEvery - 1,
                cd: 0,
              }
            : a;
        case 'r':
          return this.loadout.destiny
            ? {
                ...a,
                name: this.gateArmed > 0 ? 'GATE' : 'DESTINY',
                locked: false,
                highlight: this.gateArmed > 0,
                cd: this.gateArmed > 0 ? 0 : clamp(this.rCd / TWISTED_STATS.rCd, 0, 1),
              }
            : a;
        default:
          return a;
      }
    });
  }

  /** True while a cast or a channel has the body pinned. */
  get casting(): boolean {
    return this.pendingFan !== null || this.destiny !== null;
  }

  /** How far through the current channel, 0..1, or null when there is none. */
  get channelProgress(): number | null {
    const d = this.destiny;
    if (!d) return null;
    const total = d.endsAt - d.startedAt;
    return total <= 0 ? 1 : clamp((this.s.world.time - d.startedAt) / total, 0, 1);
  }

  /**
   * Was that missile one of ours?
   *
   * A stage that scores a combo has to tell a fan landing apart from an attack
   * landing, and both arrive as the same event with the same shape. The kit is
   * the only thing that knows which ids it threw, so it is the thing that
   * answers — rather than every stage keeping a second, drifting copy of the
   * same list.
   */
  wasWildCard(projectileId: number): boolean {
    return this.cards.some((c) => c.id === projectileId);
  }

  /** Stacked Deck's counter, for a stage that wants to draw it. */
  get deckStacks(): number {
    return this.deckCount;
  }

  /**
   * The share of locks that took the card that was asked for.
   *
   * Only meaningful on a stage that asks, which is most of them — the ones
   * that do not set `want` score the wheel on slots instead.
   */
  get lockAccuracy(): number {
    const asked = this.stats.wRight + this.stats.wWrong;
    return asked > 0 ? clamp(this.stats.wRight / asked, 0, 1) : 0;
  }

  /**
   * The number the path is really about: average card-slots wasted per lock.
   *
   * Zero means every card was taken the first time it came round. Three means
   * you let a whole revolution of the wheel go by, every single time, which in
   * a fight is a second and a half of being a stationary target.
   */
  get wastedPerLock(): number {
    return this.stats.wLocks > 0 ? this.stats.slotsWasted / this.stats.wLocks : 0;
  }

  /** Cards per Wild Cards cast that actually connected, 0..3. */
  get cardsPerCast(): number {
    return this.stats.qCasts > 0 ? this.stats.qCardHits / this.stats.qCasts : 0;
  }
}
