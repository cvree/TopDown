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
  | 'q'
  | 'w'
  | 'e'
  | 'r'
  | 'd'
  | 'f'
  | 'centerCamera'
  | 'reset'
  | 'pause';

export interface Binding {
  /** KeyboardEvent.code, or 'Mouse0' | 'Mouse1' | 'Mouse2'. */
  primary: string;
  secondary?: string;
}

export type Bindings = Record<ActionId, Binding>;

export const DEFAULT_BINDINGS: Bindings = {
  move: { primary: 'Mouse2' },
  attackMove: { primary: 'KeyA', secondary: 'Mouse0' },
  stop: { primary: 'KeyS' },
  q: { primary: 'KeyQ' },
  w: { primary: 'KeyW' },
  e: { primary: 'KeyE' },
  r: { primary: 'KeyR' },
  d: { primary: 'KeyD' },
  f: { primary: 'KeyF' },
  centerCamera: { primary: 'Space' },
  reset: { primary: 'Backquote', secondary: 'Enter' },
  pause: { primary: 'Escape' },
};

export const ACTION_LABELS: Record<ActionId, string> = {
  move: 'Move / Attack target',
  attackMove: 'Attack-move',
  stop: 'Stop',
  q: 'Ability Q',
  w: 'Ability W',
  e: 'Ability E',
  r: 'Ability R',
  d: 'Summoner D',
  f: 'Summoner F',
  centerCamera: 'Center camera',
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
  | { kind: 'centerCamera'; t: number };

const ABILITY_SLOTS = ['q', 'w', 'e', 'r', 'd', 'f'] as const;
export type AbilitySlot = (typeof ABILITY_SLOTS)[number];

export interface InputOptions {
  bindings: Bindings;
  /** Quick cast fires on key press at the cursor; otherwise press arms, click confirms. */
  quickCast: boolean;
  /** Which ability slots the active drill actually uses. Unused slots fall through. */
  activeSlots: Set<AbilitySlot>;
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
