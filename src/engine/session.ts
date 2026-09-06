import { audio } from './audio';
import { SURVIVE_RAMP, SURVIVE_RAMP_RANGE, SURVIVE_STRIKES, type RunMode } from '../drills/modes';
import { FxSystem } from './fx';
import { DEFAULT_HERO, type HeroId } from './heroes';
import type { AbilitySlot, InputSystem, MovementScheme } from './input';
import { clamp, dist } from './math';
import { MetricsRecorder } from './metrics';
import { PALETTE } from './palette';
import { Rng } from './rng';
import type { Actor, Vec2 } from './types';
import { World, type WorldEvent } from './world';

export type SessionPhase = 'countdown' | 'running' | 'paused' | 'ended';

/**
 * How long one range check leaves your own reach drawn on the floor.
 *
 * A check is the camera-centre key: the same press that pulls the view back
 * onto your champion also paints your attack range for this long and then
 * takes it away again. That is the whole of the indicator — there is no
 * permanent ring, because a permanent ring is a readout and a readout is the
 * thing that stops the distance ever being learnt.
 *
 * Just under a second is deliberate. It is long enough to answer *can I hit
 * that from here* and far too short to stand inside and play off, so a check
 * is a glance rather than a crutch.
 */
export const RANGE_CHECK_SECONDS = 0.85;

