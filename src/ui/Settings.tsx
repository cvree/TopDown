import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { HERO_LIST, heroFor, type HeroId } from '../engine/heroes';
import {
  ACTION_LABELS,
  codeLabel,
  defaultsFor,
  type ActionId,
  type Binding,
  type MovementScheme,
} from '../engine/input';
import { DEFAULT_SETTINGS, type AppSettings } from '../progression/profile';
import { hasBrowserMouseGestures } from './components/GestureNotice';
import { HeroRoster } from './components/HeroRoster';
import { HeroSigil } from './components/HeroSigil';
import './settings.css';
import './heroselect.css';

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onBack: () => void;
}

/**
 * SETTINGS.
 *
 * The old version of this screen was three tall panels side by side: every
 * control in the app visible at once, which sounds like a virtue and is
 * actually the reason nobody could find anything. Volume sliders sat directly
 * under a keybind list, and the one setting a new player most wants — who am I
 * playing as — did not exist at all.
 *
 * So it is built out of data now rather than out of markup. Every control is a
 * row in `SECTIONS`, and three things fall out of that for free:
 *
 *  - **Sections.** One subject on screen at a time, listed down the left in
 *    the order a player meets them: who you are, how you move, what your keys
 *    do, how the game plays, what the camera does, how loud it is.
 *  - **Search.** Type anything and the sections collapse into a flat list of
 *    matching controls, each still fully operable and still labelled with the
 *    section it came from. Nobody has to remember whether "shake" is a video
 *    setting or a gameplay one.
 *  - **Honest defaults.** Because every row knows its own default, a changed
 *    setting can be marked, a section can be reset on its own, and the whole
 *    screen can be put back exactly as it shipped.
 */

// --------------------------------------------------------------- the registry

type BoolKey =
  | 'quickCast'
  | 'showRange'
  | 'reduceShake'
  | 'lowFx'
  | 'edgePan'
  | 'showNames'
  | 'muted'
  | 'focusMode';
type NumKey = 'masterVolume' | 'sfxVolume' | 'musicVolume';

interface ChoiceOption<V extends string> {
  value: V;
  name: string;
  /** The small word beside the name. */
  sub?: string;
  body: string;
  /** Keys printed along the bottom of the card. */
  keys?: string[];
}

type Item =
  | { kind: 'toggle'; key: BoolKey; label: string; hint: string; terms?: string }
  | { kind: 'slider'; key: NumKey; label: string; hint?: string; terms?: string }
  | {
      kind: 'choice';
      key: 'movementScheme';
      label: string;
      hint?: string;
      terms?: string;
      options: ChoiceOption<MovementScheme>[];
    }
  | {
      kind: 'choice';
      key: 'tumbleAim';
      label: string;
      hint?: string;
      terms?: string;
      /** Only asked under WASD, where the question actually exists. */
      wasdOnly: true;
      options: ChoiceOption<'hands' | 'cursor'>[];
    }
  | { kind: 'champion'; label: string; terms: string }
  | { kind: 'bindings'; label: string; terms: string };

interface Section {
  id: string;
  name: string;
  blurb: string;
  items: Item[];
}

