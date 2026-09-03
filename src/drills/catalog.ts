import type { AbilitySlot } from '../engine/input';
import type { AxisWeights } from '../progression/skills';

export type DrillId =
  | 'movement'
  | 'dodge'
  | 'aim'
  | 'skillshot'
  | 'kite'
  | 'spacing'
  | 'lasthit'
  | 'targetswitch'
  | 'combos'
  | 'duel1v1'
  | 'duel1v2'
  | 'duel1v3'
  | 'vayneTumble'
  | 'vayneBolts'
  | 'vayneCondemn'
  | 'vayneHunt'
  /* --- the APM lab. One engine, thirteen ways of measuring a press --- */
  | 'apmPulse'
  | 'apmSequence'
  | 'apmChord'
  | 'apmGate'
  | 'apmBuffer'
  | 'apmCancel'
  | 'apmVector'
  | 'apmField'
  | 'apmHandoff'
  | 'apmSplit'
  | 'apmUpkeep'
  | 'apmSwitch'
  | 'apmSustain';

export type DrillGroup = 'FOUNDATION' | 'RHYTHM' | 'COMBAT' | 'APM' | 'VAYNE';

export interface DrillMeta {
  id: DrillId;
  name: string;
  tagline: string;
  /** What the drill actually asks you to do. */
  brief: string;
  /** The League habit it is meant to build. */
  transfers: string;
  group: DrillGroup;
  axes: AxisWeights;
  duration: number;
  abilities: AbilitySlot[];
  accent: string;
  /** The one number the results screen leads with. */
  keyMetric: string;
  /**
   * Opening camera framing, 1 = the whole arena in frame. Only set it below 1
   * for a drill whose arena is deliberately bigger than one screenful.
   */
  zoom?: number;
  order: number;
}

