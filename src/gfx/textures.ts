import * as THREE from 'three';
import { clamp01, fbm, mix, smoothstep, valueTiled, worley, worleyEdge } from './noise';

/**
 * Every surface in the arena is painted here, at load time, into offscreen
 * canvases — stone slabs, moss in the joints, rock strata, the glow sprites
 * the particle system blits. Nothing is fetched, so the whole rift still
 * bundles into a single HTML file, and nothing is a flat gradient.
 *
 * Each generator is memoised: the same texture is never painted twice.
 */

const SIZE = 512;

const cache = new Map<string, THREE.Texture>();

const memo = (key: string, make: () => THREE.Texture): THREE.Texture => {
  const hit = cache.get(key);
  if (hit) return hit;
  const t = make();
  cache.set(key, t);
  return t;
};

const canvas = (size = SIZE): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } => {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return { c, g: c.getContext('2d')! };
};

const toTexture = (c: HTMLCanvasElement, repeat: number, srgb: boolean): THREE.Texture => {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
};

/**
 * Derives a tangent-space normal map from a height field using a Sobel
 * gradient. Doing this in JS once beats shipping a normal map, and it is what
 * makes the paving read as cut stone under a moving light instead of a print.
 */
const normalFromHeight = (height: Float32Array, size: number, strength: number): HTMLCanvasElement => {
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);
      const dx = tl + 2 * l + bl - (tr + 2 * r + br);
      const dy = tl + 2 * t + tr - (bl + 2 * b + br);
      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
};

// ------------------------------------------------------------- ground stone

interface Surface {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
}

const surfaceCache = new Map<string, Surface>();

/**
 * The paved centre of the arena: cut flagstones, worn to a shine on the
 * walking line, moss packed into every joint.
 */
