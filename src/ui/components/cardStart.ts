import type { MouseEvent } from 'react';

/**
 * Whether a click on a card should start its activity.
 *
 * A card is one big "play this": the picture, the name, the paragraph under
 * it. What does *not* start it is anything on the card that is already a
 * control of its own — the level arrows, SURVIVE, SURGE, the opponent picker,
 * the expander, a link — because those clicks mean what they say. A drag that
 * selected some text is not a click either.
 */
export const cardClickStarts = (e: MouseEvent<HTMLElement>): boolean => {
  if (e.defaultPrevented || e.button !== 0) return false;
  const t = e.target as HTMLElement | null;
  if (t?.closest('button, a, input, select, textarea, label, summary, [role="tab"], [role="button"], [data-no-start]'))
    return false;
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  return !sel || sel.isCollapsed;
};
