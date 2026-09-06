import { audio } from '../engine/audio';
import { clamp, dist, norm } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { Actor, Vec2 } from '../engine/types';
import type { WorldEvent } from '../engine/world';
import { Drill, band, count, pct, secs, units, type DrillOutcome } from './base';

/**
 * RANGE — the edge of your reach, from memory.
 *
 * Every other mode in this trainer measures something you do. This one
 * measures something you *know*: where your attack range ends. It is the
 * single most load-bearing piece of knowledge an ADC has, it is invisible, and
 * almost nobody practises it — because in a normal client there is a ring
 * drawn under your feet doing the knowing for you.
 *
 * So the ring is gone. It is not drawn during a run, at all, until you ask for
 * it, and asking for it is the camera-centre key: one press pulls the view
 * back onto your champion and paints your reach for eight tenths of a second.
 * That is a *check*, and this mode counts every one of them, because the
 * difference between a player who checks twice a minute and a player who
 * checks before every attack is the whole difference the mode exists to close.
 *
 * ─── the rep ────────────────────────────────────────────────────────────────
 *
 * One mark, one shot. The mark is deliberately never standing where you should
 * shoot from — it is too far, or it is too close — so a rep is always the same
 * act: put yourself on the edge of your own range, and fire from there. The
 * moment your windup starts, the run measures the gap between where you were
 * and where your edge actually was, in units, signed, and draws you the answer:
 *
 *   EDGE     inside the tolerance. The shot you were entitled to.
 *   DEEP     fired from inside your range. Every unit of it is free ground you
 *            handed to something with a shorter reach than yours.
 *   WALKED   you ordered an attack you could not take, and the champion walked
 *            you into range to make it possible. Under the click scheme that is
 *            not a judgement about distance at all — it is the game moving you
 *            — so the rep is void, and in a real game it is how people die.
 *   MISSED   the window closed with no shot in it.
 *
 * ─── the five phases ────────────────────────────────────────────────────────
 *
 * They are ordered by what has to be true before the next one can be learnt.
 *
 *   MARK    A still target and free checks. Calibration: look at the ring,
 *           look at the ground, and put a number on the two.
 *   STEP    Still targets, but placed too close as often as too far. Half of
 *           range discipline is walking *backwards* to the edge, and a drill
 *           that only ever spawns things out of reach never teaches it.
 *   DRIFT   The mark moves — across you, away from you, at you. A distance you
 *           can only judge against something standing still is not a skill you
 *           own yet.
 *   TRADE   It shoots back, from a shorter range than yours. Now every unit of
 *           depth is paid for in health, which is exactly the currency it is
 *           paid for in during a game.
 *   SHIFT   Your reach changes every rep and you are told the new number and
 *           nothing else. This is the stage that proves the skill generalises:
 *           if you can only find 545, you have memorised a screen distance
 *           rather than learnt to convert a range into a piece of ground.
 *
 * After SHIFT it cycles back to STEP with a tighter tolerance, so a long
 * SURVIVE run keeps asking a harder version of the same question.
 */

type Phase = 'mark' | 'step' | 'drift' | 'trade' | 'shift';

interface PhaseSpec {
  id: Phase;
  name: string;
  /** The line the banner announces it with. */
  line: string;
  /** Reps before moving on. */
  reps: number;
  /** Checks in this phase are not charged against the run. */
  freeChecks: boolean;
  /** The mark survives the rep and keeps fighting, rather than popping. */
  persistent: boolean;
  /** What a rep in this phase is worth, relative to one in MARK. */
  worth: number;
}

const PHASES: PhaseSpec[] = [
  {
    id: 'mark',
    name: 'MARK',
    line: 'CALIBRATE · CHECKS ARE FREE',
    reps: 3,
    freeChecks: true,
    persistent: false,
    worth: 0.8,
  },
  { id: 'step', name: 'STEP', line: 'TOO CLOSE OR TOO FAR · WALK TO THE EDGE', reps: 3, freeChecks: false, persistent: false, worth: 1 },
  { id: 'drift', name: 'DRIFT', line: 'IT MOVES · HOLD THE EDGE', reps: 3, freeChecks: false, persistent: false, worth: 1.15 },
  { id: 'trade', name: 'TRADE', line: 'IT SHOOTS BACK · DEPTH COSTS HEALTH', reps: 4, freeChecks: false, persistent: true, worth: 1.3 },
  { id: 'shift', name: 'SHIFT', line: 'YOUR REACH CHANGES · READ THE NUMBER', reps: 4, freeChecks: false, persistent: false, worth: 1.45 },
];

