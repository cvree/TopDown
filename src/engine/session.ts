import { audio } from './audio';
import { FxSystem } from './fx';
import type { AbilitySlot, InputSystem, MovementScheme } from './input';
import { clamp, dist } from './math';
import { MetricsRecorder } from './metrics';
import { PALETTE } from './palette';
import { Rng } from './rng';
import type { Actor, Vec2 } from './types';
import { World, type WorldEvent } from './world';

export type SessionPhase = 'countdown' | 'running' | 'paused' | 'ended';

export interface HudField {
  label: string;
  value: string;
  /** 0..1 for a bar, undefined for plain text. */
  bar?: number;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

/** One slot on the ability bar. */
export interface AbilityView {
  slot: AbilitySlot;
  name: string;
  /** 0 = off cooldown, 1 = just cast. */
  cd: number;
  /** The drill is asking for this key right now. */
  highlight: boolean;
  /** The drill does not use this slot at all. */
  locked: boolean;
}

export interface HudSnapshot {
  phase: SessionPhase;
  timeLeft: number;
  elapsed: number;
  score: number;
  chain: number;
  chainBest: number;
  hp: number;
  maxHp: number;
  fields: HudField[];
  abilities: AbilityView[];
  /** 'windup' | 'backswing' | 'idle' plus how far through it the player is. */
  attackPhase: 'idle' | 'windup' | 'backswing';
  attackPhaseT: number;
  /** Fraction of the attack cooldown still to run, 0..1. */
  attackCd: number;
  countdown: number;
  banner: string | null;
  fps: number;
}

/** A short piece of in-run feedback shown near the player. */
export type Micro =
  | 'PERFECT'
  | 'CLEAN DODGE'
  | 'MAX RANGE'
  | 'PERFECT WINDUP'
  | 'EARLY MOVE'
  | 'ATTACK CANCELLED'
  | 'LAST HIT'
  | 'MISSED CS'
  | 'SWITCHED'
  | 'TOO CLOSE'
  | 'PERFECT SPACING';

/**
 * The only thing the session needs from a renderer: where in the arena the
 * cursor is. Keeping it to an interface is what let the 2D canvas renderer be
 * swapped for the 3D one without the simulation noticing.
 */
export interface ViewProjection {
  screenToWorld(x: number, y: number): Vec2;
  /**
   * Stereo position of a world point, -1..1. Optional so the headless test
   * harness — which has no camera — can implement the interface with one
   * method and still drive the whole simulation.
   */
  panAt?(p: Vec2): number;
  /** Puts an actor into its cast pose for the next few frames. */
  castPose?(actorId: number): void;
  cameraKick?(angle: number, amount: number): void;
  recenterCamera?(): void;
  toggleCameraLock?(): boolean;
}

/**
 * Where a self-cast dash points.
 *
 * Under the click scheme the question does not arise: the cursor is already
 * where you asked to walk, so aiming a dash at it is the same instruction
 * twice. Under WASD it is a genuine fork — the mouse is holding your target
 * and the keys are holding your direction, and those point opposite ways
 * exactly when it matters, which is while you are kiting something.
 *
 * `hands` resolves that the way a WASD player means it: the keys aim the dash
 * whenever one is down, and the cursor takes over when none is. `cursor` is
 * League's literal behaviour, kept for players who want the transfer to be
 * exact.
 */
export type TumbleAim = 'cursor' | 'hands';

export interface SessionConfig {
  duration: number;
  arena: { w: number; h: number };
  seed: number;
  difficulty: number;
  abilities: AbilitySlot[];
  /** How the champion is driven. Defaults to League's click scheme. */
  scheme?: MovementScheme;
  /** Where a dash points under WASD. Meaningless under the click scheme. */
  tumbleAim?: TumbleAim;
}

/**
 * Owns one run of one drill. React never touches this object during play — it
 * reads a snapshot at its own cadence, which is what keeps input latency down.
 */
export class Session {
  readonly world: World;
  readonly fx = new FxSystem();
  readonly metrics = new MetricsRecorder();
  readonly rng: Rng;
  readonly config: SessionConfig;

  phase: SessionPhase = 'countdown';
  countdown = 3;
  elapsed = 0;
  score = 0;
  chain = 0;
  chainBest = 0;
  banner: string | null = null;
  bannerTime = 0;

