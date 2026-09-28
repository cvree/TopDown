import { useEffect, useRef, useState, type ReactNode } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { PLAY_SECONDS } from '../drills/modes';
import { APM_LEVELS, isApmDrill } from '../progression/apm';
import { LANE_LENGTHS, LANE_TIERS } from '../progression/lane';
import {
  SECONDS_MAX,
  SECONDS_MIN,
  SIZE_MAX,
  SIZE_MIN,
  SPEED_MAX,
  SPEED_MIN,
  defaultTuning,
  isCustom,
  playlistLink,
  type ActivityTuning,
  type SharedPlaylist,
  type TuningFog,
  type TuningRange,
} from '../progression/tuning';
import './activity.css';

/** m:ss, or plain seconds under a minute. */
export const fmtSeconds = (s: number): string =>
  s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const fmtX = (v: number): string => `${Number(v.toFixed(2))}×`;

/** A favourite's settings in one short line, for a chip, a playlist row or a shared code. */
export const tuningSummary = (id: DrillId, t: ActivityTuning): string => {
  const parts = [fmtSeconds(t.seconds)];
  if (id === 'lanePhase') parts.push(`vs ${(LANE_TIERS.find((x) => x.id === t.tier) ?? LANE_TIERS[1]).label}`);
  else parts.push(t.level === null ? 'auto level' : `level ${t.level}`);
  if (t.speed !== 1) parts.push(`${fmtX(t.speed)} speed`);
  if (t.size !== 1) parts.push(`${fmtX(t.size)} targets`);
  if (t.fog !== 'auto') parts.push(`fog ${t.fog}`);
  if (t.range !== 'auto') parts.push(`range ${t.range === 'check' ? 'on check' : t.range}`);
  return parts.join(' · ');
};

/**
 * Closes on Escape, and keeps Escape from reaching the rest of the client —
 * where it would open SETUP behind the dialog.
 */
const useEscape = (onClose: () => void) => {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      ref.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
};

