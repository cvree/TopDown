import { audio } from '../engine/audio';
import { DRILLS } from '../drills/catalog';
import { codeLabel, defaultsFor, type ActionId } from '../engine/input';
import { drillDifficulty, type Profile } from '../progression/profile';
import {
  VAYNE_STAGES,
  VAYNE_TITLES,
  diagnose,
  nextTitle,
  nextVayneStage,
  stageStars,
  stageUnlocked,
  titleFor,
  type VayneStage,
} from '../progression/vayne';
import type { DrillId } from '../drills/catalog';
import './vayne.css';

interface Props {
  profile: Profile;
  onPlay: (id: DrillId) => void;
  onBack: () => void;
}

/**
 * THE VAYNE PATH.
 *
 * The rest of the client rates you across nine axes and does not care which
 * champion you play. This screen is the opposite: one champion, four stages in
 * the order they have to be learned, and a single number that only moves when
 * your best run on a stage gets better.
 *
 * It is deliberately a course rather than a menu. A stage you have not cleared
 * locks the one after it, because the reason people cannot play Vayne is never
 * the ultimate — it is that they never learned to finish a stack.
 */
export function Vayne({ profile, onPlay, onBack }: Props) {
  const v = profile.vayne;
  const title = titleFor(v.peak);
  const next = nextTitle(v.peak);
  const recommended = nextVayneStage(v);
  const cleared = VAYNE_STAGES.filter((s) => v.stages[s.id].best >= s.gate).length;
  const onKeys = profile.settings.movementScheme === 'wasd';

  return (
    <div className="scroll">
      <div className="wrap vpath fade-up">
        <div className="vpath-head">
          <div>
            <div className="eyebrow">Champion path</div>
            <h1 className="display vpath-h1">THE VAYNE PATH</h1>
            <p className="dim vpath-lead">
              Four stages, in the order they have to be learned: the tumble rhythm, the third hit, the
              wall, then all of it at once against two people trying to kill you. Each stage unlocks the
              next, and mastery only moves when your <b>best</b> run improves — so it is a record of what
              you can do, not of how long you have been here.
            </p>
          </div>

          <aside className="vpath-crest">
            <div className="vc-ring" style={{ ['--m' as string]: `${v.mastery}%` }}>
              <span className="vc-num mono">{Math.round(v.mastery)}</span>
              <span className="vc-lab">MASTERY</span>
            </div>
            <div className="vc-title display">{title.name}</div>
            <p className="vc-blurb">{title.blurb}</p>
            {next && (
              <div className="vc-next">
                <span className="eyebrow">Next</span>
                <b>{next.name}</b>
                <i className="mono">{Math.max(0, Math.ceil(next.at - v.peak))} to go</i>
              </div>
            )}
          </aside>
        </div>

        <div className="vpath-stages">
          {VAYNE_STAGES.map((stage) => (
            <StageCard
              key={stage.id}
              stage={stage}
              profile={profile}
              recommended={recommended.id === stage.id}
              onPlay={onPlay}
            />
          ))}
        </div>

        <Diagnosis profile={profile} onPlay={onPlay} />

        {onKeys && <Hands profile={profile} />}

        <section className="panel pad vpath-ladder">
          <div className="panel-title">Titles</div>
          <div className="vl-rows">
            {VAYNE_TITLES.map((t) => {
              const held = v.peak >= t.at;
              return (
                <div className={`vl-row${held ? ' held' : ''}`} key={t.name}>
                  <span className="vl-at mono">{t.at}</span>
                  <b className="vl-name">{t.name}</b>
                  <span className="vl-blurb">{t.blurb}</span>
                </div>
              );
            })}
          </div>
          <p className="set-note">
            The last one is a claim about <b>these drills</b> at the difficulty you cleared them at —
            every stage at three stars, with the pressure turned up. It is not a claim about anybody’s
            ranked ladder, and the trainer will not pretend otherwise.
          </p>
        </section>

        <div className="vpath-foot">
          <span className="mono faint">
            {cleared} / {VAYNE_STAGES.length} stages cleared
          </span>
          <button className="btn ghost lg" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

function StageCard({
  stage,
  profile,
  recommended,
  onPlay,
}: {
  stage: VayneStage;
  profile: Profile;
  recommended: boolean;
  onPlay: (id: DrillId) => void;
}) {
  const meta = DRILLS[stage.id];
  const rec = profile.vayne.stages[stage.id];
  const unlocked = stageUnlocked(profile.vayne, stage);
  const stars = stageStars(stage, rec);
  const diff = drillDifficulty(profile, stage.id);
  const prev = VAYNE_STAGES[stage.step - 2];

  return (
    <div
      className={`vstage${unlocked ? '' : ' locked'}${recommended && unlocked ? ' rec' : ''}`}
      style={{ ['--c' as string]: meta.accent }}
    >
      <div className="vs-step mono">{String(stage.step).padStart(2, '0')}</div>

      <div className="vs-body">
        <div className="vs-titles">
          <b className="vs-name display">{meta.name}</b>
          <span className="vs-sub">{stage.title}</span>
          {recommended && unlocked && <span className="vs-flag">START HERE</span>}
        </div>
        <p className="vs-purpose">{stage.purpose}</p>

        <div className="vs-stats">
          <div>
            <span className="eyebrow">Best</span>
            <b className="mono">{rec.runs ? `${Math.round(rec.best * 100)}%` : '—'}</b>
          </div>
          <div>
            <span className="eyebrow">To clear</span>
            <b className="mono">{Math.round(stage.gate * 100)}%</b>
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

        {/* The bar fills to your best and carries a notch at the gate, so the
            question "how far off am I" is a distance rather than arithmetic. */}
        <div className="vs-track">
          <span className="vs-fill" style={{ width: `${Math.round(Math.min(1, rec.best) * 100)}%` }} />
          <i className="vs-gate" style={{ left: `${Math.round(stage.gate * 100)}%` }} />
        </div>
      </div>

      <div className="vs-right">
        <div className="vs-stars">
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
              onPlay(stage.id);
            }}
          >
            {rec.runs ? 'Run it' : 'Begin'}
          </button>
        ) : (
          <div className="vs-lock">
            <span>LOCKED</span>
            <i>Clear {DRILLS[prev.id].name}</i>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * THE DIAGNOSIS.
 *
 * Four stages produce twenty numbers between them, and a player looking at
 * twenty numbers learns nothing. This picks the single habit furthest from
 * where it needs to be, says it in a sentence, and puts the drill that fixes
 * it one click away.
 *
 * It reads your *last* run on each stage rather than your best, because "what
 * should I go and work on" is a question about how you are playing now.
 */
function Diagnosis({ profile, onPlay }: { profile: Profile; onPlay: (id: DrillId) => void }) {
  const onKeys = profile.settings.movementScheme === 'wasd';
  const d = diagnose(profile.vayne, onKeys);

  if (!d) {
    const anyRuns = VAYNE_STAGES.some((s) => profile.vayne.stages[s.id].runs > 0);
    return (
      <section className="panel pad vpath-diag empty">
        <div className="panel-title">The read</div>
        <p className="vd-none">
          {anyRuns
            ? 'Nothing is standing out. Every habit measured is at or near where it needs to be — raise the difficulty and make one of them break.'
            : 'Run a stage and this becomes the one thing worth fixing, named out loud, with the drill that fixes it attached.'}
        </p>
      </section>
    );
  }

  const meta = DRILLS[d.habit.stage];
  return (
    <section className="panel pad vpath-diag" style={{ ['--c' as string]: meta.accent }}>
      <div className="panel-title">The read</div>
      <div className="vd-body">
        <div className="vd-num">
          <b className="mono">{Math.round(d.value * 100)}</b>
          <i className="mono">/ {Math.round(d.habit.good * 100)}</i>
          <span className="eyebrow">{d.habit.label}</span>
        </div>
        <div className="vd-text">
          <p className="vd-fix">{d.fix}</p>
          <div className="vd-track">
            <span className="vd-fill" style={{ width: `${Math.round(Math.min(1, d.value) * 100)}%` }} />
            <i className="vd-gate" style={{ left: `${Math.round(d.habit.good * 100)}%` }} />
          </div>
        </div>
        <button
          className="btn primary"
          onMouseEnter={() => audio.play('uiHover')}
          onClick={() => {
            audio.play('uiClick');
            onPlay(d.habit.stage);
          }}
        >
          {meta.name}
        </button>
      </div>
    </section>
  );
}

/**
 * THE HANDS.
 *
 * Only shown under WASD, and it exists because that scheme moves Vayne's whole
 * kit one seat over: Condemn is not on E any more, Final Hour is not on R, and
 * a player who learned her with a mouse will press the wrong key for a week
 * unless somebody puts the new row in front of them.
 *
 * The keys are read from the live bindings rather than printed as constants,
 * so a rebound layout says what it actually is.
 */
function Hands({ profile }: { profile: Profile }) {
  const defaults = defaultsFor('wasd');
  const overrides = profile.settings.wasdBindings ?? {};
  const key = (a: ActionId): string => codeLabel((overrides[a] ?? defaults[a]).primary).toUpperCase();
  const aim = profile.settings.tumbleAim ?? 'hands';

  return (
    <section className="panel pad vpath-hands">
      <div className="panel-title">Her kit, on your keys</div>
      <div className="vh-row">
        {[
          { k: key('q'), name: 'TUMBLE', sub: 'Q — the dash' },
          { k: '—', name: 'SILVER BOLTS', sub: 'W — passive, no key' },
          { k: key('e'), name: 'CONDEMN', sub: 'E — the wall' },
          { k: key('r'), name: 'FINAL HOUR', sub: 'R — the window' },
          { k: 'LMB', name: 'TARGET', sub: 'never walks you' },
          { k: key('stop'), name: 'STOP', sub: 'holds the ground' },
        ].map((a) => (
          <div className="vh-key" key={a.name}>
            <kbd className="kbd">{a.k}</kbd>
            <b>{a.name}</b>
            <span>{a.sub}</span>
          </div>
        ))}
      </div>

      <div className="vh-laws">
        <div>
          <b>Release is the trigger.</b> She cannot fire while you are asking her to walk, so the step and
          the shot are one beat: let go, shoot, hold again. The <i>TRIGGER</i> figure on the HUD is the
          milliseconds you spend on the wrong side of that beat.
        </div>
        <div>
          <b>A held key cancels a windup.</b> Exactly as a click does. The whole of orbwalking is that the
          same input is free in the backswing and ruinous a fifth of a second earlier.
        </div>
        <div>
          <b>{aim === 'hands' ? 'Your keys aim the tumble.' : 'Your cursor aims the tumble.'}</b>{' '}
          {aim === 'hands'
            ? 'Whatever direction you are holding is where Q sends you, and the cursor only takes over when your hand is off the keys — so your escape is aimed by the hand that is already pointing at it.'
            : 'League’s literal behaviour: Q goes to the cursor even while your keys point the other way. Change it under Settings → Dash aim if the dash keeps pulling you into the fight.'}{' '}
          The ring on the floor is where you would land.
        </div>
      </div>
    </section>
  );
}
