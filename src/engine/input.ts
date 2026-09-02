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
  /** KeyboardEvent.code, or 'Mouse0' | 'Mouse1' | 'Mouse2'. */
  primary: string;
  secondary?: string;
}

export type Bindings = Record<ActionId, Binding>;

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
  private armed: AbilitySlot | null = null;
  private opts: InputOptions;
  private el: HTMLElement | null = null;
  private attached = false;

  /** Counts every pointer press so drills can measure redundant clicking. */
  totalClicks = 0;

  constructor(opts: InputOptions) {
    this.opts = opts;
  }

  setOptions(patch: Partial<InputOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  get quickCast(): boolean {
    return this.opts.quickCast;
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
    let x = 0;
    let y = 0;
    if (this.matchesHeld(b.moveLeft)) x -= 1;
    if (this.matchesHeld(b.moveRight)) x += 1;
    if (this.matchesHeld(b.moveUp)) y -= 1;
    if (this.matchesHeld(b.moveDown)) y += 1;
    if (x === 0 && y === 0) return ZERO;
    return { x, y };
  }

  private matchesHeld(b: Binding): boolean {
    return this.held.has(b.primary) || (b.secondary !== undefined && this.held.has(b.secondary));
  }

  /** True when this code drives movement under the active scheme. */
  private isMovementKey(code: string): boolean {
    if (this.opts.scheme !== 'wasd') return false;
    const b = this.opts.bindings;
    return (
      b.moveUp.primary === code ||
      b.moveDown.primary === code ||
      b.moveLeft.primary === code ||
      b.moveRight.primary === code ||
      b.moveUp.secondary === code ||
      b.moveDown.secondary === code ||
      b.moveLeft.secondary === code ||
      b.moveRight.secondary === code
    );
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
    this.updateCursor(e);
  };

  private onSuppress = (e: Event): void => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.updateCursor(e);
    (this.el as HTMLElement | null)?.focus?.();
    const code = this.codeFor(e);
    this.held.add(code);
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
    const modHeld = this.held.has(amBind.primary) || this.isHeld(amBind.primary);
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
    this.held.delete(this.codeFor(e));
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (e.repeat) {
      if (code === 'Space' || code === 'Tab') e.preventDefault();
      return;
    }
    // Let the browser keep its own shortcuts.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    this.held.add(code);
    const t = e.timeStamp;
    const { x, y } = this.cursor;

    // Under WASD the movement keys win outright. Nothing else may claim them,
    // however the rest of the layout has been rebound.
    if (this.isMovementKey(code)) {
      e.preventDefault();
      return;
    }

    if (this.matches('pause', code)) {
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
    if (code === this.opts.bindings.r.primary && !this.opts.activeSlots.has('r')) {
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
    this.held.delete(e.code);
  };

  private onBlur = (): void => {
    this.held.clear();
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
  if (code.startsWith('Mouse')) {
    const n = code.slice(5);
    return n === '0' ? 'Left Click' : n === '1' ? 'Middle Click' : n === '2' ? 'Right Click' : `Mouse ${n}`;
  }
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    Space: 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
    Backquote: '`',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    Tab: 'Tab',
    ControlLeft: 'L Ctrl',
    AltLeft: 'L Alt',
  };
  return named[code] ?? code;
};