const buildPaving = (seed: number): Surface => {
  const size = SIZE;
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = canvas(size);
  const roughImg = rough.g.createImageData(size, size);

  // Ashlar masonry in a running bond. Organic cell noise was the mistake here
  // first time round: it reads as cracked mud, not as a floor somebody built.
  const ROWS = 5;
  const hash = (a: number, b: number) => {
    let n = Math.sin(a * 127.1 + b * 311.7 + seed * 0.017) * 43758.5453;
    return n - Math.floor(n);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Course (row) the pixel falls in, and its offset within it.
      const rowF = v * ROWS;
      const row = Math.floor(rowF);
      const rowFrac = rowF - row;
      // Every course is shifted and cut into a different number of blocks.
      const cols = 3 + Math.floor(hash(row, 3) * 2.99);
      const shift = hash(row, 11);
      const colF = (u + shift) * cols;
      const col = Math.floor(colF);
      const colFrac = colF - col;

      // Wobble the joint lines a little so nothing is machine-straight.
      const wobble = (fbm(u * 26, v * 26, { seed: seed + 61, period: 26, octaves: 2 }) - 0.5) * 0.055;
      const dU = (Math.min(colFrac, 1 - colFrac) + wobble) / cols;
      const dV = (Math.min(rowFrac, 1 - rowFrac) + wobble) / ROWS;
      const edge = Math.min(dU, dV);
      const joint = smoothstep(0.0035, 0.0125, edge); // 0 in the mortar, 1 on the block

      // Per-block tone variation is what actually sells cut stone.
      const blockTone = hash(row * 31 + col, 7);
      const grain = fbm(u * 13, v * 13, { seed: seed + 21, period: 13, octaves: 4 });
      const macro = fbm(u * 1.6, v * 1.6, { seed: seed + 31, period: 2, octaves: 3 });
      const speck = valueTiled(u * 52, v * 52, 52, seed + 41);
      const wear = smoothstep(0.28, 0.8, macro);

      let r = mix(126, 176, grain * 0.35 + wear * 0.35 + blockTone * 0.3);
      let gg = mix(128, 178, grain * 0.35 + wear * 0.35 + blockTone * 0.3);
      let b = mix(134, 182, grain * 0.32 + wear * 0.36 + blockTone * 0.32);

      // Warm sandstone veining crossing a few of the blocks.
      const vein = smoothstep(0.6, 0.9, fbm(u * 4.2, v * 4.2, { seed: seed + 51, period: 4, octaves: 3 }));
      r = mix(r, 186, vein * 0.5);
      gg = mix(gg, 162, vein * 0.44);
      b = mix(b, 128, vein * 0.36);

      // Mortar: a narrow, soft shadow line, not a chasm.
      r *= mix(0.66, 1, joint);
      gg *= mix(0.68, 1, joint);
      b *= mix(0.72, 1, joint);

      // Moss packs into the joints and pools where the ground dips.
      const moss = clamp01((1 - joint) * 0.75 + smoothstep(0.72, 0.94, macro) * 0.55) * (0.45 + grain * 0.6);
      r = mix(r, 74 + speck * 22, moss * 0.55);
      gg = mix(gg, 108 + speck * 30, moss * 0.55);
      b = mix(b, 70 + speck * 16, moss * 0.55);

      // Occasional chipped pit.
      const pit = speck > 0.972 ? 0.4 : 0;
      r *= 1 - pit;
      gg *= 1 - pit;
      b *= 1 - pit;

      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;

      // Blocks stand proud of the mortar; grain adds micro relief.
      height[y * size + x] = joint * 0.8 + grain * 0.16 + blockTone * 0.04 - moss * 0.05;

      const rv = clamp01(0.6 + moss * 0.3 - wear * 0.2 + grain * 0.12);
      roughImg.data[i] = rv * 255;
      roughImg.data[i + 1] = rv * 255;
      roughImg.data[i + 2] = rv * 255;
      roughImg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  rough.g.putImageData(roughImg, 0, 0);

  return {
    albedo: toTexture(c, 1, true),
    normal: toTexture(normalFromHeight(height, size, 2.2), 1, false),
    roughness: toTexture(rough.c, 1, false),
  };
};

/** The rock that walls the arena in: vertical strata, moss on the ledges. */
const buildRock = (seed: number): Surface => {
  const size = SIZE;
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = canvas(size);
  const roughImg = rough.g.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Strata are stretched hard along one axis.
      const strata = fbm(u * 3, v * 22, { seed: seed + 5, period: 3, octaves: 4 });
      const chunk = worleyEdge(u * 5, v * 7, seed + 9, 5);
      const grain = fbm(u * 26, v * 26, { seed: seed + 13, period: 26, octaves: 3 });
      const crack = smoothstep(0.004, 0.075, chunk);

      const band = smoothstep(0.4, 0.62, strata);
      let r = mix(84, 146, band * 0.7 + grain * 0.3);
      let gg = mix(88, 150, band * 0.66 + grain * 0.34);
      let b = mix(98, 158, band * 0.6 + grain * 0.4);

      // Iron staining in the deeper bands.
      const rust = smoothstep(0.68, 0.9, fbm(u * 6, v * 9, { seed: seed + 23, period: 6, octaves: 3 }));
      r = mix(r, 166, rust * 0.45);
      gg = mix(gg, 126, rust * 0.36);
      b = mix(b, 92, rust * 0.24);

      r *= mix(0.66, 1, crack);
      gg *= mix(0.68, 1, crack);
      b *= mix(0.72, 1, crack);

      // Moss clings where water runs.
      const moss = smoothstep(0.58, 0.9, fbm(u * 4 + 9, v * 3 + 2, { seed: seed + 33, period: 4, octaves: 3 })) * (1 - crack * 0.4);
      r = mix(r, 70, moss * 0.55);
      gg = mix(gg, 108, moss * 0.55);
      b = mix(b, 66, moss * 0.55);

      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
      height[y * size + x] = crack * 0.45 + strata * 0.42 + grain * 0.13;

      const rv = clamp01(0.78 + moss * 0.15 + grain * 0.1);
      roughImg.data[i] = rv * 255;
      roughImg.data[i + 1] = rv * 255;
      roughImg.data[i + 2] = rv * 255;
      roughImg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  rough.g.putImageData(roughImg, 0, 0);
  return {
    albedo: toTexture(c, 1, true),
    normal: toTexture(normalFromHeight(height, size, 3.4), 1, false),
    roughness: toTexture(rough.c, 1, false),
  };
};

/** Wild ground outside the arena: dark turf, exposed roots, scattered leaf. */
const buildTurf = (seed: number): Surface => {
  const size = SIZE;
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 4;
      const v = (y / size) * 4;
      const blades = fbm(u * 22, v * 22, { seed: seed + 7, period: 88, octaves: 3 });
      const patch = fbm(u * 1.6, v * 1.6, { seed: seed + 17, period: 6, octaves: 4 });
      const dirt = smoothstep(0.58, 0.82, patch);
      const speck = valueTiled(u * 60, v * 60, 240, seed + 27);

      let r = mix(48, 92, blades * 0.7 + patch * 0.3);
      let gg = mix(66, 118, blades * 0.75 + patch * 0.25);
      let b = mix(48, 76, blades * 0.6 + patch * 0.4);

      r = mix(r, 108, dirt * 0.7);
      gg = mix(gg, 88, dirt * 0.7);
      b = mix(b, 64, dirt * 0.7);

      // Occasional bright blade catches the light.
      const hi = speck > 0.965 ? 1 : 0;
      r = mix(r, 120, hi * 0.5);
      gg = mix(gg, 168, hi * 0.5);
      b = mix(b, 96, hi * 0.5);

      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
      height[y * size + x] = blades * 0.7 + patch * 0.3;
    }
  }
  g.putImageData(img, 0, 0);
  return {
    albedo: toTexture(c, 1, true),
    normal: toTexture(normalFromHeight(height, size, 1.7), 1, false),
    roughness: toTexture(c, 1, false),
  };
};

