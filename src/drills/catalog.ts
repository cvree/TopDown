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
  /* --- the WASD academy. Nine modules, in the order they have to be taken --- */
  | 'wasdMove'
  | 'wasdIndep'
  | 'wasdStrafe'
  | 'wasdAimMove'
  | 'wasdCadence'
  | 'wasdKite'
  | 'wasdOffKite'
  | 'wasdDefKite'
  | 'wasdMulti'
  /* --- the Ezreal path. Ten stages of aiming while busy --- */
  | 'ezQ'
  | 'ezLead'
  | 'ezStrafe'
  | 'ezThread'
  | 'ezWeave'
  | 'ezMaxRange'
  | 'ezKite'
  | 'ezShift'
  | 'ezSwitch'
  | 'ezFight'
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

export type DrillGroup = 'FOUNDATION' | 'RHYTHM' | 'COMBAT' | 'WASD' | 'APM' | 'VAYNE' | 'EZREAL';

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
  /**
   * The drill's own length, in seconds. Zero means open-ended.
   *
   * The client no longer reads this: PLAY is a minute and SURVIVE has no
   * clock, and which of those you are playing is the only thing that decides
   * how long a run lasts. It remains here because the simulation harness runs
   * every drill headlessly and has to run it for *some* length — so for the
   * four modes the client actually offers, this is PLAY's minute, and a
   * reference run measures exactly the run a player takes.
   */
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
  /**
   * A drill that only means anything under one control scheme says so, and the
   * run is played that way whatever the profile is set to.
   *
   * The academy is the only thing that uses it: "move left while aiming right"
   * is not a hard version of clicking, it is a sentence that does not parse
   * under the click scheme, and silently running it with a mouse would teach
   * the opposite of the module's whole point.
   */
  forceScheme?: 'wasd' | 'click';
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
    tagline: 'Somewhere else, and somewhere useful',
    brief:
      'Read the telegraph, move once, be somewhere else — and kill the emitters throwing it. Both halves are scored; neither can carry the run.',
    transfers: 'Dodging while still doing your job, instead of leaving the fight to be safe in a corner.',
    group: 'FOUNDATION',
    axes: { dodging: 0.7, movement: 0.15, combat: 0.15 },
    duration: 75,
    abilities: [],
    accent: '#ffcf6b',
    keyMetric: 'DAMAGE AVOIDED',
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
  // ---------------------------------------------------------------- ACADEMY
  //
  // Nine modules, taken in order, every one of them played on the keys
  // whatever the profile is set to. They are not "the drills, but harder":
  // each one isolates a thing the WASD scheme makes possible and the click
  // scheme cannot express, and the order is the order the skills stack in.
  wasdMove: {
    id: 'wasdMove',
    name: 'WASD 01 · MOVEMENT',
    tagline: 'The four keys, exactly',
    brief:
      'Cardinals, then diagonals, then snap changes, then terrain — and every node asks you to stop dead inside it, not near it.',
    transfers: 'Going exactly where you meant, in one motion, without a correction afterwards.',
    group: 'WASD',
    axes: { movement: 1 },
    duration: 90,
    abilities: [],
    accent: '#58e0ff',
    keyMetric: 'STOP PRECISION',
    forceScheme: 'wasd',
    order: 13,
  },
  wasdIndep: {
    id: 'wasdIndep',
    name: 'WASD 02 · CURSOR INDEPENDENCE',
    tagline: 'Two hands, two directions',
    brief:
      'Hold the cursor on the mark while your feet are sent the other way. The further apart they are, the more it pays.',
    transfers: 'The entire advantage of the scheme: where you are going stops deciding where you are looking.',
    group: 'WASD',
    axes: { movement: 0.45, aim: 0.35, targeting: 0.2 },
    duration: 80,
    abilities: [],
    accent: '#7cd4ff',
    keyMetric: 'OPPOSED TIME',
    forceScheme: 'wasd',
    order: 14,
  },
  wasdStrafe: {
    id: 'wasdStrafe',
    name: 'WASD 03 · STRAFING',
    tagline: 'Lateral, and unreadable',
    brief:
      'A shooter that leads you. Strafe across its line, change on no rhythm it can learn, and make it fire where you were.',
    transfers: 'Being a hard target — the reason good players are missed by skillshots they never saw.',
    group: 'WASD',
    axes: { dodging: 0.45, movement: 0.4, spacing: 0.15 },
    duration: 80,
    abilities: [],
    accent: '#ffcf6b',
    keyMetric: 'BAIT RATE',
    forceScheme: 'wasd',
    order: 15,
  },
  wasdAimMove: {
    id: 'wasdAimMove',
    name: 'WASD 04 · AIM WHILE MOVING',
    tagline: 'Never stop to shoot',
    brief:
      'Marks surface and die fast. Take them all — but a mark taken standing still is worth a fraction of one taken on the move.',
    transfers: 'Acquiring a target without the half-second pause that gets you killed for taking it.',
    group: 'WASD',
    axes: { aim: 0.5, movement: 0.3, targeting: 0.2 },
    duration: 70,
    abilities: [],
    accent: '#9fc4ff',
    keyMetric: 'MOVING ACCURACY',
    forceScheme: 'wasd',
    order: 16,
  },
  wasdCadence: {
    id: 'wasdCadence',
    name: 'WASD 05 · ATTACK CADENCE',
    tagline: 'Where the attack actually is',
    brief:
      'One dummy, one bar, four stretches of time. Learn by feel which part of an attack a held key destroys and which part it is free in.',
    transfers: 'The law every other rhythm in the game is built on: committed, released, free, ready.',
    group: 'WASD',
    axes: { kiting: 0.55, tempo: 0.25, movement: 0.2 },
    duration: 80,
    abilities: [],
    accent: '#ff9f5c',
    keyMetric: 'FREE WINDOW USED',
    forceScheme: 'wasd',
    order: 17,
  },
  wasdKite: {
    id: 'wasdKite',
    name: 'WASD 06 · KITING',
    tagline: 'Attack, move, attack — timed',
    brief:
      'The full cycle, scored on when each command arrived rather than on how many you sent. Early is a lost attack; late is a lost window.',
    transfers: 'Orbwalking on the keys, with the timing graded instead of the input count.',
    group: 'WASD',
    axes: { kiting: 0.7, movement: 0.15, spacing: 0.15 },
    duration: 75,
    abilities: [],
    accent: '#5ce1a8',
    keyMetric: 'CYCLE TIMING',
    forceScheme: 'wasd',
    order: 18,
  },
  wasdOffKite: {
    id: 'wasdOffKite',
    name: 'WASD 07 · OFFENSIVE KITING',
    tagline: 'Chase without closing',
    brief:
      'It runs. You follow at the outer edge of your range and keep firing — every step closer than you needed is damage you paid for with your life total.',
    transfers: 'Finishing a fleeing target without walking into their team to do it.',
    group: 'WASD',
    axes: { kiting: 0.5, spacing: 0.35, movement: 0.15 },
    duration: 75,
    abilities: [],
    accent: '#ffb45c',
    keyMetric: 'RANGE HELD',
    forceScheme: 'wasd',
    order: 19,
  },
  wasdDefKite: {
    id: 'wasdDefKite',
    name: 'WASD 08 · DEFENSIVE KITING',
    tagline: 'Backwards, still shooting',
    brief:
      'They come to you. Deal everything you can while never letting the gap close — the shot you take from inside their reach costs more than it earns.',
    transfers: 'Kiting a diver down instead of trading with it and hoping.',
    group: 'WASD',
    axes: { kiting: 0.45, spacing: 0.3, dodging: 0.25 },
    duration: 75,
    abilities: [],
    accent: '#4fd6c4',
    keyMetric: 'SAFE DAMAGE',
    forceScheme: 'wasd',
    order: 20,
  },
  wasdMulti: {
    id: 'wasdMulti',
    name: 'WASD 09 · MULTITASKING',
    tagline: 'A very small teamfight',
    brief:
      'Feet, attacks, two skillshots, telegraphs to leave and a priority target that keeps changing. All of it, at the same time.',
    transfers: 'The actual load of a fight, at the size where you can still see what you dropped.',
    group: 'WASD',
    axes: { combat: 0.4, targeting: 0.2, dodging: 0.2, kiting: 0.2 },
    duration: 90,
    // Under the WASD layout these two sit on the physical Q and E — the pair
    // your ring and middle finger can reach without leaving the movement keys.
    abilities: ['q', 'w'],
    accent: '#ff5f8f',
    keyMetric: 'LOAD CARRIED',
    forceScheme: 'wasd',
    order: 21,
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
  ezQ: {
    id: 'ezQ',
    name: 'MYSTIC SHOT',
    tagline: 'Travel time, and a width',
    brief: 'A target that does not move. Learn how long the missile takes to cross the gap and how wide it is when it arrives.',
    transfers: 'The one shot Ezreal cannot play without — and the only stage on the path where standing still is allowed.',
    group: 'EZREAL',
    axes: { skillshot: 0.8, aim: 0.2 },
    duration: 45,
    abilities: ['q'],
    accent: '#ffd166',
    keyMetric: 'Q ACCURACY',
    order: 50,
  },
  ezLead: {
    id: 'ezLead',
    name: 'LEAD',
    tagline: 'Where they will be',
    brief: 'The same shot at something that will not hold still. Aim at the arrival, not the departure.',
    transfers: 'Prediction: the half-second of travel that every skillshot in the game is decided in.',
    group: 'EZREAL',
    axes: { skillshot: 0.75, aim: 0.25 },
    duration: 55,
    abilities: ['q'],
    accent: '#ffd166',
    keyMetric: 'LANDED ON A MOVER',
    order: 51,
  },
  ezStrafe: {
    id: 'ezStrafe',
    name: 'Q WHILE STRAFING',
    tagline: 'Both feet busy',
    brief: 'Zones land where you are standing. Keep moving, and land the shot anyway — hits fired from a standstill barely count.',
    transfers: 'The actual Ezreal skill: aiming with the mouse while the keys are doing something else entirely.',
    group: 'EZREAL',
    axes: { skillshot: 0.5, movement: 0.3, dodging: 0.2 },
    duration: 60,
    abilities: ['q'],
    accent: '#ffb347',
    keyMetric: 'LANDED ON THE MOVE',
    order: 52,
  },
  ezThread: {
    id: 'ezThread',
    name: 'THREAD',
    tagline: 'Through the wave',
    brief: 'A minion wall between you and what you want. Find the gap, and fire before it closes.',
    transfers: 'Not feeding your cooldown to a caster minion, which is where most Ezreal Qs in a real lane actually go.',
    group: 'EZREAL',
    axes: { skillshot: 0.6, aim: 0.2, movement: 0.2 },
    duration: 60,
    abilities: ['q'],
    accent: '#ffa057',
    keyMetric: 'QS BLOCKED',
    order: 53,
  },
  ezWeave: {
    id: 'ezWeave',
    name: 'WEAVE',
    tagline: 'Auto, Q, auto',
    brief: 'Q out of the backswing, never out of the windup. The missile goes between your attacks, not instead of them.',
    transfers: 'Ezreal’s real damage: the auto you kept while casting, every single cycle.',
    group: 'EZREAL',
    axes: { kiting: 0.5, skillshot: 0.3, tempo: 0.2 },
    duration: 60,
    abilities: ['q'],
    accent: '#ff9f5c',
    keyMetric: 'AUTO-Q WEAVES',
    order: 54,
  },
  ezMaxRange: {
    id: 'ezMaxRange',
    name: 'MAX RANGE Q',
    tagline: 'The outer quarter',
    brief: 'They hold the far edge. Only the shots that land past three quarters of the missile’s range are worth full marks.',
    transfers: 'Poking from where nothing can answer — the range Ezreal is picked for.',
    group: 'EZREAL',
    axes: { spacing: 0.45, skillshot: 0.4, movement: 0.15 },
    duration: 60,
    abilities: ['q'],
    accent: '#6dffb4',
    keyMetric: 'LANDED AT MAX RANGE',
    order: 55,
  },
  ezKite: {
    id: 'ezKite',
    name: 'KITE AND Q',
    tagline: 'Aim with something on you',
    brief: 'A hunter that commits. Keep the attack cycle running, keep the distance, and keep landing the missile.',
    transfers: 'The reason ADC mechanics are hard: none of them are hard on their own.',
    group: 'EZREAL',
    axes: { kiting: 0.45, spacing: 0.25, skillshot: 0.2, movement: 0.1 },
    duration: 65,
    abilities: ['q'],
    accent: '#ff7a5c',
    keyMetric: 'ATTACK TIMING',
    order: 56,
  },
  ezShift: {
    id: 'ezShift',
    name: 'ARCANE SHIFT',
    tagline: 'Where it puts you',
    brief: 'Two shellers and a target. The blink is scored on where you land — out of their reach, still inside your own.',
    transfers: 'Treating a blink as a repositioning tool rather than an escape button you press when frightened.',
    group: 'EZREAL',
    axes: { dodging: 0.4, movement: 0.3, skillshot: 0.3 },
    duration: 65,
    abilities: ['q', 'e'],
    accent: '#7cc7ff',
    keyMetric: 'BLINKS THAT PAID',
    order: 57,
  },
  ezSwitch: {
    id: 'ezSwitch',
    name: 'TRANSFER',
    tagline: 'Onto the one that matters',
    brief: 'Three targets, one marked, and the mark keeps moving. Get the missile onto the new one before it changes again.',
    transfers: 'Retargeting a skillshot mid-fight, which is a different act from retargeting an auto.',
    group: 'EZREAL',
    axes: { targeting: 0.5, skillshot: 0.3, aim: 0.2 },
    duration: 60,
    abilities: ['q', 'w'],
    accent: '#c48bff',
    keyMetric: 'SWITCH SPEED',
    order: 58,
  },
  ezFight: {
    id: 'ezFight',
    name: 'THE FIGHT',
    tagline: 'All of it, at once',
    brief: 'A hunter, a duelist, a wave, terrain and the whole kit. Move, aim, attack, dodge and decide — simultaneously.',
    transfers: 'Playing Ezreal, rather than owning his abilities.',
    group: 'EZREAL',
    axes: { combat: 0.45, skillshot: 0.2, kiting: 0.15, movement: 0.1, dodging: 0.1 },
    duration: 0,
    abilities: ['q', 'w', 'e'],
    accent: '#ff5fa8',
    keyMetric: 'LANDED ON THE MOVE',
    order: 59,
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
    duration: 60,
    abilities: ['q', 'e'],
    accent: '#ffcf6b',
    keyMetric: 'WALL STUN RATE',
    order: 22,
  },
  vayneHunt: {
    id: 'vayneHunt',
    name: 'NIGHT HUNTER',
    tagline: 'The whole champion',
    brief: 'Terrain, the full kit including Final Hour, and a floor that refills the moment you clear it. Everything at once, the way it actually happens.',
    transfers: 'Playing Vayne — not playing an ADC who happens to own her abilities.',
    group: 'VAYNE',
    axes: { combat: 0.5, kiting: 0.2, targeting: 0.2, dodging: 0.1 },
    duration: 60,
    abilities: ['q', 'w', 'e', 'r'],
    accent: '#ff5fa8',
    keyMetric: 'KIT EXECUTION',
    order: 23,
  },
};