const SECTIONS: Section[] = [
  {
    id: 'champion',
    name: 'Champion',
    blurb: 'The body you train in. Look only — no champion here is stronger than another.',
    items: [{ kind: 'champion', label: 'Your champion', terms: 'hero character skin body silhouette avatar' }],
  },
  {
    id: 'movement',
    name: 'Movement',
    blurb: 'How the champion is driven. Everything else on this screen assumes this answer.',
    items: [
      {
        kind: 'choice',
        key: 'movementScheme',
        label: 'Movement scheme',
        terms: 'click wasd keyboard mouse right click league',
        options: [
          {
            value: 'click',
            name: 'CLICK TO MOVE',
            sub: 'League',
            body: 'Right click to move, right click a unit to attack it. The scheme every MOBA habit is built on, and the one your muscle memory has to transfer to.',
            keys: ['RMB', 'A', 'S', 'Q', 'W', 'E', 'R'],
          },
          {
            value: 'wasd',
            name: 'WASD',
            sub: 'Direct control',
            body: 'The left hand steers, the mouse only ever targets. Release the keys to attack — holding a direction through the windup throws the attack away, exactly as a click does.',
            keys: ['W', 'A', 'S', 'D', 'Q', 'E', 'R', 'F'],
          },
        ],
      },
      {
        kind: 'choice',
        key: 'tumbleAim',
        label: 'Dash aim',
        wasdOnly: true,
        terms: 'tumble dash vayne aim cursor keys',
        options: [
          {
            value: 'hands',
            name: 'THE KEYS',
            body: 'A dash goes where you are holding, and falls back to the cursor when no key is down. Under WASD your mouse is holding the target and your keys are holding the exit — this points Tumble at the exit.',
          },
          {
            value: 'cursor',
            name: 'THE CURSOR',
            body: 'League’s literal behaviour: a dash always goes to the cursor, whatever your hands are doing. Exact transfer, at the cost of aiming your escape with the hand that is holding your target.',
          },
        ],
      },
    ],
  },
  {
    id: 'controls',
    name: 'Controls',
    blurb: 'Every binding, per scheme. Click a key and press the one you want.',
    items: [{ kind: 'bindings', label: 'Key bindings', terms: 'keybind rebind hotkey key mouse button ability smite flash' }],
  },
  {
    id: 'gameplay',
    name: 'Gameplay',
    blurb: 'What the game does with your input, and what it draws to help you read it.',
    items: [
      {
        kind: 'toggle',
        key: 'quickCast',
        label: 'Quick cast',
        hint: 'Abilities fire at the cursor on key press. Off means press to arm, click to confirm.',
        terms: 'smart cast abilities',
      },
      {
        kind: 'toggle',
        key: 'showRange',
        label: 'Show attack range',
        hint: 'The dashed ring around you, plus the attack timer arc — the two indicators the orbwalk drills are read off.',
        terms: 'indicator ring circle radius',
      },
      {
        kind: 'toggle',
        key: 'focusMode',
        label: 'Focus mode',
        hint: 'Strips the HUD to the timer, the task, your health and the score. Everything analytical waits for the results screen. F2 toggles it inside a run.',
        terms: 'minimal hud clean distraction zen focus',
      },
      {
        kind: 'toggle',
        key: 'showNames',
        label: 'Show unit names',
        hint: 'Name plates above champions. Health bars are never hidden by this — only the labels above them.',
        terms: 'nameplate label hud text',
      },
    ],
  },
  {
    id: 'camera',
    name: 'Camera & video',
    blurb: 'Everything about the picture. None of it touches the simulation, so scores stay comparable.',
    items: [
      {
        kind: 'toggle',
        key: 'edgePan',
        label: 'Edge pan',
        hint: 'Pushing the cursor to the edge of the screen slides the camera, as League does. Off by default: it moves the camera without being asked.',
        terms: 'scroll screen edge camera move mouse',
      },
      {
        kind: 'toggle',
        key: 'reduceShake',
        label: 'Reduced camera motion',
        hint: 'Stops the camera shaking, punching in and kicking on impacts. Everything you drive it to do — follow, zoom, edge pan — is untouched.',
        terms: 'shake motion sickness accessibility kick',
      },
      {
        kind: 'toggle',
        key: 'lowFx',
        label: 'Reduced effects',
        hint: 'Turns off shadows, bloom and the live arena behind the menus. The simulation is unchanged, so scores stay comparable.',
        terms: 'performance fps quality low graphics shadows bloom',
      },
    ],
  },
  {
    id: 'audio',
    name: 'Audio',
    blurb: 'Three buses. The ambience is the arena behind the menus; effects are everything in a run.',
    items: [
      { kind: 'toggle', key: 'muted', label: 'Mute', hint: 'Silences everything, instantly.', terms: 'sound off silence' },
      { kind: 'slider', key: 'masterVolume', label: 'Master', terms: 'volume loud sound' },
      { kind: 'slider', key: 'sfxVolume', label: 'Effects', terms: 'volume sfx sound hits' },
      { kind: 'slider', key: 'musicVolume', label: 'Ambience', terms: 'volume music ambient arena' },
    ],
  },
];

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

