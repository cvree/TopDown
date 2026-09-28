import { cardClickStarts } from './components/cardStart';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, DRILL_LIST, type DrillId, type DrillMeta } from '../drills/catalog';
import { PRACTICE_CHAMPIONS, PRACTICE_MODES, RUN_MODE_LIST, championOf, isPracticeMode, type RunMode } from '../drills/modes';
import { LANE_LENGTHS, LANE_TIERS, type LaneTier } from '../progression/lane';
import { resolveBindings, shortCodeLabel, type AbilitySlot, type Bindings } from '../engine/input';
import type { AppSettings, Playlist, Profile } from '../progression/profile';
import { Explainer } from './components/Explainer';
import { ModePreview } from './components/ModePreview';
import { StarButton } from './components/StarButton';
import { Why } from './components/Why';
import { DrillsPanel } from './Lab';
import { APM_MODES } from '../progression/apm';
import { PlayHero } from './PlayHero';
import { pickNext, startSpec as specFor, type StartSpec } from './playNext';
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
  /** Opens the warm-up routine — its own screen now that HOME is gone from the bar. */
  onOpenWarmup: () => void;
  /** Stars or unstars a drill, a practice mode or the lane for quick access. */
  onToggleStar: (id: DrillId) => void;
  /** Starts a playlist from its first item. */
  onPlayPlaylist: (name: string, items: DrillId[]) => void;
  onCreatePlaylist: (name: string, items: DrillId[]) => void;
  onDeletePlaylist: (id: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  onSetPlaylistItems: (id: string, items: DrillId[]) => void;
  /**
   * Which section to open on, overriding the one the player was last reading.
   *
   * Nothing in the client passes it. The headless profile check does, so that
   * a hostile stored profile is still drawn through all five sections rather
   * than only the one a fresh mount happens to open on — every one of them
   * reads a different corner of a saved record, and each is only rendered
   * while its own tab is open.
   */
  initialSection?: SectionId;
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
// THE SECTIONS
// ===========================================================================

/**
 * What this screen is actually made of.
 *
 * It used to be one column: a header of five paragraphs, the lane, six
 * champion cards, two tables of numbers and thirteen benches, in that order,
 * all the way down. Every one of those things is worth having and none of them
 * is the same *kind* of thing, so a player looking for one of them scrolled
 * past the other three — and the two reference tables, which are the only part
 * of the screen you read rather than click, sat directly between the champion
 * and the lab like a wall.
 *
 * Four sections now, and three of them are a champion:
 *
 *  - **DRILLS** is not a champion: thirteen one-minute drills for the hands
 *    under every champion. It was a tab of this screen once, then a tab of the
 *    top bar (TRAIN) — which put two places in the bar where you pick a card
 *    and play a minute. It is back as a segment, and first, because it is the
 *    shortest thing on the screen and the first run anybody plays.
 *  - **PRACTICE** is a champion in pieces, grouped by how much of one a mode
 *    hands you — and there are three champions on it now, behind a switch at
 *    the top rather than a tab each, because "which piece of a champion" is
 *    one question asked three times and not three different kinds of one. It
 *    comes before the lane because it is where a player can actually start. THE LANE is the
 *    game and it is also ten minutes against somebody who is better than you;
 *    opening on it asked a player to be ready before the client had taught
 *    them anything. A menu should open on the thing you can do now.
 *  - **THE LANE** is the game, and everything in PRACTICE exists to make it go
 *    better — so it comes after them, where it reads as what the pieces add up to.
 *  - **FAVORITES** is the one section nobody wrote: whatever you have starred
 *    across the other three, plus any playlist you have built out of them. It
 *    is not on the rail: the shelf under PLAY NEXT already puts every star and
 *    every playlist one click from a run, and this is where that shelf opens
 *    out to be edited.
 *
 * CHARACTER — every figure the four champions are built from — was a fourth
 * tab here, and the only one you could not play. It is under STUDY now, beside
 * the rest of the reading (see `Codex.tsx`), so the rail holds only things you
 * start.
 *
 * The tab rail is sticky, so the three are one keystroke apart from anywhere on
 * any of them, and the section you are in is never more than a glance away.
 */
export type SectionId = 'drills' | 'lane' | 'practice' | 'favorites';

interface SectionMeta {
  id: SectionId;
  /** The numeral on the tab. The order is the order it is taught. */
  no: string;
  label: string;
  /** What the section is, in three words, under the label. */
  sub: string;
  accent: string;
  /** On the rail. FAVORITES is reached from the shelf instead. */
  rail: boolean;
}

/**
 * The tab the player was last on.
 *
 * Module-level rather than stored on the profile: which of four sections you
 * are reading is session state, not a preference worth writing to disk — but
 * it does have to survive the screen being unmounted, which it is every time a
 * run starts. Coming back from a bench in the lab and landing on the lane is
 * the client forgetting what you were doing.
 */
let lastSection: SectionId = 'drills';

/** Open PLAY on this section the next time it mounts — after a first run, say. */
export const openSection = (id: SectionId): void => {
  lastSection = id;
};

/** The drill whose card should be in view when PLAY next mounts. */
let pendingReveal: DrillId | null = null;

/**
 * Coming back from a run, land on the card you just played.
 *
 * The section it lives in opens — the lab for a bench, the right champion for
 * a mode, the lane for the lane — unless FAVORITES was open and the card is
 * there too; and once the screen is drawn, the card is scrolled into view and
 * lit for a moment, so "where was I" is never a question.
 */
export const revealDrill = (id: DrillId): void => {
  pendingReveal = id;
  if (lastSection === 'favorites') return;
  if (id === 'lanePhase') lastSection = 'lane';
  else if (isApmDrill(id)) lastSection = 'drills';
  else if (isPracticeMode(id)) {
    lastSection = 'practice';
    const home = PRACTICE_CHAMPIONS.find((c) => c.id === lastChampion);
    if (!home?.modes.includes(id)) lastChampion = championOf(id)?.id ?? lastChampion;
  }
};

const SECTIONS: SectionMeta[] = [
  { id: 'drills', no: '01', label: 'DRILLS', sub: 'one minute, your hands', accent: '#7ceaff', rail: true },
  { id: 'practice', no: '02', label: 'PRACTICE', sub: 'one skill at a time', accent: '#c86bff', rail: true },
  { id: 'lane', no: '03', label: 'THE LANE', sub: 'play a real lane', accent: '#ffd166', rail: true },
  { id: 'favorites', no: '★', label: 'FAVORITES', sub: 'yours — starred, and queued up', accent: '#ffe066', rail: false },
];

/** The tabs on the rail, in order: the arrow keys walk these and nothing else. */
const RAIL = SECTIONS.filter((s) => s.rail);

/** Every section, rail or not — for anything that has to walk all of them. */
export const SECTION_IDS: SectionId[] = SECTIONS.map((s) => s.id);

/**
 * THE MENU.
 *
 * There used to be seven sections, four ladders, a daily queue, a calibration
 * sequence and a course of gated stages, and between them they asked a player
 * roughly a dozen questions before anything happened on a screen. This asks
 * two: which part of the champion, and for how long.
 *
 * Every mode on it is played as a named champion with that champion's real
 * numbers. That is not a filter over a larger catalogue — it is what the
 * trainer is for. There are two deliberate exceptions, and both are on both
 * champions' lists:
 *
 *  - **RANGE** is about the one distance every champion has and no champion
 *    draws for you, so it hands you a body and nothing else. A mode that put
 *    you behind a body with no tumble could tell you about your hands in the
 *    abstract; it could not tell you anything about the quarter of a second at
 *    the end of a roll, which is where Vayne is won and lost — or about the
 *    walk a gold card has to survive, which is where he is.
 *  - **SHERIFF** is the other half of a lane. Everything else measures what
 *    your hands did; this one measures what you did about somebody else's,
 *    which is a skill that cannot be rehearsed alone — so its kit is printed
 *    in the codex exactly as the champions' own are, because a window you are
 *    expected to beat has to be a number you can check.
 */
export function Practice({
  profile,
  settings,
  onPlay,
  onFixControls,
  onOpenWarmup,
  onToggleStar,
  onPlayPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
  onRenamePlaylist,
  onSetPlaylistItems,
  initialSection,
  keysLive = true,
}: Props) {
  const bound = bindingsOf(settings);
  // The one drill the front door offers, re-asked whenever the profile moves
  // — which is after every run, so coming back from one is a new answer.
  const pick = useMemo(() => pickNext(profile), [profile]);
  const startSpec = (spec: StartSpec) => onPlay(spec.drill, 'play', spec.opts);
  const startRef = useRef(() => startSpec(pick));
  startRef.current = () => startSpec(pick);

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
  const [section, setSection] = useState<SectionId>(initialSection ?? lastSection);
  const railRef = useRef<HTMLDivElement>(null);
  const stars = profile.stars;

  const choose = (id: SectionId) => {
    lastSection = id;
    setSection(id);
  };

  // A tab is a page, so it starts at the top of itself. Without this, opening
  // THE LANE from halfway down DRILLS drops you halfway down the lane.
  //
  // The second half is for the narrow layout, where the rail scrolls sideways
  // rather than fitting: the tab you just opened has to be the one you can
  // see. Done by hand rather than with scrollIntoView, because that would also
  // scroll the page vertically and undo the line above it.
  useEffect(() => {
    const scroller = railRef.current?.closest('.scroll');
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
    // Back from a run: the card just played, in view and lit. Read once.
    const reveal = pendingReveal;
    pendingReveal = null;
    if (reveal && scroller instanceof HTMLElement) {
      const el = scroller.querySelector<HTMLElement>(`.pr-panel [data-drill="${reveal}"]`);
      if (el) {
        const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop = Math.max(0, top - scroller.clientHeight * 0.28);
        el.classList.add('just-played');
        window.setTimeout(() => el.classList.remove('just-played'), 2400);
      }
    }
    const list = railRef.current?.querySelector<HTMLElement>('.pr-tablist');
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const tab = list.querySelectorAll<HTMLElement>('.pr-tab')[RAIL.findIndex((s) => s.id === section)];
    if (!tab) return;
    const left = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [section]);

  // What each tab has to say about itself before you open it. All three are
  // counts of the thing inside, and three of them are also a record — a tab
  // that can tell you how far through it you are is worth more than a tab
  // that can only tell you it exists.
  const counts = useMemo(() => {
    const lanes = LANE_TIERS.reduce((n, t) => n + (profile.lane?.tiers?.[t.id]?.runs ?? 0), 0);
    const played = PRACTICE_MODES.filter((id) => profile.bests[id] || profile.survive[id]).length;
    const drilled = APM_MODES.filter((m) => (profile.apm?.modes?.[m.id]?.runs ?? 0) > 0).length;
    return {
      drills: {
        count: `${APM_MODES.length} DRILLS`,
        note: drilled > 0 ? `${drilled}/${APM_MODES.length} tried` : 'none tried yet',
      },
      lane: {
        count: `${LANE_TIERS.length} OPPONENTS`,
        note: lanes > 0 ? `${lanes} lane${lanes > 1 ? 's' : ''} played` : 'never played',
      },
      practice: {
        count: `${PRACTICE_MODES.length} MODES`,
        note: played > 0 ? `${played}/${PRACTICE_MODES.length} tried` : 'none tried yet',
      },
      favorites: {
        count: `${stars.length} STARRED`,
        note: profile.playlists.length > 0 ? `${profile.playlists.length} playlist${profile.playlists.length > 1 ? 's' : ''}` : 'none yet',
      },
    } as Record<SectionId, { count: string; note: string }>;
  }, [profile, stars.length]);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  // Left and right walk the rail, Home and End jump to its ends — the tab
  // pattern every desktop client uses, and the one a keyboard player will try
  // first.
  const onRailKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // FAVORITES is off the rail, so from there the arrows start at its ends.
    const i = RAIL.findIndex((s) => s.id === section);
    let next = -1;
    if (e.key === 'ArrowRight') next = i < 0 ? 0 : (i + 1) % RAIL.length;
    else if (e.key === 'ArrowLeft') next = i < 0 ? RAIL.length - 1 : (i - 1 + RAIL.length) % RAIL.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = RAIL.length - 1;
    if (next < 0) return;
    e.preventDefault();
    audio.play('uiTab');
    choose(RAIL[next].id);
    railRef.current?.querySelectorAll<HTMLButtonElement>('.pr-tab')[next]?.focus();
  };

  return (
    <div className="scroll">
      <div className="wrap practice fade-up">
        <PlayHero
          profile={profile}
          settings={settings}
          pick={pick}
          onStart={startSpec}
          onPlayPlaylist={onPlayPlaylist}
          onOpenWarmup={onOpenWarmup}
          onOpenFavorites={() => choose('favorites')}
        />

        {/* ------------------------------------------------------------ rail */}
        <div className="pr-tabs" ref={railRef}>
          <div
            className="pr-tablist"
            role="tablist"
            aria-label="Practice sections"
            onKeyDown={onRailKey}
          >
            {RAIL.map((s, idx) => {
              const on = s.id === section;
              return (
                <button
                  key={s.id}
                  id={`pr-tab-${s.id}`}
                  className={`pr-tab${on ? ' on' : ''}`}
                  style={{ ['--c' as string]: s.accent }}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  aria-controls={`pr-panel-${s.id}`}
                  // Off the rail (FAVORITES open), the first tab keeps the
                  // rail reachable from the keyboard.
                  tabIndex={on || (idx === 0 && !active.rail) ? 0 : -1}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    if (on) return;
                    audio.play('uiTab');
                    choose(s.id);
                  }}
                >
                  <span className="pr-tab-no mono">{s.no}</span>
                  <span className="pr-tab-text">
                    <b className="display">{s.label}</b>
                    <i>{s.sub}</i>
                  </span>
                  <span className="pr-tab-meta">
                    <b className="mono">{counts[s.id].count}</b>
                    <i className="mono">{counts[s.id].note}</i>
                  </span>
                  <span className="pr-tab-rule" aria-hidden />
                </button>
              );
            })}
          </div>
        </div>

        {/* ----------------------------------------------------------- panel */}
        <div
          key={section}
          id={`pr-panel-${section}`}
          className="pr-panel fade-up"
          {...(active.rail
            ? { role: 'tabpanel', 'aria-labelledby': `pr-tab-${section}` }
            : { role: 'region', 'aria-label': active.label })}
          style={{ ['--c' as string]: active.accent }}
        >
          {!active.rail && (
            <div className="pr-offrail">
              <b className="display">{active.label}</b>
              <i>{active.sub}</i>
              <button
                type="button"
                className="btn ghost sm"
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiBack');
                  choose('drills');
                }}
              >
                ← BACK TO DRILLS
              </button>
            </div>
          )}
          {section === 'drills' && (
            <DrillsPanel
              profile={profile}
              nextId={pick.drill}
              settings={settings}
              onPlay={onPlay}
              onFixControls={onFixControls}
              stars={stars}
              onToggleStar={onToggleStar}
            />
          )}
          {section === 'lane' && (
            <LanePanel
              profile={profile}
              nextId={pick.drill}
              settings={settings}
              bound={bound}
              onPlay={onPlay}
              stars={stars}
              onToggleStar={onToggleStar}
            />
          )}
          {section === 'practice' && (
            <PracticePanel
              profile={profile}
              nextId={pick.drill}
              settings={settings}
              bound={bound}
              onPlay={onPlay}
              stars={stars}
              onToggleStar={onToggleStar}
            />
          )}
          {section === 'favorites' && (
            <FavoritesPanel
              profile={profile}
              nextId={pick.drill}
              settings={settings}
              onPlay={onPlay}
              onToggleStar={onToggleStar}
              onPlayPlaylist={onPlayPlaylist}
              onCreatePlaylist={onCreatePlaylist}
              onDeletePlaylist={onDeletePlaylist}
              onRenamePlaylist={onRenamePlaylist}
              onSetPlaylistItems={onSetPlaylistItems}
            />
          )}
        </div>

        <Why label="What is here" className="pr-foot-why">
          <p className="dim pr-lead">Drills for your hands · Vayne, Twisted Fate or Katarina.</p>
          <p className="dim pr-lead">
            Three tabs — one-minute drills with no champion at all, then the pieces of each
            champion, and the lane one of them plays for real. Whatever you have starred out of
            the three sits beside PLAY NEXT, and every number behind all of it is under STUDY,
            as CHARACTER.
          </p>
        </Why>
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
// 01 — THE LANE
// ===========================================================================

