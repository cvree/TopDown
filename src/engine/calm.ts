import type { FxSystem } from './fx';
import type { Vec2 } from './types';

/**
 * The arena's voice.
 *
 * A run used to talk the way a notification feed does: forty-odd places
 * could put a banner up, sixty could throw a word over the fight, and none of
 * them knew about any of the others. Two banners in the same second simply
 * overwrote each other, and a trade in the lane left fifteen numbers stacked
 * over the minions it was about.
 *
 * Everything here is presentation. It decides what reaches the screen and
 * when, and nothing else: no drill reads a banner, no score counts a float,
 * and the simulation cannot tell whether any of this exists — which is what
 * lets it be as strict as it is.
 */

// ------------------------------------------------------------------ banners

/**
 * What a banner is for, which is also how loud it is allowed to be.
 *
 * - **critical** — the run needs you to know this now: a strike, a threat, the
 *   task changing under you. It interrupts anything quieter.
 * - **teaching** — a rule of the mode, said once. Once per profile, not once
 *   per run: the tenth lane does not need minion aggro explained again.
 * - **flavour** — colour on something the arena already shows (a wave, a
 *   level, a kill of a dummy). Dropped in a fight, dropped if it would not
 *   stay up for a second, and never allowed to repeat itself quickly.
 */
export type BannerTone = 'critical' | 'teaching' | 'flavour';

export interface BannerOpts {
  tone?: BannerTone;
  /**
   * What the banner is *about*, for deduplication. A new banner with the key
   * of the one on screen replaces it in place — a new card asked for, the
   * next phase — rather than queueing behind it. Defaults to the text.
   */
  key?: string;
}

const RANK: Record<BannerTone, number> = { flavour: 0, teaching: 1, critical: 2 };

/** How long a banner is guaranteed to be readable before something of equal rank can replace it. */
export const BANNER_MIN_DWELL = 0.7;

/** How long a banner may wait in the queue before it is no longer worth saying. */
const BANNER_WAIT: Record<BannerTone, number> = { flavour: 1.2, teaching: 3, critical: 1.6 };

/** How soon the same key may speak again. */
const BANNER_COOLDOWN: Record<BannerTone, number> = { flavour: 5, teaching: Infinity, critical: 0 };

/** Anything shorter than this is not a banner: it is gone before it has been read. */
export const BANNER_SHORTEST = 1;

interface Queued {
  text: string;
  seconds: number;
  tone: BannerTone;
  key: string;
  at: number;
}

export interface BannerHooks {
  /** Keys this profile has already been taught. */
  taught?: ReadonlySet<string> | null;
  /** A teaching banner was shown: remember it for the profile. */
  onTaught?: (key: string) => void;
}

/**
 * One banner at a time, in priority order.
 *
 * The queue holds at most one entry per key; waiting entries go stale rather
 * than arriving late; a critical banner interrupts anything quieter at once,
 * and one of equal rank waits out the minimum dwell before it takes over.
 */
export class BannerVoice {
  text: string | null = null;
  tone: BannerTone = 'flavour';
  /** Bumped every time a new banner arrives, so the HUD can strike it in. */
  seq = 0;
  /** Banners that actually reached the screen. */
  shown = 0;

  private key = '';
  private left = 0;
  private since = 0;
  private queue: Queued[] = [];
  private last = new Map<string, number>();
  private taughtRun = new Set<string>();

  constructor(private hooks: BannerHooks = {}) {}

  /** Offer a banner. `now` is run time; `fighting` is whether the player is in a fight. */
  say(text: string, seconds: number, opts: BannerOpts, now: number, fighting: boolean): void {
    const tone = opts.tone ?? 'flavour';
    const key = opts.key ?? text;
    if (tone === 'teaching' && (this.taughtRun.has(key) || this.hooks.taught?.has(key))) return;
    if (tone === 'flavour' && (seconds < BANNER_SHORTEST || fighting)) return;

    // The same subject, already on screen: update it where it stands.
    if (this.text !== null && key === this.key) {
      if (text !== this.text) {
        this.text = text;
        this.seq++;
        this.shown++;
      }
      this.left = Math.max(this.left, seconds);
      this.tone = RANK[tone] > RANK[this.tone] ? tone : this.tone;
      return;
    }
    const lastAt = this.last.get(key);
    if (lastAt !== undefined && now - lastAt < BANNER_COOLDOWN[tone]) return;

    const item: Queued = { text, seconds, tone, key, at: now };
    if (this.text === null || RANK[tone] > RANK[this.tone]) {
      this.show(item, now);
      return;
    }
    const i = this.queue.findIndex((q) => q.key === key);
    if (i >= 0) this.queue[i] = item;
    else this.queue.push(item);
    // Highest rank first; within a rank, first come.
    this.queue.sort((a, b) => RANK[b.tone] - RANK[a.tone] || a.at - b.at);
  }

