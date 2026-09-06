import { tuningFor } from '../engine/ai';
import { CAITLYN_COLOR, CaitlynKit } from '../engine/caitlyn';
import { clamp, dist } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField, Session } from '../engine/session';
import type { Actor, Vec2, Wall } from '../engine/types';
import type { WorldEvent } from '../engine/world';
import { band, count, pct, type DrillOutcome } from './base';
import { VayneDrill } from './vaynebase';

/** How long she is off the floor after a takedown. */
const RELOAD_SECONDS = 4;

/**
 * SHERIFF — dodging, against somebody who is actually aiming at you.
 *
 * Every other mode in this client is about your own hands. This one is about
 * hers, and it is the only mode where the thing being measured is what you did
 * about a decision somebody else made.
 *
 * The old dodge drill fired patterns out of turrets. Turrets do not lead you,
 * do not punish you for standing still in a specific place, and do not have a
 * reason for the thing they threw — so the habit it built was *react to a red
 * shape*, which is a quarter of the real skill. What a lane actually asks is
 * narrower and much harder: one opponent, four buttons, each with its own tell
 * and its own answer, thrown at the moment they are most likely to land.
 *
 * So the opponent is Caitlyn, and she is not an approximation of one. The
 * matchup is the reason: 650 range against Vayne's 550 means she is allowed to
 * stand where you cannot reach and you are not allowed to stand where she
 * cannot. Every unit of that gap has to be taken with a tumble timed off the
 * end of an attack, and every mistake you make walking into it is punished by
 * a champion whose whole kit exists to punish exactly that.
 *
 * Four answers, and no two of them are the same movement:
 *
 *  - **Q Piltover Peacemaker** — a lane drawn on the floor for 0.625 seconds
 *    before anything leaves the barrel. One step, taken early, sideways.
 *  - **W Yordle Snap Trap** — no damage at all. It takes your feet, and what
 *    kills you is the Peacemaker you can no longer dodge. Read the floor.
 *  - **E 90 Caliber Net** — the price of closing. It slows you and throws her
 *    out of your reach, so walking at her has to be a decision you win.
 *  - **R Ace in the Hole** — a lock-on. There is no movement that beats it and
 *    there is always a wall that does. This is the one dodge that is a place.
 *
 * The mode refuses to be a corner: she has to die for a good score, and the
 * only way to kill her is to stand inside her range on purpose and leave again
 * — which is orbwalking, under fire, against the specific champion that
 * punishes it hardest.
 */
export class CaitlynDodgeDrill extends VayneDrill {
  readonly sheriff: CaitlynKit;

  /** Seconds until she comes back after dying, or 0 when she is on the floor. */
  private reloadCd = 0;
  /** How many times you have put her down. The offensive half of the score. */
  private takedowns = 0;
  /** Extra bodies SURVIVE has added so far, so the count only ever climbs. */
  private escorts = 0;
  /** Damage put on her, tracked here so a respawn does not reset the ledger. */
  private damageOnHer = 0;
  private herHpLast = 0;

  constructor(s: Session) {
    // Q and the trinket, and nothing else. A mode about reading somebody
    // else's kit cannot also be a mode about executing four buttons of your
    // own — the tumble is here because it is the movement tool the dodge is
    // actually made with, and the ward is here because it is on every bar.
    super(s, { tumble: true, bolts: false, condemn: false, finalHour: false, ranks: { q: 3 } });
    this.sheriff = new CaitlynKit(s);
  }

  setup(): void {
    this.placeCover();
    const { w, h } = this.s.world.bounds;
    const p = this.spawnVayne({ x: w * 0.5, y: h * 0.76 });
    // Above Vayne's real pool, and the arithmetic is the whole reason.
    //
    // Caitlyn reaches a hundred units further than Vayne does, so every second
    // of a straight trade is a second she is winning: a player who dodges
    // nothing loses this pool inside fifty seconds, and a player who dodges
    // everything finishes the minute with a third of it left. That gap is the
    // mode. It only exists if the run is long enough to contain it, which is
    // why the number is this one and not her honest 1420.
    p.maxHp = 1800;
    p.hp = 1800;
    this.spawnSheriff({ x: w * 0.5, y: h * 0.22 });
  }

