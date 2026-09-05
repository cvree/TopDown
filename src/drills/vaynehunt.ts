import { clamp, dist } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { ArchetypeId, Brush } from '../engine/types';
import { FIGHT_RANKS, VAYNE_COLOR, boltEfficiency, tumbleRhythm, wallRate } from '../engine/vayne';
import type { WorldEvent } from '../engine/world';
import { band, count, pct, secs, type DrillOutcome } from './base';
import { VayneDrill } from './vaynebase';

/**
 * NIGHT HUNTER — the whole champion at once.
 *
 * Tumble rhythm, bolt discipline, wall geometry and Final Hour, against two
 * opponents who move, cast, dodge and respect their cooldowns, in an arena
 * with terrain in it. Every earlier drill isolates one habit precisely because
 * this is where they all have to happen in the same four seconds.
 *
 * It is scored on the fight *and* on the kit: winning by standing still and
 * right-clicking is possible at low difficulty, and it is not what the mastery
 * ladder is willing to call a Vayne player.
 *
 * It is also the one mode with fog of war in it, and that is not decoration.
 * Every other mode hands you the fight; this one makes you find it. The map is
 * dark where you are not, terrain throws shadows you cannot see into, and
 * bushes hide whoever got there first — so the two things a Vayne actually
 * dies to, walking into an opponent you had not located and losing track of
 * the second one mid-kite, are things this mode can finally charge you for.
 * The habits that answer it are the ones the mode is for: hold your camera
 * where the danger is rather than on your own feet, read the minimap between
 * attacks, and use the bushes yourself — Final Hour out of a bush is the
 * strongest thing Vayne does, and you cannot practise it on a lit map.
 */
/**
 * How far anything in this mode sees.
 *
 * Shorter than League's champion sight in absolute units because this arena is
 * a fraction of League's map, and what has to transfer is the *ratio*: you see
 * about a screen's worth, the map is bigger than that, and the rest is a
 * question rather than a fact. Both teams get the same number — a fog that
 * only blinds one side is a handicap, not a mechanic.
 */
const HUNT_SIGHT = 760;

export class VayneHuntDrill extends VayneDrill {
  private killed = 0;
  /** Waves sent, and bodies in them. */
  private waves = 0;
  private spawned = 0;

