import type { Session } from '../engine/session';
import { AimDrill } from './aim';
import { createApmDrill } from './apm';
import { createWasdDrill } from './wasd';
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
import { VayneBoltsDrill } from './vaynebolts';
import { VayneCondemnDrill } from './vaynecondemn';
import { VayneHuntDrill } from './vaynehunt';
import { VayneTumbleDrill } from './vaynetumble';

export const createDrill = (id: DrillId, session: Session): Drill => {
  // The APM trainer owns thirteen of the ids and builds them from one engine.
  const apm = createApmDrill(id, session);
  if (apm) return apm;
  // The academy owns nine more, all of them played on the keys.
  const wasd = createWasdDrill(id, session);
  if (wasd) return wasd;
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
    case 'vayneTumble':
      return new VayneTumbleDrill(session);
    case 'vayneBolts':
      return new VayneBoltsDrill(session);
    case 'vayneCondemn':
      return new VayneCondemnDrill(session);
    case 'vayneHunt':
      return new VayneHuntDrill(session);
    default:
      throw new Error(`unknown drill: ${id}`);
  }
};

/** Arena size per drill — combat wants room, aim wants a tight field. */
export const arenaFor = (id: DrillId): { w: number; h: number } => {
  switch (id) {
    case 'aim':
    case 'targetswitch':
      return { w: 1500, h: 900 };
    // The APM click modes want a field the cursor can cross without a camera
    // move; the movement modes want somewhere to run to.
    case 'apmAim':
    case 'apmAim2':
    case 'apmPrecision':
    case 'apmKeys':
      return { w: 1500, h: 900 };
    case 'apmAimMap':
      return { w: 1700, h: 1000 };
    case 'apmDodge':
    case 'apmDodgeCd':
    case 'apmKite':
    case 'apmDefKite':
    case 'apmSpacing':
      return { w: 1760, h: 1010 };
    case 'apmSmite':
      return { w: 1980, h: 1140 };
    // The lane is the drill: two gates, two turrets and enough room between
    // them for a wave to be pushed somewhere that matters. The APM lane modes
    // are the same lane, so they take the same floor.
    case 'lasthit':
    case 'apmLastHit':
    case 'apmLastHit2':
      return { w: 2100, h: 880 };
    case 'duel1v2':
    case 'duel1v3':
      return { w: 1800, h: 1050 };
    // The academy. The movement modules want somewhere to run to, the aiming
    // ones want a field the cursor can cross, and the last one wants a floor
    // big enough for two opponents and a telegraph at the same time.
    case 'wasdMove':
      return { w: 1900, h: 1100 };
    case 'wasdIndep':
    case 'wasdStrafe':
      return { w: 1820, h: 1050 };
    case 'wasdAimMove':
      return { w: 1700, h: 1000 };
    case 'wasdCadence':
    case 'wasdKite':
    case 'wasdOffKite':
    case 'wasdDefKite':
      return { w: 1780, h: 1020 };
    case 'wasdMulti':
      return { w: 1900, h: 1100 };
    // The Vayne arenas are wider than they are tall and larger than the duel
    // floor: condemn needs somewhere to throw people, and terrain eats space.
    case 'vayneCondemn':
    case 'vayneHunt':
      return { w: 1900, h: 1100 };
    case 'vayneBolts':
      return { w: 1720, h: 1000 };
    default:
      return { w: 1660, h: 960 };
  }
};

export { DRILLS };
export type { Drill };
