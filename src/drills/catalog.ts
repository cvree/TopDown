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
  /* --- the APM trainer. One engine, thirteen ways to be measured by it --- */
  | 'apmAim'
  | 'apmAim2'
  | 'apmAimMap'
  | 'apmPrecision'
  | 'apmKeys'
  | 'apmDodge'
  | 'apmDodgeCd'
  | 'apmKite'
  | 'apmDefKite'
  | 'apmLastHit'
  | 'apmLastHit2'
  | 'apmSpacing'
  | 'apmSmite';

export type DrillGroup = 'FOUNDATION' | 'RHYTHM' | 'COMBAT' | 'WASD' | 'APM' | 'VAYNE';

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
    tagline: 'Hold the edge',
    brief: 'Stay at the outer edge of your range. Too close is punished, too far wastes damage.',
    transfers: 'Trading from max range instead of drifting into the enemy threat range.',
    group: 'RHYTHM',
    axes: { spacing: 0.8, movement: 0.2 },
    duration: 60,
    abilities: [],
    accent: '#5ce1a8',
    keyMetric: 'SPACING ERROR',
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
  // Thirteen modes over one engine. Every one of them counts the same thing —
  // correct commands per minute — and every one of them refuses to count an
  // input that did not mean anything, which is what separates this from a
  // click-speed test. The flow ladder is shared: chain your actions and the
  // multiplier climbs through five tiers, break and it is gone.
  apmAim: {
    id: 'apmAim',
    name: 'AIM',
    tagline: 'Raw click rate',
    brief: 'Marks light up and die fast. No decoys, no order — just how many correct commands a minute your hand makes.',
    transfers: 'The ceiling on everything else you do with a mouse in a fight.',
    group: 'APM',
    axes: { tempo: 0.7, aim: 0.3 },
    duration: 45,
    abilities: [],
    accent: '#7ceaff',
    keyMetric: 'SUSTAINED APM',
    order: 30,
  },
  apmAim2: {
    id: 'apmAim2',
    name: 'AIM 2',
    tagline: 'Rate, with a read on top',
    brief: 'The marks are numbered and only the lowest one is legal. Speed now costs you a decision.',
    transfers: 'Clicking the champion you meant while three of them are on the screen.',
    group: 'APM',
    axes: { tempo: 0.55, targeting: 0.3, aim: 0.15 },
    duration: 50,
    abilities: [],
    accent: '#8ad4ff',
    keyMetric: 'SUSTAINED APM',
    order: 31,
  },
  apmAimMap: {
    id: 'apmAimMap',
    name: 'AIM + MAP',
    tagline: 'Two screens, one pair of hands',
    brief: 'Keep clicking marks in the middle while alerts flash at the rim. Red wants D, blue wants F, both die in a second.',
    transfers: 'Answering the minimap without dropping whatever your hands were already doing.',
    group: 'APM',
    axes: { tempo: 0.5, targeting: 0.3, aim: 0.2 },
    duration: 55,
    abilities: ['d', 'f'],
    accent: '#9fc4ff',
    keyMetric: 'SUSTAINED APM',
    order: 32,
  },
  apmPrecision: {
    id: 'apmPrecision',
    name: 'MOUSE PRECISION',
    tagline: 'Speed measured in pixels',
    brief: 'Small drifting marks, graded on how far from the centre you land. They shrink as your chain grows.',
    transfers: 'Landing on the champion rather than the ground beside them when your hand is already moving.',
    group: 'APM',
    axes: { tempo: 0.5, aim: 0.5 },
    duration: 45,
    abilities: [],
    accent: '#b8e4ff',
    keyMetric: 'SUSTAINED APM',
    order: 33,
  },
  apmKeys: {
    id: 'apmKeys',
    name: 'KEY COORDINATION',
    tagline: 'The left hand, alone',
    brief: 'A queue of keys runs above your champion. Answer the front one, read two ahead, never touch the mouse.',
    transfers: 'Combos coming out clean while your other hand is busy steering.',
    group: 'APM',
    axes: { tempo: 0.65, targeting: 0.35 },
    duration: 45,
    abilities: ['q', 'w', 'e', 'r', 'd', 'f'],
    accent: '#c48bff',
    keyMetric: 'SUSTAINED APM',
    order: 34,
  },
  apmDodge: {
    id: 'apmDodge',
    name: 'DODGE',
    tagline: 'Movement APM',
    brief: 'Charges to collect, telegraphs to leave. Standing still is safe for about a second and then it is not.',
    transfers: 'Repositioning constantly instead of in bursts when something lands on you.',
    group: 'APM',
    axes: { tempo: 0.45, dodging: 0.35, movement: 0.2 },
    duration: 60,
    abilities: [],
    accent: '#ffcf6b',
    keyMetric: 'SUSTAINED APM',
    order: 35,
  },
  apmDodgeCd: {
    id: 'apmDodgeCd',
    name: 'DODGE + COOLDOWN',
    tagline: 'Both hands at once',
    brief: 'Everything the dodge mode asks, plus four cooldowns that must be spent the moment they come up.',
    transfers: 'Never sitting on an ability because your feet were busy.',
    group: 'APM',
    axes: { tempo: 0.4, dodging: 0.3, combat: 0.3 },
    duration: 65,
    abilities: ['q', 'w', 'e', 'r'],
    accent: '#ffb45c',
    keyMetric: 'SUSTAINED APM',
    order: 36,
  },
  apmKite: {
    id: 'apmKite',
    name: 'KITING',
    tagline: 'Attack, move, attack — at rate',
    brief: 'A pace dummy that cannot hurt you. The only question is whether you can hold a full attack cycle for a minute.',
    transfers: 'Orbwalking at the speed a real fight moves rather than the speed a drill lets you.',
    group: 'APM',
    axes: { tempo: 0.45, kiting: 0.4, spacing: 0.15 },
    duration: 60,
    abilities: [],
    accent: '#5ce1a8',
    keyMetric: 'SUSTAINED APM',
    order: 37,
  },
  apmDefKite: {
    id: 'apmDefKite',
    name: 'DEFENSIVE KITING',
    tagline: 'The rhythm, running backwards',
    brief: 'Divers that want to reach you. Same cycle, except every step now has a direction it has to be in.',
    transfers: 'Kiting a gap-closer down without giving up your own damage to do it.',
    group: 'APM',
    axes: { tempo: 0.35, kiting: 0.35, spacing: 0.2, dodging: 0.1 },
    duration: 60,
    abilities: [],
    accent: '#4fd6c4',
    keyMetric: 'SUSTAINED APM',
    order: 38,
  },
  apmLastHit: {
    id: 'apmLastHit',
    name: 'LAST HIT',
    tagline: 'A whole wave, at rate',
    brief: 'The lane, with the next wave already walking. Take every minion that is yours and swing at nothing that is not.',
    transfers: 'Taking the whole wave instead of the two bars you happened to be looking at.',
    group: 'APM',
    axes: { tempo: 0.4, lastHitting: 0.45, targeting: 0.15 },
    duration: 70,
    abilities: [],
    accent: '#ffd166',
    keyMetric: 'SUSTAINED APM',
    zoom: 0.7,
    order: 39,
  },
  apmLastHit2: {
    id: 'apmLastHit2',
    name: 'LAST HIT 2',
    tagline: 'The same wave, contested',
    brief: 'An enemy laner opposite doing your job. Every minion is a race now, and the HUD keeps the score.',
    transfers: 'Winning the farm race against someone whose windup is the clock, not yours.',
    group: 'APM',
    axes: { tempo: 0.35, lastHitting: 0.45, targeting: 0.2 },
    duration: 75,
    abilities: [],
    accent: '#ffab5c',
    keyMetric: 'SUSTAINED APM',
    zoom: 0.7,
    order: 40,
  },
  apmSpacing: {
    id: 'apmSpacing',
    name: 'SPACING',
    tagline: 'The band, on a beat',
    brief: 'Max range, step in, disengage. The call changes every beat and the beat speeds up as you climb.',
    transfers: 'Changing the gap on purpose the moment a cooldown comes up, instead of drifting.',
    group: 'APM',
    axes: { tempo: 0.4, spacing: 0.45, movement: 0.15 },
    duration: 55,
    abilities: [],
    accent: '#6be0a0',
    keyMetric: 'SUSTAINED APM',
    order: 41,
  },
  apmSmite: {
    id: 'apmSmite',
    name: 'SMITE',
    tagline: 'The execute, on a clock you do not own',
    brief: 'Three objectives burning down in three places, one smite, and a rival with his finger on the same key.',
    transfers: 'Being stood on the camp before the window opens — which is the whole skill.',
    group: 'APM',
    axes: { tempo: 0.4, lastHitting: 0.35, movement: 0.25 },
    duration: 60,
    abilities: ['d'],
    accent: '#ff9f5c',
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
