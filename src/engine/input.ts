/**
 * Input capture for the arena.
 *
 * Everything the player does is timestamped the instant the browser hands it
 * to us and pushed onto a queue. The simulation drains that queue at the top
 * of each fixed step, so a click is never "lost" between frames and the
 * recorded reaction times are event timestamps, not frame timestamps.
 */

export type ActionId =
  | 'move'
  | 'attackMove'
  | 'stop'
  | 'moveUp'
  | 'moveLeft'
  | 'moveDown'
  | 'moveRight'
  | 'q'
  | 'w'
  | 'e'
  | 'r'
  | 'd'
  | 'f'
  | 'centerCamera'
  | 'cameraLock'
  | 'reset'
  | 'pause';

export interface Binding {
  /**
   * KeyboardEvent.code, or 'Mouse0' | 'Mouse1' | 'Mouse2'.
   *
   * The empty string means *unbound*: the action exists, the row is still in
   * the settings list, and nothing on the keyboard fires it. Rebinding needs
   * this — the moment one key can only belong to one action, taking a key
   * away from an action has to leave that action somewhere.
   */
  primary: string;
  secondary?: string;
}

export type Bindings = Record<ActionId, Binding>;

/** The primary of an action nothing is bound to. */
export const UNBOUND = '';

/**
 * The keys that only ever modify another key.
 *
 * They are bindable — attack-move sits on Shift under WASD — so the
 * browser-shortcut guard in `onKeyDown` has to let them through even though
 * pressing one sets `ctrlKey`/`altKey`/`metaKey` on its own event.
 */
export const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/**
 * How the champion is driven.
 *
 * `click` is League: right click to move, the click scheme every MOBA habit is
 * built on. `wasd` drives the champion directly with the left hand and leaves
 * the mouse for targeting only — the scheme most shooters and ARPGs use, and
 * the one people coming from those games ask for. Both obey the same windup
 * law, so a run scores the same way under either.
 */
export type MovementScheme = 'click' | 'wasd';

export const DEFAULT_BINDINGS: Bindings = {
  move: { primary: 'Mouse2' },
  attackMove: { primary: 'KeyA', secondary: 'Mouse0' },
  stop: { primary: 'KeyS' },
  moveUp: { primary: 'KeyW' },
  moveLeft: { primary: 'KeyA' },
  moveDown: { primary: 'KeyS' },
  moveRight: { primary: 'KeyD' },
  q: { primary: 'KeyQ' },
  w: { primary: 'KeyW' },
  e: { primary: 'KeyE' },
  r: { primary: 'KeyR' },
  d: { primary: 'KeyD' },
  f: { primary: 'KeyF' },
  centerCamera: { primary: 'Space' },
  cameraLock: { primary: 'KeyY' },
  reset: { primary: 'Backquote', secondary: 'Enter' },
  pause: { primary: 'Escape' },
};

/**
 * The WASD defaults.
 *
 * W, A, S and D are spoken for, so everything that lived on them moves one
 * seat over and keeps its shape: the ability row stays a row your fingers can
 * find (Q E R F), the summoners drop to the digits above them, and stop —
 * which nobody presses mid-orbwalk — goes to X. Every one of them is
 * rebindable, and the click defaults are untouched, so switching schemes is
 * reversible without losing a layout you had already tuned.
 */
export const WASD_BINDINGS: Bindings = {
  ...DEFAULT_BINDINGS,
  move: { primary: 'Mouse2' },
  attackMove: { primary: 'ShiftLeft', secondary: 'Mouse0' },
  stop: { primary: 'KeyX' },
  q: { primary: 'KeyQ' },
  w: { primary: 'KeyE' },
  e: { primary: 'KeyR' },
  r: { primary: 'KeyF' },
  d: { primary: 'Digit1' },
  f: { primary: 'Digit2' },
  centerCamera: { primary: 'Space' },
  cameraLock: { primary: 'KeyY' },
};

export const defaultsFor = (scheme: MovementScheme): Bindings =>
  scheme === 'wasd' ? WASD_BINDINGS : DEFAULT_BINDINGS;

/** The four actions that only exist under the WASD scheme. */
export const MOVE_ACTIONS: ActionId[] = ['moveUp', 'moveLeft', 'moveDown', 'moveRight'];

