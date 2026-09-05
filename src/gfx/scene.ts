import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RiftCamera } from './camera';
import { FogOfWar } from './fogofwar';
import { GradeShader } from './postfx';
import { buildArena, type Arena, type ArenaStyle } from './terrain';

/**
 * Owns the WebGL context, the lighting rig and the post chain. Everything that
 * draws a unit, a projectile or an indicator adds itself to `world` and is
 * positioned in raw world units — the group is offset so nothing downstream
 * has to think about where the arena centre is.
 */

export type Quality = 'high' | 'medium' | 'low';

export interface GradeState {
  hurt: number;
  flash: number;
  flashColor: string;
  energy: number;
  dim: number;
}

const SUN_DIR = new THREE.Vector3(-0.46, 0.82, -0.34).normalize();

export class RiftScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new RiftCamera();
  /**
   * The fog of war, owned here because it is a property of the arena rather
   * than of any one layer: the floor, the terrain and the bushes all sample
   * the same field, and a drill without vision leaves it switched off.
   */
  readonly fow = new FogOfWar();
  /** Add gameplay objects here; child coordinates are world units. */
  readonly world = new THREE.Group();

  readonly bounds: { w: number; h: number };

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private sun: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sky: THREE.Mesh;
  private arena: Arena;
  private quality: Quality = 'high';
  // Zero until the first resize, so that first call always takes effect even
  // if the canvas happens to open at exactly the default size.
  private cssW = 0;
  private cssH = 0;
  private dpr = 0;
  private time = 0;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    bounds: { w: number; h: number },
    accent = '#58e0ff',
    seed = 7,
    style: ArenaStyle = 'rift',
  ) {
    this.bounds = bounds;
    const lab = style === 'lab';

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x070b12, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // The bench sits in the dark. The stadium sits in dusk.
    this.scene.fog = lab ? new THREE.Fog(0x070a11, 2200, 6200) : new THREE.Fog(0x1b2c4a, 3100, 8200);

    // ------------------------------------------------------------- lighting
    // Warm key from the upper left, cool bounce from behind. Two lights and a
    // hemisphere is all a stylised look needs; more just muddies the read.
    // Instrument light rather than sunset: cool, overhead, and much flatter,
    // so a pad's own colour is the only thing on the floor that means anything.
    this.sun = new THREE.DirectionalLight(lab ? 0xdfeaff : 0xffd6a0, lab ? 2.1 : 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0016;
    this.sun.shadow.normalBias = 6;
    const span = Math.max(bounds.w, bounds.h) * 0.82 + 460;
    const sc = this.sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 200;
    sc.far = 5200;
    sc.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.rim = new THREE.DirectionalLight(lab ? 0x6f90c8 : 0x7fb4ff, lab ? 0.8 : 1.45);
    this.rim.position.set(bounds.w * 0.5 + 1400, 900, bounds.h * 0.5 - 1600);
    this.scene.add(this.rim);

    this.hemi = new THREE.HemisphereLight(lab ? 0x9fc0e8 : 0x8fb6e8, lab ? 0x141a24 : 0x4a4030, lab ? 0.7 : 0.95);
    this.scene.add(this.hemi);

    // ------------------------------------------------------------------ sky
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(9000, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(lab ? '#04060b' : '#0e1c33') },
          uMid: { value: new THREE.Color(lab ? '#080d16' : '#2b4a72') },
          uBottom: { value: new THREE.Color(lab ? '#0c1220' : '#6a7a76') },
          uGlow: { value: new THREE.Color(accent) },
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize( position );
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }`,
        fragmentShader: `
          uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform vec3 uGlow;
          varying vec3 vDir;
          void main() {
            float t = clamp( vDir.y * 0.5 + 0.5, 0.0, 1.0 );
            vec3 col = mix( uBottom, uMid, smoothstep( 0.30, 0.58, t ) );
            col = mix( col, uTop, smoothstep( 0.55, 0.94, t ) );
            // A cold band of light sitting on the horizon behind the cliffs.
            float horizon = exp( -pow( ( t - 0.485 ) * 16.0, 2.0 ) );
            col += uGlow * horizon * 0.16;
            gl_FragColor = vec4( col, 1.0 );
          }`,
      }),
    );
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // ---------------------------------------------------------------- arena
    this.arena = buildArena(bounds.w, bounds.h, seed, accent, style);
    for (const m of this.arena.fogMaterials) this.fow.patch(m);
    this.world.add(this.arena.group);
    this.scene.add(this.world);

    this.rig.setBounds(bounds.w, bounds.h);
    this.positionSun();
  }

  private positionSun(): void {
    const cx = this.bounds.w / 2;
    const cz = this.bounds.h / 2;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx + SUN_DIR.x * 2600, SUN_DIR.y * 2600, cz + SUN_DIR.z * 2600);
    this.sun.target.updateMatrixWorld();
  }

  setQuality(q: Quality): void {
    if (this.quality === q) return;
    this.quality = q;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    if (q === 'low') {
      this.disposeComposer();
    } else {
      this.buildComposer();
      if (this.bloom) this.bloom.strength = q === 'high' ? 0.62 : 0.4;
    }
    this.renderer.setPixelRatio(this.pixelRatio());
  }

  /** Extra resolution scale, used by the menu backdrop to render cheaply. */
  renderScale = 1;

  private pixelRatio(): number {
    const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cap = this.quality === 'high' ? 1.5 : this.quality === 'medium' ? 1.25 : 1;
    return Math.min(raw, cap) * this.renderScale;
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
  }

  private buildComposer(): void {
    this.disposeComposer();
    const w = Math.max(2, Math.round(this.cssW * this.dpr));
    const h = Math.max(2, Math.round(this.cssH * this.dpr));
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.quality === 'high' ? 4 : 2,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.dpr);
    composer.setSize(this.cssW, this.cssH);
    composer.addPass(new RenderPass(this.scene, this.rig.camera));

    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.62, 0.78);
    composer.addPass(bloom);

    const grade = new ShaderPass(GradeShader);
    // Sharpening costs four taps a pixel; a machine that has already fallen
    // back to medium has better uses for them.
    grade.uniforms.uSharpen.value = this.quality === 'high' ? 0.24 : 0.12;
    composer.addPass(grade);
    composer.addPass(new OutputPass());

    this.composer = composer;
    this.bloom = bloom;
    this.grade = grade;
  }

  resize(cssW: number, cssH: number): void {
    const w = Math.max(1, Math.round(cssW));
    const h = Math.max(1, Math.round(cssH));
    const dpr = this.pixelRatio();
    // A ResizeObserver fires for any layout change, and rebuilding the post
    // chain allocates render targets. Only do it when the size really moved.
    if (w === this.cssW && h === this.cssH && dpr === this.dpr && (this.composer !== null) === (this.quality !== 'low')) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.rig.setViewport({ width: this.cssW, height: this.cssH });
    if (this.quality === 'low') {
      this.disposeComposer();
    } else {
      this.buildComposer();
    }
  }

  render(dtWall: number, grade: GradeState): void {
    if (this.disposed) return;
    this.time += dtWall;
    this.arena.update(this.time);
    this.fow.update();

    if (this.grade) {
      const u = this.grade.uniforms;
      (u.uTexel.value as THREE.Vector2).set(1 / Math.max(1, this.cssW), 1 / Math.max(1, this.cssH));
      u.uHurt.value = Math.min(1, grade.hurt);
      u.uFlash.value = Math.min(1, grade.flash);
      (u.uFlashColor.value as THREE.Color).set(grade.flashColor);
      u.uEnergy.value = grade.energy;
      u.uDim.value = grade.dim;
      u.uTime.value = this.time;
    }
    if (this.bloom) {
      // The arena breathes with the combo chain — subtle, and it is the only
      // thing in the frame that reacts to a streak.
      this.bloom.strength = (this.quality === 'high' ? 0.58 : 0.4) + grade.energy * 0.3;
    }

    if (this.composer) this.composer.render(dtWall);
    else this.renderer.render(this.scene, this.rig.camera);
  }

  /** Fallback path when post-processing is unavailable: grade in the DOM. */
  get usesComposer(): boolean {
    return this.composer !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeComposer();
    this.fow.dispose();
    this.arena.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.scene.clear();
    // Handing the WebGL context back rather than waiting for the collector to
    // notice. A browser keeps only a handful alive at once and kills the
    // oldest when it runs out — and the oldest is whatever is rendering
    // behind the client, which is how a leak here turns into a black screen
    // somewhere else entirely.
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* Some drivers refuse. Disposing is still worth doing. */
    }
    this.renderer.dispose();
  }
}
