import { useState, type ReactNode } from 'react';
import { audio } from '../../engine/audio';

/**
 * A closed-by-default disclosure for the prose a screen only needs to say
 * once. Anyone opening this screen for the second time already knows how it
 * works — the explanation is a click away instead of printed in full on
 * every visit.
 */
export function Explainer({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`pr-explain${open ? ' open' : ''}`}>
      <button
        type="button"
        className="pr-explain-toggle"
        aria-expanded={open}
        onMouseEnter={() => audio.play('uiHover')}
        onClick={() => {
          audio.play('uiTab');
          setOpen((o) => !o);
        }}
      >
        <span className="pr-explain-chevron" aria-hidden>
          ▸
        </span>
        {title}
      </button>
      <div className="pr-explain-panel">
        <div className="pr-explain-inner">{children}</div>
      </div>
    </div>
  );
}
