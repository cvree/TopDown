import * as THREE from 'three';

/**
 * Ground indicators, drawn as real geometry lying on the arena floor.
 *
 * Everything the game needs to tell you about space — your attack range, where
 * you clicked, what is about to explode, which target is the priority — is a
 * decal here. That is deliberate and it is how MOBAs stay readable: the
 * information lives in the world, at the place it is about, not in a corner of
 * the screen you have to look away to read.
 *
 * The API is immediate mode. Call `begin()`, emit whatever this frame needs,
 * call `end()`. Meshes are pooled, so a frame that draws forty rings and a
 * frame that draws two cost the same in allocations: nothing.
 */

export interface DecalOpts {
  color?: string;
  alpha?: number;
  /** Ring thickness in world units. */
  width?: number;
  /** Number of dashes around the ring; 0 for a solid line. */
  dash?: number;
  /** Radians per second of rotation. */
  spin?: number;
  /** Fills the ring from 12 o'clock, 0..1. Used for countdowns. */
  progress?: number;
  /** Softly fills the interior at this alpha. */
  fill?: number;
  /** Height above the floor. Higher decals draw over lower ones. */
  rise?: number;
  /** Additive reads as light; normal reads as paint. */
  additive?: boolean;
}

const RING_VERT = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

/**
 * One shader draws every radial indicator in the game: rings, dashed rings,
 * discs, countdown arcs and cone telegraphs. Branching on a mode uniform beats
 * five materials that all have to be kept looking like siblings.
 */
const RING_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uAlpha;
  uniform float uInner;    // 0..1 of the quad half-extent
  uniform float uOuter;
  uniform float uDash;
  uniform float uSpin;
  uniform float uProgress; // 0..1, <=0 disables
  uniform float uFill;
  uniform float uA0;       // sector start, radians
  uniform float uA1;       // sector end
  uniform float uSoft;
  varying vec2 vLocal;

  const float TAU = 6.28318530718;

  void main() {
    float r = length( vLocal );
    if ( r > 1.0 ) discard;

    float ang = atan( vLocal.y, vLocal.x );

    // Sector mask (cones). uA1 - uA0 >= TAU means "full circle".
    float sector = 1.0;
    if ( uA1 - uA0 < TAU - 0.001 ) {
      float rel = mod( ang - uA0 + TAU * 2.0, TAU );
      sector = step( rel, uA1 - uA0 );
    }

    // Countdown: sweeps clockwise from twelve o'clock.
    float prog = 1.0;
    if ( uProgress > 0.0 ) {
      float rel = mod( atan( vLocal.x, -vLocal.y ) + TAU, TAU );
      prog = step( rel, uProgress * TAU );
    }

    float band = smoothstep( uInner - uSoft, uInner + uSoft, r ) *
                 ( 1.0 - smoothstep( uOuter - uSoft, uOuter + uSoft, r ) );

    float dash = 1.0;
    if ( uDash > 0.5 ) {
      float d = fract( ( ang + uSpin ) / TAU * uDash );
      dash = smoothstep( 0.02, 0.16, d ) * ( 1.0 - smoothstep( 0.56, 0.70, d ) );
    }

    // Interior wash, brightest at the rim so the shape has a lip.
    float interior = uFill * ( 1.0 - smoothstep( uInner * 0.2, uOuter, r ) * 0.55 )
                   * ( 1.0 - smoothstep( uOuter, uOuter + uSoft * 2.0, r ) );

    float a = ( band * dash * prog + interior ) * uAlpha * sector;
    if ( a <= 0.002 ) discard;
    gl_FragColor = vec4( uColor, a );
  }
`;

const LINE_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uAlpha;
  uniform float uFill;
  uniform float uProgress; // fills along the length
  uniform float uSoft;
  varying vec2 vLocal;

  void main() {
    float edge = 1.0 - abs( vLocal.y );
    float cap  = 1.0 - abs( vLocal.x );
    if ( edge < 0.0 || cap < 0.0 ) discard;
    float rim = smoothstep( 0.0, uSoft, edge ) * ( 1.0 - smoothstep( 0.24, 0.34, edge ) );
    float body = uFill * smoothstep( 0.0, uSoft, edge ) * smoothstep( 0.0, 0.06, cap );
    float grow = uProgress > 0.0 ? step( vLocal.x * 0.5 + 0.5, uProgress ) : 1.0;
    float a = ( rim + body ) * uAlpha * smoothstep( 0.0, 0.05, cap ) * grow;
    if ( a <= 0.002 ) discard;
    gl_FragColor = vec4( uColor, a );
  }
`;

interface Pooled {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

const makeMaterial = (frag: string, additive: boolean): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#ffffff') },
      uAlpha: { value: 1 },
      uInner: { value: 0.8 },
      uOuter: { value: 1 },
      uDash: { value: 0 },
      uSpin: { value: 0 },
      uProgress: { value: 0 },
      uFill: { value: 0 },
      uA0: { value: 0 },
      uA1: { value: Math.PI * 2 },
      uSoft: { value: 0.02 },
    },
    vertexShader: RING_VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });

export class DecalLayer {
  private quad = new THREE.PlaneGeometry(1, 1);
  private radial: Pooled[] = [];
  private radialAdd: Pooled[] = [];
  private lines: Pooled[] = [];
  private linesAdd: Pooled[] = [];
  private used = { radial: 0, radialAdd: 0, lines: 0, linesAdd: 0 };
  private time = 0;

