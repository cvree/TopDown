/** The product's colour language. Cold instrument light, warm danger. */
export const PALETTE = {
  void: '#05070c',
  floor: '#080b12',
  floorHi: '#0d1220',
  grid: 'rgba(120,170,220,0.055)',
  gridMajor: 'rgba(130,200,255,0.10)',
  edge: 'rgba(120,190,255,0.30)',

  accent: '#58e0ff',
  accentDim: 'rgba(88,224,255,0.35)',
  accentDeep: '#1b7fa8',
  player: '#7ceaff',
  playerCore: '#eafcff',

  good: '#5ce1a8',
  warn: '#ffcf6b',
  danger: '#ff5f7e',
  hazard: '#ff8a5c',
  violet: '#b98cff',

  text: '#e8f2ff',
  textDim: '#8ea3bd',
  textFaint: '#5b6b83',
} as const;

export const RANK_COLORS: Record<string, { base: string; glow: string; metal: string }> = {
  FOUNDATION: { base: '#6f7580', glow: '#9aa3b0', metal: '#3d434c' },
  DEVELOPING: { base: '#b0754a', glow: '#e0a06a', metal: '#6b452a' },
  PROFICIENT: { base: '#a8b8c8', glow: '#dfeaf5', metal: '#63707d' },
  CALIBRATED: { base: '#e3b449', glow: '#ffd97a', metal: '#8a6a1e' },
  REFINED: { base: '#4fd6c4', glow: '#a5fff2', metal: '#1f7a70' },
  ADVANCED: { base: '#3fce74', glow: '#95ffb9', metal: '#1c7440' },
  EXPERT: { base: '#69a8ff', glow: '#bcd9ff', metal: '#2b5698' },
  ELITE: { base: '#b366ff', glow: '#e2c0ff', metal: '#5c2d92' },
  PEERLESS: { base: '#ff5f6d', glow: '#ffb3ba', metal: '#8f2530' },
  APEX: { base: '#63e7ff', glow: '#eafcff', metal: '#1d6f8c' },
};
