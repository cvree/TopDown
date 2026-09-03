import { useEffect, useState } from 'react';
import { audio } from '../engine/audio';
import { PATCH_NOTES, TAG_LABEL, VERSION, type PatchTag } from '../patchnotes/notes';
import { Crest } from './components/Crest';
import './patchnotes.css';

interface Props {
  /** The newest version this player has already read, if any. */
  seen: string | null;
  /** Fires once, after the first paint: arriving here is what marks them read. */
  onRead: () => void;
  onBack: () => void;
}

const TAG_ORDER: PatchTag[] = ['added', 'changed', 'fixed'];

const formatDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

/**
 * PATCH NOTES.
 *
 * A trainer that changes what your inputs do, and then changes what your
 * scores mean, owes you a written account of both. So this is not a marketing
 * page: every entry says what was added, what changed under you, and what was
 * broken and is not any more — in that order, because the middle one is the
 * category that costs a player their muscle memory and the last one is the
 * category that explains why something you reported is finally behaving.
 *
 * The list is the same object the build takes its version number from and the
 * same object `CHANGELOG.md` is rendered from, so this screen cannot drift
 * from what actually shipped.
 */
export function PatchNotes({ seen, onRead, onBack }: Props) {
  // How many releases at the top of the list this player has not read.
  //
  //  - a version we recognise: everything above it,
  //  - never opened them at all — a profile from before this screen existed:
  //    the current release, which is the one that landed under them,
  //  - a version we do not recognise: the same, rather than guessing.
  //
  // A brand-new profile starts pinned to the current version, so it lands on 0
  // and its first session is not decorated with marks for a game it has never
  // played a different version of.
  //
  // Captured on mount, and the profile is only marked read in the effect
  // below — after this first render. Doing both in the click handler erased
  // the page's own "what's new" marks in the same frame you arrived to read
  // them, which is the one thing this screen must not do.
  const [seenOnArrival] = useState(() => seen);
  const seenIndex = seenOnArrival ? PATCH_NOTES.findIndex((p) => p.version === seenOnArrival) : -1;
  const unread = seenIndex > 0 ? seenIndex : seenIndex === 0 ? 0 : 1;

  const [open, setOpen] = useState<string>(PATCH_NOTES[0].version);

  useEffect(() => {
    onRead();
    // Once per visit, whatever else re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scroll">
      <div className="wrap patch fade-up">
        <header className="patch-head">
          <Crest size={46} />
          <div>
            <div className="eyebrow">Release history</div>
            <h1 className="display patch-h1">PATCH NOTES</h1>
          </div>
          <div className="patch-now">
            <span className="eyebrow">Running</span>
            <b className="mono">v{VERSION}</b>
            <i>{PATCH_NOTES[0].name}</i>
          </div>
        </header>

        <p className="patch-lead">
          Every release, newest first — what was added, what changed under you, and what was broken and
          is not any more. Anything that moves a control, a camera or the meaning of a score is written
          down here, because a trainer that quietly changes what your inputs do is a trainer you cannot
          practise against.
          {unread > 0 && (
            <>
              {' '}
              <b className="patch-unread">
                {seenIndex > 0
                  ? `${unread} release${unread === 1 ? '' : 's'} since you last read these.`
                  : 'New since your last visit.'}
              </b>
            </>
          )}
        </p>

        <div className="patch-list">
          {PATCH_NOTES.map((entry, i) => {
            const isOpen = open === entry.version;
            const isNew = unread > 0 && i < unread;
            return (
              <section key={entry.version} className={`patch-entry${isOpen ? ' open' : ''}`}>
                <button
                  className="pe-head"
                  aria-expanded={isOpen}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    audio.play('uiTab');
                    setOpen(isOpen ? '' : entry.version);
                  }}
                >
                  <span className="pe-ver mono">v{entry.version}</span>
                  <span className="pe-name display">{entry.name}</span>
                  {isNew && <span className="pe-new">NEW</span>}
                  {i === 0 && !isNew && <span className="pe-current">CURRENT</span>}
                  <span className="pe-date mono">{formatDate(entry.date)}</span>
                  <span className="pe-chev" aria-hidden />
                </button>

                <p className="pe-headline">{entry.headline}</p>

                {isOpen && (
                  <div className="pe-body">
                    {TAG_ORDER.map((tag) => {
                      const section = entry.sections.find((s) => s.tag === tag);
                      if (!section || section.items.length === 0) return null;
                      return (
                        <div className={`pe-sec pe-${tag}`} key={tag}>
                          <div className="pe-sec-title">
                            <i />
                            {TAG_LABEL[tag]}
                          </div>
                          <ul>
                            {section.items.map((item, n) => (
                              <li key={n}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <p className="patch-fine">
          Versions before 1.2.0 are assigned retroactively from the commit history — the project shipped
          continuously before it started numbering itself, and inventing a paper trail would be worse than
          saying so. Your progress is stored in your browser under <b className="mono">apex.profile.v1</b>{' '}
          and is carried forward across every release on this list.
        </p>

        <button className="btn ghost lg" style={{ marginTop: 22 }} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
