import * as THREE from 'three';

/**
 * The grade pass. Everything that used to be a full-screen 2D fill in the old
 * canvas renderer happens here instead, in one pass, with a real falloff:
 * vignette, the red edge when you are being hit, the white punch on a kill,
 * and a touch of edge chromatic aberration so the frame has a lens.
 */
export const GradeShader = {
  name: 'RiftGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.9 },
    uHurt: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color('#ffffff') },
    uEnergy: { value: 0 },
    uDim: { value: 0 },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.045 },
    uAberration: { value: 0.9 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uHurt;
    uniform float uFlash;
    uniform vec3  uFlashColor;
    uniform float uEnergy;
    uniform float uDim;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uAberration;
    uniform float uTime;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot( c, c );

      // Lens: the further from centre, the wider the channels separate.
      float ab = uAberration * ( 0.0016 + uHurt * 0.0042 ) * r2;
      vec3 col;
      col.r = texture2D( tDiffuse, uv + c * ab ).r;
      col.g = texture2D( tDiffuse, uv ).g;
      col.b = texture2D( tDiffuse, uv - c * ab ).b;

      // Saturation / contrast.
      float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( lum ), col, uSaturation );
      col = ( col - 0.5 ) * uContrast + 0.5;

      // Vignette, tightened as the combo chain builds.
      float vig = smoothstep( 0.95, 0.18, r2 * ( 1.0 + uVignette * 0.9 + uEnergy * 0.35 ) );
      col *= mix( 0.62, 1.0, vig );

      // Being hit: a hard red rim, never a wash over the playfield. You must
      // always be able to read what is about to hit you next.
      float rim = smoothstep( 0.06, 0.30, r2 );
      col = mix( col, mix( col, vec3( 0.85, 0.10, 0.22 ), 0.72 ), rim * uHurt );

      // Kill / event punch.
      col += uFlashColor * uFlash * ( 0.35 + 0.4 * ( 1.0 - r2 ) );

      // A whisper of grain keeps flat sky from banding.
      float grain = fract( sin( dot( uv * ( 1.0 + uTime * 0.0001 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      col += ( grain - 0.5 ) * 0.014;

      col *= ( 1.0 - uDim );

      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};
