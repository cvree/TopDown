import { useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import type { RunMode } from '../drills/modes';
import {
  APM_LEVELS,
  APM_MODES,
  levelDifficulty,
  levelStars,
  recommendedLevel,
  starsOn,
  type ApmLevelRecord,
  type ApmMode,
  type ApmModeKind,
} from '../progression/apm';
import {
  KEYS_COMPLETE_AT,
  MAP_MIN_LEVEL,
  ORDER_AT,
  keysAtLevel,
  ordersAtLevel,
  rungAdds,
} from '../drills/apm';
import type { ApmDrillId } from '../drills/apm';
import { checkLabBinds, faultKey, playableTo, type BindReport } from '../drills/apm/binds';
import { defaultsFor, resolveBindings, type Bindings } from '../engine/input';
import type { AppSettings, Profile } from '../progression/profile';
import { Explainer } from './components/Explainer';
import { ModePreview } from './components/ModePreview';
import './practice.css';
import './lab.css';

interface Props {
  profile: Profile;
  settings: AppSettings;
  onPlay: (
    id: DrillId,
    mode: RunMode,
    opts?: { difficulty?: number; duration?: number; level?: number },
  ) => void;
  /** Opens the controls screen. The lab is the one section that can need it. */
  onFixControls: () => void;
}

type PlayFn = Props['onPlay'];

// ===========================================================================
// THE LAB
// ===========================================================================

/**
 * THE LAB — thirteen drills for your hands, and nothing else.
 *
 * PLAY is the champion: her lane, her kit, the numbers behind both. This is
 * the layer under every champion — a floor of squares that light up, and one
 * question: how many of them did you answer correctly in a minute.
 *
 * Two rules run the whole section, and they are the only two anybody needs.
 *
 * **Every level is open.** Ten levels a drill, none of them locked, ever. The
 * level a card opens on is a suggestion — the lowest one you have not beaten
 * — and the arrows move it. A player who wants to see level ten on day one
 * should be allowed to see level ten on day one.
 *
 * **A level is a fixed speed and a fixed set of keys.** It does not speed up
 * because the run is going well, so two scores at level six are two scores of
 * the same thing. Level one is two keys; every level after it hands over one
 * more piece of the keyboard until, by level seven, all of it is in play.
 *
 * The thirteen split by how much they ask at once, because that is the split
 * that tells you what to play next: one task, or two running together.
 */
const LAB_GROUPS: { kind: ApmModeKind; label: string; note: string }[] = [
  {
    kind: 'isolated',
    label: 'ONE THING AT A TIME',
    note: 'start here — one job, nothing else on screen',
  },
  {
    kind: 'combined',
    label: 'TWO AT ONCE',
    note: 'two jobs running together. Worth it once the ones above feel easy',
  },
];

/**
 * The layout a lab run will actually be played on.
 *
 * Read here rather than inside a card, and read defensively: this screen is
 * reached from a stored profile, and a menu that throws on a half-written
 * settings object is a player who cannot reach the screen that would fix it.
 */
const labBindings = (settings: AppSettings | undefined): Bindings => {
  const scheme = settings?.movementScheme === 'wasd' ? 'wasd' : 'click';
  try {
    return resolveBindings(scheme, scheme === 'wasd' ? settings?.wasdBindings : settings?.bindings);
  } catch {
    return defaultsFor(scheme);
  }
};

export function Lab({ profile, settings, onPlay, onFixControls }: Props) {
  // Which rung each mode is showing. Empty means "whatever the ladder
  // suggests", so a mode the player has not touched this session always opens
  // on the rung they have not beaten rather than on the one they last looked at.
  const [picked, setPicked] = useState<Partial<Record<ApmDrillId, number>>>({});

  const step = (m: ApmMode, level: number, by: number) => {
    audio.play('uiTab');
    setPicked((prev) => ({ ...prev, [m.id]: Math.max(1, Math.min(level + by, APM_LEVELS)) }));
  };

  // What the section can say about itself before you read any of it: how many
  // benches there are, and how far through them you have got.
  const stars = useMemo(
    () => APM_MODES.reduce((n, m) => n + starsOn(profile.apm, m.id), 0),
    [profile],
  );

  return (
    <div className="scroll">
      <div className="wrap practice lab-screen fade-up">
        <header className="pr-head">
          <div className="eyebrow">Train · one minute at a time</div>
          <h1 className="display pr-h1 lab-h1">THE LAB</h1>
          <p className="dim pr-lead">
            Squares light up. Put your cursor on the one that is lit and hit its key — misses
            and mashing score nothing.
          </p>
          <div className="lab-tally mono">
            <span>
              <b>{APM_MODES.length}</b> DRILLS
            </span>
            <span>
              <b>{APM_LEVELS}</b> LEVELS EACH · NOTHING LOCKED
            </span>
            <span>
              <b>{stars}</b>/{APM_MODES.length * APM_LEVELS * 3} STARS
            </span>
          </div>
        </header>

        <div className="pr-panel fade-up" style={{ ['--c' as string]: '#7ceaff' }}>
          <LabPanel
            profile={profile}
            settings={settings}
            picked={picked}
            onStep={step}
            onPlay={onPlay}
            onFixControls={onFixControls}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The heading every group of benches wears: what the group is, and the one
 * line explaining why these things are together rather than somewhere else.
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

/**
 * THE ONE THING THAT CAN MAKE THIS SECTION LIE TO YOU.
 *
 * The lab's levels are made of keys — the ladder hands over one more piece of
 * the keyboard every rung — so a player missing a binding has not made the lab
 * slightly different, they have made part of it unplayable. And the bench will
 * not say so: it lights the pad, waits out the window, scores the miss, and
 * the run comes back reading *you were too slow*.
 *
 * That is the one failure this client must never have, because it teaches the
 * player that their hands are the problem when the truth is that a key is
 * missing. So the section checks before the run rather than after it, says
 * which row on which screen, and — this is the part that matters — says what
 * it is going to cost, in rungs, so the player can decide whether to fix it
 * now or play the eight levels it does not affect.
 */
function BindWarning({
  report,
  bound,
  ceiling,
  onFixControls,
}: {
  report: BindReport;
  bound: Bindings;
  ceiling: number;
  onFixControls: () => void;
}) {
  const shut = ceiling < APM_LEVELS;
  return (
    <div className="lab-binds" role="alert">
      <div className="lab-binds-head">
        <b className="display">
          {ceiling === 0 ? 'THE LAB CANNOT RUN ON THIS LAYOUT' : 'SOME LEVELS CANNOT BE PLAYED'}
        </b>
        <button
          type="button"
          className="lab-binds-fix"
          onMouseEnter={() => audio.play('uiHover')}
          onClick={() => {
            audio.play('uiClick');
            onFixControls();
          }}
        >
          FIX CONTROLS
        </button>
      </div>
      <p className="lab-binds-lead">
        {ceiling === 0 ? (
          <>
            Level 1 already asks for a key you do not have bound. Nothing here can be scored
            honestly until this is fixed — the bench would light a pad, wait, and mark you down
            for a press you have no way to make.
          </>
        ) : (
          <>
            Levels <b>1–{ceiling}</b> are fine and every card below will play them. From{' '}
            <b>level {ceiling + 1}</b> the ladder starts asking for a key you do not have, and a
            bench does not know the difference between a key you cannot press and a key you
            pressed late — it would simply score you as slow.
          </>
        )}
      </p>
      <ul className="lab-binds-list">
        {report.faults.map((fault) => (
          <li key={fault.action} className={`lab-bind-row ${fault.kind}`}>
            <b className="mono">{fault.kind === 'unbound' ? 'UNBOUND' : faultKey(bound, fault)}</b>
            <span>
              <b>{fault.label}</b> — {fault.role}
              {fault.kind === 'clash' && (
                <i> · shares its button with {fault.clashes.join(', ')}, so one of them never arrives</i>
              )}
            </span>
            <i className="mono lab-bind-from">FROM LEVEL {fault.from}</i>
          </li>
        ))}
      </ul>
      {shut && ceiling > 0 && (
        <p className="set-note">
          Nothing is hidden and nothing is locked. Every card still shows all ten levels and the
          arrows still move between them — the rungs above {ceiling} simply will not{' '}
          <i>start</i> until this is fixed, and each card names the key it is waiting on. That is
          the only thing in this section that has ever stopped a button, and it is here because
          the alternative is a minute of being marked down for a press you have no key to make.
        </p>
      )}
    </div>
  );
}

/**
 * The key ladder, printed.
 *
 * The one thing about the section a new player could not previously find out
 * without playing all ten rungs: what a level actually changes besides the
 * speed. Ten cells, and the ones that hand over a key say which.
 */
function KeyLadder() {
  return (
    <div className="lab-keyladder">
      <div className="lab-kl-head mono">
        WHAT EACH LEVEL ADDS · <b>every one of them playable right now</b>
      </div>
      <ol className="lab-kl-rungs">
        {Array.from({ length: APM_LEVELS }, (_, i) => i + 1).map((n) => {
          const adds = rungAdds(n);
          return (
            <li key={n} className={`lab-kl-rung${adds ? ' gains' : ''}`}>
              <b className="mono">{n}</b>
              <span>{adds || 'the same keys, faster'}</span>
              <i className="mono">
                {keysAtLevel(n).length + ordersAtLevel(n).length} KEYS
              </i>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function LabPanel({
  profile,
  settings,
  picked,
  onStep,
  onPlay,
  onFixControls,
}: {
  profile: Profile;
  settings: AppSettings;
  picked: Partial<Record<ApmDrillId, number>>;
  onStep: (m: ApmMode, level: number, by: number) => void;
  onPlay: PlayFn;
  onFixControls: () => void;
}) {
  const scheme = settings?.movementScheme === 'wasd' ? 'wasd' : 'click';
  const bound = labBindings(settings);
  // The whole ladder, not the rung a card happens to be showing: a layout that
  // cannot answer level seven is worth saying out loud on level one, because
  // the player is going to walk into it and the mode will not tell them.
  const ceiling = playableTo(bound, scheme, APM_LEVELS);
  const top = checkLabBinds(bound, APM_LEVELS, scheme);
  return (
    <>
      {!top.ok && (
        <BindWarning
          report={top}
          bound={bound}
          ceiling={ceiling}
          onFixControls={onFixControls}
        />
      )}
      <Explainer title="HOW THE LAB WORKS">
        <p className="dim pr-lead pr-panel-lead">
          Each run lasts one minute and counts the presses you got <i>right</i> — a wrong key or
          a wasted one scores nothing, so hammering the keyboard gives you the worst score here,
          not the best. Get several right in a row and they start counting for more.
        </p>
        <p className="dim pr-lead pr-panel-lead">
          <b>Your cursor has to be on the square you are answering.</b> The key alone does
          nothing — put the pointer on the lit square and then press it. That is the whole
          rule, and it is why this section cannot be beaten by hammering the right keys from
          wherever your mouse happened to be left. The square you have to be on wears a second
          ring inside its edge; it closes and lights up the moment you are on it, and if you
          are not, a line is drawn from your cursor to the square that wants you.
        </p>
        <p className="dim pr-lead pr-panel-lead">
          <b>Pick a level and it stays there for the whole minute.</b> It never speeds up because
          you are doing well, so two runs at level 6 are two runs at the same thing and the scores
          can be compared. Every card opens on the lowest level you have not beaten yet — the
          arrows move it, and nothing is ever locked.
        </p>
        <p className="dim pr-lead pr-panel-lead">
          <b>Higher levels do two things.</b> The squares move further and faster, and you get
          more keys to answer with — level 1 is two fingers, and by{' '}
          <b>level {KEYS_COMPLETE_AT}</b> the whole keyboard is in play.
        </p>

        <KeyLadder />

        <p className="dim pr-lead pr-panel-lead">
          Two of those levels add something new to look at. From <b>level {MAP_MIN_LEVEL}</b> a
          small map appears in the corner: something drops down one of two lanes, and your D and F
          keys say which lane you stand in. Ignore it and you lose your streak — same as being
          ganked because you never looked. From <b>level {ORDER_AT.move}</b> a strip along the
          bottom asks for mouse commands too: <b>move</b>, <b>attack-move</b> and <b>stop</b>.
        </p>

        <p className="set-note">
          <b>Nothing here is locked.</b> All ten levels of all thirteen drills are playable from
          your very first minute — the only person who knows which one is worth your time is you.
          What it does instead is <b>remember</b>: every level keeps its own record, so a bad run
          on level 7 can never take away your best on level 6.
        </p>
        <p className="set-note">
          <b>Stuck on which level to play?</b> Take an <b>∞ ENDLESS</b> run. It starts where the
          card is set, gets harder while you are winning and easier while you are drowning, and
          settles on the level you can just about hold. That number is the answer. It has no
          clock — end it whenever you like from the pause screen — and it never awards a star,
          because stars are for beating a level rather than standing on one.
        </p>
      </Explainer>

      <div className="pr-legend">
        <span className="pr-legend-item" style={{ ['--c' as string]: '#58e0ff' }}>
          <b>PLAY</b>
          <i>One minute at the level shown. The normal way to play — start here.</i>
        </span>
        <span className="pr-legend-item" style={{ ['--c' as string]: '#ff8a3d' }}>
          <b>▲ SURGE</b>
          <i>One minute, but a good streak makes it harder. How far can you push before you drop it?</i>
        </span>
        <span className="pr-legend-item" style={{ ['--c' as string]: '#c58bff' }}>
          <b>∞ ENDLESS</b>
          <i>No clock. It gets harder while you win and easier while you lose, until it finds your level.</i>
        </span>
      </div>

      {LAB_GROUPS.map((g) => {
        const modes = APM_MODES.filter((m) => m.kind === g.kind);
        if (modes.length === 0) return null;
        return (
          <div className="pr-group" key={g.kind}>
            <GroupHead label={g.label} note={g.note} count={`${modes.length} DRILLS`} />
            <div className="pr-lab-grid">
              {modes.map((m) => {
                const rec = profile.apm.modes[m.id];
                const want = picked[m.id] ?? recommendedLevel(profile.apm, m.id);
                const level = Math.max(1, Math.min(want, APM_LEVELS));
                return (
                  <LabBench
                    key={m.id}
                    mode={m}
                    settings={settings}
                    level={level}
                    // The check is the rung's rather than the mode's — all
                    // thirteen benches read one ladder — so it is computed
                    // where the rung is known and handed down finished.
                    binds={checkLabBinds(bound, level, scheme)}
                    bound={bound}
                    onFixControls={onFixControls}
                    cleared={rec.levels.map((lv) => levelStars(lv) > 0)}
                    lv={rec.levels[level - 1]}
                    // Defensive, like everything else this screen reads out of
                    // a stored profile: a menu that throws on a half-written
                    // record is a player who cannot reach the screen that
                    // would fix it.
                    infRuns={rec.infinite?.runs ?? 0}
                    infHeld={rec.infinite?.bestHeld ?? 0}
                    surgeRuns={rec.surge?.runs ?? 0}
                    surgeBest={rec.surge?.bestSurge ?? 0}
                    onStep={(by) => onStep(m, level, by)}
                    onPlay={onPlay}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function LabBench({
  mode,
  settings,
  level,
  binds,
  bound,
  onFixControls,
  cleared,
  lv,
  infRuns,
  infHeld,
  surgeRuns,
  surgeBest,
  onStep,
  onPlay,
}: {
  mode: ApmMode;
  settings: AppSettings;
  level: number;
  /** Whether this rung can be answered on the layout the player actually has. */
  binds: BindReport;
  bound: Bindings;
  onFixControls: () => void;
  /** Which of the ten rungs have a star on them, for the ladder strip. */
  cleared: boolean[];
  lv: ApmLevelRecord;
  infRuns: number;
  infHeld: number;
  surgeRuns: number;
  surgeBest: number;
  onStep: (by: number) => void;
  onPlay: PlayFn;
}) {
  const meta = DRILLS[mode.id];
  const stars = levelStars(lv);
  // The clip watches the whole card rather than only its picture — resting
  // anywhere on a bench is looking at that bench — and it watches the element
  // itself, so a cursor crossing the grid never re-renders a card.
  const card = useRef<HTMLElement>(null);
  // The infinite run opens on whatever rung the card is showing and then stops
  // caring about it. It is on the right mouse button because it is the same
  // activity as PLAY with one thing removed — the choice of level — and a
  // second full-size button would suggest it is a second mode rather than the
  // same bench with the floor let loose. The chip under it is the same gesture
  // for anyone whose pointer, browser or hands do not have a right click.
  // A rung this layout cannot answer does not start. Not because the section
  // gates anything — it gates nothing, and this is the only thing in it that
  // ever stops a button — but because the alternative is a minute of being
  // marked down for presses the player has no key to make.
  const blocked = !binds.ok;
  // The first rung this layout stops answering. Faults only ever accumulate as
  // the ladder climbs, so the lowest arrival among the ones found here is the
  // rung the card would have to drop below — which is the fix that costs
  // nothing and is worth offering before the one that costs a trip to a menu.
  const firstBroken = binds.ok ? APM_LEVELS + 1 : Math.min(...binds.faults.map((f) => f.from));
  const refuse = () => {
    audio.play('castRefuse');
    onFixControls();
  };
  const goInfinite = () => {
    if (blocked) return refuse();
    audio.play('uiClick');
    onPlay(mode.id, 'infinite', { difficulty: levelDifficulty(level), level });
  };
  // The same bench and the same rung, with the one thing PLAY refuses to do:
  // let the run's own chain move the floor under it.
  const goSurge = () => {
    if (blocked) return refuse();
    audio.play('uiClick');
    onPlay(mode.id, 'surge', { difficulty: levelDifficulty(level), level });
  };

  return (
    <article
      ref={card}
      className={`pr-lab-mode${blocked ? ' unplayable' : ''}`}
      style={{ ['--c' as string]: meta.accent }}
      onContextMenu={(e) => {
        e.preventDefault();
        goInfinite();
      }}
    >
      {/* WHAT THIS BENCH LOOKS LIKE.

          The thirteen names in this section are thirteen abstractions —
          CANCEL, UPKEEP, SWITCH — and no amount of copy turns "spend each dial
          as soon as it fills up" into a picture. So every card carries the
          same thing the champion modes carry: a still of its own bench, and
          the loop it was cut from, which plays when you rest on the card.

          The clip is also where the section's one rule about the mouse is
          taught rather than written down: the pointer in every one of these
          is on the pad that is lit, because in a run it has to be. */}
      <div className="pr-lab-media">
        <ModePreview id={mode.id} accent={meta.accent} host={card} still={settings.lowFx} />
        <div className="pr-lab-title">
          <b className="pr-lab-name">{meta.name}</b>
          <span className="pr-lab-kind mono">
            {mode.kind === 'isolated' ? 'ONE JOB' : 'TWO JOBS'}
          </span>
        </div>
      </div>
      <div className="pr-lab-tag">{meta.tagline}</div>
      <p className="pr-lab-brief">{meta.brief}</p>

      {/* Two lines, and they are the only thing that tells thirteen drills
          apart at a glance: what you do, and why it is hard. */}
      <dl className="pr-lab-facts">
        <div>
          <dt>You do</dt>
          <dd>{mode.counts}</dd>
        </div>
        <div>
          <dt>Hard bit</dt>
          <dd>{mode.pressure}</dd>
        </div>
      </dl>

      <div className="pr-lab-level">
        <button
          className="pr-lab-step"
          disabled={level <= 1}
          onMouseEnter={() => audio.play('uiHover')}
          onClick={() => onStep(-1)}
          aria-label={`${meta.name}: one level easier`}
        >
          ◀
        </button>
        <span className="mono">
          LEVEL {level} / {APM_LEVELS}
        </span>
        <button
          className="pr-lab-step"
          disabled={level >= APM_LEVELS}
          onMouseEnter={() => audio.play('uiHover')}
          onClick={() => onStep(1)}
          aria-label={`${meta.name}: one level harder`}
        >
          ▶
        </button>
        <i className="pr-lab-stars">
          {[1, 2, 3].map((n) => (
            <b key={n} className={n <= stars ? 'on' : ''}>
              ★
            </b>
          ))}
        </i>
      </div>

      {/* The ladder, as ten marks. Which rungs you have put a star on, which
          one the card is showing, and how far the ten actually go. It stopped
          being a map of what is *open* when everything became open; a record
          of what you have taken is the thing worth drawing instead. */}
      <div className="pr-lab-rungs" aria-hidden>
        {Array.from({ length: APM_LEVELS }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={`pr-rung${cleared[n - 1] ? ' open' : ''}${n === level ? ' here' : ''}${
              n >= MAP_MIN_LEVEL ? ' mapped' : ''
            }`}
          />
        ))}
      </div>

      {/* The card's own version of the warning at the top of the screen, at the
          rung it is showing. It sits directly above the button it is stopping,
          because that is where somebody who skipped the banner is looking. */}
      {blocked && (
        <div className="pr-lab-blocked">
          <b className="mono">LEVEL {level} NEEDS A KEY YOU DO NOT HAVE</b>
          <span>
            {binds.faults
              .map((f) =>
                f.kind === 'unbound'
                  ? `${f.label} is unbound`
                  : `${f.label} shares ${faultKey(bound, f)} with ${f.clashes.join(', ')}`,
              )
              .join(' · ')}
          </span>
          <button
            type="button"
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiClick');
              onFixControls();
            }}
          >
            FIX CONTROLS
          </button>
          <i>
            {firstBroken > 1
              ? `Or use the arrows above — levels 1–${firstBroken - 1} still play.`
              : 'This one is needed from level 1, so the arrows cannot get around it.'}
          </i>
        </div>
      )}

      <button
        className="pr-go pr-go-play"
        disabled={blocked}
        onMouseEnter={() => audio.play('uiHover')}
        onClick={() => {
          if (blocked) return refuse();
          audio.play('uiClick');
          onPlay(mode.id, 'play', { difficulty: levelDifficulty(level), level });
        }}
      >
        <span className="pr-go-label">PLAY</span>
        <span className="pr-go-sub">
          1 min · {keysAtLevel(level).length + ordersAtLevel(level).length} keys ·{' '}
          {level >= MAP_MIN_LEVEL ? 'with the corner map' : 'no corner map'}
        </span>
        <span className="pr-go-best mono">
          {lv.best > 0 ? `best ${Math.round(lv.best * 100)}%` : 'not played yet'}
        </span>
      </button>
      <div className="pr-lab-alts">
        <button
          className="pr-lab-surge"
          disabled={blocked}
          onMouseEnter={() => audio.play('uiHover')}
          onClick={goSurge}
          title={`${meta.name}: a SURGE run at level ${level}. One minute, and a good streak makes it harder.`}
        >
          <span className="pr-inf-mark" aria-hidden>
            ▲
          </span>
          <span className="pr-inf-label">
            SURGE
            <i>1 min</i>
          </span>
          <span className="pr-inf-best mono">
            {surgeRuns > 0 ? `+${surgeBest.toFixed(1)} levels` : 'streaks raise it'}
          </span>
        </button>
      </div>
      <button
        className="pr-lab-inf"
        disabled={blocked}
        onMouseEnter={() => audio.play('uiHover')}
        onClick={goInfinite}
        title={`${meta.name}: an endless run, starting at level ${level}. Right-click the card for the same thing.`}
      >
        <span className="pr-inf-mark" aria-hidden>
          ∞
        </span>
        <span className="pr-inf-label">
          ENDLESS
          <i>no clock</i>
        </span>
        <span className="pr-inf-best mono">
          {infRuns > 0 ? `held level ${infHeld.toFixed(1)}` : 'finds your level'}
        </span>
      </button>
    </article>
  );
}
