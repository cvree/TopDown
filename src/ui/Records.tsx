import { useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, DRILL_LIST, type DrillId } from '../drills/catalog';
import { formatMetric, type Profile } from '../progression/profile';
import { formatTestValue, TEST_LIST, unitFor } from '../tests/catalog';
import { AXIS_LABEL, SKILL_AXES, type SkillAxis } from '../progression/skills';
import { APM_LEVELS, clearedThrough, isApmDrill, levelStars } from '../progression/apm';
import { stageStars, VAYNE_STAGES } from '../progression/vayne';
import { Sparkline } from './components/charts';
import './records.css';

/**
 * RECORDS.
 *
 * Every number the player has ever beaten, in one place, with the number it
 * beat and when. A record with no previous value is a baseline and says so —
 * "personal best" on a first attempt is a lie that makes every other badge on
 * the screen worth less.
 */

interface Props {
  profile: Profile;
  onPlay: (id: DrillId) => void;
  onTests: () => void;
  onTrain: () => void;
}

type Category = 'ALL' | SkillAxis | 'CHAMPION' | 'TESTS';

interface Row {
  id: string;
  drill: DrillId;
  name: string;
  accent: string;
  best: number;
  previous: number | null;
  at: number;
  attempts: number;
  keyLabel: string;
  keyValue: string | null;
  trend: number[];
}

const primaryAxis = (id: DrillId): SkillAxis =>
  (Object.entries(DRILLS[id].axes).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? 'movement') as SkillAxis;

