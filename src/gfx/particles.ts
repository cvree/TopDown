import * as THREE from 'three';
import type { FxSystem, Particle } from '../engine/fx';
import { glowSprite, smokeSprite } from './textures';

/**
 * Instanced billboard particles driven straight off the simulation's effect
 * system. The effects themselves are unchanged and still purely 2D as far as
 * gameplay is concerned; this layer lifts them into the arena by giving each
 * one a ballistic arc derived from its age, so sparks fly up off an impact and
 * dust stays down where boots are.
 *
 * Two draw calls for the whole game: one additive for light, one soft for dust.
 */

const CAPACITY = 1500;

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iColor;
  attribute float iScale;
  attribute float iAlpha;
  attribute float iRot;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    vColor = iColor;
    vAlpha = iAlpha;
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4( iPos, 1.0 );
    vec2 corner = position.xy * iScale;
    float c = cos( iRot );
    float s = sin( iRot );
    mv.xy += vec2( corner.x * c - corner.y * s, corner.x * s + corner.y * c );
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D( uMap, vUv );
    float a = t.a * vAlpha;
    if ( a <= 0.004 ) discard;
    gl_FragColor = vec4( vColor * t.rgb, a );
  }
`;

interface Bank {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  pos: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
  scale: THREE.InstancedBufferAttribute;
  alpha: THREE.InstancedBufferAttribute;
  rot: THREE.InstancedBufferAttribute;
  count: number;
}

const makeBank = (parent: THREE.Object3D, map: THREE.Texture, additive: boolean, order: number): Bank => {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  const color = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  const scale = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  const rot = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  for (const a of [pos, color, scale, alpha, rot]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', pos);
  geo.setAttribute('iColor', color);
  geo.setAttribute('iScale', scale);
  geo.setAttribute('iAlpha', alpha);
  geo.setAttribute('iRot', rot);
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  parent.add(mesh);
  return { mesh, geo, pos, color, scale, alpha, rot, count: 0 };
};

/** Height of a particle above the floor, from its kind and its age. */
const arcHeight = (p: Particle): number => {
  const t = p.max - p.life;
  switch (p.kind) {
    case 'ember':
      return Math.max(2, 24 + 210 * t - 240 * t * t);
    case 'dust':
      return Math.max(2, 6 + 44 * t - 30 * t * t);
    case 'shard':
      return Math.max(2, 30 + 150 * t - 420 * t * t);
    default:
      return Math.max(2, 26 + 130 * t - 340 * t * t);
  }
};

const tmpColor = new THREE.Color();

export class ParticleLayer {
  private light: Bank;
  private soft: Bank;

  constructor(parent: THREE.Object3D) {
    this.light = makeBank(parent, glowSprite(), true, 12);
    this.soft = makeBank(parent, smokeSprite(), false, 11);
  }

  sync(fx: FxSystem): void {
    let li = 0;
    let si = 0;
    for (const p of fx.particles) {
      const dust = p.kind === 'dust';
      const bank = dust ? this.soft : this.light;
      const i = dust ? si : li;
      if (i >= CAPACITY) continue;
      if (dust) si++;
      else li++;

      const fade = Math.max(0, p.life / p.max);
      bank.pos.setXYZ(i, p.x, arcHeight(p), p.y);
      tmpColor.set(p.color);
      bank.color.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
      // Sparks stretch as they age; dust swells.
      const grow = dust ? 1 + (1 - fade) * 2.4 : 0.5 + fade * 0.9;
      bank.scale.setX(i, p.size * (dust ? 9 : 6.5) * grow);
      bank.alpha.setX(i, dust ? fade * fade * 0.5 : fade * (0.55 + fade * 0.6));
      bank.rot.setX(i, p.angle);
    }
    this.commit(this.light, li);
    this.commit(this.soft, si);
  }

  private commit(bank: Bank, count: number): void {
    bank.geo.instanceCount = count;
    if (count === 0) return;
    for (const a of [bank.pos, bank.color, bank.scale, bank.alpha, bank.rot]) a.needsUpdate = true;
  }

  dispose(): void {
    for (const b of [this.light, this.soft]) {
      b.geo.dispose();
      (b.mesh.material as THREE.Material).dispose();
      b.mesh.removeFromParent();
    }
  }
}