export const DRILL_LIST = Object.values(DRILLS).sort((a, b) => a.order - b.order);

/**
 * Does this string still name a drill?
 *
 * The catalogue is not frozen — the lab replaced thirteen in-game APM modes
 * with thirteen bench modes under new ids — but a saved profile is: it keeps
 * naming the drills it was written with, for as long as its owner keeps it.
 * So anything read back out of storage is checked here before it is used as a
 * key, because `DRILLS[somethingRemoved]` is `undefined` and the first screen
 * that asks it for its axes takes the whole client down with it.
 */
export const isDrillId = (v: unknown): v is DrillId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DRILLS, v);

/** The five calibration drills, in the order the placement runs them. */
export const PLACEMENT_SEQUENCE: DrillId[] = ['movement', 'aim', 'dodge', 'kite', 'duel1v1'];

/** Today's programme. Deliberately short enough to finish every day. */
export const DAILY_SEQUENCE: DrillId[] = ['movement', 'dodge', 'kite', 'spacing', 'duel1v1'];

/** The champion track, in the order it has to be learned. */
export const VAYNE_SEQUENCE: DrillId[] = ['vayneTumble', 'vayneBolts', 'vayneCondemn', 'vayneHunt'];

/**
 * The Ezreal path, in the order it has to be learned.
 *
 * Isolated at the top, a whole fight at the bottom, and nothing left
 * permanently isolated in between — every stage after the first one asks for
 * the previous stage's skill plus one more thing at the same time.
 */
