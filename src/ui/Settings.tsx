import { useEffect, useState } from 'react';
import { audio } from '../engine/audio';
import { ACTION_LABELS, DEFAULT_BINDINGS, codeLabel, type ActionId, type Binding } from '../engine/input';
import type { AppSettings } from '../progression/profile';
import './settings.css';

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onBack: () => void;
}

const ACTIONS: ActionId[] = [
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
  'reset',
  'pause',
];

export function Settings({ settings, onChange, onBack }: Props) {
  const [capturing, setCapturing] = useState<ActionId | null>(null);

  const bindingFor = (a: ActionId): Binding => settings.bindings[a] ?? DEFAULT_BINDINGS[a];

  useEffect(() => {
    if (!capturing) return;
    const finish = (code: string) => {
      onChange({ bindings: { ...settings.bindings, [capturing]: { primary: code } } });
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
  }, [capturing, onChange, settings.bindings]);

  return (
    <div className="scroll">
      <div className="wrap settings fade-up">
        <div className="eyebrow">Configuration</div>
        <h1 className="display set-h1">SETTINGS</h1>

        <div className="set-grid">
          <section className="panel pad">
            <div className="panel-title">Controls</div>
            <div className="bind-list">
              {ACTIONS.map((a) => {
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
              onClick={() => onChange({ bindings: {} })}
            >
              Restore defaults
            </button>
            <p className="set-note">
              Attack-move fires on the confirm button while the modifier is held. A bare left click also
              issues an attack-move, so you can train the habit without being punished for forgetting the
              modifier. <b>R</b> doubles as instant reset in drills with no ultimate bound.
            </p>
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
