import { useCallback, useEffect, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { Crest } from './components/Crest';
import './boot.css';

/**
 * The cold open.
 *
 * A trainer that drops you straight onto a grid of cards is a web page. A
 * trainer that makes you wait eight seconds in the dark while something is
 * clearly being built, and then asks you to press a key to enter, is a game.
 * The difference is entirely theatre, and it is worth every one of those
 * seconds — everything after it is read as part of a product with weight.
 *
 * It is also load-bearing in two literal ways:
 *
 *  - The arena behind the menus generates its terrain, its noise-painted
 *    surfaces and its shaders on the main thread at startup. That work has to
 *    happen somewhere. Doing it behind a title card means the first thing the
 *    player ever sees is finished rather than half-built.
 *  - Browsers refuse to start an AudioContext without a gesture. The
 *    "press any key" gate is that gesture, so the swell that carries you into
 *    the client is the first sound the app is *allowed* to make — which is
 *    why the whole cold open is deliberately silent up to that point.
 */

type Stage = 'dark' | 'strike' | 'load' | 'gate' | 'enter';

const PHASES = [
  'GENERATING TERRAIN',
  'PAINTING SURFACES',
  'FORGING CHAMPIONS',
  'COMPILING SHADERS',
  'WARMING THE RIFT',
];

interface Props {
  /** True once the arena behind the client has rendered its first frame. */
  ready: boolean;
  onEnter: () => void;
}

export function Boot({ ready, onEnter }: Props) {
  const [stage, setStage] = useState<Stage>('dark');
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState(0);
  // A hard ceiling on the wait. If the arena is slow — a software renderer,
  // a throttled tab, an integrated GPU under load — the player still gets
  // into the client; the backdrop simply finishes arriving behind them.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), 9000);
    return () => window.clearTimeout(t);
  }, []);
  const readyRef = useRef(ready || timedOut);
  readyRef.current = ready || timedOut;
  const enteredRef = useRef(false);

  // ------------------------------------------------------------ stage clock
  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStage('strike'), 340),
      window.setTimeout(() => setStage('load'), 1450),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, []);

  // ---------------------------------------------------------------- loading
  //
  // The bar is honest about the parts it can see and generous about the rest:
  // it climbs to 88% on its own schedule and only crosses the line once the
  // arena has actually put a frame on screen. A bar that hits 100% and then
  // sits there is worse than no bar at all.
  useEffect(() => {
    if (stage !== 'load') return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const cap = readyRef.current ? 1 : 0.88;
      // Ease out, so the early phases fly by and the last stretch has weight.
      const p = Math.min(cap, 1 - Math.pow(2, -t * 1.55));
      setProgress(p);
      setPhase(Math.min(PHASES.length - 1, Math.floor(p * PHASES.length)));
      if (p >= 0.999 && t > 1.9) {
        setStage('gate');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage]);

  // ------------------------------------------------------------------ gate
  const enter = useCallback(() => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    // The gesture that buys us an AudioContext. Everything the app will ever
    // play is downstream of this one call.
    audio.unlock();
    audio.play('gateEnter');
    setStage('enter');
    window.setTimeout(onEnter, 1150);
  }, [onEnter]);

  useEffect(() => {
    if (stage !== 'gate') return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      enter();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', enter);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', enter);
    };
  }, [stage, enter]);

  const struck = stage !== 'dark';

  return (
    <div className={`boot boot-${stage}`} role="presentation">
      <div className="boot-vignette" />

      <div className="boot-core">
        <div className={`boot-crest${struck ? ' in' : ''}`}>
          <Crest size={168} spin={struck} />
        </div>

        <div className={`boot-word${struck ? ' in' : ''}`}>
          <span className="boot-rule left" />
          <h1 className="boot-title foil">APEX</h1>
          <span className="boot-rule right" />
        </div>

        <div className={`boot-sub${struck ? ' in' : ''}`}>MECHANICS TRAINER · THE RIFT, IN MINIATURE</div>
      </div>

      <div className={`boot-foot${stage === 'load' || stage === 'gate' ? ' in' : ''}`}>
        {stage === 'gate' ? (
          <div className="boot-gate">
            <div className="boot-gate-key">PRESS ANY KEY</div>
            <div className="boot-gate-sub">to enter the arena</div>
          </div>
        ) : (
          <>
            <div className="boot-phase mono">{PHASES[phase]}</div>
            <div className="boot-bar">
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
            <div className="boot-pct mono">{String(Math.floor(progress * 100)).padStart(3, '0')}%</div>
          </>
        )}
      </div>

      <div className="boot-flash" />
    </div>
  );
}
