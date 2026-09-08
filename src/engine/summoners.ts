/**
 * The summoner spells — the two buttons that are not the champion.
 *
 * Everything else a player presses in this client belongs to somebody: the
 * tumble is Vayne's, the Mystic Shot is Ezreal's, and each of them is levelled,
 * ranked and scored as part of a specific kit. A summoner spell is the other
 * thing on the bar. It is the same button at level one as at eighteen, it is
 * the same button on every champion in the game, and it is the one piece of a
 * League player's hands that transfers *completely* between champions.
 *
 * That is exactly why it lives here rather than inside a kit. Vayne's Flash and
 * Ezreal's Flash are not two implementations of a similar idea; they are one
 * spell, and a trainer whose whole claim is that a rep transfers cannot afford
 * to have them behave a hair differently from each other.
 *
 * Flash is the only one modelled, because Flash is the only one whose *skill*
 * is a gesture. Heal, Barrier and Cleanse are decisions about a number; Ignite
 * is a decision about a health bar. Flash is four hundred units of distance
 * placed on a piece of ground you chose while somebody was already on top of
 * you, and it is the single most-practised movement in the game.
 */
import { audio } from './audio';
import { PALETTE } from './palette';
import type { AbilityView, Session } from './session';
import type { Vec2 } from './types';

/** League: Flash is a 400 unit blink. */
export const FLASH_RANGE = 400;

/**
 * What a practice run charges for it, in seconds.
 *
 * League's Flash is three hundred seconds, and that number is not about the
 * gesture at all — it is about the *game*, where the whole point of the spell
 * is that spending it costs you the next five minutes of safety. A five minute
 * cooldown is a macro decision. It is also, in a sixty second rep, a button
 * you press once and never learn anything from.
 *
 * The gesture underneath it is a different thing and a very learnable one:
 * where to put four hundred units when a diver is already inside your reach,
 * which wall is thin enough to cross, and — the half nobody drills — pressing
 * it at all rather than dying with it up. Five seconds is short enough that a
 * minute contains a dozen honest attempts at that question, and long enough
 * that it is still a resource inside any one fight.
 */
export const FLASH_PRACTICE_CD = 5;

/** League's own figure, for the one mode that plays a real game. */
export const FLASH_LEAGUE_CD = 300;

export type SummonerCastResult = 'cast' | 'refused' | 'locked';

/**
 * Flash.
 *
 * Four hundred units toward the cursor, instantly, through anything.
 *
 * Three properties make it the spell it is, and all three are here:
 *
 *  - **It ignores terrain on the way.** A flash is not a dash: nothing stops it
 *    halfway, which is why "is that wall thin enough" is a real question with a
 *    real answer, and why every jungle wall on Summoner's Rift has a Flash
 *    distance memorised by somebody.
 *  - **It does not ignore terrain at the end.** You cannot stand inside a wall,
 *    so a flash aimed at the middle of one puts you against its nearest face.
 *    That is the failure people learn from — the flash that "did not go
 *    anywhere" went exactly as far as it was allowed to.
 *  - **It costs the attack you had already committed to.** Pressed in the
 *    windup it throws the shot away, the same law the tumble and every cast in
 *    this engine obey. Pressed in the backswing it is free.
 *
 * It is deliberately *not* refused by a root. Flashing out of one is the whole
 * reason a player holds the spell, and a client that quietly ate the press
 * would be teaching the opposite lesson.
 */
export class FlashSpell {
  /** Seconds remaining. */
  cd = 0;
  /** How many have been spent, and how many of those crossed terrain. */
  casts = 0;
  castsOverWalls = 0;
  lastCastAt = -99;

  constructor(
    private readonly s: Session,
    /** The full cooldown this run charges. */
    readonly total: number = FLASH_PRACTICE_CD,
  ) {}

  get ready(): boolean {
    return this.cd <= 0;
  }

  update(dt: number): void {
    if (this.cd > 0) this.cd = Math.max(0, this.cd - dt);
  }

  cast(at: Vec2): SummonerCastResult {
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.cd > 0) return 'refused';

    const dx = at.x - p.pos.x;
    const dy = at.y - p.pos.y;
    const d = Math.hypot(dx, dy);
    // A flash with the cursor on your own feet still goes somewhere: League
    // sends it where you are facing rather than refusing the press.
    const dir = d < 1 ? { x: Math.cos(p.facing), y: Math.sin(p.facing) } : { x: dx / d, y: dy / d };
    const reach = Math.min(d, FLASH_RANGE);
    const from = { ...p.pos };
    const wanted = { x: from.x + dir.x * reach, y: from.y + dir.y * reach };
    const to = this.s.world.clearOfTerrain(wanted, p.radius);

    // Did it actually cross something? Only true when the straight walk was
    // blocked and the blink landed past the blockage — which is the flash
    // worth having practised.
    const walk = this.s.world.terrainAlong(from, dir, reach, p.radius);
    const crossed = walk.hit && Math.hypot(to.x - from.x, to.y - from.y) > walk.distance + 1;

    // A committed windup is committed, and a blink out of it is the same
    // mistake as a tumble out of it: the shot is gone.
    if (p.phase === 'windup') {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
      this.s.fx.cancel(from);
    }
    // Nothing survives the blink: not the dash you were in, not the shove
    // somebody put you in, not the order that was walking you somewhere.
    p.dash = null;
    p.knockback = null;
    p.order = null;
    p.fireRequest = 0;
    p.pos.x = to.x;
    p.pos.y = to.y;
    // No interpolation across the gap — a blink that smears is a teleport
    // drawn as a dash, which is the one thing it must never look like.
    p.prev.x = to.x;
    p.prev.y = to.y;
    p.vel.x = 0;
    p.vel.y = 0;

    this.cd = this.total;
    this.casts++;
    if (crossed) this.castsOverWalls++;
    this.lastCastAt = this.s.world.time;

    this.s.fx.ring(from.x, from.y, 8, 120, 0.36, PALETTE.accent, 3, 'shock');
    this.s.fx.ring(to.x, to.y, 104, 10, 0.32, PALETTE.playerCore, 3, 'shock');
    this.s.fx.trace([from, { ...to }], PALETTE.accent, 0.42, 5);
    this.s.fx.burst(to.x, to.y, 16, { color: PALETTE.accent, speed: 300, life: 0.4, size: 2.4 });
    audio.play('dodge', { pan: this.s.panOf(to) });
    if (crossed) this.s.micro('OVER THE WALL', to, PALETTE.good);
    return 'cast';
  }

  /** The F slot, wherever a kit's bar is being built. */
  view(base: AbilityView): AbilityView {
    return {
      ...base,
      name: 'FLASH',
      locked: false,
      cd: this.total > 0 ? Math.max(0, Math.min(1, this.cd / this.total)) : 0,
      highlight: this.cd <= 0,
    };
  }
}
