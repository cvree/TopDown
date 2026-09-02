import * as THREE from 'three';
import type { FxSystem } from '../engine/fx';
import type { DrillPaint } from '../engine/paint';
import { newPaint } from '../engine/paint';
import type { Actor, Hazard, Vec2 } from '../engine/types';
import type { World } from '../engine/world';
import { DecalLayer } from './decals';
import { OverlayHud } from './overlay';
import { ParticleLayer } from './particles';
import { ProjectileLayer } from './projectiles';
import { RiftScene, type Quality } from './scene';
import { UnitLayer } from './units';

/**
 * The renderer the game talks to.
 *
 * It owns the 3D scene and every layer that draws into it, and exposes exactly
 * the surface the session needs: turn a screen point into a world point, turn
 * a world state into a frame. Nothing above this file knows that three.js
 * exists; nothing below it knows what a drill is.
 */

export interface RenderOpts {
  /** Cursor in CSS pixels relative to the canvas. */
  cursor: Vec2;
  showRange: boolean;
  hoverTargetId: number | null;
  pathTrail: Vec2[];
  chain: number;
  dimmed: number;
  hitFeedback: number;
  lowFx?: boolean;
  /** Edge panning is live only while the run is actually running. */
  allowEdgePan?: boolean;
  paint?: DrillPaint;
  showNames?: boolean;
  /** Suppresses the player's own indicators during the countdown. */
  idle?: boolean;
}

const ALLY_RANGE = '#7fd2ff';
const ENEMY_RANGE = '#ff6a5c';

/** Where a unit's health bar sits, in world units above the floor. */
const headHeight = (a: Actor): number => a.radius * (a.isMinion ? 4.0 : 5.0) + 26;

export class RiftRenderer {
  readonly scene: RiftScene;
  private units: UnitLayer;
  private decals: DecalLayer;
  private projectiles: ProjectileLayer;
  private particles: ParticleLayer;
  private overlay: OverlayHud;
  private emptyPaint = newPaint();