const surface = (key: string, make: () => Surface): Surface => {
  const hit = surfaceCache.get(key);
  if (hit) return hit;
  const s = make();
  surfaceCache.set(key, s);
  return s;
};

export const pavingSurface = (seed = 1): Surface => surface(`pave${seed}`, () => buildPaving(seed));
export const rockSurface = (seed = 1): Surface => surface(`rock${seed}`, () => buildRock(seed));
export const turfSurface = (seed = 1): Surface => surface(`turf${seed}`, () => buildTurf(seed));

// --------------------------------------------------------------- sprite art

/** Soft radial falloff used by every additive particle and glow quad. */
export const glowSprite = (): THREE.Texture =>
  memo('glow', () => {
    const { c, g } = canvas(128);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.72)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  });

/** A hard-edged shard for sparks — reads as debris, not fog. */
export const sparkSprite = (): THREE.Texture =>
  memo('spark', () => {
    const { c, g } = canvas(64);
    const grad = g.createLinearGradient(0, 32, 64, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.42, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.55, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 26, 64, 12);
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, 26, 0, 38);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.5, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 26, 64, 12);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  });

/** Rolling smoke/dust puff. */
export const smokeSprite = (): THREE.Texture =>
  memo('smoke', () => {
    const size = 128;
    const { c, g } = canvas(size);
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        const n = fbm(u * 5, v * 5, { seed: 91, octaves: 4 });
        const a = clamp01((1 - d) * 1.35) ** 1.6 * (0.35 + n * 0.9);
        const i = (y * size + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = clamp01(a) * 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  });

/** Caustic-ish scroll map for the moat and every energy surface. */
export const flowMap = (): THREE.Texture =>
  memo('flow', () => {
    const size = 256;
    const { c, g } = canvas(size);
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * 4;
        const v = (y / size) * 4;
        const w = 1 - worley(u * 1.5, v * 1.5, 5, 6);
        const n = fbm(u * 3, v * 3, { seed: 13, period: 12, octaves: 4 });
        const a = clamp01(w ** 3 * 1.6 + n * 0.35);
        const i = (y * size + x) * 4;
        img.data[i] = a * 255;
        img.data[i + 1] = a * 255;
        img.data[i + 2] = a * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTexture(c, 1, false);
  });

/**
 * The engraved ring at the centre of the arena. Drawn with the 2D API because
 * ornament wants crisp strokes, not noise.
 */
export const runeRing = (): THREE.Texture =>
  memo('rune', () => {
    const size = 1024;
    const { c, g } = canvas(size);
    const cx = size / 2;
    g.clearRect(0, 0, size, size);
    g.translate(cx, cx);

    const ring = (r: number, w: number, a: number) => {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.lineWidth = w;
      g.strokeStyle = `rgba(255,255,255,${a})`;
      g.stroke();
    };

    ring(478, 6, 0.85);
    ring(462, 2, 0.4);
    ring(392, 3, 0.5);
    ring(300, 10, 0.3);
    ring(238, 2.5, 0.55);
    ring(120, 4, 0.6);
    ring(96, 1.5, 0.35);

    // Tick marks around the outer band.
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const long = i % 6 === 0;
      g.save();
      g.rotate(a);
      g.beginPath();
      g.rect(-2, -462, 4, long ? 44 : 20);
      g.fillStyle = `rgba(255,255,255,${long ? 0.8 : 0.35})`;
      g.fill();
      g.restore();
    }

    // Four cardinal chevrons — the arena has an orientation.
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i / 4) * Math.PI * 2);
      g.beginPath();
      g.moveTo(0, -360);
      g.lineTo(-34, -312);
      g.lineTo(0, -330);
      g.lineTo(34, -312);
      g.closePath();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fill();
      g.restore();
    }

    // Interlocking inner geometry.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.save();
      g.rotate(a);
      g.beginPath();
      g.moveTo(0, -238);
      g.lineTo(62, -120);
      g.lineTo(0, -96);
      g.lineTo(-62, -120);
      g.closePath();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,255,255,0.34)';
      g.stroke();
      g.restore();
    }

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });

/** Radial gradient used as a cheap contact shadow under every unit. */
export const contactShadow = (): THREE.Texture =>
  memo('contact', () => {
    const { c, g } = canvas(128);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  });

/**
 * A view of an existing texture with its own repeat. Textures are shared, so
 * setting `.repeat` on one would rescale every mesh that uses it.
 */
export const tiled = (tex: THREE.Texture, repeatX: number, repeatY = repeatX): THREE.Texture => {
  const t = tex.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = tex.colorSpace;
  t.anisotropy = tex.anisotropy;
  t.needsUpdate = true;
  return t;
};

export const disposeTextures = (): void => {
  for (const t of cache.values()) t.dispose();
  cache.clear();
  for (const s of surfaceCache.values()) {
    s.albedo.dispose();
    s.normal.dispose();
    s.roughness.dispose();
  }
  surfaceCache.clear();
};

export type { Surface };
