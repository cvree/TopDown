import { useState, type ReactNode } from 'react';
import { audio } from '../../engine/audio';

/**
 * WHY — the one place the client explains itself.
 *
 * Every screen used to print its reasoning in full under every heading, which
 * made the client something you read before you could play it. The reasoning
 * is still all here, word for word; it is simply behind one question mark,
 * the same one everywhere, so a player learns once where the "why" lives and
 * a returning player never has to scroll past it again.
 *
 * Closed by default, and closed again every visit. Opening it drops the words
 * in with a short rise — the height change itself is instant, because a
 * disclosure that animates its height animates the whole page under it.
 */
export function Why({ label = 'Why', children, className }: { label?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`why${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="why-toggle"
        aria-expanded={open}
        onMouseEnter={() => audio.play('uiHover')}
        onClick={() => {
          audio.play(open ? 'uiBack' : 'uiTab');
          setOpen((o) => !o);
        }}
      >
        <span className="why-mark" aria-hidden>
          ?
        </span>
        <span className="why-label">{label}</span>
      </button>
      {open && <div className="why-panel">{children}</div>}
    </div>
  );
}
