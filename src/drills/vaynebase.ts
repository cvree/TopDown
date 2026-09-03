import type { AbilitySlot } from '../engine/input';
import { dist } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { AbilityView, HudField } from '../engine/session';
import type { Actor, Vec2, Wall } from '../engine/types';
import { VAYNE_COLOR, VAYNE_STATS, VayneKit, type VayneLoadout } from '../engine/vayne';
import type { WorldEvent } from '../engine/world';
import { Drill } from './base';

/**
 * What every Vayne drill has in common.
 *
 * The champion, her kit, the terrain she needs, and the plumbing that lets the
 * kit see the frame. Each drill above this only has to describe what it wants
 * to happen and how it is scored.
 */
export abstract class VayneDrill extends Drill {
  readonly kit: VayneKit;

  constructor(s: import('../engine/session').Session, loadout: VayneLoadout) {
    super(s);
    this.kit = new VayneKit(s, loadout);
  }

  protected spawnVayne(pos: Vec2): Actor {
    return this.kit.spawn(pos);
  }

  /**
   * Terrain to condemn people into.
   *
   * Deliberately asymmetric and deliberately open. A ring of walls would mean
   * every angle has terrain behind it, which teaches nothing: the lesson is
   * that a wall is somewhere specific and you have to have walked to the right
   * side of it. So there are three, offset, with clear lanes between them —
   * roughly a third of the floor is a good place to fight and the rest is not.
   */
  protected placeWalls(): void {
    const { w, h } = this.s.world.bounds;
    const walls: Wall[] = [
      { x: w * 0.23, y: h * 0.36, w: 64, h: h * 0.4 },
      { x: w * 0.78, y: h * 0.62, w: 64, h: h * 0.4 },
      { x: w * 0.52, y: h * 0.2, w: w * 0.28, h: 64 },
    ];
    this.s.world.walls = walls;
  }

  /** Seconds the shot has been loaded with a key still down. */
  private holdAge = 0;
  private lastNudgeAt = -99;

  update(dt: number): void {
    this.kit.update(dt);
    this.nudgeHands(dt);
  }