  constructor(private readonly parent: THREE.Object3D) {}

  begin(dt: number): void {
    this.time += dt;
    this.used.radial = 0;
    this.used.radialAdd = 0;
    this.used.lines = 0;
    this.used.linesAdd = 0;
  }

  end(): void {
    for (let i = this.used.radial; i < this.radial.length; i++) this.radial[i].mesh.visible = false;
    for (let i = this.used.radialAdd; i < this.radialAdd.length; i++) this.radialAdd[i].mesh.visible = false;
    for (let i = this.used.lines; i < this.lines.length; i++) this.lines[i].mesh.visible = false;
    for (let i = this.used.linesAdd; i < this.linesAdd.length; i++) this.linesAdd[i].mesh.visible = false;
  }

  private take(pool: Pooled[], frag: string, additive: boolean, index: number): Pooled {
    let p = pool[index];
    if (!p) {
      const mat = makeMaterial(frag, additive);
      const mesh = new THREE.Mesh(this.quad, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      this.parent.add(mesh);
      p = { mesh, mat };
      pool[index] = p;
    }
    p.mesh.visible = true;
    return p;
  }

  /**
   * A radial indicator. `radius` is the outer radius in world units; `width`
   * (default 6) is the stroke. Pass `fill` for a washed interior, `progress`
   * for a countdown sweep, `dash` for a dashed ring.
   */
  ring(x: number, y: number, radius: number, o: DecalOpts = {}): void {
    const additive = o.additive ?? true;
    const pool = additive ? this.radialAdd : this.radial;
    const idx = additive ? this.used.radialAdd++ : this.used.radial++;
    const p = this.take(pool, RING_FRAG, additive, idx);
    const width = o.width ?? 6;
    const extent = radius + width;
    const u = p.mat.uniforms;
    (u.uColor.value as THREE.Color).set(o.color ?? '#ffffff');
    u.uAlpha.value = o.alpha ?? 1;
    u.uInner.value = Math.max(0, (radius - width) / extent);
    u.uOuter.value = radius / extent;
    u.uDash.value = o.dash ?? 0;
    u.uSpin.value = (o.spin ?? 0) * this.time;
    u.uProgress.value = o.progress ?? 0;
    u.uFill.value = o.fill ?? 0;
    u.uA0.value = 0;
    u.uA1.value = Math.PI * 2;
    u.uSoft.value = Math.min(0.4, (width * 0.5) / extent + 0.006);
    p.mesh.position.set(x, o.rise ?? 2, y);
    p.mesh.scale.set(extent * 2, extent * 2, 1);
  }

  /** A filled circle: hazard footprints and area telegraphs. */
  disc(x: number, y: number, radius: number, o: DecalOpts = {}): void {
    this.ring(x, y, radius, { width: Math.max(3, radius * 0.06), fill: o.fill ?? 0.34, ...o });
  }

  /** A circular sector, for cone telegraphs. `a0`/`a1` are world angles. */
  sector(x: number, y: number, radius: number, a0: number, a1: number, o: DecalOpts = {}): void {
    const additive = o.additive ?? true;
    const pool = additive ? this.radialAdd : this.radial;
    const idx = additive ? this.used.radialAdd++ : this.used.radial++;
    const p = this.take(pool, RING_FRAG, additive, idx);
    const width = o.width ?? 5;
    const extent = radius + width;
    const u = p.mat.uniforms;
    (u.uColor.value as THREE.Color).set(o.color ?? '#ffffff');
    u.uAlpha.value = o.alpha ?? 1;
    u.uInner.value = 0;
    u.uOuter.value = radius / extent;
    u.uDash.value = 0;
    u.uProgress.value = 0;
    u.uFill.value = o.fill ?? 0.4;
    // The quad lies in the XZ plane after the -90° X rotation, which flips the
    // sense of the angle: world +y is local -y.
    u.uA0.value = -a1;
    u.uA1.value = -a0;
    u.uSoft.value = Math.min(0.3, width / extent + 0.01);
    p.mesh.position.set(x, o.rise ?? 2, y);
    p.mesh.scale.set(extent * 2, extent * 2, 1);
  }

  /** A capsule between two points: line hazards and skillshot telegraphs. */
  line(x0: number, y0: number, x1: number, y1: number, halfWidth: number, o: DecalOpts = {}): void {
    const additive = o.additive ?? true;
    const pool = additive ? this.linesAdd : this.lines;
    const idx = additive ? this.used.linesAdd++ : this.used.lines++;
    const p = this.take(pool, LINE_FRAG, additive, idx);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.max(1, Math.hypot(dx, dy));
    const u = p.mat.uniforms;
    (u.uColor.value as THREE.Color).set(o.color ?? '#ffffff');
    u.uAlpha.value = o.alpha ?? 1;
    u.uFill.value = o.fill ?? 0.3;
    u.uProgress.value = o.progress ?? 0;
    u.uSoft.value = 0.1;
    p.mesh.position.set((x0 + x1) / 2, o.rise ?? 2, (y0 + y1) / 2);
    p.mesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(dy, dx));
    p.mesh.scale.set(len, halfWidth * 2, 1);
  }

  dispose(): void {
    for (const pool of [this.radial, this.radialAdd, this.lines, this.linesAdd]) {
      for (const p of pool) {
        p.mat.dispose();
        p.mesh.removeFromParent();
      }
      pool.length = 0;
    }
    this.quad.dispose();
  }
}
