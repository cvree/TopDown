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
 *  - **Vibrance, not saturation.** A flat saturate pushes the stone as hard as
 *    it pushes an ability, which is how a scene ends up loud and unreadable at
 *    the same time. Weighting the boost by how colourless a pixel already is
 *    leaves the floor alone and lets the accents sing.
 *  - **Contrast around a pivot, with a coloured floor.** The curve pivots in
 *    the mids so the highlights are not dragged into the shoulder, and the
 *    blacks are lifted a hair toward deep blue: a frame whose darkest pixel is
 *    pure #000 reads as a hole rather than as a shadow.
 *  - **Split tone.** Shadows pushed cold and blue, highlights pushed warm.
 *    Every game you have ever thought looked expensive does this.
 *  - **Filmic shoulder.** A soft roll-off at the top end so the braziers and
 *    the ability flashes bloom into white rather than clipping into it.
 *  - **Radial blur on damage**, driven from the edges inward, so being hit
 *    reads in your peripheral vision without ever obscuring the playfield.
 *  - **A warm rim on the chain.** The one thing in the frame that answers a
 *    streak: the edges of the screen catch fire as the combo builds, and go
 *    out the instant you drop it.
 *  - Vignette, the red rim when you are being hit, the white punch on a kill,
 *    a touch of chromatic aberration at the edges, and grain.
 */
export const GradeShader = {
  name: 'RiftGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.82 },
    uHurt: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color('#ffffff') },
    uEnergy: { value: 0 },
    uDim: { value: 0 },
    uSaturation: { value: 1.1 },
    /** Extra saturation, weighted toward pixels that have none. */
    uVibrance: { value: 0.55 },
    uContrast: { value: 1.22 },
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
    uniform float uVibrance;
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
      vec3 over = max( vec3( 0.0 ), x - 0.74 );
      return min( x, 0.74 + over / ( 1.0 + over * 1.55 ) );
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

      // Vibrance first: how far this pixel already is from grey decides how
      // much more colour it is allowed. Stone stays stone, an ability does not.
      float mx = max( col.r, max( col.g, col.b ) );
      float mn = min( col.r, min( col.g, col.b ) );
      float chroma = ( mx - mn ) / max( mx, 0.0001 );
      float boost = uSaturation + uVibrance * ( 1.0 - chroma ) * ( 1.0 - chroma );
      col = mix( vec3( lum ), col, boost );

      // Everything from here to the shoulder works on linear light, not on
      // display values — the composer's buffer is linear and the sRGB encode
      // happens in the output pass — so every threshold below is placed
      // against linear mid-grey (~0.2), never against 0.5. Reading these as
      // display numbers is what used to tint the entire frame as shadow.
      col = ( col - 0.20 ) * uContrast + 0.20;

      // A coloured floor under the blacks. Small, but it is the difference
      // between a shadow and a hole cut in the frame.
      col += vec3( 0.006, 0.010, 0.024 ) * ( 1.0 - smoothstep( 0.0, 0.10, lum ) );

      // Split tone: shadows cold, highlights warm. This is the whole reason
      // stone in this arena reads as stone lit by a sun rather than as grey.
      vec3 shadowTint    = vec3( 0.82, 0.92, 1.20 );
      vec3 highlightTint = vec3( 1.10, 1.02, 0.88 );
      float t = smoothstep( 0.02, 0.34, lum );
      col *= mix( shadowTint, highlightTint, t );

      col = shoulder( max( col, vec3( 0.0 ) ) );

      // Vignette, tightened as the combo chain builds. Elliptical, because a
      // circular vignette on a 21:9 monitor eats the sides of the arena. It
      // darkens the corners; it is not allowed to crush them.
      vec2 vc = c * vec2( 1.0, 1.32 );
      float vr = dot( vc, vc );
      float vig = smoothstep( 0.95, 0.16, vr * ( 1.0 + uVignette * 0.9 + uEnergy * 0.3 ) );
      col *= mix( 0.74, 1.0, vig );

      // The chain, burning at the edges of the screen. Nothing else in the
      // frame reacts to a streak, so this is allowed to be obvious.
      float heat = pow( clamp( vr * 2.6, 0.0, 1.0 ), 1.4 ) * uEnergy;
      col += vec3( 1.0, 0.52, 0.20 ) * heat * 0.16;

      // Being hit: a hard red rim, never a wash over the playfield. You must
      // always be able to read what is about to hit you next.
      float rim = smoothstep( 0.06, 0.30, r2 );
      col = mix( col, mix( col, vec3( 0.92, 0.09, 0.20 ), 0.74 ), rim * uHurt );

      // Kill / event punch.
      col += uFlashColor * uFlash * ( 0.40 + 0.45 * ( 1.0 - r2 ) );

      col *= ( 1.0 - uDim );

      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};