/** The last stretch of a check, over which the ring fades rather than blinks out. */
const RANGE_CHECK_FADE = 0.3;

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
  | 'TOO EARLY'
  | 'PERFECT SPACING'
  /** Something hit you from a place you had no vision of. */
  | 'FROM THE DARK'
  /** You are standing in a bush and nothing on the map can see you. */
  | 'HIDDEN';

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
  /**
   * Which of the two run shapes this is. `play` is the one-minute rep and
   * behaves exactly as every run always has; `survive` has no clock, hands out
   * a strike budget, and turns the difficulty up the longer you last.
   */
  mode?: RunMode;
  arena: { w: number; h: number };
  seed: number;
  difficulty: number;
  abilities: AbilitySlot[];
  /** How the champion is driven. Defaults to League's click scheme. */
  scheme?: MovementScheme;
  /** Where a dash points under WASD. Meaningless under the click scheme. */
  tumbleAim?: TumbleAim;
  /**
   * The body the player wears. Purely a silhouette: the simulation reads it
   * nowhere, which is what keeps a score set behind one champion comparable
   * with a score set behind another.
   */
  hero?: HeroId;
  /**
   * Whether the modes that are built around vision get their fog.
   *
   * A setting rather than a constant for one reason only: a player learning
   * the kit for the first time is learning two things at once with it on, and
   * being able to turn the map's lights up for a few runs is the difference
   * between a hard mode and an opaque one. It changes nothing in any mode that
   * never asked for fog.
   */
  fogOfWar?: boolean;
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

  /**
   * Defining mistakes made so far. Only SURVIVE spends them; PLAY counts them
   * for the results screen and never ends a run over one.
   */
  strikes = 0;
  /** Set the moment the strike budget runs out, so `step` can close the run. */
  private struckOut = false;

  /**
   * The vision ledger. Meaningless — and untouched — in any mode that never
   * turned the fog on.
   */
  unseenHits = 0;
  unseenDamage = 0;
  private lastAmbushAt = -99;
  private visionTime = 0;
  private visionHeldTime = 0;
  private visionShare = 1;
  private concealed = false;

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

  /**
   * Seconds left on the range check the player is currently spending.
   *
   * Zero — which is what it is for almost all of every run — means nothing is
   * drawing your reach and the only thing that knows where it ends is you.
   */
  rangeCheckT = 0;
  /** How many checks this run has cost. Modes about range charge for them. */
  rangeChecks = 0;
  /** What a pause interrupted, so resuming returns to it rather than to play. */
  private pausedFrom: SessionPhase = 'running';

  drill: DrillBase | null = null;

  constructor(config: SessionConfig, private readonly input: InputSystem, private readonly renderer: ViewProjection) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.world = new World(config.arena, this.rng);
    this.world.playerHero = config.hero ?? DEFAULT_HERO;
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

  get mode(): RunMode {
    return this.config.mode ?? 'play';
  }

  get surviving(): boolean {
    return this.mode === 'survive';
  }

  /** Strikes left before SURVIVE ends the run. Infinite in PLAY. */
  get strikesLeft(): number {
    return this.surviving ? Math.max(0, SURVIVE_STRIKES - this.strikes) : Infinity;
  }

  /**
   * How far into the ramp a SURVIVE run is, 0..1.
   *
   * PLAY is always 0: a one-minute rep is meant to be the same rep every time,
   * and a run whose difficulty depends on how long you have been in it is not
   * comparable with the one before it.
   */
  get pressure(): number {
    return this.surviving ? clamp(this.elapsed / SURVIVE_RAMP, 0, 1) : 0;
  }

  /**
   * The difficulty anything spawned *right now* should be built at.
   *
   * Drills read this instead of `config.difficulty` so a SURVIVE run gets
   * genuinely harder rather than merely longer — the wave that arrives at two
   * minutes is a different wave from the one that opened the run.
   */
  get liveDifficulty(): number {
    return clamp(this.config.difficulty + this.pressure * SURVIVE_RAMP_RANGE, 0, 1);
  }

  /**
   * "You did the thing this mode exists to stop you doing."
   *
   * One call, from wherever the mistake is actually detected — the kit, for
   * the Vayne modes, because that is the one place that knows a windup was
   * thrown away or a stack abandoned. PLAY records it and moves on; SURVIVE
   * spends a strike and ends the run on the third.
   */
  strike(reason: string): void {
    if (this.phase !== 'running') return;
    this.strikes++;
    const player = this.world.player;
    if (!this.surviving) return;
    const left = this.strikesLeft;
    audio.play('fail', left > 0 ? 0.8 : 1.2);
    this.fx.addFlash(left > 0 ? 0.09 : 0.16, PALETTE.danger);
    if (player) this.micro(reason, player.pos, PALETTE.danger);
    if (left > 0) {
      this.setBanner(`${reason} — ${left} LEFT`, 1.3);
    } else {
      this.setBanner('OUT OF STRIKES', 1.6);
      this.struckOut = true;
    }
  }

  /**
   * Spend a range check.
   *
   * The camera-centre key does two jobs now, and they are the same job: it
   * puts the view back on your champion *and* it asks the one question the
   * view was hiding — how far can I reach from here. The ring sweeps out to
   * your actual reach so the answer arrives as a distance on the floor rather
   * than as a circle that was already there.
   *
   * Everything about it is counted, because in a mode built on range the
   * interesting number is not how good your spacing is, it is how much of
   * your spacing was read off an indicator.
   */
  checkRange(): void {
    const player = this.world.player;
    this.rangeChecks++;
    this.rangeCheckT = RANGE_CHECK_SECONDS;
    if (player) {
      this.fx.ring(
        player.pos.x,
        player.pos.y,
        player.radius,
        player.attack.range + player.radius,
        0.42,
        PALETTE.accentDim,
        2.5,
        'range',
      );
    }
    this.drill?.onRangeCheck();
  }

  /** True while a check is still drawing your reach. */
  get rangeVisible(): boolean {
    return this.rangeCheckT > 0;
  }

  /**
   * How strongly the check is drawing right now, 0..1.
   *
   * Flat while the check is live and a short fade at the end: a ring that
   * dimmed the whole way through would be asking the player to read a
   * brightness as well as a distance.
   */
  get rangeCheckAlpha(): number {
    if (this.rangeCheckT <= 0) return 0;
    return clamp(this.rangeCheckT / RANGE_CHECK_FADE, 0, 1);
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
      // The map has to be lit before the clock starts: the countdown is when
      // a player reads the terrain and decides which way to open — and the
      // vision read-out has to be telling the truth while they do it.
      this.world.refreshVision(dt);
      this.pollVision(dt, false);
      return;
    }
    if (this.phase !== 'running') {
      this.fx.update(dt);
      return;
    }

    this.elapsed += dt;
    if (this.rangeCheckT > 0) this.rangeCheckT = Math.max(0, this.rangeCheckT - dt);
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
      this.pollVision(0.05, true);
    }
    this.hitFeedback = Math.max(0, this.hitFeedback - dt * 3.6);
    if (this.bannerTime > 0) {
      this.bannerTime -= dt;
      if (this.bannerTime <= 0) this.banner = null;
    }

    if (this.config.duration > 0 && this.elapsed >= this.config.duration) {
      this.endReason = 'time';
      this.end();
    } else if (this.struckOut) {
      // Spending the last strike is a death as far as everything downstream is
      // concerned: the run was ended by the player failing, not by a clock.
      this.endReason = 'death';
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

  /**
   * Pause, or come back from a pause to wherever the run actually was.
   *
   * The countdown counts as somewhere: Escape is how a player reaches the
   * settings, and the three seconds before a drill starts is exactly when
   * someone realises they meant to change a binding first. Resuming from there
   * puts the countdown back rather than dropping the player straight into a
   * live run they were not watching.
   */
  togglePause(): void {
    if (this.phase === 'running' || this.phase === 'countdown') {
      this.pausedFrom = this.phase;
      this.phase = 'paused';
    } else if (this.phase === 'paused') {
      this.phase = this.pausedFrom;
    }
  }

  // ------------------------------------------------------------------ input

  private handleInput(): void {
    const events = this.input.drain();
    if (events.length === 0) return;
    const player = this.world.player;
    for (const e of events) {
      if (e.kind === 'pause') {
        if (this.phase !== 'ended') this.togglePause();
        continue;
      }
      if (e.kind === 'blur') {
        // Losing focus only ever pauses. Toggling here would resume a run for
        // someone who paused deliberately and then switched away from the tab.
        if (this.phase === 'running' || this.phase === 'countdown') {
          this.pausedFrom = this.phase;
          this.phase = 'paused';
        }
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
          // One key, two answers: where am I, and how far do I reach. They
          // are the same question often enough that binding them apart would
          // only be teaching a player to press two keys for one thought.
          this.renderer.recenterCamera?.();
          audio.play('uiTab', 0.55);
          this.checkRange();
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

  /**
   * Damage that arrived from somewhere you had no vision of.
   *
   * The single most useful number a vision mode can give back, because it is
   * the one a player will argue with: "it came out of nowhere" is nearly
   * always "it came out of the same bush as last time, and you walked past the
   * bush". Counting it turns that into something you can watch go down.
   */
  private noteAmbush(e: WorldEvent): void {
    if (!this.world.vision) return;
    const from = this.world.byId(e.actorId);
    const player = this.world.player;
    if (!from || !player || this.world.visible(from)) return;
    this.unseenHits++;
    this.unseenDamage += e.amount ?? 0;
    // Once per second at most: being focused by something in the dark should
    // read as one mistake, not as eight.
    if (this.world.time - this.lastAmbushAt > 1) {
      this.lastAmbushAt = this.world.time;
      this.micro('FROM THE DARK', player.pos, PALETTE.danger);
      this.fx.ring(from.pos.x, from.pos.y, 20, 190, 0.55, PALETTE.danger, 3, 'pulse');
    }
  }

  /**
   * Vision bookkeeping, polled rather than pushed.
   *
   * Two questions, both asked twenty times a second because both are about a
   * *state* rather than an event: how much of the enemy team you currently
   * have eyes on, and whether the bush you are standing in is actually hiding
   * you. The second one has to be told to the player the moment it becomes
   * true — a stealth you cannot tell you have is not a stealth you will ever
   * use on purpose.
   */
  private pollVision(dt: number, live: boolean): void {
    const world = this.world;
    const player = world.player;
    if (!world.vision || !player) return;

    let total = 0;
    let seen = 0;
    for (const a of world.actors) {
      if (!a.alive || a.team !== 'enemy' || a.isMinion || a.hidden) continue;
      total++;
      if (world.visible(a)) seen++;
    }
    this.visionShare = total > 0 ? seen / total : 1;
    // The clock only runs while the run does. Three seconds of countdown spent
    // looking at a map you have not been allowed to walk into yet is not time
    // you lost vision for.
    if (live && total > 0) {
      this.visionTime += dt;
      this.visionHeldTime += dt * (seen / total);
    }

    const hidden = total > 0 && world.inBrush(player.pos) && !world.canSee('enemy', player);
    if (hidden && !this.concealed) {
      this.micro('HIDDEN', player.pos, PALETTE.good);
      audio.play('castArm');
    }
    this.concealed = hidden;
  }

  /** Share of the enemy team you have eyes on right now, 0..1. */
  get visionNow(): number {
    return this.visionShare;
  }

  /** Share of the run spent with vision on the enemy team, 0..1. */
  get visionUptime(): number {
    return this.visionTime > 0.5 ? this.visionHeldTime / this.visionTime : 1;
  }

  /** True while the bush you are in is actually hiding you from someone. */
  get inCover(): boolean {
    return this.concealed;
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
    // The command half: plant and shoot. Timed onto the tick it is free, and
    // early it buys nothing but standing still — so the feedback for a
    // premature one has to be legible, not silent.
    const cost = this.world.requestFire(player);
    this.metrics.noteFireCommand(cost);
    if (cost > 0.06 && player.moveDir) {
      this.fx.ring(player.pos.x, player.pos.y, player.radius + 2, player.radius + 22, 0.26, PALETTE.textDim, 2, 'pulse');
      if (cost > 0.14) this.micro('TOO EARLY', player.pos, PALETTE.textDim);
    }
    audio.play('moveCommand', { pan: this.panOf(at) });
    this.fx.ring(at.x, at.y, 2, 26, 0.32, PALETTE.warn, 2, 'pulse');
  }

  private enemyAt(w: Vec2, from: Actor): Actor | null {
    let best: Actor | null = null;
    let bd = Infinity;
    for (const a of this.world.actors) {
      if (!a.alive || a.team === from.team) continue;
      // A click into the fog is a move command, not an attack order: you
      // cannot target what you cannot see, and the champion walking there
      // instead is exactly what League does with the same click.
      if (!this.world.visible(a)) continue;
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
      if (!this.world.visible(a)) continue;
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
        // What you cannot see, you cannot hear. A windup audible from inside
        // the fog would be a position given away by the sound engine, and the
        // ear is better at locating one than the eye is.
        else if (a && this.world.visible(a)) audio.play('attackWindup', { intensity: 0.5, pan: this.panOf(a.pos) });
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
          this.noteAmbush(e);
        }
        break;
      case 'hazardWarn':
        // Every telegraph in the arena is audible and placed. Half of dodging
        // in League is hearing a cast start while you are looking elsewhere,
        // and a trainer that only ever draws the telegraph trains half of it.
        if (e.pos && this.world.time - this.lastTelegraphAt > 0.12 && this.world.canSeePoint('player', e.pos)) {
          this.lastTelegraphAt = this.world.time;
          audio.play('telegraph', { intensity: 0.9, pan: this.panOf(e.pos) });
        }
        break;
      case 'hazardFire':
        if (e.pos && this.world.canSeePoint('player', e.pos)) audio.play('hazardFire', { intensity: 0.85, pan: this.panOf(e.pos) });
        break;
      case 'projectileSpawn':
        if (e.pos && !e.byPlayer && this.world.canSeePoint('player', e.pos)) {
          audio.play('enemyCast', { intensity: 0.8, pan: this.panOf(e.pos) });
        }
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
  /** The player spent a range check. Modes built on range charge for it. */
  onRangeCheck(): void {}
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
