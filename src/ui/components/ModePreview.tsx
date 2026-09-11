import { useEffect, useRef, type RefObject } from 'react';
import type { DrillId } from '../../drills/catalog';
import { PREVIEWS, STAGE_H, STAGE_W, type PreviewScene } from './previews';

/**
 * THE CLIP ON A CARD.
 *
 * A menu card can give a mode a name, a colour and two paragraphs, and a
 * player still does not know what it *looks like* until they have spent a
 * minute finding out. This is the answer to that: every card carries a short
 * loop of its own mode, and resting on it for a moment plays it.
 *
 * Four decisions are worth writing down, because between them they are the
 * difference between a preview that is part of the client and a gif somebody
 * pasted into it:
 *
 *  - **It waits.** Nothing moves the instant a cursor crosses a card. A grid
 *    where every tile bursts into motion as the mouse passes over it is a grid
 *    nobody can read. A clip arms on hover, fills a small ring over
 *    {@link HOLD_MS}, and only then plays — so motion on this screen always
 *    means *this is the one I am looking at*, and the ring makes that rule
 *    visible instead of mysterious.
 *  - **There is no cut.** Playback opens on exactly the frame the still was
 *    taken from, so the first moving frame is the picture that was already
 *    there. Leaving dissolves the moving frame back onto the still over a
 *    fifth of a second.
 *  - **It is drawn on the pixel grid.** The canvas is sized to
 *    `devicePixelRatio` and re-cut whenever the card changes width, and
 *    everything in a clip is vector — there is no bitmap to resample, so a
 *    clip is exactly as sharp as the text beside it at any zoom on any panel.
 *  - **It is free when nobody is watching.** One still frame, painted once,
 *    and not a single frame of animation until somebody asks for one. Six
 *    cards on a screen cost six paints in total, and the one under the cursor
 *    is the only thing that ever holds a `requestAnimationFrame`.
 */

/** How long a cursor has to stay before a clip is what the player wanted. */
const HOLD_MS = 480;
/** The dissolve back to the still frame once the cursor leaves. */
const SETTLE_MS = 220;
/**
 * How long after a clip stops that coming back resumes it instead of making
 * the player wait out the hold again.
 *
 * A cursor crossing the corner of a card on its way somewhere else, or
 * clipping the gap between two tiles, should not cost a second run at the ring
 * — that reads as the menu being sticky. Comfortably longer than the dissolve,
 * because what matters is what the hand did, not whether a frame happened to
 * land in between.
 */
const RESUME_MS = 700;
/** Past this, backing store costs more than the eye collects. */
const MAX_DPR = 3;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Runtime {
  scene?: PreviewScene;
  accent: string;
  /** Card size in CSS pixels. Written by the observer, read by the painter. */
  w: number;
  h: number;
  /** The frame timestamp the clip's first frame carried; 0 until it lands. */
  started: number;
  /** `performance.now()` the cursor left at, or 0 while running. */
  leaving: number;
  raf: number;
  hold: ReturnType<typeof setTimeout> | 0;
  playing: boolean;
  /** `performance.now()` the last playthrough finished dissolving out. */
  stoppedAt: number;
  /** The low-effects setting, read live by the listeners below. */
  still: boolean;
  /** Installed by the painting effect, called by the hover effect. */
  start?: () => void;
  stop?: () => void;
}

