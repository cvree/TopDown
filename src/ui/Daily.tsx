import { DAILY_SEQUENCE, DRILLS } from '../drills/catalog';
import { AXIS_LABEL } from '../progression/skills';
import { rankFromRating } from '../progression/ranks';
import { trainingPriority, type Profile } from '../progression/profile';
import './daily.css';

interface Props {
  profile: Profile;
  onStart: () => void;
  onBack: () => void;
}

export function Daily({ profile, onStart, onBack }: Props) {
  const done = profile.daily.completed;
  const complete = done.length >= DAILY_SEQUENCE.length;
  const next = DAILY_SEQUENCE.find((d) => !done.includes(d));
  const start = profile.daily.startOverall || profile.overall;
  const gain = profile.overall - start;
  const gainPct = start > 0 ? (gain / start) * 100 : 0;
  const priority = trainingPriority(profile);

  // The axis that moved most across today's runs.
  const today = profile.history.filter((h) => Date.now() - h.t < 86400000);
  const strongest = today.reduce<{ id: string; delta: number } | null>((acc, h) => {
    const d = DRILLS[h.drill];
    const axis = Object.keys(d.axes)[0];
    const contribution = h.performance;
    if (!acc || contribution > acc.delta) return { id: axis, delta: contribution };
    return acc;
  }, null);

  return (
    <div className="scroll">
      <div className="wrap daily fade-up">
        <div className="eyebrow">Daily mechanics</div>
        <h1 className="display daily-h1">
          {complete ? 'DONE FOR TODAY' : 'TODAY’S PROGRAMME'}
        </h1>
        <p className="dim daily-lead">
          Five drills, roughly twelve minutes. The same five every day so the numbers stay comparable —
          that is what makes the trend line mean something.
        </p>

        <div className="daily-list">
          {DAILY_SEQUENCE.map((id, i) => {
            const d = DRILLS[id];
            const isDone = done.includes(id);
            const isNext = id === next;
            return (
              <div className={`dl-row ${isDone ? 'done' : ''} ${isNext ? 'next' : ''}`} key={id}>
                <span className="dl-idx mono">{String(i + 1).padStart(2, '0')}</span>
                <div className="dl-check">{isDone ? '✓' : ''}</div>
                <div className="dl-body">
                  <div className="dl-name display" style={{ color: isDone ? undefined : d.accent }}>
                    {d.name}
                  </div>
                  <div className="dl-brief">{d.brief}</div>
                </div>
                <span className="dl-dur mono">{d.duration > 0 ? `${d.duration}s` : 'to the end'}</span>
              </div>
            );
          })}
        </div>

        <div className="daily-progress">
          <div className="dp-track">
            <span style={{ width: `${(done.length / DAILY_SEQUENCE.length) * 100}%` }} />
          </div>
          <span className="mono faint">
            {done.length} / {DAILY_SEQUENCE.length}
          </span>
        </div>

        {complete && (
          <div className="daily-summary panel pad scale-in">
            <div className="panel-title">Today</div>
            <div className="ds-grid">
              <div>
                <span className="eyebrow">Overall performance</span>
                <b className={gainPct >= 0 ? 'good' : 'bad'}>
                  {gainPct >= 0 ? '+' : ''}
                  {gainPct.toFixed(1)}%
                </b>
              </div>
              <div>
                <span className="eyebrow">Mechanical rating</span>
                <b>
                  {Math.round(start)} <i>→</i> {Math.round(profile.overall)}
                </b>
              </div>
              <div>
                <span className="eyebrow">Rank</span>
                <b>{rankFromRating(profile.overall).label}</b>
              </div>
              <div>
                <span className="eyebrow">Strongest today</span>
                <b className="good">
                  {strongest ? AXIS_LABEL[strongest.id as keyof typeof AXIS_LABEL] ?? '—' : '—'}
                </b>
              </div>
              <div>
                <span className="eyebrow">Tomorrow’s focus</span>
                <b className="warn">{priority ? priority.label : '—'}</b>
              </div>
              <div>
                <span className="eyebrow">Streak</span>
                <b>{profile.daily.streak} days</b>
              </div>
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 12, marginTop: 28 }}>
          {!complete && (
            <button className="btn primary lg" onClick={onStart}>
              {done.length > 0 ? 'Continue programme' : 'Start programme'}
            </button>
          )}
          <button className="btn ghost lg" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
