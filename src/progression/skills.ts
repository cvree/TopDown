/** The eight mechanical axes the trainer rates independently. */
export const SKILL_AXES = [
  'movement',
  'aim',
  'dodging',
  'kiting',
  'spacing',
  'targeting',
  'combat',
  'lastHitting',
] as const;

export type SkillAxis = (typeof SKILL_AXES)[number];

export const AXIS_LABEL: Record<SkillAxis, string> = {
  movement: 'Movement',
  aim: 'Aim',
  dodging: 'Dodging',
  kiting: 'Kiting',
  spacing: 'Spacing',
  targeting: 'Targeting',
  combat: 'Combat',
  lastHitting: 'Last Hitting',
};

export const AXIS_BLURB: Record<SkillAxis, string> = {
  movement: 'Path efficiency, click precision and how little distance you waste.',
  aim: 'How fast and how accurately you put a command on the right point.',
  dodging: 'Reading telegraphs and skillshots, and not being where they land.',
  kiting: 'Attack, move, attack. Orbwalk efficiency and cancelled attacks.',
  spacing: 'Holding the edge of your range instead of drifting into theirs.',
  targeting: 'Switching to the right target, and how quickly you commit.',
  combat: 'Everything at once, under pressure, against something fighting back.',
  lastHitting: 'Timing a killing blow on a moving health bar.',
};

/** Which drill trains which axis, and how strongly (weights sum per drill). */
export type AxisWeights = Partial<Record<SkillAxis, number>>;