  /**
   * Terrain, placed for the one ability that needs it.
   *
   * Four blocks, spread, with clear lanes between them: from anywhere on this
   * floor there is a wall inside a second's walk, which is what makes "break
   * line of sight" a real instruction rather than a taunt. They are not a ring
   * — a ring would mean every angle has cover and the ultimate would stop
   * asking a question — and they are big enough to actually hide behind, which
   * a scattering of pillars is not.
   */
  private placeCover(): void {
    const { w, h } = this.s.world.bounds;
    const walls: Wall[] = [
      { x: w * 0.3, y: h * 0.5, w: 76, h: h * 0.34 },
      { x: w * 0.7, y: h * 0.5, w: 76, h: h * 0.34 },
      { x: w * 0.5, y: h * 0.17, w: w * 0.19, h: 70 },
      { x: w * 0.5, y: h * 0.83, w: w * 0.19, h: 70 },
    ];
    this.s.world.walls = walls;
  }

  /**
   * Put her on the floor.
   *
   * The body and the feet come from the ordinary bot plumbing — she is steered
   * by the same `EnemyBrain` as everything else in the trainer, because how a
   * marksman holds its distance is a solved problem here. What is hers is the
   * kit, and the brain's own signature ability is switched off so there is
   * exactly one champion's worth of telegraphs on the floor.
   */
  private spawnSheriff(pos: Vec2): Actor {
    const level = this.s.liveDifficulty;
    const tune = tuningFor(level);
    const a = this.spawnEnemy('ranger', pos, { behavior: 'strafe' });
    this.sheriff.attach(a);
    // Tempo is the one part of the difficulty table that belongs to a body
    // rather than to a decision, so it is applied by hand here — everything
    // else `spawnEnemy` wrote was the Ranger's and has just been overwritten.
    a.attack.attackSpeed *= tune.tempo;
    a.moveSpeed *= 0.94 + tune.tempo * 0.08;
    const brain = this.lastBrain;
    if (brain) {
      brain.signature = false;
      // Where she stands, and it is the one number difficulty is allowed to
      // move about her body.
      //
      // A Caitlyn who held her own 650 at every setting would be a Caitlyn you
      // could never touch, and a mode you cannot fight back in is a mode whose
      // best strategy is the far corner. So an easy Sheriff holds a distance
      // comfortably inside Vayne's 550 and is there to be traded with; a hard
      // one holds the edge of her own reach, where the only way to put damage
      // on her is to walk into the hundred units she has on you and walk back
      // out. That is the matchup, and it is what should get harder — not the
      // length of the telegraph, which stays exactly the same all the way up.
      brain.preferredRange = 470 + level * 150;
    }
    // How well she reads you, and how long she takes to. These two are the
    // whole of what difficulty changes about her: the number of Peacemakers a
    // minute is identical at every setting, so a dodge rate is comparable
    // across the ladder rather than being a second reading of the difficulty.
    this.sheriff.lead = tune.prediction;
    this.sheriff.reaction = tune.reactionDelay;
    this.herHpLast = a.hp;
    this.s.fx.ring(pos.x, pos.y, 12, 150, 0.5, CAITLYN_COLOR, 3, 'shock');
    return a;
  }

