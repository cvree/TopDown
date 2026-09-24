/**
 * The Sinister Blade's kit.
 *
 * The client teaches three halves of a champion with three champions. Vayne is
 * *rhythm* — when in the attack cycle a button belongs. Ezreal is *aim while
 * moving*. Twisted Fate is *choosing under a clock*. Katarina is the fourth
 * thing, and it is the one none of them can touch: **being somewhere in the
 * future.**
 *
 * Every other ability in this client pays out where it is pressed. Hers pay out
 * *later*, somewhere else: a dagger thrown now lands behind the thing it hit a
 * second from now, a dagger dropped at your feet is on the floor a second and a
 * quarter from now, and neither is worth anything at all unless you are
 * standing on it — with somebody inside the slash — when it gets there. The
 * whole champion is a route drawn through places that do not exist yet.
 *
 * So the kit is built around four facts, each of which a stage of the path is
 * about:
 *
 *  - **A dagger is an appointment, not an item.** It lands on its own clock and
 *    it lies there for four seconds. Picking it up is the damage, the reset on
 *    Shunpo, and the reason she has a combo at all — which is why the number
 *    this kit leads with is **daggers taken**, not damage dealt. A Katarina who
 *    throws six and takes one has been playing a worse champion than the one on
 *    the bar.
 *  - **Bouncing Blade lands behind what it hit.** Along the line you threw it,
 *    a fixed distance past the first body. Aimed at the champion it lands where
 *    they are running to; aimed at the minion *in front of* the champion it
 *    lands on them. One stage is entirely about that difference.
 *  - **Shunpo goes to anything.** A dagger, a minion, a champion — and landing
 *    on a dagger takes it, which takes most of Shunpo's own cooldown back. The
 *    blink is cheap exactly when the route was planned.
 *  - **A kill is a cooldown.** A champion who dies within three seconds of her
 *    touching them hands every basic ability back. The fight is not won by the
 *    first target, it is won by arriving at the second one with the kit up.
 *
 * And Death Lotus, which is a channel you lose by moving — the one ability in
 * the client whose punishment is your own hands doing what they always do.
 *
 * As with the other kits, this one owns its state and knows nothing about
 * drills, so every Katarina stage shares one implementation of her.
 */
import { audio } from './audio';
import type { AbilitySlot } from './input';
import { clamp, dist, norm } from './math';
import { PALETTE } from './palette';
import type { AbilityView, Session } from './session';
import type { Actor, Vec2 } from './types';
import type { WorldEvent } from './world';

/** Her own red, the steel of a dagger, and the lotus. */
export const KAT_RED = '#ff4057';
export const KAT_STEEL = '#dfe8f5';
export const KAT_LOTUS = '#ff6f9c';

export const KATARINA_STATS = {
  hp: 672,
  moveSpeed: 335,
  radius: 26,
  attack: {
    // Melee, and the only champion path in the client that is. A hundred and
    // twenty-five units is League's, and it is the reason the kit exists: she
    // has to *arrive* before any of the rest of it is worth anything.
    attackSpeed: 0.658,
    windupRatio: 0.21,
    backswingRatio: 0.3,
    range: 125,
    damage: 62,
    projectileSpeed: 0,
  },

  /** Q — Bouncing Blade. One target, three more bounces, then the floor. */
  qRange: 625,
  qSpeed: 1500,
  qDamage: 75,
  /** Bounces after the first body, each to the nearest one not yet hit. */
  qBounces: 3,
  qBounceRange: 450,
  /** How far past the first body, along the throw, the dagger comes down. */
  qLandBehind: 350,
  /** Seconds from the first impact to the dagger being on the floor. */
  qLandAfter: 0.9,
  /**
   * League's, maxed — and Bouncing Blade is the one every Katarina maxes
   * first, so seven is the number the champion is actually played on.
   */
  qCd: 7,
  /** Rank one, for the reference table. Nothing reads it but the codex. */
  qLeagueCd: 11,

  /** W — Preparation. A dagger in the air above her, and a burst of pace. */
  wDaggerAfter: 1.25,
  /** Bonus speed at the moment of the cast, decaying to nothing. */
  wHaste: 0.5,
  wHasteFor: 1.25,
  /** League's maxed. Preparation is levelled last, and it shows. */
  wCd: 11,
  wLeagueCd: 15,

  /** E — Shunpo. To a dagger, a minion or a champion, instantly. */
  eRange: 725,
  eDamage: 55,
  /** How far from the cursor a cast will look for something to land on. */
  eSnap: 190,
  /** On a dagger or a friendly body she strikes the nearest enemy this close. */
  eStrikeRange: 200,
  /**
   * League's, at rank three — mid-game, which is where Shunpo is doing the
   * work this path is about. It is rarely *this* number that matters: a dagger
   * taken is most of it back, so the real cooldown is the route.
   */
  eCd: 10,
  eLeagueCd: 14,

  /** Voracity and Sinister Steel: the passive, which is most of the champion. */
  daggerLife: 4,
  /** Walk within this of a landed dagger and it is yours. */
  pickupRadius: 150,
  /** The slash around her when she takes one. League's radius. */
  slashRadius: 340,
  slashDamage: 105,
  /**
   * Share of Shunpo's remaining cooldown a dagger takes away. League's is 78%
   * at level one rising to 96% at sixteen; this is the level-six figure, the
   * one her first fights are played on.
   */
  pickupRefund: 0.84,
  /** A champion dying within this long of her touching them is a takedown. */
  voracityWindow: 3,
  /** Seconds off every basic ability on a takedown. Enough to be all of it. */
  voracityRefund: 15,

  /** R — Death Lotus. */
  rChannel: 2.5,
  /** One dagger per champion per tick. League's fifteen over two and a half. */
  rTick: 1 / 6,
  rRange: 550,
  rTargets: 3,
  rDamage: 26,
  /**
   * The grace a channel gives a held key before it counts as a move.
   *
   * Under WASD the hands are nearly always holding a direction, and League's
   * lotus is cancelled by a command rather than by a key being down — so the
   * honest translation is a beat in which to let go, and then the same rule.
   */
  rMoveGrace: 0.15,
  /**
   * League charges this in minutes. A rep has to contain more than one, and
   * the thing worth rehearsing is the channel itself — so it comes back in a
   * third of a minute and everything else about it is League's.
   */
  rCd: 20,
  rLeagueCd: 90,
} as const;