  cursorWorld: Vec2 = { x: 0, y: 0 };
  hoverTargetId: number | null = null;
  pathTrail: Vec2[] = [];
  hitFeedback = 0;
  dimmed = 0;

  /** Set by the drill when the run should stop early. */
  forceEnd = false;
  endReason: 'time' | 'death' | 'complete' | 'abort' = 'time';

  private movedSinceRelease = false;
  private lastReleaseAt = -1;
  private lastMoveOrderAt = -1;
  private trailAccum = 0;
  private countdownTicked = -1;
  /** Last frame's cooldown per slot, for the ready chime. */
  private lastCd = new Map<AbilitySlot, number>();
  private lastArmed: AbilitySlot | null = null;
  /** Rate limit for telegraph audio: a wave of hazards is one sound, not ten. */
  private lastTelegraphAt = -1;
  private feedbackAccum = 0;
  /** True once the camera has been unlocked, so the hint is only shown once. */
  cameraLocked = true;

  drill: DrillBase | null = null;

  constructor(config: SessionConfig, private readonly input: InputSystem, private readonly renderer: ViewProjection) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.world = new World(config.arena, this.rng);
  }

  attachDrill(d: DrillBase): void {
    this.drill = d;
    d.setup();
    // Under WASD the champion is steered, not sent: orders still choose what
    // it shoots at, but nothing walks it anywhere.
    if (this.scheme === 'wasd') {
      const p = this.world.player;
      if (p) p.directControl = true;
    }
  }

  get scheme(): MovementScheme {
    return this.config.scheme ?? 'click';
  }

  /** Where a dash points. Only WASD gets a choice; clicking has no hands. */
  get tumbleAim(): TumbleAim {
    return this.scheme === 'wasd' ? this.config.tumbleAim ?? 'hands' : 'cursor';
  }

  /**
   * The direction the left hand is currently asking for, or null.
   *
   * Abilities that want to know — a dash, and the indicator that previews it —
   * read this rather than the input system, so the headless harness only ever
   * has to implement `moveVector`.
   */
  get handDir(): Vec2 | null {
    if (this.scheme !== 'wasd') return null;
    const v = this.input.moveVector?.() ?? { x: 0, y: 0 };
    const m = Math.hypot(v.x, v.y);
    if (m < 0.001) return null;
    return { x: v.x / m, y: v.y / m };
  }

  // ------------------------------------------------------------------ frame

  step(dt: number): void {
    this.handleInput();
    this.applyHeldDirection();

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const whole = Math.ceil(this.countdown);
      if (whole !== this.countdownTicked && whole > 0) {
        this.countdownTicked = whole;
        audio.play('countdown');
      }
      if (this.countdown <= 0) {
        this.phase = 'running';
        audio.play('go');
        this.fx.addFlash(0.1, PALETTE.accent);
        this.drill?.onStart();
      }
      this.fx.update(dt);
      return;
    }
    if (this.phase !== 'running') {
      this.fx.update(dt);
      return;
    }

    this.elapsed += dt;
    const player = this.world.player;

    this.drill?.update(dt);
    this.world.step(dt);

    for (const e of this.world.events) this.onWorldEvent(e);
    this.metrics.ingest(this.world.events, this.world);
    this.drill?.onEvents(this.world.events);
    this.world.clearEvents();

    if (player) {
      this.metrics.sample(this.world, player, this.cursorWorld, dt, this.chain);
      this.trailAccum += dt;
      if (this.trailAccum > 0.02) {
        this.trailAccum = 0;
        this.pathTrail.push({ x: player.pos.x, y: player.pos.y });
        if (this.pathTrail.length > 90) this.pathTrail.shift();
      }
      this.hoverTargetId = this.pickHover(player);
    }

    this.fx.targetEnergy = clamp(this.chain / 9, 0, 1);
    this.fx.update(dt);
    // Polled feedback, at 20Hz rather than at the simulation's 240Hz.
    // `abilities()` allocates, and allocating in a fixed-step loop is how you
    // buy yourself a GC pause in the middle of a reaction-time measurement.
    // Nothing here is time-critical: the ear cannot tell a 50ms-late chime
    // from an on-time one, and the arena bed is a 350ms ramp anyway.
    this.feedbackAccum += dt;
    if (this.feedbackAccum >= 0.05) {
      this.feedbackAccum = 0;
      // The arena bed swells with the chain: a streak is audible before the
      // number on the HUD has time to be read.
      audio.setIntensity(this.fx.energy);
      this.pollAbilityState();
    }
    this.hitFeedback = Math.max(0, this.hitFeedback - dt * 3.6);
    if (this.bannerTime > 0) {
      this.bannerTime -= dt;
      if (this.bannerTime <= 0) this.banner = null;
    }

