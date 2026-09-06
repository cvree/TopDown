import { audio } from '../../engine/audio';
import type { AbilitySlot } from '../../engine/input';
import type { MapBoard } from '../../engine/mapboard';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { Session } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import { count, ms, pct } from '../base';
import type { HitOpts } from './engine';
import { median } from './stats';

/**
 * THE MAP — the second screen, and the only thing in the lab that is not on
 * the bench.
 *
 * In the bottom-right corner, where the minimap lives in every game any of
 * this is for, a two-lane board runs for the whole of every mode. Your blip
 * stands in one lane. A bad orb falls slowly down the other one — or down
 * yours, which is the case that matters — and you have until it lands to be
 * somewhere else. Two keys, one for each lane, and they are your own
 * bindings: the summoner bank, because getting out of the way of something you
 * saw coming on the map is what that bank is *for*.
 *
 * Three things make it a training tool rather than a distraction.
 *
 * It is slow. The orb takes between one and a half and nearly four seconds to
 * fall, which is far longer than a reaction — so failing it is never "too
 * fast", it is "never looked". That is the honest version of the mistake the
 * mode is about, and it is the one people actually make.
 *
 * It hunts you. An orb is far likelier to be aimed at the lane you are already
 * standing in than at the empty one, so standing still is usually wrong and
 * occasionally right. The occasional right is what gives the board a hold —
 * the engine's verb for the command you were correct not to make — and what
 * stops the answer being "hammer the other key on every telegraph".
 *
 * It costs the chain. An orb that lands on you breaks the flow tier you have
 * been building on the bench, which is exactly what happens when you die to a
 * gank in the middle of a good wave: the mechanical run was fine, and you lost
 * it somewhere else entirely.
 */

/** The two lanes, and the keys that put you in them. */
export const MAP_KEYS: [AbilitySlot, AbilitySlot] = ['d', 'f'];

/** What the board needs from the drill it is bolted onto. */
export interface MapVerbs {
  hit(pos: Vec2, opts: HitOpts): void;
  hold(pos: Vec2, label: string): void;
  fumble(pos: Vec2, label: string, opts: { cost?: number; input?: boolean }): void;
  stray(pos: Vec2): void;
  /** The player's own binding for a slot, as printed on the board. */
  glyph(slot: AbilitySlot): string;
  /** The live flow colour, so the board is part of the same run. */
  color(): string;
  /** Where in the arena the board's feedback should land. */
  focus(): Vec2;
}

interface Orb {
  lane: number;
  /** Where it is drawn, in lanes. Eased, so a sidestep is visible. */
  x: number;
  /** 0 at the top of the board, 1 on the floor. */
  fall: number;
  /** Seconds top to bottom. */
  life: number;
  /** The fraction of the fall it steps across at, or null for a straight one. */
  swerveAt: number | null;
  swerved: boolean;
  /** True once it has ever been aimed at the lane the player was standing in. */
  claimed: boolean;
  /** Run time the current threat began, for the reaction figure. */
  threatAt: number;
  /** True once the player has answered this one with a move. */
  answered: boolean;
  warned: boolean;
}

/** Stereo position of a lane, so the telegraph arrives on the correct side. */
const PAN = [-0.62, 0.62];

export class MapDodge {
  private orbs: Orb[] = [];
  private lane = 0;
  /** The blip's drawn position, in lanes. */
  private slide = 0;
  private spawnCd = 1.7;
  private hurt = 0;
  private clean = 0;

  private streak = 0;
  private bestStreak = 0;
  private seen = 0;
  private taken = 0;
  private dodged = 0;
  private held = 0;
  private intoIt = 0;
  private idleSwaps = 0;
  private reactions: number[] = [];
  /** How much of the fall was still left when the dodge was made, 0..1. */
  private earliness: number[] = [];

  /**
   * @param pressure How hard this mode runs the board. One is the standard
   *   load every mode carries; the modes about divided attention run it hot.
   */
  constructor(
    private readonly s: Session,
    private readonly v: MapVerbs,
    private readonly pressure: number,
  ) {}

  // ------------------------------------------------------------- the clock

  private get d(): number {
    return this.s.config.difficulty;
  }

  /** Seconds between orbs. Tightens with the rung and with the mode's load. */
  private get interval(): number {
    return clamp((4.4 - this.d * 2.6) / this.pressure, 0.85, 4.4);
  }

  /** Seconds an orb takes to fall. Slow on purpose: this is a reading test. */
  private get fallTime(): number {
    return clamp(3.8 - this.d * 2.1, 1.4, 3.8);
  }