  /** Advance the clock. Returns whether the banner on screen changed. */
  tick(dt: number, now: number, fighting: boolean): boolean {
    const before = this.seq;
    const was = this.text;
    this.queue = this.queue.filter(
      (q) => now - q.at <= BANNER_WAIT[q.tone] && !(q.tone === 'flavour' && fighting),
    );
    if (this.text !== null) {
      this.left -= dt;
      const head = this.queue[0];
      const dwelt = now - this.since;
      if (this.left <= 0) {
        this.text = null;
      } else if (head && RANK[head.tone] >= RANK[this.tone] && dwelt >= BANNER_MIN_DWELL) {
        this.queue.shift();
        this.show(head, now);
      }
    }
    if (this.text === null && this.queue.length) this.show(this.queue.shift() as Queued, now);
    return this.seq !== before || this.text !== was;
  }

  clear(): void {
    this.text = null;
    this.queue.length = 0;
  }

  private show(q: Queued, now: number): void {
    this.text = q.text;
    this.tone = q.tone;
    this.key = q.key;
    this.left = q.seconds;
    this.since = now;
    this.seq++;
    this.shown++;
    this.last.set(q.key, now);
    if (q.tone === 'teaching') {
      this.taughtRun.add(q.key);
      this.hooks.onTaught?.(q.key);
    }
  }
}

// ------------------------------------------------------------------- floats

/**
 * A float is either a *result* — something the player caused: gold, a stun,
 * a wall hit, a dodge — or *flavour*: commentary the fight does not need
 * while it is happening. Flavour is dropped during fights.
 */
export type FloatTier = 'result' | 'flavour';

/** The most words over the arena at once. */
export const FLOAT_MAX_LIVE = 3;
/** The most new words one actor can carry in a second. */
export const FLOAT_PER_ACTOR = 2;
/** How close, and how young, a float must be for a repeat to join it rather than stack on it. */
const MERGE_RADIUS = 200;
const MERGE_AGE = 0.8;
/** Two words on the same actor inside this window are one too many. */
const SAME_BEAT = 0.3;

const GOLD = /^\+(\d+)\b/;

export type FloatVerdict = 'new' | 'merged' | 'dropped';

/**
 * The budget words are spent from.
 *
 * Repeats merge: +20 +20 +20 is one +60 that pops each time it grows, and a
 * second PERFECT becomes PERFECT ×2 on the first rather than a second word.
 * Each actor gets two new words a second and the arena three at once; past
 * that, a result pushes out the oldest flavour, and flavour simply waits for
 * a quieter moment that it does not get.
 */
export class FloatBudget {
  /** New words that reached the screen. Merges are not counted: nothing new appeared. */
  shown = 0;
  peak = 0;
  private recent = new WeakMap<object, number[]>();

  constructor(private fx: FxSystem) {}

  add(
    text: string,
    at: Vec2,
    color: string,
    tier: FloatTier,
    now: number,
    fighting: boolean,
  ): FloatVerdict {
    if (tier === 'flavour' && fighting) return 'dropped';
    const x = at.x;
    const y = at.y - 52;
    const texts = this.fx.texts;

    // Join a repeat that is still on screen.
    const gold = GOLD.exec(text);
    for (const t of texts) {
      if (t.max - t.life > MERGE_AGE) continue;
      if (Math.hypot(t.x - x, t.y - y) > MERGE_RADIUS) continue;
      const theirs = GOLD.exec(t.text);
      if (gold && theirs) {
        t.text = `+${Number(gold[1]) + Number(theirs[1])}`;
        t.color = color;
        t.life = t.max;
        return 'merged';
      }
      if ((t.base ?? t.text) === text) {
        t.n = (t.n ?? 1) + 1;
        t.base = text;
        t.text = `${text} ×${t.n}`;
        t.life = t.max;
        return 'merged';
      }
    }

    // One word per beat on the same body: a result may take the place of
    // flavour said a moment ago, and nothing else gets in.
    const beat = texts.find((t) => t.src === at && t.max - t.life < SAME_BEAT);
    if (beat) {
      if (tier === 'result' && beat.tier === 'flavour') {
        beat.text = text;
        beat.base = text;
        beat.n = 1;
        beat.color = color;
        beat.tier = tier;
        beat.life = beat.max;
        return 'merged';
      }
      return 'dropped';
    }

    const times = (this.recent.get(at) ?? []).filter((s) => now - s < 1);
    if (times.length >= FLOAT_PER_ACTOR) return 'dropped';

    if (texts.length >= FLOAT_MAX_LIVE) {
      let victim = texts.findIndex((t) => t.tier === 'flavour');
      if (victim < 0 && tier === 'result') victim = 0;
      if (victim < 0) return 'dropped';
      texts.splice(victim, 1);
    }

    this.fx.text(x, y, text, color, 19, 700);
    const t = texts[texts.length - 1];
    t.src = at;
    t.tier = tier;
    t.base = text;
    t.n = 1;
    times.push(now);
    this.recent.set(at, times);
    this.shown++;
    this.peak = Math.max(this.peak, texts.length);
    return 'new';
  }
}
