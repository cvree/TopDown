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
 * Two decisions are worth stating, because both are what stops this reading as
 * a lighting effect rather than as fog:
 *
 *  - **Fogged ground is not black.** League's fog is dim, desaturated and
 *    cooler than lit ground, and the terrain stays legible through it — you
 *    are always meant to be able to *navigate* the dark, just not to know
 *    what is standing in it. A black mask would make the map unreadable and
 *    teach nothing.
 *  - **Bodies are not dimmed, they are gone.** Nothing here hides a champion;
 *    the renderer does that, from the same visibility answer the targeting
 *    code uses. A half-faded enemy in the fog would be a tell, and a tell is
 *    the opposite of the skill this is trying to build.
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
}

/** How dark fogged ground goes, and what colour it goes. */
const DARK = 0.66;
const TINT = new THREE.Color('#5f7fbd');

export class FogOfWar {
  readonly uniforms: FogUniforms = {
    uFowTex: { value: null },
    uFowTexel: { value: new THREE.Vector2(1, 1) },
    uFowCell: { value: 40 },
    uFowDark: { value: 0 },
    uFowTint: { value: TINT.clone() },
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
  update(): void {
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
          varying vec3 vFowPos;`,
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
            float fowShade = mix( 1.0, smoothstep( 0.04, 0.55, fowLit ), fowIn );
            vec3 fowLum = vec3( dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) );
            vec3 fowDark = mix( fowLum, gl_FragColor.rgb, 0.4 ) * uFowTint * ( 1.0 - uFowDark );
            gl_FragColor.rgb = mix( fowDark, gl_FragColor.rgb, fowShade );
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