  /** How many can be in the air at once. */
  private get concurrency(): number {
    return this.pressure > 1.4 || this.d > 0.7 ? 2 : 1;
  }

  // ------------------------------------------------------------- the frame

  update(dt: number): void {
    this.slide += (this.lane - this.slide) * clamp(dt * 12, 0, 1);
    this.hurt = Math.max(0, this.hurt - dt * 1.7);
    this.clean = Math.max(0, this.clean - dt * 1.7);

    this.spawnCd -= dt;
    if (this.spawnCd <= 0 && this.orbs.length < this.concurrency) {
      this.spawnCd = this.interval;
      this.spawn();
    }

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.fall += dt / o.life;
      o.x += (o.lane - o.x) * clamp(dt * 5.5, 0, 1);

      if (!o.swerved && o.swerveAt !== null && o.fall >= o.swerveAt) {
        // The step across. It is the one thing on the board that can make an
        // answer you already gave wrong, so it is loud and it is late.
        o.swerved = true;
        o.lane = 1 - o.lane;
        audio.play('telegraph', { intensity: 0.8, pan: PAN[o.lane] });
      }
      if (o.lane === this.lane && !o.claimed) {
        o.claimed = true;
        o.threatAt = this.s.elapsed;
      }
      // One warning as it commits, for a player whose eyes are on the bench.
      if (!o.warned && o.lane === this.lane && this.committed(o) && o.fall > 0.35) {
        o.warned = true;
        audio.play('tick', { intensity: 0.8, pan: PAN[o.lane] });
      }
      if (o.fall < 1) continue;
      this.orbs.splice(i, 1);
      this.land(o);
    }
  }

  private spawn(): void {
    // It hunts. Standing still has to be wrong most of the time, or the board
    // is answered by never touching either key.
    const atPlayer = this.s.rng.chance(0.58 + this.d * 0.14);
    const lane = atPlayer ? this.lane : 1 - this.lane;
    const swerves = this.s.rng.chance(clamp((this.d - 0.42) * 1.3, 0, 0.5));
    this.orbs.push({
      lane,
      x: lane,
      fall: 0,
      life: this.fallTime,
      swerveAt: swerves ? this.s.rng.range(0.34, 0.6) : null,
      swerved: false,
      claimed: lane === this.lane,
      threatAt: this.s.elapsed,
      answered: false,
      warned: false,
    });
    this.seen++;
    audio.play('telegraph', { intensity: 0.55, pan: PAN[lane] });
  }

  /** True once an orb can no longer change lanes: the read is safe to make. */
  private committed(o: Orb): boolean {
    return o.swerveAt === null || o.swerved;
  }

  private land(o: Orb): void {
    const at = this.v.focus();
    if (o.lane === this.lane) {
      this.taken++;
      this.streak = 0;
      this.hurt = 1;
      this.s.fx.addFlash(0.09, PALETTE.danger);
      audio.play('hazardFire', { intensity: 0.9, pan: PAN[o.lane] });
      this.v.fumble(at, 'ORB TAKEN', { input: false, cost: 110 });
      return;
    }
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.clean = 1;
    if (!o.answered) {
      // It was never yours to answer, and you did not answer it. That is the
      // hold — restraint, paid for, and worth no actions per minute at all.
      this.held++;
      this.v.hold(at, 'LET IT LAND');
    }
  }

  // -------------------------------------------------------------- the keys

  /** Returns true when the key belonged to the board. */
  press(slot: AbilitySlot): boolean {
    const idx = MAP_KEYS.indexOf(slot);
    if (idx < 0) return false;
    const at = this.v.focus();
    if (idx === this.lane) {
      // The lane you are already standing in. An input that moved nothing.
      this.v.stray(at);
      return true;
    }
    const from = this.lane;
    this.lane = idx;

    const threat = this.worst(from);
    const into = this.worst(idx);
    if (threat) {
      threat.answered = true;
      const early = clamp(1 - threat.fall, 0, 1);
      this.dodged++;
      this.earliness.push(early);
      this.reactions.push((this.s.elapsed - threat.threatAt) * 1000);
      this.clean = 1;
      this.v.hit(at, {
        quality: clamp(early * 1.2, 0, 1),
        value: 135,
        reaction: (this.s.elapsed - threat.threatAt) * 1000,
        label: 'DODGED',
        color: this.v.color(),
      });
      return true;
    }
    if (into) {
      this.intoIt++;
      this.v.fumble(at, 'INTO IT', { cost: 90 });
      return true;
    }
    this.idleSwaps++;
    this.v.stray(at);
    return true;
  }

  /** The most advanced live orb aimed at a lane, if there is one. */
  private worst(lane: number): Orb | null {
    let best: Orb | null = null;
    for (const o of this.orbs) {
      if (o.lane !== lane) continue;
      if (!best || o.fall > best.fall) best = o;
    }
    return best;
  }

  /**
   * The key a perfect player would be pressing right now, or null.
   *
   * Only a committed orb counts: answering one that has not chosen its lane
   * yet is a guess, and a guess that happens to be right is not the thing the
   * board is trying to teach.
   */
  solution(): AbilitySlot | null {
    for (const o of this.orbs) {
      if (o.lane !== this.lane || !this.committed(o)) continue;
      return MAP_KEYS[1 - this.lane];
    }
    return null;
  }

  // ------------------------------------------------------------- the board

  board(): MapBoard {
    const threatened = [false, false];
    for (const o of this.orbs) threatened[o.lane] = true;
    const onYou = this.orbs.some((o) => o.lane === this.lane);
    return {
      lanes: MAP_KEYS.map((k, i) => ({ key: this.v.glyph(k), threatened: threatened[i] })),
      player: this.slide,
      orbs: this.orbs.map((o) => ({
        x: (o.x + 0.5) / 2,
        y: clamp(o.fall, 0, 1),
        r: 0.1 + clamp(o.fall, 0, 1) * 0.05,
        lane: o.lane,
        committed: this.committed(o),
        onYou: o.lane === this.lane,
      })),
      hurt: this.hurt,
      clean: this.clean,
      streak: this.streak,
      note: onYou ? 'MOVE' : this.orbs.length ? 'HOLD' : 'CLEAR',
      color: this.v.color(),
    };
  }

  // ------------------------------------------------------------ the ledger

  /** True once the board has actually asked the player for something. */
  get engaged(): boolean {
    return this.seen > 0;
  }

  /** What the board has asked for and what it got, for a mode's own HUD. */
  get ledger(): { seen: number; dodged: number; taken: number; held: number; streak: number } {
    return { seen: this.seen, dodged: this.dodged, taken: this.taken, held: this.held, streak: this.streak };
  }

  get dodgeRate(): number {
    const asked = this.dodged + this.taken;
    return asked > 0 ? this.dodged / asked : 1;
  }

  metrics(): KeyMetric[] {
    if (!this.seen) return [];
    return [
      pct('mapClean', 'MAP ORBS DODGED', this.dodgeRate),
      count('mapTaken', 'ORBS TAKEN', this.taken, 'lower'),
      ms('mapReact', 'MAP REACTION', median(this.reactions)),
      count('mapStreak', 'BEST MAP STREAK', this.bestStreak),
      ...(this.intoIt > 0 ? [count('mapInto', 'MOVED INTO IT', this.intoIt, 'lower')] : []),
      ...(this.idleSwaps > 0 ? [count('mapIdle', 'LANE SWAPS FOR NOTHING', this.idleSwaps, 'lower')] : []),
    ];
  }

  notes(): { helped: string[]; hurt: string[] } {
    if (!this.seen) return { helped: [], hurt: [] };
    const helped: string[] = [];
    const hurt: string[] = [];
    const early = median(this.earliness);
    if (this.taken === 0 && this.dodged > 2) helped.push('Nothing on the map ever landed on you.');
    else if (this.dodgeRate > 0.8 && this.dodged > 3) helped.push(`${this.dodged} orbs answered while your hands were busy.`);
    if (early > 0.55 && this.dodged > 3) helped.push('You move on the telegraph rather than on the impact.');
    if (this.held > 3 && this.intoIt === 0) helped.push(`${this.held} orbs you correctly let land in the other lane.`);
    if (this.taken > 2) hurt.push(`${this.taken} orbs landed on you — the bench was fine and the map was not.`);
    if (this.intoIt > 1) hurt.push(`${this.intoIt} times you moved into the lane the orb was falling down.`);
    if (this.idleSwaps > this.dodged) hurt.push('Most of your lane swaps were made with nothing in the air.');
    return { helped, hurt };
  }

  /** The one line of coaching the board is worth, if it is the worst thing. */
  advice(): string | null {
    if (!this.seen) return null;
    if (this.taken > this.dodged * 0.5)
      return 'Glance at the map between prompts rather than when something lands on you. The orb takes seconds to fall — every one that hit you was visible the whole way down.';
    if (this.intoIt > 1) return 'Read which lane it is in before you move. Half your dodges are into the orb.';
    if (median(this.earliness) < 0.25 && this.dodged > 4)
      return 'You are answering the map at the last moment. Take the lane early and go back to your hands.';
    return null;
  }
}