    if (this.config.duration > 0 && this.elapsed >= this.config.duration) {
      this.endReason = 'time';
      this.end();
    } else if (player && !player.alive) {
      this.endReason = 'death';
      this.end();
    } else if (this.forceEnd) {
      this.endReason = this.drill?.endReason ?? 'complete';
      this.end();
    }
  }

  private end(): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.score = this.drill?.score() ?? this.score;
    audio.play(this.endReason === 'death' ? 'fail' : 'resultsReveal');
    this.fx.addFlash(0.12, this.endReason === 'death' ? PALETTE.danger : PALETTE.accent);
  }

  abort(): void {
    this.endReason = 'abort';
    this.end();
  }

  togglePause(): void {
    if (this.phase === 'running') this.phase = 'paused';
    else if (this.phase === 'paused') this.phase = 'running';
  }

  // ------------------------------------------------------------------ input

  private handleInput(): void {
    const events = this.input.drain();
    if (events.length === 0) return;
    const player = this.world.player;
    for (const e of events) {
      if (e.kind === 'pause') {
        if (this.phase === 'running' || this.phase === 'paused') this.togglePause();
        continue;
      }
      if (e.kind === 'blur') {
        // Losing focus only ever pauses. Toggling here would resume a run for
        // someone who paused deliberately and then switched away from the tab.
        if (this.phase === 'running') this.phase = 'paused';
        continue;
      }
      if (e.kind === 'reset') {
        this.onResetRequest?.();
        continue;
      }
      if (this.phase !== 'running' || !player || !player.alive) continue;

      switch (e.kind) {
        case 'move': {
          const w = this.renderer.screenToWorld(e.x, e.y);
          this.metrics.noteClick(w, this.world.time);
          if (this.drill?.onClick(w, 'move')) break;
          const target = this.enemyAt(w, player);
          if (target) {
            if (this.scheme === 'wasd') this.issueAttackStance(player, w, target.id);
            else this.world.issueAttackTarget(player, target.id);
            this.drill?.onTargetOrder(target);
            this.metrics.noteClickError(dist(w, target.pos));
          } else if (this.scheme === 'wasd') {
            // Nothing under the cursor and nothing to walk toward: the click
            // is a stance, telling the champion what to shoot at when
            // something wanders into range.
            this.issueAttackStance(player, w, undefined);
          } else {
            this.issuePlayerMove(player, w, false);
          }
          break;
        }
        case 'attackMove': {
          const w = this.renderer.screenToWorld(e.x, e.y);
          this.metrics.noteClick(w, this.world.time);
          if (this.drill?.onClick(w, 'attackMove')) break;
          const t = this.enemyAt(w, player);
          if (this.scheme === 'wasd') {
            this.issueAttackStance(player, w, t?.id);
          } else {
            this.issuePlayerMove(player, w, true);
          }
          if (t) {
            this.drill?.onTargetOrder(t);
            this.metrics.noteClickError(dist(w, t.pos));
          }
          break;
        }
        case 'stop':
          this.world.issueStop(player);
          break;
        case 'ability': {
          const w = this.renderer.screenToWorld(e.x, e.y);
          this.castAbility(e.slot, w, player);
          break;
        }
        case 'centerCamera':
          this.renderer.recenterCamera?.();
          this.fx.ring(player.pos.x, player.pos.y, 10, 120, 0.4, PALETTE.accentDim, 2, 'pulse');
          break;
        case 'cameraLock': {
          const locked = this.renderer.toggleCameraLock?.() ?? true;
          this.cameraLocked = locked;
          audio.play('uiTab');
          this.setBanner(locked ? 'CAMERA LOCKED' : 'CAMERA UNLOCKED · EDGE PAN', 1.1);
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * The WASD scheme's movement, applied once per fixed step.
   *
   * Held keys are read as state rather than drained as events, so the heading
   * is exact at any tick rate; the world then applies the same windup rules a
   * click would have triggered. Everything downstream — orbwalk efficiency,
   * cancels, the free-window measurement — sees an ordinary moving champion
   * and cannot tell which hand moved it.
   */
  private applyHeldDirection(): void {
    if (this.scheme !== 'wasd') return;
    const player = this.world.player;
    if (!player || !player.alive) return;
    if (this.phase !== 'running') {
      if (player.moveDir) player.moveDir = null;
      return;
    }
    const v = this.input.moveVector?.() ?? { x: 0, y: 0 };
    const wasMoving = player.moveDir !== null;
    const wasWindup = player.phase === 'windup';
    this.world.setMoveDir(player, v.x, v.y);
    if (!wasMoving && player.moveDir) {
      this.movedSinceRelease = true;
      // A direction taken during the windup is the same mistake as a click
      // taken during the windup, and it costs the same attack — but the hand
      // that made it is different, so it is counted separately and the
      // coaching can name the actual fix.
      if (wasWindup) {
        this.fx.cancel(player.pos);
        this.metrics.noteWindupBreak();
      } else {
        audio.play('moveCommand', { pan: this.panOf(player.pos) });
      }
    }
  }

  /** Called by the shell so `R` can restart instantly from anywhere. */
  onResetRequest: (() => void) | null = null;

  /**
   * A cast, with everything a cast is supposed to come with.
   *
   * The drill owns whether an ability is legal — cooldowns, ammo, whether this
   * drill even uses the slot — and it has no way to say so directly. Rather
   * than widen every drill's interface, this reads the ability bar either side
   * of the call: a slot whose cooldown jumped fired, one that was already down
   * and stayed down refused. That keeps the feedback honest without a single
   * drill having to know that sound exists.
   */
  private castAbility(slot: AbilitySlot, at: Vec2, player: Actor): void {
    const before = this.drill?.abilities().find((a) => a.slot === slot);
    this.drill?.onAbility(slot, at);
    const after = this.drill?.abilities().find((a) => a.slot === slot);
    if (!before || !after || after.locked) return;

    const fired = after.cd > before.cd + 0.08;
    if (!fired) {
      // Down and staying down: the input was real, the ability was not ready.
      if (before.cd > 0.02) audio.play('castRefuse', { pan: this.panOf(player.pos) });
      return;
    }

    const angle = Math.atan2(at.y - player.pos.y, at.x - player.pos.x);
    this.renderer.castPose?.(player.id);
    audio.play(audio.castVoice(slot), { pan: this.panOf(player.pos) });
    // The camera shoves along the cast, not at random. Ultimates shove hard.
    this.renderer.cameraKick?.(angle, slot === 'r' ? 62 : 26);
    if (slot === 'r') {
      this.fx.addFlash(0.08, PALETTE.accent);
      this.fx.ring(player.pos.x, player.pos.y, player.radius, player.radius + 200, 0.5, PALETTE.accent, 4, 'shock');
    } else {
      this.fx.ring(player.pos.x, player.pos.y, player.radius, player.radius + 74, 0.3, PALETTE.accent, 3, 'pulse');
    }
  }

  /**
   * Two quiet pieces of ability feedback, polled rather than pushed because
   * neither the drill nor the input system raises an event for them: the
   * chime as a cooldown finishes, and the tick as a non-quickcast slot arms.
   */
  private pollAbilityState(): void {
    const bar = this.drill?.abilities();
    if (bar) {
      for (const a of bar) {
        const prev = this.lastCd.get(a.slot) ?? 0;
        if (prev > 0.04 && a.cd <= 0.02 && !a.locked) audio.play('abilityReady');
        this.lastCd.set(a.slot, a.cd);
      }
    }
    const armed = this.input.armedSlot;
    if (armed !== this.lastArmed) {
      this.lastArmed = armed;
      if (armed) audio.play('castArm');
    }
  }

  /** Where a world point sits in the stereo field. */
  panOf(p: Vec2): number {
    return this.renderer.panAt?.(p) ?? 0;
  }

  private issuePlayerMove(player: Actor, w: Vec2, attackMove: boolean): void {
    const wasWindup = player.phase === 'windup';
    this.world.issueMove(player, w, attackMove);
    this.lastMoveOrderAt = this.world.time;
    if (!wasWindup) this.movedSinceRelease = true;
    audio.play('moveCommand', { pan: this.panOf(w) });
    this.fx.ring(w.x, w.y, 2, attackMove ? 26 : 20, 0.32, attackMove ? PALETTE.warn : PALETTE.accent, 2, 'pulse');
  }

  /**
   * WASD's attack order: acquire and fire, but never take a step. The keys own
   * where the champion is; the mouse only ever owns what it is shooting.
   */
  private issueAttackStance(player: Actor, at: Vec2, targetId: number | undefined): void {
    this.world.issueAttackHere(player, targetId);
    audio.play('moveCommand', { pan: this.panOf(at) });
    this.fx.ring(at.x, at.y, 2, 26, 0.32, PALETTE.warn, 2, 'pulse');
  }

  private enemyAt(w: Vec2, from: Actor): Actor | null {
    let best: Actor | null = null;
    let bd = Infinity;
    for (const a of this.world.actors) {
      if (!a.alive || a.team === from.team) continue;
      const d = dist(w, a.pos);
      if (d < a.radius + 26 && d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  private pickHover(from: Actor): number | null {
    let best: number | null = null;
    let bd = Infinity;
    for (const a of this.world.actors) {
      if (!a.alive || a.team === from.team) continue;
      const d = dist(this.cursorWorld, a.pos);
      if (d < a.radius + 26 && d < bd) {
        bd = d;
        best = a.id;
      }
    }
    return best;
  }

  // ----------------------------------------------------------------- events

  private onWorldEvent(e: WorldEvent): void {
    const pid = this.world.playerId;
    const player = this.world.player;
    switch (e.type) {
      case 'attackStart': {
        // The windup is the one thing in this game you must feel starting.
        const a = this.world.byId(e.actorId);
        if (e.actorId === pid) audio.play('attackWindup');
        else if (a) audio.play('attackWindup', { intensity: 0.5, pan: this.panOf(a.pos) });
        break;
      }
      case 'attackRelease':
        if (e.actorId === pid && player) {
          audio.play('attackRelease');
          const target = this.world.byId(e.targetId);
          // A clean orbwalk step: you moved between this attack and the last.
          if (this.movedSinceRelease && this.lastReleaseAt >= 0) {
            this.chain++;
            this.chainBest = Math.max(this.chainBest, this.chain);
            audio.setComboPitch(this.chain);
            if (this.chain >= 2) this.micro('PERFECT', player.pos);
          }
          if (target) {
            const d = dist(player.pos, target.pos);
            if (d > (player.attack.range + target.radius) * 0.88) this.micro('MAX RANGE', player.pos, PALETTE.good);
          }
          this.movedSinceRelease = false;
          this.lastReleaseAt = this.world.time;
          this.fx.ring(player.pos.x, player.pos.y, player.radius + 4, player.radius + 30, 0.24, PALETTE.accent, 2, 'impact');
        }
        break;
      case 'attackLand':
        if (e.actorId === pid && e.pos) {
          audio.play('attackLand', { pan: this.panOf(e.pos) });
          const t = this.world.byId(e.targetId);
          this.fx.impact(e.pos, t ? Math.atan2(e.pos.y - (player?.pos.y ?? 0), e.pos.x - (player?.pos.x ?? 0)) : 0, PALETTE.accent, 1 + Math.min(this.chain, 6) * 0.1);
        }
        break;
      case 'attackCancel':
        if (e.actorId === pid && player) {
          audio.play('attackCancel');
          this.fx.cancel(player.pos);
          const lateness = e.amount ?? 0;
          this.micro(lateness > 0.05 ? 'EARLY MOVE' : 'ATTACK CANCELLED', player.pos, PALETTE.textDim);
          this.chain = 0;
          audio.setComboPitch(0);
        }
        break;
      case 'graze':
        if (e.pos) {
          audio.play('nearMiss', { pan: this.panOf(e.pos) });
          this.fx.nearMiss(e.pos, 0);
          if (player) this.micro('CLEAN DODGE', player.pos, PALETTE.warn);
        }
        break;
      case 'death':
        if (e.pos) {
          const victim = this.world.byId(e.actorId);
          if (e.actorId === pid) {
            audio.play('hurt', 1.4);
            this.fx.kill(e.pos, PALETTE.danger);
          } else {
            audio.play('kill', { pan: this.panOf(e.pos) });
            this.fx.kill(e.pos, victim?.isMinion ? PALETTE.warn : PALETTE.accent);
            this.fx.timeDilation = 0.72;
          }
        }
        break;
      case 'damage':
        if (e.targetId === pid && e.pos) {
          audio.play('hurt', { pan: this.panOf(e.pos) });
          this.fx.hurt(e.pos);
          this.hitFeedback = 1;
          this.chain = 0;
          audio.setComboPitch(0);
        }
        break;
      case 'hazardWarn':
        // Every telegraph in the arena is audible and placed. Half of dodging
        // in League is hearing a cast start while you are looking elsewhere,
        // and a trainer that only ever draws the telegraph trains half of it.
        if (e.pos && this.world.time - this.lastTelegraphAt > 0.12) {
          this.lastTelegraphAt = this.world.time;
          audio.play('telegraph', { intensity: 0.9, pan: this.panOf(e.pos) });
        }
        break;
      case 'hazardFire':
        if (e.pos) audio.play('hazardFire', { intensity: 0.85, pan: this.panOf(e.pos) });
        break;
      case 'projectileSpawn':
        if (e.pos && !e.byPlayer) audio.play('enemyCast', { intensity: 0.8, pan: this.panOf(e.pos) });
        break;
      default:
        break;
    }
    void this.lastMoveOrderAt;
  }

  micro(text: Micro | string, at: Vec2, color: string = PALETTE.playerCore): void {
    this.fx.text(at.x, at.y - 52, text, color, 19, 700);
  }

  setBanner(text: string, seconds = 1.4): void {
    this.banner = text;
    this.bannerTime = seconds;
  }

  // -------------------------------------------------------------------- hud

  hud(fps: number): HudSnapshot {
    const p = this.world.player;
    return {
      phase: this.phase,
      timeLeft: this.config.duration > 0 ? Math.max(0, this.config.duration - this.elapsed) : this.elapsed,
      elapsed: this.elapsed,
      score: this.drill ? this.drill.liveScore() : this.score,
      chain: this.chain,
      chainBest: this.chainBest,
      hp: p?.hp ?? 0,
      maxHp: p?.maxHp ?? 1,
      fields: this.drill?.hudFields() ?? [],
      abilities: this.drill?.abilities() ?? [],
      attackPhase: p?.phase ?? 'idle',
      attackPhaseT: p ? phaseProgress(p) : 0,
      attackCd: p ? clamp(p.attackCd * Math.max(0.05, p.attack.attackSpeed), 0, 1) : 0,
      countdown: Math.max(0, Math.ceil(this.countdown)),
      banner: this.banner,
      fps,
    };
  }
}

/** The slots the HUD lays out, in order. */
export const ABILITY_BAR: AbilitySlot[] = ['q', 'w', 'e', 'r', 'd', 'f'];

/** How far through its current attack phase an actor is, 0..1. */
const phaseProgress = (a: Actor): number => {
  if (a.phase === 'idle') return 0;
  const cycle = 1 / Math.max(0.05, a.attack.attackSpeed);
  const total = a.phase === 'windup' ? cycle * a.attack.windupRatio : cycle * a.attack.backswingRatio;
  return clamp(1 - a.phaseTime / Math.max(0.0001, total), 0, 1);
};

/** Base class every drill extends. */
export abstract class DrillBase {
  endReason: 'time' | 'death' | 'complete' | 'abort' = 'time';
  constructor(protected readonly s: Session) {}
  abstract setup(): void;
  onStart(): void {}
  update(_dt: number): void {}
  onEvents(_events: readonly WorldEvent[]): void {}
  onTargetOrder(_a: Actor): void {}
  /** Return true to consume the click so no move order is issued. */
  onClick(_pos: Vec2, _kind: 'move' | 'attackMove'): boolean {
    return false;
  }
  onAbility(_slot: AbilitySlot, _at: Vec2): void {}
  hudFields(): HudField[] {
    return [];
  }
  /**
   * The ability bar. Every drill shows all six slots — the ones it does not use
   * are drawn locked rather than hidden, so the bar never changes shape between
   * drills and your eye always finds the same key in the same place.
   */
  abilities(): AbilityView[] {
    const active = new Set(this.s.config.abilities);
    return ABILITY_BAR.map((slot) => ({
      slot,
      name: '',
      cd: 0,
      highlight: false,
      locked: !active.has(slot),
    }));
  }
  liveScore(): number {
    return Math.round(this.s.score);
  }
  score(): number {
    return this.liveScore();
  }
}
