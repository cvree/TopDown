import * as THREE from 'three';

/**
 * The grade pass.
 *
 * Everything that used to be a full-screen 2D fill in the old canvas renderer
 * happens here instead, in one pass, with real falloff — but it does more than
 * that now. This is where the frame stops looking like a WebGL render and
 * starts looking like a game:
 *
 *  - **Sharpen.** Bloom and the half-float composite both soften edges. An
 *    unsharp mask over the whole frame puts the stonework and the champion
 *    silhouettes back. It is the single largest difference between "a three.js
 *    scene" and "a shipped frame", and it costs four extra taps.
 *  - **Split tone.** Shadows pushed cold and blue, highlights pushed warm.
 *    Every game you have ever thought looked expensive does this.
 *  - **Filmic shoulder.** A soft roll-off at the top end so the braziers and
 *    the ability flashes bloom into white rather than clipping into it.
 *  - **Radial blur on damage**, driven from the edges inward, so being hit
 *    reads in your peripheral vision without ever obscuring the playfield.
 *  - Vignette, the red rim when you are being hit, the white punch on a kill,
 *    a touch of chromatic aberration at the edges, and grain.
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
    uSaturation: { value: 1.32 },
    uContrast: { value: 1.16 },
    uAberration: { value: 0.9 },
    uSharpen: { value: 0.24 },
    uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
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
    uniform float uSharpen;
    uniform vec2  uTexel;
    uniform float uTime;
    varying vec2 vUv;

    // Filmic shoulder. Everything below the knee passes through untouched —
    // a curve that lifts the mids washes the stone out — and only the top end
    // is compressed, so braziers and ability flashes roll into white instead
    // of clipping to it.
    vec3 shoulder( vec3 x ) {
      vec3 over = max( vec3( 0.0 ), x - 0.72 );
      return min( x, 0.72 + over / ( 1.0 + over * 1.7 ) );
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot( c, c );

      // --- radial blur, edges only, driven by damage ---------------------
      // Sampled toward the centre so the middle of the screen — where you are
      // reading a telegraph — stays sharp no matter how hard you are hit.
      vec2 src = uv;
      float smear = uHurt * 0.055 * smoothstep( 0.02, 0.25, r2 );

      // --- unsharp mask ---------------------------------------------------
      // Computed from the untouched sample and its four neighbours, before
      // any of the lens work below. Deriving it from already-split channels
      // is what turns a sharpen into rainbow ringing on every stone edge.
      vec3 base = texture2D( tDiffuse, uv ).rgb;
      vec3 sharpAdd = vec3( 0.0 );
      if ( uSharpen > 0.001 ) {
        vec3 blur =
          texture2D( tDiffuse, uv + vec2( uTexel.x, 0.0 ) ).rgb +
          texture2D( tDiffuse, uv - vec2( uTexel.x, 0.0 ) ).rgb +
          texture2D( tDiffuse, uv + vec2( 0.0, uTexel.y ) ).rgb +
          texture2D( tDiffuse, uv - vec2( 0.0, uTexel.y ) ).rgb;
        sharpAdd = ( base - blur * 0.25 ) * uSharpen;
      }

      // Lens: the further from centre, the wider the channels separate.
      float ab = uAberration * ( 0.0016 + uHurt * 0.0042 ) * r2;
      vec3 col;
      col.r = texture2D( tDiffuse, src + c * ( ab + smear ) ).r;
      col.g = base.g;
      col.b = texture2D( tDiffuse, src - c * ( ab - smear * 0.4 ) ).b;

      if ( smear > 0.0005 ) {
        // Three taps is enough for a smear you only ever see for 300ms.
        col += texture2D( tDiffuse, src - c * smear * 0.55 ).rgb;
        col += texture2D( tDiffuse, src - c * smear * 1.15 ).rgb;
        col /= 3.0;
      }

      col = max( col + sharpAdd, vec3( 0.0 ) );

      // --- grade ------------------------------------------------------------
      float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( lum ), col, uSaturation );
      col = ( col - 0.5 ) * uContrast + 0.5;

      // Split tone: shadows cold, highlights warm. This is the whole reason
      // stone in this arena reads as stone lit by a sun rather than as grey.
      vec3 shadowTint    = vec3( 0.86, 0.94, 1.14 );
      vec3 highlightTint = vec3( 1.07, 1.01, 0.90 );
      float t = smoothstep( 0.08, 0.75, lum );
      col *= mix( shadowTint, highlightTint, t );

      col = shoulder( col );

      // Vignette, tightened as the combo chain builds. Elliptical, because a
      // circular vignette on a 21:9 monitor eats the sides of the arena.
      vec2 vc = c * vec2( 1.0, 1.32 );
      float vr = dot( vc, vc );
      float vig = smoothstep( 0.95, 0.16, vr * ( 1.0 + uVignette * 0.9 + uEnergy * 0.35 ) );
      col *= mix( 0.55, 1.0, vig );

      // Being hit: a hard red rim, never a wash over the playfield. You must
      // always be able to read what is about to hit you next.
      float rim = smoothstep( 0.06, 0.30, r2 );
      col = mix( col, mix( col, vec3( 0.85, 0.10, 0.22 ), 0.72 ), rim * uHurt );

      // Kill / event punch.
      col += uFlashColor * uFlash * ( 0.35 + 0.4 * ( 1.0 - r2 ) );

      col *= ( 1.0 - uDim );

      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};