/** How a rep ended. */
type Verdict = 'edge' | 'deep' | 'walked' | 'missed';

interface Rep {
  phase: Phase;
  verdict: Verdict;
  /**
   * Units of error, signed the way the mistake is signed: positive is inside
   * your own edge (deep), negative is short of it (the order you could not
   * take). Zero for a rep that never produced a number.
   */
  err: number;
  /** The reach this rep was played at — SHIFT changes it every time. */
  reach: number;
  /** A check was spent between this rep starting and ending. */
  checked: boolean;
  /** The ring was still on the floor at the moment of the shot. */
  ringUp: boolean;
  worth: number;
}

/** What the arena draws for the second after a rep resolves. */
interface Mark {
  at: Vec2;
  from: Vec2;
  /** The circle you should have been standing on. */
  edge: number;
  err: number;
  verdict: Verdict;
  life: number;
}

/** The reaches a SHIFT rep can hand you, as offsets from the champion's own. */
const SHIFT_OFFSETS = [-135, -80, -40, 65, 105, 150];

export class RangeDrill extends Drill {
  /** The champion's own reach, before any shift. */
  private baseReach = 545;
  private phaseIndex = 0;
  private repsInPhase = 0;
  private reps: Rep[] = [];

  /** The mark this rep is asking about, and the rep's own clock. */
  private mark: Actor | null = null;
  private window = 0;
  private repChecked = false;
  private repWalked = false;
  /** How short the order was, for a rep the champion walked in on. */
  private walkShort = 0;
  private resolved = false;
  /** Seconds of dead air between one rep resolving and the next starting. */
  private gap = 0;
  private verdicts: Mark[] = [];

  /** Where the mark is being driven this rep, for the moving phases. */
  private driftKind: 'lateral' | 'away' | 'in' = 'lateral';
  private driftDir = 1;
  private driftGoal: Vec2 = { x: 0, y: 0 };

  private checksAtRepStart = 0;
  private lastAnnouncedReach = 0;
  /** Checks spent inside a phase that hands them out free. Never charged. */
  private freeChecksSpent = 0;

