import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { codeLabel, defaultsFor, type ActionId } from '../engine/input';
import { drillDifficulty, type Profile } from '../progression/profile';
import {
  WASD_MODULES,
  WASD_TITLES,
  diagnoseWasd,
  moduleStars,
  moduleUnlocked,
  nextWasdModule,
  nextWasdTitle,
  wasdTitleFor,
  type WasdModule,
} from '../progression/wasd';
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
  const recommended = nextWasdModule(w);
  const cleared = WASD_MODULES.filter((m) => w.modules[m.id].best >= m.gate).length;
  const onKeys = profile.settings.movementScheme === 'wasd';

  return (
    <div className="scroll">
      <div className="wrap acad fade-up">
        <div className="acad-head">
          <div>
            <div className="eyebrow">Control scheme</div>
            <h1 className="display acad-h1">WASD ACADEMY</h1>
            <p className="dim acad-lead">
              Direct control is not clicking with extra steps. It is a different pair of hands, and the whole
              of its advantage is one thing: <b>where you are going stops deciding where you are looking</b>.
              Nine modules teach that from the four keys upward — movement, then independence, then strafing,
              then aiming on the move, then the attack cadence everything else is built on, then kiting three
              ways, then all of it at once. Each one opens the next.
            </p>
          </div>

          <aside className="acad-crest">
            <div className="ac-ring" style={{ ['--m' as string]: `${w.mastery}%` }}>
              <span className="ac-num mono">{Math.round(w.mastery)}</span>
              <span className="ac-lab">MASTERY</span>
            </div>
            <div className="ac-title display">{title.name}</div>
            <p className="ac-blurb">{title.blurb}</p>
            {next && (
              <div className="ac-next">
                <span className="eyebrow">Next</span>
                <b>{next.name}</b>
                <i className="mono">{Math.max(0, Math.ceil(next.at - w.peak))} to go</i>
              </div>
            )}
          </aside>
        </div>

        {/* The scheme notice. Every module forces the keys for its own run, so
            this is an offer about the rest of the client rather than a gate. */}
        <section className={`panel pad acad-scheme${onKeys ? ' on' : ''}`}>
          <div className="as-mark mono">{onKeys ? 'WASD' : 'RMB'}</div>
          <div className="as-body">
            <b>{onKeys ? 'Your profile is on the keys.' : 'Your profile is still on click-to-move.'}</b>
            <p>
              {onKeys
                ? 'Every drill in the client is driven with the keys, and the academy is where the specific skills that scheme unlocks are trained one at a time.'
                : 'The academy runs on the keys regardless — a module about moving one way while aiming the other cannot be played with a mouse. Switching the rest of the client over is a separate decision, and it is reversible.'}
            </p>
          </div>
          {!onKeys && (
            <button
              className="btn primary"
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                audio.play('uiClick');
                onAdoptKeys();
              }}
            >
              Use the keys everywhere
            </button>
          )}
        </section>

        <Laws profile={profile} />

        <div className="acad-modules">
          {WASD_MODULES.map((m) => (
            <ModuleCard
              key={m.id}
              module={m}
              profile={profile}
              recommended={recommended.id === m.id}
              onPlay={onPlay}
            />
          ))}
        </div>

        <Read profile={profile} onPlay={onPlay} />

        <section className="panel pad acad-ladder">
          <div className="panel-title">Titles</div>
          <div className="al-rows">
            {WASD_TITLES.map((t) => {
              const held = w.peak >= t.at;
              return (
                <div className={`al-row${held ? ' held' : ''}`} key={t.name}>
                  <span className="al-at mono">{t.at}</span>
                  <b className="al-name">{t.name}</b>
                  <span className="al-blurb">{t.blurb}</span>
                </div>
              );
            })}
          </div>
          <p className="set-note">
            These titles are a claim about <b>these nine modules</b> at the difficulty you cleared them at. They
            are a statement about your hands, not about anybody’s ranked ladder.
          </p>
        </section>

        <div className="acad-foot">
          <span className="mono faint">
            {cleared} / {WASD_MODULES.length} modules cleared
          </span>
          <button className="btn ghost lg" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

