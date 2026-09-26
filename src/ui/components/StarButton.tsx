import { audio } from '../../engine/audio';

/**
 * ONE STAR, ON ONE CARD.
 *
 * The same button on every activity in the client — a drill, a mode, the
 * lane — so starring one is always the same gesture wherever it is found. It
 * is a `<button>`, which is what {@link cardClickStarts} already excludes
 * from "the rest of this card starts the run", so it never fires a run by
 * accident and a run never toggles it by accident either.
 */
export function StarButton({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`pr-star${on ? ' on' : ''}`}
      title={on ? `Unstar ${label}` : `Star ${label} — add it to FAVORITES`}
      aria-label={on ? `Unstar ${label}` : `Star ${label}`}
      aria-pressed={on}
      onMouseEnter={() => audio.play('uiHover')}
      onClick={(e) => {
        e.stopPropagation();
        audio.play('uiTab');
        onToggle();
      }}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
