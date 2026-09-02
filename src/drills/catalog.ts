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
  | 'vayneHunt';

export type DrillGroup = 'FOUNDATION' | 'RHYTHM' | 'COMBAT' | 'VAYNE';

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
    tagline: 'The killing blow',
    brief: 'Minions are taking damage. Land the final hit — not early, not late.',
    transfers: 'CS timing: reading a health bar against your own attack windup.',
    group: 'RHYTHM',
    axes: { lastHitting: 0.85, aim: 0.15 },
    duration: 70,
    abilities: [],
    accent: '#ffd166',
    keyMetric: 'CS ACCURACY',
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
