import { Fragment, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { audio } from '../engine/audio';
import {
  InputSystem,
  MOVE_ACTIONS,
  UNBOUND,
  codeLabel,
  resolveBindings,
  shortCodeLabel,
  type AbilitySlot,
  type ActionId,
  type Bindings,
  type MovementScheme,
} from '../engine/input';
import { GameLoop } from '../engine/loop';
import { derive } from '../engine/metrics';
import { clearPaint, newPaint } from '../engine/paint';
import { ABILITY_BAR, RANGE_CHECK_SECONDS, Session, type HudSnapshot } from '../engine/session';
import { RiftRenderer } from '../gfx/RiftRenderer';
import { arenaFor, createDrill } from '../drills';
import { DRILLS, type DrillId } from '../drills/catalog';
import { MAP_KEYS, ORDER_LABEL, keysAtLevel, ordersAtLevel } from '../drills/apm';
import { RUN_MODES, SURVIVE_STRIKES, durationFor, hasMovingFloor, type RunMode } from '../drills/modes';
import { difficultyLevel } from '../progression/apmladder';
import type { AppSettings, RunResult } from '../progression/profile';
import { Minimap } from './hud/Minimap';
import { Settings } from './Settings';
import './gameview.css';

interface Props {
  drill: DrillId;
  /** PLAY is a one-minute rep; SURVIVE runs until it beats you. */
  mode: RunMode;
  difficulty: number;
  /**
   * Overrides the length the mode would otherwise imply.
   *
   * There is exactly one mode that sets it. PLAY is a minute everywhere else
   * and that is the point of it — but a lane phase whose length was decided by
   * the mode system rather than by the lane would be a lane phase that could
   * not contain a lane phase, and the run length there is part of what the
   * player is choosing.
   */
  durationOverride?: number;
  seed: number;
  settings: AppSettings;
  /**
   * Settings changed from inside the run.
   *
   * The pause screen opens the real settings panel, not a cut-down copy of it,
   * because the moment a player wants to change a binding is the moment the
   * binding just failed them — and that moment is always mid-drill.
   */
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  /** Label shown above the drill name, e.g. "CALIBRATION 2 / 5". */
  context?: string;
  onComplete: (result: RunResult, bounds: { w: number; h: number }) => void;
  onExit: () => void;
  onRetry: () => void;
}

/**
 * A sigil per slot.
 *
 * League's ability icons are art, and art is the one thing this trainer does
 * not generate. What it can do is give each slot a shape that is distinct at
 * 20 pixels — which is the only property of an ability icon that matters in a
 * fight — and match it to the sound that slot makes: Q is a dart, W is a
 * shield arc, E is a dash, R is a burst.
 */
const SLOT_GLYPH: Record<string, ReactElement> = {
  q: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 20 L20 4 M20 4 L20 11 M20 4 L13 4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  w: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3 L20 7 V12 C20 17 16 20 12 21.5 C8 20 4 17 4 12 V7 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
  e: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M3 12 H15 M10 7 L15 12 L10 17 M18 6 V18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  r: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2 L14.4 9.2 L21.5 12 L14.4 14.8 L12 22 L9.6 14.8 L2.5 12 L9.6 9.2 Z" fill="currentColor" />
    </svg>
  ),
  d: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 5.5 V12 L16 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  f: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M13 2 L5 13 H11 L10 22 L19 10 H13 Z" fill="currentColor" />
    </svg>
  ),
};

/**
 * Which scheme this run is played under.
 *
 * The profile decides, except where a drill only means anything under one of
 * them. The academy is the whole of that exception: its modules are about the
 * things two independent hands can do, and running them with a mouse would not
 * be an easier version of the lesson, it would be a different lesson entirely.
 */
const schemeFor = (settings: AppSettings, drill: DrillId): MovementScheme =>
  DRILLS[drill].forceScheme ?? settings.movementScheme ?? 'click';

const bindingsFor = (settings: AppSettings, drill: DrillId): Bindings => {
  const scheme = schemeFor(settings, drill);
  return resolveBindings(scheme, scheme === 'wasd' ? settings.wasdBindings : settings.bindings);
};

/**
 * One line of the hint row.
 *
 * The id is what the drill-specific rows filter on. It used to be the label
 * text, which meant a row could only be kept by matching an English sentence
 * against a list of English sentences — and one of those sentences had been
 * edited since the list was written, so the row it named had quietly stopped
 * being kept at all.
 */
interface Hint {
  id: string;
  key: string;
  label: string;
}

/** The key an action is on, as printed. */
const keyOf = (b: Bindings, action: ActionId): string => shortCodeLabel(b[action].primary);

/**
 * Four movement keys as one chip.
 *
 * WASD reads as a word and W A S D does not, so single-character keys are run
 * together; the moment one of them is Left Shift they need the space back.
 */
const joinKeys = (keys: string[]): string =>
  keys.every((k) => k.length === 1) ? keys.join('') : keys.join(' ');

/**
 * The hint row, read off the player's own layout.
 *
 * Every key in it used to be a string literal — RMB, A, S, SPACE, Y — which
 * was true of a fresh profile and of nothing else. A hint row that names the
 * key you have not got is worse than no hint row: it is the first thing a new
 * player reads and the reason they conclude the drill is broken.
 */
