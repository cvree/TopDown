import * as THREE from 'three';
import type { Brush } from '../engine/types';

/**
 * Bushes.
 *
 * A bush has to read as a *place* from the overhead camera — somewhere you can
 * stand — rather than as a texture on the floor, because the whole mechanic is
 * about whether a body is inside one or beside one. So it is built the way the
 * arena's own terrain is: a footprint painted on the ground for the boundary,
 * and real blades standing up out of it for the volume, which is what gives it
 * a silhouette against the stone and a shadow to sit in.
 *
 * The blades are drawn at half height where the player is standing, in the
 * same way League fades the bush you are inside: you are allowed to see your
 * own champion's feet in the place you chose to hide.
 */

const BLADE_TEX = (): THREE.Texture => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.clearRect(0, 0, 128, 128);
    let seed = 1337;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 42; i++) {
      const x = rand() * 128;
      const hgt = 52 + rand() * 66;
      const lean = (rand() - 0.5) * 34;
      const grad = g.createLinearGradient(x, 128, x + lean, 128 - hgt);
      grad.addColorStop(0, 'rgba(16,38,24,1)');
      grad.addColorStop(0.6, 'rgba(38,86,48,0.98)');
      grad.addColorStop(1, 'rgba(96,158,86,0.9)');
      g.strokeStyle = grad;
      g.lineWidth = 2.4 + rand() * 3.4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, 128);
      g.quadraticCurveTo(x + lean * 0.4, 128 - hgt * 0.6, x + lean, 128 - hgt);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

/** Soft-edged footprint, so a bush does not end on a hard rectangle. */
const FLOOR_TEX = (): THREE.Texture => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0, 'rgba(28,58,34,0.95)');
    grad.addColorStop(0.72, 'rgba(24,50,30,0.8)');
    grad.addColorStop(1, 'rgba(20,44,26,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

/** One clump of blades per this many square units of bush. */
const DENSITY = 5200;
const BLADE = 96;

export class BrushLayer {
  private group = new THREE.Group();
  private built: Brush[] = [];
  private disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly parent: THREE.Object3D,
    /** Lets the scene fog every surface this layer creates. */
    private readonly onMaterial?: (m: THREE.Material) => void,
  ) {
    this.parent.add(this.group);
  }

  sync(brush: readonly Brush[]): void {
    if (this.same(brush)) return;
    this.clear();
    this.built = brush.map((b) => ({ ...b }));
    if (!brush.length) return;

    const bladeTex = this.track(BLADE_TEX());
    const floorTex = this.track(FLOOR_TEX());
    const bladeMat = this.track(
      new THREE.MeshStandardMaterial({
        map: bladeTex,
        transparent: true,
        alphaTest: 0.34,
        side: THREE.DoubleSide,
        roughness: 1,
        metalness: 0,
        color: 0x9fc48f,
      }),
    );
    const floorMat = this.track(
      new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false, opacity: 0.85 }),
    );
    this.onMaterial?.(bladeMat);
    this.onMaterial?.(floorMat);

    let seed = 20250;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const dummy = new THREE.Object3D();

    for (const b of brush) {
      const pad = this.track(new THREE.PlaneGeometry(b.w * 1.16, b.h * 1.16));
      const floor = new THREE.Mesh(pad, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(b.x, 1.4, b.y);
      floor.renderOrder = 2;
      this.group.add(floor);

      const count = Math.max(14, Math.round((b.w * b.h) / DENSITY));
      const geo = this.track(new THREE.PlaneGeometry(1, 1));
      const blades = new THREE.InstancedMesh(geo, bladeMat, count * 2);
      blades.receiveShadow = true;
      blades.castShadow = false;
      let i = 0;
      for (let n = 0; n < count; n++) {
        const px = b.x + (rand() - 0.5) * (b.w - BLADE * 0.4);
        const pz = b.y + (rand() - 0.5) * (b.h - BLADE * 0.4);
        const s = BLADE * (0.78 + rand() * 0.5);
        // Two quads crossed through each other: from a locked overhead camera
        // a single billboard collapses to a line at the edges of the screen.
        for (let k = 0; k < 2; k++) {
          dummy.position.set(px, s * 0.44, pz);
          dummy.rotation.set(0, rand() * Math.PI + (k * Math.PI) / 2, 0);
          dummy.scale.set(s, s * 0.9, s);
          dummy.updateMatrix();
          blades.setMatrixAt(i++, dummy.matrix);
        }
      }
      blades.count = i;
      blades.instanceMatrix.needsUpdate = true;
      this.group.add(blades);
    }
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private same(brush: readonly Brush[]): boolean {
    if (brush.length !== this.built.length) return false;
    for (let i = 0; i < brush.length; i++) {
      const a = brush[i];
      const b = this.built[i];
      if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) return false;
    }
    return true;
  }

  private clear(): void {
    for (const child of this.group.children) {
      if ((child as THREE.InstancedMesh).isInstancedMesh) (child as THREE.InstancedMesh).dispose();
    }
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.built.length = 0;
  }

  dispose(): void {
    this.clear();
    this.parent.remove(this.group);
  }
}