  update(dt: number): void {
    super.update(dt);
    this.sheriff.update(dt);
    this.updateBrains(dt);

    // Being hit by the Peacemaker is the mistake this mode exists to remove.
    // It is the only one charged: a trap costs you a Q you could not dodge, so
    // charging both would bill the same mistake twice.
    this.chargeStrikes(this.sheriff.stats.qHits, 'CAUGHT BY Q');

    const her = this.sheriff.actor;
    if (her && her.alive) {
      // Damage on her is banked frame by frame rather than read off her bar at
      // the end, because her bar goes back to full every time she reloads.
      if (her.hp < this.herHpLast) this.damageOnHer += this.herHpLast - her.hp;
      this.herHpLast = her.hp;
    } else {
      this.reload(dt);
    }

    // SURVIVE sends her help. One Caitlyn is a reading exercise; a Caitlyn
    // with somebody walking at you is the same reading exercise with the
    // corner of the arena taken away, which is the only honest way to make a
    // dodging mode harder without making the telegraphs shorter.
    if (this.s.surviving) {
      const wanted = Math.floor(this.s.pressure * 2.99);
      while (this.escorts < wanted) {
        this.escorts++;
        const e = this.spawnEnemy('diver', this.edgePoint(), { hpScale: 0.7, behavior: 'diver' });
        e.moveSpeed = 175 + this.s.liveDifficulty * 70;
        e.attack.damage = 20 + this.s.liveDifficulty * 18;
        e.label = 'DEPUTY';
        this.s.setBanner('DEPUTY', 1);
      }
    }
  }

  /**
   * She reloads.
   *
   * Killing her has to be worth something or the mode has no offensive half at
   * all; killing her permanently would end the rep the moment you managed it.
   * So she goes down, is counted, and walks back on somewhere else a few
   * seconds later — with the cooldowns she had, which kept running while she
   * was gone, and with the traps she left still exactly where they were,
   * because those are on the floor rather than in her hands. Neither of those
   * is a detail: a takedown that refreshed her kit or swept the floor clean
   * would make killing her a thing the mode quietly punished.
   */
  private reload(dt: number): void {
    // The frame she goes down: bank the takedown and put the clock on.
    if (this.sheriff.actor) {
      this.takedowns++;
      this.reloadCd = RELOAD_SECONDS;
      this.sheriff.retire();
      this.s.setBanner('RELOADING', 1.2);
      return;
    }
    if (this.reloadCd <= 0) return;
    this.reloadCd -= dt;
    if (this.reloadCd > 0) return;
    const p = this.s.world.player;
    this.spawnSheriff(this.randomPoint(p?.pos ?? null, 780, 150));
  }

  onEvents(events: readonly WorldEvent[]): void {
    super.onEvents(events);
    this.sheriff.onEvents(events);
  }

  paint(out: DrillPaint, t: number): void {
    super.paint(out, t);
    this.paintSignature(out, t);
    this.sheriff.paint(out, t);

    const p = this.s.world.player;
    const her = this.sheriff.actor;
    if (!p) return;

    // Her reach. It is the only ring on this floor and it is drawn for one
    // reason: the hundred units between her 650 and your 550 is ground she can
    // shoot you from and you cannot shoot back from, and crossing it on
    // purpose is the whole physical problem of the matchup. It goes red and
    // pulses the moment you are inside it, because that is a decision you
    // should know you have made.
    if (her && her.alive) {
      const inside = dist(p.pos, her.pos) - her.radius < her.attack.range;
      out.markers.push({
        kind: 'ring',
        x: her.pos.x,
        y: her.pos.y,
        radius: her.attack.range + p.radius,
        color: inside ? PALETTE.danger : CAITLYN_COLOR,
        alpha: inside ? 0.45 + 0.16 * Math.sin(t * 7) : 0.2,
        width: inside ? 3.5 : 2,
        dash: 54,
        spin: -0.18,
        rise: 1.6,
      });
    }
  }

