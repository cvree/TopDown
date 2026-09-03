import { useEffect, useState } from 'react';
import { audio } from '../engine/audio';
import { heroFor, type HeroId } from '../engine/heroes';
import { Crest } from './components/Crest';
import { HeroRoster } from './components/HeroRoster';
import './heroselect.css';

interface Props {
  /** Where the roster opens. */
  initial: HeroId;
  lowFx?: boolean;
  onConfirm: (id: HeroId) => void;
}

/**
 * CHAMPION SELECT — the first thing a new player does here.
 *
 * It runs before calibration, before the client, before anything is measured,
 * and it is the only screen in the app that asks for a decision with no
 * consequences. That is the point: the first interaction should be one you
 * cannot get wrong, it should hand you something that is yours, and it should
 * put a champion on screen at full height so the trainer reads as a game
 * rather than as a form with a title card in front of it.
 *
 * Nothing here is locked, nothing is earned, and the choice is reversible from
 * settings forever — so there is no reason to hedge it behind a tutorial.
 */
export function HeroSelect({ initial, lowFx = false, onConfirm }: Props) {
  const [pick, setPick] = useState<HeroId>(initial);
  const def = heroFor(pick);

  // Enter locks it in, exactly as Enter plays the selected drill on the client.
  // There is deliberately no way past this screen other than choosing: it is
  // the first run, nothing is locked, and every option is a valid answer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      audio.play('gateEnter');
      onConfirm(pick);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick, onConfirm]);

  return (
    <div className="hsel" style={{ ['--c' as string]: def.accent }}>
      <div className="hsel-vignette" />
      <div className="hsel-inner fade-up">
        <header className="hsel-head">
          <Crest size={54} />
          <div>
            <div className="eyebrow">First, who are you</div>
            <h1 className="display hsel-h1">CHAMPION SELECT</h1>
          </div>
          <p className="hsel-lead">
            Pick the body you train in. It is your silhouette in every drill on the ladder — the outline
            you will learn to read your own windup off — and you can change it whenever you like from
            <b> Settings → Champion</b>.
          </p>
        </header>

        <HeroRoster value={pick} onChange={setPick} lowFx={lowFx} />

        <footer className="hsel-foot">
          <span className="hsel-note">
            Nothing here is locked, and nothing here changes your rating.
          </span>
          <button
            className="btn primary lg"
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('gateEnter');
              onConfirm(pick);
            }}
          >
            Lock in {def.name}
            <span className="hsel-key">ENTER</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
