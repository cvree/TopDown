import * as THREE from 'three';
import type { Wall } from '../engine/types';
import { rockSurface, tiled } from './textures';

/**
 * Terrain blocks.
 *
 * Condemn only means anything if you can see, at a glance and from the
 * overhead camera, which side of a body the wall is on. So these are real
 * geometry with real height and real shadows rather than a painted rectangle:
 * the shadow a block throws is what tells you where it is, and a decal has no
 * shadow. The lip along the top edge catches the key light and gives the
 * silhouette a line to read against the floor.
 *
 * Walls never move, so the layer builds once per drill and then does nothing
 * at all per frame.
 */
export class WallLayer {
  private group = new THREE.Group();
  private built: Wall[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(
    private readonly parent: THREE.Object3D,
    /** Lets the scene fog the stone, so a wall darkens with the floor it sits on. */
    private readonly onMaterial?: (m: THREE.Material) => void,
  ) {
    this.parent.add(this.group);
  }

  sync(walls: readonly Wall[]): void {
    if (this.same(walls)) return;
    this.clear();
    this.built = walls.map((w) => ({ ...w }));

    const surf = rockSurface(3);
    for (const wall of walls) {
      const height = 118;
      const geo = new THREE.BoxGeometry(wall.w, height, wall.h);
      const tile = Math.max(wall.w, wall.h) / 420;
      const mat = new THREE.MeshStandardMaterial({
        map: tiled(surf.albedo, tile, 1),
        normalMap: tiled(surf.normal, tile, 1),
        roughness: 1,
        metalness: 0.03,
        // Close to the terrace stone: a wall much brighter than the floor
        // reads as a prop, and one much darker reads as a hole.
        color: 0x7d8794,
      });
      this.onMaterial?.(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wall.x, height / 2, wall.y);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.geometries.push(geo);
      this.materials.push(mat);

      // A brighter cap, inset slightly, so the top edge reads as an edge
      // instead of dissolving into the floor at this camera angle.
      const capGeo = new THREE.BoxGeometry(wall.w * 1.04, 12, wall.h * 1.04);
      const capMat = new THREE.MeshStandardMaterial({
        map: tiled(surf.albedo, tile, 1),
        color: 0x98a2b0,
        roughness: 1,
        metalness: 0.04,
      });
      this.onMaterial?.(capMat);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(wall.x, height, wall.y);
      cap.castShadow = true;
      cap.receiveShadow = true;
      this.group.add(cap);
      this.geometries.push(capGeo);
      this.materials.push(capMat);
    }
  }

  private same(walls: readonly Wall[]): boolean {
    if (walls.length !== this.built.length) return false;
    for (let i = 0; i < walls.length; i++) {
      const a = walls[i];
      const b = this.built[i];
      if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) return false;
    }
    return true;
  }

  private clear(): void {
    this.group.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.built.length = 0;
  }

  dispose(): void {
    this.clear();
    this.parent.remove(this.group);
  }
}