  hudFields(): HudField[] {
    const st = this.sheriff.stats;
    const resolved = st.qDodged + st.qHits;
    const dodge = resolved > 0 ? st.qDodged / resolved : 1;
    const her = this.sheriff.actor;
    const trigger = this.triggerField();
    return [
      this.tumbleField(),
      {
        label: 'Q DODGED',
        value: resolved > 0 ? `${st.qDodged} / ${resolved}` : '—',
        bar: dodge,
        tone: dodge > 0.8 ? 'good' : dodge > 0.55 ? 'warn' : 'bad',
      },
      {
        label: 'PEACEMAKER',
        value: this.sheriff.casting
          ? 'INCOMING'
          : her && her.alive
            ? this.sheriff.peacemakerCd > 0
              ? `${this.sheriff.peacemakerCd.toFixed(1)}s`
              : 'READY'
            : 'RELOADING',
        bar: her && her.alive ? 1 - clamp(this.sheriff.peacemakerCd / 4.5, 0, 1) : 0,
        tone: this.sheriff.casting ? 'bad' : this.sheriff.peacemakerCd > 0 ? 'neutral' : 'warn',
      },
      {
        label: 'TRAPS HIT',
        value: `${st.trapsTriggered}`,
        tone: st.trapsTriggered === 0 ? 'good' : st.trapsTriggered < 3 ? 'warn' : 'bad',
      },
      {
        label: 'TAKEDOWNS',
        value: `${this.takedowns}`,
        tone: this.takedowns > 0 ? 'good' : 'neutral',
      },
      ...(trigger ? [trigger] : []),
    ];
  }

  liveScore(): number {
    const st = this.sheriff.stats;
    const m = this.s.metrics.m;
    return Math.max(
      0,
      Math.round(
        st.qDodged * 900 +
          st.trapsAvoided * 260 +
          st.netDodged * 420 +
          st.aceBlocked * 2600 +
          this.takedowns * 3200 +
          this.damageOnHer * 3 +
          m.damageDealt * 2 -
          st.qHits * 700 -
          st.trapsTriggered * 500 -
          st.headshots * 200 -
          m.hpLost * 2,
      ),
    );
  }

  outcome(): DrillOutcome {
    const st = this.sheriff.stats;
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? 1800);

    const qResolved = st.qDodged + st.qHits;
    const qDodge = qResolved > 0 ? st.qDodged / qResolved : 0;
    const netResolved = st.netDodged + st.netHits;
    const netDodge = netResolved > 0 ? st.netDodged / netResolved : 0;
    const trapsSeen = st.trapsAvoided + st.trapsTriggered;
    const trapRead = trapsSeen > 0 ? st.trapsAvoided / trapsSeen : 0;
    const aceSeen = st.aceBlocked + st.aceHits;
    const aceRead = aceSeen > 0 ? st.aceBlocked / aceSeen : 0;

    /**
     * The dodge, weighted by how much each ability is worth getting right.
     *
     * The Peacemaker carries it because it is the one you meet a dozen times a
     * minute and the one whose answer transfers to every other line skillshot
     * in the game. The rest are folded in only when they actually happened —
     * an ultimate you were never shown is not an ultimate you dodged, and a
     * mode that scored it as one would hand out marks for her cooldowns.
     */
    const parts: { value: number; weight: number }[] = [{ value: qDodge, weight: 0.58 }];
    if (trapsSeen > 0) parts.push({ value: trapRead, weight: 0.2 });
    if (netResolved > 0) parts.push({ value: netDodge, weight: 0.1 });
    if (aceSeen > 0) parts.push({ value: aceRead, weight: 0.12 });
    const weight = parts.reduce((a, b) => a + b.weight, 0);
    const reading = parts.reduce((a, b) => a + b.value * b.weight, 0) / Math.max(0.0001, weight);

    // What her dodgeable abilities aimed at you, against what they actually
    // took off you. Weighted by damage rather than by count on purpose: it is
    // the one number that cannot be gamed by sidestepping every net and then
    // standing still through the ultimate.
    const avoided = st.threatDamage > 0 ? clamp(1 - st.dodgeableTaken / st.threatDamage, 0, 1) : 0;

    /**
     * The other half, and the reason this is not a fleeing simulator.
     *
     * She has 650 range and you have 550. There is no version of "played this
     * well" that does not involve standing inside her reach on purpose, taking
     * a shot, and leaving before the next Peacemaker — so damage on her and
     * putting her down are scored, and everything else is gated behind them.
     */
    // Both bands are deliberately set above where a good run lands rather than
    // at it. A term that saturates is a term that has stopped measuring, and
    // the offensive half of this mode has to keep separating a player who is
    // trading well from one who is trading brilliantly — which is exactly the
    // difference a harder Sheriff is supposed to make visible.
    const pressure = clamp(
      band(this.damageOnHer / Math.max(1, this.s.elapsed), 8, 60) * 0.6 + band(this.takedowns, 0, 4) * 0.4,
      0,
      1,
    );

