/** The ten mechanical axes the trainer rates independently. */
export const SKILL_AXES = [
  'movement',
  'aim',
  'skillshot',
  'dodging',
  'kiting',
  'spacing',
  'targeting',
  'combat',
  'lastHitting',
  'tempo',
] as const;

export type SkillAxis = (typeof SKILL_AXES)[number];

export const AXIS_LABEL: Record<SkillAxis, string> = {
  movement: 'Movement',
  aim: 'Aim',
  skillshot: 'Skillshot',
  dodging: 'Dodging',
  kiting: 'Kiting',
  spacing: 'Spacing',
  targeting: 'Targeting',
  combat: 'Combat',
  lastHitting: 'Last Hitting',
  tempo: 'Hand speed',
};

/** Short forms, for places where the label has to fit a fixed slot. */
export const AXIS_SHORT: Record<SkillAxis, string> = {
  movement: 'MOVEMENT',
  aim: 'AIM',
  skillshot: 'SKILLSHOT',
  dodging: 'DODGING',
  kiting: 'KITING',
  spacing: 'SPACING',
  targeting: 'TARGETING',
  combat: 'COMBAT',
  lastHitting: 'FARMING',
  tempo: 'SPEED',
};

export const AXIS_BLURB: Record<SkillAxis, string> = {
  movement: 'Path efficiency, click precision and how little distance you waste.',
  aim: 'How fast and how accurately you click where you meant to.',
  skillshot: 'Landing an aimed ability on somebody who is trying not to be hit.',
  dodging: 'Seeing what is coming, and not being where it lands.',
  kiting: 'Attack, move, attack — without ever cancelling your own shot.',
  spacing: 'Holding the edge of your range instead of drifting into theirs.',
  targeting: 'Switching to the right target, and how quickly you commit.',
  combat: 'Everything at once, under pressure, against something fighting back.',
  lastHitting: 'Timing a killing blow on a moving health bar.',
  tempo: 'How many useful things your hands do a minute, with nothing wasted.',
};

/** Which drill trains which axis, and how strongly (weights sum per drill). */
export type AxisWeights = Partial<Record<SkillAxis, number>>;
