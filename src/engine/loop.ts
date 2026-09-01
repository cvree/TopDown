import { clamp } from './math';

/**
 * Fixed-timestep simulation with interpolated rendering.
 *
 * The simulation always advances in identical 1/240s slices, so movement,
 * attack windups and projectile travel are bit-identical whether the display
 * runs at 60Hz or 240Hz. Rendering then interpolates between the two most
 * recent sim states, which is what makes motion look smooth on a 165Hz panel
 * without the physics being tied to it.
 */
export const SIM_HZ = 240;
export const SIM_DT = 1 / SIM_HZ;

/** Never simulate more than this much wall time in a single frame. */
const MAX_FRAME_TIME = 0.25;

export interface LoopStats {
  /** Smoothed frames per second of the render loop. */
  fps: number;
  /** Smoothed milliseconds spent inside step+render for one frame. */
  frameMs: number;
  /** Sim steps consumed by the most recent frame. */
  steps: number;
}

export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private fpsSmooth = 60;
  private msSmooth = 4;

  readonly stats: LoopStats = { fps: 60, frameMs: 0, steps: 0 };

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (alpha: number, dtWall: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    const t0 = now;
    let frame = (now - this.last) / 1000;
    this.last = now;
    if (!Number.isFinite(frame) || frame < 0) frame = 0;
    // A tab that was backgrounded should resume, not fast-forward.
    frame = clamp(frame, 0, MAX_FRAME_TIME);

    this.acc += frame;
    let steps = 0;
    while (this.acc >= SIM_DT) {
      this.step(SIM_DT);
      this.acc -= SIM_DT;
      steps++;
      // Hard ceiling stops a slow machine from spiralling into a freeze.
      if (steps > 240) {
        this.acc = 0;
        break;
      }
    }

    this.render(this.acc / SIM_DT, frame);

    const elapsed = performance.now() - t0;
    const instantFps = frame > 0 ? 1 / frame : 60;
    this.fpsSmooth += (instantFps - this.fpsSmooth) * 0.08;
    this.msSmooth += (elapsed - this.msSmooth) * 0.08;
    this.stats.fps = this.fpsSmooth;
    this.stats.frameMs = this.msSmooth;
    this.stats.steps = steps;
  };
}
