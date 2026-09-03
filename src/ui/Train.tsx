import { useCallback, useEffect, useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { CATEGORIES, PHASE, categoryOf, drillsIn, phaseOf, type Category } from '../drills/taxonomy';
import { drillDifficulty, trainingPriority, type Profile } from '../progression/profile';
import { APM_LEVELS, clearedThrough, isApmDrill, recommendedLevel } from '../progression/apm';
import { buildPlan, nextInPlan } from '../progression/plan';
import { AXIS_LABEL } from '../progression/skills';
import { VAYNE_STAGES, isVayneStage, nextVayneStage, stageUnlocked } from '../progression/vayne';
import { isWasdModuleId, moduleOf, moduleUnlocked, nextWasdModule } from '../progression/wasd';
import './train.css';

interface Props {
  profile: Profile;
  onPlay: (id: DrillId) => void;
  /** Opens the ladder for one APM mode. */
  onLadder: (id: DrillId) => void;
  /** Opens the WASD academy, where the modules are explained and gated. */
  onCourse: () => void;
  onDaily: () => void;
}

/**
 * TRAIN.
 *
 * One browser for everything you can run, replacing three sections that were
 * three filing cabinets: DRILLS, WASD and LAB. A player does not think "I
 * would like something from the lab", they think "my kiting is bad" — so the
 * rail is sorted by part of the game, and the thing that used to be a section
 * (an academy module, an APM bench) is now a row inside the category it
 * trains, carrying a tag that says how much of the game is switched on.
 *
 * RECOMMENDED sits above all of it and is visually dominant, because the
 * honest answer to "what should I run" is almost always one of four things
 * and none of them require reading a catalogue of thirty-nine.
 */
export function Train({ profile, onPlay, onLadder, onCourse, onDaily }: Props) {
  const plan = useMemo(() => buildPlan(profile), [profile]);
  const recommended = useMemo(() => buildRecommendations(profile, plan), [profile, plan]);
  // The category your weakest axis lives in is open on arrival: the most
  // likely reason to be on this screen should not also cost a click.
  const [open, setOpen] = useState<Category | null>(() => {
    const priority = trainingPriority(profile);
    const d = priority ? drillForAxis(priority.axis) : null;
    return d ? categoryOf(d) : null;
  });
  const [selected, setSelected] = useState<DrillId>(() => recommended[0]?.id ?? 'movement');

  const play = useCallback(
    (id: DrillId) => {
      audio.play('uiClick');
      onPlay(id);
    },
    [onPlay],
  );

  // Enter plays whatever is selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      play(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, selected]);

  return (
    <div className="scroll">
      <div className="wrap wide train fade-up">
        <div className="page-head">
          <div>
            <span className="eyebrow">Train</span>
            <h1 className="display">WHAT DO YOU WANT TO FIX?</h1>
          </div>
          <button className="link" onClick={() => { audio.play('uiTab'); onDaily(); }}>
            Daily set →
          </button>
        </div>

        {/* -------------------------------------------------- recommended */}
        <section className="tr-rec">
          <div className="sec-head">
            Recommended
            <span className="sec-note">picked from your last {Math.min(profile.totalRuns, 40)} runs</span>
          </div>
          <div className="tr-rec-row">
            {recommended.map((r, i) => (
              <button
                key={r.id}
                className={`tr-card${i === 0 ? ' lead' : ''}`}
                style={{ ['--c' as string]: DRILLS[r.id].accent }}
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => play(r.id)}
              >
                <span className="tag" style={{ ['--c' as string]: PHASE[phaseOf(r.id)].color }}>
                  {PHASE[phaseOf(r.id)].label}
                </span>
                <b className="display">{DRILLS[r.id].name}</b>
                <p>{r.why}</p>
                <span className="tr-card-go">{i === 0 ? 'Start →' : 'Run →'}</span>
              </button>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------- the catalogue */}
        <section className="tr-cats">
          <div className="sec-head">Everything else</div>
          {CATEGORIES.map((c) => {
            const ids = drillsIn(c.id);
            if (!ids.length) return null;
            const isOpen = open === c.id;
            return (
              <div className={`tr-cat${isOpen ? ' open' : ''}`} key={c.id}>
                <button
                  className="tr-cat-head"
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    audio.play('uiTab');
                    setOpen(isOpen ? null : c.id);
                  }}
                >
                  <b>{c.name}</b>
                  <span>{c.blurb}</span>
                  <em className="mono">{ids.length}</em>
                  <i className="tr-chev" />
                </button>
                {isOpen && (
                  <div className="tr-rows">
                    {ids.map((id) => (
                      <DrillRow
                        key={id}
                        id={id}
                        profile={profile}
                        selected={selected === id}
                        onSelect={setSelected}
                        onPlay={play}
                        onLadder={onLadder}
                        onCourse={onCourse}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

/** One drill in a category: name, what it is, how you are doing, and Run. */
function DrillRow({
  id,
  profile,
  selected,
  onSelect,
  onPlay,
  onLadder,
  onCourse,
}: {
  id: DrillId;
  profile: Profile;
  selected: boolean;
  onSelect: (id: DrillId) => void;
  onPlay: (id: DrillId) => void;
  onLadder: (id: DrillId) => void;
  onCourse: () => void;
}) {
  const meta = DRILLS[id];
  const phase = phaseOf(id);
  const locked =
    (isVayneStage(id) && !stageUnlocked(profile.vayne, VAYNE_STAGES[VAYNE_STAGES.findIndex((s) => s.id === id)])) ||
    (isWasdModuleId(id) && !moduleUnlocked(profile.wasd, moduleOf(id)));
  // Narrowed once so the ladder link below can ask the progression module
  // about this mode without re-testing the id at every call.
  const apmId = isApmDrill(id) ? id : null;
  const apm = apmId ? profile.apm.modes[apmId] : null;
  const best = profile.bests[id];

  return (
    <div
      className={`tr-row${selected ? ' on' : ''}${locked ? ' locked' : ''}`}
      style={{ ['--c' as string]: meta.accent }}
      onMouseEnter={() => onSelect(id)}
    >
      <span className="tag" style={{ ['--c' as string]: PHASE[phase].color }}>
        {PHASE[phase].label}
      </span>
      <b>{meta.name}</b>
      <p>{meta.tagline}</p>
      <span className="tr-row-best mono">
        {locked
          ? 'Locked'
          : apmId
            ? `LV ${recommendedLevel(profile.apm, apmId)} / ${APM_LEVELS}`
            : best
              ? best.score.toLocaleString()
              : '—'}
      </span>
      {locked ? (
        <button className="link" onClick={() => { audio.play('uiTab'); onCourse(); }}>
          How to unlock
        </button>
      ) : apm && apmId ? (
        <button className="link" onClick={() => { audio.play('uiTab'); onLadder(apmId); }}>
          {clearedThrough(apm) > 0 ? `Cleared ${clearedThrough(apm)} · ladder` : 'Ladder'}
        </button>
      ) : (
        <span className="tr-row-diff" title="Adaptive difficulty">
          {Array.from({ length: 5 }).map((_, i) => (
            <i key={i} className={i < Math.round(drillDifficulty(profile, id) * 5) ? 'on' : ''} />
          ))}
        </span>
      )}
      <button
        className="btn sm"
        disabled={locked}
        onMouseEnter={() => audio.play('uiHover')}
        onClick={() => onPlay(id)}
      >
        Run
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- helpers */

interface Recommendation {
  id: DrillId;
  why: string;
}

/**
 * The four things worth running right now, in priority order.
 *
 * They are deliberately different *kinds* of answer — what the plan says next,
 * the axis holding you back, the course you are partway through, the champion
 * you are learning — so the row is never four flavours of the same suggestion.
 */
const buildRecommendations = (p: Profile, plan: ReturnType<typeof buildPlan>): Recommendation[] => {
  const out: Recommendation[] = [];
  const seen = new Set<DrillId>();
  const add = (id: DrillId | null | undefined, why: string) => {
    if (!id || seen.has(id) || out.length >= 4) return;
    seen.add(id);
    out.push({ id, why });
  };

  const next = nextInPlan(plan);
  if (next) add(next.drill, `Next in today’s session — ${next.label.toLowerCase()}.`);

  const priority = trainingPriority(p);
  if (priority) {
    const d = drillForAxis(priority.axis);
    add(d, `Your weakest axis. ${AXIS_LABEL[priority.axis]} is what is holding the rest back.`);
  }

  const mod = nextWasdModule(p.wasd);
  if (moduleUnlocked(p.wasd, mod)) {
    const rec = p.wasd.modules[mod.id];
    add(
      mod.id,
      rec.runs === 0
        ? `The academy’s next module: ${mod.title.toLowerCase()}.`
        : `${Math.round(rec.best * 100)}% best, ${Math.round(mod.gate * 100)}% clears it.`,
    );
  }

  const stage = nextVayneStage(p.vayne);
  add(stage.id, `Your champion path — ${stage.title.toLowerCase()}.`);

  return out;
};

/** The drill that trains an axis hardest, ignoring the gated courses. */
const drillForAxis = (axis: keyof typeof AXIS_LABEL): DrillId | null => {
  let best: DrillId | null = null;
  let weight = 0;
  for (const id of Object.keys(DRILLS) as DrillId[]) {
    const meta = DRILLS[id];
    if (meta.group === 'VAYNE' || meta.group === 'WASD' || meta.group === 'APM') continue;
    const w = meta.axes[axis] ?? 0;
    if (w > weight) {
      weight = w;
      best = id;
    }
  }
  return best;
};