export const ACTION_LABELS: Record<ActionId, string> = {
  move: 'Move / Attack target',
  attackMove: 'Attack-move',
  stop: 'Stop',
  moveUp: 'Move up',
  moveLeft: 'Move left',
  moveDown: 'Move down',
  moveRight: 'Move right',
  q: 'Ability Q',
  w: 'Ability W',
  e: 'Ability E',
  r: 'Ability R',
  d: 'Summoner D',
  f: 'Summoner F',
  centerCamera: 'Center camera',
  cameraLock: 'Toggle camera lock',
  reset: 'Instant reset',
  pause: 'Pause',
};

/**
 * The click scheme's bindable actions, in the order a League player expects.
 *
 * The lists live here rather than in the settings screen because they are not
 * a presentation detail: they are the answer to "which actions can collide
 * with each other", which is what conflict detection is built on and what the
 * in-run overlay has to agree with exactly.
 */
export const CLICK_ACTIONS: ActionId[] = [
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
export const WASD_ACTIONS: ActionId[] = [
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

export const actionsFor = (scheme: MovementScheme): ActionId[] =>
  scheme === 'wasd' ? WASD_ACTIONS : CLICK_ACTIONS;

/** Every code a binding occupies, ignoring the unbound slot. */
const codesOf = (b: Binding | undefined): string[] => {
  if (!b) return [];
  const out: string[] = [];
  if (b.primary !== UNBOUND) out.push(b.primary);
  if (b.secondary !== undefined && b.secondary !== UNBOUND) out.push(b.secondary);
  return out;
};

/** Two bindings occupy the same keys, unbound slots included. */
export const bindingsEqual = (a: Binding | undefined, b: Binding | undefined): boolean =>
  (a?.primary ?? UNBOUND) === (b?.primary ?? UNBOUND) &&
  (a?.secondary ?? UNBOUND) === (b?.secondary ?? UNBOUND);

/**
 * A stored rebind map, reduced to what it is allowed to say.
 *
 * The map comes back out of localStorage, so nothing in it is trusted: a
 * profile written by an older build can name an action this one no longer has,
 * and a half-written one can hold anything at all. Entries that merely repeat
 * the default are dropped too — stored overrides are the only record of "this
 * player changed something", so a row rebound back to its shipped key has to
 * stop counting as changed, or every changed-dot and reset button on the
 * settings screen lies about it.
 */
export const sanitizeOverrides = (
  scheme: MovementScheme,
  raw: Record<string, Binding> | undefined,
): Record<string, Binding> => {
  const defaults = defaultsFor(scheme) as Record<string, Binding>;
  const out: Record<string, Binding> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!(k in defaults) || !v || typeof v !== 'object') continue;
    if (typeof v.primary !== 'string') continue;
    const b: Binding = {
      primary: v.primary,
      ...(typeof v.secondary === 'string' && v.secondary !== UNBOUND ? { secondary: v.secondary } : {}),
    };
    if (bindingsEqual(b, defaults[k])) continue;
    out[k] = b;
  }
  return out;
};

/** A scheme's defaults with the player's rebinds laid over them. */
export const resolveBindings = (
  scheme: MovementScheme,
  overrides: Record<string, Binding> | undefined,
): Bindings => ({ ...defaultsFor(scheme), ...sanitizeOverrides(scheme, overrides) });

/**
 * Which actions share a key with which, within one scheme.
 *
 * Two actions on one key is not a preference — under the hood exactly one of
 * them wins, decided by the order of the `if`s in `onKeyDown`, and the other
 * is simply dead. The settings screen resolves collisions as they are made,
 * so this exists to catch what an older profile already has stored.
 */
export const findConflicts = (bindings: Bindings, actions: ActionId[]): Map<ActionId, ActionId[]> => {
  const byCode = new Map<string, ActionId[]>();
  for (const a of actions) {
    for (const code of codesOf(bindings[a])) {
      const list = byCode.get(code);
      if (list) list.push(a);
      else byCode.set(code, [a]);
    }
  }
  const out = new Map<ActionId, ActionId[]>();
  for (const list of byCode.values()) {
    if (list.length < 2) continue;
    for (const a of list) {
      const others = list.filter((o) => o !== a);
      const prev = out.get(a) ?? [];
      out.set(a, [...new Set([...prev, ...others])]);
    }
  }
  return out;
};

export type InputEventKind =
  | { kind: 'move'; x: number; y: number; t: number }
  | { kind: 'attackMove'; x: number; y: number; t: number }
  | { kind: 'stop'; t: number }
  | { kind: 'ability'; slot: 'q' | 'w' | 'e' | 'r' | 'd' | 'f'; x: number; y: number; t: number }
  | { kind: 'abilityRelease'; slot: 'q' | 'w' | 'e' | 'r' | 'd' | 'f'; x: number; y: number; t: number }
  | { kind: 'reset'; t: number }
  | { kind: 'pause'; t: number }
  /** Focus or visibility was lost. Pauses; never un-pauses. */
  | { kind: 'blur'; t: number }
  | { kind: 'centerCamera'; t: number }
  | { kind: 'cameraLock'; t: number };

