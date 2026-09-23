/**
 * The patch manifest.
 *
 * "Every number is League's" is a claim, and a claim with no receipt is copy.
 * This file is the receipt: every League figure the lane is built from lives
 * here once, with the patch it was checked against, how sure we are of it and
 * where it came from — and the simulation reads its numbers *from here*, so
 * the report printed in the Codex and the lane you play cannot disagree.
 *
 * The confidence labels are the research's own, and they mean exactly this:
 *
 *  - **VERIFIED** — read off a primary source: Riot's patch notes or Data
 *    Dragon.
 *  - **REPORTED** — a current secondary source: a stats site, a community
 *    dataset, a guide. Probably right; not Riot's word.
 *  - **INFERRED** — arithmetic from figures above, or a design judgement made
 *    where the source is silent. Stated as ours.
 *  - **NOT FOUND** — no current, auditable source exists that we could find.
 *    The trainer still has to pick a number to run, and says which.
 *  - **TRAINER** — deliberately *not* League's, for a reason given on the row.
 *    A trainer that bends a figure and says so is honest; one that bends it
 *    quietly is the thing this file exists to prevent.
 *
 * Nothing is filled from memory. Where the research found nothing, the row
 * says NOT FOUND and the value is the one the client has always run, marked
 * as such, rather than a plausible number presented as a fact.
 */

export type Confidence = 'VERIFIED' | 'REPORTED' | 'INFERRED' | 'NOT FOUND' | 'TRAINER';

export const CONFIDENCES: Confidence[] = ['VERIFIED', 'REPORTED', 'INFERRED', 'NOT FOUND', 'TRAINER'];

export interface Source {
  name: string;
  url: string;
  /** Publication date, or the access date where the source shows none. */
  date: string;
}

/** The patch the lane was last audited against. */
export const PATCH = {
  league: '26.18',
  dataDragon: '16.18.1',
  auditedOn: '2026-09-22',
} as const;

