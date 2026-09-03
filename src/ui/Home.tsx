import { useCallback, useEffect, useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { tuningFor } from '../engine/ai';
import { DRILL_LIST, DRILLS, type DrillGroup, type DrillId } from '../drills/catalog';
import {
  bestAxis,
  dailyComplete,
  drillDifficulty,
  formatMetric,
  recentImprovement,
  trainingPriority,
  type Profile,
} from '../progression/profile';
import {
  APM_LEVELS,
  clearedThrough,
  isApmDrill,
  levelStars,
  recommendedLevel,
} from '../progression/apm';
import { rankFromRating } from '../progression/ranks';
import { AXIS_LABEL, SKILL_AXES } from '../progression/skills';
import { VAYNE_STAGES, isVayneStage, stageUnlocked } from '../progression/vayne';
import { RankEmblem } from './components/RankEmblem';
import { Sparkline } from './components/charts';
import './home.css';

/**
 * The client.
 *
 * Deliberately not a page. There is no scrolling column of cards, because a
 * scrolling column of cards is what a dashboard looks like and this is meant
 * to look like the thing you open before a game: a list down the left, the
 * chosen thing standing in the middle of a live world, your record down the
 * right, and one enormous button along the bottom.
 *
 * The centre column is mostly empty on purpose. The arena is rendering behind
 * it in real time and that emptiness is the whole point — the interface is a
 * frame around a place, not a surface covering one.
 */

interface Props {
  profile: Profile;
  onPlay: (id: DrillId) => void;
  onDaily: () => void;
  onProfile: () => void;
  onPlacement: () => void;
  onVayne: () => void;
  /** Opens the APM section, on a named mode if one was clicked. */
  onApm: (id?: DrillId) => void;
}

/** The path stage behind a Vayne drill id. */
const stageOf = (id: DrillId) => VAYNE_STAGES[VAYNE_STAGES.findIndex((s) => s.id === id)];

const GROUPS: { id: DrillGroup; title: string; blurb: string }[] = [
  { id: 'FOUNDATION', title: 'Foundation', blurb: 'The inputs everything else is built on' },
  { id: 'RHYTHM', title: 'Rhythm', blurb: 'Timing between your hands and the clock' },
  { id: 'COMBAT', title: 'Combat', blurb: 'All of it, against something that fights back' },
  { id: 'APM', title: 'The Lab', blurb: 'Pressing, isolated from the game — thirteen benches, ten levels each' },
  { id: 'VAYNE', title: 'Vayne', blurb: 'One champion, learned in order' },
];

/**
 * The drills whose difficulty is an opponent rather than a clock.
 *
 * Only these can honestly print a behaviour read-out, because only these run
 * a tuned brain. A movement drill's difficulty changes its node timing, and
 * claiming it changed an enemy's reaction would be a lie with a nice layout.
 */
const TUNED_DRILLS = new Set<DrillId>([
  'kite',
  'spacing',
  'combos',
  'duel1v1',
  'duel1v2',
  'duel1v3',
  'vayneTumble',
  'vayneBolts',
  'vayneCondemn',
  'vayneHunt',
]);

const metricFormat = (key: string): 'ms' | 'units' | 'pct' | 'int' =>
  key.includes('APM') || key.includes('SECURED') || key.includes('TAKEN') || key.includes('CS')
    ? 'int'
    : key.includes('REACTION') || key.includes('SPEED') || key.includes('PER KEY')
      ? 'ms'
      : key.includes('ERROR')
        ? 'units'
        : 'pct';

export function Home({ profile, onPlay, onDaily, onProfile, onPlacement, onVayne, onApm }: Props) {
  const rank = rankFromRating(profile.overall);
  const best = bestAxis(profile);
  const priority = trainingPriority(profile);
  const improvement = recentImprovement(profile);
  // Today's session, as planned this morning — not a fixed list. The bar is a
  // shortcut to the Today screen, so it has to agree with it exactly.
  const plan = profile.daily.plan;
  const sessionDone = dailyComplete(profile);
  const dailyLeft = plan.filter((d) => !profile.daily.completed.includes(d)).length;

  // Nothing is selected until you are placed: an unplaced player is shown
  // calibration, and picking a drill is what overrides that.
  const [selected, setSelected] = useState<DrillId | null>(profile.placed ? 'movement' : null);
  const drill = selected ? DRILLS[selected] : null;

  const overallSeries = useMemo(() => profile.history.slice(-40).map((h) => h.overall), [profile.history]);

  const play = useCallback(() => {
    audio.play('uiClick');
    if (selected) onPlay(selected);
    else onPlacement();
  }, [selected, onPlay, onPlacement]);

  // Enter plays whatever is selected. A client you can drive from the
  // keyboard is a client; one you can only click is a web page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      play();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play]);

  const pick = (id: DrillId) => {
    if (id === selected) return;
    audio.play('uiClick');
    setSelected(id);
  };

  return (
    <div className="client">
      {/* ------------------------------------------------------ left rail */}
      <aside className="rail rail-l">
        <div className="rail-head">
          <span className="eyebrow">Drills</span>
          <span className="rail-count mono">{DRILL_LIST.length}</span>
        </div>

        <div className="rail-scroll">
          {GROUPS.map((g) => (
            <div className="rgroup" key={g.id}>
              <div className="rgroup-head">
                <span>{g.title}</span>
                <i />
                {g.id === 'APM' && (
                  <button
                    className="rgroup-link"
                    onMouseEnter={() => audio.play('uiHover')}
                    onClick={() => onApm()}
                  >
                    LADDER
                  </button>
                )}
              </div>
              {DRILL_LIST.filter((d) => d.group === g.id).map((d) => {
                const rec = profile.bests[d.id];
                const on = selected === d.id;
                // A stage of the champion path is locked here exactly as it is
                // locked there. One list saying "locked" while another happily
                // launches it would make the course meaningless.
                const locked = isVayneStage(d.id) && !stageUnlocked(profile.vayne, stageOf(d.id));
                return (
                  <button
                    key={d.id}
                    className={`rowitem${on ? ' on' : ''}${locked ? ' locked' : ''}`}
                    style={{ ['--c' as string]: d.accent }}
                    onMouseEnter={() => audio.play('uiHover')}
                    onClick={() => (locked ? onVayne() : pick(d.id))}
                    title={locked ? 'Locked — clear the previous stage on the Vayne path' : undefined}
                  >
                    <span className="ri-bar" />
                    <span className="ri-name">{d.name}</span>
                    {/* An APM row is a rung, not a score: the number that
                        matters there is which level you are on. */}
                    <span className="ri-best mono">
                      {locked
                        ? '🔒'
                        : isApmDrill(d.id)
                          ? `LV ${recommendedLevel(profile.apm, d.id)}`
                          : rec
                            ? rec.score.toLocaleString()
                            : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* --------------------------------------------------------- centre */}
      <main className="stage">
        {drill ? (
          <DrillHero key={drill.id} profile={profile} id={drill.id} onApm={onApm} />
        ) : (
          <div className="calib">
            <div className="eyebrow">Trainer mechanical rank</div>
            <h1 className="calib-title foil">UNRANKED</h1>
            <div className="ornament">
              <i />
            </div>
            <p className="calib-body">
              Five short drills read your movement precision, reaction consistency, attack timing and combat
              profile — then place you on the ladder. It takes about eight minutes and you only do it once.
            </p>
            <div className="calib-seq">
              {['MOVEMENT', 'AIM', 'DODGE', 'KITE', '1 v 1'].map((n, i) => (
                <span key={n}>
                  <b className="mono">{i + 1}</b>
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ----------------------------------------------------- right rail */}
      <aside className="rail rail-r">
        <button className="rank-block" onClick={onProfile} onMouseEnter={() => audio.play('uiHover')}>
          <RankEmblem tier={rank.tier} size={82} />
          <div className="rb-text">
            <div className="rb-tier display">{profile.placed ? rank.label : 'UNRANKED'}</div>
            <div className="rb-rating mono">
              {profile.placed ? `${Math.round(profile.overall)} RATING` : 'CALIBRATION REQUIRED'}
            </div>
          </div>
          {profile.placed && (
            <div className="rb-meter">
              <span style={{ width: `${Math.round(rank.progress * 100)}%` }} />
            </div>
          )}
          <i className="brk tl" />
          <i className="brk tr" />
          <i className="brk bl" />
          <i className="brk br" />
        </button>

        <div className="rail-head">
          <span className="eyebrow">Skill profile</span>
        </div>
        <div className="axes">
          {SKILL_AXES.map((axis) => {
            const rated = profile.samples[axis] > 0;
            const r = profile.ratings[axis];
            const info = rankFromRating(r);
            return (
              <div className="axis" key={axis}>
                <span className="ax-name">{AXIS_LABEL[axis]}</span>
                <div className="ax-bar">
                  <span style={{ width: rated ? `${Math.min(100, (r / 3600) * 100)}%` : '0%' }} />
                </div>
                <span className={`ax-rank${rated ? '' : ' faint'}`}>{rated ? info.label : '—'}</span>
              </div>
            );
          })}
        </div>

        {profile.placed && (
          <div className="callouts">
            <div>
              <span className="eyebrow">Best</span>
              <b className="good">{best ? AXIS_LABEL[best] : '—'}</b>
            </div>
            <div>
              <span className="eyebrow">Priority</span>
              <b className="warn">{priority ? priority.label : '—'}</b>
            </div>
            <div>
              <span className="eyebrow">7-day</span>
              <b className={improvement >= 0 ? 'good' : 'bad'}>
                {improvement >= 0 ? '+' : ''}
                {improvement.toFixed(1)}%
              </b>
            </div>
          </div>
        )}

        {overallSeries.length > 4 && (
          <div className="trendline">
            <Sparkline values={overallSeries} width={252} height={40} />
            <span className="faint">Rating · last {overallSeries.length} runs</span>
          </div>
        )}

        <p className="disclaimer">
          This rank measures <b>these drills</b> — mechanical execution under controlled conditions. It is not a
          prediction of your League ranked tier.
        </p>
      </aside>

      {/* ------------------------------------------------------ bottom bar */}
      <footer className="playbar">
        <button className="bar-daily" onClick={onDaily} onMouseEnter={() => audio.play('uiHover')}>
          <div className="bar-daily-l">
            <span className="eyebrow">{profile.daily.focus || "Today's session"}</span>
            <b className="display">
              {!plan.length ? 'NOT PLANNED YET' : sessionDone ? 'COMPLETE' : `${dailyLeft} DRILLS LEFT`}
            </b>
          </div>
          <div className="bar-pips">
            {plan.map((d) => (
              <i key={d} className={profile.daily.completed.includes(d) ? 'on' : ''} title={DRILLS[d].name} />
            ))}
          </div>
          <div className="bar-streak mono">
            {profile.daily.streak}
            <span>day streak</span>
          </div>
        </button>

        <div className="playbar-gap" />

        <div className="launch">
          <div className="launch-meta">
            <span className="eyebrow">{drill ? 'Selected' : 'Next step'}</span>
            <b className="display" style={drill ? { color: drill.accent } : undefined}>
              {drill ? drill.name : 'CALIBRATION'}
            </b>
          </div>
          <button className="btn primary lg playbtn" onClick={play} onMouseEnter={() => audio.play('uiHover')}>
            {drill ? 'PLAY' : 'BEGIN CALIBRATION'}
            <span className="playbtn-key">ENTER</span>
          </button>
        </div>
      </footer>
    </div>
  );
}

/** The middle column: one drill, standing in the arena. */
function DrillHero({
  profile,
  id,
  onApm,
}: {
  profile: Profile;
  id: DrillId;
  onApm: (id?: DrillId) => void;
}) {
  const d = DRILLS[id];
  const rec = profile.bests[id];
  const diff = drillDifficulty(profile, id);
  const headMetric = rec ? Object.entries(rec.metrics)[0] : null;
  // Narrowed once, so the ladder block below can ask the progression module
  // about this mode without re-testing the id at every call.
  const apmId = isApmDrill(id) ? id : null;
  const apm = apmId ? profile.apm.modes[apmId] : null;

  return (
    <div className="hero" style={{ ['--c' as string]: d.accent }}>
      <div className="hero-wash" />
      <div className="hero-body">
        <div className="hero-eyebrow">
          <span className="eyebrow">{d.group}</span>
          <i />
          <span className="faint">{d.tagline}</span>
        </div>

        <h1 className="hero-name">{d.name}</h1>

        <p className="hero-brief">{d.brief}</p>

        <div className="hero-transfer">
          <span className="eyebrow">Transfers to</span>
          <p>{d.transfers}</p>
        </div>

        <div className="hero-stats">
          <div>
            <span className="eyebrow">Best score</span>
            <b className="mono">{rec ? rec.score.toLocaleString() : '—'}</b>
          </div>
          <div>
            <span className="eyebrow">{d.keyMetric}</span>
            <b className="mono">
              {headMetric ? formatMetric(headMetric[1], metricFormat(d.keyMetric)) : '—'}
            </b>
          </div>
          <div>
            <span className="eyebrow">Duration</span>
            <b className="mono">{d.duration > 0 ? `${d.duration}s` : 'OPEN'}</b>
          </div>
          <div className="hero-diff">
            <span className="eyebrow">Level</span>
            <div className="diffbars">
              {Array.from({ length: 10 }).map((_, i) => (
                <i key={i} className={i < Math.round(diff * 10) ? 'on' : ''} />
              ))}
            </div>
          </div>
          {apm && apmId && (
            <div className="hero-ladder">
              <span className="eyebrow">Ladder</span>
              <div className="hl-pips">
                {apm.levels.map((lv, i) => (
                  <i
                    key={i}
                    className={`s${levelStars(lv)}${i < apm.unlocked ? ' open' : ''}${
                      i + 1 === recommendedLevel(profile.apm, apmId) ? ' next' : ''
                    }`}
                    title={`Level ${i + 1}`}
                  />
                ))}
              </div>
              <button className="hl-link" onClick={() => onApm(id)} onMouseEnter={() => audio.play('uiHover')}>
                {clearedThrough(apm) > 0
                  ? `CLEARED THROUGH ${clearedThrough(apm)} / ${APM_LEVELS}`
                  : `PLAYS AT LEVEL ${recommendedLevel(profile.apm, apmId)}`}
                <em> · OPEN LADDER</em>
              </button>
            </div>
          )}
          {TUNED_DRILLS.has(id) && <LevelDetail difficulty={diff} />}
          {d.abilities.length > 0 && (
            <div className="hero-keys">
              <span className="eyebrow">Uses</span>
              <div>
                {d.abilities.map((a) => (
                  <kbd className="kbd" key={a}>
                    {a.toUpperCase()}
                  </kbd>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * WHAT THIS LEVEL MEANS.
 *
 * "Level 6" is meaningless on its own, and "Hard" is worse. Every value here
 * is read from the same tuning curve the simulation uses, and the right-hand
 * column is what the next level actually changes — so a player can see the
 * difficulty as a set of behaviours rather than a number that went up.
 */
function LevelDetail({ difficulty }: { difficulty: number }) {
  const level = Math.max(1, Math.min(10, Math.round(difficulty * 10)));
  const now = tuningFor(difficulty);
  const next = tuningFor(Math.min(1, (level + 1) / 10));
  const rows: { label: string; now: string; next: string | null }[] = [
    {
      label: 'Reaction',
      now: `${Math.round(now.reactionDelay * 1000)}ms`,
      next: level < 10 ? `${Math.round(next.reactionDelay * 1000)}ms` : null,
    },
    {
      label: 'Aim error',
      now: `${Math.round(now.aimError)}u`,
      next: level < 10 ? `${Math.round(next.aimError)}u` : null,
    },
    {
      label: 'Prediction',
      now: `${Math.round(now.prediction * 100)}%`,
      next: level < 10 ? `${Math.round(next.prediction * 100)}%` : null,
    },
    {
      label: 'Dodges',
      now: `${Math.round(now.dodgeSkill * 100)}%`,
      next: level < 10 ? `${Math.round(next.dodgeSkill * 100)}%` : null,
    },
    {
      label: 'Holds spacing',
      now: `${Math.round(now.spacingDiscipline * 100)}%`,
      next: level < 10 ? `${Math.round(next.spacingDiscipline * 100)}%` : null,
    },
  ];

  return (
    <div className="hero-level">
      <span className="eyebrow">At level {level} the opponent</span>
      <div className="hl-rows">
        {rows.map((r) => (
          <div className="hl-row" key={r.label}>
            <span>{r.label}</span>
            <b className="mono">{r.now}</b>
            {r.next && r.next !== r.now && <i className="mono">→ {r.next}</i>}
          </div>
        ))}
      </div>
      <p className="hl-note faint">
        {level < 10
          ? 'The right-hand column is what level ' + (level + 1) + ' changes. Difficulty moves on its own, one axis at a time, to hold you between 60 and 78%.'
          : 'Top of the curve. Nothing about this opponent gets harder from here.'}
      </p>
    </div>
  );
}