/** Everything an item can be found by, lowercased once per search. */
const haystack = (section: Section, item: Item): string =>
  [
    section.name,
    item.label,
    'hint' in item ? item.hint ?? '' : '',
    item.terms ?? '',
    item.kind === 'choice' ? item.options.map((o) => `${o.name} ${o.body}`).join(' ') : '',
    item.kind === 'bindings' ? [...new Set([...CLICK_ACTIONS, ...WASD_ACTIONS])].map((a) => ACTION_LABELS[a]).join(' ') : '',
    item.kind === 'champion' ? HERO_LIST.map((h) => `${h.name} ${h.role} ${h.title}`).join(' ') : '',
  ]
    .join(' ')
    .toLowerCase();

/** Whether a row is still on the value it shipped with. */
const isDefault = (s: AppSettings, item: Item): boolean => {
  switch (item.kind) {
    case 'toggle':
    case 'slider':
    case 'choice':
      return s[item.key] === DEFAULT_SETTINGS[item.key];
    case 'champion':
      return s.hero === DEFAULT_SETTINGS.hero;
    case 'bindings':
      return Object.keys(s.bindings ?? {}).length === 0 && Object.keys(s.wasdBindings ?? {}).length === 0;
  }
};

/** The patch that puts one row back to its default. */
const resetPatch = (item: Item): Partial<AppSettings> => {
  switch (item.kind) {
    case 'toggle':
    case 'slider':
      return { [item.key]: DEFAULT_SETTINGS[item.key] } as Partial<AppSettings>;
    case 'choice':
      return item.key === 'movementScheme'
        ? { movementScheme: DEFAULT_SETTINGS.movementScheme }
        : { tumbleAim: DEFAULT_SETTINGS.tumbleAim };
    case 'champion':
      return { hero: DEFAULT_SETTINGS.hero };
    case 'bindings':
      return { bindings: {}, wasdBindings: {} };
  }
};

// --------------------------------------------------------------------- screen

