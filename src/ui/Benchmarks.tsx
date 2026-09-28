import { useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { defaultsFor, resolveBindings, type Bindings } from '../engine/input';
import type { AppSettings, Profile } from '../progression/profile';
import {
  BENCH_DIFFICULTY,
  BENCH_QUORUM,
  BENCH_SCENARIOS,
  BENCH_TIERS,
  BENCH_TIER_COLORS,
  benchCode,
  benchPlace,
  benchSummary,
  benchValue,
  type BenchScenario,
} from '../progression/benchmarks';
import {
  REACTION_META,
  REACTION_TESTS,
  reactionBaseline,
  type ReactionRun,
  type ReactionTestId,
} from '../progression/warmup';
import { ReactionTest } from './ReactionTest';
import { Why } from './components/Why';
import './benchmarks.css';

/**
 * THE MEASUREMENTS.
 *
 * The reaction tests and the benchmark sheet used to share a screen with the
 * daily warm-up routine. The routine is gone; these two were never part of it
 * — they are how fast you are and where you stand, at settings that never
 * move — so they live under PROGRESS now, beside everything else that says how
 * you are doing.
 */

interface Props {
  profile: Profile;
  settings: AppSettings;
  onReaction: (test: ReactionTestId, run: ReactionRun) => void;
  onBench: (b: BenchScenario) => void;
}

const bindingsOf = (settings: AppSettings | undefined): Bindings => {
  const scheme = settings?.movementScheme === 'wasd' ? 'wasd' : 'click';
  try {
    return resolveBindings(scheme, scheme === 'wasd' ? settings?.wasdBindings : settings?.bindings);
  } catch {
    return defaultsFor(scheme);
  }
};

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function Benchmarks({ profile, settings, onReaction, onBench }: Props) {
  const bindings = useMemo(() => bindingsOf(settings), [settings]);
  const w = profile.warmup;
  const [testing, setTesting] = useState<ReactionTestId | null>(null);

  return (
    <>
        <section className="panel pad">
          <div className="panel-title">Reaction tests</div>
          <Why>
            <p className="dim wu-sub">
              Thirty seconds each. They move with sleep and tiredness far more than with skill, which is
              what makes them a good thermometer. Every figure includes your screen, browser and mouse.
            </p>
          </Why>
          <div className="wu-rx">
            {REACTION_TESTS.map((id) => {
              const m = REACTION_META[id];
              const rec = w.reaction[id];
              const last = rec.runs[rec.runs.length - 1];
              const base = reactionBaseline(rec);
              return (
                <button
                  key={id}
                  type="button"
                  className="wu-rx-card"
                  style={{ ['--c' as string]: m.accent }}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    audio.unlock();
                    audio.play('uiClick');
                    setTesting(id);
                  }}
                >
                  <b className="display">{m.label}</b>
                  <span className="wu-rx-ask">{m.ask}</span>
                  <span className="wu-rx-num mono">
                    {rec.best !== null ? (
                      <>
                        {rec.best}
                        <small>ms best</small>
                      </>
                    ) : (
                      <small>not taken yet</small>
                    )}
                  </span>
                  <span className="wu-rx-meta mono dim">
                    {last ? `last ${last.median} ms` : m.why}
                    {base !== null ? ` · normal ${Math.round(base)}` : ''}
                  </span>
                  <Spark values={rec.runs.slice(-20).map((r) => r.median)} />
                </button>
              );
            })}
          </div>
        </section>

        <BenchSheet profile={profile} onBench={onBench} onTest={(t) => setTesting(t)} />

      {testing && (
        <ReactionTest
          key={testing}
          test={testing}
          bindings={bindings}
          best={w.reaction[testing].best}
          baseline={reactionBaseline(w.reaction[testing])}
          doneLabel="DONE"
          onRecord={(run) => onReaction(testing, run)}
          onClose={() => setTesting(null)}
        />
      )}
    </>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="wu-spark" viewBox="0 0 100 24" aria-hidden="true" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(1, hi - lo);
  // Lower is better, so down on the page is up in skill: the line is flipped
  // to make an improving run of tests climb.
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${2 + ((v - lo) / span) * 20}`).join(' ');
  return (
    <svg className="wu-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// -------------------------------------------------------------- benchmarks

function BenchSheet({
  profile,
  onBench,
  onTest,
}: {
  profile: Profile;
  onBench: (b: BenchScenario) => void;
  onTest: (t: ReactionTestId) => void;
}) {
  const sum = benchSummary(profile.bench, profile.warmup);
  const tier = sum.tier >= 0 ? BENCH_TIERS[sum.tier] : null;
  return (
    <section className="panel pad wu-bench">
      <div className="wu-bench-head">
        <div>
          <div className="panel-title">Benchmarks · provisional</div>
          <Why>
            <p className="dim wu-sub">
              Nine fixed scenarios — same seed, same difficulty ({BENCH_DIFFICULTY}), same minute for everybody — so
              a score here means the same thing on anybody’s screen. You hold a tier once {BENCH_QUORUM} of the nine
              reach it. MASTER is exactly what the trainer’s scripted reference player scores; the lines will be
              re-cut from real players once there are enough of them. An APEX benchmark, not a League rank.
            </p>
          </Why>
        </div>
        <div className="wu-bench-badge" style={{ ['--c' as string]: tier ? BENCH_TIER_COLORS[tier] : 'var(--text-3)' }}>
          <b className="display">{tier ?? 'UNRANKED'}</b>
          <span className="mono">
            {sum.points} / {sum.max} pts
          </span>
          <i className="mono dim">{sum.played}/{BENCH_SCENARIOS.length} played</i>
        </div>
      </div>

      <div className="wu-bench-rows">
        {BENCH_SCENARIOS.map((b) => {
          const v = benchValue(b, profile.bench, profile.warmup);
          const place = benchPlace(b, v);
          const t = place.tier >= 0 ? BENCH_TIERS[place.tier] : null;
          const next = place.tier < BENCH_TIERS.length - 1 ? BENCH_TIERS[place.tier + 1] : null;
          const code = benchCode(b);
          return (
            <div className="wu-bench-row" key={b.id}>
              <span className="wu-b-name">
                <b>{b.label}</b>
                <i className="dim">{b.skill}</i>
              </span>
              <span className="wu-b-val mono">{v !== null ? `${fmt(v)} ${b.unit}` : '—'}</span>
              <span className="wu-b-tier" style={{ ['--c' as string]: t ? BENCH_TIER_COLORS[t] : 'var(--text-4)' }}>
                {t ?? 'UNRANKED'}
              </span>
              <span className="wu-b-bar" title={next ? `${next} at ${fmt(b.thresholds[place.tier + 1])} ${b.unit}` : 'top tier'}>
                <i style={{ width: `${Math.round(place.toNext * 100)}%`, ['--c' as string]: next ? BENCH_TIER_COLORS[next] : BENCH_TIER_COLORS.APEX }} />
                <em className="mono">{next ? `${next} ${fmt(b.thresholds[place.tier + 1])}` : 'TOP'}</em>
              </span>
              <span className="wu-b-go">
                {code && <code className="mono dim" title="Scenario code — send it to a friend">{code}</code>}
                <button
                  className="btn"
                  type="button"
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    audio.unlock();
                    audio.play('uiClick');
                    if (b.kind === 'reaction' && b.test) onTest(b.test);
                    else onBench(b);
                  }}
                >
                  {b.kind === 'reaction' ? 'TEST' : 'PLAY'}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
