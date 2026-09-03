import { useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { codeLabel, defaultsFor, type ActionId } from '../engine/input';
import { heroFor } from '../engine/heroes';
import { type Profile } from '../progression/profile';
import {
  VAYNE_STAGES,
  VAYNE_TITLES,
  diagnose,
  nextTitle,
  stageStars,
  stageUnlocked,
  titleFor,
} from '../progression/vayne';
import { CoursePath, type CourseNode } from './components/CoursePath';
import { HeroSigil } from './components/HeroSigil';
import './champions.css';

interface Props {
  profile: Profile;
  onPlay: (id: DrillId) => void;
  onRoster: () => void;
}

/**
 * CHAMPIONS.
 *
 * A path, drawn as a path.
 *
 * The screen used to be four stacked cards, each carrying its own four-figure
 * stat block, a progress track, a star row and a button — which is a table of
 * a course rather than a picture of one. A course's whole value is that it has
 * a shape: this came before that, you are here, that is next, and the thing at
 * the end is locked until the rest of it is not.
 *
 * So the stages are nodes on one line now, in order, with their state on the
 * node — cleared, current, open, locked — and everything that used to be
 * printed four times over is printed once, for whichever node you are looking
 * at. Six nodes rather than four: the foundation the champion is built on at
 * one end, and the title she is worth at the other, because a course that
 * starts at her Q and stops at her R is only the middle of the journey.
 */
export function Champions({ profile, onPlay, onRoster }: Props) {
  const v = profile.vayne;
  const hero = heroFor(profile.settings.hero);
  const title = titleFor(v.peak);
  const next = nextTitle(v.peak);
  const nodes = useMemo(() => buildPath(profile), [profile]);
  const currentIndex = Math.max(
    0,
    nodes.findIndex((n) => n.state === 'current'),
  );
  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked ?? currentIndex;
  const onKeys = profile.settings.movementScheme === 'wasd';
  const [reference, setReference] = useState(false);

  return (
    <div className="scroll">
      <div className="wrap champ fade-up">
        {/* ---------------------------------------------------------- who */}
        <div className="page-head">
          <div>
            <span className="eyebrow">Champion path</span>
            <h1 className="display">VAYNE</h1>
            <p>
              Six steps, in the order they have to be taken. Mastery only moves when your{' '}
              <b>best</b> run improves, so it is a record of what you can do rather than of how long you
              have been here.
            </p>
          </div>
          <div className="ch-mastery">
            <span className="eyebrow">Mastery</span>
            <b className="display">{Math.round(v.mastery)}</b>
            <i>{title.name}</i>
            {next && (
              <span className="ch-mastery-next mono">
                {Math.max(0, Math.ceil(next.at - v.peak))} to {next.name}
              </span>
            )}
          </div>
        </div>

        {/* --------------------------------------------------------- path */}
        <CoursePath
          nodes={nodes}
          selected={selected}
          onSelect={setPicked}
          onRun={(i) => onPlay(drillFor(nodes[i]))}
          aside={<Read profile={profile} onPlay={onPlay} />}
        />

        {/* -------------------------------------------------------- roster */}
        <section className="ch-roster">
          <button className="ch-roster-btn" style={{ ['--c' as string]: hero.accent }} onClick={onRoster}>
            <HeroSigil hero={hero.id} size={28} />
            <div>
              <b>{hero.name.toUpperCase()}</b>
              <span>The body you train in. Cosmetic — a rating earned behind one is worth the same as any other.</span>
            </div>
            <i>Change</i>
          </button>
        </section>

        {/* ----------------------------------------------------- reference
            Two long reference blocks that were on the screen at all times.
            Neither is something you read twice, so neither is on by default. */}
        <section className="ch-ref">
          <button className="link" onClick={() => setReference((r) => !r)}>
            {reference ? 'Hide reference' : 'Titles, and her kit on your keys'}
          </button>
          {reference && (
            <div className="ch-ref-body fade-up">
              <div>
                <div className="sec-head">Titles</div>
                <div className="ch-titles">
                  {VAYNE_TITLES.map((t) => (
                    <div className={`ch-title${v.peak >= t.at ? ' held' : ''}`} key={t.name}>
                      <span className="mono">{t.at}</span>
                      <b>{t.name}</b>
                      <p>{t.blurb}</p>
                    </div>
                  ))}
                </div>
              </div>
              {onKeys && <Hands profile={profile} />}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ read */

/**
 * THE READ.
 *
 * Four stages produce twenty numbers between them and a player looking at
 * twenty numbers learns nothing. This picks the single habit furthest from
 * where it needs to be, says it in a sentence, and puts the drill that fixes
 * it one click away. It reads your *last* run rather than your best, because
 * "what should I work on" is a question about how you are playing now.
 */
function Read({ profile, onPlay }: { profile: Profile; onPlay: (id: DrillId) => void }) {
  const onKeys = profile.settings.movementScheme === 'wasd';
  const d = diagnose(profile.vayne, onKeys);

  if (!d) {
    const anyRuns = VAYNE_STAGES.some((s) => profile.vayne.stages[s.id].runs > 0);
    return (
      <aside className="ch-read empty">
        <span className="eyebrow">The read</span>
        <p>
          {anyRuns
            ? 'Nothing stands out. Every habit measured is at or near where it needs to be — raise the difficulty and make one of them break.'
            : 'Run a step and this becomes the one thing worth fixing, named, with the drill that fixes it attached.'}
        </p>
      </aside>
    );
  }

  return (
    <aside className="ch-read">
      <span className="eyebrow">The read</span>
      <div className="ch-read-num">
        <b className="display">{Math.round(d.value * 100)}</b>
        <i className="mono">needs {Math.round(d.habit.good * 100)}</i>
      </div>
      <span className="ch-read-label">{d.habit.label}</span>
      <p>{d.fix}</p>
      <button
        className="btn sm"
        onMouseEnter={() => audio.play('uiHover')}
        onClick={() => {
          audio.play('uiClick');
          onPlay(d.habit.stage);
        }}
      >
        Train {DRILLS[d.habit.stage].name}
      </button>
    </aside>
  );
}

/* ------------------------------------------------------------------ path */

/** A course node, plus the drill it launches. */
type PathNode = CourseNode & { drill: DrillId };

const drillFor = (n: PathNode): DrillId => n.drill;

/**
 * The path, as six nodes.
 *
 * Four of them are the real stages and carry real records. The two on the ends
 * are derived: FOUNDATION is the general kiting drill her whole kit sits on
 * top of, counted as cleared once that axis has actually been measured, and
 * MASTERY is the title ladder, cleared at the last title. Neither invents a
 * record — they read the same profile everything else does.
 */
const FOUNDATION_GATE = 3;

const buildPath = (p: Profile): PathNode[] => {
  const v = p.vayne;
  const kiteSamples = p.samples.kiting;
  const foundationDone = kiteSamples >= FOUNDATION_GATE;

  const nodes: PathNode[] = [
    {
      key: 'foundation',
      kind: 'Foundation',
      name: 'KITE',
      purpose:
        'Attack, move, attack, with no champion attached. Everything below is this rhythm with one of her buttons added to it, so it is the thing to have first.',
      drill: 'kite',
      accent: DRILLS.kite.accent,
      state: foundationDone ? 'done' : 'current',
      stars: null,
      runs: kiteSamples,
      progress: { value: Math.min(1, kiteSamples / FOUNDATION_GATE), gate: 1 },
      lockNote: '',
      transfers: DRILLS.kite.transfers,
    },
  ];

  for (const stage of VAYNE_STAGES) {
    const rec = v.stages[stage.id];
    const unlocked = stageUnlocked(v, stage);
    const cleared = rec.best >= stage.gate;
    const prev = VAYNE_STAGES[stage.step - 2];
    nodes.push({
      key: stage.id,
      kind: stage.step === VAYNE_STAGES.length ? 'Combat' : 'Kit',
      name: DRILLS[stage.id].name,
      purpose: stage.purpose,
      drill: stage.id,
      accent: DRILLS[stage.id].accent,
      state: cleared ? 'done' : !unlocked ? 'locked' : 'open',
      stars: stageStars(stage, rec),
      runs: rec.runs,
      progress: { value: rec.best, gate: stage.gate },
      lockNote: prev ? `Clear ${DRILLS[prev.id].name} first.` : '',
      transfers: DRILLS[stage.id].transfers,
    });
  }

  const last = VAYNE_TITLES[VAYNE_TITLES.length - 1];
  const finalStage = VAYNE_STAGES[VAYNE_STAGES.length - 1];
  nodes.push({
    key: 'mastery',
    kind: 'Mastery',
    name: last.name,
    purpose: `${last.blurb} It is a claim about these drills at the difficulty you cleared them at — every step at three stars, with the pressure up — and not about anybody's ranked ladder.`,
    drill: finalStage.id,
    accent: '#e4cf95',
    state:
      v.peak >= last.at
        ? 'done'
        : nodes.every((n) => n.state === 'done')
          ? 'open'
          : 'locked',
    stars: null,
    runs: null,
    progress: { value: Math.min(1, v.peak / last.at), gate: 1 },
    lockNote: 'Clear every step above.',
    transfers: '',
  });

  // Exactly one node is "you are here": the first that is not finished. The
  // rest are open or locked, and a screen with two current nodes is a screen
  // that has not decided what it is telling you.
  const first = nodes.findIndex((n) => n.state === 'open' || n.state === 'current');
  return nodes.map((n, i) => (i === first ? { ...n, state: 'current' } : n.state === 'current' ? { ...n, state: 'done' } : n));
};

/* ----------------------------------------------------------------- hands */

/**
 * Only shown under WASD, because that scheme moves her whole kit one seat
 * over: Condemn is not on E, Final Hour is not on R, and a player who learned
 * her with a mouse will press the wrong key for a week unless somebody puts
 * the new row in front of them. Read from the live bindings, so a rebound
 * layout says what it actually is.
 */
function Hands({ profile }: { profile: Profile }) {
  const defaults = defaultsFor('wasd');
  const overrides = profile.settings.wasdBindings ?? {};
  const key = (a: ActionId): string => codeLabel((overrides[a] ?? defaults[a]).primary).toUpperCase();

  return (
    <div>
      <div className="sec-head">Her kit, on your keys</div>
      <div className="ch-keys">
        {[
          { k: key('q'), name: 'TUMBLE', sub: 'Q — the dash' },
          { k: '—', name: 'SILVER BOLTS', sub: 'W — passive, no key' },
          { k: key('e'), name: 'CONDEMN', sub: 'E — the wall' },
          { k: key('r'), name: 'FINAL HOUR', sub: 'R — the window' },
          { k: 'LMB', name: 'TARGET', sub: 'never walks you' },
          { k: key('stop'), name: 'STOP', sub: 'holds the ground' },
        ].map((a) => (
          <div className="ch-key" key={a.name}>
            <kbd className="kbd">{a.k}</kbd>
            <b>{a.name}</b>
            <span>{a.sub}</span>
          </div>
        ))}
      </div>
      <p className="ch-law">
        <b>Release is the trigger.</b> She cannot fire while you are asking her to walk, so the step and
        the shot are one beat: let go, shoot, hold again. A held key cancels a windup exactly as an early
        click does, which is the whole of orbwalking.
      </p>
    </div>
  );
}
