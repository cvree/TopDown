import type { Session } from '../../engine/session';
import type { Drill } from '../base';
import type { DrillId } from '../catalog';
import { ApmAim2Drill, ApmAimDrill, ApmAimMapDrill, ApmPrecisionDrill } from './aim';
import { ApmDodgeCooldownDrill, ApmDodgeDrill } from './dodge';
import { ApmKeysDrill } from './keys';
import { ApmDefensiveKiteDrill, ApmKiteDrill } from './kite';
import { ApmLastHit2Drill, ApmLastHitDrill } from './lasthit';
import { ApmSmiteDrill } from './smite';
import { ApmSpacingDrill } from './spacing';

/** Every mode of the APM trainer, by id. */
export const APM_DRILL_IDS = [
  'apmAim',
  'apmAim2',
  'apmAimMap',
  'apmPrecision',
  'apmKeys',
  'apmDodge',
  'apmDodgeCd',
  'apmKite',
  'apmDefKite',
  'apmLastHit',
  'apmLastHit2',
  'apmSpacing',
  'apmSmite',
] as const;

export type ApmDrillId = (typeof APM_DRILL_IDS)[number];

export const isApmDrill = (id: DrillId): id is ApmDrillId =>
  (APM_DRILL_IDS as readonly string[]).includes(id);

/** Builds one mode. Returns null for anything that is not an APM mode. */
export const createApmDrill = (id: DrillId, session: Session): Drill | null => {
  switch (id) {
    case 'apmAim':
      return new ApmAimDrill(session);
    case 'apmAim2':
      return new ApmAim2Drill(session);
    case 'apmAimMap':
      return new ApmAimMapDrill(session);
    case 'apmPrecision':
      return new ApmPrecisionDrill(session);
    case 'apmKeys':
      return new ApmKeysDrill(session);
    case 'apmDodge':
      return new ApmDodgeDrill(session);
    case 'apmDodgeCd':
      return new ApmDodgeCooldownDrill(session);
    case 'apmKite':
      return new ApmKiteDrill(session);
    case 'apmDefKite':
      return new ApmDefensiveKiteDrill(session);
    case 'apmLastHit':
      return new ApmLastHitDrill(session);
    case 'apmLastHit2':
      return new ApmLastHit2Drill(session);
    case 'apmSpacing':
      return new ApmSpacingDrill(session);
    case 'apmSmite':
      return new ApmSmiteDrill(session);
    default:
      return null;
  }
};

export { FLOW_TIERS } from './engine';
