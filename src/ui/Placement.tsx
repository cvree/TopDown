import { useEffect, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, PLACEMENT_SEQUENCE } from '../drills/catalog';
import { rankFromRating, type RankInfo } from '../progression/ranks';
import { AXIS_LABEL, type SkillAxis } from '../progression/skills';
import { RankEmblem } from './components/RankEmblem';
import './placement.css';

export function PlacementIntro({ onBegin, onCancel }: { onBegin: () => void; onCancel: () => void }) {
  return (
    <div className="place-intro scroll">
      <div className="pi-inner fade-up">
        <div className="eyebrow">Calibration</div>
        <h1 className="display">READ YOUR MECHANICS</h1>
        <p className="pi-lead">
          Five short drills, about four minutes. Each one measures something different, and together they
          place you on the ladder. Play them the way you would play a real game — the reading is only
          useful if it is honest.
        </p>

        <div className="pi-steps">
          {PLACEMENT_SEQUENCE.map((id, i) => {
            const d = DRILLS[id];
            return (
              <div className="pi-step" key={id} style={{ animationDelay: `${i * 70}ms` }}>
                <span className="pi-num mono">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <div className="pi-name display" style={{ color: d.accent }}>
                    {d.name}
                  </div>
                  <div className="pi-desc">{d.brief}</div>
                </div>
                <span className="pi-dur mono">{d.duration > 0 ? `${d.duration}s` : 'to the end'}</span>
              </div>
            );
          })}
        </div>

        <div className="pi-note">
          Difficulty adapts as you go. A drill that felt easy will come back harder, and the placement
          accounts for the level you actually played at.
        </div>

        <div className="row" style={{ gap: 12, marginTop: 30 }}>
          <button
            className="btn primary lg"
            onClick={() => {
              audio.unlock();
              audio.play('uiClick');
              onBegin();
            }}
          >
            Start calibration
          </button>
          <button className="btn ghost lg" onClick={onCancel}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

const ANALYSIS_LINES = [
  'Movement precision detected.',
  'Reaction consistency measured.',
  'Attack timing calibrated.',
  'Spacing discipline sampled.',
  'Combat profile complete.',
];

interface RevealProps {
  rank: RankInfo;
  rating: number;
  axes: { axis: SkillAxis; rating: number }[];
  onDone: () => void;
}

/**
 * The placement reveal. The analysis lines are not decoration — each one
 * corresponds to a drill that was actually measured, in the order it ran.
 */
export function PlacementReveal({ rank, rating, axes, onDone }: RevealProps) {
  const [line, setLine] = useState(0);
  const [phase, setPhase] = useState<'analysis' | 'reveal' | 'detail'>('analysis');

  useEffect(() => {
    const timers: number[] = [];
    ANALYSIS_LINES.forEach((_, i) => {
      timers.push(
        window.setTimeout(() => {
          setLine(i + 1);
          audio.play('tick');
        }, 420 + i * 520),
      );
    });
    timers.push(
      window.setTimeout(() => {
        setPhase('reveal');
        audio.play('rankUpBuild');
      }, 420 + ANALYSIS_LINES.length * 520 + 350),
    );
    timers.push(
      window.setTimeout(() => {
        audio.play('rankUpHit');
      }, 420 + ANALYSIS_LINES.length * 520 + 1900),
    );
    timers.push(
      window.setTimeout(() => setPhase('detail'), 420 + ANALYSIS_LINES.length * 520 + 2700),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className={`place-reveal ph-${phase}`}>
      <div className="pr-analysis">
        <div className="eyebrow" style={{ marginBottom: 22 }}>
          Analysing mechanics
        </div>
        {ANALYSIS_LINES.map((l, i) => (
          <div className={`pr-line ${i < line ? 'on' : ''}`} key={l}>
            <span className="pr-tick">✓</span>
            {l}
          </div>
        ))}
      </div>

      <div className="pr-result">
        <div className="pr-glow" />
        <div className="eyebrow" style={{ letterSpacing: '0.42em' }}>
          Your mechanical rank
        </div>
        <div className="pr-emblem">
          <RankEmblem tier={rank.tier} size={196} animated />
        </div>
        <div className="pr-tier display">{rank.label}</div>
        <div className="pr-rating mono">{Math.round(rating)} rating</div>

        <div className="pr-axes">
          {axes.map((a, i) => (
            <div className="pr-axis" key={a.axis} style={{ transitionDelay: `${i * 70}ms` }}>
              <span>{AXIS_LABEL[a.axis]}</span>
              <b>{rankFromRating(a.rating).label}</b>
            </div>
          ))}
        </div>

        <p className="pr-note">
          This is a <b>trainer</b> rank: it describes how you execute these mechanics, not your League
          ranked tier. Rank moves on measured performance, not on time spent.
        </p>

        <button className="btn primary lg pr-continue" onClick={onDone}>
          Enter the trainer
        </button>
      </div>
    </div>
  );
}
