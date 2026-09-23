import { viewTransition } from './motion';

/**
 * The run's front door.
 *
 * Clicking a card used to swap the whole client for a black screen and a
 * countdown. Now the picture you clicked *becomes* the run: it is the one
 * thing on the page the browser follows across the change, so it grows from
 * where it sat on the card to fill the screen and dissolves into the live
 * arena, while the menu around it steps back into the dark.
 *
 * This file only finds the picture and names it for the hand-off. The motion
 * is the View Transitions API (see `.vt-launch` in global.css), and a browser
 * without it — or a player who asked for calm motion — simply starts the run.
 * Presentation only.
 */

let lastTarget: Element | null = null;
let lastAt = 0;

/** Remember what was last pressed, so a run can find the card that started it. */
export const trackLaunches = (): (() => void) => {
  const note = (e: Event) => {
    lastTarget = e.target instanceof Element ? e.target : null;
    lastAt = performance.now();
  };
  window.addEventListener('pointerdown', note, true);
  window.addEventListener('keydown', note, true);
  return () => {
    window.removeEventListener('pointerdown', note, true);
    window.removeEventListener('keydown', note, true);
  };
};

/** The picture on the card that was pressed a moment ago, if a card was. */
const launchPicture = (): HTMLElement | null => {
  if (!lastTarget || performance.now() - lastAt > 800) return null;
  const from = lastTarget === document.body ? document.activeElement : lastTarget;
  const card = from?.closest('.pv, .pr-card, .lab-card, [data-launch]');
  const pic = card?.matches('.pv') ? card : (card?.querySelector('.pv') ?? null);
  if (!(pic instanceof HTMLElement)) return null;
  const r = pic.getBoundingClientRect();
  return r.width >= 40 && r.height >= 30 && r.bottom > 0 && r.top < innerHeight ? pic : null;
};

/**
 * Start a run. From a card, as the card's picture growing into the arena;
 * from anywhere else — the warm-up button, a pasted code — it simply begins.
 */
export const launch = (start: () => void): void => {
  const pic = launchPicture();
  lastTarget = null;
  if (!pic) {
    start();
    return;
  }
  pic.style.setProperty('view-transition-name', 'run');
  viewTransition(start, 'vt-launch');
};