export function Settings({ settings, onChange, onBack }: Props) {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const scheme: MovementScheme = settings.movementScheme ?? 'click';
  const wasd = scheme === 'wasd';

  // A section's rows, minus the ones this scheme does not ask about.
  const visibleItems = (s: Section): Item[] =>
    s.items.filter((i) => !(i.kind === 'choice' && 'wasdOnly' in i && i.wasdOnly && !wasd));

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    const words = q.split(/\s+/);
    const out: { section: Section; item: Item }[] = [];
    for (const section of SECTIONS) {
      for (const item of visibleItems(section)) {
        const hay = haystack(section, item);
        if (words.every((w) => hay.includes(w))) out.push({ section, item });
      }
    }
    return out;
    // `wasd` decides which rows exist at all, so it belongs in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, wasd]);

  const changedIn = (s: Section): number => visibleItems(s).filter((i) => !isDefault(settings, i)).length;

  // "/" focuses search from anywhere on the page, the way every list-shaped
  // screen on the web works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && typing && query) {
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query]);

  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const hero = heroFor(settings.hero);

  const resetSection = (s: Section) => {
    audio.play('uiClick');
    let patch: Partial<AppSettings> = {};
    for (const item of s.items) patch = { ...patch, ...resetPatch(item) };
    onChange(patch);
  };

  return (
    <div className="scroll">
      <div className="wrap settings fade-up">
        <div className="set-top">
          <div>
            <div className="eyebrow">Configuration</div>
            <h1 className="display set-h1">SETTINGS</h1>
          </div>
          <label className="set-search">
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16 L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder="Search every setting…"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search settings"
            />
            {query ? (
              <button className="ss-clear" onClick={() => setQuery('')} aria-label="Clear search">
                ✕
              </button>
            ) : (
              <kbd className="kbd">/</kbd>
            )}
          </label>
        </div>

        <div className="set-shell">
          {/* ------------------------------------------------------- nav */}
          <nav className="set-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => {
              const changed = changedIn(s);
              return (
                <button
                  key={s.id}
                  className={`sn-item${!q && s.id === active ? ' on' : ''}`}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    audio.play('uiTab');
                    setQuery('');
                    setActive(s.id);
                  }}
                >
                  <span className="sn-name">{s.name}</span>
                  {changed > 0 && <i className="sn-dot" title={`${changed} changed from default`} />}
                </button>
              );
            })}

            <div className="sn-hero">
              <span className="eyebrow">Playing as</span>
              <button
                className="sn-hero-card"
                style={{ ['--c' as string]: hero.accent }}
                onMouseEnter={() => audio.play('uiHover')}
                onClick={() => {
                  audio.play('uiTab');
                  setQuery('');
                  setActive('champion');
                }}
              >
                <HeroSigil hero={hero.id} size={26} />
                <b>{hero.name}</b>
                <em>CHANGE</em>
              </button>
            </div>

            <button
              className="btn ghost sm sn-reset"
              onClick={() => {
                audio.play('uiBack');
                for (const s of SECTIONS) resetSection(s);
              }}
            >
              Restore all defaults
            </button>
          </nav>

          {/* ---------------------------------------------------- content */}
          <div className="set-body">
            {results ? (
              <section className="panel pad">
                <div className="panel-title">
                  {results.length} {results.length === 1 ? 'setting' : 'settings'} matching “{query.trim()}”
                </div>
                {results.length === 0 ? (
                  <p className="set-note">
                    Nothing matches. Try the thing it does rather than its name — “shake”, “volume”,
                    “range”, “champion”.
                  </p>
                ) : (
                  results.map(({ section: s, item }, i) => (
                    <div className="set-result" key={`${s.id}-${i}`}>
                      <button
                        className="set-result-in"
                        onClick={() => {
                          audio.play('uiTab');
                          setQuery('');
                          setActive(s.id);
                        }}
                      >
                        {s.name}
                      </button>
                      <Row
                        item={item}
                        settings={settings}
                        onChange={onChange}
                        wasd={wasd}
                        scheme={scheme}
                      />
                    </div>
                  ))
                )}
              </section>
            ) : (
              <section className="panel pad" key={section.id}>
                <div className="set-head">
                  <div>
                    <div className="panel-title" style={{ margin: 0 }}>
                      {section.name}
                    </div>
                    <p className="set-blurb">{section.blurb}</p>
                  </div>
                  <button
                    className="btn ghost sm"
                    disabled={changedIn(section) === 0}
                    onClick={() => resetSection(section)}
                  >
                    Restore defaults
                  </button>
                </div>

                {visibleItems(section).map((item, i) => (
                  <Row
                    key={`${section.id}-${i}`}
                    item={item}
                    settings={settings}
                    onChange={onChange}
                    wasd={wasd}
                    scheme={scheme}
                  />
                ))}

                {section.id === 'movement' && (
                  <p className="set-note">
                    {wasd
                      ? 'W, A, S and D drive the champion, so the ability row moves one seat over: Q, E, R and F are Q, W, E and R, the summoners are 1 and 2, and stop is X. Every binding is under Controls, and applies to this scheme only.'
                      : 'Scores are identical under either scheme — both obey the same windup rule, and the free-movement window is measured the same way.'}
                  </p>
                )}
                {section.id === 'controls' && hasBrowserMouseGestures() && (
                  <p className="set-note">
                    <b className="warn">Opera mouse gestures.</b> Right-drag and
                    right-click&nbsp;+&nbsp;left-click are browser gestures — new tab, and back — and they
                    are the same inputs used here to move and attack-move. The browser handles them above
                    the page, so this trainer cannot block them: turn them off in{' '}
                    <b>Settings → Browser → Shortcuts</b>, or rebind <b>Move</b> above to a button gestures
                    do not use.
                  </p>
                )}
              </section>
            )}
          </div>
        </div>

        <button className="btn ghost lg" style={{ marginTop: 26 }} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- one row

