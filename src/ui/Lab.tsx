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
import { MAP_MIN_LEVEL } from '../drills/apm';
import type { ApmDrillId } from '../drills/apm';
import type { Profile } from '../progression/profile';
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
 * THE LAB — a section of the client rather than a tab inside another one.
 *
 * PRACTICE is a champion: her lane, her kit, the numbers both are built from.
 * This is not a champion at all. It is a bench — no champion, nothing to kill,
 * and a floor of drifting pads that only ever asks how many correct commands a
 * minute your hands issue — and it spent a release as the third tab of the
 * champion screen, where it read as one more thing about Vayne. It is not one
 * more thing about Vayne. It is the layer underneath every champion anybody
 * will ever add, which is exactly why it is worth training on its own terms,
 * and it now sits beside PRACTICE in the top bar rather than inside it.
 *
 * It asks one question the champion modes never do, and it is the reason the
 * ladder exists: which rung. Ten levels a mode, each one a record of its own —
 * and all ten of them are open from the first run. The section *suggests* the
 * lowest rung you have not cleared, because that is nearly always the useful
 * answer; it does not enforce it, because the whole activity is choosing a
 * level and holding it until it is easy, and a player who wants to look at
 * level ten on day one should be allowed to look at level ten on day one.
 *
 * Two things are true of every rung of every bench.
 *
 * **The pace is fixed.** A level is a place. The bench runs at the speed the
 * rung says and holds it for the whole minute, so two runs at level six are
 * two runs at the same difficulty and the number that comes out of them means
 * something next to the other one. What your form moves is the reward — the
 * chain, the tier, the multiplier — not the floor.
 *
 * **The map arrives at four.** The board in the corner is a second task, and a
 * second task is worth adding only to a first one you can already do. Levels
 * one to three are the bench and nothing else.
 *
 * The thirteen are split by the shape of the demand rather than by theme,
 * because that is the split that tells you what to play next: an isolated
 * bench asks one thing of one pair of hands, and a combined bench runs two
 * demands at once and is worth playing only once the isolated version of each
 * has stopped being interesting.
 */
