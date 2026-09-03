import * as THREE from 'three';
import type { Actor } from '../engine/types';
import type { World } from '../engine/world';
import { rockSurface, tiled } from './textures';

/**
 * Turrets.
 *
 * A turret is not a champion, and trying to render it as one — a rig with a
 * stance and a walk cycle it never uses — reads as a very confused person
 * standing in a lane. It is architecture: a plinth, a tapered shaft, a crown,
 * and one hot eye that tells you, from across the arena and without a health
 * bar, whether it is looking at a minion or at you.
 *
 * The eye is the whole reason this layer exists. Under-tower last hitting is a
 * timing problem — the shot lands, then you take yours — and the only way to
 * time it is to see the turret wind up. So the eye tracks the target, swells
 * through the windup and flares white on release, driven straight off the same
 * attack timers the simulation scores you against.
 */

const ALLY = 0x5fa8e0;
const ENEMY = 0xe05a4a;

interface Entry {
  group: THREE.Group;
  eye: THREE.Mesh;
  eyeMat: THREE.MeshBasicMaterial;
  glow: THREE.PointLight;
  base: number;
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
}

export class StructureLayer {
  private entries = new Map<number, Entry>();

  constructor(private readonly parent: THREE.Object3D) {}

  sync(world: World, dt: number): void {
    const seen = new Set<number>();
    for (const a of world.actors) {
      if (a.unitKind !== 'turret') continue;
      seen.add(a.id);
      let e = this.entries.get(a.id);
      if (!e) {
        e = this.build(a);
        this.entries.set(a.id, e);
      }

      // Windup swell, release flare. The turret's tell is the only warning a
      // minion under it — or a diving champion — ever gets.
      const cycle = 1 / Math.max(0.05, a.attack.attackSpeed);
      const windup = cycle * a.attack.windupRatio;
      let heat = 0.25;
      if (a.phase === 'windup') heat = 0.25 + 0.75 * (1 - Math.max(0, Math.min(1, a.phaseTime / Math.max(0.0001, windup))));
      else if (a.phase === 'backswing') heat = 1;
      const target = world.byId(a.targetId);
      if (target && target.alive) {
        const ang = Math.atan2(target.pos.y - a.pos.y, target.pos.x - a.pos.x);
        e.group.rotation.y = Math.PI / 2 - ang;
      }

      const c = new THREE.Color(e.base);
      e.eyeMat.color.copy(c).lerp(new THREE.Color(0xffffff), heat * 0.7);
      e.eye.scale.setScalar(0.9 + heat * 0.5);
      e.glow.intensity = 2.2 + heat * 9;
      e.glow.color.copy(e.eyeMat.color);
      void dt;
    }

    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      this.release(e);
      this.entries.delete(id);
    }
  }

  private build(a: Actor): Entry {
    const ally = a.team === 'player';
    const base = ally ? ALLY : ENEMY;
    const group = new THREE.Group();
    group.position.set(a.pos.x, 0, a.pos.y);
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const surf = rockSurface(5);

    const stone = new THREE.MeshStandardMaterial({
      map: tiled(surf.albedo, 1.4, 1),
      normalMap: tiled(surf.normal, 1.4, 1),
      color: ally ? 0x8d9aa8 : 0x9a8d88,
      roughness: 0.95,
      metalness: 0.05,
    });
    mats.push(stone);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      geos.push(geo);
      return m;
    };

    // Proportions matter more than detail from 57° up: the plinth has to stay
    // wider than the crown or the crown simply hides the tower under itself,
    // and the whole thing has to be short enough that its own silhouette does
    // not swallow the minions standing at its feet.
    const r = a.radius;
    add(new THREE.CylinderGeometry(r * 1.9, r * 2.2, 54, 10), stone, 27);
    add(new THREE.CylinderGeometry(r * 1.02, r * 1.6, 168, 10), stone, 138);
    const crownMat = new THREE.MeshStandardMaterial({
      color: ally ? 0xa9bccc : 0xc0a49c,
      roughness: 0.8,
      metalness: 0.18,
    });
    mats.push(crownMat);
    add(new THREE.CylinderGeometry(r * 1.24, r * 0.98, 44, 10), crownMat, 244);
    add(new THREE.ConeGeometry(r * 1.02, 62, 10), crownMat, 297);

    // A lit band in the team's colour. Which side a structure belongs to is
    // the first thing you need from it and the last thing a grey silhouette
    // will ever tell you.
    const bandMat = new THREE.MeshBasicMaterial({ color: base, transparent: true, opacity: 0.85 });
    mats.push(bandMat);
    const bandGeo = new THREE.CylinderGeometry(r * 1.3, r * 1.3, 12, 10, 1, true);
    add(bandGeo, bandMat, 218);

    const eyeMat = new THREE.MeshBasicMaterial({ color: base, transparent: true, opacity: 0.95 });
    mats.push(eyeMat);
    const eyeGeo = new THREE.SphereGeometry(r * 0.44, 12, 10);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    // Forward is +X so the group's yaw aims it the same way an actor's facing
    // does — the eye is the turret's tell, and a tell has to point at you.
    eye.position.set(r * 1.0, 240, 0);
    group.add(eye);
    geos.push(eyeGeo);

    const glow = new THREE.PointLight(base, 4, 620, 2);
    glow.position.set(0, 240, 0);
    group.add(glow);

    this.parent.add(group);
    return { group, eye, eyeMat, glow, base, geos, mats };
  }

  private release(e: Entry): void {
    e.group.removeFromParent();
    for (const g of e.geos) g.dispose();
    for (const m of e.mats) m.dispose();
  }

  dispose(): void {
    for (const e of this.entries.values()) this.release(e);
    this.entries.clear();
  }
}