function Dialog({
  label,
  accent,
  onClose,
  children,
}: {
  label: string;
  accent?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscape(onClose);
  return (
    <div
      className="ae-backdrop fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ae-card scale-in" role="dialog" aria-modal="true" aria-label={label} style={{ ['--c' as string]: accent ?? 'var(--gold)' }}>
        <button type="button" className="ae-x" onClick={onClose} aria-label="Close — Esc">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

function Chips<T extends string | number | null>({
  value,
  options,
  onPick,
  label,
}: {
  value: T;
  options: { v: T; label: string; sub?: string }[];
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <div className="ae-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          role="radio"
          aria-checked={o.v === value}
          className={`ae-chip${o.v === value ? ' on' : ''}`}
          onClick={() => {
            audio.play('uiTab');
            onPick(o.v);
          }}
        >
          <b>{o.label}</b>
          {o.sub && <i>{o.sub}</i>}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  show,
  onChange,
  presets,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
  onChange: (v: number) => void;
  presets?: number[];
  hint?: string;
}) {
  return (
    <div className="ae-field">
      <div className="ae-field-head">
        <span className="ae-label">{label}</span>
        <b className="ae-value mono">{show(value)}</b>
      </div>
      <input
        className="ae-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={show(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {presets && (
        <div className="ae-presets">
          {presets.map((p) => (
            <button key={p} type="button" className={`ae-preset mono${p === value ? ' on' : ''}`} onClick={() => onChange(p)}>
              {show(p)}
            </button>
          ))}
        </div>
      )}
      {hint && <p className="ae-hint">{hint}</p>}
    </div>
  );
}

/**
 * EDIT ACTIVITY.
 *
 * What a player sees the moment they star something, and again whenever they
 * press EDIT on a favourite or on a playlist row: every setting worth having
 * an opinion about, on one card, with the card's own answers as the default.
 */
export function ActivityEditor({
  id,
  initial,
  title = 'EDIT ACTIVITY',
  eyebrow,
  onSave,
  onSaveAndPlay,
  onClose,
}: {
  id: DrillId;
  initial: ActivityTuning;
  title?: string;
  eyebrow?: string;
  onSave: (t: ActivityTuning) => void;
  onSaveAndPlay?: (t: ActivityTuning) => void;
  onClose: () => void;
}) {
  const meta = DRILLS[id];
  const [t, setT] = useState<ActivityTuning>(initial);
  const patch = (p: Partial<ActivityTuning>) => setT((x) => ({ ...x, ...p }));
  const lab = isApmDrill(id);
  const lane = id === 'lanePhase';
  const custom = isCustom(id, t);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);

  return (
    <Dialog label={`${title} — ${meta.name}`} accent={meta.accent} onClose={onClose}>
      <header className="ae-head">
        <div className="eyebrow">{eyebrow ?? 'your favourite, your way'}</div>
        <h2 className="display ae-title">{title}</h2>
        <div className="ae-name">
          <b className="display">{meta.name}</b>
          <span>{meta.tagline}</span>
        </div>
      </header>

      <div className="ae-body">
        <section className="ae-group">
          <h3 className="ae-group-label">TIME</h3>
          {lane ? (
            <>
              <Chips
                label="Lane length"
                value={LANE_LENGTHS.some((l) => l.seconds === t.seconds) ? t.seconds : -1}
                options={LANE_LENGTHS.map((l) => ({ v: l.seconds, label: l.label, sub: l.blurb }))}
                onPick={(v) => v > 0 && patch({ seconds: v })}
              />
              <Slider
                label="Or any length"
                value={t.seconds}
                min={30}
                max={SECONDS_MAX}
                step={15}
                show={fmtSeconds}
                onChange={(v) => patch({ seconds: v })}
              />
            </>
          ) : (
            <Slider
              label="How long a run lasts"
              value={t.seconds}
              min={SECONDS_MIN}
              max={300}
              step={5}
              show={fmtSeconds}
              presets={[15, PLAY_SECONDS, 45, 60, 90, 120]}
              onChange={(v) => patch({ seconds: v })}
            />
          )}
        </section>

        <section className="ae-group">
          <h3 className="ae-group-label">DIFFICULTY</h3>
          {lane ? (
            <Chips
              label="Opponent"
              value={t.tier ?? LANE_TIERS[1].id}
              options={LANE_TIERS.map((x) => ({ v: x.id, label: x.label, sub: `${x.expect.toFixed(1)} CS/min` }))}
              onPick={(v) => patch({ tier: v === LANE_TIERS[1].id ? null : v })}
            />
          ) : (
            <>
              <Chips
                label="Level"
                value={t.level === null ? 'auto' : 'fixed'}
                options={[
                  { v: 'auto', label: 'AUTO', sub: lab ? 'the level the card suggests' : 'follows your ladder' },
                  { v: 'fixed', label: 'FIXED', sub: 'always the level below' },
                ]}
                onPick={(v) => patch({ level: v === 'auto' ? null : (t.level ?? 3) })}
              />
              {t.level !== null && (
                <Slider
                  label="Level"
                  value={t.level}
                  min={1}
                  max={APM_LEVELS}
                  step={1}
                  show={(v) => `${v} / ${APM_LEVELS}`}
                  onChange={(v) => patch({ level: v })}
                />
              )}
            </>
          )}
        </section>

        <section className="ae-group">
          <h3 className="ae-group-label">FEEL</h3>
          <Slider
            label="Game speed"
            value={t.speed}
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={0.05}
            show={fmtX}
            presets={[0.5, 0.75, 1, 1.25, 1.5, 2]}
            hint="Everything in the arena — targets, projectiles, you — runs this much faster or slower. The clock stays in real seconds."
            onChange={(v) => patch({ speed: Number(v.toFixed(2)) })}
          />
          <Slider
            label={lab ? 'Circle size' : 'Target size'}
            value={t.size}
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={0.05}
            show={fmtX}
            presets={[0.5, 0.75, 1, 1.25, 1.5, 2]}
            hint={lab ? 'How big every pad and circle on the bench is.' : 'How big every enemy, minion and target body is — to hit, and to see.'}
            onChange={(v) => patch({ size: Number(v.toFixed(2)) })}
          />
        </section>

        {!lab && (
          <section className="ae-group">
            <h3 className="ae-group-label">HELP ON SCREEN</h3>
            <div className="ae-field">
              <span className="ae-label">Your range ring</span>
              <Chips<TuningRange>
                label="Range ring"
                value={t.range}
                options={[
                  { v: 'auto', label: 'SETUP' },
                  { v: 'check', label: 'ON CHECK' },
                  { v: 'always', label: 'ALWAYS' },
                  { v: 'off', label: 'OFF' },
                ]}
                onPick={(v) => patch({ range: v })}
              />
            </div>
            <div className="ae-field">
              <span className="ae-label">Fog of war, in the modes that have it</span>
              <Chips<TuningFog>
                label="Fog of war"
                value={t.fog}
                options={[
                  { v: 'auto', label: 'SETUP' },
                  { v: 'on', label: 'ON' },
                  { v: 'off', label: 'OFF' },
                ]}
                onPick={(v) => patch({ fog: v })}
              />
            </div>
          </section>
        )}
      </div>

      <p className={`ae-note${custom ? ' custom' : ''}`}>
        {custom
          ? 'Custom run: a length, speed or target size the card does not offer. You see your score; records, ladders and your rank are left alone.'
          : 'Standard run: it counts toward your records exactly like the card itself.'}{' '}
        These settings are used whenever you start it from your favourites or a playlist.
      </p>

      <footer className="ae-foot">
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            audio.play('uiBack');
            setT(defaultTuning(id));
          }}
        >
          RESET TO STANDARD
        </button>
        <span className="ae-foot-gap" />
        <button type="button" className="btn ghost" onClick={onClose}>
          CANCEL
        </button>
        <button
          ref={first}
          type="button"
          className="btn"
          onClick={() => {
            audio.play('uiClick');
            onSave(t);
          }}
        >
          SAVE
        </button>
        {onSaveAndPlay && (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              audio.play('uiClick');
              onSaveAndPlay(t);
            }}
          >
            SAVE &amp; PLAY
          </button>
        )}
      </footer>
    </Dialog>
  );
}

