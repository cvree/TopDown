import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { audio } from '../engine/audio';
import { shortCodeLabel, type Bindings } from '../engine/input';
import {
  REACTION_META,
  summariseTrials,
  type ReactionRun,
  type ReactionTestId,
} from '../progression/warmup';
import './reaction.css';

/**
 * A reaction test, full screen.
 *
 * Four of them share one machine, because they are one experiment with four
 * cues: wait a random while, show something, time the answer. Everything that
 * makes a reaction test honest lives in the machine rather than in the tests:
 *
 *  - **The wait is random**, 1.2 to 3.4 seconds, so the only way to be fast
 *    is to react. A press during the wait is a false start: the trial is
 *    thrown away, shown, counted and run again.
 *  - **The clock starts when the cue can be seen**, not when the code asked
 *    for it — two animation frames after the change, which is the frame it was
 *    painted on. The tone is timed off the audio clock for the same reason.
 *  - **The headline is a median**, so one trial where you blinked does not
 *    decide the run, and the spread beside it says how steady you were.
 */

type Phase = 'intro' | 'wait' | 'go' | 'shown' | 'early' | 'done';

interface Trial {
  ms: number;
  correct: boolean;
}

const CHOICE_SLOTS = ['q', 'w', 'e', 'r'] as const;

