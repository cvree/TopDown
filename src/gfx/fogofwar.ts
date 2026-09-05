import * as THREE from 'three';
import type { VisionField } from '../engine/vision';

/**
 * The fog, on the GPU.
 *
 * The simulation owns *what* is visible; this owns what that looks like. The
 * vision grid is uploaded as a one-channel texture and every surface inside
 * the playfield samples it by world position, so a wall's shadow falls across
 * the floor, up the side of the next wall and over the bush behind it as one
 * continuous shape rather than as three separate darkened objects.
 *
 * Three decisions are worth stating, because they are what stops this reading
 * as a lighting effect rather than as fog:
 *
 *  - **Fogged ground is not black.** League's fog is dim, desaturated and
 *    cooler than lit ground, and the terrain stays legible through it — you
 *    are always meant to be able to *navigate* the dark, just not to know
 *    what is standing in it. A black mask makes the map unreadable, teaches
 *    nothing, and is the thing this used to get wrong: the shroud keeps a bit
 *    over half its own luminance and is coloured rather than crushed.
 *  - **The dark has weather in it.** Two layers of drifting world-space noise
 *    ride the shroud, so the unknown part of the map moves. A static multiply
 *    reads as a dimmed screenshot; something that breathes reads as fog.
 *  - **The boundary is the instrument.** A cool rim sits exactly where sight
 *    ends, which is the line the whole mode is about: it is the difference
 *    between "the map is dark over there" and "*my vision stops here*".
 *
 * And one that has not changed: **bodies are not dimmed, they are gone.**
 * Nothing here hides a champion; the renderer does that, from the same
 * visibility answer the targeting code uses. A half-faded enemy in the fog
 * would be a tell, and a tell is the opposite of the skill this builds.
 */

/** Shared by every material the fog touches, so one write updates all of them. */
export interface FogUniforms {
  uFowTex: { value: THREE.Texture | null };
  /** 1/cols, 1/rows. */
  uFowTexel: { value: THREE.Vector2 };
  uFowCell: { value: number };
  /** 0 disables the effect entirely, at no cost beyond one branch. */
  uFowDark: { value: number };
  uFowTint: { value: THREE.Color };
  /** Floor under the shroud, so nothing in the dark ever reaches black. */
  uFowHaze: { value: THREE.Color };
  /** The rim of light sitting on the edge of your vision. */
  uFowEdge: { value: THREE.Color };
  /** Drives the drift of the fog body. Seconds. */
  uFowTime: { value: number };
}

/**
 * The colour of not knowing.
 *
 * `DARK` is how much luminance the shroud takes away — a little under half,
 * where it used to take two thirds — and the tint is what is left multiplied
 * by. Both are deliberately far from black: at these values a wall, a bush and
 * the paving all stay separable in the dark, which is what makes walking into
 * the unknown a decision rather than a coin flip.
 */
const DARK = 0.4;
const TINT = new THREE.Color('#c6cddb');
const HAZE = new THREE.Color('#0e1830');
const EDGE = new THREE.Color('#9fe4ff');

/**
 * What the minimap paints over an unlit cell, matched to the arena so the two
 * pictures of the same grid are the same colour.
 */
export const FOG_MINIMAP = { r: 12, g: 22, b: 44, alpha: 0.74 } as const;

export class FogOfWar {
  readonly uniforms: FogUniforms = {
    uFowTex: { value: null },
    uFowTexel: { value: new THREE.Vector2(1, 1) },
    uFowCell: { value: 40 },
    uFowDark: { value: 0 },
    uFowTint: { value: TINT.clone() },
    uFowHaze: { value: HAZE.clone() },
    uFowEdge: { value: EDGE.clone() },
    uFowTime: { value: 0 },
  };

  private texture: THREE.DataTexture | null = null;
  private data: Uint8Array | null = null;
  private field: VisionField | null = null;