export function Records({ profile, onPlay, onTests, onTrain }: Props) {
  const [cat, setCat] = useState<Category>('ALL');

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const d of DRILL_LIST) {
      const best = profile.bests[d.id];
      if (!best) continue;
      const runs = profile.history.filter((h) => h.drill === d.id);
      const scores = runs.map((h) => h.score).sort((a, b) => b - a);
      // The record it beat: the second-best run ever recorded, not the run
      // before it. That is what "previous best" means everywhere else.
      const previous = scores.length > 1 ? scores[1] : null;
      const metric = Object.entries(best.metrics)[0];
      out.push({
        id: d.id,
        drill: d.id,
        name: d.name,
        accent: d.accent,
        best: best.score,
        previous,
        at: best.at,
        attempts: runs.length,
        keyLabel: d.keyMetric,
        keyValue: metric ? formatMetric(metric[1], guessFormat(metric[0])) : null,
        trend: runs.slice(-14).map((h) => h.score),
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [profile]);

  const visible = useMemo(() => {
    if (cat === 'ALL') return rows;
    if (cat === 'CHAMPION') return rows.filter((r) => DRILLS[r.drill].group === 'VAYNE');
    if (cat === 'TESTS') return [];
    return rows.filter((r) => primaryAxis(r.drill) === cat && DRILLS[r.drill].group !== 'VAYNE');
  }, [rows, cat]);

  // Only offer a category filter that would actually show something.
  const cats = useMemo(() => {
    const list: { id: Category; label: string }[] = [{ id: 'ALL', label: 'All' }];
    for (const axis of SKILL_AXES) {
      if (rows.some((r) => primaryAxis(r.drill) === axis && DRILLS[r.drill].group !== 'VAYNE')) {
        list.push({ id: axis, label: AXIS_LABEL[axis] });
      }
    }
    if (rows.some((r) => DRILLS[r.drill].group === 'VAYNE')) list.push({ id: 'CHAMPION', label: 'Champion' });
    if (Object.keys(profile.tests).length) list.push({ id: 'TESTS', label: 'Tests' });
    return list;
  }, [rows, profile.tests]);

  const testRows = useMemo(
    () => TEST_LIST.filter((t) => profile.tests[t.id]).map((t) => ({ meta: t, rec: profile.tests[t.id]! })),
    [profile.tests],
  );

  // The lab's records, one line per bench: how far up the ladder it has been
  // cleared, and the best correct rate ever sustained on it.
  const labRows = useMemo(
    () =>
      (Object.keys(profile.apm.modes) as DrillId[])
        .filter((id) => isApmDrill(id))
        .map((id) => {
          const mode = profile.apm.modes[id as keyof typeof profile.apm.modes];
          return {
            id,
            cleared: clearedThrough(mode),
            stars: mode.levels.reduce((n, lv) => n + levelStars(lv), 0),
            apm: Math.max(0, ...mode.levels.map((lv) => lv.bestApm)),
          };
        })
        .filter((r) => r.apm > 0)
        .sort((a, b) => b.apm - a.apm),
    [profile.apm],
  );

  const headline = useMemo(() => {
    const beaten = rows.filter((r) => r.previous !== null);
    return {
      records: rows.length,
      beaten: beaten.length,
      recent: rows.filter((r) => Date.now() - r.at < 7 * 86400000).length,
    };
  }, [rows]);

  if (rows.length === 0 && testRows.length === 0) {
    return (
      <div className="scroll">
        <div className="wrap records">
          <h1 className="display rec-h1">RECORDS</h1>
          <div className="empty" style={{ maxWidth: 640 }}>
            <b>NOTHING SET YET</b>
            <p>
              A record needs a run to beat. Play any drill twice and the second one either takes the record or
              does not — both are worth knowing.
            </p>
            <button className="btn" onClick={onTrain}>
              Open training
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scroll">
      <div className="wrap records fade-up">
        <header className="rec-head">
          <div>
            <div className="eyebrow">Personal bests</div>
            <h1 className="display rec-h1">RECORDS</h1>
          </div>
          <div className="rec-summary">
            <div>
              <span className="eyebrow">Records held</span>
              <b className="mono">{headline.records}</b>
            </div>
            <div>
              <span className="eyebrow">Beaten at least once</span>
              <b className="mono">{headline.beaten}</b>
            </div>
            <div>
              <span className="eyebrow">Set this week</span>
              <b className="mono">{headline.recent}</b>
            </div>
          </div>
        </header>

        <div className="rec-cats">
          {cats.map((c) => (
            <button
              key={c.id}
              className={`rec-cat${cat === c.id ? ' on' : ''}`}
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                audio.play('uiClick');
                setCat(c.id);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {cat === 'TESTS' ? (
          <div className="panel pad">
            <div className="panel-title">Standardised tests</div>
            <table className="rec-table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Best</th>
                  <th>Last</th>
                  <th>Grade</th>
                  <th>Attempts</th>
                  <th>Set</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {testRows.map(({ meta, rec }) => (
                  <tr key={meta.id}>
                    <td className="rt-name">{meta.name}</td>
                    <td className="mono strong">
                      {formatTestValue(rec.best, meta.primaryFormat)}
                      <em className="rt-unit">{unitFor(meta.primaryFormat)}</em>
                    </td>
                    <td className="mono faint">{formatTestValue(rec.last, meta.primaryFormat)}</td>
                    <td className="mono">{Math.round(rec.bestRating)}</td>
                    <td className="mono faint">{rec.attempts}</td>
                    <td className="faint mono">{dateOf(rec.at)}</td>
                    <td>
                      {rec.history.length > 2 ? (
                        <Sparkline
                          values={rec.history.map((h) => h.rating)}
                          width={110}
                          height={26}
                          fill={false}
                        />
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn ghost sm" style={{ marginTop: 16 }} onClick={onTests}>
              Open the test centre
            </button>
          </div>
        ) : (
          <div className="rec-grid">
            {visible.map((r) => {
              const gain = r.previous !== null ? r.best - r.previous : null;
              return (
                <button
                  className="rec-card"
                  key={r.id}
                  style={{ ['--c' as string]: r.accent }}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => onPlay(r.drill)}
                  title={`Play ${r.name}`}
                >
                  <div className="rc-top">
                    <span className="rc-name display">{r.name}</span>
                    <span className="rc-when faint mono">{dateOf(r.at)}</span>
                  </div>
                  <div className="rc-best display mono">{r.best.toLocaleString()}</div>
                  <div className="rc-prev">
                    {gain !== null ? (
                      <>
                        <span className="mono faint">was {r.previous!.toLocaleString()}</span>
                        <b className="good mono">+{gain.toLocaleString()}</b>
                      </>
                    ) : (
                      <span className="mono faint">baseline — no run has beaten it yet</span>
                    )}
                  </div>
                  {r.keyValue && (
                    <div className="rc-metric">
                      <span className="eyebrow">{r.keyLabel}</span>
                      <b className="mono">{r.keyValue}</b>
                    </div>
                  )}
                  {r.trend.length > 3 && (
                    <div className="rc-trend">
                      <Sparkline values={r.trend} width={210} height={30} color={r.accent} />
                      <span className="faint mono">{r.attempts} runs</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {cat === 'ALL' && (
          <>
            <section className="panel pad rec-extra">
              <div className="panel-title">The champion path</div>
              <div className="rec-line-list">
                {VAYNE_STAGES.map((st) => {
                  const p = profile.vayne.stages[st.id];
                  const stars = p ? stageStars(st, p) : 0;
                  return (
                    <div className="rec-line" key={st.id}>
                      <span className="rl-name">{st.title}</span>
                      <div className="rl-bar">
                        <span style={{ width: `${Math.round((p?.best ?? 0) * 100)}%` }} />
                      </div>
                      <span className="rl-val mono">
                        {p && p.best > 0 ? `${Math.round(p.best * 100)}%` : '—'}
                      </span>
                      <span className="rl-stars">
                        {[1, 2, 3].map((n) => (
                          <i key={n} className={n <= stars ? 'on' : ''} />
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel pad rec-extra">
              <div className="panel-title">The lab ladder</div>
              <div className="rec-line-list">
                {labRows.map((r) => (
                  <div className="rec-line" key={r.id}>
                    <span className="rl-name">{DRILLS[r.id].name}</span>
                    <div className="rl-bar">
                      <span style={{ width: `${(r.cleared / APM_LEVELS) * 100}%` }} />
                    </div>
                    <span className="rl-val mono">{Math.round(r.apm)} APM</span>
                    <span className="rl-note faint mono">
                      cleared {r.cleared} / {APM_LEVELS}
                    </span>
                  </div>
                ))}
                {labRows.length === 0 && (
                  <div className="empty">
                    <b>NO LAB RECORDS</b>
                    <p>The lab measures correct actions per minute across thirteen benches. None run yet.</p>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const guessFormat = (key: string): 'pct' | 'ms' | 'units' | 'int' => {
  const k = key.toLowerCase();
  if (k.includes('reaction') || k.includes('switch') || k.includes('speed') || k.includes('delay')) return 'ms';
  if (k.includes('err') || k.includes('spacing')) return 'units';
  if (k.includes('apm') || k.includes('count') || k.includes('cs') || k.includes('chain')) return 'int';
  return 'pct';
};

const dateOf = (t: number): string =>
  new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const recordCount = (p: Profile): number => Object.keys(p.bests).length + Object.keys(p.tests).length;