interface Props {
  test: ReactionTestId;
  bindings: Bindings;
  /** Your personal best, for the summary. */
  best: number | null;
  /** Your normal, for the summary. */
  baseline: number | null;
  /** The button that closes a finished test. */
  doneLabel?: string;
  /** Hides AGAIN, for the warm-up's calibration: one measurement, not a game. */
  once?: boolean;
  /** A finished test, to be kept. Called for every run, including SAVE & AGAIN. */
  onRecord: (run: ReactionRun) => void;
  /** Leave. After DONE this follows an onRecord; after Esc it does not. */
  onClose: () => void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function ReactionTest({ test, bindings, best, baseline, doneLabel = 'DONE', once, onRecord, onClose }: Props) {
  const meta = REACTION_META[test];
  const [phase, setPhase] = useState<Phase>('intro');
  const [trials, setTrials] = useState<Trial[]>([]);
  const [falseStarts, setFalseStarts] = useState(0);
  const [last, setLast] = useState<Trial | null>(null);
  const [slot, setSlot] = useState<(typeof CHOICE_SLOTS)[number]>('q');
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  const [muted, setMuted] = useState(false);
  const t0 = useRef(0);
  const timer = useRef(0);
  const raf = useRef(0);
  const phaseRef = useRef<Phase>('intro');
  phaseRef.current = phase;
  const stage = useRef<HTMLDivElement>(null);

  // Your four ability inputs, as you have them bound — which under WASD
  // includes a mouse button, so the choice test answers clicks as well as
  // keys. Either half of a binding counts, as it does in a run.
  const keys = useMemo(
    () =>
      Object.fromEntries(
        CHOICE_SLOTS.map((s) => [s, bindings[s]?.primary || `Key${s.toUpperCase()}`]),
      ) as Record<(typeof CHOICE_SLOTS)[number], string>,
    [bindings],
  );
  const answers = (slotId: (typeof CHOICE_SLOTS)[number], code: string): boolean =>
    code === keys[slotId] || (!!bindings[slotId]?.secondary && code === bindings[slotId]?.secondary);

  const run = useMemo(() => (phase === 'done' ? summariseTrials(trials, falseStarts) : null), [phase, trials, falseStarts]);

  const clear = () => {
    window.clearTimeout(timer.current);
    cancelAnimationFrame(raf.current);
  };
  useEffect(() => clear, []);

  /** Arm one trial: a random wait, then the cue. */
  const arm = useCallback(() => {
    clear();
    setLast(null);
    setTarget(null);
    setPhase('wait');
    timer.current = window.setTimeout(() => {
      if (test === 'audio') {
        const at = audio.reactionCue();
        if (at === null) {
          setMuted(true);
          setPhase('intro');
          return;
        }
        t0.current = at;
        setPhase('go');
        return;
      }
      if (test === 'choice') setSlot(CHOICE_SLOTS[Math.floor(Math.random() * 4)]);
      if (test === 'aim') {
        const r = stage.current?.getBoundingClientRect();
        const w = r?.width ?? 800;
        const h = r?.height ?? 500;
        setTarget({ x: rand(0.1, 0.9) * w, y: rand(0.14, 0.86) * h });
      }
      setPhase('go');
      // The clock starts now, and is moved to the painted frame once there is
      // one: two frames on, the first runs before the change is painted and
      // the second starts on the frame that shows it. A tab that never paints
      // (hidden, throttled) still times the answer rather than ignoring it.
      t0.current = performance.now();
      raf.current = requestAnimationFrame(() => {
        raf.current = requestAnimationFrame((ts) => {
          t0.current = ts;
        });
      });
    }, rand(test === 'aim' ? 500 : 1200, test === 'aim' ? 1300 : 3400));
  }, [test]);

  const record = useCallback(
    (tr: Trial) => {
      clear();
      setLast(tr);
      setPhase('shown');
      const next = [...trials, tr];
      setTrials(next);
      audio.play(tr.correct ? 'uiClick' : 'castRefuse');
      timer.current = window.setTimeout(() => {
        if (next.length >= meta.trials) {
          setPhase('done');
          audio.play('resultsReveal');
        } else arm();
      }, 650);
    },
    [trials, meta.trials, arm],
  );

  const early = useCallback(() => {
    clear();
    setFalseStarts((n) => n + 1);
    setPhase('early');
    audio.play('castRefuse');
    timer.current = window.setTimeout(arm, 900);
  }, [arm]);

  /** Any answer: a key code, or `Mouse0`–`Mouse2` for a button. */
  const answer = useCallback(
    (code: string, at: number, pos?: { x: number; y: number }) => {
      const ph = phaseRef.current;
      if (ph === 'intro') {
        if (code === 'Space' || code === 'Enter' || code === 'Mouse0') arm();
        return;
      }
      if (ph === 'wait') {
        // Clicking around while a target is due is not a false start: the aim
        // test has no single "press" to jump.
        if (test !== 'aim') early();
        return;
      }
      if (ph !== 'go' || t0.current === 0) return;
      const ms = at - t0.current;
      // The tone is scheduled a moment ahead; a press before it sounds is a
      // guess, and a guess is a false start.
      if (ms < 0) {
        if (test !== 'aim') early();
        return;
      }
      if (test === 'choice') {
        record({ ms, correct: answers(slot, code) });
        return;
      }
      if (test === 'aim') {
        if (code !== 'Mouse0' || !pos || !target) return;
        const hit = Math.hypot(pos.x - target.x, pos.y - target.y) <= 30;
        record({ ms, correct: hit });
        return;
      }
      record({ ms, correct: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arm, early, record, test, keys, slot, target, bindings],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        clear();
        onClose();
        return;
      }
      if (phaseRef.current === 'done') return;
      e.preventDefault();
      answer(e.code, performance.now());
    };
    // Capture, so this sees the key before the client's own Escape-opens-setup
    // listener does, and that one sees it already handled.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [answer, onClose]);

  useEffect(() => {
    // Reset the clock between trials so a stale t0 can never time an answer.
    if (phase === 'wait') t0.current = 0;
  }, [phase]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phase === 'done') return;
    const at = performance.now();
    const r = stage.current?.getBoundingClientRect();
    const pos = r ? { x: e.clientX - r.left, y: e.clientY - r.top } : undefined;
    answer(`Mouse${e.button}`, at, pos);
  };

  const lit = phase === 'go' && test === 'visual';
  const shownMs = last ? Math.round(last.ms) : null;

  // Portalled to the body: the screens this opens from animate in with a
  // transform, and a transformed ancestor turns `position: fixed` into
  // "fixed to me" — which drew the test inside the page instead of over it.
  return createPortal(
    <div className="rx" style={{ ['--c' as string]: meta.accent }} role="dialog" aria-label={`${meta.label} reaction test`}>
      <header className="rx-head">
        <div>
          <div className="eyebrow">Reaction test</div>
          <h2 className="display rx-title">{meta.label}</h2>
        </div>
        <div className="rx-count mono">
          {Math.min(trials.length + (phase === 'done' ? 0 : 1), meta.trials)} / {meta.trials}
          {falseStarts > 0 && <span className="rx-fs"> · {falseStarts} early</span>}
        </div>
        <button className="rx-x" type="button" onClick={() => { clear(); onClose(); }} aria-label="Close — Esc">
          ESC
        </button>
      </header>

      <div
        ref={stage}
        className={`rx-stage${lit ? ' lit' : ''}${phase === 'early' ? ' early' : ''}${test === 'aim' ? ' aim' : ''}`}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {phase === 'intro' && (
          <div className="rx-center">
            <p className="rx-ask">{meta.ask}</p>
            <p className="dim rx-why">{meta.why}</p>
            {test === 'choice' && (
              <div className="rx-keys">
                {CHOICE_SLOTS.map((s) => (
                  <kbd key={s} className="rx-key">{shortCodeLabel(keys[s])}</kbd>
                ))}
              </div>
            )}
            {muted && <p className="rx-warn">Sound is muted or unavailable. Unmute in SETUP to take this one.</p>}
            <button className="btn primary rx-start" type="button" onClick={arm}>
              START <span className="mono dim">space</span>
            </button>
          </div>
        )}

        {phase === 'wait' && <div className="rx-center rx-wait">{test === 'audio' ? 'LISTEN' : 'WAIT'}</div>}

        {phase === 'go' && test === 'visual' && <div className="rx-center rx-now">NOW</div>}
        {phase === 'go' && test === 'audio' && <div className="rx-center rx-wait">LISTEN</div>}
        {phase === 'go' && test === 'choice' && (
          <div className="rx-center">
            <div className="rx-keys big">
              {CHOICE_SLOTS.map((s) => (
                <kbd key={s} data-code={keys[s]} className={`rx-key${s === slot ? ' on' : ''}`}>{shortCodeLabel(keys[s])}</kbd>
              ))}
            </div>
          </div>
        )}
        {phase === 'go' && test === 'aim' && target && (
          <i className="rx-target" style={{ left: target.x, top: target.y }} />
        )}

        {phase === 'early' && <div className="rx-center rx-bad">TOO EARLY — AGAIN</div>}

        {phase === 'shown' && last && (
          <div className={`rx-center rx-ms mono${last.correct ? '' : ' bad'}`}>
            {last.correct ? `${shownMs} ms` : test === 'aim' ? 'MISSED' : 'WRONG KEY'}
          </div>
        )}

        {phase === 'done' && run && (
          <div className="rx-center rx-done" onPointerDown={(e) => e.stopPropagation()}>
            <div className="rx-big mono">{Number.isFinite(run.median) ? `${run.median}` : '—'}<small>ms</small></div>
            <div className="rx-sub mono">
              median · ±{Number.isFinite(run.spread) ? run.spread : '—'} ms spread
              {test === 'choice' || test === 'aim' ? ` · ${Math.round(run.accuracy * 100)}% right` : ''}
            </div>
            <div className="rx-cmp">
              {best !== null && Number.isFinite(run.median) && (
                <span className={run.median < best ? 'good' : ''}>
                  {run.median < best ? `NEW BEST — ${best - run.median} ms under ${best}` : `best ${best} ms`}
                </span>
              )}
              {baseline !== null && Number.isFinite(run.median) && (
                <span>
                  your normal {Math.round(baseline)} ms · today {run.median > baseline ? '+' : ''}
                  {Math.round(run.median - baseline)}
                </span>
              )}
            </div>
            <div className="rx-dots" aria-label="Each trial">
              {trials.map((t, i) => (
                <i key={i} className={t.correct ? '' : 'bad'} title={t.correct ? `${Math.round(t.ms)} ms` : 'miss'}>
                  {t.correct ? Math.round(t.ms) : '×'}
                </i>
              ))}
            </div>
            <p className="dim rx-note">
              Includes your screen, browser and mouse. Compare with yourself on this setup, not with anybody else.
            </p>
            <div className="rx-actions">
              {!once && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    onRecord(run);
                    setTrials([]);
                    setFalseStarts(0);
                    arm();
                  }}
                >
                  SAVE &amp; AGAIN
                </button>
              )}
              <button className="btn primary" type="button" onClick={() => {
                  onRecord(run);
                  onClose();
                }}
                autoFocus
              >
                {doneLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