function ModuleCard({
  module,
  profile,
  recommended,
  onPlay,
}: {
  module: WasdModule;
  profile: Profile;
  recommended: boolean;
  onPlay: (id: DrillId) => void;
}) {
  const meta = DRILLS[module.id];
  const rec = profile.wasd.modules[module.id];
  const unlocked = moduleUnlocked(profile.wasd, module);
  const stars = moduleStars(module, rec);
  const diff = drillDifficulty(profile, module.id);
  const prev = WASD_MODULES[module.step - 2];

  return (
    <div
      className={`amod${unlocked ? '' : ' locked'}${recommended && unlocked ? ' rec' : ''}`}
      style={{ ['--c' as string]: meta.accent }}
    >
      <div className="am-step mono">{String(module.step).padStart(2, '0')}</div>

      <div className="am-body">
        <div className="am-titles">
          <b className="am-name display">{module.title.toUpperCase()}</b>
          {recommended && unlocked && <span className="am-flag">START HERE</span>}
          <span className="am-len mono">{meta.duration}s</span>
        </div>
        <p className="am-purpose">{module.purpose}</p>
        {/* The one sentence that says why this module could not exist under a
            mouse. It is the reason the section is a course and not a filter. */}
        <p className="am-only">
          <span className="eyebrow">Only on the keys</span>
          {module.onlyHere}
        </p>

        <div className="am-stats">
          <div>
            <span className="eyebrow">Best</span>
            <b className="mono">{rec.runs ? `${Math.round(rec.best * 100)}%` : '—'}</b>
          </div>
          <div>
            <span className="eyebrow">To clear</span>
            <b className="mono">{Math.round(module.gate * 100)}%</b>
          </div>
          <div>
            <span className="eyebrow">Runs</span>
            <b className="mono">{rec.runs}</b>
          </div>
          <div>
            <span className="eyebrow">Level</span>
            <div className="diffbars">
              {Array.from({ length: 10 }).map((_, i) => (
                <i key={i} className={i < Math.round(diff * 10) ? 'on' : ''} />
              ))}
            </div>
          </div>
        </div>

        <div className="am-track">
          <span className="am-fill" style={{ width: `${Math.round(Math.min(1, rec.best) * 100)}%` }} />
          <i className="am-gate" style={{ left: `${Math.round(module.gate * 100)}%` }} />
        </div>
      </div>

      <div className="am-right">
        <div className="am-stars">
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= stars ? 'on' : ''}>
              ★
            </span>
          ))}
        </div>
        {unlocked ? (
          <button
            className={`btn ${recommended ? 'primary' : ''}`}
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiClick');
              onPlay(module.id);
            }}
          >
            {rec.runs ? 'Run it' : 'Begin'}
          </button>
        ) : (
          <div className="am-lock">
            <span>LOCKED</span>
            <i>Clear {prev.title}</i>
          </div>
        )}
      </div>
    </div>
  );
}

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
      <section className="panel pad acad-read empty">
        <div className="panel-title">The read</div>
        <p className="ar-none">
          {anyRuns
            ? 'Nothing is standing out. Every habit the academy measures is at or near where it needs to be — raise the difficulty until one of them breaks.'
            : 'Run a module and this becomes the one thing worth fixing, named out loud, with the module that fixes it attached.'}
        </p>
      </section>
    );
  }

  const meta = DRILLS[d.habit.module];
  const lower = d.habit.lowerIsBetter === true;
  const fmt = (v: number) => (lower ? `${Math.round(v)}` : `${Math.round(v * 100)}`);

  return (
    <section className="panel pad acad-read" style={{ ['--c' as string]: meta.accent }}>
      <div className="panel-title">The read</div>
      <div className="ar-body">
        <div className="ar-num">
          <b className="mono">{fmt(d.value)}</b>
          <i className="mono">{lower ? `target ${Math.round(d.habit.good)}` : `/ ${Math.round(d.habit.good * 100)}`}</i>
          <span className="eyebrow">{d.habit.label}</span>
        </div>
        <div className="ar-text">
          <p className="ar-fix">{d.habit.fix}</p>
          <div className="ar-track">
            <span
              className="ar-fill"
              style={{
                width: `${Math.round(clampPct(lower ? 1 - d.gap : Math.min(1, d.value)) * 100)}%`,
              }}
            />
            <i className="ar-gate" style={{ left: `${lower ? 100 : Math.round(d.habit.good * 100)}%` }} />
          </div>
        </div>
        <button
          className="btn primary"
          onMouseEnter={() => audio.play('uiHover')}
          onClick={() => {
            audio.play('uiClick');
            onPlay(d.habit.module);
          }}
        >
          {meta.name.replace('WASD ', '').replace(/^\d+ · /, '')}
        </button>
      </div>
    </section>
  );
}

const clampPct = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

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
    <section className="panel pad acad-laws">
      <div className="panel-title">Four things nobody tells you</div>
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
    </section>
  );
}
