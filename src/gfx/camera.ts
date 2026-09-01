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

    const cov = this.coverage;
    const { w, h } = this.bounds;
    // Half-extent the camera may stray from the arena centre before an edge of
    // the playable rectangle would leave the frame.
    const slackX = Math.max(0, (w + 420 - cov.w) / 2);
    const slackZ = Math.max(0, (h + 380 - cov.h) / 2);

    const cx = w / 2;
    const cz = h / 2;
    this.target.set(
      THREE.MathUtils.clamp(focus.x, cx - slackX, cx + slackX),
      0,
      THREE.MathUtils.clamp(focus.y, cz - slackZ, cz + slackZ),
    );

    if (!this.initialised) {
      this.smoothed.copy(this.target);
      this.initialised = true;
    } else {
      this.smoothed.lerp(this.target, clamp01(dt * 6.5));
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
    const look = new THREE.Vector3(this.smoothed.x + this.lean.x, 0, this.smoothed.z - this.lean.y + cov.bias * 0.55);
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
