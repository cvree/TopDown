import * as THREE from 'three';
import { clamp01, smoothstep } from './noise';

/**
 * The League camera: fixed pitch, no orbit, locked to your champion.
 *
 * The one rule that matters for a trainer — you may never lose sight of a
 * spawn — so the follow target is clamped to whatever keeps the whole arena
 * inside the frustum. At the default zoom that clamp pins the camera to the
 * arena centre and the champion moves within a static frame; zoom in and the
 * clamp opens up and the camera starts following you properly.
 *
 * Three behaviours exist because League has them and because each one is a
 * habit worth training rather than a convenience:
 *
 *  - **Locked** (default) follows your champion rigidly. The follow is stiff
 *    on purpose: a floaty spring feels nicer in isolation and is actively
 *    misleading here, because it decouples where your champion is from where
 *    your cursor thinks it is.
 *  - **Unlocked** leaves the camera where it is and lets you drive it. That
 *    is the mode most high-elo players use, and edge-panning without losing
 *    your own champion is a skill in itself.
 *  - **Edge pan** moves the camera when the cursor reaches a screen edge, in
 *    both modes — in locked mode it applies a temporary offset that springs
 *    back, which is exactly how League's locked camera behaves.
 *
 * All of it stays inside the same clamp, so no camera state can ever hide the
 * playable rectangle from you.
 */

export interface Viewport {
  width: number;
  height: number;
}

const PITCH = THREE.MathUtils.degToRad(57.5);
const FOV = 34;