export const EZREAL_SEQUENCE: DrillId[] = [
  'ezQ',
  'ezLead',
  'ezStrafe',
  'ezThread',
  'ezWeave',
  'ezMaxRange',
  'ezKite',
  'ezShift',
  'ezSwitch',
  'ezFight',
];

export const isVayneDrill = (id: DrillId): boolean => DRILLS[id].group === 'VAYNE';

/**
 * How much pressure a drill puts a mechanic under.
 *
 * `isolated` is the mechanic alone, on a bench, with nothing fighting back.
 * `applied` puts it in context but keeps the threat scripted. `live` is an
 * opponent that moves, targets and punishes.
 *
 * The three tiers are what make transfer measurable: a mechanic that scores
 * 90 isolated and 60 live has not been learned, it has been rehearsed, and
 * only a comparison across tiers can say so.
 */
export type PressureTier = 'isolated' | 'applied' | 'live';

export const PRESSURE_TIER: Record<DrillId, PressureTier> = {
  movement: 'isolated',
  aim: 'isolated',
  skillshot: 'isolated',
  dodge: 'isolated',
  spacing: 'applied',
  kite: 'applied',
  lasthit: 'applied',
  targetswitch: 'applied',
  combos: 'applied',
  duel1v1: 'live',
  duel1v2: 'live',
  duel1v3: 'live',
  vayneTumble: 'applied',
  vayneBolts: 'applied',
  vayneCondemn: 'applied',
  vayneHunt: 'live',
  // The academy teaches the hands first and only then puts them under fire:
  // the last two modules are the only ones with something fighting back.
  wasdMove: 'isolated',
  wasdIndep: 'isolated',
  wasdStrafe: 'isolated',
  wasdAimMove: 'isolated',
  wasdCadence: 'applied',
  wasdKite: 'applied',
  wasdOffKite: 'applied',
  wasdDefKite: 'applied',
  wasdMulti: 'live',
  // The champion path climbs the same way: mechanics on a bench, then in
  // context, then against somebody.
  ezQ: 'isolated',
  ezLead: 'isolated',
  ezStrafe: 'isolated',
  ezThread: 'applied',
  ezWeave: 'applied',
  ezMaxRange: 'applied',
  ezKite: 'applied',
  ezShift: 'applied',
  ezSwitch: 'applied',
  ezFight: 'live',
  apmPulse: 'isolated',
  apmSequence: 'isolated',
  apmChord: 'isolated',
  apmGate: 'isolated',
  apmBuffer: 'isolated',
  apmCancel: 'isolated',
  apmVector: 'isolated',
  apmField: 'isolated',
  apmHandoff: 'isolated',
  apmSplit: 'isolated',
  apmUpkeep: 'isolated',
  apmSwitch: 'isolated',
  apmSustain: 'isolated',
};

export const pressureOf = (id: DrillId): PressureTier => PRESSURE_TIER[id];

/** Every drill that trains an axis, strongest weighting first. */
export const drillsForAxis = (axis: string): DrillMeta[] =>
  DRILL_LIST.filter((d) => (d.axes as Record<string, number>)[axis] !== undefined).sort(
    (a, b) =>
      ((b.axes as Record<string, number>)[axis] ?? 0) - ((a.axes as Record<string, number>)[axis] ?? 0),
  );

/** The academy course, in the order it has to be taken. */
export const WASD_SEQUENCE: DrillId[] = [
  'wasdMove',
  'wasdIndep',
  'wasdStrafe',
  'wasdAimMove',
  'wasdCadence',
  'wasdKite',
  'wasdOffKite',
  'wasdDefKite',
  'wasdMulti',
];

export const isWasdDrill = (id: DrillId): boolean => DRILLS[id].group === 'WASD';
