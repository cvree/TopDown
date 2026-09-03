import { useCallback, useEffect, useMemo } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { formatMetric, recentImprovement, type Profile } from '../progression/profile';
import { axisReadings, buildPlan, nextInPlan, recentImprovements } from '../progression/plan';
import { heroFor } from '../engine/heroes';
import { rankFromRating } from '../progression/ranks';
import { AXIS_BLURB, AXIS_LABEL } from '../progression/skills';
import { nextVayneStage } from '../progression/vayne';
import { HeroSigil } from './components/HeroSigil';
import { RankEmblem } from './components/RankEmblem';
import './today.css';

export type Section = 'train' | 'champions' | 'test' | 'progress' | 'settings';

interface Props {
  profile: Profile;
  /** Runs the whole remaining session as one queue. The one-click path. */
  onStartSession: () => void;
  /** Runs a single drill, from anywhere on the screen. */
  onPlay: (id: DrillId) => void;
  onPlacement: () => void;
  onSection: (r: Section) => void;
}

/**
 * TODAY.
 *
 * The home screen answers five questions and then gets out of the way:
 *
 *   What should I train?      — the headline, and the button under it.
 *   What champion am I on?    — the champion card, with its next stage.
 *   What am I worst at?       — one axis, named, with the gap.
 *   What improved?            — one number, with what it beat.
 *   What do I do next?        — the button. One click, no choosing.
 *
 * It used to answer eleven, in nine panels, below a fold: a consistency
 * grid, a benchmark counter, a last-session table, an academy card, a
 * strengths list, an unrated-axes note and a six-button section index. Every
 * one of those was true and none of them was the reason anybody opened the
 * app. They live on Progress now, or in the section they belong to, and what
 * is left is a screen you can act on in one glance.
 */