  constructor(s: import('../engine/session').Session) {
    // The mid-game champion: Q maxed, points in W and E, one in R.
    super(s, { tumble: true, bolts: true, condemn: true, finalHour: true, ranks: FIGHT_RANKS });
  }

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.placeWalls();
    if (this.s.config.fogOfWar !== false) this.lightsOut();
    const p = this.spawnVayne({ x: w / 2, y: h * 0.78 });
    p.sight = HUNT_SIGHT;
    p.maxHp = 1080;
    p.hp = p.maxHp;
    this.sendWave();
  }

  /**
   * Bushes, and then the fog.
   *
   * Three of them, placed against the walls the mode already has rather than
   * scattered: a bush in the open is a hiding place, but a bush at the end of
   * a wall is a *decision*, because the shadow of the wall and the bush behind
   * it are the same piece of ground and you cannot check both from one angle.
   * One sits in the middle of the map, which is where the fight ends up, one
   * covers the approach on your own side, and one covers theirs — so both the
   * ambush and the escape have somewhere to happen.
   */
  private lightsOut(): void {
    const { w, h } = this.s.world.bounds;
    const brush: Brush[] = [
      { x: w * 0.5, y: h * 0.52, w: w * 0.2, h: h * 0.2 },
      { x: w * 0.14, y: h * 0.74, w: w * 0.15, h: h * 0.24 },
      { x: w * 0.87, y: h * 0.28, w: w * 0.15, h: h * 0.24 },
    ];
    this.s.world.brush = brush;
    this.s.world.enableVision();
  }

  /**
   * One that closes and one that pokes: the composition that forces every part
   * of the kit to be used for the thing it is for.
   *
   * In SURVIVE the arena is refilled rather than emptied — clearing it is what
   * earns you the next, larger wave, and the ramp adds a third body and then a
   * fourth as the run goes on. In PLAY it is called once and clearing the two
   * of them ends the run, which is the whole shape of that minute.
   */
  private sendWave(): void {
    const { w, h } = this.s.world.bounds;
    const melee: ArchetypeId[] = ['diver', 'duelist', 'juggernaut'];
    const ranged: ArchetypeId[] = ['ranger', 'artillery', 'controller'];
    const picks: ArchetypeId[] = [this.s.rng.pick(melee), this.s.rng.pick(ranged)];
    const extra = this.s.surviving ? Math.floor(this.s.pressure * 2 + 0.001) : 0;
    for (let i = 0; i < extra; i++) picks.push(this.s.rng.pick(i % 2 === 0 ? melee : ranged));
    picks.forEach((id, i) => {
      const spread = (i - (picks.length - 1) / 2) * 320;
      // Clear of the wall across the top of the map rather than inside its
      // footprint, which is where a wave used to land: a body shoved out of
      // terrain by the collision pass starts the fight in the one place the
      // fog can never be looked into from your own side.
      const a = this.spawnEnemy(id, { x: w / 2 + spread, y: h * 0.12 }, { hpScale: 0.62 });
      a.sight = HUNT_SIGHT;
      // The spawn flare is a position. In the fog it is a free one, so it is
      // only ever shown where you already had eyes.
      if (this.s.world.visible(a)) this.s.fx.ring(a.pos.x, a.pos.y, 10, 160, 0.7, PALETTE.danger, 3, 'shock');
      this.spawned++;
    });
    this.waves++;
  }

  onStart(): void {
    // Who is coming, never where from. In the fog the roster is the only free
    // information a Vayne gets, and it is the same information the loading
    // screen gives you in a real game.
    this.s.setBanner(this.s.world.enemies().map((e) => e.label ?? '').join('  ·  '), 1.8);
  }

  update(dt: number): void {
    super.update(dt);
    this.updateBrains(dt);

    // Clearing the floor is never the end of the run — the clock is, in PLAY,
    // and dying is, in SURVIVE. A minute that finishes in eleven seconds
    // because you won quickly is not a minute, and "how many did you get
    // through" is a better question than "did you get through two".
    if (this.s.world.enemies().length === 0) {
      this.sendWave();
      this.s.setBanner(`WAVE ${this.waves}`, 1.4);
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    super.onEvents(events);
    for (const e of events) {
      if (e.type !== 'death' || !e.byPlayer) continue;
      this.killed++;
      const left = this.s.world.enemies().length;
      if (left > 0) this.s.setBanner(`${left} LEFT`, 1);
      this.s.fx.addFlash(0.1, VAYNE_COLOR);
    }
  }

  paint(out: DrillPaint, t: number): void {
    super.paint(out, t);
    this.paintSignature(out, t);
    const p = this.s.world.player;
    if (!p) return;
    for (const e of this.s.world.enemies()) {
      const r = e.attack.range + p.radius;
      if (dist(p.pos, e.pos) >= r) continue;
      // Its threat circle is a thing you know because you can see it standing
      // there. Drawing one around a body in the fog would hand back the
      // position the fog just took.
      if (!this.s.world.visible(e)) continue;
      out.markers.push({
        kind: 'ring',
        x: e.pos.x,
        y: e.pos.y,
        radius: r,
        color: PALETTE.danger,
        alpha: 0.32 + 0.16 * Math.sin(t * 6),
        width: 3,
        dash: 54,
        spin: -0.2,
        rise: 1.8,
      });
    }
  }

  hudFields(): HudField[] {
    const fog = this.s.world.vision !== null;
    const held = this.s.visionNow;
    return [
      { label: 'ENEMIES', value: `${this.s.world.enemies().length}`, tone: 'neutral' },
      ...(fog
        ? [
            {
              // What share of them you currently have eyes on, and the one
              // word that matters when that share is zero.
              label: this.s.inCover ? 'HIDDEN' : 'VISION',
              value: this.s.inCover ? 'IN BRUSH' : held <= 0 ? 'BLIND' : `${Math.round(held * 100)}%`,
              bar: this.s.inCover ? 1 : held,
              tone: this.s.inCover ? 'good' : held <= 0 ? 'bad' : held < 0.6 ? 'warn' : 'good',
            } as HudField,
          ]
        : []),
      this.boltField(),
      // The trinket only earns a row where there is a fog for it to lift.
      ...(fog ? [this.wardField()] : []),
      ...(this.triggerField() ? [this.triggerField() as HudField] : []),
      {
        label: this.kit.inFinalHour ? 'FINAL HOUR' : 'ULTIMATE',
        value: this.kit.inFinalHour
          ? `${this.kit.hourLeft.toFixed(1)}s`
          : this.kit.hourCd > 0
            ? `${this.kit.hourCd.toFixed(0)}s`
            : 'READY',
        bar: this.kit.inFinalHour ? this.kit.hourLeft / 9 : 1 - clamp(this.kit.hourCd / 55, 0, 1),
        tone: this.kit.inFinalHour ? 'good' : this.kit.hourCd > 0 ? 'warn' : 'good',
      },
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? 1080);
    const st = this.kit.stats;
    const won = this.killed >= this.spawned;
    return Math.max(0, Math.round(
      m.damageDealt * 8 +
        st.boltProcs * 1200 +
        st.condemnWallStuns * 1400 +
        st.tumblesClean * 350 +
        this.killed * 5200 +
        (won ? 12000 : 0) +
        d.hpRetained * 6000 -
        st.tumblesWasted * 700,
    ));
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? 1080);
    const st = this.kit.stats;
    const won = m.survived && this.killed >= this.spawned - 2;

    const rhythm = tumbleRhythm(st);
    const bolts = boltEfficiency(st);
    const walls = st.condemnHits > 0 ? wallRate(st) : 0;
    // The kit term: were you playing Vayne, or an ADC who happens to have her
    // abilities? It is a third of the score, and it is the part the mastery
    // ladder cares about most.
    const kit = clamp(rhythm * 0.36 + bolts * 0.4 + walls * 0.24, 0, 1);

    // The vision term. Two halves, because holding vision and not being hit
    // out of the fog are different skills: the first is camera and map
    // discipline, the second is what you did with what you saw. A mode without
    // fog scores a flat one rather than being punished for a thing it never
    // asked of you.
    const fog = this.s.world.vision !== null;
    const ambushShare = m.hpLost > 0 ? clamp(this.s.unseenDamage / m.hpLost, 0, 1) : 0;
    const vision = fog ? clamp(this.s.visionUptime * 0.6 + (1 - ambushShare) * 0.4, 0, 1) : 1;

    const outcomeScore = won ? 1 : clamp(this.killed / Math.max(1, this.spawned), 0, 1) * 0.7;
    const survival = m.survived ? 1 : clamp(m.survivalTime / 45, 0, 0.85);
    const speed = band(this.killed / Math.max(1, this.s.elapsed / 60), 1.4, 6);

    const performance = clamp(
      outcomeScore * 0.26 +
        kit * 0.28 +
        d.hpRetained * 0.16 +
        survival * 0.1 +
        d.orbwalkEfficiency * 0.1 +
        speed * 0.04 +
        vision * 0.06,
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (won) helped.push(`${this.killed} down across ${this.waves} wave${this.waves === 1 ? '' : 's'}, with ${Math.round(d.hpRetained * 100)}% health left.`);
    if (bolts > 0.75) helped.push('Bolt discipline held up under fire — that is the hard version.');
    if (st.condemnWallStuns > 1) helped.push(`${st.condemnWallStuns} wall stuns in a live fight.`);
    if (st.finalHours > 0 && won) helped.push('Final Hour used and converted.');
    if (fog && this.s.visionUptime > 0.72) helped.push(`You held eyes on the fight ${Math.round(this.s.visionUptime * 100)}% of the run — that is camera work, not luck.`);
    if (fog && this.s.unseenHits === 0 && m.hitsTaken > 0) helped.push('Nothing hit you from a place you had not looked.');
    if (fog && st.wards > 2 && st.wardsIdle === 0)
      helped.push(`All ${st.wards} wards showed you somebody. That is vision spent on ground the fight was actually going to reach.`);
    if (fog && st.wards === 0)
      hurt.push('You never used the trinket. It comes back every twelve seconds here — a ward on the ground you are about to kite into is the cheapest information in the mode.');
    else if (fog && st.wardsIdle > 1 && st.wardsIdle >= st.wards - 1)
      hurt.push(`${st.wardsIdle} of your ${st.wards} wards burned down without lighting anybody. Ward where you are going, not where you have been.`);
    if (!m.survived) hurt.push(`You died at ${m.survivalTime.toFixed(1)}s.`);
    if (st.tumblesWasted > 1) hurt.push(`${st.tumblesWasted} tumbles thrown mid-windup under pressure.`);
    if (bolts < 0.55 && st.attacksLanded > 10) hurt.push('Your bolts fell apart in the fight — you switched targets on instinct.');
    if (fog && ambushShare > 0.3) hurt.push(`${Math.round(ambushShare * 100)}% of the damage you took came from something you had no vision of.`);
    if (fog && this.s.visionUptime < 0.45) hurt.push('You spent most of the fight with no eyes on it. Unlock the camera and put it where they are, not where you are.');
    if (st.finalHours === 0) hurt.push('Final Hour never came out. It is a fight-winning window, not an emergency button.');
    this.handsNotes(helped, hurt);

    const advice =
      this.handsAdvice() ??
      (!m.survived
      ? 'Use the terrain. Condemn the diver into a wall, then tumble away from the ranged one — do not trade with both at once.'
      : fog && ambushShare > 0.35
        ? 'You are being opened on from the dark. Check the bush before you walk past it — and stop kiting backwards into ground you have not looked at.'
        : fog && this.s.visionUptime < 0.5
        ? st.wards === 0
          ? 'Unlock the camera with Y and drive it — and drop a ward. The trinket is back every twelve seconds, and an eye on the ground you are about to fight over is vision you do not have to hold with your camera.'
          : 'Unlock the camera with Y and drive it. You cannot kite a champion you are not looking at, and the minimap only shows you what your champion can already see.'
        : bolts < 0.6
        ? 'Pick your target and finish three attacks on it. Switching mid-stack is why the fight is going long.'
        : st.finalHours === 0
          ? 'Open with Final Hour once they commit. The shorter tumble cooldown is what makes the fight unloseable.'
          : won && d.hpRetained > 0.7
            ? 'That is a complete Vayne. Raise the difficulty — this one has nothing left to teach you.'
            : 'Won it. Now win it without the health bar moving.');

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: {
        combat: performance,
        kiting: clamp(rhythm * 0.5 + d.orbwalkEfficiency * 0.5, 0, 1),
        targeting: clamp(bolts, 0, 1),
        dodging: clamp(band(m.hitsTaken / Math.max(1, this.s.elapsed / 10), 4, 0.3), 0, 1),
      },
      keyMetrics: [
        pct('hpLeft', 'HEALTH REMAINING', d.hpRetained),
        pct('kitScore', 'KIT EXECUTION', kit),
        count('kills', 'ENEMIES DOWN', this.killed),
        count('procs', 'BOLT PROCS', st.boltProcs),
        secs('fightTime', won ? 'TIME TO WIN' : 'SURVIVED', won ? this.s.elapsed : m.survivalTime, won ? 'lower' : 'higher'),
        ...(fog ? [pct('vision', 'VISION HELD', this.s.visionUptime)] : []),
        ...(fog ? [count('wards', 'WARDS PLACED', st.wards)] : []),
      ],
      helped,
      hurt,
      advice,
      // Two opponents plus a full kit to execute is more than the slider says.
      effectiveDifficulty: clamp(this.s.config.difficulty + 0.16, 0, 1),
    };
  }
}
