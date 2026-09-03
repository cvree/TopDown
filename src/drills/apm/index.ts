import type { Session } from '../../engine/session';
import type { Drill } from '../base';
import type { DrillId } from '../catalog';
import { ApmPulseDrill, ApmSustainDrill } from './cadence';
import { ApmChordDrill } from './chord';
import { ApmFieldDrill, ApmHandoffDrill, ApmSplitDrill } from './field';
import { ApmGateDrill } from './gate';
import { ApmSequenceDrill, ApmSwitchDrill } from './sequence';
import { ApmBufferDrill, ApmCancelDrill } from './timing';
import { ApmUpkeepDrill } from './upkeep';
import { ApmVectorDrill } from './vector';

/**
 * Every mode of the lab, by id.
 *
 * The order is the order the section lists them in: the eight that ask one
 * thing of your hands, then the five that ask two.
 */
export const APM_DRILL_IDS = [
  'apmPulse',
  'apmSequence',
  'apmChord',
  'apmGate',
  'apmBuffer',
  'apmCancel',
  'apmVector',
  'apmField',
  'apmHandoff',
  'apmSplit',
  'apmUpkeep',
  'apmSwitch',
  'apmSustain',
] as const;

export type ApmDrillId = (typeof APM_DRILL_IDS)[number];

export const isApmDrill = (id: DrillId): id is ApmDrillId =>
  (APM_DRILL_IDS as readonly string[]).includes(id);

/** Builds one mode. Returns null for anything that is not a lab mode. */
export const createApmDrill = (id: DrillId, session: Session): Drill | null => {
  switch (id) {
    case 'apmPulse':
      return new ApmPulseDrill(session);
    case 'apmSequence':
      return new ApmSequenceDrill(session);
    case 'apmChord':
      return new ApmChordDrill(session);
    case 'apmGate':
      return new ApmGateDrill(session);
    case 'apmBuffer':
      return new ApmBufferDrill(session);
    case 'apmCancel':
      return new ApmCancelDrill(session);
    case 'apmVector':
      return new ApmVectorDrill(session);
    case 'apmField':
      return new ApmFieldDrill(session);
    case 'apmHandoff':
      return new ApmHandoffDrill(session);
    case 'apmSplit':
      return new ApmSplitDrill(session);
    case 'apmUpkeep':
      return new ApmUpkeepDrill(session);
    case 'apmSwitch':
      return new ApmSwitchDrill(session);
    case 'apmSustain':
      return new ApmSustainDrill(session);
    default:
      return null;
  }
};

export { APM_TARGET_APM, FLOW_TIERS } from './engine';
export { LabDrill } from './lab';
export type { LabSolution } from './lab';
