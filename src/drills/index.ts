import type { Session } from '../engine/session';
import { AimDrill } from './aim';
import { ArenaDrill } from './arena';
import type { Drill } from './base';
import { DRILLS, type DrillId } from './catalog';
import { CombosDrill } from './combos';
import { DodgeDrill } from './dodge';
import { KiteDrill } from './kite';
import { LastHitDrill } from './lasthit';
import { MovementDrill } from './movement';
import { SkillshotDrill } from './skillshot';
import { SpacingDrill } from './spacing';
import { TargetSwitchDrill } from './targetswitch';

export const createDrill = (id: DrillId, session: Session): Drill => {
  switch (id) {
    case 'movement':
      return new MovementDrill(session);
    case 'aim':
      return new AimDrill(session);
    case 'skillshot':
      return new SkillshotDrill(session);
    case 'dodge':
      return new DodgeDrill(session);
    case 'kite':
      return new KiteDrill(session);
    case 'spacing':
      return new SpacingDrill(session);
    case 'lasthit':
      return new LastHitDrill(session);
    case 'targetswitch':
      return new TargetSwitchDrill(session);
    case 'combos':
      return new CombosDrill(session);
    case 'duel1v1':
      return new ArenaDrill(session, 1);
    case 'duel1v2':
      return new ArenaDrill(session, 2);
    case 'duel1v3':
      return new ArenaDrill(session, 3);
  }
};

/** Arena size per drill — combat wants room, aim wants a tight field. */
export const arenaFor = (id: DrillId): { w: number; h: number } => {
  switch (id) {
    case 'aim':
    case 'targetswitch':
      return { w: 1500, h: 900 };
    case 'lasthit':
      return { w: 1400, h: 900 };
    case 'duel1v2':
    case 'duel1v3':
      return { w: 1800, h: 1050 };
    default:
      return { w: 1660, h: 960 };
  }
};

export { DRILLS };
export type { Drill };