    const performance = clamp(
      (reading * 0.32 + avoided * 0.12 + pressure * 0.28 + d.hpRetained * 0.2 + clamp(d.orbwalkEfficiency, 0, 1) * 0.08) *
        (0.42 + 0.58 * band(pressure, 0.05, 0.5)),
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (qDodge > 0.85 && qResolved > 5) helped.push(`${st.qDodged} of ${qResolved} Peacemakers dodged.`);
    if (st.aceBlocked > 0) helped.push(`${st.aceBlocked} ultimate${st.aceBlocked === 1 ? '' : 's'} broken on terrain — the only answer there is.`);
    if (this.takedowns > 0) helped.push(`${this.takedowns} takedown${this.takedowns === 1 ? '' : 's'} on a champion that outranges you by a hundred units.`);
    if (trapsSeen > 2 && st.trapsTriggered === 0) helped.push('Not one trap stepped in.');
    if (st.qHits > 2) hurt.push(`${st.qHits} Peacemakers landed. The lane is on the floor for 0.6s before anything leaves the barrel.`);
    if (st.qFreeHits > 0)
      hurt.push(`${st.qFreeHits} of those hit you while you were already held — the trap or the net was the mistake, not the Q.`);
    if (st.trapsTriggered > 1) hurt.push(`${st.trapsTriggered} traps stepped in. They deal no damage; what they cost you is the dodge afterwards.`);
    if (st.aceHits > 0) hurt.push(`${st.aceHits} ultimate${st.aceHits === 1 ? '' : 's'} landed. Nothing outruns it — there is a wall within a second of anywhere on this floor.`);
    if (st.headshots > 2) hurt.push(`${st.headshots} headshots taken. Every sixth attack she lands is worth two, so time spent in her range is not free.`);
    if (pressure < 0.2) hurt.push('You dodged and did nothing. She has to die, and the only way to kill her is to be inside her range on purpose.');
    this.handsNotes(helped, hurt);

    const advice =
      this.handsAdvice() ??
      (pressure < 0.2
        ? 'Dodging alone is not the mode. Take the shot on her, tumble out on the backswing, and be gone before the next lane is drawn.'
        : st.aceHits > 0
          ? 'When the beam appears, stop thinking about your feet and start thinking about the nearest wall. It is the only ability here that movement does not answer.'
          : st.trapsTriggered > 1
            ? 'She puts traps where you are about to be. Look at the ground you are walking onto, not the ground you are on.'
            : qDodge < 0.7
              ? 'You are moving on the missile instead of on the cast. The lane is drawn for six tenths of a second before it fires — one step, early, at right angles to it.'
              : 'This is the read. Now hold it while you are the one applying the pressure.');

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: {
        dodging: performance,
        movement: clamp(d.moveEfficiency, 0, 1),
        spacing: clamp(band(d.avgSpacingError, 260, 40), 0, 1),
        combat: clamp(pressure * 0.6 + reading * 0.4, 0, 1),
      },
      keyMetrics: [
        pct('qDodge', 'PEACEMAKER DODGE RATE', qDodge),
        count('qHits', 'PEACEMAKERS TAKEN', st.qHits, 'lower'),
        count('traps', 'TRAPS STEPPED IN', st.trapsTriggered, 'lower'),
        count('aceBlocked', 'ULTIMATES BROKEN', st.aceBlocked),
        count('aceHits', 'ULTIMATES TAKEN', st.aceHits, 'lower'),
        count('headshots', 'HEADSHOTS TAKEN', st.headshots, 'lower'),
        count('takedowns', 'TAKEDOWNS', this.takedowns),
        pct('avoided', 'HER DAMAGE AVOIDED', avoided),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
