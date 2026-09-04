import type { Session } from '../../engine/session';
import type { Drill } from '../base';
import type { DrillId } from '../catalog';
import { WasdAimMoveDrill } from './aimmove';
import { WasdCadenceDrill } from './cadence';
import { WasdIndependenceDrill } from './independence';
import { WasdDefensiveKiteDrill, WasdKiteDrill, WasdOffensiveKiteDrill } from './kiting';
import { WasdMovementDrill } from './movement';
import { WasdMultiDrill } from './multi';
import { WasdStrafeDrill } from './strafe';

/** The academy's nine modules, in course order. */
export const WASD_DRILL_IDS = [
  'wasdMove',
  'wasdIndep',
  'wasdStrafe',
  'wasdAimMove',
  'wasdCadence',
  'wasdKite',
  'wasdOffKite',
  'wasdDefKite',
  'wasdMulti',
] as const;

export type WasdDrillId = (typeof WASD_DRILL_IDS)[number];

export const isWasdModule = (id: DrillId): id is WasdDrillId =>
  (WASD_DRILL_IDS as readonly string[]).includes(id);

/** Builds one module. Returns null for anything outside the academy. */
export const createWasdDrill = (id: DrillId, session: Session): Drill | null => {
  switch (id) {
    case 'wasdMove':
      return new WasdMovementDrill(session);
    case 'wasdIndep':
      return new WasdIndependenceDrill(session);
    case 'wasdStrafe':
      return new WasdStrafeDrill(session);
    case 'wasdAimMove':
      return new WasdAimMoveDrill(session);
    case 'wasdCadence':
      return new WasdCadenceDrill(session);
    case 'wasdKite':
      return new WasdKiteDrill(session);
    case 'wasdOffKite':
      return new WasdOffensiveKiteDrill(session);
    case 'wasdDefKite':
      return new WasdDefensiveKiteDrill(session);
    case 'wasdMulti':
      return new WasdMultiDrill(session);
    default:
      return null;
  }
};
