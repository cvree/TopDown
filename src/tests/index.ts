import type { Rng } from '../engine/rng';
import { TESTS, type TestId } from './catalog';
import { DodgeReadTest, FlashReactTest, KeyCastTest, SoundCueTest } from './reflex';
import { CsClockTest, FlickTest, LeadTest, TrackTest } from './precision';
import { ComboRecallTest, CooldownsTest, ExecuteTest, MapRecallTest } from './mind';
import type { TestRunner } from './types';

export const createTest = (id: TestId, rng: Rng): TestRunner => {
  switch (id) {
    case 'flashReact':
      return new FlashReactTest(rng);
    case 'soundCue':
      return new SoundCueTest(rng);
    case 'keyCast':
      return new KeyCastTest(rng);
    case 'dodgeRead':
      return new DodgeReadTest(rng);
    case 'flick':
      return new FlickTest(rng);
    case 'lead':
      return new LeadTest(rng);
    case 'csClock':
      return new CsClockTest(rng);
    case 'track':
      return new TrackTest(rng);
    case 'mapRecall':
      return new MapRecallTest(rng);
    case 'cooldowns':
      return new CooldownsTest(rng);
    case 'execute':
      return new ExecuteTest(rng);
    case 'comboRecall':
      return new ComboRecallTest(rng);
  }
};

export { TESTS };
export type { TestRunner };