export const DRILLS: Record<DrillId, DrillMeta> = {
  movement: {
    id: 'movement',
    name: 'MOVEMENT',
    tagline: 'Precision pathing',
    brief: 'Move through each node the instant it lights. Waste no distance, click no twice.',
    transfers: 'Clean click-to-move habits: one command, the right point, no wandering.',
    group: 'FOUNDATION',
    axes: { movement: 1 },
    duration: 45,
    abilities: [],
    accent: '#58e0ff',
    keyMetric: 'PATH EFFICIENCY',
    order: 1,
  },
  aim: {
    id: 'aim',
    name: 'AIM',
    tagline: 'Command accuracy',
    brief: 'Targets surface for a moment. Click the exact one, exactly on it, immediately.',
    transfers: 'Putting your click on the champion you meant, first time, under pressure.',
    group: 'FOUNDATION',
    axes: { aim: 1 },
    duration: 45,
    abilities: [],
    accent: '#7ceaff',
    keyMetric: 'REACTION',
    order: 2,
  },
  skillshot: {
    id: 'skillshot',
    name: 'SKILLSHOT',
    tagline: 'Land the unlandable',
    brief: 'Four skillshots, one evasive target. Lead the fast one, sell the cone, predict the ultimate.',
    transfers: 'Landing a real skillshot — travel time, width and all — on a champion trying not to be hit.',
    group: 'FOUNDATION',
    axes: { skillshot: 0.85, aim: 0.15 },
    duration: 75,
    abilities: ['q', 'w', 'e', 'r'],
    accent: '#ff6bd6',
    keyMetric: 'HIT RATE',
    order: 3,
  },
  dodge: {
    id: 'dodge',
    name: 'DODGE',
    tagline: 'Skillshot survival',
    brief: 'Read the telegraph, move once, be somewhere else. Waves escalate every 15 seconds.',
    transfers: 'Reacting to skillshots with a single correct movement instead of panicking.',
    group: 'FOUNDATION',
    axes: { dodging: 0.8, movement: 0.2 },
    duration: 75,
    abilities: [],
    accent: '#ffcf6b',
    keyMetric: 'DODGE RATE',
    order: 4,
  },
  spacing: {
    id: 'spacing',
    name: 'SPACING',
    tagline: 'The pocket, then the pocket blind',
    brief:
      'Hold the ground where you can hit them and they cannot hit you — and keep holding it as the range rings fade and then disappear.',
    transfers: 'Knowing where the edge of your range is without anything drawing it, which is the only way it exists in a game.',
    group: 'RHYTHM',
    axes: { spacing: 0.8, movement: 0.2 },
    duration: 60,
    abilities: [],
    accent: '#5ce1a8',
    keyMetric: 'ADVANTAGEOUS SPACING',
    order: 5,
  },
  kite: {
    id: 'kite',
    name: 'KITE',
    tagline: 'Attack. Move. Attack.',
    brief: 'Attack, step in the backswing, attack again. Never cancel a windup. Never stand still.',
    transfers: 'Orbwalking — the single highest-value mechanic an ADC can own.',
    group: 'RHYTHM',
    axes: { kiting: 0.7, spacing: 0.2, movement: 0.1 },
    duration: 60,
    abilities: [],
    accent: '#ff9f5c',
    keyMetric: 'ORBWALK EFFICIENCY',
    order: 6,
  },
  lasthit: {
    id: 'lasthit',
    name: 'LAST HIT',
    tagline: 'A lane, not a metronome',
    brief:
      'Two waves fight. Turrets shoot. Take the killing blow on every enemy minion — one attack each, no attack wasted.',
    transfers: 'Farming a real lane: leading the windup, counting turret shots, and not waking the wave up.',
    group: 'RHYTHM',
    axes: { lastHitting: 0.85, aim: 0.15 },
    duration: 90,
    abilities: [],
    accent: '#ffd166',
    keyMetric: 'CS ACCURACY',
    zoom: 0.7,
    order: 7,
  },
  targetswitch: {
    id: 'targetswitch',
    name: 'TARGET SWITCH',
    tagline: 'Commit to the right one',
    brief: 'The priority target changes. Get off the old one and onto the new one, fast.',
    transfers: 'Retargeting mid-fight without freezing or attacking the wrong unit.',
    group: 'RHYTHM',
    axes: { targeting: 0.75, aim: 0.25 },
    duration: 50,
    abilities: [],
    accent: '#c48bff',
    keyMetric: 'SWITCH SPEED',
    order: 8,
  },
  combos: {
    id: 'combos',
    name: 'COMBOS',
    tagline: 'Sequence under pressure',
    brief: 'Execute the shown ability sequence on target, in order, before the window closes.',
    transfers: 'Muscle memory for ability order while your hands are already busy.',
    group: 'RHYTHM',
    axes: { targeting: 0.4, aim: 0.3, combat: 0.3 },
    duration: 55,
    abilities: ['q', 'w', 'e', 'r'],
    accent: '#b98cff',
    keyMetric: 'EXECUTION',
    order: 9,
  },
  duel1v1: {
    id: 'duel1v1',
    name: '1 v 1',
    tagline: 'Everything at once',
    brief: 'One enemy that moves, fights, dodges and respects its cooldowns. Win the trade.',
    transfers: 'Applying kiting, spacing and dodging simultaneously against a live opponent.',
    group: 'COMBAT',
    axes: { combat: 0.55, kiting: 0.2, spacing: 0.15, dodging: 0.1 },
    duration: 0,
    abilities: ['d'],
    accent: '#ff7a5c',
    keyMetric: 'COMBAT SCORE',
    order: 10,
  },
  duel1v2: {
    id: 'duel1v2',
    name: '1 v 2',
    tagline: 'Priority and angles',
    brief: 'Two enemies from two angles. Pick the right target, hold your spacing, stay alive.',
    transfers: 'Target priority and multi-angle dodging when you are outnumbered.',
    group: 'COMBAT',
    axes: { combat: 0.45, targeting: 0.2, dodging: 0.2, spacing: 0.15 },
    duration: 0,
    abilities: ['d'],
    accent: '#ff5f8f',
    keyMetric: 'SURVIVAL',
    order: 11,
  },
  duel1v3: {
    id: 'duel1v3',
    name: '1 v 3',
    tagline: 'Outnumbered',
    brief: 'Three archetypes at once. Survive, then start winning. This is the hardest thing here.',
    transfers: 'Everything: cooldown awareness, kiting, switching, and refusing to panic.',
    group: 'COMBAT',
    axes: { combat: 0.4, dodging: 0.25, targeting: 0.2, kiting: 0.15 },
    duration: 0,
    abilities: ['d'],
    accent: '#ff4d6d',
    keyMetric: 'SURVIVAL',
    order: 12,
  },
  // ------------------------------------------------------------------- APM
  //
  // The lab. Thirteen modes over one engine, and deliberately not the game:
  // no minions, no camps, nothing fighting back — a bench of pads, gates and
  // clocks, because what is being measured is pressing and everything else on
  // the screen was noise in the measurement. Every mode counts the same thing,
  // correct commands per minute, and every mode refuses to count an input that
  // did not mean anything. The flow ladder is shared: chain your actions and
  // the multiplier climbs through five tiers, break and it is gone.
  apmPulse: {
    id: 'apmPulse',
    name: 'PULSE',
    tagline: 'Cadence, with one bit of choice',
    brief: 'Two pads, two fingers. Take the lit one — and about a third of the time the light does not move.',
    transfers: 'The trill under every combo: two abilities, two fingers, nothing travelling.',
    group: 'APM',
    axes: { tempo: 1 },
    duration: 40,
    abilities: ['q', 'e'],
    accent: '#7ceaff',
    keyMetric: 'SUSTAINED APM',
    order: 30,
  },
  apmSequence: {
    id: 'apmSequence',
    name: 'SEQUENCE',
    tagline: 'The queue, read two ahead',
    brief: 'Six keys roll across the bench and only the front one is legal. The window shrinks as you speed up.',
    transfers: 'A long combo arriving in the right order when you are not thinking about it.',
    group: 'APM',
    axes: { tempo: 0.7, targeting: 0.3 },
    duration: 45,
    abilities: ['q', 'w', 'e', 'r', 'd', 'f'],
    accent: '#c48bff',
    keyMetric: 'SUSTAINED APM',
    order: 31,
  },
  apmChord: {
    id: 'apmChord',
    name: 'CHORD',
    tagline: 'Two keys, one instant',
    brief: 'A pair lights and both keys have to land together. The tolerance closes to under fifty milliseconds.',
    transfers: 'Flash plus an ability — the pairs that only work on the same frame.',
    group: 'APM',
    axes: { tempo: 0.7, combat: 0.3 },
    duration: 50,
    abilities: ['q', 'w', 'e', 'r', 'd', 'f'],
    accent: '#8ad4ff',
    keyMetric: 'SUSTAINED APM',
    order: 32,
  },
  apmGate: {
    id: 'apmGate',
    name: 'GO / NO-GO',
    tagline: 'The press you were right not to make',
    brief: 'Live pads want their key now. Barred pads want nothing at all, and pressing one costs the chain.',
    transfers: 'The cooldown you do not spend on a bait. Inhibition is slower than reaction and nobody trains it.',
    group: 'APM',
    axes: { tempo: 0.6, targeting: 0.4 },
    duration: 55,
    abilities: ['q', 'w', 'e', 'r'],
    accent: '#ff9f5c',
    keyMetric: 'SUSTAINED APM',
    order: 33,
  },
  apmBuffer: {
    id: 'apmBuffer',
    name: 'BUFFER',
    tagline: 'Into a window that has not opened',
    brief: 'A shutter runs on a clock you can see. Be pressing before it opens — early is eaten, late is only reacting.',
    transfers: 'Queueing the next cast into the tail of the current one.',
    group: 'APM',
    axes: { tempo: 0.65, lastHitting: 0.35 },
    duration: 55,
    abilities: ['q'],
    accent: '#5ce1a8',
    keyMetric: 'SUSTAINED APM',
    order: 34,
  },
  apmCancel: {
    id: 'apmCancel',
    name: 'CANCEL',
    tagline: 'The second press, at a particular moment',
    brief: 'START runs a bar. Cut it after the commit and before it ends — the window closes to a tenth of a second.',
    transfers: 'Cutting a backswing the instant it is free, and every animation cancel underneath that.',
    group: 'APM',
    axes: { tempo: 0.6, kiting: 0.4 },
    duration: 55,
    abilities: ['q', 'e'],
    accent: '#4fd6c4',
    keyMetric: 'SUSTAINED APM',
    order: 35,
  },
  apmVector: {
    id: 'apmVector',
    name: 'VECTOR',
    tagline: 'The movement command, alone',
    brief: 'A heading is called. Go that way, now. Nothing to dodge and nowhere to be — only the command.',
    transfers: 'One aimed reposition instead of two corrections. Counted the same whichever hand sends it.',
    group: 'APM',
    axes: { tempo: 0.6, movement: 0.4 },
    duration: 50,
    abilities: [],
    accent: '#ffcf6b',
    keyMetric: 'SUSTAINED APM',
    order: 36,
  },
  apmField: {
    id: 'apmField',
    name: 'FIELD',
    tagline: 'The mouse half, with nothing attached',
    brief: 'Pads light across the floor and go out. Graded in units from the centre, and they shrink as you chain.',
    transfers: 'The ceiling on every command that starts with the cursor being somewhere.',
    group: 'APM',
    axes: { tempo: 0.6, aim: 0.4 },
    duration: 45,
    abilities: [],
    accent: '#b8e4ff',
    keyMetric: 'SUSTAINED APM',
    order: 37,
  },
  apmHandoff: {
    id: 'apmHandoff',
    name: 'HANDOFF',
    tagline: 'Two hands, strictly taking turns',
    brief: 'Click, key, click, key — never twice in a row. What it measures is the seam between the two.',
    transfers: 'Cast, then reposition, then cast: the pair that has to overlap rather than queue.',
    group: 'APM',
    axes: { tempo: 0.5, aim: 0.3, targeting: 0.2 },
    duration: 55,
    abilities: ['q', 'w', 'e'],
    accent: '#9fc4ff',
    keyMetric: 'SUSTAINED APM',
    order: 38,
  },
  apmSplit: {
    id: 'apmSplit',
    name: 'SPLIT',
    tagline: 'Two things at once, neither waiting',
    brief: 'A key queue in the middle that never stops, and alerts at the rim that want a different key inside a second.',
    transfers: 'Answering the minimap without your combo falling apart.',
    group: 'APM',
    axes: { tempo: 0.5, targeting: 0.35, aim: 0.15 },
    duration: 60,
    abilities: ['q', 'w', 'e', 'd', 'f'],
    accent: '#ffb45c',
    keyMetric: 'SUSTAINED APM',
    order: 39,
  },
  apmUpkeep: {
    id: 'apmUpkeep',
    name: 'UPKEEP',
    tagline: 'Four clocks, none of them prompting you',
    brief: 'Wheels fill at rates that do not divide into each other. Spend each as it comes up — and leave the locked one alone.',
    transfers: 'Never sitting on a cooldown because your attention was somewhere else.',
    group: 'APM',
    axes: { tempo: 0.5, combat: 0.3, targeting: 0.2 },
    duration: 60,
    abilities: ['q', 'w', 'e', 'r'],
    accent: '#ffd166',
    keyMetric: 'SUSTAINED APM',
    order: 40,
  },
  apmSwitch: {
    id: 'apmSwitch',
    name: 'SWITCH',
    tagline: 'What it costs to move your hand',
    brief: 'Near bank, far bank, mouse. The prompt keeps changing which, and the mode prints the cost in milliseconds.',
    transfers: 'The summoner key mid-combo. Not a harder key — a different hand shape, and the shape is what you pay for.',
    group: 'APM',
    axes: { tempo: 0.6, targeting: 0.4 },
    duration: 55,
    abilities: ['q', 'w', 'e', 'r', 'd', 'f'],
    accent: '#ff6bd6',
    keyMetric: 'SUSTAINED APM',
    order: 41,
  },
  apmSustain: {
    id: 'apmSustain',
    name: 'SUSTAIN',
    tagline: 'The rate you can be held to',
    brief: 'A beat you must answer, faster every twelve seconds. Drop two inside one step and the run ends where your hands do.',
    transfers: 'Minute three of a fight rather than second three of one.',
    group: 'APM',
    axes: { tempo: 0.8, combat: 0.2 },
    duration: 150,
    abilities: ['q', 'w', 'e', 'r'],
    accent: '#b98cff',
    keyMetric: 'SUSTAINED APM',
    order: 42,
  },
  vayneTumble: {
    id: 'vayneTumble',
    name: 'TUMBLE',
    tagline: 'The Vayne rhythm',
    brief: 'Attack, tumble out of the backswing, attack again. Never tumble mid-windup, never sit on the cooldown.',
    transfers: 'Vayne’s core loop — Q as free distance and an empowered shot, not as an escape button.',
    group: 'VAYNE',
    axes: { kiting: 0.75, movement: 0.15, spacing: 0.1 },
    duration: 60,
    abilities: ['q'],
    accent: '#c86bff',
    keyMetric: 'TUMBLE RHYTHM',
    order: 20,
  },
  vayneBolts: {
    id: 'vayneBolts',
    name: 'SILVER BOLTS',
    tagline: 'Finish the third hit',
    brief: 'Three hits on one target detonate. The mark moves every eleven seconds — finish your stack, then switch.',
    transfers: 'The habit that makes Vayne kill tanks: never abandoning a stack at two.',
    group: 'VAYNE',
    axes: { targeting: 0.6, lastHitting: 0.25, aim: 0.15 },
    duration: 60,
    abilities: ['q', 'w'],
    accent: '#e6f0ff',
    keyMetric: 'BOLT EFFICIENCY',
    order: 21,
  },
  vayneCondemn: {
    id: 'vayneCondemn',
    name: 'CONDEMN',
    tagline: 'Pin them to the wall',
    brief: 'Chargers come from every angle. Stand so the terrain is behind them, then condemn them into it.',
    transfers: 'Wall-side positioning — the difference between a knockback and a 1.5s stun.',
    group: 'VAYNE',
    axes: { skillshot: 0.5, spacing: 0.3, movement: 0.2 },
    duration: 70,
    abilities: ['q', 'e'],
    accent: '#ffcf6b',
    keyMetric: 'WALL STUN RATE',
    order: 22,
  },
  vayneHunt: {
    id: 'vayneHunt',
    name: 'NIGHT HUNTER',
    tagline: 'The whole champion',
    brief: 'Two opponents, terrain, and the full kit including Final Hour. Everything at once, the way it actually happens.',
    transfers: 'Playing Vayne — not playing an ADC who happens to own her abilities.',
    group: 'VAYNE',
    axes: { combat: 0.5, kiting: 0.2, targeting: 0.2, dodging: 0.1 },
    duration: 0,
    abilities: ['q', 'w', 'e', 'r'],
    accent: '#ff5fa8',
    keyMetric: 'KIT EXECUTION',
    order: 23,
  },
};

export const DRILL_LIST = Object.values(DRILLS).sort((a, b) => a.order - b.order);

/** The five calibration drills, in the order the placement runs them. */
export const PLACEMENT_SEQUENCE: DrillId[] = ['movement', 'aim', 'dodge', 'kite', 'duel1v1'];

/** Today's programme. Deliberately short enough to finish every day. */
export const DAILY_SEQUENCE: DrillId[] = ['movement', 'dodge', 'kite', 'spacing', 'duel1v1'];

/** The champion track, in the order it has to be learned. */
export const VAYNE_SEQUENCE: DrillId[] = ['vayneTumble', 'vayneBolts', 'vayneCondemn', 'vayneHunt'];

export const isVayneDrill = (id: DrillId): boolean => DRILLS[id].group === 'VAYNE';
