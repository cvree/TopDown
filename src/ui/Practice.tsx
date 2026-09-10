import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { PRACTICE_MODES, RUN_MODE_LIST, type RunMode } from '../drills/modes';
import { LANE_LENGTHS, LANE_TIERS, type LaneTier } from '../progression/lane';
import { CAITLYN_STATS } from '../engine/caitlyn';
import { FLASH_LEAGUE_CD, FLASH_PRACTICE_CD, FLASH_RANGE } from '../engine/summoners';
import { VAYNE_STATS, tumbleCdAt, tumblePracticeCdAt, condemnCdAt, condemnPracticeCdAt } from '../engine/vayne';
import { resolveBindings, shortCodeLabel, type AbilitySlot, type Bindings } from '../engine/input';
import type { AppSettings, Profile } from '../progression/profile';
import { Explainer } from './components/Explainer';
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
  /**
   * Which section to open on, overriding the one the player was last reading.
   *
   * Nothing in the client passes it. The headless profile check does, so that
   * a hostile stored profile is still drawn through all three sections rather
   * than only the one a fresh mount happens to open on — every one of them
   * reads a different corner of a saved record, and each is only rendered
   * while its own tab is open.
   */
  initialSection?: SectionId;
}

type PlayFn = Props['onPlay'];

/** mm:ss, for a survival record. */
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Which keys a mode actually hands you, in the order they sit on the bar. */
const KIT_ORDER: { slot: AbilitySlot; name: string }[] = [
  { slot: 'q', name: 'TUMBLE' },
  { slot: 'w', name: 'SILVER BOLTS' },
  { slot: 'e', name: 'CONDEMN' },
  { slot: 'r', name: 'FINAL HOUR' },
];

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
// THE THREE SECTIONS
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
 * Three sections now, and every one of them is the champion:
 *
 *  - **THE LANE** is the game. One card, one decision, and it is first because
 *    everything else on the screen exists to make it go better.
 *  - **PRACTICE** is the champion in pieces: six modes, grouped by how much of
 *    her they hand you, from a body with no abilities to a whole opponent.
 *  - **THE CODEX** is the reading: every figure both champions are built from,
 *    so a claim the trainer makes about transfer is one you can check.
 *
 * The fourth used to be the lab, and the lab is not this screen's business.
 * Everything here is a champion — her lane, her kit, her numbers — and a bench
 * with no champion on it was being read as one more thing about Vayne when it
 * is the layer underneath every champion there will ever be. It is a section
 * of the client now, next to this one in the top bar, and this screen is
 * exactly the three things that are about the woman in the title.
 *
 * The tab rail is sticky, so the three are one keystroke apart from anywhere on
 * any of them, and the section you are in is never more than a glance away.
 */
type SectionId = 'lane' | 'practice' | 'codex';

interface SectionMeta {
  id: SectionId;
  /** The numeral on the tab. The order is the order it is taught. */
  no: string;
  label: string;
  /** What the section is, in three words, under the label. */
  sub: string;
  accent: string;
}

/**
 * The tab the player was last on.
 *
 * Module-level rather than stored on the profile: which of three sections you
 * are reading is session state, not a preference worth writing to disk — but
 * it does have to survive the screen being unmounted, which it is every time a
 * run starts. Coming back from a bench in the lab and landing on the lane is
 * the client forgetting what you were doing.
 */
let lastSection: SectionId = 'lane';

const SECTIONS: SectionMeta[] = [
  { id: 'lane', no: '01', label: 'THE LANE', sub: 'play a real lane', accent: '#ffd166' },
  { id: 'practice', no: '02', label: 'PRACTICE', sub: 'one skill at a time', accent: '#c86bff' },
  { id: 'codex', no: '03', label: 'THE NUMBERS', sub: 'what everything does', accent: '#e0b05c' },
];

/** The three, in order — for anything that has to walk all of them. */
export const SECTION_IDS: SectionId[] = SECTIONS.map((s) => s.id);

