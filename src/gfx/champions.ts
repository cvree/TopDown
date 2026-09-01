import * as THREE from 'three';
import { contactShadow } from './textures';

/**
 * Champions are built out of primitives and animated by hand.
 *
 * No skinning, no imported meshes: a hierarchy of Groups acting as joints, and
 * a procedural animator that poses them. That buys three things a canned clip
 * cannot — the run cycle stays locked to actual movement speed at any tempo,
 * the attack windup is frame-exact against the simulation's windup timer (the
 * single most important read in the whole trainer), and the whole thing still
 * bundles into one HTML file.
 *
 * Proportions are stylised on purpose: big shoulders, big weapons, slightly
 * oversized heads. Seen from a 57° camera at this distance, silhouette is the
 * only thing you can actually read.
 */

export type WeaponKind = 'sword' | 'greatsword' | 'bow' | 'staff' | 'daggers' | 'hammer' | 'none';
export type HeadKind = 'hood' | 'helm' | 'horns' | 'crown' | 'none';
export type Build = 'lean' | 'medium' | 'heavy' | 'small';

export interface RigSpec {
  height: number;
  radius: number;
  build: Build;
  primary: string;
  secondary: string;
  accent: string;
  skin: string;
  weapon: WeaponKind;
  headgear: HeadKind;
  cape: boolean;
  /** Ground ring colour. Ally blue, enemy red, exactly like the real thing. */
  ringColor: string;
}

export interface RigState {
  /** 0..1 of the unit's own top speed. */
  speed: number;
  facing: number;
  /** 'windup' | 'backswing' | 'idle', straight off the simulation. */
  phase: 'idle' | 'windup' | 'backswing';
  /** 0..1 progress through the current phase. */
  phaseT: number;
  /** Seconds since the rig was created; used for idle motion. */
  time: number;
  /** 0..1, decays after taking damage. */
  hitFlash: number;
  /** 0 alive, 1 fully dead. */
  death: number;
  /** 0..1 while a spell is being cast. */
  cast: number;
  hp01: number;
  /** True when this unit is under the cursor. */
  hovered: boolean;
  rooted: boolean;
}

const box = (w: number, h: number, d: number, seg = 1): THREE.BoxGeometry => new THREE.BoxGeometry(w, h, d, seg, seg, seg);

/** A tapered box — the workhorse shape for limbs and torsos. */
const taper = (wTop: number, wBottom: number, h: number, dTop: number, dBottom: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(1, h, 1, 1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h + 0.5; // 0 bottom, 1 top
    p.setX(i, p.getX(i) * (wBottom + (wTop - wBottom) * t));
    p.setZ(i, p.getZ(i) * (dBottom + (dTop - dBottom) * t));
  }
  g.computeVertexNormals();
  return g;
};

interface Joint {
  group: THREE.Group;
  rest: THREE.Euler;
}

const joint = (parent: THREE.Object3D, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Joint => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  parent.add(g);
  return { group: g, rest: new THREE.Euler(rx, ry, rz) };
};

const BUILD: Record<Build, { shoulder: number; waist: number; limb: number; headScale: number }> = {
  small: { shoulder: 0.78, waist: 0.72, limb: 0.8, headScale: 1.12 },
  lean: { shoulder: 0.9, waist: 0.8, limb: 0.95, headScale: 1.0 },
  medium: { shoulder: 1, waist: 0.9, limb: 1, headScale: 1 },
  heavy: { shoulder: 1.3, waist: 1.14, limb: 1.14, headScale: 0.94 },
};

export class ChampionRig {
  /** Position-only outer node. Ground decals hang off this un-rotated. */
  readonly group = new THREE.Group();
  /** Rotates to face the movement/attack direction. */
  private body = new THREE.Group();
  private bob = new THREE.Group();

  private hips!: Joint;
  private chest!: Joint;
  private neck!: Joint;
  private shoulderL!: Joint;
  private shoulderR!: Joint;
  private elbowL!: Joint;
  private elbowR!: Joint;
  private hipL!: Joint;
  private hipR!: Joint;
  private kneeL!: Joint;
  private kneeR!: Joint;
  private weaponNode: THREE.Group | null = null;
  private offhandNode: THREE.Group | null = null;
  private capeNode: THREE.Group | null = null;

