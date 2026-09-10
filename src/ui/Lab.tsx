import { useMemo, useState } from 'react';
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
import type { Profile } from '../progression/profile';
import { Explainer } from './components/Explainer';
import './practice.css';
import './lab.css';

interface Props {
  profile: Profile;
  onPlay: (
    id: DrillId,
    mode: RunMode,
    opts?: { difficulty?: number; duration?: number; level?: number },
  ) => void;
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

export function Lab({ profile, onPlay }: Props) {
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
            Squares light up. Hit the right key — misses and mashing score nothing.
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
          <LabPanel profile={profile} picked={picked} onStep={step} onPlay={onPlay} />
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
  picked,
  onStep,
  onPlay,
}: {
  profile: Profile;
  picked: Partial<Record<ApmDrillId, number>>;
  onStep: (m: ApmMode, level: number, by: number) => void;
  onPlay: PlayFn;
}) {
  return (
    <>
      <Explainer title="HOW THE LAB WORKS">
        <p className="dim pr-lead pr-panel-lead">
          Each run lasts one minute and counts the presses you got <i>right</i> — a wrong key or
          a wasted one scores nothing, so hammering the keyboard gives you the worst score here,
          not the best. Get several right in a row and they start counting for more.
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
                    level={level}
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
  level,
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
  level: number;
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
  // The infinite run opens on whatever rung the card is showing and then stops
  // caring about it. It is on the right mouse button because it is the same
  // activity as PLAY with one thing removed — the choice of level — and a
  // second full-size button would suggest it is a second mode rather than the
  // same bench with the floor let loose. The chip under it is the same gesture
  // for anyone whose pointer, browser or hands do not have a right click.
  const goInfinite = () => {
    audio.play('uiClick');
    onPlay(mode.id, 'infinite', { difficulty: levelDifficulty(level), level });
  };
  // The same bench and the same rung, with the one thing PLAY refuses to do:
  // let the run's own chain move the floor under it.
  const goSurge = () => {
    audio.play('uiClick');
    onPlay(mode.id, 'surge', { difficulty: levelDifficulty(level), level });
  };

  return (
    <article
      className="pr-lab-mode"
      style={{ ['--c' as string]: meta.accent }}
      onContextMenu={(e) => {
        e.preventDefault();
        goInfinite();
      }}
    >
      <header className="pr-lab-head">
        <b className="pr-lab-name">{meta.name}</b>
        <span className="pr-lab-kind mono">{mode.kind === 'isolated' ? 'ONE JOB' : 'TWO JOBS'}</span>
      </header>
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

      <button
        className="pr-go pr-go-play"
        onMouseEnter={() => audio.play('uiHover')}
        onClick={() => {
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
