import { PLAN_LABEL, clockText, type LaneReport } from '../drills/lanereport';
import './lanereport.css';

/**
 * The lane, read back.
 *
 * Three parts, in the order a player asks about a lane they just lost: who
 * got there first, which exchanges cost what and why, and what she was doing
 * with the wave while it happened.
 */
export function LaneReportPanel({ report, visible }: { report: LaneReport; visible: boolean }) {
  const won = report.trades.filter((t) => t.verdict === 'won').length;
  const lost = report.trades.filter((t) => t.verdict === 'lost').length;
  const net = report.trades.reduce((a, t) => a + t.net, 0);
  // The worst few, not all of them: a ten-minute lane can hold thirty trades
  // and the lesson is in the ones that cost the most.
  const worst = [...report.trades].sort((a, b) => a.net - b.net).slice(0, 5).sort((a, b) => a.start - b.start);
  return (
    <div className={`res-lane ${visible ? 'in' : ''}`}>
      <div className="panel pad">
        <div className="panel-title">The lane, read back</div>

        <div className="lr-race">
          {report.levels.map((l) => {
            const gap = l.you !== null && l.her !== null ? Math.round(l.you - l.her) : null;
            const tone = l.you === null ? 'bad' : l.her === null || (gap !== null && gap < 0) ? 'good' : gap === 0 ? '' : 'bad';
            return (
              <div className={`lr-race-cell ${tone}`} key={l.level}>
                <span className="eyebrow">LEVEL {l.level}</span>
                <b className="mono">{l.you === null ? '—' : clockText(l.you)}</b>
                <i className="mono">
                  her {l.her === null ? '—' : clockText(l.her)}
                  {gap !== null && gap !== 0 && ` · you ${gap < 0 ? `${-gap}s first` : `${gap}s late`}`}
                </i>
              </div>
            );
          })}
        </div>

        <div className="lr-sub">
          <b>{report.trades.length}</b> trade{report.trades.length === 1 ? '' : 's'} · <span className="good">{won} won</span> ·{' '}
          <span className="bad">{lost} lost</span> · net{' '}
          <span className={net >= 0 ? 'good' : 'bad'}>
            {net >= 0 ? '+' : ''}
            {net}
          </span>{' '}
          health
          {report.punishes > 0 && (
            <>
              {' '}
              · she punished <b>{report.punishes}</b> of your commits
              {report.punishesOnLastHit > 0 && <>, {report.punishesOnLastHit} of them as you went for a minion</>}
            </>
          )}
        </div>

        {worst.length > 0 && (
          <div className="lr-trades">
            {worst.map((t, i) => (
              <div className={`lr-trade ${t.verdict}`} key={i}>
                <span className="mono lr-t">{clockText(t.start)}</span>
                <span className="lr-who">{t.startedBy === 'you' ? 'YOU STARTED' : 'SHE STARTED'}</span>
                <span className="mono lr-net">
                  {t.net >= 0 ? '+' : ''}
                  {t.net}
                </span>
                <span className="lr-split mono dim">
                  dealt {t.dealt} · took {t.fromHer} from her
                  {t.fromMinions > 0 && `, ${t.fromMinions} from minions`}
                  {t.fromTurret > 0 && `, ${t.fromTurret} from the turret`}
                </span>
                <span className="lr-lesson">{t.lesson}</span>
              </div>
            ))}
          </div>
        )}

        {report.plans.length > 0 && (
          <>
            <div className="panel-title lr-h">What she was doing, and why</div>
            <div className="lr-plans">
              {report.plans.slice(0, 8).map((p, i) => (
                <div className={`lr-plan p-${p.plan}`} key={i}>
                  <span className="mono lr-t">
                    {clockText(p.start)}–{clockText(p.end)}
                  </span>
                  <b>{PLAN_LABEL[p.plan]}</b>
                  <span>{p.why}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
