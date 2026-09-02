import { useEffect, useState } from 'react';
import { audio } from '../engine/audio';
import {
  ACTION_LABELS,
  codeLabel,
  defaultsFor,
  type ActionId,
  type Binding,
  type MovementScheme,
} from '../engine/input';
import type { AppSettings } from '../progression/profile';
import { hasBrowserMouseGestures } from './components/GestureNotice';
import './settings.css';

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onBack: () => void;
}

/** The click scheme's binding list, in the order a League player expects it. */
const CLICK_ACTIONS: ActionId[] = [
  'move',
  'attackMove',
  'stop',
  'q',
  'w',
  'e',
  'r',
  'd',
  'f',
  'centerCamera',
  'cameraLock',
  'reset',
  'pause',
];

/** WASD's list leads with the four keys that define it. */
const WASD_ACTIONS: ActionId[] = [
  'moveUp',
  'moveLeft',
  'moveDown',
  'moveRight',
  'move',
  'attackMove',
  'stop',
  'q',
  'w',
  'e',
  'r',
  'd',
  'f',
  'centerCamera',
  'cameraLock',
  'reset',
  'pause',
];

export function Settings({ settings, onChange, onBack }: Props) {
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const scheme: MovementScheme = settings.movementScheme ?? 'click';
  const wasd = scheme === 'wasd';
  // Each scheme keeps its own rebinds. Sharing one map would mean switching to
  // WASD silently broke a layout you had tuned for clicking, and switching
  // back would not repair it.
  const overrides = wasd ? settings.wasdBindings ?? {} : settings.bindings ?? {};
  const actions = wasd ? WASD_ACTIONS : CLICK_ACTIONS;

  const bindingFor = (a: ActionId): Binding => overrides[a] ?? defaultsFor(scheme)[a];

  useEffect(() => {
    if (!capturing) return;
    const finish = (code: string) => {
      const next = { ...overrides, [capturing]: { primary: code } };
      onChange(wasd ? { wasdBindings: next } : { bindings: next });
      setCapturing(null);
      audio.play('uiClick');
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setCapturing(null);
        return;
      }
      finish(e.code);
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      finish(`Mouse${e.button}`);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', preventDefault, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('contextmenu', preventDefault, true);
    };
  }, [capturing, onChange, overrides, wasd]);

  return (
    <div className="scroll">
      <div className="wrap settings fade-up">
        <div className="eyebrow">Configuration</div>
        <h1 className="display set-h1">SETTINGS</h1>

        <div className="set-grid">
          <section className="panel pad">
            <div className="panel-title">Movement</div>
            <div className="scheme-pick">
              {(
                [
                  {
                    id: 'click' as MovementScheme,
                    name: 'CLICK TO MOVE',
                    sub: 'League',
                    body: 'Right click to move, right click a unit to attack it. The scheme every MOBA habit is built on, and the one your muscle memory has to transfer to.',
                  },
                  {
                    id: 'wasd' as MovementScheme,
                    name: 'WASD',
                    sub: 'Direct control',
                    body: 'The left hand steers, the mouse only ever targets. Release the keys to attack — holding a direction through the windup throws the attack away, exactly as a click does.',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  className={`scheme-card${scheme === opt.id ? ' on' : ''}`}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    if (scheme === opt.id) return;
                    audio.play('uiClick');
                    onChange({ movementScheme: opt.id });
                  }}
                >
                  <div className="sc-head">
                    <b>{opt.name}</b>
                    <span>{opt.sub}</span>
                  </div>
                  <p>{opt.body}</p>
                  <div className="sc-keys">
                    {(opt.id === 'click'
                      ? ['RMB', 'A', 'S', 'Q', 'W', 'E', 'R']
                      : ['W', 'A', 'S', 'D', 'Q', 'E', 'R', 'F']
                    ).map((k) => (
                      <kbd className="kbd" key={k}>
                        {k}
                      </kbd>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            <p className="set-note">
              {wasd
                ? 'W, A, S and D drive the champion, so the ability row moves one seat over: Q, E, R and F are Q, W, E and R, the summoners are 1 and 2, and stop is X. Everything below is rebindable and applies to this scheme only.'
                : 'Scores are identical under either scheme — both obey the same windup rule, and the free-movement window is measured the same way.'}
            </p>
          </section>

          <section className="panel pad">
            <div className="panel-title">Controls</div>
            <div className="bind-list">
              {actions.map((a) => {
                const b = bindingFor(a);
                return (
                  <div className="bind-row" key={a}>
                    <span>{ACTION_LABELS[a]}</span>
                    <button
                      className={`bind-key ${capturing === a ? 'capturing' : ''}`}
                      onClick={() => setCapturing(a)}
                    >
                      {capturing === a ? 'PRESS A KEY…' : codeLabel(b.primary)}
                      {b.secondary && capturing !== a && <i> / {codeLabel(b.secondary)}</i>}
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              className="btn ghost sm"
              style={{ marginTop: 16 }}
              onClick={() => onChange(wasd ? { wasdBindings: {} } : { bindings: {} })}
            >
              Restore defaults
            </button>
            <p className="set-note">
              Attack-move fires on the confirm button while the modifier is held. A bare left click also
              issues an attack-move, so you can train the habit without being punished for forgetting the
              modifier.{' '}
              {wasd
                ? 'Under WASD an attack order never walks you anywhere — it only chooses what you shoot.'
                : 'R doubles as instant reset in drills with no ultimate bound.'}
            </p>
            {hasBrowserMouseGestures() && (
              <p className="set-note">
                <b className="warn">Opera mouse gestures.</b> Right-drag and right-click&nbsp;+&nbsp;left-click
                are browser gestures — new tab, and back — and they are the same inputs used here to move and
                attack-move. The browser handles them above the page, so this trainer cannot block them: turn
                them off in <b>Settings → Browser → Shortcuts</b>, or rebind <b>Move</b> above to a button
                gestures do not use.
              </p>
            )}
          </section>

          <section className="panel pad">
            <div className="panel-title">Gameplay</div>
            <Toggle
              label="Quick cast"
              hint="Abilities fire at the cursor on key press. Off means press to arm, click to confirm."
              value={settings.quickCast}
              onChange={(v) => onChange({ quickCast: v })}
            />
            <Toggle
              label="Show attack range"
              hint="The dashed ring around you, plus the attack timer arc."
              value={settings.showRange}
              onChange={(v) => onChange({ showRange: v })}
            />
            <Toggle
              label="Reduced camera motion"
              hint="Stops the camera shaking, punching in and kicking on impacts. Everything you drive it to do — follow, zoom, edge pan — is untouched."
              value={settings.reduceShake}
              onChange={(v) => onChange({ reduceShake: v })}
            />
            <Toggle
              label="Reduced effects"
              hint="Turns off shadows, bloom and the live arena behind the menus. The simulation is unchanged, so scores stay comparable."
              value={settings.lowFx}
              onChange={(v) => onChange({ lowFx: v })}
            />

            <div className="panel-title" style={{ marginTop: 26 }}>
              Audio
            </div>
            <Toggle label="Mute" value={settings.muted} onChange={(v) => onChange({ muted: v })} />
            <Slider
              label="Master"
              value={settings.masterVolume}
              onChange={(v) => onChange({ masterVolume: v })}
            />
            <Slider label="Effects" value={settings.sfxVolume} onChange={(v) => onChange({ sfxVolume: v })} />
            <Slider
              label="Ambience"
              value={settings.musicVolume}
              onChange={(v) => onChange({ musicVolume: v })}
            />
          </section>
        </div>

        <button className="btn ghost lg" style={{ marginTop: 26 }} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="opt-row">
      <div>
        <div className="opt-label">{label}</div>
        {hint && <div className="opt-hint">{hint}</div>}
      </div>
      <button
        className={`switch ${value ? 'on' : ''}`}
        onClick={() => {
          audio.play('uiClick');
          onChange(!value);
        }}
        aria-pressed={value}
      >
        <span />
      </button>
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="opt-row">
      <div className="opt-label">{label}</div>
      <div className="slider-wrap">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="mono">{Math.round(value * 100)}</span>
      </div>
    </div>
  );
}

const preventDefault = (e: Event) => e.preventDefault();
