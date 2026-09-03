import { audio } from '../engine/audio';
import { Lane, RivalBrain, incomingDamage, pendingHits, sumPending, type PendingHit } from '../engine/lane';
import { clamp, dist } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { Actor } from '../engine/types';
import type { WorldEvent } from '../engine/world';
import { Drill, band, count, pct, type DrillOutcome } from './base';

/**
 * LAST HIT — a lane, not a metronome.
 *
 * Two waves walk into each other and fight. A turret behind each of them
 * shoots whatever comes into reach. An enemy laner stands opposite you doing
 * the same job you are. Your task is the one every game of League opens with:
 * take the killing blow on enemy minions, and take it with one attack.
 *
 * The design rule underneath all of it is that **no damage arrives from
 * nowhere**. Every point that lands on a minion was thrown by a body you can
 * watch wind up, at a target it picked by League's own priority rules. That is
 * not decoration — it is what makes the skill real. When health drains on a
 * timer the only readable habit is "click when the bar is short", and that
 * habit does not survive contact with a lane. When damage comes from
 * somewhere, four separate reads appear and all of them transfer:
 *
 *  - **Lead your attack.** Your windup plus your missile's flight is roughly a
 *    third of a second. The bar you are looking at is not the bar your arrow
 *    arrives at, and the plate on every minion shows you the difference.
 *  - **Count the turret.** A caster dies to one turret shot and one auto; a
 *    melee to two turret shots and one auto. Those numbers are exact here,
 *    which makes under-tower farming practisable rather than mystical.
 *  - **Don't touch the champion.** Auto the rival with the wave on you and six
 *    minions turn around, by the same targeting table League uses.
 *  - **Don't push for free.** Every attack you throw at a healthy minion shoves
 *    the wave and is scored as waste, because that is what it costs.
 */
export class LastHitDrill extends Drill {
  private lane!: Lane;
  private rival: RivalBrain | null = null;

  /** Attacks of yours that have landed on each enemy minion. */
  private hits = new Map<number, number>();
  /** Damage of yours spent on each enemy minion, for the waste ledger. */
  private spent = new Map<number, number>();