export interface KatarinaLoadout {
  bouncingBlade?: boolean;
  preparation?: boolean;
  shunpo?: boolean;
  deathLotus?: boolean;
}

export type KatarinaCastResult = 'cast' | 'refused' | 'locked' | 'noTarget';

/** Where a dagger came from. `floor` is one the stage put there itself. */
export type DaggerSource = 'q' | 'w' | 'floor';

export interface Dagger {
  id: number;
  source: DaggerSource;
  pos: Vec2;
  /** World time it was thrown, and when it lands. Equal for a floor dagger. */
  thrownAt: number;
  landsAt: number;
  expiresAt: number;
  /** Set the frame it reaches the floor, so a landing is counted once. */
  down: boolean;
}

/** Everything the Katarina stages score, measured by the kit itself. */
export interface KatarinaStats {
  /** Daggers put into the world, by any means. */
  daggersThrown: number;
  /** Daggers that reached the floor. */
  daggersLanded: number;
  /** Daggers taken. The number the path leads with. */
  daggersTaken: number;
  /** Daggers that lay on the floor for their whole life and were never taken. */
  daggersExpired: number;
  /** Takes, by where the dagger came from. */
  takenBy: Record<DaggerSource, number>;
  /** Takes that arrived by Shunpo rather than on foot. */
  takenByShunpo: number;
  /** Summed seconds between a dagger landing and it being taken. */
  takeDelaySum: number;
  /** Takes whose slash reached a champion. */
  slashOnChampions: number;
  /** Bodies caught in slashes, minions included. */
  slashHits: number;

  qCasts: number;
  /** Bodies the blade touched, first throw and every bounce. */
  qHits: number;
  qOnChampions: number;

  wCasts: number;

  eCasts: number;
  eToDagger: number;
  eToEnemy: number;
  eToChampion: number;
  /** Shunpos cast while the cooldown was a dagger's refund rather than its own. */
  eOffRefund: number;

  /** Champions who died within the window: Voracity paid out. */
  resets: number;
  takedowns: number;

  rCasts: number;
  /** Lotuses that ran the whole channel. */
  rCompleted: number;
  /** Lotuses thrown away by walking. The one this path is teaching you not to do. */
  rMoved: number;
  /** Lotuses left by Shunpo, deliberately. */
  rShunpoOut: number;
  rTicks: number;
  /** Daggers the lotus landed, across every tick. */
  rHits: number;

  attacksLanded: number;
}

const emptyStats = (): KatarinaStats => ({
  daggersThrown: 0,
  daggersLanded: 0,
  daggersTaken: 0,
  daggersExpired: 0,
  takenBy: { q: 0, w: 0, floor: 0 },
  takenByShunpo: 0,
  takeDelaySum: 0,
  slashOnChampions: 0,
  slashHits: 0,
  qCasts: 0,
  qHits: 0,
  qOnChampions: 0,
  wCasts: 0,
  eCasts: 0,
  eToDagger: 0,
  eToEnemy: 0,
  eToChampion: 0,
  eOffRefund: 0,
  resets: 0,
  takedowns: 0,
  rCasts: 0,
  rCompleted: 0,
  rMoved: 0,
  rShunpoOut: 0,
  rTicks: 0,
  rHits: 0,
  attacksLanded: 0,
});

