import { isDrillId, type DrillId } from '../drills/catalog';
import { PLAY_SECONDS } from '../drills/modes';
import { clamp } from '../engine/math';
import { APM_LEVELS, levelDifficulty } from './apmladder';
import { LANE_LENGTHS, LANE_TIERS } from './lane';

/**
 * A FAVOURITE, AS YOU EDITED IT.
 *
 * Starring a card used to be a bookmark and nothing else. It is now also the
 * moment a player gets to say how they want that activity: how long a run is,
 * how hard, how fast the arena moves and how big everything they have to hit
 * is. Those answers are kept per activity, travel into every playlist it is
 * added to, and go with the playlist when it is shared.
 *
 * Two kinds of answer, and the difference matters for records:
 *
 *  - **Choices any card already offers** — the level, the lane's opponent and
 *    one of the lane's lengths, whether the fog is down, when the range ring is
 *    drawn. A run on these is an ordinary run and is recorded like one.
 *  - **Choices no card offers** — a length other than the standard one, the
 *    arena's speed, the size of the targets. A run on these is a *custom* run:
 *    it is scored so you can see how it went, and it writes nothing, because a
 *    record set on double-size targets is not a record anybody else can beat.
 */

/** When the range ring is drawn, or `auto` for whatever SETUP says. */
export type TuningRange = 'auto' | 'check' | 'always' | 'off';
/** Whether the modes built on vision get their fog, or `auto` for SETUP's answer. */
export type TuningFog = 'auto' | 'on' | 'off';

export interface ActivityTuning {
  /** Seconds a run lasts, on the wall clock. */
  seconds: number;
  /** 1..10, or null for the level the card would pick for you. Not the lane. */
  level: number | null;
  /** How fast the whole arena runs, 1 being the real game. */
  speed: number;
  /** How big every target is — pads, enemies, minions — 1 being standard. */
  size: number;
  fog: TuningFog;
  range: TuningRange;
  /** THE LANE only: which opponent, by tier id. Null is the card's own. */
  tier: string | null;
}

/** What the arena itself needs from a tuning. */
export interface RunTuning {
  speed: number;
  size: number;
  /** Absent means "whatever SETUP says". */
  fog?: boolean;
  range?: 'check' | 'always' | 'off';
}

export const SECONDS_MIN = 10;
export const SECONDS_MAX = 600;
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;
export const SIZE_MIN = 0.5;
export const SIZE_MAX = 2;

/** The standard length of a run of this activity. */
export const standardSeconds = (id: DrillId): number => (id === 'lanePhase' ? LANE_LENGTHS[0].seconds : PLAY_SECONDS);

export const defaultTuning = (id: DrillId): ActivityTuning => ({
  seconds: standardSeconds(id),
  level: null,
  speed: 1,
  size: 1,
  fog: 'auto',
  range: 'auto',
  tier: null,
});

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** A length the activity's own card offers. */
const standardLength = (id: DrillId, seconds: number): boolean =>
  id === 'lanePhase' ? LANE_LENGTHS.some((l) => l.seconds === seconds) : seconds === PLAY_SECONDS;

/**
 * Whether a run on this tuning is a custom run: scored, and written to nothing.
 * See the note at the top of this file for which answers make it one.
 */
export const isCustom = (id: DrillId, t: ActivityTuning | null | undefined): boolean =>
  !!t && (!standardLength(id, t.seconds) || !near(t.speed, 1) || !near(t.size, 1));

/** Whether anything at all differs from how the card would start it. */
export const isEdited = (id: DrillId, t: ActivityTuning | null | undefined): boolean => {
  if (!t) return false;
  const d = defaultTuning(id);
  return (
    t.seconds !== d.seconds ||
    t.level !== d.level ||
    !near(t.speed, d.speed) ||
    !near(t.size, d.size) ||
    t.fog !== d.fog ||
    t.range !== d.range ||
    t.tier !== d.tier
  );
};

const num = (v: unknown, lo: number, hi: number, fallback: number, step = 0): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const c = clamp(n, lo, hi);
  return step > 0 ? Math.round(c / step) * step : c;
};

/** A tuning read from anywhere untrusted — a stored profile or a friend's code. */
export const sanitizeTuning = (id: DrillId, raw: unknown): ActivityTuning => {
  const d = defaultTuning(id);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const level = r.level === null || r.level === undefined ? null : num(r.level, 1, APM_LEVELS, NaN, 1);
  return {
    seconds: num(r.seconds, SECONDS_MIN, SECONDS_MAX, d.seconds, 1),
    level: id === 'lanePhase' || level === null || Number.isNaN(level) ? null : level,
    speed: Number(num(r.speed, SPEED_MIN, SPEED_MAX, 1).toFixed(2)),
    size: Number(num(r.size, SIZE_MIN, SIZE_MAX, 1).toFixed(2)),
    fog: r.fog === 'on' || r.fog === 'off' ? r.fog : 'auto',
    range: r.range === 'check' || r.range === 'always' || r.range === 'off' ? r.range : 'auto',
    tier: id === 'lanePhase' && typeof r.tier === 'string' && LANE_TIERS.some((t) => t.id === r.tier) ? r.tier : null,
  };
};

