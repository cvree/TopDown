import { audio } from '../engine/audio';
import { DRILLS } from '../drills/catalog';
import { drillDifficulty, type Profile } from '../progression/profile';
import {
  VAYNE_STAGES,
  VAYNE_TITLES,
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
