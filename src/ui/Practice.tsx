import { cardClickStarts } from './components/cardStart';
import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, DRILL_LIST, type DrillId, type DrillMeta } from '../drills/catalog';
import { PRACTICE_CHAMPIONS, RUN_MODE_LIST, type RunMode } from '../drills/modes';
import { LANE_LENGTHS, LANE_TIERS, type LaneTier } from '../progression/lane';
import { resolveBindings, shortCodeLabel, type AbilitySlot, type Bindings } from '../engine/input';
import type { AppSettings, Playlist, Profile } from '../progression/profile';
import { defaultTuning as defaultTuningFor, isCustom, isEdited, type ActivityTuning } from '../progression/tuning';
import { tuningSummary } from './ActivityEditor';
import { ModePreview } from './components/ModePreview';
import { StarButton } from './components/StarButton';
import { DrillsPanel } from './Lab';
import { PlayHero } from './PlayHero';
import { pickNext, type StartSpec } from './playNext';
import { CardRecord } from './components/CardRecord';
import { isApmDrill } from '../progression/apm';
import './practice.css';

interface Props {
  profile: Profile;
  /** The layout every key printed on this screen is read from. */
  settings: AppSettings;
  onPlay: (
    id: DrillId,
    mode: RunMode,
    opts?: { difficulty?: number; duration?: number; level?: number },
  ) => void;
  /** Opens the controls screen, for a drill that needs a key the layout lacks. */
  onFixControls: () => void;
  /** Stars or unstars a drill, a practice mode or the lane — starring opens EDIT ACTIVITY. */
  onToggleStar: (id: DrillId) => void;
  /** Starts a favourite on the settings it was edited to. */
  onPlayFavorite?: (id: DrillId) => void;
  /** Opens EDIT ACTIVITY on a favourite. */
  onEditFavorite?: (id: DrillId) => void;
  /** Starts a playlist from its first item. */
  onPlayPlaylist: (pl: Playlist) => void;
  onCreatePlaylist: (name: string, items: DrillId[]) => void;
  onDeletePlaylist: (id: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  onSetPlaylistItems: (id: string, items: DrillId[], tunings: ActivityTuning[]) => void;
  /** Opens EDIT ACTIVITY on one row of a playlist. */
  onEditPlaylistItem?: (id: string, index: number) => void;
  /** Opens the share dialog for a playlist. */
  onSharePlaylist?: (id: string) => void;
  /**
   * A pasted playlist code, link or scenario code. Returns why it could not
   * be read, or null once it has been taken.
   */
  onCode?: (text: string) => string | null;
  /**
   * Open with YOURS unfolded. Nothing in the client passes it; the headless
   * profile check does, so a hostile stored profile is drawn through the
   * editor as well as the shelf.
   */
  initialYours?: boolean;
  /**
   * Whether Enter and Space start PLAY NEXT. Off while anything is drawn over
   * the screen — the walkthrough, say — whose own keys those are.
   */
  keysLive?: boolean;
}

type PlayFn = Props['onPlay'];

/** mm:ss, for a survival record. */
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Which keys a mode actually hands you, in the order they sit on the bar.
 *
 * Champion-specific, because the *names* are: a row of four caps with "TUMBLE"
 * under Q on a card that spawns Twisted Fate is the menu telling the player
 * about a champion the run does not contain. The caps themselves come from the
 * profile's own layout either way — see {@link bindingsOf} — so this is only
 * ever the tooltip, and it is the one part of the row that can be wrong.
 */
const VAYNE_KIT: { slot: AbilitySlot; name: string }[] = [
  { slot: 'q', name: 'TUMBLE' },
  { slot: 'w', name: 'SILVER BOLTS' },
  { slot: 'e', name: 'CONDEMN' },
  { slot: 'r', name: 'FINAL HOUR' },
];

const TWISTED_KIT: { slot: AbilitySlot; name: string }[] = [
  { slot: 'q', name: 'WILD CARDS' },
  { slot: 'w', name: 'PICK A CARD' },
  { slot: 'e', name: 'STACKED DECK' },
  { slot: 'r', name: 'DESTINY' },
];

const KATARINA_KIT: { slot: AbilitySlot; name: string }[] = [
  { slot: 'q', name: 'BOUNCING BLADE' },
  { slot: 'w', name: 'PREPARATION' },
  { slot: 'e', name: 'SHUNPO' },
  { slot: 'r', name: 'DEATH LOTUS' },
];

const kitOrderFor = (id: DrillId) =>
  DRILLS[id].group === 'TWISTED' ? TWISTED_KIT : DRILLS[id].group === 'KATARINA' ? KATARINA_KIT : VAYNE_KIT;

/**
 * The keys this profile plays on.
 *
 * The menu used to print the slot's *name* — a literal Q, W, E, R — which is
 * the letter League ships and not necessarily the letter this player presses.
 * A card that says a mode hands you Q, next to a run in which Q is on the
 * right mouse button, is the menu disagreeing with the arena about the one
 * thing they both have to agree on.
 */
const bindingsOf = (settings: AppSettings | undefined): Bindings => {
  // Optional chaining because a stored profile is not trusted anywhere else in
  // the client either, and a menu that throws on a half-written settings block
  // is a player who cannot reach the screen that would fix it.
  const scheme = settings?.movementScheme ?? 'click';
  return resolveBindings(scheme, scheme === 'wasd' ? settings?.wasdBindings : settings?.bindings);
};

// ===========================================================================
// PLAY
// ===========================================================================

/**
 * Whether YOURS — every star, every playlist, the playlist editor and the box
 * for a friend's code — is open under the shelf.
 *
 * Module-level rather than stored on the profile: it has to survive the
 * screen being unmounted, which it is every time a run starts, without being
 * a preference anybody wrote to disk.
 */
let yoursOpen = false;

/** Open YOURS the next time PLAY mounts — after saving a friend's playlist, say. */
export const openYours = (): void => {
  yoursOpen = true;
};

/** The drill whose card should be in view when PLAY or PRACTICE next mounts. */
let pendingReveal: DrillId | null = null;

/**
 * Coming back from a run, land on the card you just played: once the screen
 * is drawn, the card is scrolled into view and lit for a moment, so "where
 * was I" is never a question.
 */
export const revealDrill = (id: DrillId): void => {
  pendingReveal = id;
};

/** Scroll the pending card into view inside `root`, and light it. Read once. */
const useReveal = (root: string): void => {
  useEffect(() => {
    const reveal = pendingReveal;
    pendingReveal = null;
    if (!reveal) return;
    const el = document.querySelector<HTMLElement>(`${root} [data-drill="${reveal}"]`);
    const scroller = el?.closest('.scroll');
    if (!el || !(scroller instanceof HTMLElement)) return;
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop = Math.max(0, top - scroller.clientHeight * 0.28);
    el.classList.add('just-played');
    window.setTimeout(() => el.classList.remove('just-played'), 2400);
  }, [root]);
};

/**
 * PLAY: one screen, one job.
 *
 * Three things, top to bottom, and nothing between them:
 *
 *  1. **PLAY NEXT** — one drill, chosen for you, one click (or Enter) away.
 *  2. **Yours** — your stars and playlists as a shelf beside it. The shelf's
 *     last chip opens the editor underneath: every star with its settings,
 *     the playlists, and the box for a code a friend sent.
 *  3. **The drills** — the thirteen thirty-second benches, as a grid.
 *
 * The champions and the lane are on PRACTICE, and only there.
 */
export function Practice({
  profile,
  settings,
  onPlay,
  onFixControls,
  onToggleStar,
  onPlayFavorite,
  onEditFavorite,
  onPlayPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
  onRenamePlaylist,
  onSetPlaylistItems,
  onEditPlaylistItem,
  onSharePlaylist,
  onCode,
  initialYours,
  keysLive = true,
}: Props) {
  // The one drill the front door offers, re-asked whenever the profile moves
  // — which is after every run, so coming back from one is a new answer.
  const pick = useMemo(() => pickNext(profile), [profile]);
  const startSpec = (spec: StartSpec) => onPlay(spec.drill, 'play', spec.opts);
  const startRef = useRef(() => startSpec(pick));
  startRef.current = () => startSpec(pick);
  const [yours, setYours] = useState(initialYours ?? yoursOpen);
  const stars = profile.stars;

  // Enter and Space are PLAY NEXT, from anywhere on the screen that is not
  // already a control of its own — a focused button, tab or field keeps its
  // keys. A held key never fires it twice.
  useEffect(() => {
    if (!keysLive) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return;
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        el !== document.body &&
        el.closest('button, a, input, select, textarea, summary, label, [role="tab"], [role="button"], [contenteditable="true"]')
      )
        return;
      e.preventDefault();
      audio.play('uiClick');
      startRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keysLive]);