const ABILITY_SLOTS = ['q', 'w', 'e', 'r', 'd', 'f'] as const;
export type AbilitySlot = (typeof ABILITY_SLOTS)[number];

export interface InputOptions {
  bindings: Bindings;
  /** Quick cast fires on key press at the cursor; otherwise press arms, click confirms. */
  quickCast: boolean;
  /** Which ability slots the active drill actually uses. Unused slots fall through. */
  activeSlots: Set<AbilitySlot>;
  /** Click-to-move, or WASD. */
  scheme: MovementScheme;
}

export class InputSystem {
  /** Cursor in CSS pixels relative to the canvas element. */
  readonly cursor = { x: 0, y: 0 };
  /** Raw event queue drained by the simulation each step. */
  private queue: InputEventKind[] = [];
  private held = new Set<string>();
  /**
   * Held codes in the order they were pressed, most recent last.
   *
   * Only the movement resolver reads it, and it reads it for one reason:
   * rolling A into D has to turn you around *now*. Summing the axis instead
   * would cancel to zero for as long as both keys are down, which is a
   * quarter-second of standing still in the middle of a direction change —
   * the exact moment a diver catches you.
   */
  private pressOrder: string[] = [];
  private armed: AbilitySlot | null = null;
  private opts: InputOptions;
  private el: HTMLElement | null = null;
  private attached = false;

  /** Counts every pointer press so drills can measure redundant clicking. */
  totalClicks = 0;

  /**
   * True while something on top of the arena owns the keyboard.
   *
   * The in-run settings overlay is the whole reason this exists: a player
   * rebinding Q must be able to press Q without casting it, and must be able
   * to press Escape without the run resuming underneath the panel they are
   * still reading. Suspending is not detaching — the listeners stay put, so
   * the run is exactly where it was when the overlay closes.
   */
  private suspended = false;

  constructor(opts: InputOptions) {
    this.opts = opts;
  }