/**
 * THE MENU.
 *
 * There used to be seven sections, four ladders, a daily queue, a calibration
 * sequence and a course of gated stages, and between them they asked a player
 * roughly a dozen questions before anything happened on a screen. This asks
 * two: which part of the champion, and for how long.
 *
 * Every mode on it is played as Vayne. That is not a filter over a larger
 * catalogue — it is what the trainer is for. There are two deliberate
 * exceptions, at the two ends of the list:
 *
 *  - **RANGE** is about the one distance every champion has and no champion
 *    draws for you, so it hands you a body and nothing else. A mode that put
 *    you behind a body with no tumble could tell you about your hands in the
 *    abstract; it could not tell you anything about the quarter of a second at
 *    the end of a roll, which is where this champion is won and lost.
 *  - **SHERIFF** is the other half of a lane. Everything above it measures
 *    what your hands did; this one measures what you did about somebody
 *    else's, which is a skill that cannot be rehearsed alone — so its kit is
 *    printed in the codex exactly as the champion's own is, because a window
 *    you are expected to beat has to be a number you can check.
 */
export function Practice({ profile, settings, onPlay, initialSection }: Props) {
  const bound = bindingsOf(settings);
  const [section, setSection] = useState<SectionId>(initialSection ?? lastSection);
  const railRef = useRef<HTMLDivElement>(null);

  const choose = (id: SectionId) => {
    lastSection = id;
    setSection(id);
  };

  // A tab is a page, so it starts at the top of itself. Without this, opening
  // THE CODEX from halfway down PRACTICE drops you halfway down the codex.
  //
  // The second half is for the narrow layout, where the rail scrolls sideways
  // rather than fitting: the tab you just opened has to be the one you can
  // see. Done by hand rather than with scrollIntoView, because that would also
  // scroll the page vertically and undo the line above it.
  useEffect(() => {
    const scroller = railRef.current?.closest('.scroll');
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
    const list = railRef.current?.querySelector<HTMLElement>('.pr-tablist');
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const tab = list.querySelectorAll<HTMLElement>('.pr-tab')[
      SECTIONS.findIndex((s) => s.id === section)
    ];
    if (!tab) return;
    const left = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [section]);

  // What each tab has to say about itself before you open it. All four are
  // counts of the thing inside, and three of them are also a record — a tab
  // that can tell you how far through it you are is worth more than a tab
  // that can only tell you it exists.
  const counts = useMemo(() => {
    const lanes = LANE_TIERS.reduce((n, t) => n + (profile.lane?.tiers?.[t.id]?.runs ?? 0), 0);
    const played = PRACTICE_MODES.filter((id) => profile.bests[id] || profile.survive[id]).length;
    return {
      lane: {
        count: `${LANE_TIERS.length} OPPONENTS`,
        note: lanes > 0 ? `${lanes} lane${lanes > 1 ? 's' : ''} played` : 'never played',
      },
      practice: {
        count: `${PRACTICE_MODES.length} MODES`,
        note: played > 0 ? `${played}/${PRACTICE_MODES.length} tried` : 'none tried yet',
      },
      codex: { count: '2 CHAMPIONS', note: 'every ability, explained' },
    } as Record<SectionId, { count: string; note: string }>;
  }, [profile]);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  // Left and right walk the rail, Home and End jump to its ends — the tab
  // pattern every desktop client uses, and the one a keyboard player will try
  // first.
  const onRailKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SECTIONS.findIndex((s) => s.id === section);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % SECTIONS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + SECTIONS.length) % SECTIONS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SECTIONS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    audio.play('uiTab');
    choose(SECTIONS[next].id);
    railRef.current?.querySelectorAll<HTMLButtonElement>('.pr-tab')[next]?.focus();
  };

  return (
    <div className="scroll">
      <div className="wrap practice fade-up">
        <header className="pr-head">
          <div className="eyebrow">Play as · Vayne</div>
          <h1 className="display pr-h1">VAYNE</h1>
          <p className="dim pr-lead">
            One champion, three tabs — the lane, the pieces of it, the numbers behind them.
          </p>
        </header>

        {/* ------------------------------------------------------------ rail */}
        <div className="pr-tabs" ref={railRef}>
          <div
            className="pr-tablist"
            role="tablist"
            aria-label="Practice sections"
            onKeyDown={onRailKey}
          >
            {SECTIONS.map((s) => {
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
                  tabIndex={on ? 0 : -1}
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
          role="tabpanel"
          aria-labelledby={`pr-tab-${section}`}
          style={{ ['--c' as string]: active.accent }}
        >
          {section === 'lane' && <LanePanel profile={profile} bound={bound} onPlay={onPlay} />}
          {section === 'practice' && (
            <PracticePanel profile={profile} bound={bound} onPlay={onPlay} />
          )}
          {section === 'codex' && <CodexPanel />}
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
// 01 — THE LANE
// ===========================================================================

function LanePanel({
  profile,
  bound,
  onPlay,
}: {
  profile: Profile;
  bound: Bindings;
  onPlay: PlayFn;
}) {
  return (
    <>
      <Explainer title="HOW THIS SCREEN WORKS">
        <p className="dim pr-lead pr-panel-lead">
          One champion, three tabs. <b>THE LANE</b> is a real game of League — farm minions while
          somebody tries to stop you. <b>PRACTICE</b> breaks that into small pieces you can
          rehearse one at a time. <b>THE NUMBERS</b> is the reference: exactly what every ability
          does, if you want to check. Want something shorter? <b>TRAIN</b> in the top bar is
          one-minute drills with no champion at all.
        </p>
        <p className="dim pr-lead pr-panel-lead">
          This is the actual game: minions walk in, you kill the ones about to die for gold, and
          somebody on the other side is doing the same and trying to stop you. Pick who you are up
          against and how long you want to play. Everything in <b>PRACTICE</b> is one piece of this
          on its own; here you find out whether it held up.
        </p>
      </Explainer>
      <GroupHead label="THE MATCH" note="pick an opponent, pick a length" count="1 MODE" />
      <LaneCard profile={profile} bound={bound} onPlay={onPlay} />
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
  bound,
  onPlay,
}: {
  profile: Profile;
  bound: Bindings;
  onPlay: (id: DrillId, mode: RunMode, opts?: { difficulty?: number; duration?: number }) => void;
}) {
  const meta = DRILLS.lanePhase;
  const [tier, setTier] = useState<LaneTier>(LANE_TIERS[1]);
  const record = profile.lane?.tiers?.[tier.id];

  return (
    <section className="pr-card panel pr-lane" style={{ ['--c' as string]: tier.accent }}>
      <div className="pr-card-head">
        <div>
          <div className="eyebrow">a real game of League</div>
          <h2 className="display pr-name">{meta.name}</h2>
          <div className="pr-tag">{meta.tagline}</div>
        </div>
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

      <p className="pr-brief">{meta.brief}</p>
      <p className="pr-transfers">
        <span className="eyebrow">Why it matters</span>
        {meta.transfers}
      </p>

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

      <p className="set-note">
        Everything here is League's own: the same minions, the same health, the same gold, the
        same wave every thirty seconds, the same turret. You both start at level one and level up
        as the wave pays for it. There is no shop — gold is just the scoreboard — and no jungler,
        so nobody is coming out of the river. Health does not come back on its own, so{' '}
        <b>{shortCodeLabel(bound.f.primary)}</b> to go home is a real decision.
      </p>
    </section>
  );
}

// ===========================================================================
// 02 — PRACTICE
// ===========================================================================

/**
 * The champion, in pieces, grouped by how much of her a mode hands you.
 *
 * The list itself still lives in `modes.ts` — this is a reading of it, not a
 * second copy. Four groups, in the order the champion is learned:
 *
 *  1. **FOUNDATION** hands you a body and nothing else, because every mode
 *     under it already assumes you know how far you reach.
 *  2. **THE KIT** is one ability at a time, which is the only way a cooldown
 *     ever becomes a rhythm rather than a decision.
 *  3. **THE WHOLE CHAMPION** hands all of it back at once.
 *  4. **AGAINST SOMEBODY** is the half of a lane that is not about your hands.
 *
 * Anything added to `PRACTICE_MODES` that no group claims still appears, under
 * a group of its own — a mode that exists and is not on the menu is a worse
 * outcome than a group heading that reads a little vague.
 */
const PRACTICE_GROUPS: { id: string; label: string; note: string; members: DrillId[] }[] = [
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
    id: 'champion',
    label: 'THE WHOLE CHAMPION',
    note: 'all four abilities at once, in the dark',
    members: ['vayneHunt'],
  },
  {
    id: 'versus',
    label: 'AGAINST SOMEBODY',
    note: 'somebody is shooting back — this one is about reading them',
    members: ['caitlynDodge'],
  },
];

function PracticePanel({
  profile,
  bound,
  onPlay,
}: {
  profile: Profile;
  bound: Bindings;
  onPlay: PlayFn;
}) {
  // Groups are drawn from the real list, so a mode is on this screen because
  // `PRACTICE_MODES` contains it and not because a group here names it.
  const claimed = new Set(PRACTICE_GROUPS.flatMap((g) => g.members));
  const groups = [
    ...PRACTICE_GROUPS.map((g) => ({ ...g, members: g.members.filter((id) => PRACTICE_MODES.includes(id)) })),
    {
      id: 'more',
      label: 'MORE',
      note: 'newer modes, not yet filed with the rest',
      members: PRACTICE_MODES.filter((id) => !claimed.has(id)),
    },
  ].filter((g) => g.members.length > 0);

  return (
    <>
      <Explainer title="HOW THESE MODES WORK">
        <p className="dim pr-lead pr-panel-lead">
          Six modes, each one a single piece of a lane taken out and rehearsed on its own. Every
          one of them has two buttons. <b>PLAY</b> is one minute, always the same, so you can
          compare today's score to yesterday's. <b>SURVIVE</b> has no clock — it gets harder the
          longer you last and ends on your third mistake.
        </p>
        <p className="set-note">
          Every number behind these six — cooldowns, ranges, how long you have to dodge — is
          printed in <b>THE NUMBERS</b>, so you can check any of it against the real game.
        </p>
      </Explainer>

      <div className="pr-legend">
        {RUN_MODE_LIST.map((m) => (
          <span className="pr-legend-item" key={m.id} style={{ ['--c' as string]: m.accent }}>
            <b>{m.label}</b>
            <i>{m.blurb}</i>
          </span>
        ))}
      </div>

      {groups.map((g) => (
        <div className="pr-group" key={g.id}>
          <GroupHead
            label={g.label}
            note={g.note}
            count={`${g.members.length} MODE${g.members.length > 1 ? 'S' : ''}`}
          />
          <div className="pr-modes">
            {g.members.map((id) => (
              <ModeCard key={id} id={id} profile={profile} bound={bound} onPlay={onPlay} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function ModeCard({
  id,
  profile,
  bound,
  onPlay,
}: {
  id: DrillId;
  profile: Profile;
  bound: Bindings;
  onPlay: (id: DrillId, mode: RunMode) => void;
}) {
  const meta = DRILLS[id];
  const best = profile.bests[id];
  const survived = profile.survive[id];
  const uses = new Set<AbilitySlot>(meta.abilities);

  return (
    <section className="pr-card panel" style={{ ['--c' as string]: meta.accent }}>
      <div className="pr-card-head">
        <div>
          <h2 className="display pr-name">{meta.name}</h2>
          <div className="pr-tag">{meta.tagline}</div>
        </div>
        {/* A mode that hands you no kit prints no kit. Four dim letters would
            be answering "which abilities" with "none of them", at length. */}
        {meta.abilities.length > 0 && (
          <div className="pr-keys">
            {KIT_ORDER.map((k) => (
              <i key={k.slot} className={uses.has(k.slot) ? 'on' : ''} title={k.name}>
                {shortCodeLabel(bound[k.slot].primary)}
              </i>
            ))}
          </div>
        )}
      </div>

      <p className="pr-brief">{meta.brief}</p>
      <p className="pr-transfers">
        <span className="eyebrow">Why it matters</span>
        {meta.transfers}
      </p>

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
              <span className="pr-go-sub">{m.tagline}</span>
              <span className="pr-go-best mono">{record}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ===========================================================================
// 03 — THE CODEX
// ===========================================================================

/**
 * The reading.
 *
 * Two kits, and they used to sit in the middle of the screen between the
 * champion cards and the lab — a thousand words of reference wedged between
 * two things you were there to click. They are here instead, together, behind
 * one switch, because they are the same kind of object pointed at two
 * champions: every number a mode is built from, printed, so a claim about
 * transfer is one the player can check rather than take.
 */
type CodexId = 'vayne' | 'sheriff';

const CODEX: { id: CodexId; label: string; sub: string; accent: string }[] = [
  { id: 'vayne', label: 'VAYNE', sub: 'the one you play', accent: '#c86bff' },
  { id: 'sheriff', label: 'CAITLYN', sub: 'the one shooting at you', accent: '#ffb02e' },
];

function CodexPanel() {
  const [who, setWho] = useState<CodexId>('vayne');
  const active = CODEX.find((c) => c.id === who) ?? CODEX[0];

  return (
    <>
      <p className="dim pr-lead pr-panel-lead">
        Reference only — nothing to click. If a drill expects you to dodge something in under a
        second, this is where you can look up exactly how long you had.
      </p>

      <div className="pr-seg" role="tablist" aria-label="Which kit">
        {CODEX.map((c) => (
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
              setWho(c.id);
            }}
          >
            <b className="display">{c.label}</b>
            <i>{c.sub}</i>
          </button>
        ))}
      </div>

      <div key={who} className="fade-in" style={{ ['--c' as string]: active.accent }}>
        {who === 'vayne' ? <KitReference /> : <SheriffReference />}
      </div>
    </>
  );
}

/**
 * What the numbers actually are.
 *
 * A trainer that claims to feel like the champion owes the player the figures
 * it is claiming it with, because the only way to know whether the transfer is
 * real is to be able to check it against the game.
 */
function KitReference() {
  const rows = [
    {
      slot: 'Q',
      name: 'TUMBLE',
      body: `A ${VAYNE_STATS.tumbleRange} unit roll that takes ${VAYNE_STATS.tumbleTime}s, during which she cannot shoot. Cancels the backswing for free and throws the attack away if you take it in the windup. League's cooldown is ${tumbleCdAt(1)}s at one point falling to ${tumbleCdAt(5)}s maxed, halved inside Final Hour; a practice run guarantees one roughly every ${VAYNE_STATS.tumblePracticeFloor}s, so a single point comes back in ${tumblePracticeCdAt(1)}s and anything already faster than the floor is left exactly where League leaves it.`,
    },
    {
      slot: 'W',
      name: 'SILVER BOLTS',
      body: `Every ${VAYNE_STATS.boltsPerProc}rd hit on the same target detonates for a share of its maximum health as true damage. Stacks fall off ${VAYNE_STATS.boltsDecay}s after the last hit, and switching target at two throws them away.`,
    },
    {
      slot: 'E',
      name: 'CONDEMN',
      body: `${VAYNE_STATS.condemnRange} range, ${VAYNE_STATS.condemnCast}s of cast time standing still, then a ${VAYNE_STATS.condemnPush} unit knockback. Terrain at the end of it is ${VAYNE_STATS.condemnStun}s of stun and a second helping of damage; open ground is nothing. League's cooldown is ${condemnCdAt(1)}s falling to ${condemnCdAt(5)}s; every mode here charges ${Math.round(VAYNE_STATS.condemnPracticeShare * 100)}% of that — ${condemnPracticeCdAt(1)}s to ${condemnPracticeCdAt(5)}s — because the thing worth rehearsing is not the cast, it is the roll that puts the wall behind them and the cast that follows it, and two cooldowns have to be up at once for that to happen at all.`,
    },
    {
      slot: 'R',
      name: 'FINAL HOUR',
      body: `A window rather than a button: more damage, half the tumble cooldown, ${VAYNE_STATS.finalHourStealth}s of invisibility on each roll, and a reset on every takedown.`,
    },
    {
      slot: 'D',
      name: 'WARD',
      body: `Thrown up to ${VAYNE_STATS.wardRange} units, and — as in League — thrown *over* terrain rather than stopped by it, because the eye you want is nearly always in the place you cannot walk to. It lights ${VAYNE_STATS.wardSight} around itself for ${VAYNE_STATS.wardLife}s, ${VAYNE_STATS.wardMax} at a time, and comes back every ${VAYNE_STATS.wardCd}s. Both of those are far shorter than League's, because holding a piece of the map for two minutes is a macro skill and spending vision on the next ten seconds is a habit — and the habit is the part a sixty second rep can build. Night Hunter is the mode with a fog for it to lift.`,
    },
    {
      slot: 'F',
      name: 'FLASH',
      body: `The other thing on the bar that is not hers, and the one button every champion in the game shares. ${FLASH_RANGE} units toward the cursor, instantly, straight over terrain — a wall stops you standing inside it and does not stop you crossing it. It costs the attack you were already winding up, and it goes on ${FLASH_PRACTICE_CD}s rather than League's ${FLASH_LEAGUE_CD}: five minutes is a decision about the next five minutes of a game, and what a rep can teach is the gesture underneath it — which wall is thin enough, and pressing it at all rather than dying with it up.`,
    },
    {
      slot: 'P',
      name: 'NIGHT HUNTER',
      body: `${VAYNE_STATS.huntBonusMs} movement speed whenever she is walking toward somebody within ${VAYNE_STATS.huntRange} units. It is why she closes ground she has no business closing.`,
    },
  ];

  return (
    <section className="panel pad pr-kit">
      <div className="panel-title">Vayne's abilities, in full</div>
      <div className="pr-kit-rows">
        {rows.map((r) => (
          <div className="pr-kit-row" key={r.slot}>
            <i className="pr-kit-slot">{r.slot}</i>
            <b className="pr-kit-name">{r.name}</b>
            <span className="pr-kit-body">{r.body}</span>
          </div>
        ))}
      </div>
      <p className="set-note">
        Two cooldowns here are shorter than League's, and both on purpose. Condemn is charged at{' '}
        {Math.round(VAYNE_STATS.condemnPracticeShare * 100)}% and Tumble never takes longer than{' '}
        {VAYNE_STATS.tumblePracticeFloor} seconds — so a minute gives you a dozen attempts at the
        thing worth practising rather than two. Everything else is League's exactly.
      </p>
    </section>
  );
}


/**
 * What she throws, and how long you have.
 *
 * The same contract as the kit table above, pointed the other way: every
 * window the mode expects you to beat is printed as a number, because the only
 * way to know whether a dodge was late is to know what "on time" was. Nothing
 * on this list is a surprise mechanic — she is a champion, she has four
 * buttons, and all four of them are on the screen before you press PLAY.
 */
function SheriffReference() {
  const rows = [
    {
      slot: 'Q',
      name: 'PILTOVER PEACEMAKER',
      body: `A ${CAITLYN_STATS.qRange} unit line, ${CAITLYN_STATS.qWidth} wide, at ${CAITLYN_STATS.qSpeed} units a second — and ${CAITLYN_STATS.qCast}s of cast time before any of it happens, during which she cannot move and the direction is already locked. That six tenths of a second is the whole dodge: one step, early, at right angles to the lane on the floor. It pierces, so standing behind something is not an answer.`,
    },
    {
      slot: 'W',
      name: 'YORDLE SNAP TRAP',
      body: `Thrown up to ${CAITLYN_STATS.wRange} units, arms in ${CAITLYN_STATS.wArm}s, and deals no damage whatsoever — exactly as in League. What it costs is ${CAITLYN_STATS.wRoot}s of not being able to move and a free headshot, which means the Peacemaker that follows is one you cannot dodge. Three on the floor at a time, ${CAITLYN_STATS.wLife}s each. She puts them where you are going, and under you when you are not going anywhere.`,
    },
    {
      slot: 'E',
      name: '90 CALIBER NET',
      body: `${CAITLYN_STATS.eRange} range, ${Math.round(CAITLYN_STATS.eSlow * 100)}% slow for ${CAITLYN_STATS.eSlowFor}s, and it throws her ${CAITLYN_STATS.eSelfPush} units the other way. It is her answer to you closing the gap, and the slow is the dangerous half: a Peacemaker aimed at somebody moving at half speed is a Peacemaker aimed at somebody standing still.`,
    },
    {
      slot: 'R',
      name: 'ACE IN THE HOLE',
      body: `A ${CAITLYN_STATS.rChannel}s channel at up to ${CAITLYN_STATS.rRange} units, and then it simply hits you for ${CAITLYN_STATS.rDamage}. There is no movement that beats it. The only thing that does is terrain on the line at the moment it lands, so the channel is your second to find a wall — and there is one within a second's walk of anywhere on that floor.`,
    },
    {
      slot: 'P',
      name: 'HEADSHOT',
      body: `Every ${CAITLYN_STATS.headshotEvery}th basic attack lands for ${Math.round(CAITLYN_STATS.headshotBonus * 100)}% extra, and a trapped or netted target takes one immediately. It is the price of standing inside ${CAITLYN_STATS.attack.range} units of her — a hundred more than you reach — and it is why the answer to this matchup is never "stay at max range and trade".`,
    },
  ];

  return (
    <section className="panel pad pr-kit" style={{ ['--c' as string]: '#ffb02e' }}>
      <div className="panel-title">What Caitlyn throws at you</div>
      <div className="pr-kit-rows">
        {rows.map((r) => (
          <div className="pr-kit-row" key={r.slot}>
            <i className="pr-kit-slot">{r.slot}</i>
            <b className="pr-kit-name">{r.name}</b>
            <span className="pr-kit-body">{r.body}</span>
          </div>
        ))}
      </div>
      <p className="set-note">
        Her cooldowns are League's, charged at {Math.round(CAITLYN_STATS.practiceShare * 100)}% —
        so she throws things at you often enough to actually practise dodging them. Her ranges,
        her health and her movement speed are untouched. Her basic attack hits softer than
        League's, because this mode is testing your dodging rather than your spacing.
      </p>
    </section>
  );
}