  private ring: THREE.Mesh;
  private shadow: THREE.Mesh;
  private materials: THREE.MeshStandardMaterial[] = [];
  private accentMats: THREE.MeshStandardMaterial[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private baseEmissive: THREE.Color[] = [];

  private stride = 0;
  private readonly spec: RigSpec;
  private readonly h: number;

  constructor(spec: RigSpec) {
    this.spec = spec;
    this.h = spec.height;
    this.group.add(this.body);
    this.body.add(this.bob);

    const b = BUILD[spec.build];
    const H = this.h;

    const matPrimary = this.mat(spec.primary, 0.62, 0.22);
    const matSecondary = this.mat(spec.secondary, 0.82, 0.05);
    const matSkin = this.mat(spec.skin, 0.9, 0);
    const matAccent = this.mat(spec.accent, 0.35, 0.1, spec.accent, 0.85);
    const matDark = this.mat('#22262e', 0.86, 0.08);
    const matMetal = this.mat('#b9c2d0', 0.32, 0.85);

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      this.geometries.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // ------------------------------------------------------------- skeleton
    // Proportions are laid out so the soles land on y = 0 and the crown of the
    // head lands near y = H. Heroic-stylised: broad shoulders, oversized head,
    // oversized weapon — from a locked overhead camera the silhouette is the
    // only thing that survives, so it gets the budget.
    const HIP_Y = H * 0.44;
    const THIGH = H * 0.21;
    const SHIN = H * 0.2;
    const waistW = H * 0.17 * b.waist;
    const shW = H * 0.25 * b.shoulder;

    this.hips = joint(this.bob, 0, HIP_Y, 0);
    add(this.hips.group, taper(waistW * 1.06, waistW * 0.92, H * 0.09, waistW * 0.66, waistW * 0.58), matDark, 0, H * 0.028);

    this.chest = joint(this.hips.group, 0, H * 0.07, 0);
    add(this.chest.group, taper(shW * 0.98, waistW * 1.02, H * 0.23, shW * 0.5, waistW * 0.62), matPrimary, 0, H * 0.115);
    // A plate across the chest: it catches the key light and gives the torso
    // an unambiguous front, which is what tells you where a unit is facing.
    add(this.chest.group, box(shW * 0.66, H * 0.13, H * 0.022), matAccent, 0, H * 0.15, shW * 0.27);
    add(this.chest.group, box(shW * 0.9, H * 0.03, shW * 0.5), matSecondary, 0, H * 0.235, 0);

    this.neck = joint(this.chest.group, 0, H * 0.245, 0);
    const headR = H * 0.095 * b.headScale;
    const head = add(this.neck.group, new THREE.SphereGeometry(headR, 10, 8), matSkin, 0, headR * 0.88, 0);
    head.scale.set(1, 1.06, 0.94);
    this.buildHeadgear(this.neck.group, headR, matPrimary, matAccent, matMetal, matSecondary, add);

    // Pauldrons sit proud of the torso: from above they are the silhouette.
    for (const side of [-1, 1] as const) {
      const sx = side * shW * 0.52;
      const sj = joint(this.chest.group, sx, H * 0.215, 0);
      const pad = add(sj.group, taper(H * 0.062, H * 0.105, H * 0.088, H * 0.062, H * 0.1), matPrimary, 0, H * 0.014, 0);
      pad.rotation.z = side * -0.3;
      add(sj.group, taper(H * 0.042, H * 0.056, H * 0.16 * b.limb, H * 0.042, H * 0.056), matSecondary, 0, -H * 0.09 * b.limb, 0);
      const ej = joint(sj.group, 0, -H * 0.172 * b.limb, 0);
      add(ej.group, taper(H * 0.034, H * 0.044, H * 0.145 * b.limb, H * 0.034, H * 0.044), matSkin, 0, -H * 0.078 * b.limb, 0);
      const hand = new THREE.Group();
      hand.position.set(0, -H * 0.156 * b.limb, 0);
      ej.group.add(hand);
      add(hand, box(H * 0.05, H * 0.05, H * 0.05), matDark);
      if (side === 1) {
        this.shoulderR = sj;
        this.elbowR = ej;
        this.weaponNode = hand;
      } else {
        this.shoulderL = sj;
        this.elbowL = ej;
        this.offhandNode = hand;
      }
    }

    // Legs, sized so the soles meet the floor.
    for (const side of [-1, 1] as const) {
      const hx = side * waistW * 0.44;
      const hj = joint(this.hips.group, hx, -H * 0.01, 0);
      add(hj.group, taper(H * 0.056, H * 0.07, THIGH, H * 0.056, H * 0.07), matSecondary, 0, -THIGH / 2, 0);
      const kj = joint(hj.group, 0, -THIGH, 0);
      add(kj.group, taper(H * 0.044, H * 0.056, SHIN, H * 0.044, H * 0.056), matDark, 0, -SHIN / 2, 0);
      add(kj.group, box(H * 0.062, H * 0.04, H * 0.11), matDark, 0, -SHIN - H * 0.005, H * 0.026);
      if (side === 1) {
        this.hipR = hj;
        this.kneeR = kj;
      } else {
        this.hipL = hj;
        this.kneeL = kj;
      }
    }

    if (spec.cape) {
      this.capeNode = new THREE.Group();
      this.capeNode.position.set(0, H * 0.23, -shW * 0.24);
      this.chest.group.add(this.capeNode);
      const cape = add(this.capeNode, taper(shW * 0.96, shW * 0.52, H * 0.38, H * 0.014, H * 0.014), matSecondary, 0, -H * 0.19, 0);
      cape.castShadow = true;
    }

    this.buildWeapon(matMetal, matAccent, matDark, matSecondary, add);

    // ------------------------------------------------------- ground fittings
    // The team ring. This one element does more for MOBA legibility than any
    // amount of model detail: it is how you read who is where, instantly.
    const ringGeo = new THREE.RingGeometry(spec.radius * 0.8, spec.radius * 1.12, 44);
    this.geometries.push(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(spec.ringColor),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 1.4;
    this.ring.renderOrder = 4;
    this.group.add(this.ring);

    const shGeo = new THREE.PlaneGeometry(spec.radius * 2.9, spec.radius * 2.9);
    this.geometries.push(shGeo);
    this.shadow = new THREE.Mesh(
      shGeo,
      new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, opacity: 0.5, depthWrite: false, color: 0x000000 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 1.0;
    this.shadow.renderOrder = 3;
    this.group.add(this.shadow);
  }

  private mat(color: string, roughness: number, metalness: number, emissive = '#000000', emissiveIntensity = 0): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness,
      metalness,
      emissive: new THREE.Color(emissive),
      emissiveIntensity,
      flatShading: true,
    });
    // A fresnel rim in the unit's own accent colour. Champions have to peel
    // off the ground plane from a locked overhead camera, and a rim light does
    // that at any distance where model detail has already stopped mattering.
    const rim = new THREE.Color(this.spec.accent);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: rim };
      shader.uniforms.uRimStrength = { value: 1.05 };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float rimF = pow( 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 ), 2.6 );
          totalEmissiveRadiance += uRimColor * rimF * uRimStrength;`,
        );
    };
    m.customProgramCacheKey = () => 'rift-champ-rim';
    this.materials.push(m);
    this.baseEmissive.push(m.emissive.clone());
    if (emissiveIntensity > 0) this.accentMats.push(m);
    return m;
  }

  private buildHeadgear(
    parent: THREE.Object3D,
    headR: number,
    primary: THREE.Material,
    accent: THREE.Material,
    metal: THREE.Material,
    secondary: THREE.Material,
    add: (p: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x?: number, y?: number, z?: number) => THREE.Mesh,
  ): void {
    switch (this.spec.headgear) {
      case 'hood': {
        const hood = add(parent, new THREE.ConeGeometry(headR * 1.5, headR * 2.5, 7, 1, true), secondary, 0, headR * 1.1, -headR * 0.12);
        hood.rotation.x = -0.16;
        // Two points of light where a face would be. Reads at any distance.
        add(parent, new THREE.SphereGeometry(headR * 0.14, 6, 5), accent, -headR * 0.34, headR * 0.95, headR * 0.78);
        add(parent, new THREE.SphereGeometry(headR * 0.14, 6, 5), accent, headR * 0.34, headR * 0.95, headR * 0.78);
        break;
      }
      case 'helm': {
        const helm = add(parent, new THREE.SphereGeometry(headR * 1.22, 8, 6), metal, 0, headR * 0.98, 0);
        helm.scale.set(1, 0.98, 1.06);
        add(parent, box(headR * 0.22, headR * 1.5, headR * 2.3), metal, 0, headR * 1.5, 0);
        add(parent, box(headR * 1.9, headR * 0.28, headR * 0.2), accent, 0, headR * 0.82, headR * 1.0);
        break;
      }
      case 'horns': {
        add(parent, new THREE.SphereGeometry(headR * 1.1, 8, 6), primary, 0, headR * 0.95, 0);
        for (const s of [-1, 1]) {
          const horn = add(parent, new THREE.ConeGeometry(headR * 0.28, headR * 1.7, 6), metal, s * headR * 0.86, headR * 1.5, -headR * 0.1);
          horn.rotation.z = s * 0.55;
          horn.rotation.x = -0.28;
        }
        add(parent, box(headR * 1.5, headR * 0.24, headR * 0.18), accent, 0, headR * 0.86, headR * 0.92);
        break;
      }
      case 'crown': {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const spike = add(parent, new THREE.ConeGeometry(headR * 0.14, headR * 0.72, 4), metal, Math.cos(a) * headR * 0.92, headR * 1.68, Math.sin(a) * headR * 0.92);
          spike.rotation.z = -Math.cos(a) * 0.3;
          spike.rotation.x = Math.sin(a) * 0.3;
        }
        add(parent, new THREE.TorusGeometry(headR * 0.95, headR * 0.11, 6, 14), metal, 0, headR * 1.42, 0).rotation.x = Math.PI / 2;
        add(parent, new THREE.OctahedronGeometry(headR * 0.34), accent, 0, headR * 1.72, headR * 0.6);
        break;
      }
      default:
        break;
    }
  }

  private buildWeapon(
    metal: THREE.Material,
    accent: THREE.Material,
    dark: THREE.Material,
    secondary: THREE.Material,
    add: (p: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x?: number, y?: number, z?: number) => THREE.Mesh,
  ): void {
    const H = this.h;
    const hand = this.weaponNode;
    const off = this.offhandNode;
    if (!hand) return;

    switch (this.spec.weapon) {
      case 'sword': {
        const grip = new THREE.Group();
        grip.rotation.x = -0.35;
        hand.add(grip);
        add(grip, box(H * 0.022, H * 0.1, H * 0.022), dark, 0, -H * 0.02, 0);
        add(grip, box(H * 0.12, H * 0.022, H * 0.03), metal, 0, H * 0.04, 0);
        const blade = add(grip, taper(H * 0.012, H * 0.045, H * 0.4, H * 0.008, H * 0.018), metal, 0, H * 0.24, 0);
        blade.castShadow = true;
        add(grip, box(H * 0.012, H * 0.34, H * 0.006), accent, 0, H * 0.22, H * 0.012);
        break;
      }
      case 'greatsword': {
        const grip = new THREE.Group();
        grip.rotation.x = -0.5;
        hand.add(grip);
        add(grip, box(H * 0.03, H * 0.16, H * 0.03), dark, 0, -H * 0.03, 0);
        add(grip, box(H * 0.2, H * 0.03, H * 0.04), metal, 0, H * 0.06, 0);
        add(grip, taper(H * 0.03, H * 0.08, H * 0.56, H * 0.012, H * 0.03), metal, 0, H * 0.35, 0);
        add(grip, box(H * 0.02, H * 0.5, H * 0.01), accent, 0, H * 0.33, H * 0.02);
        break;
      }
      case 'hammer': {
        const grip = new THREE.Group();
        grip.rotation.x = -0.45;
        hand.add(grip);
        add(grip, box(H * 0.03, H * 0.42, H * 0.03), dark, 0, H * 0.14, 0);
        const headMesh = add(grip, box(H * 0.19, H * 0.17, H * 0.19), metal, 0, H * 0.4, 0);
        headMesh.castShadow = true;
        add(grip, box(H * 0.21, H * 0.05, H * 0.05), accent, 0, H * 0.4, 0);
        break;
      }
      case 'bow': {
        // Held in the off hand, drawn with the main hand — reads as an archer
        // from directly above, which a bow held sideways does not.
        const target = off ?? hand;
        const bow = new THREE.Group();
        bow.rotation.z = Math.PI / 2;
        bow.rotation.y = 0.2;
        target.add(bow);
        const limb = new THREE.TorusGeometry(H * 0.19, H * 0.014, 5, 14, Math.PI * 1.15);
        this.geometries.push(limb);
        const arc = new THREE.Mesh(limb, metal);
        arc.rotation.z = Math.PI * 0.42;
        arc.castShadow = true;
        bow.add(arc);
        add(bow, box(H * 0.004, H * 0.36, H * 0.004), accent, H * 0.06, 0, 0);
        break;
      }
      case 'staff': {
        const grip = new THREE.Group();
        grip.rotation.x = -0.12;
        hand.add(grip);
        add(grip, box(H * 0.024, H * 0.66, H * 0.024), dark, 0, H * 0.24, 0);
        const orb = add(grip, new THREE.IcosahedronGeometry(H * 0.058, 1), accent, 0, H * 0.6, 0);
        orb.castShadow = false;
        const ring = add(grip, new THREE.TorusGeometry(H * 0.082, H * 0.008, 5, 16), metal, 0, H * 0.6, 0);
        ring.rotation.x = Math.PI / 2.4;
        break;
      }
      case 'daggers': {
        for (const [node, dir] of [[hand, 1], [off, -1]] as const) {
          if (!node) continue;
          const grip = new THREE.Group();
          grip.rotation.x = -0.7;
          grip.rotation.z = dir * 0.1;
          node.add(grip);
          add(grip, box(H * 0.018, H * 0.07, H * 0.018), dark, 0, -H * 0.015, 0);
          add(grip, taper(H * 0.008, H * 0.03, H * 0.2, H * 0.006, H * 0.012), metal, 0, H * 0.13, 0);
          add(grip, box(H * 0.008, H * 0.17, H * 0.004), accent, 0, H * 0.12, H * 0.008);
        }
        break;
      }
      default:
        break;
    }

    // A shield for the heavy builds, so the off hand is not empty.
    if (off && (this.spec.weapon === 'sword' || this.spec.weapon === 'hammer')) {
      const shieldGeo = taper(H * 0.13, H * 0.17, H * 0.22, H * 0.02, H * 0.024);
      const shield = add(off, shieldGeo, secondary, 0, -H * 0.02, H * 0.04);
      shield.rotation.x = 0.25;
      add(off, new THREE.OctahedronGeometry(H * 0.032), accent, 0, -H * 0.02, H * 0.06);
    }
  }

  /** Position in world units. Height is always ground level; the arena is flat. */
  setPosition(x: number, y: number): void {
    this.group.position.set(x, 0, y);
  }

  get visible(): boolean {
    return this.group.visible;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  update(dt: number, s: RigState): void {
    const H = this.h;
    // Model faces +z; world facing 0 is +x. See the note in units.ts.
    this.body.rotation.y = Math.PI / 2 - s.facing;

    // ------------------------------------------------------------ locomotion
    const speed = Math.min(1.6, s.speed);
    this.stride += dt * (3.2 + speed * 8.6) * (speed > 0.02 ? 1 : 0.25);
    const walking = speed > 0.03;
    const swing = walking ? Math.sin(this.stride) : 0;
    const swing2 = walking ? Math.sin(this.stride * 2) : 0;
    const amp = walking ? 0.42 + speed * 0.34 : 0;

    this.hipL.group.rotation.x = swing * amp;
    this.hipR.group.rotation.x = -swing * amp;
    // Knees only bend on the back-swing, which is what makes a leg look jointed.
    this.kneeL.group.rotation.x = -Math.max(0, -swing) * amp * 1.15;
    this.kneeR.group.rotation.x = -Math.max(0, swing) * amp * 1.15;

    // Vertical bob, and a forward lean that grows with speed.
    const idleBreath = Math.sin(s.time * 1.9) * H * 0.006;
    this.bob.position.y = walking ? Math.abs(swing2) * H * 0.022 * speed : idleBreath;
    this.hips.group.rotation.y = swing * 0.12 * amp;
    this.chest.group.rotation.x = -0.05 - speed * 0.13;
    this.chest.group.rotation.y = -swing * 0.16 * amp;
    this.neck.group.rotation.y = swing * 0.1 * amp;

    // Arms counter-swing; the weapon arm is overridden below when attacking.
    const armBase = -swing * amp * 0.62;
    this.shoulderL.group.rotation.x = armBase;
    this.shoulderR.group.rotation.x = -armBase;
    this.shoulderL.group.rotation.z = 0.14 + (walking ? 0 : Math.sin(s.time * 1.6) * 0.03);
    this.shoulderR.group.rotation.z = -0.14 - (walking ? 0 : Math.sin(s.time * 1.6 + 1) * 0.03);
    this.elbowL.group.rotation.x = -0.25 - Math.max(0, armBase) * 0.7;
    this.elbowR.group.rotation.x = -0.25 - Math.max(0, -armBase) * 0.7;

    // ---------------------------------------------------------------- attack
    if (s.phase === 'windup') {
      // The single most important read in the game: how far through the windup
      // you are. It is a big, monotonic, unmistakable pull-back.
      const t = s.phaseT;
      const e = t * t;
      this.applyAttackPose(-1.35 * e, 0.5 * e, 0.42 * e);
    } else if (s.phase === 'backswing') {
      // Snap through, then settle. Overshoot on the way out sells the release.
      const t = s.phaseT;
      const k = Math.exp(-t * 5.5) * Math.cos(t * 9);
      this.applyAttackPose(1.15 * k, -0.5 * k, -0.4 * k);
    }

    if (s.cast > 0.001) {
      const c = s.cast;
      this.shoulderL.group.rotation.x -= 1.5 * c;
      this.shoulderR.group.rotation.x -= 1.5 * c;
      this.elbowL.group.rotation.x -= 0.7 * c;
      this.elbowR.group.rotation.x -= 0.7 * c;
      this.chest.group.rotation.x -= 0.22 * c;
    }

    if (this.capeNode) {
      this.capeNode.rotation.x = 0.1 + speed * 0.55 + Math.sin(s.time * 3.1) * 0.05;
      this.capeNode.rotation.z = Math.sin(s.time * 2.3) * 0.06 - swing * 0.1;
    }

    // ------------------------------------------------------------ conditions
    if (s.rooted) {
      // Rooted units stop moving their legs but keep struggling, so a root
      // never looks like a frozen frame.
      this.hipL.group.rotation.x *= 0.15;
      this.hipR.group.rotation.x *= 0.15;
      this.bob.position.y = Math.sin(s.time * 22) * H * 0.004;
    }

    // Damage flash rides the emissive channel, so it survives any light setup.
    const flash = Math.min(1, s.hitFlash);
    if (flash > 0.001 || this.flashed) {
      for (let i = 0; i < this.materials.length; i++) {
        const m = this.materials[i];
        m.emissive.copy(this.baseEmissive[i]).lerp(new THREE.Color(1, 0.42, 0.42), flash);
        m.emissiveIntensity = Math.max(this.accentMats.includes(m) ? 0.85 : 0, flash * 1.5);
      }
      this.flashed = flash > 0.001;
    }

    // ------------------------------------------------------------------ death
    if (s.death > 0) {
      const d = Math.min(1, s.death);
      this.body.rotation.z = d * 1.42;
      this.body.position.y = -d * H * 0.14;
      const fade = 1 - d;
      for (const m of this.materials) {
        m.transparent = true;
        m.opacity = fade;
      }
      (this.ring.material as THREE.Material).opacity = 0.9 * fade * fade;
      (this.shadow.material as THREE.Material).opacity = 0.5 * fade;
      this.group.scale.setScalar(1 - d * 0.16);
    }

    // Selection ring: brighter under the cursor, and it pulses as HP drops.
    const rm = this.ring.material as THREE.MeshBasicMaterial;
    const lowHp = s.hp01 < 0.3 ? 0.5 + 0.5 * Math.sin(s.time * 9) : 0;
    rm.opacity = (s.hovered ? 1 : 0.78) * (1 - s.death) + lowHp * 0.25;
    this.ring.scale.setScalar(s.hovered ? 1.08 : 1);
  }

  private flashed = false;

  private applyAttackPose(shoulderX: number, elbowX: number, twist: number): void {
    this.shoulderR.group.rotation.x += shoulderX;
    this.elbowR.group.rotation.x += elbowX;
    this.chest.group.rotation.y += twist;
    if (this.spec.weapon === 'bow' || this.spec.weapon === 'staff') {
      this.shoulderL.group.rotation.x += shoulderX * 0.45;
      this.elbowL.group.rotation.x += elbowX * 0.5;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    (this.ring.material as THREE.Material).dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