/** What the arena is handed, or null when nothing it reads was changed. */
export const runTuningOf = (t: ActivityTuning | null | undefined): RunTuning | null => {
  if (!t) return null;
  const out: RunTuning = { speed: t.speed, size: t.size };
  if (t.fog !== 'auto') out.fog = t.fog === 'on';
  if (t.range !== 'auto') out.range = t.range;
  return near(t.speed, 1) && near(t.size, 1) && out.fog === undefined && out.range === undefined ? null : out;
};

/**
 * The start options a tuning implies, in the shape the shell's `startRun`
 * takes. `level` is only handed over for a lab drill, where it is the rung the
 * record is kept on; everywhere else the level is just a difficulty.
 */
export const tunedOpts = (
  id: DrillId,
  t: ActivityTuning,
  base: { difficulty?: number; duration?: number; level?: number },
  isLab: boolean,
): { difficulty?: number; duration?: number; level?: number } => {
  const out = { ...base, duration: t.seconds };
  if (id === 'lanePhase') {
    const tier = LANE_TIERS.find((x) => x.id === t.tier);
    if (tier) out.difficulty = tier.difficulty;
    return out;
  }
  if (t.level !== null) {
    out.difficulty = levelDifficulty(t.level);
    if (isLab) out.level = t.level;
    else delete out.level;
  }
  return out;
};

// ------------------------------------------------------------- sharing

/** A playlist as it travels: a name, and each activity with its settings. */
export interface SharedPlaylist {
  name: string;
  items: DrillId[];
  tunings: ActivityTuning[];
}

const CODE_PREFIX = 'APX1.';

const toBase64Url = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string): string => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/**
 * A playlist as one line of text.
 *
 * Only the answers that differ from an activity's defaults are written, so a
 * playlist of untouched cards is a short code — and a code made by this build
 * still reads the same in a later one whose defaults moved, because anything
 * left out is read as "whatever that build's card does".
 */
export const encodePlaylist = (pl: SharedPlaylist): string => {
  const items = pl.items.map((id, i) => {
    const t = pl.tunings[i] ?? defaultTuning(id);
    const d = defaultTuning(id);
    const o: Record<string, unknown> = { d: id };
    if (t.seconds !== d.seconds) o.s = t.seconds;
    if (t.level !== null) o.l = t.level;
    if (!near(t.speed, 1)) o.v = t.speed;
    if (!near(t.size, 1)) o.z = t.size;
    if (t.fog !== 'auto') o.f = t.fog;
    if (t.range !== 'auto') o.r = t.range;
    if (t.tier) o.t = t.tier;
    return o;
  });
  return CODE_PREFIX + toBase64Url(JSON.stringify({ n: pl.name.slice(0, 60), i: items }));
};

/** A code, or a whole link with one in it, read back — or why it could not be. */
export const decodePlaylist = (text: string): SharedPlaylist | { error: string } => {
  let code = text.trim();
  const at = code.indexOf('playlist=');
  if (at >= 0) code = decodeURIComponent(code.slice(at + 'playlist='.length).split(/[&#\s]/)[0]);
  if (!code.startsWith(CODE_PREFIX)) return { error: 'That is not a playlist code — they start with APX1.' };
  try {
    const raw = JSON.parse(fromBase64Url(code.slice(CODE_PREFIX.length))) as { n?: unknown; i?: unknown };
    const name = typeof raw.n === 'string' && raw.n.trim() ? raw.n.trim().slice(0, 60) : 'SHARED PLAYLIST';
    const items: DrillId[] = [];
    const tunings: ActivityTuning[] = [];
    for (const it of Array.isArray(raw.i) ? raw.i.slice(0, 100) : []) {
      const o = (it ?? {}) as Record<string, unknown>;
      if (!isDrillId(o.d)) continue;
      items.push(o.d);
      tunings.push(
        sanitizeTuning(o.d, {
          seconds: o.s ?? standardSeconds(o.d),
          level: o.l ?? null,
          speed: o.v ?? 1,
          size: o.z ?? 1,
          fog: o.f,
          range: o.r,
          tier: o.t,
        }),
      );
    }
    if (!items.length) return { error: 'That playlist has nothing in it this version can play.' };
    return { name, items, tunings };
  } catch {
    return { error: 'That code is damaged — copy the whole thing and try again.' };
  }
};

/** The link that opens this client straight onto a shared playlist. */
export const playlistLink = (code: string, base?: string): string => {
  const here = base ?? (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '');
  return `${here}#playlist=${encodeURIComponent(code)}`;
};

/** The code in the address bar, if the page was opened from a shared link. */
export const playlistFromLocation = (): string | null => {
  if (typeof location === 'undefined') return null;
  const m = /[#&?]playlist=([^&#]+)/.exec(location.hash + location.search);
  return m ? decodeURIComponent(m[1]) : null;
};
