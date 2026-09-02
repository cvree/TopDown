import type { AbilitySlot } from '../engine/input';
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

  update(dt: number): void {
    this.kit.update(dt);
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
