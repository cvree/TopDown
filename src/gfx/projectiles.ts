import * as THREE from 'three';
import type { Projectile } from '../engine/types';
import type { World } from '../engine/world';
import { glowSprite } from './textures';

/**
 * Projectiles as real objects in the arena: a lit core, an additive corona and
 * a tapering ribbon trail that follows the path the simulation actually flew.
 *
 * The trail matters more than the mesh. A skillshot you have to dodge is read
 * off its direction of travel, and a ribbon states that direction unambiguously
 * from a top-down camera in a way a glowing dot never can.
 */

const TRAIL_SEGMENTS = 8;
const HEIGHT = 46; // projectiles fly at chest height

interface Visual {
  root: THREE.Group;
  core: THREE.Mesh;
  corona: THREE.Sprite;
  trail: THREE.Mesh;
  trailPos: THREE.BufferAttribute;
  trailAlpha: THREE.BufferAttribute;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
  shape: string;
  color: string;
}

const shapeGeometry = (shape: Projectile['shape'], r: number): THREE.BufferGeometry => {
  switch (shape) {
    case 'orb':
      return new THREE.IcosahedronGeometry(r * 1.25, 1);
    case 'shard': {
      const g = new THREE.OctahedronGeometry(r * 1.3, 0);
      g.scale(0.55, 0.55, 2.2);
      return g;
    }
    case 'wave': {
      const g = new THREE.TorusGeometry(r * 2.1, r * 0.34, 6, 18, Math.PI);
      g.rotateY(Math.PI / 2);
      return g;
    }
    default: {
      const g = new THREE.ConeGeometry(r * 0.85, r * 4.2, 6);
      g.rotateX(Math.PI / 2);
      return g;
    }
  }
};

const TRAIL_VERT = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;
const TRAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    if ( vAlpha <= 0.004 ) discard;
    gl_FragColor = vec4( uColor, vAlpha );
  }
`;

export class ProjectileLayer {
  private visuals = new Map<number, Visual>();
  private spriteMap = glowSprite();

  constructor(private readonly parent: THREE.Object3D) {}

  sync(world: World, alpha: number): void {
    const seen = new Set<number>();
    for (const p of world.projectiles) {
      seen.add(p.id);
      const color = p.color ?? (p.team === 'player' ? '#8fe9ff' : '#ff8a6a');
      let v = this.visuals.get(p.id);
      if (!v || v.shape !== p.shape || v.color !== color) {
        v?.root.removeFromParent();
        v = this.build(p, color);
        this.visuals.set(p.id, v);
      }

      const x = p.prev.x + (p.pos.x - p.prev.x) * alpha;
      const y = p.prev.y + (p.pos.y - p.prev.y) * alpha;
      v.root.position.set(x, HEIGHT, y);
      const ang = Math.atan2(p.vel.y, p.vel.x);
      v.root.rotation.y = Math.PI / 2 - ang;
      // Spin the heavier shapes so they read as objects rather than decals.
      if (p.shape === 'orb' || p.shape === 'shard') v.core.rotation.z += 0.22;

      const fade = 1 - Math.max(0, Math.min(1, (p.life / p.maxLife) ** 4));
      v.corona.material.opacity = 0.85 * fade;
      this.writeTrail(v, p, x, y, fade);
    }

    for (const [id, v] of this.visuals) {
      if (seen.has(id)) continue;
      for (const g of v.geos) g.dispose();
      for (const m of v.mats) m.dispose();
      v.root.removeFromParent();
      this.visuals.delete(id);
    }
  }

  private build(p: Projectile, color: string): Visual {
    const root = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const c = new THREE.Color(color);

    const coreGeo = shapeGeometry(p.shape, p.radius);
    const coreMat = new THREE.MeshStandardMaterial({
      color: c.clone().lerp(new THREE.Color('#ffffff'), 0.55),
      emissive: c,
      emissiveIntensity: 2.2,
      roughness: 0.3,
      metalness: 0.1,
      flatShading: true,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.castShadow = false;
    root.add(core);
    geos.push(coreGeo);
    mats.push(coreMat);

    const coronaMat = new THREE.SpriteMaterial({
      map: this.spriteMap,
      color: c,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.85,
    });
    const corona = new THREE.Sprite(coronaMat);
    corona.scale.setScalar(p.radius * 9);
    root.add(corona);
    mats.push(coronaMat);

    // Ribbon: a triangle strip that we rewrite every frame from p.trail.
    const trailGeo = new THREE.BufferGeometry();
    const verts = new Float32Array(TRAIL_SEGMENTS * 2 * 3);
    const alphas = new Float32Array(TRAIL_SEGMENTS * 2);
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_SEGMENTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const trailPos = new THREE.BufferAttribute(verts, 3).setUsage(THREE.DynamicDrawUsage);
    const trailAlpha = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
    trailGeo.setAttribute('position', trailPos);
    trailGeo.setAttribute('aAlpha', trailAlpha);
    trailGeo.setIndex(idx);
    trailGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const trailMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: c.clone() } },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.frustumCulled = false;
    trail.renderOrder = 9;
    geos.push(trailGeo);
    mats.push(trailMat);

    this.parent.add(root);
    this.parent.add(trail);

    return { root, core, corona, trail, trailPos, trailAlpha, mats, geos, shape: p.shape, color };
  }

  private writeTrail(v: Visual, p: Projectile, x: number, y: number, fade: number): void {
    const pts = p.trail;
    const n = TRAIL_SEGMENTS;
    const width = p.radius * 1.15;
    for (let i = 0; i < n; i++) {
      // i = 0 is the head (at the projectile), i = n-1 the oldest sample.
      const src = pts.length > 0 ? pts[Math.max(0, pts.length - 1 - Math.round((i / (n - 1)) * (pts.length - 1)))] : null;
      const px = i === 0 || !src ? x : src.x;
      const py = i === 0 || !src ? y : src.y;
      // Perpendicular to the direction of travel, taken from the previous sample.
      const refX = i === 0 ? x : px;
      const refY = i === 0 ? y : py;
      const prev = pts.length > 1 ? pts[Math.max(0, pts.length - 2)] : null;
      const dx = i === 0 ? (prev ? x - prev.x : p.vel.x) : refX - x;
      const dy = i === 0 ? (prev ? y - prev.y : p.vel.y) : refY - y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * width * (1 - i / n);
      const ny = (dx / len) * width * (1 - i / n);
      const a = i * 2;
      v.trailPos.setXYZ(a, px + nx, HEIGHT, py + ny);
      v.trailPos.setXYZ(a + 1, px - nx, HEIGHT, py - ny);
      const taper = (1 - i / (n - 1)) ** 1.6 * fade * 0.75;
      v.trailAlpha.setX(a, taper);
      v.trailAlpha.setX(a + 1, taper);
    }
    v.trailPos.needsUpdate = true;
    v.trailAlpha.needsUpdate = true;
  }

  dispose(): void {
    for (const v of this.visuals.values()) {
      for (const g of v.geos) g.dispose();
      for (const m of v.mats) m.dispose();
      v.root.removeFromParent();
      v.trail.removeFromParent();
    }
    this.visuals.clear();
  }
}