/** One Bouncing Blade, mid-air, and what it has touched so far. */
interface Blade {
  projectileId: number;
  hit: Set<number>;
  bouncesLeft: number;
  /** Where she threw it from, which is what decides where it comes down. */
  from: Vec2;
  /** True once the first body has been hit and the dagger is on its way down. */
  dropped: boolean;
}

/** The ultimate, mid-spin. */
interface LotusState {
  startedAt: number;
  endsAt: number;
  nextTick: number;
}

/** What a take was, for a stage that wants to grade the one that just happened. */
export interface Take {
  dagger: Dagger;
  at: number;
  /** Seconds it lay on the floor first. */
  delay: number;
  byShunpo: boolean;
  /** How many champions the slash reached. */
  champions: number;
}

export class KatarinaKit {
  readonly stats: KatarinaStats = emptyStats();
  readonly loadout: Required<KatarinaLoadout>;

  qCd = 0;
  wCd = 0;
  eCd = 0;
  rCd = 0;

  /** Every dagger in the world, in the air or on the floor. */
  readonly daggers: Dagger[] = [];
  /** The most recent take, for the stage that grades takes as they happen. */
  lastTake: Take | null = null;
  /** Where the last Shunpo went, so a stage can draw it and grade it. */
  lastShunpo: { from: Vec2; to: Vec2; at: number; targetId: number | null; daggerId: number | null } | null = null;
  /** The ultimate, if it is spinning. */
  lotus: LotusState | null = null;

  private nextDaggerId = 1;
  private blades: Blade[] = [];
  /** When she last touched each enemy champion, for Voracity. */
  private touched = new Map<number, number>();
  /** Preparation's burst of pace, counting down. */
  private hasteFor = 0;
  /** Set when the next Shunpo's cooldown is a dagger's refund. */
  private refunded = false;
  private pendingDamage: { targetId: number; amount: number }[] = [];

  /**
   * Cooldowns a stage has shortened, by slot.
   *
   * The same contract Condemn's practice share has: a stage about one ability
   * has to contain enough attempts at it to be a rep, so it may bring that one
   * cooldown down. Everything else about the ability is untouched, and the
   * codex prints both figures.
   */
  private readonly practice: Partial<Record<'q' | 'w' | 'e' | 'r', number>>;

  constructor(
    private readonly s: Session,
    loadout: KatarinaLoadout = { preparation: true },
    practice: Partial<Record<'q' | 'w' | 'e' | 'r', number>> = {},
  ) {
    this.practice = practice;
    this.loadout = {
      bouncingBlade: loadout.bouncingBlade ?? false,
      preparation: loadout.preparation ?? false,
      shunpo: loadout.shunpo ?? false,
      deathLotus: loadout.deathLotus ?? false,
    };
  }

  /** Spawns the player as Katarina and returns her. */
  spawn(pos: Vec2): Actor {
    const p = this.s.world.spawnPlayer(pos, { ...KATARINA_STATS.attack });
    p.maxHp = KATARINA_STATS.hp;
    p.hp = KATARINA_STATS.hp;
    p.moveSpeed = KATARINA_STATS.moveSpeed;
    p.radius = KATARINA_STATS.radius;
    p.label = 'KATARINA';
    // The body is the path's, not the profile's — a longbow doing Shunpo would
    // be a smaller lie than a body that does not match the bar, and still one.
    p.visual = 'katarina';
    return p;
  }

  /** The cooldown a slot is charged at on this stage. */
  cdOf(slot: 'q' | 'w' | 'e' | 'r'): number {
    const base = { q: KATARINA_STATS.qCd, w: KATARINA_STATS.wCd, e: KATARINA_STATS.eCd, r: KATARINA_STATS.rCd }[slot];
    return this.practice[slot] ?? base;
  }

  // ---------------------------------------------------------------- daggers

  /**
   * Put a dagger in the world.
   *
   * Public because a stage may want daggers of its own on the floor — the
   * Shunpo stage is a route between daggers nobody threw — and a dagger is a
   * dagger whoever put it there: it lands, it lies, it is taken or it is not.
   */
  dropDagger(pos: Vec2, landsIn: number, source: DaggerSource): Dagger {
    const now = this.s.world.time;
    const at = this.s.world.clearOfTerrain(pos, 12);
    const d: Dagger = {
      id: this.nextDaggerId++,
      source,
      pos: at,
      thrownAt: now,
      landsAt: now + Math.max(0, landsIn),
      expiresAt: now + Math.max(0, landsIn) + KATARINA_STATS.daggerLife,
      down: landsIn <= 0,
    };
    this.daggers.push(d);
    this.stats.daggersThrown++;
    if (landsIn <= 0) this.stats.daggersLanded++;
    return d;
  }