const baseHints = (scheme: MovementScheme, b: Bindings): Hint[] => {
  // Escape pauses whatever Pause is bound to — the input system guarantees it
  // — so this row is the one that is honest about naming a fixed key.
  const pause = { id: 'pause', key: 'ESC', label: 'pause · settings' };
  const check = { id: 'check', key: keyOf(b, 'centerCamera'), label: 'centre · check range' };
  const zoom = { id: 'zoom', key: 'WHEEL', label: 'zoom' };
  if (scheme === 'wasd') {
    // The confirm button rather than the modifier: under WASD the modifier is
    // Shift and what you actually press to shoot something is the click.
    const attack = shortCodeLabel(b.attackMove.secondary ?? 'Mouse0');
    return [
      { id: 'move', key: joinKeys(MOVE_ACTIONS.map((a) => keyOf(b, a))), label: 'move' },
      { id: 'attack', key: attack, label: 'attack' },
      { id: 'abilities', key: (['q', 'w', 'e', 'r'] as ActionId[]).map((a) => keyOf(b, a)).join(' '), label: 'abilities' },
      // Both ways of buying a shot, because there are two and a player who only
      // knows the first one is orbwalking with one hand tied.
      { id: 'release', key: 'RELEASE', label: `or ${attack} to shoot` },
      check,
      zoom,
      pause,
    ];
  }
  return [
    { id: 'move', key: keyOf(b, 'move'), label: 'move · attack' },
    { id: 'attackMove', key: keyOf(b, 'attackMove'), label: 'attack-move' },
    { id: 'stop', key: keyOf(b, 'stop'), label: 'stop' },
    check,
    { id: 'cameraLock', key: keyOf(b, 'cameraLock'), label: 'camera lock' },
    zoom,
    pause,
  ];
};

/** What is actually printed on the ability key, which the player decides. */
const abilityKeyLabel = (settings: AppSettings, drill: DrillId, slot: AbilitySlot): string =>
  shortCodeLabel(bindingsFor(settings, drill)[slot].primary);

/** Vayne's kit, by the name each slot answers to. */
const VAYNE_SLOT_NAMES: Partial<Record<AbilitySlot, string>> = {
  q: 'tumble',
  w: 'bolts',
  e: 'condemn',
  r: 'final hour',
  d: 'ward',
  f: 'flash',
};

/**
 * The groups played from behind a champion, and so the ones whose hint row is
 * the kit rather than the generic ability line.
 *
 * The duels and the Sheriff joined the champion path the moment they started
 * handing you the whole of it: a mode with Condemn in it that prints "abilities"
 * over four unnamed keys is a mode whose ability row is decoration.
 */
const KIT_GROUPS = new Set(['VAYNE', 'CAITLYN', 'COMBAT']);

/**
 * The hint row for this run.
 *
 * On a champion drill the generic "Q E R F · abilities" is worse than useless
 * under WASD, because the row has moved one seat over and the player's whole
 * problem is that Condemn is no longer on E. So a champion drill prints the
 * key each ability is *actually* on, read from the live bindings, with the
 * ability's own name next to it.
 */
const hintsFor = (settings: AppSettings, drill: DrillId, level: number): Hint[] => {
  const scheme = schemeFor(settings, drill);
  const base = baseHints(scheme, bindingsFor(settings, drill));
  const meta = DRILLS[drill];
  /**
   * The generic rows a mode keeps once its own keys have pushed the rest out.
   *
   * A row whose key is unbound is dropped rather than printed as a dash: the
   * player took that action off their keyboard on purpose, and a hint that
   * names no key is a line of the cheat sheet spent saying nothing.
   */
  const keep = (ids: string[]): Hint[] =>
    base.filter((h) => ids.includes(h.id) && h.key !== shortCodeLabel(UNBOUND));
  // The lane is played as Vayne but is not on the champion path, and it has
  // one key nothing else in the client has: recall. A ten minute mode whose
  // most important decision is on an unlabelled key would be a mode where
  // nobody ever backs.
  if (drill === 'lanePhase') {
    const kit = (['q', 'w', 'e', 'r', 'd'] as AbilitySlot[])
      .filter((slot) => VAYNE_SLOT_NAMES[slot] && slot !== 'w')
      .map((slot) => ({ id: slot, key: abilityKeyLabel(settings, drill, slot), label: VAYNE_SLOT_NAMES[slot] as string }));
    return [
      ...keep(scheme === 'wasd' ? ['move', 'attack'] : ['move', 'attackMove']),
      ...kit,
      { id: 'recall', key: abilityKeyLabel(settings, drill, 'f'), label: 'recall' },
      { id: 'pause', key: 'ESC', label: 'pause · settings' },
    ];
  }
  // The lab's two lane keys. The board in the corner prints them under its own
  // lanes, but the first orb of a player's first run is not the moment to be
  // reading a hundred-and-fifty-pixel panel for the first time.
  if (meta.group === 'APM') {
    // The lab's cheat sheet is the rung's, not the mode's. Which keys are in
    // play is a fact about the level — two fingers at the bottom of the ladder
    // and every command it can grade at the top — so a row promising four
    // abilities and a minimap on level one would be naming three things the
    // run is never going to ask for.
    const roster = keysAtLevel(level);
    const bench = meta.abilities.filter((slot) => !MAP_KEYS.includes(slot) && roster.includes(slot));
    const lanes = MAP_KEYS.every((slot) => roster.includes(slot))
      ? MAP_KEYS.map((slot) => abilityKeyLabel(settings, drill, slot)).join(' ')
      : null;
    const orders = ordersAtLevel(level);
    return [
      // The bench is keys and the board is keys; the only pointer row worth a
      // line here is the one that puts the cursor on a pad.
      ...keep(scheme === 'wasd' ? ['move', 'attack'] : ['move']),
      ...(bench.length
        ? [
            {
              id: 'bench',
              key: bench.map((slot) => abilityKeyLabel(settings, drill, slot)).join(' '),
              // Not 'your keys'. A key on this bench is half an answer: the
              // cursor has to be on the pad first, and the cheat sheet is
              // where a player learns that before losing a chain to it.
              label: 'your keys · point first',
            },
          ]
        : []),
      ...(lanes ? [{ id: 'lanes', key: lanes, label: 'lanes · dodge the map' }] : []),
      ...orders.map((o) => ({
        id: `order-${o}`,
        key: keyOf(bindingsFor(settings, drill), o),
        label: `${ORDER_LABEL[o].toLowerCase()} · the order line`,
      })),
      { id: 'pause', key: 'ESC', label: 'pause · settings' },
    ];
  }
  if (!KIT_GROUPS.has(meta.group)) return base.filter((h) => h.key !== shortCodeLabel(UNBOUND));
  // Silver Bolts is a passive counter rather than a key, so it never appears.
  const kit = meta.abilities
    .filter((slot) => slot !== 'w' && VAYNE_SLOT_NAMES[slot])
    .map((slot) => ({ id: slot, key: abilityKeyLabel(settings, drill, slot), label: VAYNE_SLOT_NAMES[slot] as string }));
  return [
    ...keep(scheme === 'wasd' ? ['move', 'attack'] : ['move', 'attackMove']),
    ...kit,
    { id: 'pause', key: 'ESC', label: 'pause · settings' },
  ];
};