function Row({
  item,
  settings,
  onChange,
  wasd,
  scheme,
}: {
  item: Item;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  wasd: boolean;
  scheme: MovementScheme;
}) {
  const changed = !isDefault(settings, item);

  switch (item.kind) {
    case 'toggle':
      return (
        <Toggle
          label={item.label}
          hint={item.hint}
          changed={changed}
          value={settings[item.key]}
          onChange={(v) => onChange({ [item.key]: v } as Partial<AppSettings>)}
        />
      );
    case 'slider':
      return (
        <Slider
          label={item.label}
          hint={item.hint}
          changed={changed}
          value={settings[item.key]}
          onChange={(v) => onChange({ [item.key]: v } as Partial<AppSettings>)}
        />
      );
    case 'choice':
      return (
        <div className="set-block">
          <div className="set-block-head">
            <div className="opt-label">{item.label}</div>
            {changed && <i className="chg-dot" title="Changed from default" />}
          </div>
          <div className="scheme-pick">
            {item.options.map((o) => {
              const on = (item.key === 'movementScheme' ? scheme : settings.tumbleAim ?? 'hands') === o.value;
              return (
                <button
                  key={o.value}
                  className={`scheme-card${on ? ' on' : ''}`}
                  onMouseEnter={() => audio.play('uiHover')}
                  onClick={() => {
                    if (on) return;
                    audio.play('uiClick');
                    onChange(
                      item.key === 'movementScheme'
                        ? { movementScheme: o.value as MovementScheme }
                        : { tumbleAim: o.value as 'hands' | 'cursor' },
                    );
                  }}
                >
                  <div className="sc-head">
                    <b>{o.name}</b>
                    {o.sub && <span>{o.sub}</span>}
                  </div>
                  <p>{o.body}</p>
                  {o.keys && (
                    <div className="sc-keys">
                      {o.keys.map((k) => (
                        <kbd className="kbd" key={k}>
                          {k}
                        </kbd>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      );
    case 'champion':
      return (
        <div className="set-block">
          <HeroRoster
            value={settings.hero}
            onChange={(id: HeroId) => onChange({ hero: id })}
            lowFx={settings.lowFx}
          />
        </div>
      );
    case 'bindings':
      return <Bindings settings={settings} onChange={onChange} wasd={wasd} scheme={scheme} />;
  }
}

// -------------------------------------------------------------- bindings

function Bindings({
  settings,
  onChange,
  wasd,
  scheme,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  wasd: boolean;
  scheme: MovementScheme;
}) {
  const [capturing, setCapturing] = useState<ActionId | null>(null);
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
    <div className="set-block">
      <div className="set-block-head">
        <div className="opt-label">
          Bindings · <span className="mono">{wasd ? 'WASD' : 'CLICK TO MOVE'}</span>
        </div>
        <button
          className="btn ghost sm"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => onChange(wasd ? { wasdBindings: {} } : { bindings: {} })}
        >
          Reset this scheme
        </button>
      </div>
      <p className="opt-hint" style={{ maxWidth: 'none', marginBottom: 10 }}>
        These bindings apply to the <b>{wasd ? 'WASD' : 'click-to-move'}</b> scheme only — the other keeps
        its own, so switching schemes never damages a layout you have tuned.
      </p>
      <div className="bind-list">
        {actions.map((a) => {
          const b = bindingFor(a);
          const rebound = overrides[a] !== undefined;
          return (
            <div className={`bind-row${rebound ? ' rebound' : ''}`} key={a}>
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
      <p className="set-note">
        Attack-move fires on the confirm button while the modifier is held. A bare left click also issues
        an attack-move, so you can train the habit without being punished for forgetting the modifier.{' '}
        {wasd
          ? 'Under WASD an attack order never walks you anywhere — it only chooses what you shoot.'
          : 'R doubles as instant reset in drills with no ultimate bound.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- controls

function Toggle({
  label,
  hint,
  value,
  changed,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  changed?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="opt-row">
      <div>
        <div className="opt-label">
          {label}
          {changed && <i className="chg-dot" title="Changed from default" />}
        </div>
        {hint && <div className="opt-hint">{hint}</div>}
      </div>
      <button
        className={`switch ${value ? 'on' : ''}`}
        onClick={() => {
          audio.play('uiClick');
          onChange(!value);
        }}
        aria-pressed={value}
        aria-label={label}
      >
        <span />
      </button>
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  changed,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  changed?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="opt-row">
      <div>
        <div className="opt-label">
          {label}
          {changed && <i className="chg-dot" title="Changed from default" />}
        </div>
        {hint && <div className="opt-hint">{hint}</div>}
      </div>
      <div className="slider-wrap">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="mono">{Math.round(value * 100)}</span>
      </div>
    </div>
  );
}

const preventDefault = (e: Event) => e.preventDefault();