/** Copies text, falling back to selecting it when the clipboard is refused. */
const copy = async (text: string, fallback: HTMLInputElement | null): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallback?.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState<'yes' | 'no' | null>(null);
  return (
    <div className="ae-copy">
      <span className="ae-label">{label}</span>
      <div className="ae-copy-row">
        <input ref={input} className="mono" readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} />
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const ok = await copy(value, input.current);
            audio.play(ok ? 'uiClick' : 'uiBack');
            setDone(ok ? 'yes' : 'no');
            window.setTimeout(() => setDone(null), 1800);
          }}
        >
          {done === 'yes' ? 'COPIED' : done === 'no' ? 'SELECTED — ⌘/CTRL+C' : 'COPY'}
        </button>
      </div>
    </div>
  );
}

/**
 * SHARE A PLAYLIST.
 *
 * Two ways out of this client, both carrying everything: the link opens it
 * straight onto the playlist, the code pastes into anybody's FAVORITES. Each
 * activity goes with the settings it was edited to, so a friend plays exactly
 * the run you built.
 */
export function ShareDialog({ playlist, code, onClose }: { playlist: SharedPlaylist; code: string; onClose: () => void }) {
  const link = playlistLink(code);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <Dialog label={`Share ${playlist.name}`} onClose={onClose}>
      <header className="ae-head">
        <div className="eyebrow">send it to a friend</div>
        <h2 className="display ae-title">SHARE PLAYLIST</h2>
        <div className="ae-name">
          <b className="display">{playlist.name}</b>
          <span>
            {playlist.items.length} activit{playlist.items.length === 1 ? 'y' : 'ies'}, each with your settings
          </span>
        </div>
      </header>
      <ol className="ae-list">
        {playlist.items.map((id, i) => (
          <li key={`${id}-${i}`}>
            <b className="mono">{String(i + 1).padStart(2, '0')}</b>
            <span>{DRILLS[id].name}</span>
            <i className="mono">{tuningSummary(id, playlist.tunings[i])}</i>
          </li>
        ))}
      </ol>
      <CopyRow label="Link — opens the playlist for whoever clicks it" value={link} />
      <CopyRow label="Playlist code — paste it under FAVORITES › ADD A CODE" value={code} />
      <footer className="ae-foot">
        <span className="ae-foot-gap" />
        {canShare && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              navigator.share({ title: `APEX playlist · ${playlist.name}`, text: `Play my APEX playlist "${playlist.name}"`, url: link }).catch(() => undefined);
            }}
          >
            SHARE…
          </button>
        )}
        <button type="button" className="btn primary" onClick={onClose}>
          DONE
        </button>
      </footer>
    </Dialog>
  );
}

/**
 * A PLAYLIST SOMEBODY SENT YOU.
 *
 * Opened by a shared link or a pasted code. Nothing is added until you say so;
 * PLAY IT NOW saves it and starts the first activity.
 */
export function ImportDialog({
  playlist,
  onSave,
  onSaveAndPlay,
  onClose,
}: {
  playlist: SharedPlaylist;
  onSave: () => void;
  onSaveAndPlay: () => void;
  onClose: () => void;
}) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus({ preventScroll: true }), []);
  return (
    <Dialog label={`Shared playlist ${playlist.name}`} onClose={onClose}>
      <header className="ae-head">
        <div className="eyebrow">a playlist was shared with you</div>
        <h2 className="display ae-title">{playlist.name}</h2>
        <div className="ae-name">
          <span>
            {playlist.items.length} activit{playlist.items.length === 1 ? 'y' : 'ies'}, played in order with the settings they were
            sent with
          </span>
        </div>
      </header>
      <ol className="ae-list">
        {playlist.items.map((id, i) => (
          <li key={`${id}-${i}`}>
            <b className="mono">{String(i + 1).padStart(2, '0')}</b>
            <span>{DRILLS[id].name}</span>
            <i className="mono">{tuningSummary(id, playlist.tunings[i])}</i>
          </li>
        ))}
      </ol>
      <footer className="ae-foot">
        <button type="button" className="btn ghost" onClick={onClose}>
          NOT NOW
        </button>
        <span className="ae-foot-gap" />
        <button type="button" className="btn" onClick={onSave}>
          SAVE TO MY PLAYLISTS
        </button>
        <button ref={ok} type="button" className="btn primary" onClick={onSaveAndPlay}>
          ▶ PLAY IT NOW
        </button>
      </footer>
    </Dialog>
  );
}