  /**
   * Point the fog at a vision field, or at nothing.
   *
   * Passing null is how a drill without vision gets a scene that is exactly
   * the scene it always had: the uniform goes to zero and the branch in every
   * patched shader is never taken.
   */
  setField(field: VisionField | null): void {
    if (field === this.field) return;
    this.field = field;
    this.disposeTexture();
    if (!field) {
      this.uniforms.uFowDark.value = 0;
      this.uniforms.uFowTex.value = null;
      return;
    }
    const data = new Uint8Array(field.cols * field.rows);
    const tex = new THREE.DataTexture(data, field.cols, field.rows, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.data = data;
    this.texture = tex;
    this.uniforms.uFowTex.value = tex;
    this.uniforms.uFowTexel.value.set(1 / field.cols, 1 / field.rows);
    this.uniforms.uFowCell.value = field.cell;
    this.uniforms.uFowDark.value = DARK;
  }

  /** Push this frame's grid to the GPU. Cheap: a few thousand bytes. */
  update(time: number): void {
    this.uniforms.uFowTime.value = time;
    const field = this.field;
    const data = this.data;
    if (!field || !data || !this.texture) return;
    const light = field.light;
    for (let i = 0; i < data.length; i++) data[i] = light[i] * 255;
    this.texture.needsUpdate = true;
  }

  /**
   * Teach a material to respect the fog.
   *
   * Patching rather than replacing keeps three's lighting, shadows and tone
   * mapping — the fog is applied to the final colour, after everything else
   * has had its say, which is also the only place it can be applied without
   * the shadow of a wall being lit by the sun that the wall is blocking.
   */
  patch(material: THREE.Material): void {
    const u = this.uniforms;
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      prevCompile.call(material, shader, renderer);
      shader.uniforms.uFowTex = u.uFowTex;
      shader.uniforms.uFowTexel = u.uFowTexel;
      shader.uniforms.uFowCell = u.uFowCell;
      shader.uniforms.uFowDark = u.uFowDark;
      shader.uniforms.uFowTint = u.uFowTint;
      shader.uniforms.uFowHaze = u.uFowHaze;
      shader.uniforms.uFowEdge = u.uFowEdge;
      shader.uniforms.uFowTime = u.uFowTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFowPos;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vFowPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
          #else
            vFowPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uFowTex;
          uniform vec2 uFowTexel;
          uniform float uFowCell;
          uniform float uFowDark;
          uniform vec3 uFowTint;
          uniform vec3 uFowHaze;
          uniform vec3 uFowEdge;
          uniform float uFowTime;
          varying vec3 vFowPos;

          // Value noise, hashed rather than sampled: the fog body needs to
          // move across the whole playfield and a texture large enough not to
          // repeat at that scale costs more than four hashes.
          float fowHash( vec2 p ) {
            return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
          }
          float fowNoise( vec2 p ) {
            vec2 i = floor( p );
            vec2 f = fract( p );
            vec2 w = f * f * ( 3.0 - 2.0 * f );
            return mix(
              mix( fowHash( i ), fowHash( i + vec2( 1.0, 0.0 ) ), w.x ),
              mix( fowHash( i + vec2( 0.0, 1.0 ) ), fowHash( i + vec2( 1.0, 1.0 ) ), w.x ),
              w.y );
          }`,
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          if ( uFowDark > 0.001 ) {
            // Grid cell centres sit on world multiples of the cell size, so
            // the half-texel offset is what keeps the fog aligned with the
            // shadow the simulation actually computed.
            vec2 fowUv = ( vFowPos.xz / uFowCell + 0.5 ) * uFowTexel;
            float fowLit = texture2D( uFowTex, clamp( fowUv, vec2( 0.0 ), vec2( 1.0 ) ) ).r;
            // Anything outside the playfield is scenery rather than map, and
            // scenery is never fogged: the stadium is not the thing you are
            // being asked to hold vision on.
            float fowIn = step( 0.0, fowUv.x ) * step( fowUv.x, 1.0 ) * step( 0.0, fowUv.y ) * step( fowUv.y, 1.0 );
            float fowShade = mix( 1.0, smoothstep( 0.05, 0.62, fowLit ), fowIn );

            // Two layers of drift, one slow and broad, one finer and crossing
            // it. Cheap, and it is the whole difference between fog and a
            // dimmer switch.
            vec2 fowW = vFowPos.xz;
            float fowN = fowNoise( fowW * 0.0013 + vec2( uFowTime * 0.013, uFowTime * -0.010 ) );
            fowN = mix( fowN, fowNoise( fowW * 0.0037 - vec2( uFowTime * 0.024, uFowTime * 0.017 ) ), 0.42 );

            // Desaturate, tint, dim — in that order, so the stonework survives
            // as texture instead of being replaced by a flat colour — then set
            // a floor under it so the shroud never reaches black.
            vec3 fowLum = vec3( dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) );
            vec3 fowVeil = mix( gl_FragColor.rgb, fowLum, 0.60 ) * uFowTint * ( 1.0 - uFowDark );
            fowVeil += uFowHaze * ( 0.62 + fowN * 0.75 );

            gl_FragColor.rgb = mix( fowVeil, gl_FragColor.rgb, fowShade );

            // The edge of sight, drawn as a rim rather than left as a gradient.
            // Narrow and quiet: enough to say "this line is where I stop
            // seeing", never enough to outline the playfield in neon.
            float fowRim = smoothstep( 0.16, 0.34, fowLit ) * ( 1.0 - smoothstep( 0.34, 0.60, fowLit ) );
            gl_FragColor.rgb += uFowEdge * fowRim * fowIn * 0.05;
          }`,
        );
    };
    material.customProgramCacheKey = () => `${prevKey.call(material)}|fow`;
    material.needsUpdate = true;
  }

  private disposeTexture(): void {
    this.texture?.dispose();
    this.texture = null;
    this.data = null;
  }

  dispose(): void {
    this.disposeTexture();
  }
}
