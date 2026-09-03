import { useCallback, useEffect, useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import {
  APM_LEVELS,
  APM_MODES,
  APM_TITLES,
  CLEAR_AT,
  STAR_AT,
  apmTitleFor,
  clearedThrough,
  levelCleared,
  levelDifficulty,
  levelStars,
  modeMastery,
  modesOfKind,
  nextApmMode,
  nextApmTitle,
  recommendedLevel,
  starsOn,
  type ApmDrillId,
  type ApmMode,
} from '../progression/apm';
import type { Profile } from '../progression/profile';
import { AXIS_LABEL, type SkillAxis } from '../progression/skills';
import './apm.css';

interface Props {
  profile: Profile;
  /** A mode the player named on the way in, e.g. from the drill rail. */
  focus: DrillId | null;
  onPlay: (id: DrillId, level: number, endurance: boolean) => void;
  onBack: () => void;
  onPlacement: () => void;
}

/**
 * THE LAB — the APM trainer's own screen.
 *
 * The rest of the client hides difficulty on purpose: it holds you in the band
 * where a rating is measurable and never asks you to choose. That is the right
 * shape for a ladder and the wrong shape for hand speed, where the activity
 * *is* choosing a rung and staying on it until it stops being hard.
 *
 * So this screen is the opposite of the drill rail. Thirteen benches down the
 * left, split by whether they ask one thing of your hands or two. One mode
 * open on the right, with its ten levels laid out as a ladder you can see the
 * whole of: what you scored on each, how fast you were, how many stars you
 * left behind, and exactly which rung is next. Nothing here is inferred and
 * nothing moves under you between runs.
 */
export function Apm({ profile, focus, onPlay, onBack, onPlacement }: Props) {
  const p = profile.apm;
  const suggested = useMemo(() => nextApmMode(p), [p]);
  const [selected, setSelected] = useState<ApmDrillId>(() =>
    focus && isApmId(focus) ? focus : suggested.id,
  );
  const mode = APM_MODES.find((m) => m.id === selected) ?? APM_MODES[0];
  const rec = p.modes[mode.id];
  const [level, setLevel] = useState(() => recommendedLevel(p, mode.id));
  const [endurance, setEndurance] = useState(false);

  // Changing mode re-aims the ladder at that mode's own next rung rather than
  // carrying a number that means something different here.
  const pick = useCallback(
    (id: ApmDrillId) => {
      if (id === selected) return;
      audio.play('uiClick');
      setSelected(id);
      setLevel(recommendedLevel(p, id));
    },
    [selected, p],
  );

  const play = useCallback(() => {
    audio.play('uiClick');
    onPlay(mode.id, level, endurance);
  }, [mode.id, level, endurance, onPlay]);

  // Driveable from the keyboard, like the client it belongs to: the arrows
  // walk the ladder, Enter plays the rung you are standing on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter' && !e.repeat) {
        play();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setLevel((n) => clampLevel(n + (e.key === 'ArrowUp' ? 1 : -1), rec.unlocked));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, rec.unlocked]);

  const mastery = p.mastery;
  const title = apmTitleFor(p.peak);
  const next = nextApmTitle(p.peak);
  const totalStars = APM_MODES.reduce((n, m) => n + starsOn(p, m.id), 0);
  const totalCleared = APM_MODES.reduce((n, m) => n + clearedThrough(p.modes[m.id]), 0);
  const started = APM_MODES.filter((m) => p.modes[m.id].runs > 0).length;
  const bestApmMode = p.bestApmMode ? DRILLS[p.bestApmMode].name : null;

  return (
    <div className="scroll">
      <div className="wrap wide apm fade-up">
        <header className="apm-head">
          <div>
            <div className="eyebrow">The lab · APM trainer</div>
            <h1 className="display apm-h1">PRESSING, WITH THE GAME TAKEN AWAY</h1>
            <p className="dim apm-lead">
              No minions, no camps, nothing fighting back — a bench of pads, gates and clocks, because what
              is being measured here is your hands and everything else on the screen was noise in the
              measurement. Each mode isolates one property of a press: cadence, order, simultaneity,
              restraint, anticipation, the second half of a pair, the cost of moving your hand. Every one of
              them counts the same thing — <b>correct</b> commands per minute — and every one names the
              moment in a real game it is a slice of. A level is a difficulty, not a suggestion: the rung you
              pick is the rung it is played at, and nothing adapts behind your back.
            </p>
          </div>

          <aside className="apm-crest">
            <div className="ac-ring" style={{ ['--m' as string]: `${Math.round(mastery)}%` }}>
              <span className="ac-num mono">{Math.round(mastery)}</span>
              <span className="ac-lab">MASTERY</span>
            </div>
            <div className="ac-title display">{title.name}</div>
            <p className="ac-blurb">{title.blurb}</p>
            {next && (
              <div className="ac-next">
                <span className="eyebrow">Next</span>
                <b>{next.name}</b>
                <i className="mono">{Math.max(1, Math.ceil(next.at - p.peak))} mastery to go</i>
              </div>
            )}
          </aside>
        </header>

        <div className="apm-stats">
          <div>
            <span className="eyebrow">Best sustained</span>
            <b className="mono">{p.bestApm > 0 ? `${Math.round(p.bestApm)} APM` : '—'}</b>
            <i>{bestApmMode ? `in ${bestApmMode}` : 'correct actions a minute'}</i>
          </div>
          <div>
            <span className="eyebrow">Benches opened</span>
            <b className="mono">
              {started} / {APM_MODES.length}
            </b>
            <i>eight isolated, five combined</i>
          </div>
          <div>
            <span className="eyebrow">Levels cleared</span>
            <b className="mono">
              {totalCleared} / {APM_MODES.length * APM_LEVELS}
            </b>
            <i>at {Math.round(CLEAR_AT * 100)}% or better</i>
          </div>
          <div>
            <span className="eyebrow">Stars</span>
            <b className="mono">
              {totalStars} / {APM_MODES.length * APM_LEVELS * 3}
            </b>
            <i>
              {Math.round(STAR_AT[0] * 100)} · {Math.round(STAR_AT[1] * 100)} ·{' '}
              {Math.round(STAR_AT[2] * 100)}%
            </i>
          </div>
        </div>

        {!profile.placed && (
          <div className="apm-note">
            The ladder opens at level 1 until you calibrate. Five short drills read where your hands
            already are and open the rungs you have plainly earned.
            <button className="btn sm" onClick={onPlacement}>
              Calibrate
            </button>
          </div>
        )}
        {profile.placed && p.seeded && p.seededTo > 1 && (
          <div className="apm-note quiet">
            Your calibration opened levels 1–{p.seededTo} on every mode. Nothing was awarded — the records
            are still empty. You simply do not have to walk up to the interesting part one run at a time.
          </div>
        )}

        <div className="apm-layout">
          {/* ------------------------------------------------------ modes */}
          <nav className="apm-modes">
            {(['isolated', 'combined'] as const).map((kind) => (
              <div className="apm-group" key={kind}>
                <div className="apm-group-head">
                  <span>{kind === 'isolated' ? 'Isolated' : 'Combined'}</span>
                  <i />
                  <em>{kind === 'isolated' ? 'one demand' : 'two at once'}</em>
                </div>
                {modesOfKind(kind).map((m) => (
                  <ModeRow
                    key={m.id}
                    mode={m}
                    profile={profile}
                    on={m.id === selected}
                    suggested={m.id === suggested.id}
                    onPick={pick}
                  />
                ))}
              </div>
            ))}
          </nav>

          {/* ----------------------------------------------------- ladder */}
          <section className="apm-detail" style={{ ['--c' as string]: DRILLS[mode.id].accent }}>
            <div className="ad-head">
              <div>
                <div className="eyebrow">
                  {mode.kind === 'isolated' ? 'Isolated' : 'Combined'} · mode {mode.order} of {APM_MODES.length}
                </div>
                <h2 className="display ad-name">{DRILLS[mode.id].name}</h2>
                <div className="ad-tag">{DRILLS[mode.id].tagline}</div>
              </div>
              <div className="ad-mastery">
                <span className="eyebrow">Mode mastery</span>
                <b className="mono">{Math.round(modeMastery(rec))}</b>
                <i className="mono">
                  {starsOn(p, mode.id)} / {APM_LEVELS * 3} ★
                </i>
              </div>
            </div>

            <p className="ad-brief">{DRILLS[mode.id].brief}</p>

            <div className="ad-facts">
              <div>
                <span className="eyebrow">It counts</span>
                <p>{mode.counts}</p>
              </div>
              <div>
                <span className="eyebrow">What makes it hard</span>
                <p>{mode.pressure}</p>
              </div>
              <div>
                <span className="eyebrow">Par</span>
                <p className="mono">{mode.par} APM</p>
              </div>
              <div>
                <span className="eyebrow">Feeds</span>
                <p>
                  {(Object.keys(DRILLS[mode.id].axes) as SkillAxis[])
                    .map((a) => AXIS_LABEL[a])
                    .join(' · ')}
                </p>
              </div>
            </div>

            <div className="ad-ladder-head">
              <span className="eyebrow">The ladder</span>
              <span className="faint">
                {Math.round(CLEAR_AT * 100)}% clears a rung and opens the next · {Math.round(STAR_AT[2] * 100)}%
                opens two
              </span>
            </div>

            <div className="ad-ladder">
              {Array.from({ length: APM_LEVELS }, (_, i) => APM_LEVELS - i).map((n) => (
                <Rung
                  key={n}
                  n={n}
                  record={rec.levels[n - 1]}
                  unlocked={n <= rec.unlocked}
                  chosen={n === level}
                  recommended={n === recommendedLevel(p, mode.id)}
                  onPick={() => {
                    if (n > rec.unlocked) return;
                    audio.play('uiHover');
                    setLevel(n);
                  }}
                />
              ))}
            </div>

            <footer className="ad-launch">
              <label className={`ad-endurance${endurance ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={endurance}
                  onChange={(e) => {
                    audio.play('uiClick');
                    setEndurance(e.target.checked);
                  }}
                />
                <span>
                  <b>ENDURANCE</b>
                  <i>
                    Double length ({DRILLS[mode.id].duration * 2}s). Sets rate records, never a score record —
                    a longer run scores more by construction.
                  </i>
                </span>
              </label>

              <div className="ad-play">
                <div className="ad-play-meta">
                  <span className="eyebrow">Selected</span>
                  <b className="display">
                    LEVEL {level}
                    <em className="mono"> · DIFFICULTY {Math.round(levelDifficulty(level) * 100)}</em>
                  </b>
                </div>
                <button className="btn primary lg" onClick={play} onMouseEnter={() => audio.play('uiHover')}>
                  PLAY
                  <span className="kbd">ENTER</span>
                </button>
              </div>
            </footer>
          </section>
        </div>

        <section className="panel pad apm-titles">
          <div className="panel-title">Titles</div>
          <div className="at-rows">
            {APM_TITLES.map((t) => {
              const held = p.peak >= t.at;
              return (
                <div className={`at-row${held ? ' held' : ''}`} key={t.name}>
                  <span className="at-at mono">{t.at}</span>
                  <b className="at-name">{t.name}</b>
                  <span className="at-blurb">{t.blurb}</span>
                </div>
              );
            })}
          </div>
          <p className="apm-foot-note">
            Mastery weights the top of each ladder: three stars on level 10 is worth ten times three stars on
            level 1, because it is. These runs also feed the <b>APM</b> axis of the general rating — the
            ladder is how you train it, the rank is what it is worth. The lab is deliberately not the game:
            what transfers is the press, and every bench says which press it is.
          </p>
        </section>

        <div className="apm-foot">
          <span className="mono faint">
            {started} of {APM_MODES.length} modes opened · {totalStars} stars
          </span>
          <button className="btn ghost lg" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

/** One mode in the left list, with its ladder compressed into ten pips. */
function ModeRow({
  mode,
  profile,
  on,
  suggested,
  onPick,
}: {
  mode: ApmMode;
  profile: Profile;
  on: boolean;
  suggested: boolean;
  onPick: (id: ApmDrillId) => void;
}) {
  const meta = DRILLS[mode.id];
  const rec = profile.apm.modes[mode.id];
  const through = clearedThrough(rec);

  return (
    <button
      className={`amode${on ? ' on' : ''}`}
      style={{ ['--c' as string]: meta.accent }}
      onMouseEnter={() => audio.play('uiHover')}
      onClick={() => onPick(mode.id)}
    >
      <span className="am-bar" />
      <span className="am-name">{meta.name}</span>
      {/* One slot on the right, and the suggestion outranks the rung: a mode
          you have never opened has no rung worth printing anyway. */}
      <span className={`am-through mono${suggested && !on ? ' flag' : ''}`}>
        {suggested && !on ? 'NEXT' : through > 0 ? `LV ${through}` : '—'}
      </span>
      <span className="am-pips">
        {rec.levels.map((lv, i) => (
          <i
            key={i}
            className={`s${levelStars(lv)}${i < rec.unlocked ? ' open' : ''}`}
            title={`Level ${i + 1}`}
          />
        ))}
      </span>
    </button>
  );
}

/** One rung: a level, its record, and whether it is open. */
function Rung({
  n,
  record,
  unlocked,
  chosen,
  recommended,
  onPick,
}: {
  n: number;
  record: { runs: number; best: number; bestScore: number; bestApm: number };
  unlocked: boolean;
  chosen: boolean;
  recommended: boolean;
  onPick: () => void;
}) {
  const stars = levelStars(record);
  const cleared = levelCleared(record);
  return (
    <button
      className={`rung${chosen ? ' on' : ''}${unlocked ? '' : ' locked'}${cleared ? ' cleared' : ''}`}
      onClick={onPick}
      disabled={!unlocked}
    >
      <span className="rg-n mono">{String(n).padStart(2, '0')}</span>
      <span className="rg-diff mono">{Math.round(levelDifficulty(n) * 100)}</span>
      <span className="rg-stars">
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= stars ? 'on' : ''}>
            ★
          </i>
        ))}
      </span>
      {/* The bar fills to your best on this rung and carries a notch at the
          clear, so "how far off am I" is a distance instead of arithmetic. */}
      <span className="rg-track">
        <i className="rg-fill" style={{ width: `${Math.round(Math.min(1, record.best) * 100)}%` }} />
        <i className="rg-gate" style={{ left: `${Math.round(CLEAR_AT * 100)}%` }} />
      </span>
      <span className="rg-best mono">{record.runs ? `${Math.round(record.best * 100)}%` : '—'}</span>
      <span className="rg-apm mono">{record.bestApm > 0 ? `${Math.round(record.bestApm)} APM` : '—'}</span>
      <span className="rg-tail">
        {!unlocked ? (
          <em className="rg-lock">🔒 clear {n - 1}</em>
        ) : recommended ? (
          <em className="rg-rec">START HERE</em>
        ) : record.bestScore > 0 ? (
          <em className="mono rg-score">{record.bestScore.toLocaleString()}</em>
        ) : null}
      </span>
    </button>
  );
}

const clampLevel = (n: number, unlocked: number): number => Math.max(1, Math.min(n, unlocked));

const isApmId = (id: DrillId): id is ApmDrillId => APM_MODES.some((m) => m.id === id);
