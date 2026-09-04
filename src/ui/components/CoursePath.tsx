import type { ReactNode } from 'react';
import { audio } from '../../engine/audio';
import './coursepath.css';

/**
 * A COURSE, DRAWN AS A COURSE.
 *
 * Two things in this product are courses — the champion path and the WASD
 * academy — and both used to be printed as a stack of identical cards, each
 * carrying its own copy of the same four figures, the same progress track, the
 * same star row and the same button. That is a table of a course rather than a
 * picture of one, and it costs the reader the only thing a course has to
 * offer: a shape. This came before that. You are here. That is next. The end
 * is locked until the rest of it is not.
 *
 * So both draw this instead: the steps as nodes on one line with their state
 * on the node, and one detail panel for whichever node you are looking at.
 * They are the same component because they are the same idea, and a player who
 * has learned to read one has learned to read the other.
 */

export type CourseState = 'done' | 'current' | 'open' | 'locked';

export interface CourseNode {
  key: string;
  /** The kind of step — FOUNDATION, KIT, COMBAT. Two words at most. */
  kind: string;
  name: string;
  /** What the step is for, in one or two sentences. */
  purpose: string;
  accent: string;
  state: CourseState;
  /** 0–3, or null for a step that is not scored in stars. */
  stars: number | null;
  runs: number | null;
  /** Fill and the notch it has to clear, both 0..1. */
  progress: { value: number; gate: number } | null;
  /** Shown in place of the action when the step is locked. */
  lockNote: string;
  /** The League habit this step is for. Optional. */
  transfers?: string;
}

interface Props {
  nodes: CourseNode[];
  /** Index into `nodes`. The caller owns selection so it survives a re-render. */
  selected: number;
  onSelect: (index: number) => void;
  onRun: (index: number) => void;
  /** The panel beside the detail — usually a diagnosis. */
  aside?: ReactNode;
}

export function CoursePath({ nodes, selected, onSelect, onRun, aside }: Props) {
  const node = nodes[selected] ?? nodes[0];
  if (!node) return null;
  const current = nodes.findIndex((n) => n.state === 'current');

  return (
    <>
      <div className="cp-rail">
        {nodes.map((n, i) => (
          <button
            key={n.key}
            className={`cp-node ${n.state}${selected === i ? ' sel' : ''}`}
            style={{ ['--c' as string]: n.accent }}
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiTab');
              onSelect(i);
            }}
          >
            <span className="cp-dot">
              {n.state === 'done' ? '✓' : n.state === 'locked' ? '·' : String(i + 1)}
            </span>
            <span className="cp-kind">{n.kind}</span>
            <span className="cp-name">{n.name}</span>
            {n.stars !== null && n.stars > 0 && (
              <span className="cp-stars">
                {[1, 2, 3].map((s) => (
                  <i key={s} className={s <= n.stars! ? 'on' : ''}>
                    ★
                  </i>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="cp-detail" style={{ ['--c' as string]: node.accent }}>
        <div className="cp-detail-l">
          <span className="eyebrow">
            {node.state === 'done'
              ? 'Cleared'
              : node.state === 'current'
                ? 'You are here'
                : node.state === 'locked'
                  ? 'Locked'
                  : 'Open'}
          </span>
          <h2 className="display">{node.name}</h2>
          <p>{node.purpose}</p>

          {node.progress && (
            <>
              {/* The bar fills to your best and carries a notch at the gate, so
                  "how far off am I" is a distance rather than arithmetic. */}
              <div className="cp-track">
                <span style={{ width: `${Math.round(Math.min(1, node.progress.value) * 100)}%` }} />
                <i style={{ left: `${Math.round(node.progress.gate * 100)}%` }} />
              </div>
              <div className="cp-legend mono">
                <span>BEST {node.progress.value > 0 ? `${Math.round(node.progress.value * 100)}%` : '—'}</span>
                <span>CLEARS AT {Math.round(node.progress.gate * 100)}%</span>
                {node.runs !== null && <span>{node.runs} RUNS</span>}
              </div>
            </>
          )}

          {node.transfers && (
            <p className="cp-transfers">
              <span className="eyebrow">Transfers to</span>
              {node.transfers}
            </p>
          )}

          <div className="cp-act">
            {node.state === 'locked' ? (
              <span className="cp-lock">{node.lockNote}</span>
            ) : (
              <button
                className="btn primary lg"
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiClick');
                  onRun(selected);
                }}
              >
                {node.state === 'done' ? 'Run it again' : node.runs ? 'Continue' : 'Begin'}
              </button>
            )}
            {current >= 0 && current !== selected && (
              <button
                className="link"
                onClick={() => {
                  audio.play('uiTab');
                  onSelect(current);
                }}
              >
                Take me to where I am →
              </button>
            )}
          </div>
        </div>

        {aside}
      </div>
    </>
  );
}
