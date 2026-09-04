import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { DRILL_LIST, type DrillId } from '../drills/catalog';
import { TEST_LIST, type TestId } from '../tests/catalog';
import { isApmDrill } from '../progression/apm';
import { buildPlan } from '../progression/plan';
import { isVayneStage, stageUnlocked, VAYNE_STAGES } from '../progression/vayne';
import type { Profile } from '../progression/profile';
import './palette.css';

/**
 * Fast navigation.
 *
 * Twenty-nine drills, twelve tests and seven screens is more than a top bar
 * can hold, and a player who knows what they want should not have to
 * remember where it lives. Ctrl/Cmd+K, type three letters, Enter.
 *
 * Deliberately unavailable during a run: the whole point of the gameplay
 * screen is that nothing can appear on top of it.
 */

export interface PaletteAction {
  id: string;
  label: string;
  /** The group heading it appears under. */
  kind: 'GO' | 'DRILL' | 'TEST' | 'ACTION';
  /** Extra words that should match it. */
  keywords?: string;
  hint?: string;
  accent?: string;
  disabled?: string;
  run: () => void;
}

interface Props {
  profile: Profile;
  onClose: () => void;
  onGo: (route: string) => void;
  onPlay: (id: DrillId) => void;
  onTest: (id: TestId) => void;
  onStartSession: () => void;
  onCalibrate: () => void;
}

const score = (query: string, text: string): number => {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - t.length * 0.01;
  const at = t.indexOf(q);
  if (at >= 0) return 70 - at;
  // Subsequence: "dfkt" matches "defensive kite". Only for four characters or
  // more — at three, a subsequence match puts SKILLSHOT under "kit", and a
  // list of things that nearly match is worse than a short list.
  if (q.length < 4) return -1;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 30 : -1;
};

export function Palette({
  profile,
  onClose,
  onGo,
  onPlay,
  onTest,
  onStartSession,
  onCalibrate,
}: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const actions = useMemo<PaletteAction[]>(() => {
    const out: PaletteAction[] = [
      {
        id: 'go-today',
        kind: 'GO',
        label: 'Today',
        keywords: 'session home plan daily',
        run: () => onGo('today'),
      },
      { id: 'go-train', kind: 'GO', label: 'Train', keywords: 'drills browse', run: () => onGo('home') },
      { id: 'go-champion', kind: 'GO', label: 'Champion path', keywords: 'vayne mastery', run: () => onGo('vayne') },
      { id: 'go-lab', kind: 'GO', label: 'The lab', keywords: 'apm ladder pressing', run: () => onGo('apm') },
      { id: 'go-test', kind: 'GO', label: 'Test centre', keywords: 'combine benchmark', run: () => onGo('tests') },
      { id: 'go-progress', kind: 'GO', label: 'Progress', keywords: 'rating errors charts', run: () => onGo('progress') },
      { id: 'go-records', kind: 'GO', label: 'Records', keywords: 'personal bests pb', run: () => onGo('records') },
      { id: 'go-setup', kind: 'GO', label: 'Setup', keywords: 'settings binds controls audio', run: () => onGo('settings') },
      { id: 'go-patch', kind: 'GO', label: 'Patch notes', keywords: 'changelog version', run: () => onGo('patch') },
      {
        id: 'act-session',
        kind: 'ACTION',
        label: "Start today's session",
        hint: buildPlan(profile).headline || undefined,
        keywords: 'begin continue training',
        disabled: profile.placed ? undefined : 'Take the assessment first',
        run: onStartSession,
      },
      {
        id: 'act-assess',
        kind: 'ACTION',
        label: profile.placed ? 'Retake the mechanical assessment' : 'Take the mechanical assessment',
        keywords: 'calibrate placement rank',
        run: onCalibrate,
      },
    ];

    for (const d of DRILL_LIST) {
      const locked =
        isVayneStage(d.id) &&
        !stageUnlocked(profile.vayne, VAYNE_STAGES[VAYNE_STAGES.findIndex((s) => s.id === d.id)]);
      out.push({
        id: `drill-${d.id}`,
        kind: 'DRILL',
        label: d.name,
        accent: d.accent,
        hint: isApmDrill(d.id) ? `Lab · ${d.tagline}` : `${d.group.toLowerCase()} · ${d.tagline}`,
        keywords: `${d.group} ${d.tagline} ${d.keyMetric}`,
        disabled: locked ? 'Locked on the champion path' : undefined,
        run: () => onPlay(d.id),
      });
    }
    for (const t of TEST_LIST) {
      out.push({
        id: `test-${t.id}`,
        kind: 'TEST',
        label: t.name,
        accent: t.accent,
        hint: `test · ${t.tagline}`,
        keywords: `${t.group} ${t.tagline} test`,
        run: () => onTest(t.id),
      });
    }
    return out;
  }, [profile, onGo, onPlay, onTest, onStartSession, onCalibrate]);

  const results = useMemo(() => {
    const scored = actions
      .map((a) => ({ a, s: Math.max(score(query, a.label), score(query, a.keywords ?? '') - 25) }))
      .filter((x) => x.s > 0);
    // With no query the palette is a map of the product, not a ranking.
    if (!query) return actions.slice(0, 11);
    return scored.sort((x, y) => y.s - x.s).slice(0, 11).map((x) => x.a);
  }, [actions, query]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(results.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = results[index];
        if (pick && !pick.disabled) {
          audio.play('uiClick');
          onClose();
          pick.run();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [results, index, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  // Group headings belong to the default map of the product. Under a query the
  // order is relevance, so headings would repeat — each row states its own
  // kind in the hint instead.
  const grouped = !query;
  let lastKind = '';

  return (
    <div className="pal-screen" onMouseDown={onClose}>
      <div className="pal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <span className="pal-caret">›</span>
          <input
            autoFocus
            value={query}
            placeholder="Search drills, tests and screens…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search APEX"
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="pal-list" ref={listRef} role="listbox">
          {results.length === 0 && (
            <div className="pal-none">
              Nothing matches “{query}”. Try a drill name, a skill, or a screen.
            </div>
          )}
          {results.map((a, i) => {
            const head = grouped && a.kind !== lastKind ? a.kind : null;
            lastKind = a.kind;
            return (
              <div key={a.id}>
                {head && <div className="pal-group eyebrow">{groupLabel(head)}</div>}
                <button
                  className={`pal-row${i === index ? ' on' : ''}${a.disabled ? ' off' : ''}`}
                  style={a.accent ? { ['--c' as string]: a.accent } : undefined}
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => {
                    if (a.disabled) return;
                    audio.play('uiClick');
                    onClose();
                    a.run();
                  }}
                >
                  <span className="pal-bar" />
                  <span className="pal-label">{a.label}</span>
                  {a.hint && <span className="pal-hint">{a.hint}</span>}
                  {a.disabled && <span className="pal-off">{a.disabled}</span>}
                  {i === index && !a.disabled && <span className="kbd">Enter</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="pal-foot">
          <span>↑↓ move</span>
          <span>Enter open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

const groupLabel = (kind: string): string =>
  kind === 'GO' ? 'Screens' : kind === 'DRILL' ? 'Drills' : kind === 'TEST' ? 'Tests' : 'Actions';