function LanePanel({
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
  return (
    <>
      <Explainer title="HOW THE LANE WORKS">
        <p className="dim pr-lead pr-panel-lead">
          This is the actual game: minions walk in, you kill the ones about to die for gold, and
          somebody on the other side is doing the same and trying to stop you. Pick who you are up
          against and how long you want to play. Everything in <b>PRACTICE</b> is one piece of this
          on its own; here you find out whether it held up.
        </p>
      </Explainer>
      <GroupHead label="THE MATCH" note="pick an opponent, pick a length" count="1 MODE" />
      <LaneCard
        profile={profile}
        settings={settings}
        bound={bound}
        onPlay={onPlay}
        starred={stars.includes('lanePhase')}
        onToggleStar={() => onToggleStar('lanePhase')}
        isNext={nextId === 'lanePhase'}
      />
    </>
  );
}

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
  bound,
  onPlay,
  starred,
  onToggleStar,
  isNext = false,
}: {
  profile: Profile;
  settings: AppSettings;
  bound: Bindings;
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
      <p className="pr-brief">{meta.brief}</p>

      <div className="pr-field">
        <span className="pr-field-label">Who are you up against?</span>
        <div className="pr-lane-tiers">
          {LANE_TIERS.map((t) => {
            const rec = profile.lane?.tiers?.[t.id];
            return (
              <button
                key={t.id}
                className={`pr-tier${t.id === tier.id ? ' on' : ''}`}
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
        <p className="pr-lane-blurb">{tier.blurb}</p>
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

      <Why label="why the lane">
        <p className="pr-transfers">{meta.transfers}</p>
        <p className="set-note">
          Everything here is League's own: the same minions, the same health, the same gold, the
          same wave every thirty seconds, the same turret. You both start at level one and level up
          as the wave pays for it. There is no shop — gold is just the scoreboard — and no jungler,
          so nobody is coming out of the river. Health does not come back on its own, so{' '}
          <b>{shortCodeLabel(bound.f.primary)}</b> to go home is a real decision.
        </p>
      </Why>
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

      {/* Who she is and what the two buttons mean, said once, behind the why. */}
      {/* One disclosure for the whole section: who she is, what the two
          buttons mean, and how this screen hangs together. It was two, stacked,
          which on a phone was the difference between a card above the fold
          and none. */}
      <Why key={`${champion.id}-why`} label={`how this screen works · ${champion.label.toLowerCase()}`}>
        <p key={`${champion.id}-blurb`} className="dim pr-lead pr-panel-lead fade-in">
          {champion.blurb}
        </p>

        <div className="pr-legend">
          {RUN_MODE_LIST.map((m) => (
            <span className="pr-legend-item" key={m.id} style={{ ['--c' as string]: m.accent }}>
              <b>{m.label}</b>
              <i>{m.blurb}</i>
            </span>
          ))}
          {/* The clip, named as the thing it is. It used to say "hover a card",
              which was true of a mouse and of nothing else — on a touchscreen
              there was no hovering to do and the sentence was an instruction
              nobody could follow. Every card now carries a play control you can
              press, so the hint leads with that and keeps the hover as the
              shortcut it always was. */}
          <span className="pr-legend-hint">
            <b>▶ CLICK ANY CARD</b>
            <i>and you are in it — one minute of PLAY. Rest on a card, or press CLIP, to watch it first</i>
          </span>
        </div>
        <p className="dim pr-lead pr-panel-lead">
          <b>PRACTICE</b> — this tab — is each champion taken apart: every mode is a single piece
          of a lane rehearsed on its own. <b>THE LANE</b> is all of it at once: a real game of
          League, farming minions while somebody tries to stop you. <b>CHARACTER</b>, under STUDY, is the
          reference behind both. Want something shorter? <b>DRILLS</b>, the first tab, is
          one-minute drills with no champion at all.
        </p>
        <p className="dim pr-lead pr-panel-lead">
          Every mode has two buttons. <b>PLAY</b> is one minute, always the same, so you can
          compare today's score to yesterday's. <b>SURVIVE</b> has no clock — it gets harder the
          longer you last and ends on your third mistake. Clicking anywhere else on a card is PLAY;
          rest on it for a moment and it plays you a clip of the mode instead.
        </p>
        <p className="set-note">
          Every number behind these — cooldowns, ranges, how long you have to dodge — is printed in{' '}
          <b>CHARACTER</b> under STUDY, so you can check any of it against the real game.
        </p>
      </Why>

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
        <Why label="why this one" className="pr-card-why">
          <p className="pr-brief">{meta.brief}</p>
          <p className="pr-transfers">{meta.transfers}</p>
        </Why>

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
 * out of what a player starred on the other three — a shelf of shortcuts, and
 * a way to string them into a queue and play straight through it.
 *
 * A playlist is deliberately shallow: an ordered list of activities, each
 * played PLAY-shape at whatever difficulty it would open on from its own
 * card. It is not a second settings screen for length or difficulty — those
 * questions already have an answer everywhere else in the client, and a
 * queue that stopped to ask them again would not be a queue.
 */
function FavoritesPanel({
  nextId,
  profile,
  settings,
  onPlay,
  onToggleStar,
  onPlayPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
  onRenamePlaylist,
  onSetPlaylistItems,
}: {
  profile: Profile;
  settings: AppSettings;
  onPlay: (id: DrillId, mode: RunMode, opts?: { difficulty?: number; duration?: number }) => void;
  onToggleStar: (id: DrillId) => void;
  onPlayPlaylist: (name: string, items: DrillId[]) => void;
  onCreatePlaylist: (name: string, items: DrillId[]) => void;
  onDeletePlaylist: (id: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  onSetPlaylistItems: (id: string, items: DrillId[]) => void;
  nextId?: DrillId;
}) {
  const starredMeta = DRILL_LIST.filter((d) => profile.stars.includes(d.id));

  return (
    <>
      <Explainer title="HOW FAVORITES WORKS">
        <p className="dim pr-lead pr-panel-lead">
          Star anything on the three tabs — the ★ sits in the corner of every drill, every
          champion mode and the lane — and it lands here. Build a playlist out of your stars and{' '}
          <b>PLAY PLAYLIST</b> runs straight through it, one activity into the next, looping back to
          the start once it is done.
        </p>
      </Explainer>

      <GroupHead
        label="STARRED"
        note="everything you have marked, across the whole client"
        count={`${starredMeta.length} ITEM${starredMeta.length === 1 ? '' : 'S'}`}
      />
      {starredMeta.length === 0 ? (
        <p className="dim pr-empty">
          Nothing starred yet. Open the ★ on any drill, champion mode or the lane to put it here.
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
              onPlay={onPlay}
              onToggleStar={() => onToggleStar(meta.id)}
            />
          ))}
        </div>
      )}

      <GroupHead
        label="PLAYLISTS"
        note="queues you built out of your stars — play straight through them"
        count={`${profile.playlists.length} LIST${profile.playlists.length === 1 ? '' : 'S'}`}
      />
      <div className="pr-playlists">
        {profile.playlists.map((pl) => (
          <PlaylistCard
            key={pl.id}
            playlist={pl}
            starred={starredMeta}
            onPlay={() => onPlayPlaylist(pl.name, pl.items)}
            onDelete={() => onDeletePlaylist(pl.id)}
            onRename={(name) => onRenamePlaylist(pl.id, name)}
            onSetItems={(items) => onSetPlaylistItems(pl.id, items)}
          />
        ))}
        <NewPlaylist starred={starredMeta} onCreate={onCreatePlaylist} />
      </div>
    </>
  );
}

/**
 * One starred activity, as a compact card — the same picture and PLAY button
 * every other card carries, without SURVIVE. It is the one card that says how
 * long it has been: a favourite you have stopped playing is worth a nudge.
 */
function FavoriteTile({
  id,
  profile,
  settings,
  onPlay,
  onToggleStar,
  isNext = false,
}: {
  id: DrillId;
  profile: Profile;
  settings: AppSettings;
  onPlay: (id: DrillId, mode: RunMode, opts?: { difficulty?: number; duration?: number; level?: number }) => void;
  onToggleStar: () => void;
  isNext?: boolean;
}) {
  const meta = DRILLS[id];
  const card = useRef<HTMLElement>(null);
  const start = () => {
    audio.play('uiClick');
    // The settings its own card would open on: the lab's suggested rung, the
    // lane's quick match, a mode's one minute.
    const spec = specFor(profile, id);
    onPlay(spec.drill, 'play', spec.opts);
  };
  return (
    <section
      ref={card}
      className={`pr-tile panel pr-startable${isNext ? ' is-next' : ''}`}
      data-drill={id}
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
        <Why label="why this one" className="pr-card-why">
          <p className="pr-brief">{meta.brief}</p>
        </Why>
        <div className="pr-buttons pr-buttons-one">
          <button className="pr-go pr-go-play" onMouseEnter={() => audio.play('uiHover')} onClick={start}>
            <span className="pr-go-label">PLAY</span>
          </button>
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
 * Reorder with the two arrows rather than a drag — a queue with thirteen
 * possible members has to work from a keyboard and a touchscreen as well as a
 * mouse, and an arrow does not need either of those to hit a target.
 */
function PlaylistCard({
  playlist,
  starred,
  onPlay,
  onDelete,
  onRename,
  onSetItems,
}: {
  playlist: Playlist;
  starred: DrillMeta[];
  onPlay: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onSetItems: (items: DrillId[]) => void;
}) {
  const [name, setName] = useState(playlist.name);
  useEffect(() => setName(playlist.name), [playlist.name]);
  const available = starred.filter((m) => !playlist.items.includes(m.id));

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= playlist.items.length) return;
    const next = [...playlist.items];
    [next[i], next[j]] = [next[j], next[i]];
    onSetItems(next);
  };
  const remove = (i: number) => onSetItems(playlist.items.filter((_, idx) => idx !== i));

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
        <button className="btn ghost" type="button" onClick={onDelete}>
          DELETE
        </button>
      </div>

      {playlist.items.length === 0 ? (
        <p className="dim pr-empty">Empty — add a starred activity below.</p>
      ) : (
        <ol className="pr-playlist-items">
          {playlist.items.map((id, i) => (
            <li key={`${id}-${i}`}>
              <b className="mono">{String(i + 1).padStart(2, '0')}</b>
              <span>{DRILLS[id].name}</span>
              <span className="pr-playlist-item-controls">
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
            if (id) onSetItems([...playlist.items, id]);
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
