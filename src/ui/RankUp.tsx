import { useEffect, useState } from 'react';
import { audio } from '../engine/audio';
import { RANK_COLORS } from '../engine/palette';
import { AXIS_LABEL, type SkillAxis } from '../progression/skills';
import type { RankInfo } from '../progression/ranks';
import { RankEmblem } from './components/RankEmblem';
import './rankup.css';

interface Props {
  from: RankInfo;
  to: RankInfo;
  /** The axis that moved most, and by how much. */
  driver: { axis: SkillAxis; delta: number } | null;
  headline?: { label: string; value: string } | null;
  onDone: () => void;
}

/**
 * The promotion moment.
 *
 * Restraint is the whole design: the arena freezes, the light drains out of
 * the frame, and one object arrives. No coins, no confetti — the feeling
 * should be that something was certified, not that a slot machine paid out.
 */
export function RankUp({ from, to, driver, headline, onDone }: Props) {
  const [stage, setStage] = useState(0);
  const colors = RANK_COLORS[to.tier];
  const demotion = to.tierIndex < from.tierIndex || (to.tierIndex === from.tierIndex && to.division > from.division);

  useEffect(() => {
    audio.play('rankUpBuild');
    const t = [
      window.setTimeout(() => setStage(1), 260),
      window.setTimeout(() => setStage(2), 1500),
      window.setTimeout(() => {
        setStage(3);
        audio.play('rankUpHit');
      }, 1720),
      window.setTimeout(() => setStage(4), 2500),
      window.setTimeout(() => setStage(5), 3200),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  return (
    <div
      className={`rankup stage-${stage} ${demotion ? 'demote' : ''}`}
      style={
        {
          '--rk': colors.base,
          '--rk-glow': colors.glow,
        } as React.CSSProperties
      }
      onClick={() => stage >= 4 && onDone()}
    >
      <div className="ru-vignette" />
      <div className="ru-line" />
      <div className="ru-rays" />

      <div className="ru-stack">
        <div className="ru-eyebrow">{demotion ? 'RANK ADJUSTED' : 'RANK ACHIEVED'}</div>

        <div className="ru-emblem">
          <RankEmblem tier={to.tier} size={190} animated={stage >= 3} />
        </div>

        <div className="ru-tier display">{to.label}</div>
        <div className="ru-from">
          from <b>{from.label}</b>
        </div>

        <div className="ru-details">
          {driver && (
            <div className="ru-detail">
              <span className="faint">Improved most</span>
              <b>{AXIS_LABEL[driver.axis]}</b>
              <span className={driver.delta >= 0 ? 'good' : 'bad'}>
                {driver.delta >= 0 ? '+' : ''}
                {Math.round(driver.delta)} rating
              </span>
            </div>
          )}
          {headline && (
            <div className="ru-detail">
              <span className="faint">{headline.label}</span>
              <b>{headline.value}</b>
            </div>
          )}
          <div className="ru-note">
            This is your <b>trainer</b> mechanical rank — a measure of these drills, not a prediction of your League rank.
          </div>
        </div>

        <button className="btn primary lg ru-continue" onClick={onDone}>
          Continue
        </button>
      </div>
    </div>
  );
}