  setOptions(patch: Partial<InputOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  get quickCast(): boolean {
    return this.opts.quickCast;
  }

  /**
   * Hand the keyboard and mouse to an overlay, or take them back.
   *
   * Held keys are dropped on the way in: whatever was down when the overlay
   * opened is not down any more by the time the player closes it, and a
   * champion that resumes walking into a wall because W was held two menus ago
   * is the exact bug this prevents.
   */
  setSuspended(v: boolean): void {
    if (this.suspended === v) return;
    this.suspended = v;
    if (!v) return;
    this.held.clear();
    this.pressOrder.length = 0;
    this.armed = null;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  get armedSlot(): AbilitySlot | null {
    return this.armed;
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  get scheme(): MovementScheme {
    return this.opts.scheme;
  }

  /**
   * The held movement direction, polled by the simulation each step rather
   * than queued as events.
   *
   * A direction is a *state*, not an event: queueing key-downs would make the
   * champion's heading depend on how many simulation steps happened to fall
   * between two key presses. Polling means 240Hz and 60Hz produce identical
   * movement, which is the same promise the rest of the fixed-step loop makes.
   */
  moveVector(): { x: number; y: number } {
    if (this.opts.scheme !== 'wasd') return ZERO;
    const b = this.opts.bindings;
    const x = this.axis(b.moveLeft, b.moveRight);
    const y = this.axis(b.moveUp, b.moveDown);
    if (x === 0 && y === 0) return ZERO;
    return { x, y };
  }

  /**
   * One axis, resolved by last input rather than by sum.
   *
   * Both directions down means the newer press wins: A→D turns you right on
   * the frame D goes down, and releasing D hands the axis straight back to A
   * without a keystroke. It is how every fighting game and every shooter with
   * a keyboard resolves this, and it is the difference between a direction
   * change that feels instant and one that feels like it has a hitch in it.
   */
  private axis(negative: Binding, positive: Binding): number {
    const neg = this.matchesHeld(negative);
    const pos = this.matchesHeld(positive);
    if (!neg && !pos) return 0;
    if (neg && !pos) return -1;
    if (pos && !neg) return 1;
    // Both down: the one pressed more recently owns the axis.
    return this.pressedAt(positive) >= this.pressedAt(negative) ? 1 : -1;
  }

  /** How recently a binding's key went down, as an index into the press order. */
  private pressedAt(b: Binding): number {
    const a = b.primary === UNBOUND ? -1 : this.pressOrder.lastIndexOf(b.primary);
    const c =
      b.secondary !== undefined && b.secondary !== UNBOUND ? this.pressOrder.lastIndexOf(b.secondary) : -1;
    return Math.max(a, c);
  }

  private matchesHeld(b: Binding): boolean {
    if (!b) return false;
    return (
      (b.primary !== UNBOUND && this.held.has(b.primary)) ||
      (b.secondary !== undefined && b.secondary !== UNBOUND && this.held.has(b.secondary))
    );
  }

  /** True when this code drives movement under the active scheme. */
  private isMovementKey(code: string): boolean {
    if (this.opts.scheme !== 'wasd' || code === UNBOUND) return false;
    return MOVE_ACTIONS.some((a) => this.matches(a, code));
  }

  attach(el: HTMLElement): void {
    if (this.attached) this.detach();
    this.el = el;
    this.attached = true;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointermove', this.onPointerMove, { passive: true });
    // Chrome delivers these ahead of coalesced pointermove; better cursor freshness.
    el.addEventListener('pointerrawupdate', this.onPointerMove as EventListener, { passive: true });
    el.addEventListener('contextmenu', this.onSuppress);
    // A right-drag here is a move command, never a browser drag.
    el.addEventListener('dragstart', this.onSuppress);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  detach(): void {
    const el = this.el;
    if (el) {
      el.removeEventListener('pointerdown', this.onPointerDown);
      el.removeEventListener('pointerup', this.onPointerUp);
      el.removeEventListener('pointermove', this.onPointerMove);
      el.removeEventListener('pointerrawupdate', this.onPointerMove as EventListener);
      el.removeEventListener('contextmenu', this.onSuppress);
      el.removeEventListener('dragstart', this.onSuppress);
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.el = null;
    this.attached = false;
    this.held.clear();
    this.pressOrder.length = 0;
    this.armed = null;
  }

  /** Hand the queued events to the simulation and clear it. */
  drain(): InputEventKind[] {
    if (this.queue.length === 0) return EMPTY;
    const q = this.queue;
    this.queue = [];
    return q;
  }

  reset(): void {
    this.queue.length = 0;
    this.armed = null;
    this.totalClicks = 0;
  }

  private codeFor(e: PointerEvent): string {
    return `Mouse${e.button}`;
  }

  private matches(action: ActionId, code: string): boolean {
    const b = this.opts.bindings[action];
    if (!b || code === UNBOUND) return false;
    return b.primary === code || b.secondary === code;
  }

  private updateCursor(e: PointerEvent): void {
    const el = this.el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    this.cursor.x = e.clientX - r.left;
    this.cursor.y = e.clientY - r.top;
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.suspended) return;
    this.updateCursor(e);
  };

  private onSuppress = (e: Event): void => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.suspended) return;
    this.updateCursor(e);
    (this.el as HTMLElement | null)?.focus?.();
    const code = this.codeFor(e);
    this.press(code);
    this.totalClicks++;
    const t = e.timeStamp;
    const { x, y } = this.cursor;

    // A pending non-quickcast ability consumes the next left click.
    if (this.armed && code === 'Mouse0') {
      this.queue.push({ kind: 'ability', slot: this.armed, x, y, t });
      this.armed = null;
      return;
    }
    if (this.armed && code === 'Mouse2') {
      this.armed = null; // right click cancels a pending cast, as in League
      return;
    }

    if (this.matches('move', code)) {
      this.queue.push({ kind: 'move', x, y, t });
      return;
    }
    // Attack-move: the modifier key is held and the confirm button is pressed.
    const amBind = this.opts.bindings.attackMove;
    const modHeld = amBind.primary !== UNBOUND && this.held.has(amBind.primary);
    if (code === (amBind.secondary ?? 'Mouse0') && modHeld) {
      this.queue.push({ kind: 'attackMove', x, y, t });
      return;
    }
    // Bare left click also issues an attack-move: the trainer is about
    // mechanics, not about punishing people for forgetting the modifier.
    if (code === 'Mouse0') {
      this.queue.push({ kind: 'attackMove', x, y, t });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.updateCursor(e);
    this.release(this.codeFor(e));
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.suspended) return;
    const code = e.code;
    if (e.repeat) {
      if (code === 'Space' || code === 'Tab') e.preventDefault();
      return;
    }
    // Let the browser keep its own shortcuts — but not at the cost of the
    // modifiers themselves. Ctrl, Alt and Shift are legal bindings (attack-move
    // ships on Shift under WASD), and pressing one sets its own flag on its own
    // event, so a blanket bail would make every modifier permanently unbindable.
    if ((e.ctrlKey || e.metaKey || e.altKey) && !MODIFIER_CODES.has(code)) return;

    this.press(code);
    const t = e.timeStamp;
    const { x, y } = this.cursor;

    // Under WASD the movement keys win outright. Nothing else may claim them,
    // however the rest of the layout has been rebound.
    if (this.isMovementKey(code)) {
      e.preventDefault();
      return;
    }

    // Escape pauses whatever the bindings say, in addition to whatever else
    // is bound to pause. It is the way out of a run and the way into the
    // settings, so it is the one key a bad rebind must never be able to take
    // away — otherwise a player who binds something onto Escape, or unbinds
    // pause by accident, is stuck inside a run with no menu to fix it from.
    if (code === 'Escape' || this.matches('pause', code)) {
      this.queue.push({ kind: 'pause', t });
      this.armed = null;
      e.preventDefault();
      return;
    }

    for (const slot of ABILITY_SLOTS) {
      if (this.matches(slot, code) && this.opts.activeSlots.has(slot)) {
        if (this.opts.quickCast) {
          this.queue.push({ kind: 'ability', slot, x, y, t });
        } else {
          this.armed = this.armed === slot ? null : slot;
        }
        e.preventDefault();
        return;
      }
    }

    if (this.matches('reset', code)) {
      this.queue.push({ kind: 'reset', t });
      e.preventDefault();
      return;
    }
    // R doubles as instant reset in drills that have no ultimate bound.
    if (this.matches('r', code) && !this.opts.activeSlots.has('r')) {
      this.queue.push({ kind: 'reset', t });
      e.preventDefault();
      return;
    }
    if (this.matches('stop', code)) {
      this.queue.push({ kind: 'stop', t });
      e.preventDefault();
      return;
    }
    if (this.matches('centerCamera', code)) {
      this.queue.push({ kind: 'centerCamera', t });
      e.preventDefault();
      return;
    }
    if (this.matches('cameraLock', code)) {
      this.queue.push({ kind: 'cameraLock', t });
      e.preventDefault();
      return;
    }
    if (this.matches('attackMove', code)) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.suspended) return;
    this.release(e.code);
  };

  /** Marks a code down, keeping the press order honest about repeats. */
  private press(code: string): void {
    if (this.held.has(code)) return;
    this.held.add(code);
    this.pressOrder.push(code);
    if (this.pressOrder.length > 24) this.pressOrder.shift();
  }

  private release(code: string): void {
    this.held.delete(code);
    const i = this.pressOrder.lastIndexOf(code);
    if (i >= 0) this.pressOrder.splice(i, 1);
  }

  private onBlur = (): void => {
    if (this.suspended) return;
    this.held.clear();
    this.pressOrder.length = 0;
    this.armed = null;
    this.queue.push({ kind: 'blur', t: performance.now() });
  };

  /**
   * A tab opened behind this one — an Opera gesture does exactly that — does
   * not always blur the window, but it always changes visibility. Either way
   * the run should stop rather than play itself out unwatched.
   */
  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.onBlur();
  };
}

const EMPTY: InputEventKind[] = [];
const ZERO = { x: 0, y: 0 };

/** Human-readable label for a binding code, for the settings screen. */
export const codeLabel = (code: string): string => {
  if (code === UNBOUND || !code) return 'Unbound';
  if (code.startsWith('Mouse')) {
    const n = code.slice(5);
    return n === '0' ? 'Left Click' : n === '1' ? 'Middle Click' : n === '2' ? 'Right Click' : `Mouse ${n}`;
  }
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return `${code.slice(5)} Arrow`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return NAMED_CODES[code] ?? code;
};

/**
 * The keys whose code says nothing about what is printed on them.
 *
 * It is a long list on purpose. A settings screen that answers "Semicolon"
 * with `Semicolon` is technically correct and useless — the whole promise of a
 * rebind list is that it names the key you actually pressed.
 */
const NAMED_CODES: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  CapsLock: 'Caps Lock',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  MetaLeft: 'L Meta',
  MetaRight: 'R Meta',
  ContextMenu: 'Menu',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  IntlBackslash: '\\',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumLock: 'Num Lock',
  ScrollLock: 'Scroll Lock',
  Pause: 'Pause',
};