export function Today({ profile, onStartSession, onPlay, onPlacement, onSection }: Props) {
  const rank = rankFromRating(profile.overall);
  const plan = useMemo(() => buildPlan(profile), [profile]);
  const next = nextInPlan(plan);
  const { weaknesses } = useMemo(() => axisReadings(profile), [profile]);
  const improvement = useMemo(() => recentImprovements(profile)[0] ?? null, [profile]);
  const trend = recentImprovement(profile);
  const weakest = weaknesses[0] ?? null;

  const start = useCallback(() => {
    audio.play('uiClick');
    if (!profile.placed) onPlacement();
    else onStartSession();
  }, [profile.placed, onPlacement, onStartSession]);

  // Enter starts the session. A client you can drive from the keyboard is a
  // client; one you can only click is a web page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  const remaining = plan.items.filter((i) => !i.done);
  const minutesLeft = Math.round(remaining.reduce((n, i) => n + i.minutes, 0));

  if (!profile.placed) {
    return (
      <div className="scroll">
        <div className="wrap today fade-up">
          <section className="td-open">
            <span className="eyebrow">First run</span>
            <h1 className="td-title display">CALIBRATION</h1>
            <p className="td-lead">
              Five short drills read your movement, reaction, attack timing and combat profile, then place
              you on the ladder. Eight minutes, once. After that this screen builds you a session every day.
            </p>
            <button className="btn primary lg" onClick={start} onMouseEnter={() => audio.play('uiHover')}>
              Begin calibration <span className="hint">ENTER</span>
            </button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="scroll">
      <div className="wrap today fade-up">
        {/* ------------------------------------------------ today's training */}
        <section className="td-open">
          <div className="td-open-l">
            <div className="td-strip">
              <span className="eyebrow">Today’s training</span>
              <span className="mono">{longDate()}</span>
            </div>
            <h1 className="td-title display">{plan.headline}</h1>
            <p className="td-lead">
              {remaining.length === 0
                ? 'Finished. Anything now is extra — run it again, or pick your own.'
                : `${remaining.length} ${remaining.length === 1 ? 'drill' : 'drills'}, about ${minutesLeft} minutes.`}
            </p>

            <div className="td-go">
              <button className="btn primary lg" onClick={start} onMouseEnter={() => audio.play('uiHover')}>
                {plan.done === 0 ? 'Start training' : remaining.length ? 'Continue' : 'Run it again'}
                <span className="hint">ENTER</span>
              </button>
              {next && (
                <span className="td-next">
                  Starts with <b style={{ color: DRILLS[next.drill].accent }}>{DRILLS[next.drill].name}</b>
                </span>
              )}
            </div>
          </div>

          <button className="td-rank" onClick={() => onSection('progress')} onMouseEnter={() => audio.play('uiHover')}>
            <RankEmblem tier={rank.tier} size={64} />
            <b className="display">{rank.label}</b>
            <span className="mono">{Math.round(profile.overall)}</span>
            <div className="meter">
              <span style={{ width: `${Math.round(rank.progress * 100)}%` }} />
            </div>
            <i className={trend >= 0 ? 'good' : 'bad'}>
              {trend >= 0 ? '+' : ''}
              {trend.toFixed(1)}% · 7 days
            </i>
          </button>
        </section>

        {/* ------------------------------------------------------- the reads */}
        <section className="td-reads">
          <Read
            label="Current champion"
            onClick={() => {
              audio.play('uiTab');
              onSection('champions');
            }}
          >
            {(() => {
              const hero = heroFor(profile.settings.hero);
              const stage = nextVayneStage(profile.vayne);
              return (
                <>
                  <div className="td-read-head" style={{ ['--c' as string]: hero.accent }}>
                    <HeroSigil hero={hero.id} size={26} />
                    <b>{hero.name.toUpperCase()}</b>
                  </div>
                  <p>
                    Next on the path: <em>{DRILLS[stage.id].name}</em> — {stage.title.toLowerCase()}.
                  </p>
                  <span className="td-read-act">Continue mastery →</span>
                </>
              );
            })()}
          </Read>

          <Read
            label="Biggest weakness"
            tone="bad"
            onClick={
              weakest
                ? () => {
                    audio.play('uiClick');
                    const d = drillForWeakness(weakest.axis, plan.items.map((i) => i.drill));
                    if (d) onPlay(d);
                    else onSection('train');
                  }
                : undefined
            }
          >
            {weakest ? (
              <>
                <div className="td-read-head">
                  <b>{AXIS_LABEL[weakest.axis].toUpperCase()}</b>
                  <span className="mono bad">{Math.round(weakest.gap)}</span>
                </div>
                <p>{AXIS_BLURB[weakest.axis]}</p>
                <span className="td-read-act">Train it now →</span>
              </>
            ) : (
              <p className="td-none">Not enough runs yet to name one.</p>
            )}
          </Read>

          <Read
            label="Recent improvement"
            tone="good"
            onClick={
              improvement
                ? () => {
                    audio.play('uiClick');
                    onPlay(improvement.drill);
                  }
                : () => onSection('progress')
            }
          >
            {improvement ? (
              <>
                <div className="td-read-head">
                  <b>{improvement.label.toUpperCase()}</b>
                  <span className="mono good">
                    {improvement.delta >= 0 ? '+' : ''}
                    {Math.min(999, Math.abs(improvement.delta)).toFixed(1)}%
                  </span>
                </div>
                <p>
                  {formatMetric(improvement.value, improvement.format)} on{' '}
                  <em>{DRILLS[improvement.drill].name}</em>, {relative(improvement.at).toLowerCase()}.
                </p>
                <span className="td-read-act">Beat it again →</span>
              </>
            ) : (
              <p className="td-none">Beat one of your own numbers and it lands here.</p>
            )}
          </Read>
        </section>

        {/* -------------------------------------------------- today's session */}
        <section className="td-session">
          <div className="sec-head">
            The session
            <span className="sec-note">
              {plan.done} / {plan.items.length} · {Math.round(plan.minutes)} min
            </span>
          </div>
          <div className="td-list">
            {plan.items.map((item, i) => (
              <button
                key={item.drill}
                className={`td-item${item.done ? ' done' : ''}${next?.drill === item.drill ? ' next' : ''}`}
                style={{ ['--c' as string]: DRILLS[item.drill].accent }}
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiClick');
                  onPlay(item.drill);
                }}
              >
                <i className="td-item-n mono">{item.done ? '✓' : String(i + 1).padStart(2, '0')}</i>
                <b>{DRILLS[item.drill].name}</b>
                <span className="td-item-why">{item.label}</span>
                <em className="mono">{Math.round(item.minutes * 60)}s</em>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** One read: a label, a fact, and the action that fact implies. */
function Read({
  label,
  tone,
  onClick,
  children,
}: {
  label: string;
  tone?: 'good' | 'bad';
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`td-read${tone ? ` ${tone}` : ''}${onClick ? '' : ' flat'}`}
      onMouseEnter={onClick ? () => audio.play('uiHover') : undefined}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="eyebrow">{label}</span>
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- helpers */

/** The drill in today's plan that trains an axis hardest. */
const drillForWeakness = (
  axis: keyof typeof AXIS_LABEL,
  planned: DrillId[],
): DrillId | null => {
  let best: DrillId | null = null;
  let weight = 0;
  for (const id of planned) {
    const w = DRILLS[id].axes[axis] ?? 0;
    if (w > weight) {
      weight = w;
      best = id;
    }
  }
  return best;
};

const longDate = (): string =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

const relative = (t: number): string => {
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return 'Last week';
};