const S = {
  p261: { name: 'Riot patch 26.1 notes', url: 'https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/', date: '2026-01-07' },
  p263: { name: 'Riot patch 26.3 notes', url: 'https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-3-notes/', date: '2026-02-03' },
  p269: { name: 'Riot patch 26.9 notes', url: 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-9-notes/', date: '2026-04-28' },
  p2610: { name: 'Riot patch 26.10 notes', url: 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-10-notes/', date: '2026-05-12' },
  p2617: { name: 'Riot patch 26.17 notes', url: 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-17-notes/', date: '2026-08-25' },
  p25s1: { name: 'Riot patch 25.S1.1 notes', url: 'https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-s1-1-notes/', date: '2025-01-07' },
  lolnow: { name: 'LoLNow minion guide', url: 'https://lolnow.gg/lol-minions-guide-2026-everything-you-need-to-know/', date: '2026-05-20' },
  nerfGold: { name: 'Nerfplz gold guide', url: 'https://www.nerfplz.com/2026/10/lol-gold-explained-10-ways-you-get-paid.html', date: '2026-08-24' },
  nerfMinion: { name: 'Nerfplz minion guide', url: 'https://www.nerfplz.com/2026/10/minions-in-lol-10-rules-wave-plays-by.html', date: '2026-08-22' },
  nerfRange: { name: 'Nerfplz range guide', url: 'https://www.nerfplz.com/2026/11/range-explained-10-rules-of-reach.html', date: '2026-09-18' },
  mobafire: { name: 'MOBAFire kills wiki', url: 'https://www.mobafire.com/league-of-legends/wiki/game-mechanics/kills', date: '2026-09-22' },
  lvl2: { name: 'Level-2 threshold write-up', url: 'https://note.com/microcat_ganbaru/n/n73b4c8966b62?hl=en', date: '2025-06-18' },
  metaVayne: { name: 'METAsrc Vayne (26.18)', url: 'https://www.metasrc.com/lol/champions/vayne/info', date: '2026-09-22' },
  metaCait: { name: 'METAsrc Caitlyn (26.18)', url: 'https://www.metasrc.com/lol/champions/caitlyn/info', date: '2026-09-22' },
  merakiVayne: { name: 'Meraki Vayne JSON', url: 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions/Vayne.json', date: '2026-09-22' },
  merakiCait: { name: 'Meraki Caitlyn JSON', url: 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions/Caitlyn.json', date: '2026-09-22' },
  dot: { name: 'Dot Esports camera settings', url: 'https://dotesports.com/league-of-legends/news/the-best-camera-settings-in-league-of-legends', date: '2023-11-01' },
  none: { name: 'No current auditable source found', url: '', date: '2026-09-22' },
} satisfies Record<string, Source>;

// ------------------------------------------------------------- the numbers
//
// Exported one by one so the simulation imports the figure rather than a copy
// of it. A test pins every exported figure to its row below.

/** Minions leave the base at 0:30 (was 1:05 before 26.1). */
export const MINION_FIRST_SPAWN = 30;
/** Seconds between waves before 14:00. */
export const WAVE_INTERVAL = 30;
/** Every third wave carries the cannon before 15:00; the first is wave three. */
export const CANNON_EVERY = 3;
/** Lane minion movement speed (325 → 350 in 26.1). */
export const MINION_MOVE_SPEED = 350;

export const MELEE = { hp: 430, ad: 11, gold: 20, xp: 62, vsMinionPct: 0.02 } as const;
export const CASTER = { hp: 284, ad: 21, gold: 14, xp: 31, vsMinionPct: 0.035 } as const;
export const CANNON = { hp: 920, ad: 39, gold: 50, xp: 75, vsMinionPct: 0.05 } as const;

/** How far from a dying minion you can stand and still be paid its experience. */
export const MINION_XP_RANGE = 1500;
/** How far a minion looks for something to hit. */
export const MINION_ACQUIRE = 500;

/** Outer turret. Its reach and minion shot were not re-audited this cut. */
export const TURRET_RANGE = 775;
export const TURRET_SHOT = 152;
/** Each consecutive shot into a champion adds 50%, to 250% at three stacks. */
export const TURRET_HEAT_PER_STACK = 0.5;
export const TURRET_HEAT_STACKS = 3;
export const TURRET_HP = 9000;
export const PLATE_GOLD = 120;

/** Passive gold starts at 1:05 in 26.1 (it used to be 1:50). */
export const PASSIVE_GOLD_FROM = 65;
export const PASSIVE_GOLD_PER_SEC = 2.04;
export const KILL_GOLD = 300;
export const FIRST_BLOOD_GOLD = 400;

/** Experience to leave level 1, and the step each level after adds. */
export const XP_LEVEL_TWO = 280;
export const XP_LEVEL_STEP = 100;

export const VAYNE_26_18 = {
  hp: { base: 580, growth: 98 },
  armor: { base: 23, growth: 4.6 },
  ad: { base: 60, growth: 2.35 },
  attackSpeed: { base: 0.658, growthPct: 2.8 },
  mana: { base: 232, growth: 35, regen: 7, regenGrowth: 0.4 },
  qCostByRank: [46, 42, 38, 34, 30],
  range: 550,
  moveSpeed: 330,
} as const;

export const CAITLYN_26_18 = {
  hp: { base: 580, growth: 107 },
  armor: { base: 27, growth: 4.7 },
  ad: { base: 62, growth: 3.8 },
  attackSpeed: { base: 0.681, growthPct: 4 },
  mana: { base: 315, growth: 40, regen: 7.4, regenGrowth: 0.7 },
  qCostByRank: [55, 60, 65, 70, 75],
  wCost: 20,
  eCost: 75,
  rCost: 100,
  qDamageByRank: [50, 90, 130, 170, 210],
  qAdRatioByRank: [1.25, 1.45, 1.65, 1.85, 2.05],
  eDamageByRank: [80, 130, 180, 230, 280],
  rDamageByRank: [300, 475, 650],
  range: 650,
  moveSpeed: 325,
} as const;

// ------------------------------------------------------------- the report

export type FactGroup = 'WAVE' | 'MINIONS' | 'TURRET' | 'ECONOMY' | 'LEVELS' | 'VAYNE' | 'CAITLYN' | 'CAMERA & INPUT';

export interface Fact {
  id: string;
  group: FactGroup;
  label: string;
  /** League's figure, as printed. */
  league: string;
  /** What this client runs, as printed. Equal to `league` unless it says otherwise. */
  trainer: string;
  confidence: Confidence;
  source: Source;
  /** Why, where the row needs one. */
  note?: string;
  /** False where the figure is known but the system is not simulated at all. */
  modelled: boolean;
}

const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;
const same = (s: string) => ({ league: s, trainer: s });

export const FACTS: Fact[] = [
  // ---- wave
  { id: 'spawn', group: 'WAVE', label: 'First minion spawn', ...same('0:30'), confidence: 'VERIFIED', source: S.p261, modelled: true, note: 'Moved from 1:05 in 26.1. The lane opens on the first wave meeting, so the clock starts shortly after.' },
  { id: 'meet', group: 'WAVE', label: 'First wave meets in lane', league: 'not published', trainer: '0:55', confidence: 'INFERRED', source: S.none, modelled: true, note: 'Spawn time and move speed are verified; the walk is not. 0:55 keeps the old spawn-to-meet walk at the new speed. Measure in Practice Tool before trusting it to the second.' },
  { id: 'interval', group: 'WAVE', label: 'Wave interval before 14:00', ...same('30 s'), confidence: 'VERIFIED', source: S.p261, modelled: true, note: '25 s from 14:00 and 20 s from 30:00 — the lane never reaches either.' },
  { id: 'cannon', group: 'WAVE', label: 'Cannon minion', ...same('wave 3, then every 3rd'), confidence: 'VERIFIED', source: S.p261, modelled: true, note: 'Wave 3 is VERIFIED; "every third through 14:59" is REPORTED (LoLNow, 2026-05-20).' },
  { id: 'speed', group: 'WAVE', label: 'Minion move speed', ...same(`${MINION_MOVE_SPEED}`), confidence: 'VERIFIED', source: S.p261, modelled: true, note: '325 → 350 in 26.1.' },
  { id: 'aggro', group: 'WAVE', label: 'Hitting an allied minion draws aggro', ...same('no'), confidence: 'VERIFIED', source: S.p2610, modelled: true, note: 'Removed in 26.10. Only attacking a champion turns the wave on you here, which is the rule after that patch.' },
  { id: 'acquire', group: 'WAVE', label: 'Minion acquisition range', ...same(`${MINION_ACQUIRE}`), confidence: 'REPORTED', source: S.nerfMinion, modelled: true, note: 'Low confidence — the same guide has a stale spawn time. Call-for-help (1,000) and leash are not modelled separately.' },

  // ---- minions
  { id: 'meleeHp', group: 'MINIONS', label: 'Melee health', ...same(`${MELEE.hp}`), confidence: 'VERIFIED', source: S.p269, modelled: true, note: '+35 every 90 s — growth that starts after the lane is over.' },
  { id: 'meleeAd', group: 'MINIONS', label: 'Melee attack damage', ...same(`${MELEE.ad}`), confidence: 'VERIFIED', source: S.p25s1, modelled: true, note: 'The 25.S1.1 endpoint (11 → 80), current unless changed since.' },
  { id: 'meleeGold', group: 'MINIONS', label: 'Melee gold', ...same(`${MELEE.gold}`), confidence: 'VERIFIED', source: S.p261, modelled: true },
  { id: 'meleeXp', group: 'MINIONS', label: 'Melee experience', ...same(`${MELEE.xp}`), confidence: 'VERIFIED', source: S.p261, modelled: true },
  { id: 'meleePct', group: 'MINIONS', label: 'Melee bonus vs lane minions', ...same(`${pct(MELEE.vsMinionPct)} current HP`), confidence: 'VERIFIED', source: S.p269, modelled: true },
  { id: 'casterHp', group: 'MINIONS', label: 'Caster health', ...same(`${CASTER.hp}`), confidence: 'VERIFIED', source: S.p25s1, modelled: true, note: 'The 25.S1.1 early endpoint (284 → 600).' },
  { id: 'casterAd', group: 'MINIONS', label: 'Caster attack damage', ...same(`${CASTER.ad}`), confidence: 'VERIFIED', source: S.p25s1, modelled: true },
  { id: 'casterGold', group: 'MINIONS', label: 'Caster gold', ...same(`${CASTER.gold}`), confidence: 'REPORTED', source: S.lolnow, modelled: true },
  { id: 'casterXp', group: 'MINIONS', label: 'Caster experience', ...same(`${CASTER.xp}`), confidence: 'VERIFIED', source: S.p261, modelled: true },
  { id: 'casterPct', group: 'MINIONS', label: 'Caster bonus vs lane minions', ...same(`${pct(CASTER.vsMinionPct)} current HP`), confidence: 'VERIFIED', source: S.p269, modelled: true, note: '4% → 3.5% in 26.9.' },
  { id: 'cannonHp', group: 'MINIONS', label: 'Cannon health', ...same(`${CANNON.hp}`), confidence: 'VERIFIED', source: S.p25s1, modelled: true },
  { id: 'cannonAd', group: 'MINIONS', label: 'Cannon attack damage', ...same(`${CANNON.ad}`), confidence: 'VERIFIED', source: S.p261, modelled: true },
  { id: 'cannonGold', group: 'MINIONS', label: 'Cannon gold', ...same(`${CANNON.gold}`), confidence: 'VERIFIED', source: S.p261, modelled: true, note: '+1 every 90 s, which the lane does not run long enough to see.' },
  { id: 'cannonXp', group: 'MINIONS', label: 'Cannon experience', ...same(`${CANNON.xp}`), confidence: 'VERIFIED', source: S.p261, modelled: true },
  { id: 'cannonPct', group: 'MINIONS', label: 'Cannon bonus vs lane minions', ...same(`${pct(CANNON.vsMinionPct)} current HP`), confidence: 'VERIFIED', source: S.p269, modelled: true },
  { id: 'minionVsChamp', group: 'MINIONS', label: 'Minion damage to champions', league: '55% (last published)', trainer: '100%', confidence: 'NOT FOUND', source: S.p25s1, modelled: false, note: 'The last explicit Riot figure is from 25.S1.1 and we could not confirm it is still live, so it is not applied.' },

  // ---- turret
  { id: 'turretRange', group: 'TURRET', label: 'Outer turret reach', ...same(`${TURRET_RANGE}`), confidence: 'NOT FOUND', source: S.none, modelled: true, note: 'Carried from earlier builds. Not re-audited in this research cut.' },
  { id: 'turretShot', group: 'TURRET', label: 'Turret shot into a minion', league: 'not published', trainer: `${TURRET_SHOT}`, confidence: 'NOT FOUND', source: S.none, modelled: true, note: `Riot publishes the bonus-AD ramp, not the base shot or the per-minion table. At ${TURRET_SHOT} a caster is two shots and a melee three.` },
  { id: 'turretHeat', group: 'TURRET', label: 'Heat into a champion', ...same(`+${pct(TURRET_HEAT_PER_STACK)} a shot, to 250%`), confidence: 'VERIFIED', source: S.p25s1, modelled: true, note: 'Heat lasts five seconds. Here it resets when the turret changes target, which is the case that matters in a dive.' },
  { id: 'turretHp', group: 'TURRET', label: 'Outer turret health', league: `${TURRET_HP.toLocaleString('en-US')}`, trainer: 'untargetable', confidence: 'VERIFIED', source: S.p261, modelled: false, note: 'Taking a turret is not what the first ten minutes teach. It is here so the number is on record.' },
  { id: 'plates', group: 'TURRET', label: 'Plate gold', league: `${PLATE_GOLD} each, 5 plates`, trainer: 'not modelled', confidence: 'VERIFIED', source: S.p261, modelled: false, note: 'Thresholds at 10/25/45/70/100% missing HP. Beware 2026 guides still quoting 125.' },
  { id: 'trueSight', group: 'TURRET', label: 'Turret true sight', league: '1,100', trainer: 'not modelled', confidence: 'VERIFIED', source: S.p261, modelled: false },
  { id: 'bulwark', group: 'TURRET', label: 'Bulwark resists', league: '30–50 by nearby enemies', trainer: 'not modelled', confidence: 'VERIFIED', source: S.p263, modelled: false },

  // ---- economy
  { id: 'passiveFrom', group: 'ECONOMY', label: 'Passive gold starts', ...same('1:05'), confidence: 'VERIFIED', source: S.p261, modelled: true, note: 'It was 1:50. Both laners are paid it.' },
  { id: 'passiveRate', group: 'ECONOMY', label: 'Passive gold rate', ...same('20.4 per 10 s'), confidence: 'REPORTED', source: S.nerfGold, modelled: true },
  { id: 'startGold', group: 'ECONOMY', label: 'Starting gold', league: '500', trainer: 'no shop', confidence: 'REPORTED', source: S.nerfGold, modelled: false, note: 'Without a shop gold is the scoreboard, so a starting purse would be a constant added to both sides.' },
  { id: 'kill', group: 'ECONOMY', label: 'Kill on an even champion', ...same(`${KILL_GOLD}`), confidence: 'REPORTED', source: S.mobafire, modelled: true, note: 'Bounties and shutdowns are not modelled.' },
  { id: 'firstBlood', group: 'ECONOMY', label: 'First blood', ...same(`${FIRST_BLOOD_GOLD}`), confidence: 'REPORTED', source: S.mobafire, modelled: true, note: 'Riot confirms the first-blood bonus returned in 26.1 but does not print the amount.' },
  { id: 'assist', group: 'ECONOMY', label: 'Assist gold formula', league: 'not published', trainer: 'n/a (1 v 1)', confidence: 'NOT FOUND', source: S.none, modelled: false },

  // ---- levels
  { id: 'xpRange', group: 'LEVELS', label: 'Minion experience range', ...same(`${MINION_XP_RANGE.toLocaleString('en-US')}`), confidence: 'VERIFIED', source: S.p25s1, modelled: true, note: '1,400 → 1,500 in 25.S1.1. Plenty of guides still say 1,400.' },
  { id: 'lvl2', group: 'LEVELS', label: 'Experience for level 2', ...same(`${XP_LEVEL_TWO}`), confidence: 'REPORTED', source: S.lvl2, modelled: true },
  { id: 'lvl2Solo', group: 'LEVELS', label: 'Solo level 2', ...same('7th minion'), confidence: 'INFERRED', source: S.p261, modelled: true, note: `A first wave is 3×${MELEE.xp} + 3×${CASTER.xp} = ${3 * MELEE.xp + 3 * CASTER.xp}, one short of ${XP_LEVEL_TWO}. The next melee does it.` },
  { id: 'lvl3', group: 'LEVELS', label: 'Experience for level 3', ...same(`${XP_LEVEL_TWO * 2 + XP_LEVEL_STEP}`), confidence: 'INFERRED', source: S.none, modelled: true, note: 'The standard cumulative 660. Not located in a current primary source; validate once in Practice Tool.' },
  { id: 'lvl3Solo', group: 'LEVELS', label: 'Solo level 3', ...same('14th minion'), confidence: 'INFERRED', source: S.p261, modelled: true, note: `Two waves are ${2 * (3 * MELEE.xp + 3 * CASTER.xp)}; the second melee of wave three crosses 660.` },

  // ---- vayne
  { id: 'vHp', group: 'VAYNE', label: 'Health + growth', ...same(`${VAYNE_26_18.hp.base} +${VAYNE_26_18.hp.growth}`), confidence: 'VERIFIED', source: S.p2617, modelled: true },
  { id: 'vAd', group: 'VAYNE', label: 'Attack damage + growth', ...same(`${VAYNE_26_18.ad.base} +${VAYNE_26_18.ad.growth}`), confidence: 'REPORTED', source: S.metaVayne, modelled: true, note: 'Growth comes from a community file that is stale elsewhere — medium confidence.' },
  { id: 'vAs', group: 'VAYNE', label: 'Attack speed + growth', ...same(`${VAYNE_26_18.attackSpeed.base} +${VAYNE_26_18.attackSpeed.growthPct}%`), confidence: 'VERIFIED', source: S.p2617, modelled: true, note: 'Ratio and growth VERIFIED in 26.17; the base is REPORTED.' },
  { id: 'vArmor', group: 'VAYNE', label: 'Armour + growth', ...same(`${VAYNE_26_18.armor.base} +${VAYNE_26_18.armor.growth}`), confidence: 'REPORTED', source: S.metaVayne, modelled: true, note: 'Folded into the health pool; both laners deal physical damage, so one multiplication is exact.' },
  { id: 'vMana', group: 'VAYNE', label: 'Mana, regen', ...same(`${VAYNE_26_18.mana.base} +${VAYNE_26_18.mana.growth}, ${VAYNE_26_18.mana.regen} +${VAYNE_26_18.mana.regenGrowth} /5s`), confidence: 'REPORTED', source: S.metaVayne, modelled: true },
  { id: 'vQCost', group: 'VAYNE', label: 'Tumble mana', ...same(VAYNE_26_18.qCostByRank.join('/')), confidence: 'VERIFIED', source: S.p2617, modelled: true },
  { id: 'vRange', group: 'VAYNE', label: 'Range, move speed', ...same(`${VAYNE_26_18.range}, ${VAYNE_26_18.moveSpeed}`), confidence: 'REPORTED', source: S.metaVayne, modelled: true },
  { id: 'vWindup', group: 'VAYNE', label: 'Attack windup', league: '17.54%', trainer: '16.67%', confidence: 'INFERRED', source: S.merakiVayne, modelled: true, note: 'From community internal fields in a file visibly stale elsewhere. Not changed until confirmed against the 16.18.1 data.' },
  { id: 'vW', group: 'VAYNE', label: 'Silver Bolts true damage', ...same('4–10% max HP, min 40–100'), confidence: 'VERIFIED', source: S.p2617, modelled: true },

  // ---- caitlyn
  { id: 'cHp', group: 'CAITLYN', label: 'Health + growth', ...same(`${CAITLYN_26_18.hp.base} +${CAITLYN_26_18.hp.growth}`), confidence: 'REPORTED', source: S.metaCait, modelled: true },
  { id: 'cAd', group: 'CAITLYN', label: 'Attack damage + growth', ...same(`${CAITLYN_26_18.ad.base} +${CAITLYN_26_18.ad.growth}`), confidence: 'REPORTED', source: S.metaCait, modelled: true, note: 'It was 60 here before this audit.' },
  { id: 'cAs', group: 'CAITLYN', label: 'Attack speed + growth', ...same(`${CAITLYN_26_18.attackSpeed.base} +${CAITLYN_26_18.attackSpeed.growthPct}%`), confidence: 'REPORTED', source: S.metaCait, modelled: true },
  { id: 'cRange', group: 'CAITLYN', label: 'Range, move speed', ...same(`${CAITLYN_26_18.range}, ${CAITLYN_26_18.moveSpeed}`), confidence: 'REPORTED', source: S.metaCait, modelled: true },
  { id: 'cQ', group: 'CAITLYN', label: 'Peacemaker', ...same('50–210 +125–205% AD'), confidence: 'REPORTED', source: S.merakiCait, modelled: true, note: 'The AD ratio now climbs with rank; it was a flat 130% here.' },
  { id: 'cCost', group: 'CAITLYN', label: 'Mana costs Q / W / E / R', ...same(`${CAITLYN_26_18.qCostByRank[0]}–${CAITLYN_26_18.qCostByRank[4]} / ${CAITLYN_26_18.wCost} / ${CAITLYN_26_18.eCost} / ${CAITLYN_26_18.rCost}`), confidence: 'REPORTED', source: S.merakiCait, modelled: true },
  { id: 'cE', group: 'CAITLYN', label: '90 Caliber Net', ...same('80–280'), confidence: 'REPORTED', source: S.merakiCait, modelled: true },
  { id: 'cR', group: 'CAITLYN', label: 'Ace in the Hole', ...same('300/475/650'), confidence: 'REPORTED', source: S.metaCait, modelled: true },

  // ---- camera & input
  { id: 'zoom', group: 'CAMERA & INPUT', label: 'Default / max zoom distance', league: 'not published', trainer: '≈2,300 units across', confidence: 'NOT FOUND', source: S.none, modelled: true, note: 'The framing is set a shade inside the ~2,900 units the game shows, by eye. It needs a calibration-grid capture to be anything better.' },
  { id: 'fov', group: 'CAMERA & INPUT', label: 'Field of view, pitch', league: 'not published', trainer: 'chosen by eye', confidence: 'NOT FOUND', source: S.none, modelled: true, note: 'A tilted camera picked to read like the game. Fitting a projection to 1080p captures over a ground grid is the only honest way to do better.' },
  { id: 'edgePan', group: 'CAMERA & INPUT', label: 'Edge-pan speed, trigger zone', league: 'not published', trainer: 'settings slider', confidence: 'NOT FOUND', source: S.dot, modelled: true, note: 'Settings articles give recommendations, not the engine constants.' },
  { id: 'camKeys', group: 'CAMERA & INPUT', label: 'Y locks, Space centres', ...same('yes'), confidence: 'REPORTED', source: S.dot, modelled: true },
  { id: 'tick', group: 'CAMERA & INPUT', label: 'Server tick rate', league: '≈30 Hz (community)', trainer: '240 Hz fixed step', confidence: 'NOT FOUND', source: S.none, modelled: false, note: 'No Riot source. Not marketed as "League\'s 30 Hz" until one exists.' },
  { id: 'range', group: 'CAMERA & INPUT', label: 'How attack range is measured', ...same('edge to edge'), confidence: 'REPORTED', source: S.nerfRange, modelled: true, note: 'Listed range plus both gameplay radii, centre to centre.' },
];

/** Counts by confidence, for the header of the report. */
export const factTally = (facts: readonly Fact[] = FACTS): Record<Confidence, number> => {
  const out = Object.fromEntries(CONFIDENCES.map((c) => [c, 0])) as Record<Confidence, number>;
  for (const f of facts) out[f.confidence]++;
  return out;
};

export const FACT_GROUPS: FactGroup[] = ['WAVE', 'MINIONS', 'TURRET', 'ECONOMY', 'LEVELS', 'VAYNE', 'CAITLYN', 'CAMERA & INPUT'];