  private prevShake = 0;
  private stride = new Map<number, number>();
  private lastPos = new Map<number, Vec2>();
  private pathRibbon: THREE.Mesh;
  private pathPos: THREE.BufferAttribute;
  private pathAlpha: THREE.BufferAttribute;
  private cssW = 1;
  private cssH = 1;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    bounds: { w: number; h: number },
    accent = '#58e0ff',
    seed = 7,
  ) {
    this.scene = new RiftScene(canvas, bounds, accent, seed);
    this.units = new UnitLayer(this.scene.world);
    this.decals = new DecalLayer(this.scene.world);
    this.projectiles = new ProjectileLayer(this.scene.world);
    this.particles = new ParticleLayer(this.scene.world);
    this.overlay = new OverlayHud(overlayCanvas);

    // Your own movement history, drawn as a fading ribbon on the floor. It is
    // the one piece of feedback that shows path efficiency while you play
    // rather than after the run.
    const PATH = 90;
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array(PATH * 2 * 3);
    const alphas = new Float32Array(PATH * 2);
    const idx: number[] = [];
    for (let i = 0; i < PATH - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.pathPos = new THREE.BufferAttribute(verts, 3).setUsage(THREE.DynamicDrawUsage);
    this.pathAlpha = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pathPos);
    geo.setAttribute('aAlpha', this.pathAlpha);
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.pathRibbon = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(accent) } },
        vertexShader: `attribute float aAlpha; varying float vA;
          void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; varying float vA;
          void main(){ if(vA<=0.003) discard; gl_FragColor = vec4(uColor, vA); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.pathRibbon.frustumCulled = false;
    this.pathRibbon.renderOrder = 5;
    this.scene.world.add(this.pathRibbon);
  }

  setQuality(q: Quality): void {
    this.scene.setQuality(q);
  }

  zoomBy(delta: number): void {
    this.scene.rig.zoomBy(delta);
  }

  /** Camera controls the session drives on the player's behalf. */
  cameraKick(angle: number, amount: number): void {
    this.scene.rig.addKick(angle, amount);
  }

  recenterCamera(): void {
    this.scene.rig.recenter();
  }

  toggleCameraLock(): boolean {
    return this.scene.rig.toggleLock();
  }

  get cameraLocked(): boolean {
    return this.scene.rig.locked;
  }

  /** Kept for API compatibility with the old renderer: bounds are fixed. */
  resize(_worldW?: number, _worldH?: number): void {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.scene.resize(this.cssW, this.cssH);
    this.overlay.resize(this.cssW, this.cssH);
  }

  screenToWorld(x: number, y: number): Vec2 {
    const nx = (x / this.cssW) * 2 - 1;
    const ny = -((y / this.cssH) * 2 - 1);
    return this.scene.rig.screenToWorld(nx, ny);
  }

  /**
   * Where a world point sits in the stereo field. Scaled short of the hard
   * edges: a sound pinned fully to one ear reads as a bug, not as space.
   */
  panAt(p: Vec2): number {
    const s = this.scene.rig.worldToScreen(p.x, p.y, 0);
    return Math.max(-1, Math.min(1, ((s.x / this.cssW) * 2 - 1) * 0.7));
  }

  worldToScreen(p: Vec2): Vec2 {
    const s = this.scene.rig.worldToScreen(p.x, p.y, 0);
    return { x: s.x, y: s.y };
  }

  render(world: World, fx: FxSystem, alpha: number, dtWall: number, opts: RenderOpts): void {
    if (this.disposed) return;
    const dt = Math.min(0.05, dtWall);
    const player = world.player;
    const paint = opts.paint ?? this.emptyPaint;

    // ------------------------------------------------------------- camera
    const focus = player ? { x: player.pos.x, y: player.pos.y } : { x: world.bounds.w / 2, y: world.bounds.h / 2 };
    const ndc = { x: (opts.cursor.x / this.cssW) * 2 - 1, y: -((opts.cursor.y / this.cssH) * 2 - 1) };
    // Feed the effect system's shake into the camera as impulses, so a hit
    // moves the whole viewpoint rather than sliding a flat image around.
    if (fx.shake > this.prevShake) this.scene.rig.addShake((fx.shake - this.prevShake) * 2.4);
    this.prevShake = fx.shake;
    if (fx.flash > 0.1) this.scene.rig.addPunch(fx.flash * 130);
    // Edge panning happens before the follow update so a pan and a follow in
    // the same frame resolve against the same clamp.
    if (opts.allowEdgePan) this.scene.rig.edgePan(ndc.x, ndc.y, dt);
    this.scene.rig.update(dt, focus, ndc);

    const cursorWorld = this.screenToWorld(opts.cursor.x, opts.cursor.y);

    // ------------------------------------------------------------- decals
    this.decals.begin(dt);

    // Threat rings first, so your own range indicator draws on top of them.
    for (const a of world.actors) {
      if (!a.alive || a.team === 'player') continue;
      if (opts.hoverTargetId === a.id) {
        this.decals.ring(a.pos.x, a.pos.y, a.attack.range + (player?.radius ?? 0), {
          color: ENEMY_RANGE,
          alpha: 0.5,
          width: 3,
          dash: 46,
          spin: -0.25,
        });
      }
    }

    if (player && opts.showRange && !opts.idle) {
      // Your attack range. Dashed and slowly rotating so it never reads as
      // part of the floor, brighter as the clean-chain builds.
      const chain = Math.min(1, opts.chain / 8);
      this.decals.ring(player.pos.x, player.pos.y, player.attack.range + player.radius, {
        color: ALLY_RANGE,
        alpha: 0.34 + chain * 0.3,
        width: 4,
        dash: 64,
        spin: 0.12,
      });
      this.decals.ring(player.pos.x, player.pos.y, player.attack.range + player.radius, {
        color: ALLY_RANGE,
        alpha: 0.1 + chain * 0.12,
        width: 2,
        rise: 1.6,
      });
    }

    // Where you told your champion to go.
    if (player?.order && player.order.kind !== 'hold' && !opts.idle) {
      const o = player.order;
      const col = o.kind === 'attackMove' ? '#ffcf6b' : '#6dffb4';
      this.decals.ring(o.pos.x, o.pos.y, 22, { color: col, alpha: 0.75, width: 3, rise: 2.4 });
      this.decals.ring(o.pos.x, o.pos.y, 9, { color: col, alpha: 0.5, width: 9, rise: 2.4 });
    }

    for (const h of world.hazards) this.drawHazard(h);
    for (const m of paint.markers) this.drawMarker(m);

    // Effect rings: impacts, kills, near-misses. Ground shockwaves.
    for (const r of fx.rings) {
      const t = 1 - r.life / r.max;
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      const radius = r.r0 + (r.r1 - r.r0) * eased;
      this.decals.ring(r.x, r.y, radius, {
        color: r.color,
        alpha: (1 - t) * (r.kind === 'shock' ? 0.9 : 0.75),
        width: r.width * (r.kind === 'shock' ? 3.4 : 2.6),
        rise: 3,
      });
    }

    // A ground reticle under the cursor: cheap, and it anchors the mouse to
    // the floor plane, which a 2D cursor over a 3D scene otherwise does not.
    if (!opts.idle) {
      this.decals.ring(cursorWorld.x, cursorWorld.y, 15, { color: '#dff6ff', alpha: 0.3, width: 2, rise: 2.2 });
      this.decals.ring(cursorWorld.x, cursorWorld.y, 3, { color: '#dff6ff', alpha: 0.5, width: 3, rise: 2.2 });
    }

    this.decals.end();

    // ------------------------------------------------------------- layers
    this.footsteps(world, fx, alpha);
    this.units.sync(world, alpha, dt, opts.hoverTargetId);
    this.projectiles.sync(world, alpha);
    this.particles.sync(fx);
    this.writePath(opts.pathTrail, fx.energy);

    this.scene.render(dt, {
      hurt: opts.hitFeedback,
      flash: fx.flash,
      flashColor: fx.flashColor,
      energy: fx.energy,
      dim: opts.dimmed,
    });

    this.overlay.draw(world, fx, this.scene.rig, {
      hoverId: opts.hoverTargetId,
      playerId: world.playerId,
      headHeight,
      paint,
      showNames: opts.showNames ?? true,
    });
  }

  // ------------------------------------------------------------- internals

  private drawHazard(h: Hazard): void {
    const warning = h.warn > 0;
    const progress = warning ? 1 - h.warn / Math.max(0.0001, h.warnTotal) : 1;
    const live = !warning;
    const color = h.color ?? (live ? '#ff8a5c' : '#ff5f7e');
    // The telegraph fills up as the danger window closes: an area that is
    // nearly full is an area you are already too late to leave.
    const alpha = live ? 0.85 : 0.55 + progress * 0.35;
    const fill = live ? 0.5 : 0.1 + progress * 0.3;
    const rise = 2.8;

    switch (h.shape) {
      case 'line': {
        const end = h.end ?? h.pos;
        this.decals.line(h.pos.x, h.pos.y, end.x, end.y, h.width ?? 40, {
          color,
          alpha,
          fill,
          progress: warning ? progress : 0,
          rise,
        });
        break;
      }
      case 'cone': {
        const end = h.end ?? { x: h.pos.x + 1, y: h.pos.y };
        const a = Math.atan2(end.y - h.pos.y, end.x - h.pos.x);
        const half = h.width ?? 0.5;
        this.decals.sector(h.pos.x, h.pos.y, h.radius, a - half, a + half, { color, alpha, fill, rise });
        break;
      }
      case 'ring': {
        this.decals.ring(h.pos.x, h.pos.y, h.radius, { color, alpha, width: (h.width ?? 30) * 2, rise });
        break;
      }
      default: {
        this.decals.disc(h.pos.x, h.pos.y, h.radius, { color, alpha, fill, rise });
        if (warning) {
          this.decals.ring(h.pos.x, h.pos.y, h.radius * progress, { color, alpha: 0.8, width: 5, rise: rise + 0.4 });
        }
        break;
      }
    }
  }

  private drawMarker(m: DrillPaint['markers'][number]): void {
    switch (m.kind) {
      case 'ring':
        this.decals.ring(m.x, m.y, m.radius, m);
        break;
      case 'disc':
        this.decals.disc(m.x, m.y, m.radius, m);
        break;
      case 'sector':
        this.decals.sector(m.x, m.y, m.radius, m.a0, m.a1, m);
        break;
      case 'line':
        this.decals.line(m.x, m.y, m.x2, m.y2, m.halfWidth, m);
        break;
      case 'cross':
        this.decals.line(m.x - m.radius, m.y - m.radius, m.x + m.radius, m.y + m.radius, m.width ?? 3, m);
        this.decals.line(m.x + m.radius, m.y - m.radius, m.x - m.radius, m.y + m.radius, m.width ?? 3, m);
        break;
    }
  }

  /** Kicks a puff of dust every time a moving unit covers enough ground. */
  private footsteps(world: World, fx: FxSystem, alpha: number): void {
    for (const a of world.actors) {
      if (!a.alive) continue;
      const x = a.prev.x + (a.pos.x - a.prev.x) * alpha;
      const y = a.prev.y + (a.pos.y - a.prev.y) * alpha;
      const last = this.lastPos.get(a.id);
      if (!last) {
        this.lastPos.set(a.id, { x, y });
        continue;
      }
      const moved = Math.hypot(x - last.x, y - last.y);
      last.x = x;
      last.y = y;
      const acc = (this.stride.get(a.id) ?? 0) + moved;
      if (acc > 86) {
        this.stride.set(a.id, 0);
        fx.burst(x, y, 3, {
          color: '#b9ad96',
          speed: 46,
          life: 0.5,
          size: 2.6,
          kind: 'dust',
          drag: 5,
        });
      } else {
        this.stride.set(a.id, acc);
      }
    }
  }

  private writePath(trail: Vec2[], energy: number): void {
    const CAP = 90;
    const n = Math.min(CAP, trail.length);
    if (n < 2) {
      this.pathRibbon.visible = false;
      return;
    }
    this.pathRibbon.visible = true;
    const start = trail.length - n;
    for (let i = 0; i < CAP; i++) {
      const j = Math.min(n - 1, i);
      const p = trail[start + j];
      const q = trail[start + Math.min(n - 1, j + 1)];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const t = i / (CAP - 1);
      const w = 3 + t * 6;
      const nx = (-dy / len) * w;
      const ny = (dx / len) * w;
      const a = i * 2;
      this.pathPos.setXYZ(a, p.x + nx, 1.2, p.y + ny);
      this.pathPos.setXYZ(a + 1, p.x - nx, 1.2, p.y - ny);
      const fade = i >= n - 1 ? 0 : t * t * (0.16 + energy * 0.2);
      this.pathAlpha.setX(a, fade);
      this.pathAlpha.setX(a + 1, fade);
    }
    this.pathPos.needsUpdate = true;
    this.pathAlpha.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.units.dispose();
    this.decals.dispose();
    this.projectiles.dispose();
    this.particles.dispose();
    this.pathRibbon.geometry.dispose();
    (this.pathRibbon.material as THREE.Material).dispose();
    this.scene.dispose();
  }
}