  private cs = 0;
  private gold = 0;
  private perfect = 0;
  private cannons = 0;
  private underTurret = 0;
  private missed = 0;
  private missedLate = 0;
  private missedEarly = 0;
  private missedToTurret = 0;
  private wastedDamage = 0;
  private wastedHits = 0;
  /** Every attack you have thrown at an enemy minion, landed or not. */
  private attacksThrown = 0;
  private rivalCs = 0;
  private minionHitsTaken = 0;
  private turretHitsTaken = 0;
  private taughtAggro = false;
  private taughtTurret = false;
  /** World time of the last hit you took, for out-of-combat regeneration. */
  private lastHurtAt = -99;
  /** Scratch buffer for the per-minion read; reused rather than reallocated. */
  private pending: PendingHit[] = [];

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.lane = new Lane(this.s.world, this.s.rng, { bounds: { w, h }, difficulty: this.d });
    this.s.world.spawnPlayer({ x: w * 0.4, y: h * 0.5 + 150 });
    // The rival is the difficulty step that changes the drill's shape rather
    // than its numbers: below it you are farming, above it you are laning.
    if (this.d >= 0.45) {
      this.rival = new RivalBrain(
        this.lane.spawnRival({ x: w * 0.62, y: h * 0.5 - 150 }),
        this.lane,
        this.s.rng,
        this.d,
      );
    }
  }

  private get d(): number {
    return this.s.config.difficulty;
  }

  /**
   * How much the drill draws for you.
   *
   * `full` marks the minion you can take and names the mistake; `marks` leaves
   * the health-bar plates — incoming damage and your own damage threshold —
   * but stops telling you to fire; `off` is a lane, with the bars League gives
   * you and nothing else. The read is the same at every level; only the help
   * with performing it goes away.
   */
  private get coach(): 'full' | 'marks' | 'off' {
    return this.d < 0.45 ? 'full' : this.d < 0.75 ? 'marks' : 'off';
  }

  update(dt: number): void {
    this.lane.update(dt);
    this.rival?.update(this.s.world, dt);
    this.regenerate(dt);

    for (const e of this.lane.drainEvents()) {
      if (e.kind === 'cannon') {
        this.s.setBanner(`WAVE ${e.wave} · CANNON`, 1.6);
        audio.play('announce', { intensity: 0.5 });
      }
    }
  }

  /**
   * Out-of-combat regeneration.
   *
   * Every champion in League has it, and without it a ninety-second lane
   * becomes a health-bar countdown: two poke trades early and the rest of the
   * run is spent unable to stand near the wave. Backing off, waiting, and
   * stepping back in is a lane skill in its own right, and it only exists if
   * stepping away actually buys something back.
   */
  private regenerate(dt: number): void {
    const p = this.s.world.player;
    if (!p || !p.alive || p.hp >= p.maxHp) return;
    if (this.s.world.time - this.lastHurtAt < 4) return;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.05 * dt);
  }

  // ------------------------------------------------------------- the read

  /**
   * Where a minion's health will be when an attack started right now lands,
   * and therefore whether it is yours.
   *
   * `lead` is honest about your own champion: if you are already mid-windup it
   * is the time left in that windup, otherwise it is a whole fresh one, plus
   * the missile's flight time over the current gap. Everything already thrown
   * by everyone else is subtracted. Your own committed damage is excluded —
   * asking "should I attack" while counting the attack you already made is how
   * you end up double-committing to a minion you had already secured.
   */
  private read(m: Actor, p: Actor): {
    incoming: number;
    hpAtLanding: number;
    hpSoon: number;
    mineInFlight: number;
    inRange: boolean;
  } {
    const cycle = 1 / Math.max(0.05, p.attack.attackSpeed);
    const gap = Math.max(0, dist(p.pos, m.pos) - m.radius);
    const travel = p.attack.projectileSpeed > 0 ? gap / p.attack.projectileSpeed : 0;
    const windup = p.phase === 'windup' && p.targetId === m.id ? p.phaseTime : cycle * p.attack.windupRatio;
    const lead = windup + travel;
    const hits = pendingHits(this.s.world, m, this.pending);
    const incoming = sumPending(hits, lead, { exclude: p.id });
    return {
      incoming,
      hpAtLanding: m.hp - incoming,
      // One attack-cycle further out: enough to say "this one is nearly
      // yours" without pretending to know what the lane will do next.
      hpSoon: m.hp - sumPending(hits, lead + 1.2, { exclude: p.id }),
      mineInFlight: sumPending(hits, Infinity, { only: p.id }),
      inRange: gap <= p.attack.range,
    };
  }

  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    const coach = this.coach;

    // The lane itself. The arena floor is generated terrain with no opinion
    // about where a lane is, and without a road drawn on it a wave walking
    // left to right reads as a brawl that happens to be in a line.
    out.markers.push({
      kind: 'line',
      x: this.lane.allyGate.x - 160,
      y: this.lane.laneY,
      x2: this.lane.enemyGate.x + 160,
      y2: this.lane.laneY,
      halfWidth: 156,
      color: PALETTE.textFaint,
      alpha: 0.16,
      fill: 1,
      rise: 0.4,
    });

    // Turret reach, always. A range you can only discover by being shot is not
    // a range you can play around, and both of these decide where the lane is
    // safe to stand in.
    for (const turret of [this.lane.allyTurret, this.lane.enemyTurret]) {
      const ally = turret.team === 'player';
      const inside = dist(p.pos, turret.pos) < turret.attack.range;
      const hot = !ally && inside;
      out.markers.push({
        kind: 'ring',
        x: turret.pos.x,
        y: turret.pos.y,
        radius: turret.attack.range,
        color: ally ? PALETTE.accentDim : PALETTE.danger,
        alpha: hot ? 0.34 + 0.16 * Math.sin(t * 6) : 0.085,
        width: hot ? 4 : 2,
        dash: 90,
        spin: ally ? 0.05 : -0.05,
      });
      // Whatever a turret is shooting gets a line drawn to it, because "where
      // is that damage coming from" should never take longer than a glance.
      const victim = this.s.world.byId(turret.targetId);
      if (victim?.alive && turret.phase === 'windup') {
        out.markers.push({
          kind: 'line',
          x: turret.pos.x,
          y: turret.pos.y,
          x2: victim.pos.x,
          y2: victim.pos.y,
          halfWidth: 3,
          color: ally ? PALETTE.accent : PALETTE.warn,
          alpha: 0.5,
          rise: 2,
        });
      }
    }

    for (const m of this.lane.enemyMinions()) {
      const r = this.read(m, p);
      const threshold = p.attack.damage / m.maxHp;
      const incomingShare = Math.min(m.hp / m.maxHp, r.incoming / m.maxHp);

      let tone: 'ready' | 'soon' | 'losing' | undefined;
      let note: string | undefined;
      if (r.mineInFlight > 0) {
        tone = 'ready';
        note = coach === 'off' ? undefined : 'IN FLIGHT';
      } else if (r.hpAtLanding <= 0) {
        tone = 'losing';
        note = coach === 'full' ? 'GONE' : undefined;
      } else if (r.hpAtLanding <= p.attack.damage) {
        tone = 'ready';
        note = coach === 'full' ? (r.inRange ? 'FIRE' : 'WALK UP') : undefined;
      } else if (r.hpSoon <= p.attack.damage) {
        tone = 'soon';
      }

      out.plates.push({
        actorId: m.id,
        // The damage-in-flight wash survives every coaching level, including
        // the one that claims to draw nothing. It is not a hint: those
        // missiles and windups are already on the screen, and aggregating them
        // onto the bar is legibility, not advice. The tick and the tone are
        // advice — they name the decision — so both go once the drill is
        // supposed to be handing you a lane rather than a lesson.
        incoming: incomingShare,
        threshold: coach === 'off' ? undefined : threshold,
        tone: coach === 'off' ? undefined : tone,
        note,
      });

      // The ground ring is the beginner's version of the same sentence, and it
      // is gone entirely by the time the drill stops holding your hand.
      if (coach === 'full' && tone === 'ready' && r.mineInFlight <= 0) {
        const pulse = 0.55 + 0.45 * Math.sin(t * 9);
        out.markers.push({
          kind: 'ring',
          x: m.pos.x,
          y: m.pos.y,
          radius: m.radius + 14 + pulse * 4,
          color: r.inRange ? PALETTE.good : PALETTE.warn,
          alpha: 0.5 + pulse * 0.4,
          width: 4,
          rise: 2.4,
        });
      }

      // A cannon is worth three ordinary minions and dies to nothing quickly.
      // Losing one is the single most expensive mistake available here, so it
      // is called out by name at every coaching level.
      if (m.unitKind === 'cannon') {
        out.billboards.push({ kind: 'caret', x: m.pos.x, y: m.pos.y, color: PALETTE.warn, lift: 190 });
      }
    }
  }

  // ---------------------------------------------------------------- events

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type === 'attackRelease' && e.actorId != null) {
        const a = this.s.world.byId(e.actorId);
        if (a?.unitKind === 'turret') this.lane.noteTurretShot(a.id);
        if (e.actorId === pid) {
          const t = this.s.world.byId(e.targetId);
          // Counted on release, not on landing: an attack you threw at a
          // minion that died before your arrow arrived still cost you the
          // whole attack timer, and pretending otherwise would reward the
          // habit this drill exists to remove.
          if (t?.isMinion && t.team === 'enemy') this.attacksThrown++;
        }
      }

      if (e.type === 'attackLand' && e.actorId === pid && e.targetId != null) {
        const t = this.s.world.byId(e.targetId);
        if (t?.isMinion && t.team === 'enemy') {
          this.hits.set(t.id, (this.hits.get(t.id) ?? 0) + 1);
          this.spent.set(t.id, (this.spent.get(t.id) ?? 0) + (e.amount ?? 0));
        }
      }

      if (e.type === 'damage' && e.targetId === pid) this.notePlayerHurt(e);
      if (e.type === 'death' && e.actorId != null) this.noteDeath(e, pid);
    }
  }

  /**
   * Everything that hits you in a lane has a name, and the two that matter are
   * consequences of your own last input. Saying so once, the first time each
   * happens, is worth more than any amount of post-run advice.
   */
  private notePlayerHurt(e: WorldEvent): void {
    const src = this.s.world.byId(e.actorId);
    const p = this.s.world.player;
    this.lastHurtAt = this.s.world.time;
    if (!src || !p) return;
    if (src.isMinion) {
      this.minionHitsTaken++;
      if (!this.taughtAggro) {
        this.taughtAggro = true;
        this.s.setBanner('MINION AGGRO · THEY ANSWER WHEN YOU TOUCH A CHAMPION', 2.6);
      }
    } else if (src.unitKind === 'turret') {
      this.turretHitsTaken++;
      if (!this.taughtTurret) {
        this.taughtTurret = true;
        this.s.setBanner('TURRET AGGRO · IT RAMPS EVERY SHOT', 2.6);
      }
    }
  }

  private noteDeath(e: WorldEvent, pid: number): void {
    const victim = this.s.world.byId(e.actorId);
    if (!victim?.isMinion || !e.pos) return;
    const killer = this.s.world.byId(e.targetId);

    // Your farm.
    if (victim.team === 'enemy') {
      const hits = this.hits.get(victim.id) ?? 0;
      if (e.byPlayer) {
        this.cs++;
        this.gold += victim.goldValue ?? 0;
        if (victim.unitKind === 'cannon') this.cannons++;
        if (dist(victim.pos, this.lane.allyTurret.pos) < this.lane.allyTurret.attack.range) this.underTurret++;
        audio.play('pickup', { intensity: 0.7, pan: this.s.panOf(victim.pos) });
        if (hits <= 1) {
          this.perfect++;
          this.s.chain++;
          this.s.chainBest = Math.max(this.s.chainBest, this.s.chain);
          audio.setComboPitch(this.s.chain);
          audio.play('perfect');
          this.s.micro(`PERFECT +${victim.goldValue ?? 0}`, victim.pos, PALETTE.good);
          this.s.fx.ring(victim.pos.x, victim.pos.y, 8, 90, 0.45, PALETTE.good, 3, 'impact');
        } else {
          this.wastedHits += hits - 1;
          this.s.micro(`+${victim.goldValue ?? 0} · ${hits} HITS`, victim.pos, PALETTE.warn);
        }
      } else {
        this.missed++;
        this.s.chain = 0;
        audio.setComboPitch(0);
        this.wastedDamage += this.spent.get(victim.id) ?? 0;
        if (killer?.unitKind === 'turret') this.missedToTurret++;
        // Which mistake was it? A committed attack that arrived too late is a
        // different habit from an attack thrown far too early, and telling
        // them apart in the moment is most of how you stop making either.
        // "Late" means *your* attack was already in the air when it died —
        // not that somebody's was. Getting this wrong would blame you for
        // every minion your own wave finished while you were looking away.
        const committed = incomingDamage(this.s.world, victim, 3, { only: pid }) > 0;
        if (committed) {
          this.missedLate++;
          this.s.micro('TOO LATE', victim.pos, PALETTE.danger);
        } else if (hits > 0) {
          this.missedEarly++;
          this.s.micro('TOO EARLY', victim.pos, PALETTE.danger);
        } else {
          this.s.micro(victim.unitKind === 'cannon' ? 'CANNON LOST' : 'MISSED CS', victim.pos, PALETTE.danger);
        }
        this.s.fx.ring(victim.pos.x, victim.pos.y, 8, 60, 0.35, PALETTE.danger, 2, 'impact');
      }
      this.hits.delete(victim.id);
      this.spent.delete(victim.id);
      return;
    }

    // Their farm. The rival taking one of your minions costs you nothing
    // directly — it is on the HUD because a lane you are losing on farm is
    // information, and because racing somebody is more interesting than
    // racing a clock.
    if (killer && this.rival && killer.id === this.rival.actor.id) this.rivalCs++;
  }

  // ------------------------------------------------------------------- hud

  hudFields(): HudField[] {
    const attempts = this.cs + this.missed;
    const acc = attempts > 0 ? this.cs / attempts : 1;
    const fields: HudField[] = [
      { label: 'CS', value: `${this.cs}`, tone: 'neutral' },
      {
        label: 'CS ACCURACY',
        value: `${Math.round(acc * 100)}%`,
        bar: acc,
        tone: acc > 0.9 ? 'good' : acc > 0.7 ? 'warn' : 'bad',
      },
      { label: 'PERFECT', value: `${this.perfect}`, tone: 'good' },
    ];
    if (this.rival) {
      const lead = this.cs - this.rivalCs;
      fields.push({
        label: 'RIVAL CS',
        value: `${this.rivalCs}`,
        tone: lead > 0 ? 'good' : lead < 0 ? 'bad' : 'neutral',
      });
    } else {
      fields.push({ label: 'GOLD', value: `${this.gold}`, tone: 'neutral' });
    }
    return fields;
  }

  liveScore(): number {
    return Math.max(
      0,
      Math.round(
        this.gold * 24 +
          this.perfect * 400 +
          this.underTurret * 250 -
          this.missed * 300 -
          this.wastedHits * 90 -
          this.minionHitsTaken * 40 -
          this.turretHitsTaken * 150,
      ),
    );
  }

  outcome(): DrillOutcome {
    const attempts = this.cs + this.missed;
    const acc = attempts > 0 ? this.cs / attempts : 0;
    const perfectRate = this.cs > 0 ? this.perfect / this.cs : 0;
    const perMin = this.cs / Math.max(0.2, this.s.elapsed / 60);
    const volume = band(perMin, 4, 20);
    const wastePerCs = this.cs > 0 ? this.wastedHits / this.cs : 0;
    // The single most honest number in the drill: attacks thrown at minions,
    // divided by minions taken. A clean farmer sits at one. Anyone swinging at
    // the wave between last hits climbs, and climbing is what pushes a lane
    // you did not mean to push and empties the timer you needed a second later.
    const perCs = this.cs > 0 ? this.attacksThrown / this.cs : 0;
    const discipline = this.cs > 0 ? band(perCs, 2.6, 1.05) : 0;
    const safety = band(this.s.metrics.m.hpLost, 420, 0);
    // Nothing here can be farmed by standing still: every term that could be
    // scored by inaction is gated behind having actually taken minions.
    const engaged = clamp(this.cs / 8, 0, 1);

    const raw = acc * 0.4 + perfectRate * 0.2 + volume * 0.16 + discipline * 0.14 + safety * 0.1;
    const performance = clamp(raw * (0.3 + 0.7 * engaged), 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (acc > 0.9 && attempts > 8) helped.push(`${Math.round(acc * 100)}% of the enemy wave went to you.`);
    if (perfectRate > 0.7) helped.push('Most kills took exactly one attack — the wave stayed where you wanted it.');
    if (this.cannons > 0) helped.push(`${this.cannons} cannon minion${this.cannons > 1 ? 's' : ''} secured — 60 gold each.`);
    if (this.underTurret > 2) helped.push(`${this.underTurret} last hits taken under your own turret.`);
    if (this.rival && this.cs > this.rivalCs) helped.push(`You out-farmed the rival ${this.cs} to ${this.rivalCs}.`);

    if (this.missedLate > 2) hurt.push(`${this.missedLate} minions died with your attack already in the air — you started late.`);
    if (this.missedEarly > 2) hurt.push(`${this.missedEarly} minions you had already chipped were finished by your own wave.`);
    if (this.missedToTurret > 2) hurt.push(`${this.missedToTurret} went to your turret — under tower, the turret shoots first and you follow.`);
    if (perCs > 1.6)
      hurt.push(`${perCs.toFixed(1)} attacks per minion secured — you are hitting the wave between last hits, and that pushes it.`);
    if (wastePerCs > 0.6)
      hurt.push('Minions are taking two of your attacks to die, which means you are starting them too early.');
    if (this.wastedDamage > 400)
      hurt.push(`${Math.round(this.wastedDamage)} damage went into minions your own wave finished — that damage bought you nothing.`);
    if (this.minionHitsTaken > 6) hurt.push(`The wave hit you ${this.minionHitsTaken} times — that is minion aggro from touching a champion.`);
    if (this.turretHitsTaken > 0) hurt.push(`The enemy turret hit you ${this.turretHitsTaken} times, and every shot hurts more than the last.`);
    if (this.rival && this.rivalCs > this.cs) hurt.push(`The rival out-farmed you ${this.rivalCs} to ${this.cs}.`);

    const advice =
      this.missedLate > this.missedEarly && this.missedLate > 2
        ? 'Start the attack before the bar reaches your damage line: the windup and the arrow both take time, and the plate shows you exactly how much.'
        : this.missedEarly > 2
          ? 'Stop chipping healthy minions. Every early attack is damage your own wave was going to deal anyway, and it puts your timer on cooldown.'
          : wastePerCs > 0.6
            ? 'One attack per minion. If it takes two, you started too early — hold, and let the wave bring it into your window.'
            : perCs > 1.6
              ? 'One attack, one minion. Everything else you throw at the wave pushes it toward their turret and leaves your timer empty when the next minion drops.'
              : acc < 0.75
              ? 'Stand closer to the wave so the walk-up is not part of your reaction, and watch the hatched slice: that is damage already on its way.'
              : this.rival
                ? 'Raise the difficulty. The rival reacts faster and the waves come sooner — hold this accuracy against both.'
                : 'Raise the difficulty and take on a rival laner: the same farm, with somebody contesting it.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { lastHitting: performance, aim: clamp(acc, 0, 1) },
      // A lane with a rival in it is a harder run than its raw level implies.
      effectiveDifficulty: this.rival ? Math.min(1, this.d + 0.1) : undefined,
      keyMetrics: [
        pct('csAcc', 'CS ACCURACY', acc),
        count('perCs', 'ATTACKS PER CS', Math.round(perCs * 100) / 100, 'lower'),
        count('cs', 'MINIONS SECURED', this.cs),
        count('perfect', 'PERFECT LAST HITS', this.perfect),
        count('gold', 'GOLD EARNED', this.gold),
        count('missed', 'MISSED', this.missed, 'lower'),
        count('waste', 'WASTED ATTACKS', this.wastedHits, 'lower'),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
