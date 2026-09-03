import { useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { codeLabel, defaultsFor, type ActionId } from '../engine/input';
import { type Profile } from '../progression/profile';
import {
  WASD_MODULES,
  WASD_TITLES,
  diagnoseWasd,
  moduleStars,
  moduleUnlocked,
  nextWasdTitle,
  wasdTitleFor,
} from '../progression/wasd';
import { CoursePath, type CourseNode } from './components/CoursePath';
import './academy.css';

interface Props {
  profile: Profile;
  onPlay: (id: DrillId) => void;
  onBack: () => void;
  /** Switches the profile over to the keys, from the invitation at the top. */
  onAdoptKeys: () => void;
}

/**
 * THE WASD ACADEMY.
 *
 * Nine modules in the order the skills stack, each one gated behind the last,
 * because the dependencies are real: stopping precisely comes before attacking
 * while moving, and knowing which stretch of an attack is free comes before
 * kiting anything at all.
 *
 * Every module is played on the keys whatever the profile is set to — so the
 * course is available to somebody who has not switched over yet, and the panel
 * at the top offers the switch rather than assuming it.
 */
export function Academy({ profile, onPlay, onBack, onAdoptKeys }: Props) {
  const w = profile.wasd;
  const title = wasdTitleFor(w.peak);
  const next = nextWasdTitle(w.peak);
  const cleared = WASD_MODULES.filter((m) => w.modules[m.id].best >= m.gate).length;
  const onKeys = profile.settings.movementScheme === 'wasd';

  const nodes = useMemo(() => buildCourse(profile), [profile]);
  const current = Math.max(0, nodes.findIndex((n) => n.state === 'current'));
  const [picked, setPicked] = useState<number | null>(null);
  const [reference, setReference] = useState(false);

  return (
    <div className="scroll">
      <div className="wrap wide acad fade-up">
        <div className="page-head">
          <div>
            <button className="link" onClick={onBack}>
              ← Train
            </button>
            <h1 className="display">WASD ACADEMY</h1>
            <p>
              Direct control is not clicking with extra steps. Its whole advantage is one thing:{' '}
              <b>where you are going stops deciding where you are looking</b>. Nine modules, each one
              opening the next.
            </p>
          </div>
          <div className="acad-mastery">
            <span className="eyebrow">Mastery</span>
            <b className="display">{Math.round(w.mastery)}</b>
            <i>{title.name}</i>
            {next && (
              <span className="acad-mastery-next mono">
                {Math.max(0, Math.ceil(next.at - w.peak))} to {next.name}
              </span>
            )}
          </div>
        </div>

        {/* Every module forces the keys for its own run, so this is an offer
            about the rest of the client rather than a gate on the course. */}
        {!onKeys && (
          <section className="acad-scheme">
            <div className="as-mark mono">RMB</div>
            <div className="as-body">
              <b>Your profile is still on click-to-move.</b>
              <p>
                The academy runs on the keys regardless — a module about moving one way while aiming the
                other cannot be played with a mouse. Switching the rest of the client over is a separate
                decision, and it is reversible.
              </p>
            </div>
            <button
              className="btn"
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                audio.play('uiClick');
                onAdoptKeys();
              }}
            >
              Use the keys everywhere
            </button>
          </section>
        )}

        <CoursePath
          nodes={nodes}
          selected={picked ?? current}
          onSelect={setPicked}
          onRun={(i) => onPlay(nodes[i].module)}
          aside={<Read profile={profile} onPlay={onPlay} />}
        />

        {/* The laws and the titles were both permanently on screen and neither
            is read twice. They are reference, so they read as reference. */}
        <section className="acad-ref">
          <span className="mono faint">
            {cleared} / {WASD_MODULES.length} modules cleared
          </span>
          <button className="link" onClick={() => setReference((r) => !r)}>
            {reference ? 'Hide reference' : 'Four things nobody tells you, and the titles'}
          </button>
          {reference && (
            <div className="acad-ref-body fade-up">
              <Laws profile={profile} />
              <div>
                <div className="sec-head">Titles</div>
                <div className="acad-titles">
                  {WASD_TITLES.map((t) => (
                    <div className={`acad-title${w.peak >= t.at ? ' held' : ''}`} key={t.name}>
                      <span className="mono">{t.at}</span>
                      <b>{t.name}</b>
                      <p>{t.blurb}</p>
                    </div>
                  ))}
                </div>
                <p className="acad-note">
                  A claim about <b>these nine modules</b> at the difficulty you cleared them at — about your
                  hands, not about anybody's ranked ladder.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the course */

type CourseModuleNode = CourseNode & { module: DrillId };

/**
 * The nine modules as course nodes.
 *
 * Every figure here already existed on the nine cards this replaces; what
 * changes is that only the one you are looking at is printed, so the rail can
 * be the shape of the course rather than nine copies of a stat block.
 */
const buildCourse = (p: Profile): CourseModuleNode[] => {
  const w = p.wasd;
  const nodes: CourseModuleNode[] = WASD_MODULES.map((m) => {
    const rec = w.modules[m.id];
    const unlocked = moduleUnlocked(w, m);
    const cleared = rec.best >= m.gate;
    const prev = WASD_MODULES[m.step - 2];
    return {
      key: m.id,
      module: m.id,
      kind: `0${m.step}`,
      name: m.title.toUpperCase(),
      // The one sentence that says why this module could not exist under a
      // mouse is the reason the section is a course rather than a filter, so
      // it is on the detail panel rather than buried on a card.
      purpose: `${m.purpose} ${m.onlyHere}`,
      accent: DRILLS[m.id].accent,
      state: cleared ? 'done' : !unlocked ? 'locked' : 'open',
      stars: moduleStars(m, rec),
      runs: rec.runs,
      progress: { value: rec.best, gate: m.gate },
      lockNote: prev ? `Clear ${prev.title} first.` : '',
      transfers: DRILLS[m.id].transfers,
    };
  });

  // Exactly one node is "you are here": the first that is not finished.
  const first = nodes.findIndex((n) => n.state === 'open');
  return nodes.map((n, i) => (i === first ? { ...n, state: 'current' } : n));
};

/**
 * THE READ.
 *
 * Nine modules produce sixty numbers. This picks the single habit furthest
 * from where it needs to be, says it in a sentence, and puts the module that
 * fixes it one click away — read from your *last* run on each module, because
 * "what should I go and work on" is a question about now.
 */
function Read({ profile, onPlay }: { profile: Profile; onPlay: (id: DrillId) => void }) {
  const d = diagnoseWasd(profile.wasd);
  if (!d) {
    const anyRuns = WASD_MODULES.some((m) => profile.wasd.modules[m.id].runs > 0);
    return (
      <aside className="acad-read empty">
        <span className="eyebrow">The read</span>
        <p className="ar-none">
          {anyRuns
            ? 'Nothing is standing out. Every habit the academy measures is at or near where it needs to be — raise the difficulty until one of them breaks.'
            : 'Run a module and this becomes the one thing worth fixing, named out loud, with the module that fixes it attached.'}
        </p>
      </aside>
    );
  }

  const meta = DRILLS[d.habit.module];
  const lower = d.habit.lowerIsBetter === true;
  const fmt = (v: number) => (lower ? `${Math.round(v)}` : `${Math.round(v * 100)}`);

  return (
    <aside className="acad-read" style={{ ['--c' as string]: meta.accent }}>
      <span className="eyebrow">The read</span>
      <div className="ar-num">
        <b className="display">{fmt(d.value)}</b>
        <i className="mono">
          {lower ? `target ${Math.round(d.habit.good)}` : `needs ${Math.round(d.habit.good * 100)}`}
        </i>
      </div>
      <span className="ar-label">{d.habit.label}</span>
      <p>{d.habit.fix}</p>
      <button
        className="btn sm"
        onMouseEnter={() => audio.play('uiHover')}
        onClick={() => {
          audio.play('uiClick');
          onPlay(d.habit.module);
        }}
      >
        Train {meta.name.replace('WASD ', '').replace(/^\d+ · /, '')}
      </button>
    </aside>
  );
}

/**
 * THE LAWS.
 *
 * Four things about direct control that are true, non-obvious, and invisible
 * unless somebody says them. Every one of them is measured somewhere in the
 * course, so the panel is a legend for the numbers rather than a wall of tips.
 *
 * The keys are read from the live WASD bindings, so a rebound layout says what
 * it actually is instead of what the defaults were.
 */
function Laws({ profile }: { profile: Profile }) {
  const defaults = defaultsFor('wasd');
  const overrides = profile.settings.wasdBindings ?? {};
  const key = (a: ActionId): string => codeLabel((overrides[a] ?? defaults[a]).primary).toUpperCase();
  const aim = profile.settings.tumbleAim ?? 'hands';

  return (
    <div className="acad-laws">
      <div className="sec-head">Four things nobody tells you</div>
      <div className="alaw-grid">
        <div>
          <span className="eyebrow">01</span>
          <b>Release is the trigger.</b>
          <p>
            Your champion will not attack while you are asking it to walk. The step and the shot are one beat:
            let go, shoot, hold again. The <i>TRIGGER</i> figure on the HUD is the milliseconds you spend on
            the wrong side of that beat.
          </p>
        </div>
        <div>
          <span className="eyebrow">02</span>
          <b>A held key cancels a windup.</b>
          <p>
            Exactly as an early click does. The whole of orbwalking is that the same input is free in the
            backswing and ruinous a fifth of a second earlier — which is what the cadence bar over your
            champion is drawing.
          </p>
        </div>
        <div>
          <span className="eyebrow">03</span>
          <b>The release is the destination.</b>
          <p>
            A click carries a stopping point inside it; a held key does not. You coast about a body-length
            past the moment your hand lifts, so precise movement means letting go early on purpose.
          </p>
        </div>
        <div>
          <span className="eyebrow">04</span>
          <b>{aim === 'hands' ? 'Your keys aim your dash.' : 'Your cursor aims your dash.'}</b>
          <p>
            {aim === 'hands'
              ? 'Whatever direction you are holding is where a dash sends you, and the cursor only takes over when your hand is off the keys.'
              : 'League’s literal behaviour: a dash goes to the cursor even while your keys point the other way. Settings → Dash aim changes it.'}
          </p>
        </div>
      </div>
      <div className="alaw-keys">
        {[
          { k: 'W A S D', name: 'MOVE', sub: 'held, not clicked' },
          { k: 'LMB', name: 'ATTACK', sub: 'never walks you' },
          { k: `${key('q')} ${key('w')} ${key('e')} ${key('r')}`, name: 'ABILITIES', sub: 'one seat over' },
          { k: key('stop'), name: 'STOP', sub: 'holds the ground' },
          { k: 'SPACE', name: 'CENTRE', sub: 'camera' },
        ].map((a) => (
          <div className="alaw-key" key={a.name}>
            <kbd className="kbd">{a.k}</kbd>
            <b>{a.name}</b>
            <span>{a.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