const LAB_GROUPS: { kind: ApmModeKind; label: string; note: string }[] = [
  {
    kind: 'isolated',
    label: 'ONE THING AT A TIME',
    note: 'a single demand, of a single pair of hands',
  },
  {
    kind: 'combined',
    label: 'TWO AT ONCE',
    note: 'two demands running together — worth it once the isolated ones are easy',
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
          <div className="eyebrow">Mechanics · the bench</div>
          <h1 className="display pr-h1 lab-h1">THE LAB</h1>
          <p className="dim pr-lead">
            No champion, nothing to kill, and nowhere to be. Thirteen benches over one engine,
            every one of them counting the same thing — commands that were <i>correct</i>, per
            minute — and every one refusing to count an input that meant nothing, so mashing
            produces the highest raw rate in the client and the lowest score. Chain your actions
            and the multiplier climbs through five tiers; break it and it is gone.
          </p>
          <div className="lab-tally mono">
            <span>
              <b>{APM_MODES.length}</b> BENCHES
            </span>
            <span>
              <b>{APM_LEVELS}</b> LEVELS EACH · ALL OPEN
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
      <p className="dim pr-lead pr-panel-lead">
        <b>Every level is open, and every level is a fixed speed.</b> Pick a rung and the bench
        runs at that rung for the whole minute — it does not accelerate because the run is going
        well, so two scores at the same level are two scores of the same thing. The rung the card
        opens on is a suggestion: the lowest one you have not cleared yet.
      </p>
      <p className="dim pr-lead pr-panel-lead">
        <b>The pads move</b>, further and faster the higher the level, so your eyes are working
        for the whole minute rather than the first ten seconds of it. And from{' '}
        <b>level {MAP_MIN_LEVEL}</b> up, <b>the minimap is a second task</b>: a bad orb falls
        slowly down one of two lanes, your summoner keys are which lane you stand in, and an orb
        that lands on you costs the whole flow tier your hands just spent a minute building —
        which is exactly what a gank you did not look up for costs. Below level {MAP_MIN_LEVEL}{' '}
        the corner is empty and the bench is the whole of the job.
      </p>

      <div className="pr-legend">
        <span className="pr-legend-item" style={{ ['--c' as string]: '#58e0ff' }}>
          <b>PLAY</b>
          <i>One minute at the rung on the card, at a speed that never changes under you.</i>
        </span>
        <span className="pr-legend-item" style={{ ['--c' as string]: '#c58bff' }}>
          <b>∞ INFINITE</b>
          <i>No clock and no rung — the floor rises while you win and falls while you drown. Right-click any bench.</i>
        </span>
      </div>

      {LAB_GROUPS.map((g) => {
        const modes = APM_MODES.filter((m) => m.kind === g.kind);
        if (modes.length === 0) return null;
        return (
          <div className="pr-group" key={g.kind}>
            <GroupHead label={g.label} note={g.note} count={`${modes.length} BENCHES`} />
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
                    onStep={(by) => onStep(m, level, by)}
                    onPlay={onPlay}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="set-note">
        A level is a place you go back to, beat, and leave behind. Nothing on this screen is
        locked: all ten rungs of all thirteen benches are playable from your first run, because
        the only person who knows which one is worth your next minute is you. What the ladder
        still does is <b>remember</b> — every rung keeps its own record, and your best on level 6
        cannot be taken away by a bad run on level 7.
      </p>
      <p className="set-note">
        <b>PLAY is not adaptive.</b> The number on the rung is the difficulty the bench will be
        played at, it scales the pads, the windows and the orbs together, and it stays where it
        is for the whole minute. The floor used to speed up as a run went well, which meant a
        good start was paid for with a harder finish and no two runs at a level were the same
        level. Your form moves the chain, the tier and the multiplier. It does not move the
        bench.
      </p>
      <p className="set-note">
        <b>Right-click any bench</b> — or take the <b>∞</b> under it — for the one run in this
        client that has no rung at all. <b>INFINITE</b> opens on the level the card is showing
        and then lets the floor go: it comes up while you are winning and down while you are
        drowning — about a rung every seven seconds at full tilt, and half again as fast coming
        back down — until it finds the level at which you are just holding on. There is no clock,
        so it ends when you say so on the pause screen. The rung it settles at is the score, and
        it is also the answer to the only question this section has ever asked you — which level
        should I be practising. It never awards a star, because a star is for beating a rung and
        this is for standing on one.
      </p>
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
        <span className="pr-lab-kind mono">{mode.kind === 'isolated' ? 'ONE THING' : 'TWO AT ONCE'}</span>
      </header>
      <div className="pr-lab-tag">{meta.tagline}</div>
      <p className="pr-lab-brief">{meta.brief}</p>

      {/* What the bench counts, and what makes it hard once you know. Two
          lines the lab has always had in its data and never printed, and they
          are the only thing that tells thirteen benches apart at a glance. */}
      <dl className="pr-lab-facts">
        <div>
          <dt>Counts</dt>
          <dd>{mode.counts}</dd>
        </div>
        <div>
          <dt>Pressure</dt>
          <dd>{mode.pressure}</dd>
        </div>
      </dl>

      <div className="pr-lab-level">
        <button
          className="pr-lab-step"
          disabled={level <= 1}
          onMouseEnter={() => audio.play('uiHover')}
          onClick={() => onStep(-1)}
          aria-label={`${meta.name}: a level down`}
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
          aria-label={`${meta.name}: a level up`}
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
          par {mode.par} APM · {level >= MAP_MIN_LEVEL ? 'with the map' : 'bench only'}
        </span>
        <span className="pr-go-best mono">
          {lv.best > 0 ? `best ${Math.round(lv.best * 100)}%` : 'no run on this rung'}
        </span>
      </button>
      <button
        className="pr-lab-inf"
        onMouseEnter={() => audio.play('uiHover')}
        onClick={goInfinite}
        title={`${meta.name}: an infinite run, opening on level ${level}. Right-click the card for the same thing.`}
      >
        <span className="pr-inf-mark" aria-hidden>
          ∞
        </span>
        <span className="pr-inf-label">
          INFINITE
          <i>right-click</i>
        </span>
        <span className="pr-inf-best mono">
          {infRuns > 0 ? `held ${infHeld.toFixed(1)}` : 'finds your level'}
        </span>
      </button>
    </article>
  );
}