export class RiftCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** 1 = default framing. Smaller is closer. */
  zoom = 1;
  private zoomTarget = 1;
  /** Extra pull-in applied by impacts, decaying back to zero. */
  private punch = 0;
  private shake = new THREE.Vector3();
  private shakeMag = 0;
  private target = new THREE.Vector3();
  private smoothed = new THREE.Vector3();
  private lean = new THREE.Vector2();
  /** Directional kick, in world units, decaying back to zero. */
  private kick = new THREE.Vector2();
  /** Player-driven pan offset from the follow point, in world units. */
  private pan = new THREE.Vector2();
  /** False = unlocked: the camera stays put and you drive it. */
  locked = true;
  /** Edge-pan speed in world units per second at full deflection. */
  edgeSpeed = 1750;
  private baseDistance = 2200;
  private bounds = { w: 1660, h: 960 };
  private viewport: Viewport = { width: 1600, height: 900 };
  private initialised = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 40, 12000);
  }

  setBounds(w: number, h: number): void {
    this.bounds = { w, h };
    this.recomputeBaseDistance();
    this.target.set(w / 2, 0, h / 2);
    this.smoothed.copy(this.target);
    this.initialised = false;
  }

  setViewport(v: Viewport): void {
    this.viewport = v;
    this.camera.aspect = v.width / Math.max(1, v.height);
    this.camera.updateProjectionMatrix();
    this.recomputeBaseDistance();
  }

  /**
   * The distance at which the arena plus a margin exactly fills the frame.
   * Derived rather than hand-tuned so a 21:9 monitor and a laptop both get a
   * fair view of the same drill.
   */
  private recomputeBaseDistance(): void {
    const aspect = this.camera.aspect || 16 / 9;
    const halfV = THREE.MathUtils.degToRad(FOV / 2);
    // Margin is generous on purpose: the terraces and cliffs around the
    // arena are most of what makes the frame read as three-dimensional.
    const needW = this.bounds.w + 660;
    const needH = this.bounds.h + 540;
    // Ground footprint of the frustum at distance d, for a camera pitched at PITCH.
    const dForWidth = needW / (2 * Math.tan(halfV) * aspect);
    // Depth scales linearly with distance too, so one probe is enough to solve
    // for the distance at which the footprint is exactly `needH` deep.
    const probe = 1000;
    const height = Math.sin(PITCH) * probe;
    const behind = Math.cos(PITCH) * probe;
    const depthPerUnit =
      (behind - height / Math.tan(Math.min(1.55, PITCH + halfV)) - (behind - height / Math.max(0.02, Math.tan(PITCH - halfV)))) /
      probe;
    const dForDepth = needH / depthPerUnit;
    this.baseDistance = Math.max(dForWidth, dForDepth);
  }

  get distance(): number {
    return this.baseDistance * this.zoom - this.punch;
  }

  /**
   * The ground footprint of the frustum. A pitched camera sees far more
   * ground away from itself than toward itself, so this is worked out from the
   * actual top and bottom rays rather than assumed symmetric — getting that
   * wrong is what puts the near edge of the arena under the HUD.
   */
  get coverage(): { w: number; h: number; bias: number } {
    const halfV = THREE.MathUtils.degToRad(FOV / 2);
    const d = this.distance;
    const height = Math.sin(PITCH) * d;
    const behind = Math.cos(PITCH) * d;
    const near = behind - height / Math.tan(Math.min(1.55, PITCH + halfV));
    const far = behind - height / Math.max(0.02, Math.tan(PITCH - halfV));
    return {
      w: 2 * d * Math.tan(halfV) * this.camera.aspect,
      h: near - far,
      // Positive means the look point sits below the centre of the footprint.
      bias: (near + far) / 2,
    };
  }

  zoomBy(delta: number): void {
    this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget + delta, 0.42, 1.06);
  }

  setZoom(z: number): void {
    this.zoomTarget = THREE.MathUtils.clamp(z, 0.42, 1.06);
  }

  /** A short pull-in on a kill or a heavy hit. Sells weight better than shake. */
  addPunch(amount: number): void {
    this.punch = Math.min(240, this.punch + amount);
  }

  /**
   * A directional shove, in world units, along a heading. Used for ability
   * casts and heavy landings: a camera that moves *away from* a blow reads as
   * recoil, where an omnidirectional shake just reads as noise.
   */
  addKick(angle: number, amount: number): void {
    this.kick.x += Math.cos(angle) * amount;
    this.kick.y += Math.sin(angle) * amount;
    const m = this.kick.length();
    if (m > 90) this.kick.multiplyScalar(90 / m);
  }

  /** Snap the camera back onto the champion and re-lock the follow. */
  recenter(): void {
    this.pan.set(0, 0);
  }

  toggleLock(): boolean {
    this.locked = !this.locked;
    if (this.locked) this.recenter();
    return this.locked;
  }

  /**
   * Edge pan. `nx`/`ny` are the cursor in normalised device coords; anything
   * within the outer 6% of the frame pushes the camera that way, ramped so a
   * cursor parked in the very corner moves at full speed and one merely near
   * the edge barely drifts.
   */
  edgePan(nx: number, ny: number, dt: number): void {
    const EDGE = 0.94;
    const ramp = (v: number) => {
      const a = Math.abs(v);
      if (a < EDGE) return 0;
      const t = Math.min(1, (a - EDGE) / (1 - EDGE));
      return Math.sign(v) * t * t;
    };
    const dx = ramp(nx);
    // Screen-up is -z in world space for this camera's fixed heading.
    const dz = -ramp(ny);
    if (dx === 0 && dz === 0) return;
    this.pan.x += dx * this.edgeSpeed * dt;
    this.pan.y += dz * this.edgeSpeed * dt;
  }

  addShake(amount: number): void {
    this.shakeMag = Math.min(46, this.shakeMag + amount);
  }

  /**
   * @param focus  world-space point to follow (the champion)
   * @param cursor cursor position in normalised device coords (-1..1)
   */
  update(dt: number, focus: { x: number; y: number }, cursor: { x: number; y: number }): void {
    this.zoom += (this.zoomTarget - this.zoom) * clamp01(dt * 9);
    this.punch *= Math.exp(-dt * 7);
    this.shakeMag *= Math.exp(-dt * 9.5);
    this.kick.multiplyScalar(Math.exp(-dt * 11));

    // A locked camera springs its pan offset back to the champion; an
    // unlocked one keeps whatever you drove it to.
    if (this.locked) this.pan.multiplyScalar(Math.exp(-dt * 3.2));

    const cov = this.coverage;
    const { w, h } = this.bounds;
    // Half-extent the camera may stray from the arena centre before an edge of
    // the playable rectangle would leave the frame.
    const slackX = Math.max(0, (w + 420 - cov.w) / 2);
    const slackZ = Math.max(0, (h + 380 - cov.h) / 2);

    const cx = w / 2;
    const cz = h / 2;
    // The pan offset is clamped to the same slack, so no amount of edge
    // scrolling can put the arena off screen.
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -slackX * 2, slackX * 2);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y, -slackZ * 2, slackZ * 2);

    const anchorX = this.locked ? focus.x : cx;
    const anchorZ = this.locked ? focus.y : cz;
    this.target.set(
      THREE.MathUtils.clamp(anchorX + this.pan.x, cx - slackX, cx + slackX),
      0,
      THREE.MathUtils.clamp(anchorZ + this.pan.y, cz - slackZ, cz + slackZ),
    );

    if (!this.initialised) {
      this.smoothed.copy(this.target);
      this.initialised = true;
    } else {
      // Stiff on purpose. League's locked camera is rigid, and a soft follow
      // puts your champion somewhere your cursor is not — which would make
      // every click-error measurement in the trainer a lie.
      this.smoothed.lerp(this.target, clamp01(dt * 17));
    }

    // A few units of lean toward the cursor. Not enough to move the arena,
    // enough that the walls parallax and the scene reads as solid.
    const leanAmount = 46 + (1 - this.zoom) * 90;
    this.lean.x += (cursor.x * leanAmount - this.lean.x) * clamp01(dt * 4);
    this.lean.y += (cursor.y * leanAmount - this.lean.y) * clamp01(dt * 4);

    if (this.shakeMag > 0.01) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI * 2;
      this.shake.set(Math.cos(a) * this.shakeMag, Math.sin(b) * this.shakeMag * 0.6, Math.sin(a) * this.shakeMag);
    } else {
      this.shake.set(0, 0, 0);
    }

    const d = this.distance;
    // Push the look point toward the camera by half the footprint's bias so
    // the thing you are actually looking at lands on the centre of the screen.
    const look = new THREE.Vector3(
      this.smoothed.x + this.lean.x + this.kick.x,
      0,
      this.smoothed.z - this.lean.y + this.kick.y + cov.bias * 0.55,
    );
    this.camera.position.set(
      look.x + this.shake.x,
      Math.sin(PITCH) * d + this.shake.y,
      look.z + Math.cos(PITCH) * d + this.shake.z,
    );
    this.camera.lookAt(look.x, 0, look.z);
    this.camera.updateMatrixWorld();
  }

  /** Ground-plane intersection of a screen ray, in world units. */
  screenToWorld(nx: number, ny: number, out = { x: 0, y: 0 }): { x: number; y: number } {
    const ray = new THREE.Ray();
    const origin = this.camera.position;
    const dir = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera).sub(origin).normalize();
    ray.set(origin, dir);
    if (Math.abs(dir.y) < 1e-6) return out;
    const t = -origin.y / dir.y;
    out.x = origin.x + dir.x * t;
    out.y = origin.z + dir.z * t;
    return out;
  }

  /** World-space point to CSS pixels. `z` is the normalised depth. */
  worldToScreen(x: number, y: number, height: number, out = { x: 0, y: 0, z: 0, visible: false }) {
    const v = new THREE.Vector3(x, height, y).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.viewport.width;
    out.y = (-v.y * 0.5 + 0.5) * this.viewport.height;
    out.z = v.z;
    out.visible = v.z > -1 && v.z < 1;
    return out;
  }

  /** How many CSS pixels one world unit spans at the given ground point. */
  pixelsPerUnit(x: number, y: number): number {
    const a = this.worldToScreen(x, y, 0);
    const b = this.worldToScreen(x + 100, y, 0);
    return Math.abs(b.x - a.x) / 100;
  }

  /** The point the camera is currently centred on, in world units. */
  get focus(): { x: number; y: number } {
    return { x: this.smoothed.x, y: this.smoothed.z };
  }

  get pitch(): number {
    return PITCH;
  }
}

export const cameraFalloff = smoothstep;