  /**
   * The live half of the trigger read.
   *
   * The results screen can tell you afterwards that you held the keys through
   * a third of your shots; that is a diagnosis, not a fix. The fix is knowing
   * *while it is happening*, so a hold that outlasts a comfortable reaction
   * time says so on the floor, at most once every couple of seconds so it
   * stays a metronome rather than a scold. A player with clean hands never
   * sees it at all.
   */
  private nudgeHands(dt: number): void {
    if (this.s.scheme !== 'wasd') return;
    const p = this.s.world.player;
    if (!p || !p.alive || !p.moveDir || p.attackCd > 0 || p.phase === 'windup') {
      this.holdAge = 0;
      return;
    }
    const target = this.s.world.byId(p.targetId);
    if (!target || !target.alive || dist(p.pos, target.pos) - target.radius > p.attack.range) {
      this.holdAge = 0;
      return;
    }
    this.holdAge += dt;
    if (this.holdAge > 0.3 && this.s.world.time - this.lastNudgeAt > 2.5) {
      this.lastNudgeAt = this.s.world.time;
      this.s.micro('LET GO', p.pos, PALETTE.warn);
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    this.kit.onEvents(events);
    for (const e of events) if (e.type === 'death' && e.byPlayer) this.kit.onTakedown();
  }

  onAbility(slot: AbilitySlot, at: Vec2): void {
    this.kit.cast(slot, at);
  }

  abilities(): AbilityView[] {
    return this.kit.bar(super.abilities());
  }

  paint(out: DrillPaint, t: number): void {
    this.kit.paint(out, t, this.s.cursorWorld);
  }

  /** The bolt counter, shown the same way in every Vayne drill. */
  protected boltField(): HudField {
    const st = this.kit.stacks;
    return {
      label: 'SILVER BOLTS',
      value: `${st} / ${VAYNE_STATS.boltsPerProc}`,
      bar: st / VAYNE_STATS.boltsPerProc,
      tone: st === VAYNE_STATS.boltsPerProc - 1 ? 'good' : 'neutral',
    };
  }

  protected tumbleField(): HudField {
    const cd = this.kit.tumbleCd;
    return {
      label: 'TUMBLE',
      value: cd > 0 ? `${cd.toFixed(1)}s` : 'READY',
      bar: 1 - cd / this.kit.tumbleCdTotal,
      tone: cd > 0 ? 'warn' : 'good',
    };
  }

  // ------------------------------------------------------------- the hands

  /** True when this run is being driven with the keys rather than clicks. */
  protected get onKeys(): boolean {
    return this.s.scheme === 'wasd';
  }

  /**
   * Trigger discipline: how quickly the keys come up once the shot is loaded.
   *
   * It only exists under WASD, because it is only under WASD that the champion
   * refuses to shoot while you are still asking her to walk. A click player has
   * no equivalent mistake to make, so they are not shown a bar they cannot
   * move.
   */
  protected triggerField(): HudField | null {
    if (!this.onKeys) return null;
    const d = derive(this.s.metrics.m);
    return {
      label: 'TRIGGER',
      value: `${Math.round(d.triggerDelay)}ms`,
      bar: d.triggerDiscipline,
      tone: d.triggerDiscipline > 0.8 ? 'good' : d.triggerDiscipline > 0.55 ? 'warn' : 'bad',
    };
  }

  /**
   * The WASD-specific reads, folded into a drill's own verdict.
   *
   * Every Vayne drill scores identically under both schemes — that promise is
   * asserted headlessly and it is not negotiable. What differs is the *advice*:
   * the same lost attack is "you clicked through the windup" with a mouse and
   * "you never let go of the key" with a hand on the keys, and only one of
   * those two sentences is any use to the person reading it.
   */
  protected handsNotes(helped: string[], hurt: string[]): void {
    if (!this.onKeys) return;
    const m = this.s.metrics.m;
    const d = derive(m);
    const st = this.kit.stats;

    if (m.attacksStarted > 6 && d.triggerDiscipline > 0.88 && m.windupBreaks === 0) {
      helped.push('Clean hands: the keys came up the instant each shot was ready and never went down through a windup.');
    }
    if (st.tumbles > 3 && st.tumblesInward === 0) {
      helped.push(`All ${st.tumbles} tumbles went away from the fight rather than into it.`);
    }
    if (m.windupBreaks > 1) {
      hurt.push(`${m.windupBreaks} attack${m.windupBreaks === 1 ? '' : 's'} thrown away by pressing a direction during the windup.`);
    }
    if (d.triggerDelay > 90 && m.attacksStarted > 6) {
      hurt.push(`You held the keys ${Math.round(d.triggerDelay)}ms past every loaded shot — roughly ${(m.heldFire).toFixed(1)}s of standing there not shooting.`);
    }
    if (st.tumbles > 3 && st.tumblesInward > st.tumbles * 0.4) {
      hurt.push(`${st.tumblesInward} of ${st.tumbles} tumbles closed the gap instead of opening it — the dash followed your mouse.`);
    }
    if (st.tumblesBlocked > 1) {
      hurt.push(`${st.tumblesBlocked} tumbles ran out of room — a wall or the arena edge ate the distance.`);
    }
  }

  /**
   * The one WASD fix worth saying out loud, most expensive first, or null when
   * the hands are not the problem.
   */
  protected handsAdvice(): string | null {
    if (!this.onKeys) return null;
    const m = this.s.metrics.m;
    const d = derive(m);
    const st = this.kit.stats;
    if (m.windupBreaks > 1) {
      return 'Your keys are going down while the arrow is still on the string. Under WASD a held direction cancels a windup exactly as a click does — take the step after the shot leaves, not before.';
    }
    if (d.triggerDelay > 90 && m.attacksStarted > 6) {
      return 'You are holding the keys past the moment the shot is ready. She cannot fire while you are asking her to walk: let go on the beat, and the step you just took is free.';
    }
    if (st.tumbles > 3 && st.tumblesInward > st.tumbles * 0.4) {
      return 'Your tumbles are following the cursor into the fight. Under WASD the keys aim the dash — hold the direction you want to end up in before you press Q.';
    }
    return null;
  }

  /** A ring under the player in Vayne's colour, so she reads as herself. */
  protected paintSignature(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    out.markers.push({
      kind: 'ring',
      x: p.pos.x,
      y: p.pos.y,
      radius: p.radius + 12,
      color: this.kit.tumbleCd > 0 ? PALETTE.textFaint : VAYNE_COLOR,
      alpha: 0.4,
      width: 2,
      dash: 12,
      spin: 0.4 + Math.sin(t * 2) * 0.1,
      rise: 1.2,
    });
  }
}