export function GameView({
  drill,
  difficulty,
  durationOverride,
  seed,
  settings,
  onSettingsChange,
  context,
  mode,
  onComplete,
  onExit,
  onRetry,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'countdown' | 'running' | 'paused' | 'ended'>('countdown');
  const [gpuLost, setGpuLost] = useState(false);
  // Focus mode. Seeded from the setting, toggled inside a run with F2, and
  // deliberately local: switching it mid-run is a decision about this run.
  const [focus, setFocus] = useState(settings.focusMode);
  const [focusToast, setFocusToast] = useState(false);
  /** The settings panel, opened from the pause screen. */
  const [setup, setSetup] = useState(false);

  // The simulation is built once and then left alone, so anything React owns
  // that the loop has to read lives behind a ref rather than in the closure the
  // loop was created with. Without these, a setting changed mid-run would not
  // reach the arena until the next run — which is exactly the complaint that
  // put a settings panel on the pause screen in the first place.
  const sessionRef = useRef<Session | null>(null);
  const inputRef = useRef<InputSystem | null>(null);
  const rendererRef = useRef<RiftRenderer | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => setFocus(settings.focusMode), [settings.focusMode]);

  useEffect(() => {
    // Not while the settings panel owns the screen: F2 belongs to the run, and
    // the panel is a place where a stray function key should do nothing.
    if (setup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'F2') return;
      e.preventDefault();
      setFocus((v) => !v);
      setFocusToast(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setup]);

  useEffect(() => {
    if (!focusToast) return;
    const t = window.setTimeout(() => setFocusToast(false), 1400);
    return () => window.clearTimeout(t);
  }, [focusToast, focus]);
  const doneRef = useRef(false);
  const meta = DRILLS[drill];
  // The mode decides the clock, not the mode's contents: every PLAY run is a
  // minute and every SURVIVE run is open-ended, which is the whole point of
  // there being two of them.
  const duration = durationOverride ?? durationFor(mode);
  const surviving = mode === 'survive';
  // The lab's open-ended shape. It has no clock and no rung: the floor moves
  // under the player for as long as they keep going, so the HUD prints a live
  // level instead of a fixed difficulty and the pause screen has to offer a
  // way of stopping that still counts.
  const infinite = mode === 'infinite';
  // The lab's other moving floor. It has a clock like PLAY, so the only thing
  // the HUD changes is the right-hand readout: a difficulty that moves has to
  // be a live number rather than ten pips printed once at the top of the run.
  const surging = mode === 'surge';
  // The two shapes whose difficulty moves while you stand on it. Everything
  // the HUD does differently for them is the same thing: print a live rung
  // instead of a setting.
  const living = hasMovingFloor(mode);
  // Printed rather than assumed: instant reset is rebindable, so the pause
  // screen has to read the binding instead of promising a key that may have
  // moved.
  const resetKey = codeLabel(bindingsFor(settings, drill).reset.primary);

  // Everything below lives outside React on purpose: the simulation must not
  // be driven by, or wait on, a render pass.
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const host = hostRef.current;
    const minimapCanvas = minimapRef.current;
    if (!canvas || !host || !overlay || !minimapCanvas) return;
    doneRef.current = false;

    const bounds = arenaFor(drill);
    // The APM section is played on the bench rather than in the stadium: the
    // same floor, with everything that belongs to the game switched off.
    const renderer = new RiftRenderer(
      canvas,
      overlay,
      bounds,
      meta.accent,
      seed % 997,
      meta.group === 'APM' ? 'lab' : 'rift',
    );
    renderer.setQuality(settings.lowFx ? 'low' : 'high');
    if (meta.zoom !== undefined) renderer.setZoom(meta.zoom);
    const minimap = new Minimap(minimapCanvas);
    minimap.resize(158);
    const minimapHost = minimapCanvas.parentElement;

    const scheme = schemeFor(settings, drill);
    const input = new InputSystem({
      bindings: bindingsFor(settings, drill),
      quickCast: settings.quickCast,
      activeSlots: new Set<AbilitySlot>(meta.abilities),
      scheme,
    });
    const session = new Session(
      {
        duration,
        mode,
        arena: bounds,
        seed,
        difficulty,
        abilities: meta.abilities,
        scheme,
        // So a drill that prints a key prints the player's key. The lab is the
        // only thing that reads it, and it is the whole of its console.
        bindings: bindingsFor(settings, drill),
        tumbleAim: settings.tumbleAim ?? 'hands',
        hero: settings.hero,
        fogOfWar: settings.fogOfWar !== false,
        negativeFeedback: settings.negativeFeedback === true,
      },
      input,
      renderer,
    );
    sessionRef.current = session;
    inputRef.current = input;
    rendererRef.current = renderer;
    const drillInstance = createDrill(drill, session);
    session.attachDrill(drillInstance);
    session.onResetRequest = () => {
      if (session.phase === 'ended') return;
      session.abort();
    };

    const paint = newPaint();

    // An opt-in handle for automated testing and for players who want to
    // inspect a run. Off unless ?debug is present, so it never ships as a
    // stray global.
    const debug = typeof location !== 'undefined' && location.search.includes('debug');
    if (debug) {
      (window as unknown as { __apex?: unknown }).__apex = { session, drill: drillInstance, renderer, input, bounds };
    }

    input.attach(canvas);
    renderer.resize();
    audio.unlock();
    audio.stopAmbience();
    audio.startArenaBed();

    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(host);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      renderer.zoomBy(Math.sign(e.deltaY) * 0.09);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Last line of defence for a run in progress. Opera's back gesture is a
    // right-drag — the same input used to move — so a misfire used to unload
    // the page mid-drill with no way back. The in-app history guard catches
    // almost all of those; this catches the rest.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (doneRef.current || session.phase === 'ended') return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // --- HUD elements, written to directly each frame -------------------
    const hud = hudRef.current!;
    const q = <T extends Element>(sel: string) => hud.querySelector(sel) as T;
    const elTime = q<HTMLDivElement>('[data-time]');
    const strikePips = Array.from(hud.querySelectorAll('[data-strikes] i')) as HTMLElement[];
    let lastStrikes = -1;
    const elScore = q<HTMLDivElement>('[data-score]');
    const elChain = q<HTMLDivElement>('[data-chain]');
    const elChainN = q<HTMLDivElement>('[data-chain-n]');
    const elHp = q<HTMLDivElement>('[data-hp]');
    const elHpText = q<HTMLDivElement>('[data-hp-text]');
    const elCycle = q<HTMLDivElement>('[data-cycle]');
    const elCycleFill = q<HTMLDivElement>('[data-cycle-fill]');
    const elCycleLabel = q<HTMLDivElement>('[data-cycle-label]');
    const elFps = q<HTMLDivElement>('[data-fps]');
    const diffPips = Array.from(hud.querySelectorAll('[data-diff] span')) as HTMLElement[];
    const elRung = hud.querySelector<HTMLDivElement>('[data-rung]');
    let lastPips = -1;
    const elCam = q<HTMLDivElement>('[data-cam]');
    const elCheck = hud.querySelector<HTMLDivElement>('[data-check]');
    const elCheckFill = hud.querySelector<HTMLDivElement>('[data-check-fill]');
    const elBanner = q<HTMLDivElement>('[data-banner]');
    const elCount = q<HTMLDivElement>('[data-count]');
    const fieldEls = Array.from(hud.querySelectorAll('[data-field]')) as HTMLDivElement[];
    const abilityEls = Array.from(hud.querySelectorAll('[data-ability]')) as HTMLDivElement[];

    const abilityCd: number[] = [];
    let lastCount = '';
    let lastHudWrite = 0;
    let lastPhase: string = session.phase;
    let endedAt = 0;
    let slowFrames = 0;
    let quality: 'high' | 'medium' | 'low' = settings.lowFx ? 'low' : 'high';

    const writeHud = (snap: HudSnapshot, now: number) => {
      if (now - lastHudWrite < 42) return;
      lastHudWrite = now;
      // In PLAY this counts down to the end of the minute; in SURVIVE it
      // counts up, because how long you lasted *is* the result.
      const t = snap.timeLeft;
      elTime.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      elTime.classList.toggle('urgent', duration > 0 && t < 5.5);

      if (strikePips.length && session.strikes !== lastStrikes) {
        lastStrikes = session.strikes;
        strikePips.forEach((pip, i) => pip.classList.toggle('spent', i < session.strikes));
      }

      elScore.textContent = snap.score.toLocaleString();

      // The floor, when the floor moves. Everywhere else these ten pips are a
      // setting; in the infinite run they are the mode's whole read-out, so
      // they are written every frame the rung changes rather than once at the
      // top of the run.
      if (elRung) {
        const lab = drillInstance as { levelNow?: () => number | null; driftNow?: () => number | null };
        const lvl = lab.levelNow?.() ?? difficultyLevel(difficulty);
        const drift = lab.driftNow?.() ?? 0;
        elRung.textContent = lvl.toFixed(1);
        elRung.dataset.drift = drift > 0.05 ? 'up' : drift < -0.05 ? 'down' : 'hold';
        const lit = Math.max(1, Math.round(lvl));
        if (lit !== lastPips) {
          lastPips = lit;
          diffPips.forEach((pip, i) => pip.classList.toggle('on', i < lit));
        }
      }

      // A drill with no health pool — the lab benches, where nothing can hurt
      // you and there is no body to hurt — shows no bar at all. A permanently
      // full one is a question the mode never asks.
      const pooled = snap.maxHp > 1;
      elHp.parentElement?.classList.toggle('empty', !pooled);
      const hpPct = Math.max(0, (snap.hp / Math.max(1, snap.maxHp)) * 100);
      elHp.style.width = `${pooled ? hpPct : 0}%`;
      elHp.classList.toggle('low', pooled && hpPct < 30);
      elHpText.textContent = pooled ? `${Math.round(snap.hp)} / ${Math.round(snap.maxHp)}` : 'NO POOL';

      // The attack-cycle bar. This is the drill's whole thesis made visible:
      // amber means committed, green means the backswing is yours to cancel.
      const phaseName = snap.attackPhase;
      elCycle.dataset.state = phaseName;
      if (phaseName === 'windup') {
        elCycleFill.style.width = `${snap.attackPhaseT * 100}%`;
        elCycleLabel.textContent = 'WINDUP · COMMITTED';
      } else if (phaseName === 'backswing') {
        elCycleFill.style.width = `${(1 - snap.attackPhaseT) * 100}%`;
        elCycleLabel.textContent = 'BACKSWING · FREE TO MOVE';
      } else {
        elCycleFill.style.width = `${snap.attackCd * 100}%`;
        elCycleLabel.textContent = snap.attackCd > 0.02 ? 'WINDING DOWN' : 'READY';
      }

      if (snap.chain >= 2) {
        elChain.classList.add('on');
        elChainN.textContent = `${snap.chain}`;
        elChain.style.setProperty('--intensity', String(Math.min(1, snap.chain / 10)));
      } else {
        elChain.classList.remove('on');
      }

      for (let i = 0; i < fieldEls.length; i++) {
        const f = snap.fields[i];
        const el = fieldEls[i];
        if (!f) {
          el.style.display = 'none';
          continue;
        }
        el.style.display = '';
        const l = el.querySelector('[data-fl]') as HTMLElement;
        const v = el.querySelector('[data-fv]') as HTMLElement;
        const b = el.querySelector('[data-fb]') as HTMLElement;
        if (l.textContent !== f.label) l.textContent = f.label;
        if (v.textContent !== f.value) v.textContent = f.value;
        v.className = `hud-field-value tone-${f.tone ?? 'neutral'}`;
        if (f.bar === undefined) {
          b.style.display = 'none';
        } else {
          b.style.display = '';
          (b.firstElementChild as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, f.bar)) * 100)}%`;
        }
      }

      for (let i = 0; i < abilityEls.length; i++) {
        const a = snap.abilities[i];
        const el = abilityEls[i];
        if (!a) continue;
        el.classList.toggle('locked', a.locked);
        el.classList.toggle('highlight', a.highlight);
        // The radial sweep, exactly as a MOBA draws it: a dark wedge that
        // unwinds anticlockwise, so how much is left is a shape rather than
        // a number you have to read mid-fight.
        el.style.setProperty('--cd', String(a.cd));
        el.classList.toggle('cooling', a.cd > 0.015);
        const prev = abilityCd[i] ?? 0;
        if (prev > 0.04 && a.cd <= 0.015 && !a.locked) {
          // Retrigger the ready flash by taking the class off and forcing a
          // reflow — otherwise a second cooldown in the same element never
          // restarts the animation.
          el.classList.remove('ready');
          void el.offsetWidth;
          el.classList.add('ready');
        }
        abilityCd[i] = a.cd;
        const name = el.querySelector('[data-ab-name]') as HTMLElement;
        if (name.textContent !== a.name) name.textContent = a.name;
      }

      elFps.textContent = `${Math.round(snap.fps)}`;
      if (elCheck && elCheckFill) {
        const burn = Math.max(0, Math.min(1, session.rangeCheckT / RANGE_CHECK_SECONDS));
        elCheck.classList.toggle('on', burn > 0);
        elCheckFill.style.width = `${Math.round(burn * 100)}%`;
      }
      elCam.classList.toggle('unlocked', !renderer.cameraLocked);
      elBanner.textContent = snap.banner ?? '';
      elBanner.style.opacity = snap.banner ? '1' : '0';
      const countText = snap.phase === 'countdown' ? (snap.countdown > 0 ? `${snap.countdown}` : 'GO') : '';
      if (countText !== lastCount) {
        lastCount = countText;
        elCount.textContent = countText;
        elCount.classList.toggle('go', countText === 'GO');
        // Restart the strike animation on every tick rather than letting the
        // number swap silently inside a still element.
        elCount.classList.remove('tick');
        void elCount.offsetWidth;
        if (countText) elCount.classList.add('tick');
      }
      elCount.style.opacity = snap.phase === 'countdown' ? '1' : '0';
    };

    const loop = new GameLoop(
      (dt) => {
        session.cursorWorld = renderer.screenToWorld(input.cursor.x, input.cursor.y);
        session.step(dt);
      },
      (alpha, dtWall) => {
        clearPaint(paint);
        drillInstance.paint(paint, session.world.time);

        const live = settingsRef.current;
        // Settings can be opened from the pause screen, so the frame's taste
        // in punishment is read every frame rather than at construction: a
        // player who turns the red flashes off mid-run gets a run without
        // them, not a run they have to restart.
        session.fx.negative = live.negativeFeedback === true;
        renderer.render(session.world, session.fx, alpha, dtWall, {
          cursor: input.cursor,
          // Your reach is not part of the picture: it is what a range check
          // buys, and a check is the camera-centre key. The two settings that
          // are not the default resolve to a constant.
          rangeReveal:
            live.rangeDisplay === 'always' ? 1 : live.rangeDisplay === 'off' ? 0 : session.rangeCheckAlpha,
          hoverTargetId: session.hoverTargetId,
          pathTrail: session.pathTrail,
          chain: session.chain,
          dimmed: session.phase === 'paused' ? 0.55 : session.dimmed,
          hitFeedback: session.hitFeedback,
          lowFx: live.lowFx,
          reduceShake: live.reduceShake,
          showNames: live.showNames,
          // Only while the run is live: a camera that slides during the
          // countdown or after the buzzer is a camera nobody asked to move.
          // A paused run with the settings panel open is not live.
          allowEdgePan: live.edgePan && session.phase === 'running',
          paint,
          idle: session.phase === 'countdown',
        });

        const now = performance.now();
        writeHud(session.hud(loop.stats.fps), now);
        // The lab's lower rungs run no board and have no terrain to map, so
        // the corner is emptied rather than filled with a picture of an empty
        // bench.
        const hideMap = drillInstance.mapHidden();
        if (minimapHost) minimapHost.style.display = hideMap ? 'none' : '';
        if (!hideMap) {
          minimap.draw(
            session.world,
            renderer.scene.rig.coverage,
            renderer.scene.rig.focus,
            meta.accent,
            // The lab replaces the map of the arena with a board of its own.
            // It is the same corner of the screen asking the same question.
            drillInstance.mapBoard(),
          );
        }

        // Quality falls back on its own rather than asking the player to find
        // a setting. Scores must never depend on the machine.
        if (!live.lowFx) {
          if (loop.stats.fps < 42) slowFrames++;
          else slowFrames = Math.max(0, slowFrames - 2);
          if (slowFrames > 120 && quality === 'high') {
            quality = 'medium';
            renderer.setQuality('medium');
            slowFrames = 0;
          } else if (slowFrames > 180 && quality === 'medium') {
            quality = 'low';
            renderer.setQuality('low');
            slowFrames = 0;
          }
        }

        if (session.phase !== lastPhase) {
          lastPhase = session.phase;
          setPhase(session.phase);
        }

        // Once the run is over the results panel owns the screen. Letting the
        // arena keep rendering behind it costs a full frame budget for a view
        // nobody is looking at — and on a slow machine it starves the reveal.
        if (doneRef.current && endedAt && now - endedAt > 1000) {
          loop.stop();
          return;
        }

        if (session.phase === 'ended' && !doneRef.current) {
          doneRef.current = true;
          endedAt = now;
          const out = drillInstance.outcome();
          const m = session.metrics.m;
          const result: RunResult = {
            drill,
            mode,
            seed,
            difficulty: out.effectiveDifficulty ?? difficulty,
            score: Math.round(out.score),
            performance: out.performance,
            axisPerformance: out.axisPerformance,
            metrics: m,
            derived: derive(m, session.world.player?.maxHp ?? 720),
            // A survive run leads with how long it lasted, because that is
            // what it measured. Everything the mode itself measured follows,
            // in the order it would have led with in PLAY.
            // SURVIVE leads with how long it lasted, because that is what it
            // measured. INFINITE does not: it lasted exactly as long as the
            // player felt like playing, and what it measured is the rung the
            // floor settled at — which the drill puts at the front itself.
            keyMetrics: surviving
              ? [
                  {
                    id: 'survived',
                    label: 'SURVIVED',
                    value: session.elapsed,
                    format: 'sec' as const,
                    direction: 'higher' as const,
                  },
                  ...out.keyMetrics,
                ]
              : out.keyMetrics,
            endReason: session.endReason,
            seconds: session.elapsed,
            strikes: session.strikes,
            helped: out.helped,
            hurt: out.hurt,
            advice: out.advice,
          };
          // Let the death/victory effects land before the results take over.
          window.setTimeout(() => onComplete(result, bounds), session.endReason === 'abort' ? 0 : 700);
        }
      },
    );
    loop.start();

    // Browsers can take the GPU back — Opera GX's RAM and CPU limiters make it
    // markedly more likely than elsewhere. Unhandled, that is a black canvas
    // and a run that quietly stops meaning anything. Freeze it, say so, and
    // let the player restart on their own terms.
    const onContextLost = (e: Event) => {
      // Without preventDefault the context can never come back at all.
      e.preventDefault();
      loop.stop();
      if (session.phase === 'running') session.phase = 'paused';
      setGpuLost(true);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    return () => {
      loop.stop();
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      window.removeEventListener('beforeunload', onBeforeUnload);
      input.detach();
      session.fx.clear();
      audio.stopArenaBed();
      renderer.dispose();
      sessionRef.current = null;
      inputRef.current = null;
      rendererRef.current = null;
      if (debug) delete (window as unknown as { __apex?: unknown }).__apex;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, difficulty, seed, duration, mode]);

  /**
   * Push a changed setting into the run that is already going.
   *
   * Bindings are the point of this: a rebind made on the pause screen has to
   * be live the moment the run resumes, or the player is testing the old
   * layout and concluding, correctly, that rebinding does not work. Everything
   * the simulation reads out of its config is updated in place for the same
   * reason — only `arena`, `seed` and `difficulty` are fixed for the life of a
   * run, because those are what make one run comparable to another.
   */
  useEffect(() => {
    const session = sessionRef.current;
    const input = inputRef.current;
    if (!session || !input) return;
    const scheme = schemeFor(settings, drill);
    input.setOptions({
      bindings: bindingsFor(settings, drill),
      quickCast: settings.quickCast,
      scheme,
    });
    session.config.scheme = scheme;
    // The lab reads this every frame it prints a key on, so a rebind made on
    // the pause screen is on the bench by the time the panel closes.
    session.config.bindings = bindingsFor(settings, drill);
    session.config.tumbleAim = settings.tumbleAim ?? 'hands';
    // Under WASD the champion is steered rather than sent, and that is a flag
    // on the actor: switching schemes mid-run has to move it, or the champion
    // keeps obeying the scheme the run started under.
    const player = session.world.player;
    if (player) player.directControl = scheme === 'wasd';
    rendererRef.current?.setQuality(settings.lowFx ? 'low' : 'high');
  }, [settings, drill]);

  const resume = useCallback(() => {
    // Straight at the session. This used to synthesise an Escape keypress,
    // which quietly made the Resume button depend on Escape still being bound
    // to pause — press it after rebinding pause and nothing happened.
    const session = sessionRef.current;
    if (!session) return;
    setSetup(false);
    session.togglePause();
    setPhase(session.phase);
  }, []);

  /**
   * Stop the infinite run, and keep it.
   *
   * Straight at the session, like Resume: the run ends the way a clock would
   * have ended it, so the frame after this one builds the result and the
   * screen that follows is the results screen rather than the menu. The Exit
   * button next to it still throws the run away, which is the distinction a
   * player means when they choose between the two.
   */
  const endRun = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    audio.play('uiClick');
    session.finish();
    setPhase(session.phase);
  }, []);

  /**
   * Settings, from inside the run.
   *
   * Opening it suspends input rather than detaching it: the arena stays
   * exactly where it was, and every key the player presses belongs to the
   * panel — so rebinding Q does not also cast Q, and Escape closes the panel
   * instead of resuming the run underneath it.
   */
  const openSetup = useCallback(() => {
    const session = sessionRef.current;
    if (session && session.phase !== 'paused' && session.phase !== 'ended') session.togglePause();
    inputRef.current?.setSuspended(true);
    audio.play('uiTab');
    setSetup(true);
    if (session) setPhase(session.phase);
  }, []);

  const closeSetup = useCallback(() => {
    inputRef.current?.setSuspended(false);
    audio.play('uiBack');
    setSetup(false);
  }, []);

  useEffect(() => {
    if (!setup) return;
    const onKey = (e: KeyboardEvent) => {
      // The rebind capture in the panel swallows Escape first (it means
      // "cancel this capture" there), so this only ever sees a stray one.
      if (e.code !== 'Escape' || e.defaultPrevented) return;
      const el = document.activeElement;
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value !== '') return;
      e.preventDefault();
      closeSetup();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setup, closeSetup]);

  // A run that ends while the panel is open — the buzzer does not wait for a
  // menu — takes the panel with it, and hands the keyboard back.
  useEffect(() => {
    if (setup && (phase === 'ended' || gpuLost)) {
      inputRef.current?.setSuspended(false);
      setSetup(false);
    }
  }, [setup, phase, gpuLost]);

  // Leaving the run at all releases the suspension, whatever route out was
  // taken: restart, exit, or the component simply going away.
  useEffect(() => () => inputRef.current?.setSuspended(false), []);

  return (
    <div className="game-host" ref={hostRef}>
      <canvas ref={canvasRef} className="game-canvas" tabIndex={0} />
      <canvas ref={overlayRef} className="game-overlay" />

      <div className={`hud${focus ? ' hud-focus' : ''}`} ref={hudRef}>
        <div className="hud-objective panel-rift">
          {context && <div className="hud-context">{context}</div>}
          <div className="hud-name">{meta.name}</div>
          <div className="hud-tag">{meta.tagline}</div>
          <div className="hud-brief">{meta.brief}</div>
        </div>

        <div className={`hud-clock${surviving ? ' surviving' : ''}${infinite ? ' infinite' : ''}${surging ? ' surging' : ''}`}>
          <div className="hud-mode">{RUN_MODES[mode].label}</div>
          <div className="hud-time num" data-time>
            0:00
          </div>
          {/* A run with no clock has to say how it ends, on screen, from the
              first second — the button is behind the pause key and nothing
              else in the client has ever needed one. */}
          {infinite && (
            <div className="hud-endnote">
              <b className="kbd">{shortCodeLabel(bindingsFor(settings, drill).pause.primary)}</b> to end &amp; score
            </div>
          )}
          {/* The strike budget, and only in the mode that spends one. In PLAY
              a mistake costs you score and nothing else, and a row of pips
              counting down to nothing would be a threat the mode never
              carries out. */}
          {surviving && (
            <div className="hud-strikes" data-strikes>
              {Array.from({ length: SURVIVE_STRIKES }).map((_, i) => (
                <i key={i} />
              ))}
            </div>
          )}
          <div className="hud-score-row">
            <span className="hud-score-label">SCORE</span>
            <span className="hud-score num" data-score>
              0
            </span>
          </div>
        </div>

        <div className="hud-right">
          <div className={`hud-diff${living ? ' living' : ''}`}>
            <span className="hud-diff-label">{living ? 'LEVEL' : 'DIFFICULTY'}</span>
            {/* In PLAY and SURVIVE this is a setting, printed once. In the two
                modes whose floor moves it is the mode: the rung is what the
                tide is looking for, and what a streak is buying, so it is a
                live number with the direction of travel on it rather than ten
                pips nobody has to watch. */}
            {living && (
              <div className="hud-rung num" data-rung data-drift="hold">
                {difficultyLevel(difficulty).toFixed(1)}
              </div>
            )}
            <div className="diff-bars" data-diff>
              {Array.from({ length: 10 }).map((_, i) => (
                <span key={i} className={i < Math.round(difficulty * 10) ? 'on' : ''} />
              ))}
            </div>
          </div>
          <div className="hud-fps">
            <span data-fps>60</span> FPS
          </div>
        </div>

        <div className="hud-banner" data-banner />
        <div className="hud-count" data-count />

        <div className="hud-chain" data-chain>
          <span className="hud-chain-n num" data-chain-n>
            2
          </span>
          <span className="hud-chain-label">IN A ROW</span>
        </div>

        {/* Six slots rather than five. Five was every mode until the lane,
            which reads on six numbers at once — the clock, the creep score,
            the level, the mana, the gold difference and the scoreline — and
            a lane missing one of them is a lane you cannot judge. Modes with
            fewer fields hide the rest, as they always did. */}
        <div className="hud-stats">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="hud-field" data-field key={i}>
              <div className="hud-field-label" data-fl />
              <div className="hud-field-value tone-neutral" data-fv />
              <div className="hud-field-bar" data-fb>
                <span />
              </div>
            </div>
          ))}
        </div>

        <div className="champ-frame">
          <div className="cf-portrait" style={{ ['--c' as string]: meta.accent }}>
            <svg viewBox="0 0 48 48" aria-hidden>
              <path d="M24 5 L41 38 H7 Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
              <path d="M24 17 L32 33 H16 Z" fill="currentColor" />
            </svg>
            <span className="cf-level">{Math.max(1, Math.round(difficulty * 17) + 1)}</span>
          </div>

          <div className="cf-body">
            <div className="cf-hp">
              <span data-hp />
              <em data-hp-text>—</em>
            </div>

            {/* The attack-cycle bar. Not a League element — League has no
                reason to show you this — but it is the one thing the whole
                trainer is about, so it sits where League puts your resource
                bar: directly under your health, under your hands. */}
            <div className="cf-cycle" data-cycle data-state="idle">
              <span className="cf-cycle-fill" data-cycle-fill />
              <em className="cf-cycle-label" data-cycle-label>
                READY
              </em>
            </div>
          </div>

          <div className="cf-abilities">
            {ABILITY_BAR.map((s, i) => (
              <Fragment key={s}>
                {i === 4 && <div className="ab-sep" />}
                <div className={`ability${i >= 4 ? ' summoner' : ''}`} data-ability style={{ ['--cd' as string]: 0 }}>
                  <span className="ab-face">
                    <span className="ab-glyph">{SLOT_GLYPH[s]}</span>
                    <span className="ab-sweep" />
                    <span className="ab-shine" />
                  </span>
                  <span className="ab-key">{abilityKeyLabel(settings, drill, s)}</span>
                  <span className="ab-name" data-ab-name />
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        {/* Controls, shown once and then gone. A cheat sheet that never
            leaves is a cheat sheet you stop reading and start seeing. */}
        <div className="hud-hints">
          {hintsFor(settings, drill, difficultyLevel(difficulty)).map((h) => (
            <span key={h.id}>
              <b className="kbd">{h.key}</b> {h.label}
            </span>
          ))}
          {/* The one hint about the HUD itself, in the row that fades. */}
          <span>
            <b className="kbd">F2</b> focus mode
          </span>
        </div>

        {/* The range check, as a thing you can see yourself spending.
            Nothing draws your reach any more until this press does, so the
            key has to be visible for the whole run rather than in a hint row
            that fades — and the bar is the check burning down, so a player
            learns how long one lasts by watching one. */}
        {settings.rangeDisplay === 'check' && (
          <div className="hud-check" data-check>
            <b className="kbd">{shortCodeLabel(bindingsFor(settings, drill).centerCamera.primary)}</b>
            <span>RANGE</span>
            <i className="hc-bar">
              <b data-check-fill />
            </i>
          </div>
        )}

        {/* Which camera mode you are in, sat above the minimap where League
            puts its own lock. A sibling rather than a child: the minimap is
            clipped to a cut corner, and a clip-path clips its children too. */}
        <div className="hud-cam" data-cam>
          <svg viewBox="0 0 16 16" aria-hidden>
            <rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path className="shackle" d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <span>CAM</span>
        </div>

        <div className="hud-minimap">
          <canvas ref={minimapRef} />
        </div>

        {focusToast && (
          <div className="hud-focus-toast">
            FOCUS MODE {focus ? 'ON' : 'OFF'}
            <span>F2</span>
          </div>
        )}
      </div>

      {gpuLost && (
        <div className="pause-overlay fade-in">
          <div className="pause-card scale-in">
            <div className="eyebrow">GRAPHICS CONTEXT LOST</div>
            <h2>{meta.name}</h2>
            <p className="dim" style={{ maxWidth: 430, margin: '0 0 22px' }}>
              The browser reclaimed the GPU, so this run has been stopped rather than scored on a
              frozen arena. If it keeps happening, turn off your browser’s RAM and CPU limiters
              (Opera GX: <b>GX Control</b>) or switch on <b>Reduced effects</b> in settings.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={onRetry}>
                Restart drill
              </button>
              <button className="btn ghost" onClick={onExit}>
                Exit drill
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'paused' && !gpuLost && !setup && (
        <div className="pause-overlay fade-in">
          <div className="pause-card scale-in">
            <div className="eyebrow">PAUSED</div>
            <h2>{meta.name}</h2>
            <p className="dim" style={{ maxWidth: 400, margin: '0 0 22px' }}>
              {infinite
                ? 'There is no clock on this one, so this is where you end it. End & score keeps the level you settled on; Exit throws the run away.'
                : meta.brief}
            </p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={resume}>
                Resume
              </button>
              {/* A run with no clock has to have somewhere to put the full
                  stop, and it must not be the same button as "throw this
                  away" — so the one shape that never ends on its own is the
                  one shape with a way of ending that counts. */}
              {infinite && (
                <button className="btn" onClick={endRun}>
                  End run &amp; score
                </button>
              )}
              <button className="btn" onClick={openSetup}>
                Settings
              </button>
              <button className="btn" onClick={onRetry}>
                Restart
              </button>
              <button className="btn ghost" onClick={onExit}>
                Exit drill
              </button>
            </div>
            <p className="pause-keys">
              <kbd className="kbd">Esc</kbd> resume · <kbd className="kbd">{resetKey}</kbd> restart
            </p>
          </div>
        </div>
      )}

      {/* The real settings screen, over the paused arena. Every change lands
          in the run immediately, so a rebind can be tested by closing this and
          pressing the key — which is the only test that actually counts. */}
      {setup && !gpuLost && (
        <div className="setup-overlay fade-in">
          <Settings
            settings={settings}
            onChange={onSettingsChange}
            onBack={closeSetup}
            inRun
            backLabel="Back to the drill"
          />
        </div>
      )}
    </div>
  );
}