  // ---------------------------------------------------------------- setup

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.62 });
    this.baseReach = p.attack.range;
    this.lastAnnouncedReach = p.attack.range;
    // Health is the running cost of shooting from too deep once something is
    // shooting back. It is not a fail state in PLAY: a minute of standing a
    // body-length too close should cost most of a bar, not the run.
    p.maxHp = 1000;
    p.hp = 1000;
  }

  onStart(): void {
    this.s.setBanner(`${PHASES[0].name} · ${PHASES[0].line}`, 2.2);
    this.beginRep();
  }

  /**
   * The phase this rep belongs to.
   *
   * MARK happens once. It is where a player finds out what their reach looks
   * like on the floor, and a run long enough to come back round to it does not
   * need telling twice — so every lap after the first starts at STEP.
   */
  private get phase(): PhaseSpec {
    if (this.phaseIndex < PHASES.length) return PHASES[this.phaseIndex];
    return PHASES[1 + ((this.phaseIndex - PHASES.length) % (PHASES.length - 1))];
  }

  /** How many passes through the phase list this run has made. */
  private get lap(): number {
    if (this.phaseIndex < PHASES.length) return 0;
    return 1 + Math.floor((this.phaseIndex - PHASES.length) / (PHASES.length - 1));
  }

  /** Checks the run is actually charged for — MARK's are on the house. */
  private get chargedChecks(): number {
    return Math.max(0, this.s.rangeChecks - this.freeChecksSpent);
  }

  /**
   * How close to the edge counts as *on* it.
   *
   * A champion is sixty units across, so the opening tolerance is about a body
   * — tight enough that it cannot be hit by accident, loose enough that a
   * player who genuinely knows the distance clears it. Difficulty tightens it,
   * and so does every lap through the phases, because the second time a mode
   * asks a question it should be asking a harder one.
   */
  private get tolerance(): number {
    return Math.max(18, 58 - this.s.liveDifficulty * 24 - this.lap * 8);
  }

  /** The reach the champion is playing at right now. */
  private get reach(): number {
    return this.s.world.player?.attack.range ?? this.baseReach;
  }

  /** Seconds a rep is allowed to take. */
  private get repWindow(): number {
    const base = this.phase.id === 'mark' ? 7 : 5.6;
    return Math.max(3, base - this.s.liveDifficulty * 1.6 - this.lap * 0.3);
  }

  // ------------------------------------------------------------------ reps

  private beginRep(): void {
    const p = this.s.world.player;
    if (!p) return;
    const spec = this.phase;

    // SHIFT hands you a different champion every rep, announced as a number
    // and nothing else. Everywhere else the reach is the champion's own.
    if (spec.id === 'shift') {
      const off = SHIFT_OFFSETS[this.s.rng.int(0, SHIFT_OFFSETS.length)];
      p.attack.range = Math.max(240, this.baseReach + off);
    } else if (p.attack.range !== this.baseReach) {
      p.attack.range = this.baseReach;
    }
    if (p.attack.range !== this.lastAnnouncedReach) {
      this.lastAnnouncedReach = p.attack.range;
      this.s.setBanner(`REACH ${Math.round(p.attack.range)}`, 1.4);
      this.s.micro(`REACH ${Math.round(p.attack.range)}`, p.pos, PALETTE.violet);
      audio.play('tick');
    }

    // Whatever is left over from the last rep goes, the persistent duellist
    // aside. A mark that outlived its own shot would be a second thing on the
    // floor for the next rep to be measured against.
    for (const e of this.s.world.enemies()) {
      if (spec.persistent && this.mark && e.id === this.mark.id) continue;
      e.alive = false;
    }
    if (!spec.persistent || !this.mark || !this.mark.alive) this.placeMark();

    this.window = this.repWindow;
    this.repChecked = false;
    this.repWalked = false;
    this.walkShort = 0;
    this.resolved = false;
    this.checksAtRepStart = this.s.rangeChecks;
  }

  /**
   * Where the next mark stands.
   *
   * Never on the edge, and never at a distance the last one used: the rep is
   * "move to the edge", so a mark that spawned where you already are would be
   * asking you to do nothing. The offsets are in units of *your* reach so the
   * question is the same shape whatever SHIFT has just done to it.
   */
  private placeMark(): void {
    const p = this.s.world.player;
    if (!p) return;
    const { w, h } = this.s.world.bounds;
    const reach = this.reach;
    const spec = this.phase;

    // Out of reach, or already inside it. STEP and later spawn both, because
    // stepping *out* to the edge is half the skill and no drill that only
    // spawns things at a distance ever asks for it.
    const inside = spec.id !== 'mark' && this.s.rng.next() < 0.42;
    const offset = inside
      ? -this.s.rng.range(120, Math.min(reach - 90, 360))
      : this.s.rng.range(140, 460 + this.s.liveDifficulty * 160);
    const want = clamp(reach + offset, 150, Math.min(w, h) * 0.9);

    // An angle that keeps the mark on the floor with room behind it, so a
    // player backing off to their edge is never backing into a wall.
    let best: Vec2 | null = null;
    let bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const a = this.s.rng.angle();
      const at = { x: p.pos.x + Math.cos(a) * want, y: p.pos.y + Math.sin(a) * want };
      if (at.x < 140 || at.x > w - 140 || at.y < 140 || at.y > h - 140) continue;
      // Room behind the player, measured along the same line: this is the
      // ground a "too close" rep needs.
      const back = {
        x: p.pos.x - Math.cos(a) * 360,
        y: p.pos.y - Math.sin(a) * 360,
      };
      const room = Math.min(back.x, w - back.x, back.y, h - back.y);
      if (room > bestScore) {
        bestScore = room;
        best = at;
      }
    }
    const at = best ?? { x: clamp(p.pos.x + want, 140, w - 140), y: clamp(p.pos.y, 140, h - 140) };

    if (spec.persistent) {
      // TRADE is one opponent for the whole phase — a duel, in which every
      // attack you take is a rep. Its reach is shorter than yours by design:
      // without that gap there is no edge worth finding.
      const e = this.spawnEnemy('ranger', at, {
        hpScale: 6,
        behavior: 'tether',
        anchor: at,
        leash: 700,
      });
      e.attack.range = Math.max(200, this.reach - 150 - this.s.liveDifficulty * 60);
      e.attack.damage = 24;
      e.moveSpeed = 190 + this.s.liveDifficulty * 90;
      e.label = 'TRADER';
      const brain = this.lastBrain;
      if (brain) brain.preferredRange = e.attack.range - 40;
      this.mark = e;
    } else {
      // An inert mark with one point of health: the rep is the shot, so the
      // mark's job is to be somewhere and then stop being there.
      this.mark = this.s.world.spawnActor({
        pos: at,
        team: 'enemy',
        maxHp: 1,
        radius: 30,
        moveSpeed: 0,
        label: 'MARK',
        attack: { attackSpeed: 0.01, windupRatio: 0.3, backswingRatio: 0.3, range: 0, damage: 0, projectileSpeed: 0 },
      });
    }

    if (spec.id === 'drift') {
      const roll = this.s.rng.next();
      this.driftKind = roll < 0.45 ? 'lateral' : roll < 0.75 ? 'away' : 'in';
      this.driftDir = this.s.rng.next() < 0.5 ? 1 : -1;
      this.mark.moveSpeed = 150 + this.s.liveDifficulty * 130;
    }

    this.s.fx.ring(at.x, at.y, 8, 74, 0.4, PALETTE.warn, 2.5, 'pulse');
    audio.play('tick');
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    this.updateBrains(dt);
    for (const v of this.verdicts) v.life -= dt;
    if (this.verdicts.length && this.verdicts[0].life <= 0) this.verdicts.shift();

    if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.beginRep();
      return;
    }

    const p = this.s.world.player;
    const mark = this.mark;
    if (!p || !mark) return;

    if (this.phase.id === 'drift' && mark.alive) this.driveDrift(mark, p);

    this.window -= dt;
    if (!this.resolved && this.window <= 0) this.resolve('missed', 0);
  }

  /**
   * The moving mark.
   *
   * Three patterns rather than a brain, because a rep is four seconds long and
   * what is being trained is holding a distance against a *legible* motion.
   * An opponent making its own decisions is the TRADE phase's job.
   */
  private driveDrift(mark: Actor, p: Actor): void {
    const away = norm(mark.pos.x - p.pos.x, mark.pos.y - p.pos.y);
    const side = { x: -away.y, y: away.x };
    const { w, h } = this.s.world.bounds;
    let dir: Vec2;
    if (this.driftKind === 'lateral') dir = { x: side.x * this.driftDir, y: side.y * this.driftDir };
    else if (this.driftKind === 'away') dir = away;
    else dir = { x: -away.x, y: -away.y };

    this.driftGoal = {
      x: clamp(mark.pos.x + dir.x * 400, 120, w - 120),
      y: clamp(mark.pos.y + dir.y * 400, 120, h - 120),
    };
    // Bounce off the floor edges rather than grinding along them.
    if (
      this.driftKind === 'lateral' &&
      (mark.pos.x < 170 || mark.pos.x > w - 170 || mark.pos.y < 170 || mark.pos.y > h - 170)
    ) {
      this.driftDir *= -1;
    }
    mark.order = { kind: 'move', pos: this.driftGoal };
  }

  // ---------------------------------------------------------------- events

  /**
   * An attack order landing on the mark.
   *
   * Under the click scheme this is the whole mistake the mode is built to
   * catch: ordering an attack you cannot take hands the decision to the
   * pathfinder, which walks you forward until it *is* takeable — so the shot
   * that follows says nothing about your judgement and the walk itself is what
   * gets people killed. The rep is void.
   *
   * Under WASD an order cannot move you, so there is nothing to void: you will
   * walk yourself in with the keys and the shot will be taken exactly where
   * you chose to stop, which is the number this mode wants anyway.
   */
  onTargetOrder(a: Actor): void {
    if (this.resolved || !this.mark || a.id !== this.mark.id) return;
    const p = this.s.world.player;
    if (!p) return;
    const gap = dist(p.pos, a.pos) - a.radius;
    if (gap <= p.attack.range) return;
    if (this.s.scheme !== 'click') return;
    this.repWalked = true;
    this.walkShort = Math.max(this.walkShort, gap - p.attack.range);
  }

  onRangeCheck(): void {
    if (this.phase.freeChecks) this.freeChecksSpent++;
    if (this.resolved) return;
    this.repChecked = true;
  }

  onEvents(events: readonly WorldEvent[]): void {
    const p = this.s.world.player;
    if (!p) return;
    for (const e of events) {
      if (e.type !== 'attackStart' || e.actorId !== this.s.world.playerId) continue;
      if (this.resolved || !this.mark) continue;
      if (e.targetId !== undefined && e.targetId !== this.mark.id) continue;
      // The windup is where the decision is: the champion is rooted from here
      // until the shot leaves, so this is the ground the player chose.
      const gap = dist(p.pos, this.mark.pos) - this.mark.radius;
      const err = p.attack.range - gap;
      if (this.repWalked) this.resolve('walked', -this.walkShort);
      else this.resolve(err <= this.tolerance ? 'edge' : 'deep', err);
    }
  }

  // -------------------------------------------------------------- resolving

  private resolve(verdict: Verdict, err: number): void {
    const p = this.s.world.player;
    if (!p || this.resolved) return;
    this.resolved = true;
    const spec = this.phase;
    const mark = this.mark;

    this.reps.push({
      phase: spec.id,
      verdict,
      err,
      reach: p.attack.range,
      checked: this.repChecked || this.s.rangeChecks > this.checksAtRepStart,
      ringUp: this.s.rangeVisible,
      worth: spec.worth,
    });

    if (mark) {
      this.verdicts.push({
        at: { ...mark.pos },
        from: { ...p.pos },
        edge: p.attack.range + mark.radius,
        err,
        verdict,
        life: verdict === 'missed' ? 0.8 : 1.5,
      });
    }

    switch (verdict) {
      case 'edge':
        this.s.chain++;
        this.s.chainBest = Math.max(this.s.chainBest, this.s.chain);
        audio.setComboPitch(this.s.chain);
        audio.play('pickup');
        this.s.micro('EDGE', p.pos, PALETTE.good);
        this.s.fx.ring(p.pos.x, p.pos.y, p.radius + 6, p.radius + 48, 0.4, PALETTE.good, 2.5, 'pulse');
        break;
      case 'deep':
        this.s.chain = 0;
        audio.setComboPitch(0);
        this.s.micro(`${Math.round(err)}u DEEP`, p.pos, err > this.tolerance * 3 ? PALETTE.danger : PALETTE.warn);
        if (err > DEEP_STRIKE) this.s.strike('TOO DEEP');
        break;
      case 'walked':
        this.s.chain = 0;
        audio.setComboPitch(0);
        audio.play('attackCancel');
        this.s.micro('WALKED IN', p.pos, PALETTE.danger);
        this.s.strike('WALKED IN');
        break;
      case 'missed':
        this.s.chain = 0;
        audio.setComboPitch(0);
        this.s.micro('NO SHOT', p.pos, PALETTE.textDim);
        this.s.strike('NO SHOT');
        break;
    }

    // A mark that survived its rep — the TRADE duellist — stays. Anything else
    // has done its job by being somewhere, and the next rep needs new ground.
    if (mark && !spec.persistent && mark.alive && verdict !== 'edge' && verdict !== 'deep') {
      mark.alive = false;
    }
    if (!spec.persistent) this.mark = null;

    this.repsInPhase++;
    if (this.repsInPhase >= spec.reps) {
      this.repsInPhase = 0;
      this.phaseIndex++;
      // Leaving TRADE dismisses the duellist rather than dragging it into a
      // phase whose reps are about a stationary mark.
      if (spec.persistent && this.mark) {
        this.mark.alive = false;
        this.mark = null;
      }
      const next = this.phase;
      this.s.setBanner(`${next.name} · ${next.line}`, 2);
      audio.play('uiTab');
    }
    this.gap = verdict === 'missed' ? 0.5 : 0.9;
  }

  // ----------------------------------------------------------------- paint

  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    const mark = this.mark;

    // The live rep draws the mark and the clock on it — and nothing at all
    // about distance. The distance is the question.
    if (p && mark && mark.alive && !this.resolved) {
      out.billboards.push({ kind: 'caret', x: mark.pos.x, y: mark.pos.y, color: PALETTE.warn });
      out.billboards.push({
        kind: 'timerBar',
        x: mark.pos.x,
        y: mark.pos.y,
        progress: clamp(this.window / Math.max(0.01, this.repWindow), 0, 1),
        color: this.window < 1.4 ? PALETTE.danger : PALETTE.warn,
        width: 76,
      });
      out.markers.push({
        kind: 'ring',
        x: mark.pos.x,
        y: mark.pos.y,
        radius: mark.radius + 12 + Math.sin(t * 6) * 2,
        color: PALETTE.warn,
        alpha: 0.5,
        width: 3,
        rise: 2.2,
      });
    }

    // The answer, once the shot is committed and not before: the circle you
    // should have been standing on, where you actually were, and by how much.
    for (const v of this.verdicts) {
      const fade = clamp(v.life / 0.5, 0, 1);
      const col =
        v.verdict === 'edge' ? PALETTE.good : v.verdict === 'walked' || v.verdict === 'missed' ? PALETTE.danger : PALETTE.warn;
      out.markers.push({
        kind: 'ring',
        x: v.at.x,
        y: v.at.y,
        radius: v.edge,
        color: v.verdict === 'edge' ? PALETTE.good : PALETTE.accent,
        alpha: 0.5 * fade,
        width: 3.5,
        dash: 56,
        rise: 1.8,
      });
      if (v.verdict !== 'missed') {
        out.markers.push({
          kind: 'line',
          x: v.from.x,
          y: v.from.y,
          x2: v.at.x,
          y2: v.at.y,
          halfWidth: 2,
          color: col,
          alpha: 0.45 * fade,
          rise: 1.6,
        });
        out.markers.push({
          kind: 'cross',
          x: v.from.x,
          y: v.from.y,
          radius: 22,
          color: col,
          alpha: 0.7 * fade,
          width: 2.5,
          rise: 2,
        });
      }
      out.billboards.push({
        kind: 'label',
        x: (v.from.x + v.at.x) / 2,
        y: (v.from.y + v.at.y) / 2,
        text: labelFor(v),
        color: col,
        size: 16,
        sub: v.verdict === 'walked' ? 'the game moved you' : undefined,
      });
    }
  }

  // ------------------------------------------------------------------- hud

  /**
   * The reps the run is judged on.
   *
   * MARK is not one of them. It is the calibration phase — it hands out free
   * checks and invites you to use them — and a phase that tells you to look at
   * the ring cannot then be scored on how well you did without looking.
   */
  private get scored(): Rep[] {
    return this.reps.filter((r) => r.phase !== 'mark');
  }

  private get landed(): Rep[] {
    return this.scored.filter((r) => r.verdict === 'edge' || r.verdict === 'deep');
  }

  private get meanErr(): number {
    const l = this.landed;
    if (l.length === 0) return 0;
    return l.reduce((a, b) => a + Math.abs(b.err), 0) / l.length;
  }

  /** Reps taken with no check spent on them — the only ones that prove anything. */
  private get blind(): Rep[] {
    return this.landed.filter((r) => !r.checked && !r.ringUp);
  }

  /**
   * The mode's headline, and the reason it is a share of *every* rep rather
   * than only of the unchecked ones.
   *
   * "How accurate were you when you did not check" is trivially gamed by
   * checking almost every time and letting the two or three reps you happened
   * not to check carry the number. What matters is how much of your shooting
   * was both unchecked and right — a player who checks before every shot has
   * proved nothing about their range knowledge, and this says so.
   */
  private get blindShare(): number {
    const l = this.landed;
    if (l.length === 0) return 0;
    return this.blind.filter((r) => r.verdict === 'edge').length / l.length;
  }

  hudFields(): HudField[] {
    const l = this.landed;
    const perfect = l.filter((r) => r.verdict === 'edge').length;
    const acc = l.length ? perfect / l.length : 0;
    const err = this.meanErr;
    const charged = this.chargedChecks;
    return [
      {
        label: 'BLIND EDGE',
        value: `${this.blind.filter((r) => r.verdict === 'edge').length}/${this.scored.length}`,
        bar: this.blindShare,
        tone: acc > 0.7 ? 'good' : acc > 0.4 ? 'warn' : 'bad',
      },
      {
        label: 'AVG ERROR',
        value: l.length ? `${Math.round(err)}u` : '—',
        tone: err < this.tolerance ? 'good' : err < this.tolerance * 2.5 ? 'warn' : 'bad',
      },
      {
        label: 'CHECKS',
        value: this.phase.freeChecks ? `${charged} · FREE` : `${charged}`,
        tone: charged <= Math.max(2, this.scored.length * 0.25) ? 'good' : 'warn',
      },
      { label: 'PHASE', value: this.phase.name, tone: 'neutral' },
    ];
  }

  /**
   * The phase your error is worst in, if one stands out.
   *
   * Measured against the *other* phases rather than against the run, so a mode
   * that spent half its reps in one phase cannot be dragged into blaming it.
   */
  private worstPhase(): { phase: Phase; err: number } | null {
    const l = this.landed;
    let out: { phase: Phase; err: number } | null = null;
    for (const spec of PHASES) {
      if (spec.id === 'mark') continue;
      const here = l.filter((r) => r.phase === spec.id);
      if (here.length < 3) continue;
      const e = here.reduce((a, b) => a + Math.abs(b.err), 0) / here.length;
      if (!out || e > out.err) out = { phase: spec.id, err: e };
    }
    return out;
  }

  liveScore(): number {
    let total = 0;
    for (const r of this.reps) {
      // A rep read off the ring is worth less than half of one taken blind.
      // Not zero: checking and then getting it right is how a player learns
      // the distance in the first place, and MARK is built out of exactly that.
      const factor = r.phase === 'mark' ? 1 : r.checked || r.ringUp ? 0.42 : 1;
      switch (r.verdict) {
        case 'edge':
          total += 900 * r.worth * factor;
          break;
        case 'deep':
          total += Math.max(0, 780 - Math.abs(r.err) * 5) * r.worth * factor;
          break;
        case 'walked':
          total -= 420;
          break;
        case 'missed':
          total -= 220;
          break;
      }
    }
    return Math.max(0, Math.round(total));
  }

  outcome(): DrillOutcome {
    const scored = this.scored;
    const attempts = scored.length;
    const l = this.landed;
    const perfect = l.filter((r) => r.verdict === 'edge').length;
    const walked = scored.filter((r) => r.verdict === 'walked').length;
    const missed = scored.filter((r) => r.verdict === 'missed').length;
    const landRate = attempts ? l.length / attempts : 0;
    const calibration = l.length ? perfect / l.length : 0;
    const blind = this.blind;
    const blindShare = this.blindShare;
    const err = this.meanErr;
    // Signed, because *which way* you are wrong is the coachable part: a
    // player who is always deep and a player who is always short need
    // opposite advice, and an absolute average hides which one they are.
    const bias = l.length ? l.reduce((a, b) => a + b.err, 0) / l.length : 0;
    const checks = this.chargedChecks;
    const checksPerRep = attempts ? checks / attempts : 0;
    const shiftReps = l.filter((r) => r.phase === 'shift');
    const shiftErr = shiftReps.length
      ? shiftReps.reduce((a, b) => a + Math.abs(b.err), 0) / shiftReps.length
      : 0;

    const accuracy = l.length ? band(err, 200, 24) : 0;
    /**
     * Knowing a distance means landing on it *repeatedly*. Two shots on the
     * edge and two two hundred units deep average out to something that looks
     * like competence and is not — it is a coin, and the spread is what says
     * so. This is the term that separates a player from an accident.
     */
    const consistency = l.length > 2 ? band(stdev(l.map((r) => r.err)), 150, 28) : 0;
    const evidence = band(attempts, 1, 5);

    // Hygiene scales the run rather than adding to it. Not walking in and not
    // leaning on the ring are things you are supposed to do — paying points
    // for them is how a run that barely played could score half marks for the
    // mistakes it never got round to making.
    const cleanliness = 0.5 + 0.5 * band(walked / Math.max(1, attempts), 0.35, 0);
    const economy = 0.6 + 0.4 * band(checksPerRep, 1.1, 0.12);

    const performance = clamp(
      (blindShare * 0.44 + accuracy * 0.28 + consistency * 0.28) *
        (0.1 + 0.9 * landRate) *
        cleanliness *
        economy *
        evidence,
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (blindShare > 0.55 && blind.length > 3) {
      helped.push(
        `${Math.round(blindShare * 100)}% of every shot you took was on the edge and unchecked. That is the number this mode exists for.`,
      );
    }
    if (l.length > 3 && err < 40) helped.push(`Average error of ${Math.round(err)} units — under a body-length, all run.`);
    if (checks <= 2 && l.length > 6) {
      helped.push(`Six or more reps on ${checks} check${checks === 1 ? '' : 's'}. You are not reading the ring, you know the distance.`);
    }
    if (shiftReps.length > 2 && shiftErr < 70) {
      helped.push(`You held ${Math.round(shiftErr)} units of error even when the reach changed every rep — the skill is general, not memorised.`);
    }
    if (walked > 0) hurt.push(`${walked} attack order${walked === 1 ? '' : 's'} you could not take, so the champion walked you in. In a game that walk is the death.`);
    if (missed > 1) hurt.push(`${missed} reps closed with no shot in them.`);
    if (bias > 55) hurt.push(`You fire an average of ${Math.round(bias)} units inside your own edge. That is free ground handed to whoever is shorter-ranged than you.`);
    if (l.length > 3 && consistency < 0.45) {
      hurt.push('Your error swings from rep to rep. An average that good and a spread that wide is a coin landing well, not a distance you own.');
    }
    if (checksPerRep > 0.8 && attempts > 4) hurt.push(`${checksPerRep.toFixed(1)} range checks per rep — you are reading the ring rather than knowing the reach.`);
    if (shiftReps.length > 2 && shiftErr > err * 1.6) hurt.push('A changed reach undid you. You have learnt one distance rather than how to find one.');

    // Which phase you are worst at is the most actionable thing this mode
    // knows: the five of them are five different reasons a player misjudges a
    // distance, so naming the one that costs the most names the next hour of
    // practice. It is only said when there is a real gap between that phase
    // and the rest — a run that is uniformly good has nothing to fix.
    const worst = this.worstPhase();
    if (worst && worst.err > err * 1.5 && worst.err - err > 30) {
      hurt.push(`${PHASE_FAULT[worst.phase]} (${Math.round(worst.err)} units there against ${Math.round(err)} everywhere else).`);
    }

    const advice =
      walked > 1
        ? 'Walk to the edge, then attack. An attack order from out of range is a move order with extra steps, and it is the pathfinder choosing your position instead of you.'
        : bias > 70
          ? 'You are standing too close on purpose, and it feels safe because nothing has punished it yet. Take the same shot from a body-length further out — it is the same shot.'
          : checksPerRep > 0.8
            ? 'Spend your checks at the start of a rep, not at the end of it. Check once, commit to what you saw, and let the verdict tell you how far off you were.'
            : blindShare > 0.65
              ? 'Take this into SURVIVE, where the tolerance keeps tightening and the reach keeps changing.'
              : 'Fire, read the number, and correct on the next rep. Three reps of deliberate correction is worth an hour of guessing.';

    return {
      score: this.liveScore(),
      performance,
      axisPerformance: {
        spacing: performance,
        movement: clamp(landRate * 0.6 + (cleanliness - 0.5) * 0.8, 0, 1),
      },
      // The results screen leads with the first and prints the next four, so
      // the order is the order a player should read them in: what you can do
      // blind, how wrong you were, how often you were right, what it cost you
      // in checks, and how often you handed the decision to the pathfinder.
      keyMetrics: [
        pct('blindEdge', 'EDGE SHOTS TAKEN BLIND', blindShare),
        units('edgeErr', 'AVG EDGE ERROR', err),
        pct('calibration', 'SHOTS ON THE EDGE', calibration),
        count('checks', 'RANGE CHECKS SPENT', checks, 'lower'),
        count('walkedIn', 'ORDERS YOU COULD NOT TAKE', walked, 'lower'),
        units('edgeBias', 'AVG DEPTH INSIDE YOUR EDGE', Math.max(0, bias)),
        secs('repTime', 'SECONDS PER REP', attempts ? this.s.elapsed / attempts : 0, 'lower'),
      ],
      helped,
      hurt,
      advice,
    };
  }
}

/** Spread of a set of errors, in units. */
const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
};

/**
 * What being worst at a given phase actually means about your play.
 *
 * The phases are not five difficulties of one exercise, they are five separate
 * reasons a distance gets misjudged, so the diagnosis has to name the reason
 * rather than the phase.
 */
const PHASE_FAULT: Record<Phase, string> = {
  mark: 'Your calibration is off before anything else happens',
  step: 'You misjudge the walk itself — you know where the edge is and you do not stop on it',
  drift: 'A moving target undoes you. You are judging the distance once and then not updating it',
  trade: 'You collapse inward the moment something shoots back, which is exactly when depth costs the most',
  shift: 'A reach you have not played before is a reach you cannot find',
};

/** How deep a shot has to be before it is a defining mistake rather than a bad rep. */
const DEEP_STRIKE = 190;

const labelFor = (v: Mark): string => {
  switch (v.verdict) {
    case 'edge':
      return 'EDGE';
    case 'deep':
      return `${Math.round(v.err)}u DEEP`;
    case 'walked':
      return `${Math.round(Math.abs(v.err))}u SHORT`;
    case 'missed':
      return 'NO SHOT';
  }
};