  /** True once a dagger is on the floor and can be taken. */
  landed(d: Dagger): boolean {
    return this.s.world.time >= d.landsAt;
  }

  /** The landed dagger nearest a point, within `range` of it, if any. */
  daggerNear(at: Vec2, range: number): Dagger | null {
    let best: Dagger | null = null;
    let bd = range;
    for (const d of this.daggers) {
      if (!this.landed(d)) continue;
      const g = dist(d.pos, at);
      if (g <= bd) {
        bd = g;
        best = d;
      }
    }
    return best;
  }

  /**
   * Take a dagger: the slash, the refund, and the ledger.
   *
   * The slash is centred on her rather than on the dagger, exactly as in
   * League, which is why the route matters — she can take it from the edge of
   * the pickup radius, and the edge she takes it from decides who is inside.
   */
  private take(d: Dagger, byShunpo: boolean): void {
    const p = this.s.world.player;
    if (!p) return;
    const now = this.s.world.time;
    this.daggers.splice(this.daggers.indexOf(d), 1);

    let champions = 0;
    let hits = 0;
    for (const a of this.s.world.actors) {
      if (!a.alive || a.team === 'player') continue;
      if (dist(a.pos, p.pos) > KATARINA_STATS.slashRadius + a.radius) continue;
      this.pendingDamage.push({ targetId: a.id, amount: KATARINA_STATS.slashDamage });
      hits++;
      if (!a.isMinion) {
        champions++;
        this.touched.set(a.id, now);
      }
    }

    // Sinister Steel's refund. Most of Shunpo, gone — which is the reason a
    // planned route is cheap and an unplanned one is not.
    if (this.loadout.shunpo && this.eCd > 0) {
      this.eCd *= 1 - KATARINA_STATS.pickupRefund;
      this.refunded = true;
    }

    const delay = Math.max(0, now - d.landsAt);
    this.stats.daggersTaken++;
    this.stats.takenBy[d.source]++;
    if (byShunpo) this.stats.takenByShunpo++;
    this.stats.takeDelaySum += delay;
    this.stats.slashHits += hits;
    if (champions > 0) this.stats.slashOnChampions++;
    this.lastTake = { dagger: d, at: now, delay, byShunpo, champions };

    this.s.fx.ring(p.pos.x, p.pos.y, 12, KATARINA_STATS.slashRadius, 0.36, KAT_RED, 4, 'shock');
    this.s.fx.burst(p.pos.x, p.pos.y, 14, { color: KAT_STEEL, speed: 380, life: 0.3, size: 2 });
    if (champions > 0) this.s.fx.addShake(0.22);
    audio.play(champions > 0 ? 'perfect' : 'pickup', { pan: this.s.panOf(p.pos) });
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    if (this.qCd > 0) this.qCd = Math.max(0, this.qCd - dt);
    if (this.wCd > 0) this.wCd = Math.max(0, this.wCd - dt);
    if (this.eCd > 0) this.eCd = Math.max(0, this.eCd - dt);
    if (this.rCd > 0) this.rCd = Math.max(0, this.rCd - dt);
    if (this.eCd === 0) this.refunded = false;

    const p = this.s.world.player;
    const now = this.s.world.time;

    // Preparation's pace, decaying to nothing over its own duration. Written
    // as a multiple of her base speed every frame rather than added once, so
    // nothing else that slows her can be undone by it running out.
    if (p) {
      if (this.hasteFor > 0) {
        this.hasteFor = Math.max(0, this.hasteFor - dt);
        const share = this.hasteFor / KATARINA_STATS.wHasteFor;
        p.moveSpeed = KATARINA_STATS.moveSpeed * (1 + KATARINA_STATS.wHaste * share);
      } else if (p.moveSpeed !== KATARINA_STATS.moveSpeed) {
        p.moveSpeed = KATARINA_STATS.moveSpeed;
      }
    }

    // The floor. A dagger lands, lies, and is taken by walking onto it.
    for (let i = this.daggers.length - 1; i >= 0; i--) {
      const d = this.daggers[i];
      if (now < d.landsAt) continue;
      if (!d.down) {
        d.down = true;
        this.stats.daggersLanded++;
        this.s.fx.ring(d.pos.x, d.pos.y, 4, 46, 0.3, KAT_STEEL, 2, 'impact');
      }
      if (now >= d.expiresAt) {
        this.daggers.splice(i, 1);
        this.stats.daggersExpired++;
        continue;
      }
      if (p && p.alive && !this.lotus && dist(p.pos, d.pos) <= KATARINA_STATS.pickupRadius) this.take(d, false);
    }

    this.stepLotus(p);

    if (this.pendingDamage.length) {
      for (const hit of this.pendingDamage) {
        const t = this.s.world.byId(hit.targetId);
        if (t && t.alive) this.s.world.damage(t, hit.amount, p);
      }
      this.pendingDamage.length = 0;
    }

    // Blades that are gone without reporting a body simply missed — the target
    // died first. Nothing comes down: there was no first body to fall behind.
    for (let i = this.blades.length - 1; i >= 0; i--) {
      if (this.s.world.projectiles.some((pr) => pr.id === this.blades[i].projectileId)) continue;
      this.blades.splice(i, 1);
    }

    for (const [id, at] of this.touched) if (now - at > KATARINA_STATS.voracityWindow) this.touched.delete(id);
  }

