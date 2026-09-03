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
  tempo: 'APM',
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
  tempo: 'APM',
};

export const AXIS_BLURB: Record<SkillAxis, string> = {
  movement: 'Path efficiency, click precision and how little distance you waste.',
  aim: 'How fast and how accurately you put a command on the right point.',
  skillshot: 'Landing a telegraphed or travel-time ability on a target trying not to be hit.',
  dodging: 'Reading telegraphs and skillshots, and not being where they land.',
  kiting: 'Attack, move, attack. Orbwalk efficiency and cancelled attacks.',
  spacing: 'Holding the edge of your range instead of drifting into theirs.',
  targeting: 'Switching to the right target, and how quickly you commit.',
  combat: 'Everything at once, under pressure, against something fighting back.',
  lastHitting: 'Timing a killing blow on a moving health bar.',
  tempo: 'Actions per minute that mean something — hand speed with nothing wasted.',
};

/** Which drill trains which axis, and how strongly (weights sum per drill). */
export type AxisWeights = Partial<Record<SkillAxis, number>>;