export function ModePreview({
  id,
  accent,
  /**
   * The card the clip watches — resting anywhere on it arms the clip, not just
   * on the picture. Defaults to the clip's own frame when a card does not pass
   * one.
   *
   * It is a ref to a DOM node rather than a `hovered` boolean on purpose. A
   * boolean would have to travel up into the card's state, back down as a
   * prop, and only reach this component when React next flushes effects —
   * which is *after paint*, and therefore hostage to whatever else the page is
   * doing. Listening to the element directly means the hold starts on the
   * event, the card never re-renders because a cursor moved, and the clip
   * cannot be left running by a render that arrives late.
   */
  host,
  /**
   * The player has asked for fewer effects, so the card gets the still frame
   * and nothing else. A preview is a nicety; a setting is a promise.
   */
  still = false,
  label,
}: {
  id: DrillId;
  accent: string;
  host?: RefObject<HTMLElement | null>;
  still?: boolean;
  label?: string;
}) {
  const scene = PREVIEWS[id];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  // Everything the loop touches lives here, so React state never changes at
  // sixty hertz and a card never re-renders while its clip is running.
  const run = useRef<Runtime>({
    accent,
    w: 0,
    h: 0,
    started: 0,
    leaving: 0,
    raf: 0,
    hold: 0,
    playing: false,
    stoppedAt: 0,
    still,
  }).current;
  run.scene = scene;
  run.accent = accent;
  run.still = still;

  // ---------------------------------------------------------------- painting
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root || !scene) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // The dissolve needs the moving frame as one image rather than as a
    // sequence of paints: the painters set their own alphas internally, so
    // laying them straight onto the still frame at a reduced alpha would fade
    // the floor and leave the sparks at full strength. Compositing a finished
    // frame is the only way the crossfade is of the *picture*.
    let off: HTMLCanvasElement | null = null;

    const draw = (t: number, mix: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const pw = Math.max(1, Math.round(run.w * dpr));
      const ph = Math.max(1, Math.round(run.h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      // Fit the stage to the card's HEIGHT whenever the card is wider than
      // 16:9, and hand the painter the extra width as `bleed`. Covering the
      // width instead would zoom a wide band until the champion was twice the
      // size she is on every other card and the top and bottom of the picture
      // were off the edge — which is exactly what a wide lane strip did. A
      // card narrower than 16:9 is fitted to its width instead and loses a
      // little off the top and bottom, which is the one crop that costs
      // nothing: every clip keeps its action off the edges.
      const wide = run.w / run.h >= STAGE_W / STAGE_H;
      const scale = (wide ? run.h / STAGE_H : run.w / STAGE_W) * dpr;
      const bleed = wide ? (pw / scale - STAGE_W) / 2 : 0;
      const ox = (pw - STAGE_W * scale) / 2;
      const oy = (ph - STAGE_H * scale) / 2;

      const paint = (into: CanvasRenderingContext2D, time: number) => {
        into.save();
        into.setTransform(scale, 0, 0, scale, ox, oy);
        into.beginPath();
        into.rect(-bleed, 0, STAGE_W + bleed * 2, STAGE_H);
        into.clip();
        scene.paint({
          ctx: into,
          t: time,
          u: time / scene.length,
          accent: run.accent,
          bleed,
        });
        into.restore();
      };

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;

      if (mix >= 0.999) {
        paint(ctx, t);
        return;
      }

      paint(ctx, scene.poster * scene.length);
      if (mix <= 0.001) return;

      if (!off) off = document.createElement('canvas');
      if (off.width !== pw || off.height !== ph) {
        off.width = pw;
        off.height = ph;
      }
      const octx = off.getContext('2d');
      if (!octx) return;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, pw, ph);
      paint(octx, t);
      ctx.globalAlpha = mix;
      ctx.drawImage(off, 0, 0);
      ctx.globalAlpha = 1;
    };

    const poster = () => draw(0, 0);

    /**
     * One frame.
     *
     * Two clocks, and they are never mixed. The clip's own time comes from the
     * frame timestamp `requestAnimationFrame` hands in, because that is the
     * moment the frame will actually be shown and is what makes motion read as
     * even; `run.started` is therefore seeded from the first frame rather than
     * from the call that asked for it. The dissolve runs on `performance.now()`
     * instead, because it is started by a pointer leaving — an event, with no
     * frame timestamp to hand. The two are nominally the same timebase and in
     * practice are not: a browser is free to hand a callback the timestamp of
     * the frame it predicts, which can sit well ahead of the wall clock. Mixing
     * them made a clip that had been left 60ms ago look 300ms gone, so it
     * finished dissolving before the cursor could come back.
     */
    const tick = (now: number) => {
      if (!run.started) run.started = now;
      const t = (scene.poster * scene.length + (now - run.started) / 1000) % scene.length;
      let mix = 1;
      if (run.leaving) {
        const wall = performance.now();
        mix = 1 - Math.min(1, (wall - run.leaving) / SETTLE_MS);
        if (mix <= 0) {
          run.playing = false;
          run.leaving = 0;
          run.stoppedAt = wall;
          run.raf = 0;
          root.classList.remove('is-live');
          poster();
          return;
        }
      }
      draw(t, mix);
      barRef.current?.style.setProperty('--p', String(t / scene.length));
      run.raf = requestAnimationFrame(tick);
    };

    run.start = () => {
      run.leaving = 0;
      run.stoppedAt = 0;
      if (run.playing) return;
      run.playing = true;
      root.classList.add('is-live');
      run.started = 0;
      run.raf = requestAnimationFrame(tick);
    };
    run.stop = () => {
      if (run.playing && !run.leaving) run.leaving = performance.now();
    };

    // A card that changes width mid-clip must not go soft: the backing store
    // is re-cut from the new size on the very next frame.
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width <= 0) return;
      run.w = box.width;
      run.h = box.height;
      if (!run.playing) poster();
    });
    ro.observe(root);
    run.w = root.clientWidth;
    run.h = root.clientHeight;
    poster();

    // Painted again once webfonts land: two of the clips put a mono label on
    // the floor, and a label in the fallback face is the one thing on this
    // screen that would look unfinished.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    void fonts?.ready?.then(() => {
      if (!run.playing) poster();
    });

    return () => {
      ro.disconnect();
      if (run.raf) cancelAnimationFrame(run.raf);
      run.raf = 0;
      run.playing = false;
      run.leaving = 0;
      run.start = undefined;
      run.stop = undefined;
      off = null;
    };
    // Rebuilt when the mode changes and only then — `accent` is read live out
    // of the runtime, so recolouring never restarts a running clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ------------------------------------------------------------------ arming
  useEffect(() => {
    const root = rootRef.current;
    const watched = host?.current ?? root;
    if (!root || !watched || !scene) return;

    const disarm = () => {
      clearTimeout(run.hold as ReturnType<typeof setTimeout>);
      run.hold = 0;
      root.classList.remove('is-arming');
      run.stop?.();
    };

    const arm = () => {
      if (run.still || reducedMotion()) return;
      // Back on a clip that is still running, or has only just stopped, picks
      // it up rather than starting it over — clipping the corner of a card on
      // the way past should not cost a second wait at the ring.
      if (run.playing || (run.stoppedAt > 0 && performance.now() - run.stoppedAt < RESUME_MS)) {
        run.start?.();
        return;
      }
      if (run.hold) return;
      root.classList.add('is-arming');
      run.hold = setTimeout(() => {
        run.hold = 0;
        root.classList.remove('is-arming');
        run.start?.();
      }, HOLD_MS);
    };

    // A keyboard player is looking at this card as squarely as a mouse one,
    // and focusout only counts when focus has actually left the card.
    const onFocusOut = (e: FocusEvent) => {
      if (!watched.contains(e.relatedTarget as Node | null)) disarm();
    };

    watched.addEventListener('pointerenter', arm);
    watched.addEventListener('pointerleave', disarm);
    watched.addEventListener('pointercancel', disarm);
    watched.addEventListener('focusin', arm);
    watched.addEventListener('focusout', onFocusOut);
    return () => {
      watched.removeEventListener('pointerenter', arm);
      watched.removeEventListener('pointerleave', disarm);
      watched.removeEventListener('pointercancel', disarm);
      watched.removeEventListener('focusin', arm);
      watched.removeEventListener('focusout', onFocusOut);
      disarm();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, host]);

  // Turning low effects on mid-hover stops whatever is running now, rather
  // than at the next time the cursor happens to move.
  useEffect(() => {
    if (still) {
      clearTimeout(run.hold as ReturnType<typeof setTimeout>);
      run.hold = 0;
      rootRef.current?.classList.remove('is-arming');
      run.stop?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still]);

  if (!scene) return null;

  return (
    <div
      className="pv"
      ref={rootRef}
      // The ring is filled by a CSS animation and the wait by a timer here, so
      // the two read the same number rather than each keeping their own.
      style={{ ['--c' as string]: accent, ['--hold' as string]: `${HOLD_MS}ms` }}
      data-mode={id}
    >
      <canvas className="pv-canvas" ref={canvasRef} aria-hidden />
      <span className="pv-edge" aria-hidden />
      {/* The ring that fills while a clip is arming: the entire explanation of
          why nothing has moved yet, and the only instruction it needs. */}
      <svg className="pv-hold" viewBox="0 0 24 24" aria-hidden>
        <circle className="pv-hold-track" cx="12" cy="12" r="9" />
        <circle className="pv-hold-fill" cx="12" cy="12" r="9" />
        <path className="pv-hold-play" d="M10.2 8.2 L16 12 L10.2 15.8 Z" />
      </svg>
      <i className="pv-bar" ref={barRef} aria-hidden />
      <span className="pv-cap">{label ?? scene.caption}</span>
    </div>
  );
}