  /** The spin: a dagger at every champion in reach, six times a second. */
  private stepLotus(p: Actor | undefined): void {
    const l = this.lotus;
    if (!l) return;
    if (!p || !p.alive) {
      this.lotus = null;
      return;
    }
    const now = this.s.world.time;
    p.rootedFor = Math.max(p.rootedFor, Math.min(0.12, l.endsAt - now));
    // Nothing else leaves her hands while it spins.
    p.attackCd = Math.max(p.attackCd, 0.1);
    p.fireArmed = false;

    // A held key after the grace is a move, and a move ends it.
    if (p.moveDir && now - l.startedAt > KATARINA_STATS.rMoveGrace) {
      this.breakLotus('moved');
      return;
    }

    while (now >= l.nextTick && l.nextTick < l.endsAt) {
      l.nextTick += KATARINA_STATS.rTick;
      this.stats.rTicks++;
      const champs = this.s.world
        .enemies()
        .filter((a) => !a.isMinion && dist(a.pos, p.pos) <= KATARINA_STATS.rRange + a.radius)
        .sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos))
        .slice(0, KATARINA_STATS.rTargets);
      for (const a of champs) {
        this.pendingDamage.push({ targetId: a.id, amount: KATARINA_STATS.rDamage });
        this.touched.set(a.id, now);
        this.stats.rHits++;
        this.s.fx.trace([{ ...p.pos }, { ...a.pos }], KAT_LOTUS, 0.14, 2);
      }
    }
    if (now >= l.endsAt) {
      this.lotus = null;
      this.stats.rCompleted++;
      this.s.fx.ring(p.pos.x, p.pos.y, 20, KATARINA_STATS.rRange, 0.4, KAT_LOTUS, 3, 'shock');
    }
  }

  private breakLotus(why: 'moved' | 'shunpo'): void {
    const p = this.s.world.player;
    this.lotus = null;
    if (why === 'moved') {
      this.stats.rMoved++;
      if (p) {
        this.s.micro('LOTUS CANCELLED', p.pos, PALETTE.danger);
        this.s.fx.badFlash(0.18, PALETTE.danger);
        audio.play('castRefuse', { pan: this.s.panOf(p.pos) });
      }
    } else {
      this.stats.rShunpoOut++;
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    const now = this.s.world.time;
    for (const e of events) {
      if (e.type === 'damage' && e.actorId === pid) {
        const t = this.s.world.byId(e.targetId);
        if (t && !t.isMinion && t.team !== 'player') this.touched.set(t.id, now);
        continue;
      }
      if (e.type === 'death') {
        const at = this.touched.get(e.actorId ?? -1);
        if (at !== undefined && now - at <= KATARINA_STATS.voracityWindow) this.voracity(e.actorId as number);
        continue;
      }
      if (e.actorId !== pid) continue;
      switch (e.type) {
        case 'moveOrder':
          // League ends the lotus on a command, and so does this client.
          if (this.lotus && now - this.lotus.startedAt > 0) this.breakLotus('moved');
          break;
        case 'attackLand': {
          const blade = e.meta !== undefined ? this.blades.find((b) => b.projectileId === e.meta) : undefined;
          if (blade) this.onBladeLanded(blade, e);
          else this.stats.attacksLanded++;
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Voracity: a champion she touched is dead, and the kit comes back.
   *
   * The whole of her teamfighting rests on this, and it is scored as its own
   * number because nothing else says it: a reset is the second target reached
   * with every button up, and a Katarina who kills one and then walks to the
   * next has played the fight as a different, slower champion.
   */
  private voracity(id: number): void {
    this.touched.delete(id);
    this.stats.takedowns++;
    const R = KATARINA_STATS.voracityRefund;
    const had = this.qCd + this.wCd + this.eCd;
    this.qCd = Math.max(0, this.qCd - R);
    this.wCd = Math.max(0, this.wCd - R);
    this.eCd = Math.max(0, this.eCd - R);
    if (had > 0.05) this.stats.resets++;
    const p = this.s.world.player;
    if (p) {
      this.s.micro('RESET', p.pos, KAT_RED);
      this.s.fx.ring(p.pos.x, p.pos.y, p.radius, p.radius + 120, 0.45, KAT_RED, 4, 'shock');
      this.s.fx.addFlash(0.1, KAT_RED);
      audio.play('abilityReady', { pan: this.s.panOf(p.pos) });
    }
  }

  // ------------------------------------------------------------- the blade

  private onBladeLanded(blade: Blade, e: WorldEvent): void {
    const target = this.s.world.byId(e.targetId);
    const hitPos = e.pos ?? target?.pos;
    if (!hitPos) return;
    this.stats.qHits++;
    if (target) {
      blade.hit.add(target.id);
      if (!target.isMinion) {
        this.stats.qOnChampions++;
        this.touched.set(target.id, this.s.world.time);
      }
    }

    // The first body decides where the dagger comes down: past it, along the
    // line she threw, a fixed distance. That is the whole of the next stage.
    if (!blade.dropped) {
      blade.dropped = true;
      const at = target?.pos ?? hitPos;
      const d = norm(at.x - blade.from.x, at.y - blade.from.y);
      this.dropDagger(
        { x: at.x + d.x * KATARINA_STATS.qLandBehind, y: at.y + d.y * KATARINA_STATS.qLandBehind },
        KATARINA_STATS.qLandAfter,
        'q',
      );
    }

    if (blade.bouncesLeft <= 0) return;
    let next: Actor | null = null;
    let nd: number = KATARINA_STATS.qBounceRange;
    for (const a of this.s.world.actors) {
      if (!a.alive || a.team === 'player' || blade.hit.has(a.id)) continue;
      const g = dist(a.pos, hitPos);
      if (g < nd) {
        nd = g;
        next = a;
      }
    }
    if (!next) return;
    blade.bouncesLeft--;
    const p = this.s.world.player;
    const shot = this.s.world.spawnProjectile({
      pos: { ...hitPos },
      team: 'player',
      ownerId: p?.id ?? -1,
      vel: { x: 0, y: 0 },
      speed: KATARINA_STATS.qSpeed,
      damage: KATARINA_STATS.qDamage,
      targetId: next.id,
      radius: 12,
      shape: 'shard',
      color: KAT_STEEL,
      maxLife: 1.5,
    });
    // The same blade, carrying on: it is still in the list, and the sweep in
    // `update` keys on the projectile it is riding now.
    blade.projectileId = shot.id;
  }

  // ------------------------------------------------------------------ casts

  cast(slot: AbilitySlot, at: Vec2): KatarinaCastResult {
    switch (slot) {
      case 'q':
        return this.bouncingBlade(at);
      case 'w':
        return this.preparation();
      case 'e':
        return this.shunpo(at);
      case 'r':
        return this.deathLotus();
      default:
        return 'locked';
    }
  }

  /** The enemy nearest a point that she could reach from where she is. */
  private enemyNear(at: Vec2, reach: number, snap: number): Actor | null {
    const p = this.s.world.player;
    if (!p) return null;
    let best: Actor | null = null;
    let bd = snap;
    for (const a of this.s.world.actors) {
      if (!a.alive || a.team === 'player') continue;
      if ((a.invisibleFor ?? 0) > 0) continue;
      if (dist(a.pos, p.pos) > reach + a.radius) continue;
      const g = dist(a.pos, at) - a.radius;
      if (g < bd) {
        bd = g;
        best = a;
      }
    }
    return best;
  }

  /**
   * Q — Bouncing Blade.
   *
   * Targeted: it goes to the body nearest the cursor, and it does not miss. The
   * aim is not the throw, it is the *landing* — which body you name decides
   * where the dagger comes down, and that is the only thing about the cast
   * anybody can get wrong.
   */
  private bouncingBlade(at: Vec2): KatarinaCastResult {
    if (!this.loadout.bouncingBlade) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.lotus) return 'refused';
    if (this.qCd > 0) return 'refused';
    const target = this.enemyNear(at, KATARINA_STATS.qRange, Infinity);
    if (!target) return 'noTarget';

    this.qCd = this.cdOf('q');
    this.stats.qCasts++;
    const d = norm(target.pos.x - p.pos.x, target.pos.y - p.pos.y);
    p.facing = Math.atan2(d.y, d.x);
    const shot = this.s.world.spawnProjectile({
      pos: { x: p.pos.x + d.x * p.radius, y: p.pos.y + d.y * p.radius },
      team: 'player',
      ownerId: p.id,
      vel: { x: d.x * KATARINA_STATS.qSpeed, y: d.y * KATARINA_STATS.qSpeed },
      speed: KATARINA_STATS.qSpeed,
      damage: KATARINA_STATS.qDamage,
      targetId: target.id,
      radius: 12,
      shape: 'shard',
      color: KAT_STEEL,
      maxLife: 1.5,
    });
    this.blades.push({
      projectileId: shot.id,
      hit: new Set(),
      bouncesLeft: KATARINA_STATS.qBounces,
      from: { ...p.pos },
      dropped: false,
    });
    audio.play('castQ', { pan: this.s.panOf(p.pos) });
    return 'cast';
  }

  /**
   * W — Preparation.
   *
   * A dagger tossed straight up from where she stands, and a burst of pace to
   * spend while it is in the air. The pace is the trap: it is exactly enough
   * to carry her out of the slash's reach of the thing she meant to hit with
   * it, and the whole of the ability is coming back.
   */
  private preparation(): KatarinaCastResult {
    if (!this.loadout.preparation) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.lotus) return 'refused';
    if (this.wCd > 0) return 'refused';
    this.wCd = this.cdOf('w');
    this.stats.wCasts++;
    this.hasteFor = KATARINA_STATS.wHasteFor;
    this.dropDagger({ ...p.pos }, KATARINA_STATS.wDaggerAfter, 'w');
    this.s.fx.ring(p.pos.x, p.pos.y, p.radius, p.radius + 50, 0.3, KAT_STEEL, 2, 'pulse');
    audio.play('castW', { pan: this.s.panOf(p.pos) });
    return 'cast';
  }

  /**
   * E — Shunpo.
   *
   * To whatever is nearest the cursor: a landed dagger, or a body. A dagger is
   * taken on arrival and most of the cooldown with it, so the blink is cheap
   * precisely when it was part of a plan. Onto an enemy she lands on the side
   * the cursor is on and strikes them; onto a dagger she strikes whoever is
   * closest.
   */
  private shunpo(at: Vec2): KatarinaCastResult {
    if (!this.loadout.shunpo) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.eCd > 0) return 'refused';

    const dagger = (() => {
      let best: Dagger | null = null;
      let bd: number = KATARINA_STATS.eSnap;
      for (const d of this.daggers) {
        if (!this.landed(d)) continue;
        if (dist(d.pos, p.pos) > KATARINA_STATS.eRange) continue;
        const g = dist(d.pos, at);
        if (g < bd) {
          bd = g;
          best = d;
        }
      }
      return best;
    })();
    const body = dagger ? null : this.enemyNear(at, KATARINA_STATS.eRange, KATARINA_STATS.eSnap);
    if (!dagger && !body) return 'noTarget';

    const from = { ...p.pos };
    let to: Vec2;
    if (dagger) {
      // Onto the dagger, nudged toward the cursor but never out of reach of
      // it — League lets you choose which side of the dagger to arrive on.
      const off = norm(at.x - dagger.pos.x, at.y - dagger.pos.y);
      const lean = Math.min(dist(at, dagger.pos), KATARINA_STATS.pickupRadius * 0.6);
      to = { x: dagger.pos.x + off.x * lean, y: dagger.pos.y + off.y * lean };
    } else {
      const b = body as Actor;
      const side = norm(at.x - b.pos.x, at.y - b.pos.y);
      const s2 = side.x === 0 && side.y === 0 ? norm(from.x - b.pos.x, from.y - b.pos.y) : side;
      const gap = b.radius + p.radius + 4;
      to = { x: b.pos.x + s2.x * gap, y: b.pos.y + s2.y * gap };
    }
    const landing = this.s.world.clearOfTerrain(to, p.radius);

    // Shunpo out of the lotus is the one way to leave it that is not a
    // mistake, and League's players do it on purpose.
    if (this.lotus) this.breakLotus('shunpo');
    if (p.phase === 'windup') {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
    }
    p.pos.x = landing.x;
    p.pos.y = landing.y;
    p.prev.x = landing.x;
    p.prev.y = landing.y;
    p.order = null;

    if (this.refunded) this.stats.eOffRefund++;
    this.refunded = false;
    this.eCd = this.cdOf('e');
    this.stats.eCasts++;

    // The strike: the body she went to, or the one nearest where she landed.
    const struck = body ?? this.enemyNear(landing, KATARINA_STATS.eStrikeRange, KATARINA_STATS.eStrikeRange);
    if (struck) {
      this.pendingDamage.push({ targetId: struck.id, amount: KATARINA_STATS.eDamage });
      if (!struck.isMinion) this.touched.set(struck.id, this.s.world.time);
      p.facing = Math.atan2(struck.pos.y - landing.y, struck.pos.x - landing.x);
    }
    if (body) {
      this.stats.eToEnemy++;
      if (!body.isMinion) this.stats.eToChampion++;
    }

    this.lastShunpo = {
      from,
      to: { ...landing },
      at: this.s.world.time,
      targetId: body?.id ?? null,
      daggerId: dagger?.id ?? null,
    };
    this.s.fx.trace([from, { ...landing }], KAT_RED, 0.3, 4);
    this.s.fx.ring(from.x, from.y, 6, 70, 0.3, KAT_RED, 3, 'shock');
    this.s.fx.burst(landing.x, landing.y, 12, { color: KAT_RED, speed: 260, life: 0.3, size: 2.2 });
    audio.play('castE', { pan: this.s.panOf(landing) });

    if (dagger) {
      this.stats.eToDagger++;
      // Taken on arrival. The refund is applied to the cooldown just charged,
      // which is what makes a dagger route the cheap way across a fight.
      if (this.daggers.includes(dagger)) this.take(dagger, true);
    }
    return 'cast';
  }

  /**
   * R — Death Lotus.
   *
   * Two and a half seconds of daggers at the three nearest champions, and it
   * ends the instant she is told to move. Everything else about her is motion;
   * this is the one moment the right play is to let go of the mouse.
   */
  private deathLotus(): KatarinaCastResult {
    if (!this.loadout.deathLotus) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.lotus) return 'refused';
    if (this.rCd > 0) return 'refused';
    this.rCd = this.cdOf('r');
    this.stats.rCasts++;
    const now = this.s.world.time;
    this.lotus = { startedAt: now, endsAt: now + KATARINA_STATS.rChannel, nextTick: now };
    if (p.phase === 'windup') {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
    }
    p.order = null;
    p.vel.x = 0;
    p.vel.y = 0;
    audio.play('castR', { pan: this.s.panOf(p.pos) });
    return 'cast';
  }

  // -------------------------------------------------------------------- ui

  bar(base: AbilityView[]): AbilityView[] {
    const p = this.s.world.player;
    const reachable = p ? this.daggers.some((d) => this.landed(d) && dist(d.pos, p.pos) <= KATARINA_STATS.eRange) : false;
    return base.map((a) => {
      switch (a.slot) {
        case 'q':
          return this.loadout.bouncingBlade
            ? { ...a, name: 'BOUNCING BLADE', locked: false, cd: clamp(this.qCd / this.cdOf('q'), 0, 1) }
            : a;
        case 'w':
          return this.loadout.preparation
            ? { ...a, name: 'PREPARATION', locked: false, cd: clamp(this.wCd / this.cdOf('w'), 0, 1) }
            : a;
        case 'e':
          // Lit when a dagger is on the floor within reach: the one moment
          // Shunpo is nearly free, said where the hand is already looking.
          return this.loadout.shunpo
            ? {
                ...a,
                name: 'SHUNPO',
                locked: false,
                highlight: reachable && this.eCd <= 0,
                cd: clamp(this.eCd / this.cdOf('e'), 0, 1),
              }
            : a;
        case 'r':
          return this.loadout.deathLotus
            ? {
                ...a,
                name: 'DEATH LOTUS',
                locked: false,
                highlight: this.lotus !== null,
                cd: clamp(this.rCd / this.cdOf('r'), 0, 1),
              }
            : a;
        default:
          return a;
      }
    });
  }

  /** True while the lotus has the body pinned. */
  get casting(): boolean {
    return this.lotus !== null;
  }

  /** How far through the lotus, 0..1, or null when she is not spinning. */
  get channelProgress(): number | null {
    const l = this.lotus;
    if (!l) return null;
    const total = l.endsAt - l.startedAt;
    return total <= 0 ? 1 : clamp((this.s.world.time - l.startedAt) / total, 0, 1);
  }

  /** Was that missile one of her blades? */
  wasBlade(projectileId: number): boolean {
    return this.blades.some((b) => b.projectileId === projectileId);
  }

  /**
   * The number the path leads with: of the daggers that reached the floor,
   * the share she took.
   *
   * Daggers still lying there when it is asked are left out of both sides —
   * the clock stopping on one is nobody's doing.
   */
  get takeRate(): number {
    const settled = this.stats.daggersTaken + this.stats.daggersExpired;
    return settled > 0 ? clamp(this.stats.daggersTaken / settled, 0, 1) : 0;
  }

  /** Average seconds a dagger lay on the floor before she took it. */
  get takeDelay(): number {
    return this.stats.daggersTaken > 0 ? this.stats.takeDelaySum / this.stats.daggersTaken : 0;
  }

  /** Bodies per Bouncing Blade, 0..4. */
  get bladeHitsPerCast(): number {
    return this.stats.qCasts > 0 ? this.stats.qHits / this.stats.qCasts : 0;
  }

  /** Champions per lotus tick, 0..3. */
  get lotusSpread(): number {
    return this.stats.rTicks > 0 ? this.stats.rHits / this.stats.rTicks : 0;
  }
}
