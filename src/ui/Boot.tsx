import { useCallback, useEffect, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { VERSION } from '../patchnotes/notes';
import { Crest } from './components/Crest';
import { BootClock } from './boot/clock';
import { MILESTONES, castBoot, type Milestone } from './boot/variants';
import './boot.css';

/**
 * The cold open.
 *
 * A trainer that drops you straight onto a grid of cards is a web page. A
 * trainer that makes you wait in the dark while something is clearly being
 * built, and then asks you to press a key to enter, is a game. The difference
 * is entirely theatre, and it is worth every one of those seconds —
 * everything after it is read as part of a product with weight.
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
 *
 * Three things make it bearable on the two-hundredth load rather than only
 * the first:
 *
 *  - **It is never quite the same screen.** One of six shows is cast per load
 *    (`boot/variants.ts`) — a different weather system, a different way the
 *    wordmark arrives, a different way the card leaves — over an identity
 *    that never moves.
 *  - **The bar is never stuck.** It is driven by a model that eases toward
 *    real milestones and keeps creeping when one of them overstays
 *    (`boot/clock.ts`), and it is *drawn* by handing the compositor a target
 *    a second into the future, so it keeps moving through the main-thread
 *    stalls that building an arena causes.
 *  - **You can leave early.** Pressing anything during the load arms the
 *    entry; the client opens the instant it is ready, without asking again.
 */

/**
 * What the screen is doing, as far as React is concerned.
 *
 * Three, not five. The old sequence had a state per beat of the title
 * sequence, driven by `setTimeout`, which is fine right up until the main
 * thread is blocked for five seconds building an arena — at which point every
 * beat fires in the same frame and the cold open plays as a single cut. The
 * beats now live in CSS as animation delays (`--t-strike`, `--t-load`) and
 * play on the compositor whatever the main thread is doing; the only states
 * left here are the two that genuinely depend on knowing something.
 */
type Act = 'intro' | 'gate' | 'enter';

const LETTERS = ['A', 'P', 'E', 'X'];

/**
 * How far ahead of itself the bar is drawn.
 *
 * The fill is a CSS transition, not a per-frame write: every tick sets the
 * value the model says it will hold a second from now and lets the compositor
 * walk there. When the main thread vanishes for 400ms compiling shaders, the
 * bar carries on at the right speed on the other thread, and the next tick
 * re-aims it from wherever it actually reached. Without this, the bar freezes
 * exactly when the machine is working hardest, which is the one moment a
 * player reads as a crash.
 */
const LOOKAHEAD = 0.9;

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

interface Props {
  /**
   * The furthest the arena has got. Milestones are cumulative and the clock
   * treats them that way, so a backdrop that can only report its last one
   * still drives the bar correctly.
   */
  stage: Milestone;
  onEnter: () => void;
}

export function Boot({ stage, onEnter }: Props) {
  // Cast once, on mount. There is exactly one boot screen alive per load, so
  // this is the only render of it that matters.
  const [cast] = useState(castBoot);
  const [calm] = useState(reducedMotion);
  const { show, exit, epigraph, motes, spin } = cast;
  // Somebody who has asked for less motion has not asked for less product,
  // but they have certainly not asked for nine seconds of it.
  const pacing = calm
    ? { strikeAt: 0.05, loadAt: 0.12, minShow: 0.7, maxWait: 6 }
    : cast.pacing;

  const [act, setAct] = useState<Act>('intro');
  /** The row of the manifest currently in flight. State, because it is rare. */
  const [level, setLevel] = useState(0);
  /** Somebody pressed a key before the gate opened. We owe them a fast door. */
  const [armed, setArmed] = useState(false);

  const [clock] = useState(() => new BootClock(performance.now(), pacing.loadAt + pacing.minShow));
  const fillRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const enteredRef = useRef(false);
  const armedRef = useRef(false);
  const actRef = useRef<Act>('intro');
  actRef.current = act;

  // ------------------------------------------------------------ the doorway
  const enter = useCallback(() => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    // The gesture that buys us an AudioContext. Everything the app will ever
    // play is downstream of this one call.
    audio.unlock();
    audio.play('gateEnter');
    setAct('enter');
    window.setTimeout(onEnter, calm ? 260 : 1150);
  }, [onEnter, calm]);

  // ----------------------------------------------------------- the ceiling
  //
  // The only timer left in the cold open, and the only one that could not be
  // a CSS delay: a software renderer, a throttled tab or an integrated GPU
  // under load must not be able to hold anybody on this screen. Past this the
  // player is let in and the backdrop finishes arriving behind them.
  useEffect(() => {
    const t = window.setTimeout(() => clock.giveUp(performance.now()), pacing.maxWait * 1000);
    return () => window.clearTimeout(t);
  }, [clock, pacing.maxWait]);

  // --------------------------------------------------------- real milestones
  useEffect(() => {
    clock.mark(stage, performance.now());
  }, [clock, stage]);

  // ---------------------------------------------------------------- the bar
  //
  // One rAF loop for the whole screen, writing to the DOM directly. It could
  // have been a `setState` per frame, and on the machines this screen exists
  // to protect — the ones where the arena takes six seconds — a full React
  // render of two dozen motes sixty times a second is a cost the loading
  // screen has no business adding to the load.
  useEffect(() => {
    let raf = 0;
    let shownLevel = -1;
    let shownPct = -1;
    const tick = () => {
      const now = performance.now();
      const r = clock.tick(now);

      const fill = fillRef.current;
      if (fill) {
        fill.style.transitionDuration = `${LOOKAHEAD}s`;
        fill.style.transform = `scaleX(${clock.projected(now, LOOKAHEAD).toFixed(4)})`;
      }
      if (r.pct !== shownPct) {
        shownPct = r.pct;
        if (pctRef.current) pctRef.current.textContent = String(r.pct).padStart(3, '0');
        barRef.current?.setAttribute('aria-valuenow', String(r.pct));
      }
      if (clockRef.current) clockRef.current.textContent = `${r.elapsed.toFixed(1)}s`;
      if (r.level !== shownLevel) {
        shownLevel = r.level;
        setLevel(r.level);
      }

      if (r.done) {
        // Armed early? Then the gate was answered before it was asked.
        if (armedRef.current) enter();
        else if (actRef.current === 'intro') setAct('gate');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock, enter]);

  // ------------------------------------------------------------------ input
  //
  // One handler for the whole cold open. Before the bar is full a keypress
  // arms the entry and is answered the moment the arena lands; after it, it
  // opens the door. Either way the player never presses a key and gets
  // nothing, which is the failure mode a "press any key" screen has to avoid
  // above all others.
  useEffect(() => {
    if (act === 'enter') return;
    const answer = () => {
      if (actRef.current === 'gate') enter();
      else if (!armedRef.current) {
        armedRef.current = true;
        setArmed(true);
        // A real gesture, so the audio context can be started here rather
        // than a second later — the swell on entry then has no warm-up.
        audio.unlock();
      }
    };
    const key = (e: KeyboardEvent) => {
      // "Any key" means any key the player meant as an answer. Reload, the
      // dev tools, tabbing away and the browser's own shortcuts are not
      // answers, and swallowing F5 on a screen somebody is trying to reload
      // because it looks stuck would be a cruel joke.
      if (e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^F\d{1,2}$/.test(e.key)) return;
      e.preventDefault();
      answer();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', answer);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', answer);
    };
  }, [act, enter]);

  return (
    <div
      className={`boot boot-${act} m-${show.motif} f-${show.field} r-${show.reveal} x-${exit} ${
        spin > 0 ? 'spin-cw' : 'spin-ccw'
      }${calm ? ' calm' : ''}`}
      style={{
        ['--tint' as string]: show.tint,
        // The two beats of the title sequence, handed to CSS. See boot.css.
        ['--t-strike' as string]: `${pacing.strikeAt}s`,
        ['--t-load' as string]: `${pacing.loadAt}s`,
      }}
      role="presentation"
    >
      <div className="boot-ground" />
      <div className="boot-field" aria-hidden />

      <div className="boot-motes" aria-hidden>
        {motes.map((m) => (
          <span
            key={m.key}
            className="boot-mote"
            style={{
              left: `${m.x}%`,
              top: `${m.y}%`,
              width: m.size,
              height: m.size,
              animationDelay: `${m.delay.toFixed(2)}s`,
              animationDuration: `${m.duration.toFixed(2)}s`,
              ['--drift' as string]: `${m.drift}px`,
            }}
          />
        ))}
      </div>

      {/* The cut-metal frame the rest of the client is built out of, drawn
          around the very first screen so the two read as one product. */}
      <div className="boot-brackets" aria-hidden>
        <i className="brk tl" />
        <i className="brk tr" />
        <i className="brk bl" />
        <i className="brk br" />
      </div>
      <div className="boot-slug tl mono">MECHANICS TRAINER</div>
      {/* Which show you drew. Players compare these; that is the point. */}
      <div className="boot-slug tr mono">
        {show.id} · {show.name}
      </div>

      <div className="boot-core">
        <div className="boot-crest">
          <Crest size={168} spin />
        </div>

        <div className="boot-word">
          <span className="boot-rule left" />
          <h1 className="boot-title foil">
            {LETTERS.map((c, i) => (
              <span key={c} style={{ ['--i' as string]: String(i) }}>
                {c}
              </span>
            ))}
          </h1>
          <span className="boot-rule right" />
        </div>

        <div className="boot-sub">
          THE RIFT, IN MINIATURE
          {/* The build, on the first screen anyone ever sees. It is the one
              piece of information a bug report always needs. */}
          <span className="boot-ver mono">v{VERSION}</span>
        </div>
      </div>

      {/* --------------------------------------------------------- manifest */}
      {/* Four rows, three of them real signals from the arena, each stamped
          with the time it actually took. A loading screen that shows its
          working is a loading screen nobody suspects of having hung. */}
      <div className="boot-manifest" aria-hidden>
        {show.phases.map((label, i) => {
          const doneRow = i <= level;
          const active = i === level + 1;
          const at = clock.marks[i];
          return (
            <div key={label} className={`boot-row${doneRow ? ' done' : active ? ' active' : ''}`}>
              <i className="boot-tick" />
              <span className="boot-row-label">{label}</span>
              <span className="boot-row-at mono">{doneRow && at !== null ? `${at.toFixed(2)}s` : ''}</span>
            </div>
          );
        })}
      </div>

      <div className="boot-foot">
        {act === 'gate' ? (
          <div className="boot-gate">
            <div className="boot-gate-key">PRESS ANY KEY</div>
            <div className="boot-gate-sub">{show.gateLine}</div>
          </div>
        ) : (
          <>
            <div className="boot-phase mono">
              {armed ? 'ENTRY ARMED' : MILESTONES[Math.min(level + 1, MILESTONES.length - 1)] === 'frame' ? 'FINISHING' : 'LOADING'}
              <i className="boot-caret" />
            </div>
            <div className="boot-bar" ref={barRef} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-label="Loading APEX">
              <span ref={fillRef} />
              <i className="boot-bar-glint" aria-hidden />
            </div>
            {/* The number is written straight to the DOM by the frame loop,
                so the per-cent sign lives in its own node rather than being
                re-concatenated sixty times a second. */}
            <div className="boot-pct mono">
              <span ref={pctRef}>000</span>%
            </div>
          </>
        )}
      </div>

      {/* One true, useful sentence to read while you wait. Never flavour. */}
      <div className="boot-epi">
        <span className="boot-epi-tag">WHILE YOU WAIT</span>
        <p>{epigraph}</p>
        <span className="boot-epi-clock mono" ref={clockRef} aria-hidden>
          0.0s
        </span>
      </div>

      <div className="boot-flash" />
      <div className="boot-seam" aria-hidden />
    </div>
  );
}