  useReveal('.pr-play-screen');

  const toggleYours = () => {
    const next = !yours;
    yoursOpen = next;
    setYours(next);
    audio.play(next ? 'uiTab' : 'uiBack');
  };

  return (
    <div className="scroll">
      <div className="wrap practice pr-play-screen fade-up">
        <PlayHero
          profile={profile}
          settings={settings}
          pick={pick}
          onStart={startSpec}
          onPlayPlaylist={onPlayPlaylist}
          onPlayFavorite={(id) => (onPlayFavorite ? onPlayFavorite(id) : onPlay(id, 'play'))}
          onOpenFavorites={toggleYours}
          yoursOpen={yours}
        />

        {yours && (
          <section className="pr-yours pr-panel fade-up" aria-label="Your stars and playlists" style={{ ['--c' as string]: '#ffe066' }}>
            <FavoritesPanel
              profile={profile}
              nextId={pick.drill}
              settings={settings}
              onPlayFavorite={(id) => (onPlayFavorite ? onPlayFavorite(id) : onPlay(id, 'play'))}
              onEditFavorite={onEditFavorite}
              onToggleStar={onToggleStar}
              onPlayPlaylist={onPlayPlaylist}
              onCreatePlaylist={onCreatePlaylist}
              onDeletePlaylist={onDeletePlaylist}
              onRenamePlaylist={onRenamePlaylist}
              onSetPlaylistItems={onSetPlaylistItems}
              onEditPlaylistItem={onEditPlaylistItem}
              onSharePlaylist={onSharePlaylist}
              onCode={onCode}
            />
          </section>
        )}

        <div className="pr-panel pr-drills" style={{ ['--c' as string]: '#7ceaff' }}>
          <DrillsPanel
            profile={profile}
            nextId={pick.drill}
            settings={settings}
            onPlay={onPlay}
            onFixControls={onFixControls}
            stars={stars}
            onToggleStar={onToggleStar}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The heading every group of activities on this screen wears.
 *
 * One rule, one line: what the group is, and — on the right, in the client's
 * quietest voice — the one sentence explaining why these things are together
 * rather than somewhere else. A group whose reason cannot be written in a line
 * is a group that should not exist.
 */
function GroupHead({ label, note, count }: { label: string; note: string; count?: string }) {
  return (
    <div className="pr-group-head">
      <b className="display">{label}</b>
      {count && <span className="pr-group-count mono">{count}</span>}
      <span className="pr-group-rule" aria-hidden />
      <i>{note}</i>
    </div>
  );
}

// ===========================================================================
// THE LANE — one big card, on PRACTICE
// ===========================================================================

/**
 * THE LANE.
 *
 * Every other card on this screen is a mechanic. This one is the game, and it
 * is first because it is the reason the rest of the screen exists: the modes
 * in PRACTICE take one part of a lane and rehearse it until it is automatic,
 * and this is where you find out whether any of that survived contact with
 * somebody trying to stop you.
 *
 * It asks two questions the other cards never do, and both of them are the
 * player's to answer rather than the ladder's:
 *
 *  - **Who is on the other side.** Five opponents, and the difference between
 *    them is entirely behaviour: how late they see a minion, whether they
 *    punish the last hit you just committed to, whether they hold the wave,
 *    whether they can count lethal. None of them has more health than the one
 *    below it.
 *  - **How long a lane.** Two and a half minutes to run the same five waves
 *    over and over, or the whole first ten minutes when you want the levels,
 *    the ultimate and the wave state that only exist later.
 */
function LaneCard({
  profile,
  settings,
  onPlay,
  starred,
  onToggleStar,
  isNext = false,
}: {
  profile: Profile;
  settings: AppSettings;
  onPlay: (id: DrillId, mode: RunMode, opts?: { difficulty?: number; duration?: number }) => void;
  starred: boolean;
  onToggleStar: () => void;
  isNext?: boolean;
}) {
  const meta = DRILLS.lanePhase;
  const [tier, setTier] = useState<LaneTier>(LANE_TIERS[1]);
  const card = useRef<HTMLElement>(null);
  const record = profile.lane?.tiers?.[tier.id];

  return (
    <section
      ref={card}
      className={`pr-card panel pr-lane pr-startable${isNext ? ' is-next' : ''}`}
      data-drill="lanePhase"
      title={meta.brief}
      style={{ ['--c' as string]: tier.accent }}
      // The card starts the quick lane against the opponent picked on it; the
      // longer lanes are the buttons at the bottom.
      onClick={(e) => {
        if (!cardClickStarts(e)) return;
        audio.play('uiClick');
        onPlay('lanePhase', 'play', { difficulty: tier.difficulty, duration: LANE_LENGTHS[0].seconds });
      }}
    >
      {/* The lane gets a clip for the same reason every mode does — and it
          takes the opponent's colour, so resting on the card after picking a
          harder one shows you the lane you actually chose. */}
      <div className="pr-lane-media">
        <ModePreview
          id="lanePhase"
          accent={tier.accent}
          host={card}
          still={settings.lowFx}
          label={`a real lane against ${tier.label.toLowerCase()}`}
          startLabel={`${LANE_LENGTHS[0].label.toLowerCase()} against ${tier.label}`}
          onStart={() => {
            audio.play('uiClick');
            onPlay('lanePhase', 'play', { difficulty: tier.difficulty, duration: LANE_LENGTHS[0].seconds });
          }}
        />
      </div>
      <div className="pr-card-head">
        <div>
          <div className="eyebrow">a real game of League{isNext && <NextBadge />}</div>
          <h2 className="display pr-name">{meta.name}</h2>
          <div className="pr-tag">{meta.tagline}</div>
        </div>
        <div className="pr-card-head-right">
          <StarButton on={starred} onToggle={onToggleStar} label={meta.name} />
          <div className="pr-lane-record mono">
            {record && record.runs > 0 ? (
              <>
                <b>{record.bestCsPerMin.toFixed(1)}</b>
                <span>best CS/min vs {tier.label}</span>
                <i>
                  {record.runs} lane{record.runs > 1 ? 's' : ''} · {record.wins} won on gold
                </i>
              </>
            ) : (
              <>
                <b>—</b>
                <span>no lane against {tier.label} yet</span>
              </>
            )}
          </div>
        </div>
      </div>

      <CardRecord profile={profile} id="lanePhase" />

      <div className="pr-field">
        <span className="pr-field-label">Who are you up against?</span>
        <div className="pr-lane-tiers">
          {LANE_TIERS.map((t) => {
            const rec = profile.lane?.tiers?.[t.id];
            return (
              <button
                key={t.id}
                className={`pr-tier${t.id === tier.id ? ' on' : ''}`}
                title={t.blurb}
                style={{ ['--c' as string]: t.accent }}
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiTab');
                  setTier(t);
                }}
              >
                <b>{t.label}</b>
                <i className="mono">{t.expect.toFixed(1)} CS/min</i>
                {rec && rec.runs > 0 && <em className="mono">best {rec.bestCsPerMin.toFixed(1)}</em>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pr-field">
        <span className="pr-field-label">How long do you want to play?</span>
        <div className="pr-buttons pr-lane-lengths">
          {LANE_LENGTHS.map((len) => (
            <button
              key={len.id}
              className="pr-go pr-go-play"
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                audio.play('uiClick');
                onPlay('lanePhase', 'play', { difficulty: tier.difficulty, duration: len.seconds });
              }}
            >
              <span className="pr-go-label">{len.label}</span>
              <span className="pr-go-sub">{len.blurb}</span>
              <span className="pr-go-best mono">vs {tier.label}</span>
            </button>
          ))}
        </div>
      </div>

    </section>
  );
}

// ===========================================================================
// 02 — PRACTICE
// ===========================================================================

/**
 * The champions, in pieces, grouped by how much of one a mode hands you.
 *
 * The list itself lives in `modes.ts` — this is a reading of it, not a second
 * copy — and the groups are per champion because the three of them are not
 * built the same way. Vayne's climbs by *how much kit*: a body, then one
 * ability, then all four. His climbs by *how much is taken away*: the wheel on
 * an empty floor, the wheel with the rest of the deck attached, the wheel with
 * people shooting at you. Katarina's climbs by *how far ahead you have to
 * think*: one dagger, then two ways of getting to one, then a whole fight
 * routed through them.
 *
 * Anything added to a champion's list that no group here claims still appears,
 * under a group of its own — a mode that exists and is not on the menu is a
 * worse outcome than a group heading that reads a little vague.
 */
const PRACTICE_GROUPS: Record<string, { id: string; label: string; note: string; members: DrillId[] }[]> = {
  vayne: [
    {
      id: 'foundation',
      label: 'FOUNDATION',
      note: 'no abilities — just learning how far you can reach',
      members: ['rangecheck'],
    },
    {
      id: 'kit',
      label: 'THE KIT',
      note: 'one ability at a time, until it stops needing thought',
      members: ['vayneTumble', 'vayneBolts', 'vayneCondemn'],
    },
    {
      id: 'whole',
      label: 'ALL OF IT',
      note: 'the four abilities at once — then with somebody shooting back',
      members: ['vayneHunt', 'caitlynDodge'],
    },
  ],
  twisted: [
    {
      id: 'foundation',
      label: 'FOUNDATION',
      note: 'no abilities — a gold card is worth nothing from outside your range',
      members: ['rangecheck'],
    },
    {
      id: 'wheel',
      label: 'THE WHEEL',
      note: 'Pick a Card, alone: the choice, the card that matters, and making it early',
      members: ['tfPick', 'tfGold', 'tfHold'],
    },
    {
      id: 'deck',
      label: 'THE REST OF THE DECK',
      note: 'the fan, the count, and the two channels that move you across the map',
      members: ['tfWild', 'tfDeck', 'tfGate'],
    },
    {
      id: 'table',
      label: 'WITH SOMEBODY THERE',
      note: 'the same hands, with the floor moving and people in the way',
      members: ['tfPressure', 'tfCombo', 'tfFight'],
    },
  ],
  katarina: [
    {
      id: 'foundation',
      label: 'FOUNDATION',
      note: 'no abilities — she is melee, and a hundred and twenty-five units is all of her until a dagger lands',
      members: ['rangecheck'],
    },
    {
      id: 'dagger',
      label: 'THE DAGGER',
      note: 'one dagger, then the two ways of getting one somewhere — the blade and the blink',
      members: ['katPrep', 'katBlade', 'katShunpo'],
    },
    {
      id: 'route',
      label: 'THE ROUTE',
      note: 'the daggers chained: throw and blink, drop and take, kill and go again',
      members: ['katBlink', 'katDance', 'katReset'],
    },
    {
      id: 'fight',
      label: 'THE FIGHT',
      note: 'the spin you lose by moving, the moment to join, and all of it at once',
      members: ['katLotus', 'katEntry', 'katFight'],
    },
  ],
};

/**
 * Which champion this screen was last showing.
 *
 * Module-level for the same reason the section is: it has to survive the
 * screen being unmounted — which it is every time a run starts — without being
 * a preference anybody wrote to disk. Coming back from a card stage and
 * landing on Vayne's six is the client forgetting what you were doing.
 */
let lastChampion = PRACTICE_CHAMPIONS[0].id;

function PracticePanel({
  nextId,
  profile,
  settings,
  bound,
  onPlay,
  stars,
  onToggleStar,
}: {
  profile: Profile;
  settings: AppSettings;
  bound: Bindings;
  onPlay: PlayFn;
  stars: DrillId[];
  onToggleStar: (id: DrillId) => void;
  nextId?: DrillId;
}) {
  const [who, setWho] = useState(lastChampion);
  const champion = PRACTICE_CHAMPIONS.find((c) => c.id === who) ?? PRACTICE_CHAMPIONS[0];

  // Groups are drawn from the real list, so a mode is on this screen because
  // the champion's list contains it and not because a group here names it.
  const defs = PRACTICE_GROUPS[champion.id] ?? [];
  const claimed = new Set(defs.flatMap((g) => g.members));
  const groups = [
    ...defs.map((g) => ({ ...g, members: g.members.filter((id) => champion.modes.includes(id)) })),
    {
      id: 'more',
      label: 'MORE',
      note: 'newer modes, not yet filed with the rest',
      members: champion.modes.filter((id) => !claimed.has(id)),
    },
  ].filter((g) => g.members.length > 0);

  return (
    <>
      {/* The switch, and the reason it is a switch rather than a fourth tab:
          every side of it is the same question — which piece of a champion —
          asked about three champions. A tab would have said they were three
          different kinds of thing. */}
      <div className="pr-seg" role="tablist" aria-label="Which champion">
        {PRACTICE_CHAMPIONS.map((c) => {
          const played = c.modes.filter((id) => profile.bests[id] || profile.survive[id]).length;
          return (
            <button
              key={c.id}
              className={`pr-seg-btn${c.id === who ? ' on' : ''}`}
              style={{ ['--c' as string]: c.accent }}
              role="tab"
              type="button"
              aria-selected={c.id === who}
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                if (c.id === who) return;
                audio.play('uiTab');
                lastChampion = c.id;
                setWho(c.id);
              }}
            >
              <b className="display">{c.label}</b>
              <i>
                {c.sub} · {played > 0 ? `${played}/${c.modes.length} tried` : `${c.modes.length} modes`}
              </i>
            </button>
          );
        })}
      </div>

      <div key={champion.id} className="fade-in" style={{ ['--c' as string]: champion.accent }}>
        {groups.map((g) => (
          <div className="pr-group" key={g.id}>
            <GroupHead
              label={g.label}
              note={g.note}
              count={`${g.members.length} MODE${g.members.length > 1 ? 'S' : ''}`}
            />
            <div className="pr-modes">
              {g.members.map((id) => (
                <ModeCard
                  key={id}
                  id={id}
                  profile={profile}
                  settings={settings}
                  bound={bound}
                  onPlay={onPlay}
                  starred={stars.includes(id)}
                  onToggleStar={() => onToggleStar(id)}
                  isNext={id === nextId}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * ONE MODE, ON ONE TILE.
 *
 * This used to be a page of a card: a name, a tagline, a row of keycaps, a
 * paragraph of brief, a paragraph of why it matters and two large buttons —
 * about three hundred pixels tall, two to a row, which put six modes on a
 * screen and a half of solid prose. Nothing in that was wrong and all of it
 * was in the wrong order, because it answered *what is this mode about* four
 * times over before it answered the question a player standing at a menu is
 * actually asking, which is **what does it look like**.
 *
 * So the tile leads with the clip and the copy folds up behind it:
 *
 *  - **The picture is the top two thirds.** A loop of the mode itself, still
 *    until you rest on it (see {@link ModePreview}). The name and the tagline
 *    sit *on* it rather than above it, which is a whole header row's worth of
 *    height reclaimed and reads as a title card rather than a form field.
 *  - **One line of brief.** Two at most, clamped. The full brief and the
 *    transfer note are one click away under WHY THIS ONE — everything that
 *    was on the card is still on the card, it is simply not all unfolded at
 *    once.
 *  - **The buttons are a footer.** PLAY and SURVIVE, half the height they
 *    were, with the record they beat printed on them.
 *
 * The tile lands at roughly two thirds of the old height and narrow enough
 * for three to a row, so the six modes are one screen with no scrolling and
 * the whole champion is visible at once — which was the point of grouping
 * them in the first place.
 */
function ModeCard({
  id,
  profile,
  settings,
  bound,
  onPlay,
  starred,
  onToggleStar,
  isNext = false,
}: {
  id: DrillId;
  profile: Profile;
  settings: AppSettings;
  bound: Bindings;
  onPlay: (id: DrillId, mode: RunMode) => void;
  starred: boolean;
  onToggleStar: () => void;
  /** The drill PLAY NEXT would start — marked, so the pick can be found in its row. */
  isNext?: boolean;
}) {
  const meta = DRILLS[id];
  const best = profile.bests[id];
  const survived = profile.survive[id];
  const uses = new Set<AbilitySlot>(meta.abilities);
  // The clip watches the whole card rather than just its picture — resting
  // anywhere on a tile is looking at that mode — and it watches the element
  // itself, so a cursor moving across the screen never re-renders a card.
  const card = useRef<HTMLElement>(null);

  return (
    <section
      ref={card}
      className={`pr-tile panel pr-startable${isNext ? ' is-next' : ''}`}
      data-drill={id}
      title={meta.brief}
      style={{ ['--c' as string]: meta.accent }}
      onMouseEnter={() => audio.play('uiHover')}
      // Anywhere on the card that is not one of its own buttons is PLAY.
      onClick={(e) => {
        if (!cardClickStarts(e)) return;
        audio.play('uiClick');
        onPlay(id, 'play');
      }}
    >
      <div className="pr-tile-media">
        <ModePreview
          id={id}
          accent={meta.accent}
          host={card}
          still={settings.lowFx}
          startLabel={meta.name}
          onStart={() => {
            audio.play('uiClick');
            onPlay(id, 'play');
          }}
        />
        <StarButton on={starred} onToggle={onToggleStar} label={meta.name} />
        {isNext && <NextBadge />}
        <div className="pr-tile-title">
          <h2 className="display pr-name">{meta.name}</h2>
          <div className="pr-tag">{meta.tagline}</div>
        </div>
        {/* A mode that hands you no kit prints no kit. Four dim letters would
            be answering "which abilities" with "none of them", at length. */}
        {meta.abilities.length > 0 && (
          <div className="pr-keys">
            {kitOrderFor(id).map((k) => (
              <i key={k.slot} className={uses.has(k.slot) ? 'on' : ''} title={k.name}>
                {shortCodeLabel(bound[k.slot].primary)}
              </i>
            ))}
          </div>
        )}
      </div>

      <div className="pr-tile-body">
        {/* The number, and whether it is moving. The brief and the transfer
            note are both still on the card, one click down. */}
        <CardRecord profile={profile} id={id} />

        <div className="pr-buttons">
          {RUN_MODE_LIST.map((m) => {
            const record =
              m.id === 'play'
                ? best
                  ? `best ${best.score.toLocaleString()}`
                  : 'no score yet'
                : survived
                  ? `best ${clock(survived.seconds)}`
                  : 'never survived';
            return (
              <button
                key={m.id}
                className={`pr-go pr-go-${m.id}`}
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiClick');
                  onPlay(id, m.id);
                }}
              >
                <span className="pr-go-label">{m.label}</span>
                <span className="pr-go-best mono">{record}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// 04 — FAVORITES
// ===========================================================================

/**
 * THE ONE SECTION NOBODY WROTE.
 *
 * Every other tab is a fixed shape the client chose: thirteen drills, three
 * champions, one lane, four kits. This one starts empty and is built entirely
 * out of what a player starred on the other three — each star played on the
 * settings it was edited to, and strung into playlists that can be sent to a
 * friend and played exactly as built.
 */
function FavoritesPanel({
  nextId,
  profile,
  settings,
  onPlayFavorite,
  onEditFavorite,
  onToggleStar,
  onPlayPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
  onRenamePlaylist,
  onSetPlaylistItems,
  onEditPlaylistItem,
  onSharePlaylist,
  onCode,
}: {
  profile: Profile;
  settings: AppSettings;
  onPlayFavorite: (id: DrillId) => void;
  onEditFavorite?: (id: DrillId) => void;
  onToggleStar: (id: DrillId) => void;
  onPlayPlaylist: (pl: Playlist) => void;
  onCreatePlaylist: (name: string, items: DrillId[]) => void;
  onDeletePlaylist: (id: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  onSetPlaylistItems: (id: string, items: DrillId[], tunings: ActivityTuning[]) => void;
  onEditPlaylistItem?: (id: string, index: number) => void;
  onSharePlaylist?: (id: string) => void;
  onCode?: (text: string) => string | null;
  nextId?: DrillId;
}) {
  const starredMeta = DRILL_LIST.filter((d) => profile.stars.includes(d.id));

  return (
    <>
      <GroupHead
        label="STARRED"
        note="everything you have marked — each on its own settings"
        count={`${starredMeta.length} ITEM${starredMeta.length === 1 ? '' : 'S'}`}
      />
      {starredMeta.length === 0 ? (
        <p className="dim pr-empty">
          Nothing starred yet. Press the ☆ on any drill, champion mode or the lane to put it here.
        </p>
      ) : (
        <div className="pr-modes">
          {starredMeta.map((meta) => (
            <FavoriteTile
              key={meta.id}
              id={meta.id}
              profile={profile}
              isNext={meta.id === nextId}
              settings={settings}
              onPlay={() => onPlayFavorite(meta.id)}
              onEdit={onEditFavorite ? () => onEditFavorite(meta.id) : undefined}
              onToggleStar={() => onToggleStar(meta.id)}
            />
          ))}
        </div>
      )}

      <GroupHead
        label="PLAYLISTS"
        note="queues built out of your stars — play them, or send them to a friend"
        count={`${profile.playlists.length} LIST${profile.playlists.length === 1 ? '' : 'S'}`}
      />
      <div className="pr-playlists">
        {profile.playlists.map((pl) => (
          <PlaylistCard
            key={pl.id}
            playlist={pl}
            starred={starredMeta}
            profile={profile}
            onPlay={() => onPlayPlaylist(pl)}
            onDelete={() => onDeletePlaylist(pl.id)}
            onRename={(name) => onRenamePlaylist(pl.id, name)}
            onSetItems={(items, tunings) => onSetPlaylistItems(pl.id, items, tunings)}
            onEditItem={onEditPlaylistItem ? (i) => onEditPlaylistItem(pl.id, i) : undefined}
            onShare={onSharePlaylist ? () => onSharePlaylist(pl.id) : undefined}
          />
        ))}
        <NewPlaylist starred={starredMeta} onCreate={onCreatePlaylist} />
      </div>

      {onCode && <CodeBox onCode={onCode} />}
    </>
  );
}

/**
 * One starred activity, as a compact card — the same picture and PLAY button
 * every other card carries, the settings it plays on, and EDIT to change them.
 * It is also the one card that says how long it has been: a favourite you have
 * stopped playing is worth a nudge.
 */
function FavoriteTile({
  id,
  profile,
  settings,
  onPlay,
  onEdit,
  onToggleStar,
  isNext = false,
}: {
  id: DrillId;
  profile: Profile;
  settings: AppSettings;
  onPlay: () => void;
  onEdit?: () => void;
  onToggleStar: () => void;
  isNext?: boolean;
}) {
  const meta = DRILLS[id];
  const card = useRef<HTMLElement>(null);
  const tuning = profile.tunings?.[id];
  const start = () => {
    audio.play('uiClick');
    onPlay();
  };
  return (
    <section
      ref={card}
      className={`pr-tile panel pr-startable${isNext ? ' is-next' : ''}`}
      data-drill={id}
      title={meta.brief}
      style={{ ['--c' as string]: meta.accent }}
      onMouseEnter={() => audio.play('uiHover')}
      onClick={(e) => {
        if (!cardClickStarts(e)) return;
        start();
      }}
    >
      <div className="pr-tile-media">
        <ModePreview id={id} accent={meta.accent} host={card} still={settings.lowFx} startLabel={meta.name} onStart={start} />
        <StarButton on onToggle={onToggleStar} label={meta.name} />
        {isNext && <NextBadge />}
        <div className="pr-tile-title">
          <h2 className="display pr-name">{meta.name}</h2>
          <div className="pr-tag">{meta.tagline}</div>
        </div>
      </div>
      <div className="pr-tile-body">
        <CardRecord profile={profile} id={id} best={bestLine(profile, id)} stale />
        <p className={`pr-tuning mono${isCustom(id, tuning) ? ' custom' : ''}`}>
          {tuning && isEdited(id, tuning) ? tuningSummary(id, tuning) : 'standard settings'}
          {isCustom(id, tuning) && <b> · CUSTOM</b>}
        </p>
        <div className="pr-buttons pr-buttons-two">
          <button className="pr-go pr-go-play" onMouseEnter={() => audio.play('uiHover')} onClick={start}>
            <span className="pr-go-label">PLAY</span>
          </button>
          {onEdit && (
            <button
              className="pr-go pr-go-edit"
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                audio.play('uiTab');
                onEdit();
              }}
            >
              <span className="pr-go-label">EDIT</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** The record a favourite prints, in the words its own card would use. */
const bestLine = (p: Profile, id: DrillId): string | null => {
  if (isApmDrill(id)) {
    const lv = p.apm.modes[id]?.levels ?? [];
    const top = lv.reduce((m, l) => Math.max(m, l?.best ?? 0), 0);
    return top > 0 ? `best ${Math.round(top * 100)}%` : null;
  }
  if (id === 'lanePhase') {
    const top = LANE_TIERS.reduce((m, t) => Math.max(m, p.lane?.tiers?.[t.id]?.bestCsPerMin ?? 0), 0);
    return top > 0 ? `best ${top.toFixed(1)} CS/min` : null;
  }
  const b = p.bests[id];
  return b ? `best ${b.score.toLocaleString()}` : null;
};

/** The mark on whichever card PLAY NEXT would start. */
function NextBadge() {
  return (
    <span className="pr-next-badge mono" title="This is the drill PLAY NEXT starts">
      PLAY NEXT
    </span>
  );
}

/**
 * ONE PLAYLIST, EDITABLE IN PLACE.
 *
 * Reorder with the two arrows rather than a drag — a queue has to work from a
 * keyboard and a touchscreen as well as a mouse, and an arrow does not need
 * either of those to hit a target. Every row carries its own settings, and
 * EDIT changes them for this playlist only.
 */
function PlaylistCard({
  playlist,
  starred,
  profile,
  onPlay,
  onDelete,
  onRename,
  onSetItems,
  onEditItem,
  onShare,
}: {
  playlist: Playlist;
  starred: DrillMeta[];
  profile: Profile;
  onPlay: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onSetItems: (items: DrillId[], tunings: ActivityTuning[]) => void;
  onEditItem?: (index: number) => void;
  onShare?: () => void;
}) {
  const [name, setName] = useState(playlist.name);
  useEffect(() => setName(playlist.name), [playlist.name]);
  const available = starred.filter((m) => !playlist.items.includes(m.id));

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= playlist.items.length) return;
    const items = [...playlist.items];
    const tunings = [...playlist.tunings];
    [items[i], items[j]] = [items[j], items[i]];
    [tunings[i], tunings[j]] = [tunings[j], tunings[i]];
    onSetItems(items, tunings);
  };
  const remove = (i: number) =>
    onSetItems(
      playlist.items.filter((_, idx) => idx !== i),
      playlist.tunings.filter((_, idx) => idx !== i),
    );

  return (
    <section className="panel pad pr-playlist">
      <div className="pr-playlist-head">
        <input
          className="pr-playlist-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== playlist.name) onRename(name);
            else setName(playlist.name);
          }}
          maxLength={60}
          aria-label="Playlist name"
        />
        {onShare && (
          <button className="btn sm" type="button" onClick={onShare} disabled={playlist.items.length === 0}>
            SHARE
          </button>
        )}
        <button className="btn ghost sm" type="button" onClick={onDelete}>
          DELETE
        </button>
      </div>
      {playlist.completions > 0 && (
        <p className="pr-playlist-done mono">
          completed {playlist.completions} time{playlist.completions === 1 ? '' : 's'}
        </p>
      )}

      {playlist.items.length === 0 ? (
        <p className="dim pr-empty">Empty — add a starred activity below.</p>
      ) : (
        <ol className="pr-playlist-items">
          {playlist.items.map((id, i) => (
            <li key={`${id}-${i}`}>
              <b className="mono">{String(i + 1).padStart(2, '0')}</b>
              <span className="pr-playlist-item-name">
                {DRILLS[id].name}
                <i className="mono">{tuningSummary(id, playlist.tunings[i])}</i>
              </span>
              <span className="pr-playlist-item-controls">
                {onEditItem && (
                  <button type="button" className="pr-playlist-edit" onClick={() => onEditItem(i)} aria-label={`Edit ${DRILLS[id].name} in this playlist`}>
                    EDIT
                  </button>
                )}
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${DRILLS[id].name} earlier`}>
                  ▲
                </button>
                <button
                  type="button"
                  disabled={i === playlist.items.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${DRILLS[id].name} later`}
                >
                  ▼
                </button>
                <button type="button" onClick={() => remove(i)} aria-label={`Remove ${DRILLS[id].name}`}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {available.length > 0 && (
        <select
          className="pr-playlist-add"
          value=""
          onChange={(e) => {
            const id = e.target.value as DrillId;
            if (!id) return;
            // A new row takes the favourite's settings as they stand now.
            onSetItems([...playlist.items, id], [...playlist.tunings, profile.tunings?.[id] ?? defaultTuningFor(id)]);
          }}
          aria-label={`Add a starred activity to ${playlist.name}`}
        >
          <option value="">+ add a starred activity…</option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}

      <button className="pr-go pr-go-play pr-playlist-play" type="button" disabled={playlist.items.length === 0} onClick={onPlay}>
        <span className="pr-go-label">PLAY PLAYLIST</span>
        <span className="pr-go-sub">
          {playlist.items.length} activit{playlist.items.length === 1 ? 'y' : 'ies'}, in order
        </span>
      </button>
    </section>
  );
}

/** Building a new playlist: a name, and a pick of whatever is starred. */
function NewPlaylist({ starred, onCreate }: { starred: DrillMeta[]; onCreate: (name: string, items: DrillId[]) => void }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<DrillId[]>([]);

  if (starred.length === 0) {
    return <p className="dim pr-empty">Star something first — a playlist is built out of your stars.</p>;
  }

  const toggle = (id: DrillId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const create = () => {
    if (!picked.length) return;
    audio.play('uiClick');
    onCreate(name.trim() || 'PLAYLIST', picked);
    setName('');
    setPicked([]);
  };

  return (
    <section className="panel pad pr-playlist pr-playlist-new">
      <div className="pr-playlist-head">
        <input
          className="pr-playlist-name"
          placeholder="Name this playlist…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          aria-label="New playlist name"
        />
      </div>
      <div className="pr-playlist-pick">
        {starred.map((m) => (
          <label key={m.id} className={`pr-playlist-check${picked.includes(m.id) ? ' on' : ''}`}>
            <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} />
            {m.name}
          </label>
        ))}
      </div>
      <button className="btn primary" type="button" disabled={picked.length === 0} onClick={create}>
        CREATE PLAYLIST · {picked.length} picked
      </button>
    </section>
  );
}

/**
 * ADD A CODE.
 *
 * One box for everything a friend can send: a playlist link, a playlist code,
 * or the scenario code a results screen prints for the run you just played.
 */
function CodeBox({ onCode }: { onCode: (text: string) => string | null }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = () => {
    const e = onCode(text);
    if (e) {
      setErr(e);
      audio.play('castRefuse');
      return;
    }
    setErr(null);
    setText('');
  };
  return (
    <>
      <GroupHead label="ADD A CODE" note="a playlist link or code a friend sent — or a scenario code from a results screen" />
      <section className="panel pad pr-code">
        <form
          className="pr-code-row"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <input
            className="mono"
            value={text}
            placeholder="APX1.… · a playlist link · vayneTumble-P50-fl4ma-J"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value);
              setErr(null);
            }}
            aria-label="Playlist or scenario code"
          />
          <button className="btn primary" type="submit" disabled={!text.trim()}>
            OPEN
          </button>
        </form>
        {err && <p className="pr-code-err">{err}</p>}
      </section>
    </>
  );
}

// ===========================================================================
// THE PRACTICE TAB
// ===========================================================================

/**
 * PRACTICE: the champions, and the lane.
 *
 * The lane — the real game — is one big card at the top. Under it, a switch
 * between the three champions and each one's pieces. This is the only place
 * either of them lives; PLAY is the drills.
 */
export function PracticeScreen({
  profile,
  settings,
  onPlay,
  onToggleStar,
}: {
  profile: Profile;
  settings: AppSettings;
  onPlay: PlayFn;
  onToggleStar: (id: DrillId) => void;
}) {
  const bound = bindingsOf(settings);
  const nextId = useMemo(() => pickNext(profile).drill, [profile]);
  useReveal('.pr-practice-screen');
  return (
    <div className="scroll">
      <div className="wrap practice pr-practice-screen fade-up">
        <h1 className="sr-only">PRACTICE</h1>
        <div className="pr-panel pr-lane-slot">
          <LaneCard
            profile={profile}
            settings={settings}
            onPlay={onPlay}
            starred={profile.stars.includes('lanePhase')}
            onToggleStar={() => onToggleStar('lanePhase')}
            isNext={nextId === 'lanePhase'}
          />
        </div>
        <div className="pr-panel" style={{ ['--c' as string]: '#c86bff' }}>
          <PracticePanel
            profile={profile}
            nextId={nextId}
            settings={settings}
            bound={bound}
            onPlay={onPlay}
            stars={profile.stars}
            onToggleStar={onToggleStar}
          />
        </div>
      </div>
    </div>
  );
}
